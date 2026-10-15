from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from plane.db.models import (
    IssueResourceRequirement,
    ProjectMember,
    ResourceBlackout,
    WorkspaceMember,
    WorkspaceResource,
)
from plane.utils.resource_booking import lock_resource_workspace, validate_resource_workspace


class WorkspaceResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceResource
        fields = ["id", "name", "description", "category", "location", "archived_at"]
        read_only_fields = ["id"]

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("A resource name is required.")
        return value.strip()


class ResourceBlackoutSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResourceBlackout
        fields = ["id", "start_date", "target_date", "reason"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("target_date", getattr(self.instance, "target_date", None))
        if start and end and start > end:
            raise serializers.ValidationError("Start date cannot exceed target date.")
        return attrs


class RequirementInputSerializer(serializers.Serializer):
    resource_id = serializers.UUIDField()
    allocation_percent = serializers.IntegerField(min_value=1, max_value=100, default=100)


class ResourceRequirementsField(serializers.Field):
    def to_internal_value(self, data):
        if not isinstance(data, list) or len(data) > 50:
            raise serializers.ValidationError("Expected at most 50 resources.")
        serializer = RequirementInputSerializer(data=data, many=True)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        if len({item["resource_id"] for item in values}) != len(values):
            raise serializers.ValidationError("Duplicate resource.")
        return values

    def to_representation(self, value):
        return [
            {"resource_id": item.resource_id, "allocation_percent": item.allocation_percent}
            for item in value.all()
            if item.deleted_at is None
        ]


def replace_requirements(issue, requirements, user):
    if user is None or not (
        ProjectMember.objects.filter(project=issue.project, member=user, is_active=True, role__gte=15).exists()
        or (
            WorkspaceMember.objects.filter(workspace=issue.workspace, member=user, is_active=True, role=20).exists()
            and ProjectMember.objects.filter(project=issue.project, member=user, is_active=True).exists()
        )
    ):
        raise PermissionDenied()
    resource_ids = [item["resource_id"] for item in requirements]
    if WorkspaceResource.objects.filter(
        workspace=issue.workspace, id__in=resource_ids, archived_at__isnull=True
    ).count() != len(resource_ids):
        raise serializers.ValidationError({"resource_requirements": "Invalid or archived resource."})
    IssueResourceRequirement.objects.filter(issue=issue).delete()
    IssueResourceRequirement.objects.bulk_create(
        [
            IssueResourceRequirement(
                issue=issue,
                resource_id=item["resource_id"],
                allocation_percent=item["allocation_percent"],
                project_id=issue.project_id,
                workspace_id=issue.workspace_id,
                created_by=user,
            )
            for item in requirements
        ]
    )


class ResourceIssueSerializerMixin:
    def save(self, **kwargs):
        requirements = self.validated_data.pop("resource_requirements", None)
        blockers = self.validated_data.pop("blocker_issue_ids", None)
        expected = self.validated_data.pop("expected_updated_at", None)
        workspace_id = self.context.get("workspace_id") or getattr(self.instance, "workspace_id", None)
        with transaction.atomic():
            if workspace_id:
                lock_resource_workspace(workspace_id)
            from plane.utils.issue_blocking import set_blockers, blocking_states, reconcile_blockers
            from plane.db.models import Project
            if expected is not None and self.instance is not None:
                from plane.db.models import Issue
                current = Issue.objects.select_for_update(of=("self",)).get(pk=self.instance.pk)
                if current.updated_at != expected:
                    raise serializers.ValidationError({"code": "BLOCKING_CHANGED"})
            request = self.context.get("request")
            actor = getattr(request, "user", None)
            desired = self.validated_data.get("state", getattr(self.instance, "state", None))
            if desired and desired.is_blocked and blockers is None and not (self.instance and (self.instance.blocking_legacy or self.instance.issue_relation.filter(relation_type="blocked_by").exists())):
                raise serializers.ValidationError({"code": "BLOCKING_REQUIRED"})
            if self.instance and blockers is not None:
                self.instance = set_blockers(self.instance, blockers, actor)
                self.validated_data["state"] = self.instance.state
            elif self.instance and desired and self.instance.state and self.instance.state.is_blocked and desired.id != self.instance.state_id and desired.group != "cancelled" and self.instance.issue_relation.filter(relation_type="blocked_by").exists():
                raise serializers.ValidationError({"code": "BLOCKING_ACTIVE"})
            elif blockers is not None:
                project = Project.objects.get(pk=self.context["project_id"])
                self.validated_data["state"] = blocking_states(project)[1]
            instance = super().save(**kwargs)
            if blockers is not None and self.instance is instance and not instance.issue_relation.filter(relation_type="blocked_by").exists() and blockers:
                instance = set_blockers(instance, blockers, actor)
                self.instance = instance
            reconcile_blockers(instance.workspace_id, actor)
            if requirements is not None:
                request = self.context.get("request")
                replace_requirements(instance, requirements, getattr(request, "user", None))
            if requirements is not None or instance.resource_requirements.filter(deleted_at__isnull=True).exists():
                validate_resource_workspace(instance.workspace_id)
            return instance
