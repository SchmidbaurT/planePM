from django.shortcuts import get_object_or_404
from django.db.models import F
from rest_framework.response import Response
from rest_framework import serializers

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace
from plane.utils.portfolio import build_portfolio, visible_issues, visible_projects, timeline_relations


class TimelineRelationsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        from uuid import UUID

        try:
            issue_ids = [UUID(value) for value in request.query_params.get("issue_ids", "").split(",") if value]
            project_ids = [UUID(value) for value in request.query_params.get("project_ids", "").split(",") if value]
            offset = int(request.query_params.get("cursor", "0"))
            if len(issue_ids) > 100 or len(project_ids) > 100 or offset < 0:
                raise ValueError()
        except (ValueError, TypeError):
            raise serializers.ValidationError("Invalid timeline relation query.")
        return Response(timeline_relations(workspace, request.user, issue_ids, offset, project_ids))


class PortfolioEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, project_id=None):
        workspace = get_object_or_404(Workspace, slug=slug)
        if project_id:
            project = get_object_or_404(visible_projects(workspace, request.user), id=project_id)
            try:
                offset = max(0, int(request.query_params.get("cursor", "0")))
            except ValueError:
                offset = 0
            issues = visible_issues(workspace, request.user).filter(project=project).annotate(is_blocked=F("state__is_blocked")).order_by("target_date", "id")
            rows = list(
                issues.values("id", "name", "sequence_id", "start_date", "target_date", "state__group", "parent_id", "is_blocked")[
                    offset : offset + 101
                ]
            )
            return Response({"results": rows[:100], "next_cursor": str(offset + 100) if len(rows) > 100 else None})
        return Response(build_portfolio(workspace, request.user, request.query_params))
