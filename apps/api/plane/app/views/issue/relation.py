# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json
from uuid import UUID

# Django imports
from django.utils import timezone
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.db.models import Q, OuterRef, F, Func, UUIDField, Value, CharField, Subquery
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models.functions import Coalesce
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import ValidationError

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueRelationSerializer, RelatedIssueSerializer
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import (
    Project,
    IssueRelation,
    Issue,
    FileAsset,
    IssueLink,
    CycleIssue,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.issue_relation_mapper import get_actual_relation
from plane.utils.host import base_host
from plane.utils.portfolio import visible_issues


class IssueRelationViewSet(BaseViewSet):
    serializer_class = IssueRelationSerializer
    model = IssueRelation
    permission_classes = [ProjectEntityPermission]

    def list(self, request, slug, project_id, issue_id):
        project = get_object_or_404(Project, pk=project_id, workspace__slug=slug)
        visible = visible_issues(project.workspace, request.user)
        get_object_or_404(visible, pk=issue_id, project=project)
        issue_relations = (
            IssueRelation.objects.filter(Q(issue_id=issue_id) | Q(related_issue=issue_id))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("project")
            .select_related("workspace")
            .select_related("issue")
            .order_by("-created_at")
            .distinct()
        )
        # get all blocking issues
        blocking_issues = issue_relations.filter(relation_type="blocked_by", related_issue_id=issue_id).values_list(
            "issue_id", flat=True
        )

        # get all blocked by issues
        blocked_by_issues = issue_relations.filter(relation_type="blocked_by", issue_id=issue_id).values_list(
            "related_issue_id", flat=True
        )

        # get all duplicate issues
        duplicate_issues = issue_relations.filter(issue_id=issue_id, relation_type="duplicate").values_list(
            "related_issue_id", flat=True
        )

        # get all relates to issues
        duplicate_issues_related = issue_relations.filter(
            related_issue_id=issue_id, relation_type="duplicate"
        ).values_list("issue_id", flat=True)

        # get all relates to issues
        relates_to_issues = issue_relations.filter(issue_id=issue_id, relation_type="relates_to").values_list(
            "related_issue_id", flat=True
        )

        # get all relates to issues
        relates_to_issues_related = issue_relations.filter(
            related_issue_id=issue_id, relation_type="relates_to"
        ).values_list("issue_id", flat=True)

        # get all start after issues
        start_after_issues = issue_relations.filter(
            relation_type="start_before", related_issue_id=issue_id
        ).values_list("issue_id", flat=True)

        # get all start_before issues
        start_before_issues = issue_relations.filter(relation_type="start_before", issue_id=issue_id).values_list(
            "related_issue_id", flat=True
        )

        # get all finish after issues
        finish_after_issues = issue_relations.filter(
            relation_type="finish_before", related_issue_id=issue_id
        ).values_list("issue_id", flat=True)

        # get all finish before issues
        finish_before_issues = issue_relations.filter(relation_type="finish_before", issue_id=issue_id).values_list(
            "related_issue_id", flat=True
        )

        queryset = (
            visible.filter(workspace__slug=slug)
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module")
            .annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & (Q(label_issue__deleted_at__isnull=True))),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
        ).distinct()

        # Fields
        fields = [
            "id",
            "name",
            "state_id",
            "sort_order",
            "priority",
            "sequence_id",
            "project_id",
            "label_ids",
            "assignee_ids",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "relation_type",
        ]

        response_data = {
            "finish_to_start": queryset.filter(
                pk__in=issue_relations.filter(issue_id=issue_id, relation_type="finish_to_start").values(
                    "related_issue_id"
                )
            )
            .annotate(relation_type=Value("finish_to_start", output_field=CharField()))
            .values(*fields),
            "start_after_finish": queryset.filter(
                pk__in=issue_relations.filter(related_issue_id=issue_id, relation_type="finish_to_start").values(
                    "issue_id"
                )
            )
            .annotate(relation_type=Value("start_after_finish", output_field=CharField()))
            .values(*fields),
            "blocking": queryset.filter(pk__in=blocking_issues)
            .annotate(relation_type=Value("blocking", output_field=CharField()))
            .values(*fields),
            "blocked_by": queryset.filter(pk__in=blocked_by_issues)
            .annotate(relation_type=Value("blocked_by", output_field=CharField()))
            .values(*fields),
            "duplicate": queryset.filter(pk__in=duplicate_issues)
            .annotate(relation_type=Value("duplicate", output_field=CharField()))
            .values(*fields)
            | queryset.filter(pk__in=duplicate_issues_related)
            .annotate(relation_type=Value("duplicate", output_field=CharField()))
            .values(*fields),
            "relates_to": queryset.filter(pk__in=relates_to_issues)
            .annotate(relation_type=Value("relates_to", output_field=CharField()))
            .values(*fields)
            | queryset.filter(pk__in=relates_to_issues_related)
            .annotate(relation_type=Value("relates_to", output_field=CharField()))
            .values(*fields),
            "start_after": queryset.filter(pk__in=start_after_issues)
            .annotate(relation_type=Value("start_after", output_field=CharField()))
            .values(*fields),
            "start_before": queryset.filter(pk__in=start_before_issues)
            .annotate(relation_type=Value("start_before", output_field=CharField()))
            .values(*fields),
            "finish_after": queryset.filter(pk__in=finish_after_issues)
            .annotate(relation_type=Value("finish_after", output_field=CharField()))
            .values(*fields),
            "finish_before": queryset.filter(pk__in=finish_before_issues)
            .annotate(relation_type=Value("finish_before", output_field=CharField()))
            .values(*fields),
        }

        return Response(response_data, status=status.HTTP_200_OK)

    @transaction.atomic
    def create(self, request, slug, project_id, issue_id):
        relation_type = request.data.get("relation_type", None)
        if relation_type is None:
            return Response(
                {"message": "Issue relation type is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        project = Project.objects.get(pk=project_id)
        from plane.utils.resource_booking import lock_resource_workspace
        lock_resource_workspace(project.workspace_id)
        from plane.db.models import Workspace

        Workspace.objects.select_for_update().get(pk=project.workspace_id)
        allowed = {
            "blocked_by",
            "blocking",
            "finish_to_start",
            "start_after_finish",
            "start_before",
            "start_after",
            "finish_before",
            "finish_after",
            "relates_to",
            "duplicate",
            "implemented_by",
            "implements",
        }
        if relation_type not in allowed:
            raise ValidationError({"code": "INVALID_RELATION"})
        values = request.data.get("issues", [])
        try:
            if not isinstance(values, list) or not 1 <= len(values) <= 100:
                raise ValueError()
            issues = sorted({UUID(str(value)) for value in values}, key=str)
        except (TypeError, ValueError):
            raise ValidationError({"code": "INVALID_RELATION"})
        visible = visible_issues(project.workspace, request.user)
        get_object_or_404(visible, pk=issue_id, project=project)
        if visible.filter(pk__in=issues).count() != len(issues):
            raise ValidationError({"code": "RELATION_UNAVAILABLE"})
        if UUID(str(issue_id)) in issues:
            raise ValidationError({"code": "RELATION_SELF"})
        if relation_type in ("blocked_by", "blocking"):
            from plane.utils.issue_blocking import set_blockers
            if relation_type == "blocked_by":
                target = get_object_or_404(visible, pk=issue_id, project=project)
                current = set(IssueRelation.objects.filter(issue=target, relation_type="blocked_by").values_list("related_issue_id", flat=True))
                set_blockers(target, current | set(issues), request.user)
                return Response(IssueRelationSerializer(IssueRelation.objects.filter(issue=target, related_issue_id__in=issues, relation_type="blocked_by"), many=True).data, status=201)
            for target in visible.filter(pk__in=issues):
                current = set(IssueRelation.objects.filter(issue=target, relation_type="blocked_by").values_list("related_issue_id", flat=True))
                set_blockers(target, current | {UUID(str(issue_id))}, request.user)
            return Response(RelatedIssueSerializer(IssueRelation.objects.filter(related_issue_id=issue_id, issue_id__in=issues, relation_type="blocked_by"), many=True).data, status=201)
        reverse = relation_type in ["blocking", "start_after", "finish_after", "start_after_finish", "implements"]
        actual = get_actual_relation(relation_type)
        directed = {"blocked_by", "finish_to_start", "start_before", "finish_before"}
        adjacency = {}
        for edge in IssueRelation.objects.filter(workspace=project.workspace, relation_type__in=directed).values(
            "issue_id", "related_issue_id", "relation_type"
        ):
            source, target = (
                (edge["related_issue_id"], edge["issue_id"])
                if edge["relation_type"] == "blocked_by"
                else (edge["issue_id"], edge["related_issue_id"])
            )
            adjacency.setdefault(source, set()).add(target)
        for other in issues:
            left, right = (other, UUID(str(issue_id))) if reverse else (UUID(str(issue_id)), other)
            existing = IssueRelation.objects.filter(
                workspace=project.workspace, issue_id=left, related_issue_id=right, relation_type=actual
            ).first()
            if existing:
                continue
            if actual in directed:
                source, target = (right, left) if actual == "blocked_by" else (left, right)
                pending, visited = [target], set()
                while pending:
                    current = pending.pop()
                    if current == source:
                        raise ValidationError({"code": "RELATION_CYCLE"})
                    if current not in visited:
                        visited.add(current)
                        pending.extend(adjacency.get(current, ()))
                adjacency.setdefault(source, set()).add(target)

        issue_relation = IssueRelation.objects.bulk_create(
            [
                IssueRelation(
                    issue_id=(issue if reverse else issue_id),
                    related_issue_id=(issue_id if reverse else issue),
                    relation_type=(get_actual_relation(relation_type)),
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                    created_by=request.user,
                    updated_by=request.user,
                )
                for issue in issues
            ],
            batch_size=10,
            ignore_conflicts=True,
        )

        transaction.on_commit(
            lambda: issue_activity.delay(
                type="issue_relation.activity.created",
                requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
        )

        if reverse:
            return Response(
                RelatedIssueSerializer(issue_relation, many=True).data,
                status=status.HTTP_201_CREATED,
            )
        else:
            return Response(
                IssueRelationSerializer(issue_relation, many=True).data,
                status=status.HTTP_201_CREATED,
            )

    @transaction.atomic
    def remove_relation(self, request, slug, project_id, issue_id):
        related_issue = request.data.get("related_issue", None)
        project = get_object_or_404(Project, pk=project_id, workspace__slug=slug)
        from plane.utils.resource_booking import lock_resource_workspace
        lock_resource_workspace(project.workspace_id)
        visible = visible_issues(project.workspace, request.user)
        get_object_or_404(visible, pk=issue_id, project=project)
        get_object_or_404(visible, pk=related_issue)

        issue_relations = IssueRelation.objects.filter(
            workspace__slug=slug,
        ).filter(
            Q(issue_id=related_issue, related_issue_id=issue_id) | Q(issue_id=issue_id, related_issue_id=related_issue)
        )
        relation_type = request.data.get("relation_type")
        if relation_type:
            reverse = relation_type in ("blocking", "start_after", "finish_after", "start_after_finish", "implements")
            issue_relations = issue_relations.filter(relation_type=get_actual_relation(relation_type), issue_id=related_issue if reverse else issue_id, related_issue_id=issue_id if reverse else related_issue)
        issue_relations = get_object_or_404(issue_relations)
        if issue_relations.relation_type == "blocked_by":
            from plane.utils.issue_blocking import set_blockers
            target = issue_relations.issue
            remaining = list(IssueRelation.objects.filter(issue=target, relation_type="blocked_by").exclude(pk=issue_relations.pk).values_list("related_issue_id", flat=True))
            set_blockers(target, remaining, request.user)
            return Response(status=204)
        current_instance = json.dumps(IssueRelationSerializer(issue_relations).data, cls=DjangoJSONEncoder)
        issue_relations.delete()
        transaction.on_commit(
            lambda: issue_activity.delay(
                type="issue_relation.activity.deleted",
                requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
