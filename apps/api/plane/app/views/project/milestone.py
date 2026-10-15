from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q, F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import IssueRelation, ProjectMember, ProjectMilestone, Workspace, WorkspaceMember
from plane.utils.portfolio import visible_issues, visible_projects


def milestone_queryset(workspace, user):
    memberships = ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True)
    return ProjectMilestone.objects.filter(
        workspace=workspace,
        project__in=visible_projects(workspace, user),
        project_id__in=memberships.values("project_id"),
    ).exclude(project_id__in=memberships.filter(role=5, project__guest_view_all_features=False).values("project_id"))


def milestone_data(milestone):
    today = timezone.localdate(timezone=ZoneInfo(milestone.project.timezone))
    completed_date = (
        timezone.localtime(milestone.completed_at, ZoneInfo(milestone.project.timezone)).date()
        if milestone.completed_at
        else None
    )
    linked = list(milestone.issues.all())
    return {
        "id": str(milestone.id),
        "project_id": str(milestone.project_id),
        "name": milestone.name,
        "description": milestone.description,
        "target_date": milestone.target_date,
        "original_target_date": milestone.original_target_date,
        "owner_id": str(milestone.owner_id),
        "owner_name": milestone.owner.display_name,
        "completed_at": milestone.completed_at,
        "completed_by": str(milestone.completed_by_id) if milestone.completed_by_id else None,
        "status": "reached" if completed_date else "overdue" if milestone.target_date < today else "open",
        "is_late": bool(completed_date and completed_date > milestone.target_date),
        "issue_ids": [str(item.id) for item in linked],
        "issues": [{"id": str(item.id), "name": item.name} for item in linked],
        "history": milestone.history,
        "updated_at": milestone.updated_at,
    }


class MilestoneInput(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(allow_blank=True, required=False, max_length=20000)
    target_date = serializers.DateField()
    owner_id = serializers.UUIDField()
    issue_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=1000)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    reached = serializers.BooleanField(required=False)
    expected_updated_at = serializers.DateTimeField(required=False)


class ProjectMilestonesEndpoint(BaseAPIView):
    def project_and_role(self, request, slug, project_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        project = get_object_or_404(visible_projects(workspace, request.user), pk=project_id)
        role = (
            ProjectMember.objects.filter(project=project, member=request.user, is_active=True)
            .values_list("role", flat=True)
            .first()
        )
        if role is None or (role == 5 and not project.guest_view_all_features):
            raise PermissionDenied()
        return workspace, project, role

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, project_id, milestone_id=None, work_items=False):
        workspace, project, role = self.project_and_role(request, slug, project_id)
        if work_items:
            search = request.query_params.get("search", "").strip()[:255]
            try:
                offset = max(0, int(request.query_params.get("cursor", "0")))
            except (TypeError, ValueError):
                raise ValidationError("Invalid cursor.")
            query = visible_issues(workspace, request.user).filter(project=project)
            if search:
                match = Q(name__icontains=search)
                sequence = search.removeprefix(f"{project.identifier}-").removeprefix(f"{project.identifier.lower()}-")
                if sequence.isdecimal():
                    match |= Q(sequence_id=int(sequence))
                query = query.filter(match)
            count = query.count()
            items = list(
                query.order_by("sequence_id", "id").values("id", "name", "sequence_id", "state__name", "target_date")[
                    offset : offset + 25
                ]
            )
            for item in items:
                item["identifier"] = f"{project.identifier}-{item['sequence_id']}"
            return Response(
                {"results": items, "count": count, "next_cursor": offset + 25 if offset + 25 < count else None}
            )
        milestones = (
            milestone_queryset(workspace, request.user)
            .filter(project=project)
            .select_related("project", "owner")
            .prefetch_related("issues")
        )
        if milestone_id:
            return Response(milestone_data(get_object_or_404(milestones, pk=milestone_id)))
        return Response([milestone_data(item) for item in milestones])

    def validate_input(self, request, project, partial=False):
        allowed = set(MilestoneInput().fields)
        if set(request.data) - allowed:
            raise ValidationError("Unsupported milestone fields.")
        serializer = MilestoneInput(data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if (
            "owner_id" in data
            and not ProjectMember.objects.filter(
                project=project, member_id=data["owner_id"], member__is_active=True, is_active=True, role__gte=15
            ).exists()
        ):
            raise ValidationError({"owner_id": "An active project member is required."})
        if "issue_ids" in data:
            ids = set(data["issue_ids"])
            if visible_issues(project.workspace, request.user).filter(project=project, id__in=ids).count() != len(ids):
                raise ValidationError({"issue_ids": "Work items must be visible and belong to this project."})
            data["issue_ids"] = sorted(ids, key=str)
        return data

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    @transaction.atomic
    def post(self, request, slug, project_id):
        workspace, project, role = self.project_and_role(request, slug, project_id)
        if role < 15:
            raise PermissionDenied()
        data = self.validate_input(request, project)
        if data.get("reached"):
            raise ValidationError("New milestones must be open.")
        issue_ids = data.pop("issue_ids", [])
        data.pop("reason", None)
        data.pop("reached", None)
        data.pop("expected_updated_at", None)
        milestone = ProjectMilestone.objects.create(
            workspace=workspace,
            project=project,
            original_target_date=data["target_date"],
            history=[
                {
                    "action": "created",
                    "actor_id": str(request.user.id),
                    "actor_name": request.user.display_name,
                    "at": timezone.now().isoformat(),
                }
            ],
            **data,
        )
        milestone.issues.set(issue_ids)
        return Response(milestone_data(milestone), status=201)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    @transaction.atomic
    def patch(self, request, slug, project_id, milestone_id):
        workspace, project, role = self.project_and_role(request, slug, project_id)
        milestone = get_object_or_404(
            ProjectMilestone.objects.select_for_update(), workspace=workspace, project=project, pk=milestone_id
        )
        can_manage = role == 20 or project.project_lead_id == request.user.id
        if role < 15 or (not can_manage and milestone.owner_id != request.user.id):
            raise PermissionDenied()
        data = self.validate_input(request, project, partial=True)
        expected = data.pop("expected_updated_at", None)
        if expected and expected != milestone.updated_at:
            return Response({"code": "MILESTONE_CHANGED"}, status=409)
        reason = data.pop("reason", "").strip()
        reached = data.pop("reached", None)
        changed_date = "target_date" in data and data["target_date"] != milestone.target_date
        reopening = reached is False and milestone.completed_at is not None
        if (changed_date or reopening) and not reason:
            raise ValidationError({"reason": "A reason is required for changing the deadline or reopening."})
        if milestone.completed_at and data and not reopening:
            raise ValidationError("Reopen a reached milestone before editing its plan.")
        changes = {}
        issue_ids = data.pop("issue_ids", None)
        if issue_ids is not None and set(milestone.issues.values_list("id", flat=True)) != set(issue_ids):
            changes["issue_ids"] = {
                "from": [str(value) for value in milestone.issues.values_list("id", flat=True)],
                "to": [str(value) for value in issue_ids],
            }
            milestone.issues.set(issue_ids)
        for field, value in data.items():
            previous = getattr(milestone, field)
            if previous != value:
                changes[field] = {"from": str(previous), "to": str(value)}
                setattr(milestone, field, value)
        if reached is not None and reached != bool(milestone.completed_at):
            milestone.completed_at = timezone.now() if reached else None
            milestone.completed_by = request.user if reached else None
            changes["status"] = {"from": "open" if reached else "reached", "to": "reached" if reached else "open"}
        if changes:
            milestone.history = [
                *milestone.history,
                {
                    "action": "updated",
                    "actor_id": str(request.user.id),
                    "actor_name": request.user.display_name,
                    "at": timezone.now().isoformat(),
                    "reason": reason,
                    "changes": changes,
                },
            ]
            milestone.save()
        return Response(milestone_data(milestone))

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    @transaction.atomic
    def delete(self, request, slug, project_id, milestone_id):
        workspace, project, role = self.project_and_role(request, slug, project_id)
        if role != 20 and project.project_lead_id != request.user.id:
            raise PermissionDenied()
        get_object_or_404(
            ProjectMilestone.objects.select_for_update(), workspace=workspace, project=project, pk=milestone_id
        ).delete()
        return Response(status=204)


class UserWorkPlanEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, user_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        get_object_or_404(WorkspaceMember.objects, workspace=workspace, member_id=user_id, is_active=True)
        today = timezone.localdate(timezone=ZoneInfo(request.user.user_timezone))
        week_end = today + timedelta(days=6 - today.weekday())
        issues = (
            visible_issues(workspace, request.user)
            .filter(assignees__id=user_id)
            .exclude(state__group__in=["completed", "cancelled"])
            .distinct()
        )
        blockers = IssueRelation.objects.filter(
            relation_type="blocked_by",
            related_issue__in=visible_issues(workspace, request.user).exclude(
                state__group__in=["completed", "cancelled"]
            ),
        ).values("issue_id")
        planned_blockers = IssueRelation.objects.filter(
            relation_type="finish_to_start",
            issue__in=visible_issues(workspace, request.user).exclude(state__group__in=["completed", "cancelled"]),
        ).filter(Q(related_issue__start_date__lte=today) | Q(related_issue__state__group="started"))
        sections = {
            "today": issues.filter(target_date__lte=today),
            "week": issues.filter(target_date__gt=today, target_date__lte=week_end),
            "blocked": issues.filter(state__is_blocked=True),
        }
        result = {"as_of_date": today, "week_end": week_end, "sections": {}}
        for key, query in sections.items():
            try:
                offset = max(0, int(request.query_params.get(f"{key}_cursor", 0)))
            except (ValueError, TypeError):
                raise ValidationError("Invalid cursor.")
            count = query.count()
            items = list(
                query.annotate(is_blocked=F("state__is_blocked")).order_by("target_date", "id").values(
                    "id",
                    "name",
                    "project_id",
                    "project__name",
                    "project__identifier",
                    "sequence_id",
                    "target_date",
                    "priority",
                    "parent_id",
                    "state__name",
                    "state_id",
                    "is_blocked",
                )[offset : offset + 25]
            )
            visible_blockers = IssueRelation.objects.filter(
                relation_type="blocked_by",
                issue_id__in=[item["id"] for item in items],
                related_issue__in=visible_issues(workspace, request.user).exclude(
                    state__group__in=["completed", "cancelled"]
                ),
            ).values("issue_id", "related_issue_id", "related_issue__name", "related_issue__project_id")
            for item in items:
                item["blockers"] = [
                    {
                        "id": relation["related_issue_id"],
                        "name": relation["related_issue__name"],
                        "project_id": relation["related_issue__project_id"],
                    }
                    for relation in visible_blockers
                    if relation["issue_id"] == item["id"]
                ]
            scheduled_sources = list(
                planned_blockers.filter(related_issue_id__in=[item["id"] for item in items]).values(
                    "related_issue_id", "issue_id", "issue__name", "issue__project_id"
                )
            )
            for item in items:
                item["blockers"].extend(
                    {
                        "id": relation["issue_id"],
                        "name": relation["issue__name"],
                        "project_id": relation["issue__project_id"],
                    }
                    for relation in scheduled_sources
                    if relation["related_issue_id"] == item["id"]
                )
            result["sections"][key] = {
                "count": count,
                "next_cursor": offset + 25 if offset + 25 < count else None,
                "items": items,
            }
        milestones = (
            milestone_queryset(workspace, request.user)
            .filter(owner_id=user_id, completed_at__isnull=True)
            .select_related("project", "owner")
            .prefetch_related("issues")
        )
        try:
            offset = max(0, int(request.query_params.get("milestones_cursor", 0)))
        except (ValueError, TypeError):
            raise ValidationError("Invalid cursor.")
        count = milestones.count()
        result["sections"]["milestones"] = {
            "count": count,
            "next_cursor": offset + 25 if offset + 25 < count else None,
            "items": [milestone_data(item) for item in milestones[offset : offset + 25]],
        }
        return Response(result)


class BlockingWorkItemsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        search = request.query_params.get("search", "").strip()[:255]
        try:
            offset = max(0, int(request.query_params.get("cursor", 0)))
        except (ValueError, TypeError):
            raise ValidationError("Invalid cursor.")
        query = visible_issues(workspace, request.user).exclude(state__group__in=["completed", "cancelled"])
        if request.query_params.get("exclude"):
            query = query.exclude(pk=request.query_params["exclude"])
        if search:
            match = Q(name__icontains=search)
            prefix, separator, number = search.rpartition("-")
            if separator and number.isdecimal():
                match |= Q(project__identifier__iexact=prefix, sequence_id=int(number))
            elif search.isdecimal():
                match |= Q(sequence_id=int(search))
            query = query.filter(match)
        count = query.count()
        rows = list(query.order_by("project__name", "sequence_id", "id").values("id", "name", "project_id", "project__name", "project__identifier", "sequence_id", "state__name")[offset:offset + 25])
        return Response({"results": rows, "count": count, "next_cursor": offset + 25 if offset + 25 < count else None})
