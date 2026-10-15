from datetime import date, timedelta
from collections import defaultdict

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.resource import (
    ResourceBlackoutSerializer,
    ResourceRequirementsField,
    WorkspaceResourceSerializer,
    replace_requirements,
)
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    Issue,
    IssueResourceRequirement,
    ResourceBlackout,
    Workspace,
    WorkspaceResource,
    WorkspaceUserProperties,
)
from plane.utils.portfolio import visible_issues
from plane.utils.resource_booking import capacity_segments, lock_resource_workspace, validate_resource_workspace


def resource_date_range(params):
    try:
        start = date.fromisoformat(params.get("from", str(timezone.localdate())))
        end = date.fromisoformat(params.get("to", str(start + timedelta(days=13))))
        if end < start or (end - start).days > 365:
            raise ValueError()
        return start, end
    except (ValueError, OverflowError):
        raise serializers.ValidationError("Invalid date range (maximum 366 days).")


def active_resource_requirements(workspace):
    return IssueResourceRequirement.objects.filter(
        workspace=workspace,
        issue__deleted_at__isnull=True,
        issue__archived_at__isnull=True,
        issue__is_draft=False,
        issue__project__archived_at__isnull=True,
        issue__project__deleted_at__isnull=True,
        issue__state__deleted_at__isnull=True,
        issue__state__is_triage=False,
    ).exclude(issue__state__group__in=["completed", "cancelled"])


class ResourceOverviewEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        start, end = resource_date_range(request.query_params)
        resources = list(WorkspaceResource.objects.filter(workspace=workspace))
        requirements = active_resource_requirements(workspace)
        bookings = defaultdict(list)
        for item in requirements.filter(issue__start_date__lte=end, issue__target_date__gte=start).values(
            "resource_id", "issue__start_date", "issue__target_date", "allocation_percent"
        ):
            bookings[item["resource_id"]].append(
                (
                    max(start, item["issue__start_date"]),
                    min(end, item["issue__target_date"]),
                    item["allocation_percent"],
                )
            )
        maintenance = defaultdict(list)
        for blackout in ResourceBlackout.objects.filter(
            workspace=workspace, start_date__lte=end, target_date__gte=start
        ):
            interval = (max(start, blackout.start_date), min(end, blackout.target_date), 100)
            bookings[blackout.resource_id].append(interval)
            maintenance[blackout.resource_id].append(interval)
        pending = defaultdict(int)
        for resource_id in (
            requirements.filter(issue__in=visible_issues(workspace, request.user))
            .filter(Q(issue__start_date__isnull=True) | Q(issue__target_date__isnull=True))
            .values_list("resource_id", flat=True)
        ):
            pending[resource_id] += 1
        dates = [start + timedelta(days=index) for index in range((end - start).days + 1)]
        today = timezone.localdate()
        results = []
        for resource in resources:
            segments = capacity_segments(bookings[resource.id])
            days = []
            for day in dates:
                used = next(
                    (
                        item["allocated_percent"]
                        for item in segments
                        if item["start_date"] <= day <= item["target_date"]
                    ),
                    0,
                )
                days.append(
                    {
                        "date": day,
                        "allocated_percent": used,
                        "maintenance": any(first <= day <= last for first, last, _ in maintenance[resource.id]),
                    }
                )
            results.append(
                {
                    **WorkspaceResourceSerializer(resource).data,
                    "days": days,
                    "today_percent": next((item["allocated_percent"] for item in days if item["date"] == today), None),
                    "average_percent": round(sum(item["allocated_percent"] for item in days) / len(days)),
                    "pending_count": pending[resource.id],
                }
            )
        return Response({"from": start, "to": end, "as_of_date": today, "resources": results})


class WorkspaceResourcesEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, resource_id=None):
        resources = WorkspaceResource.objects.filter(workspace__slug=slug)
        if resource_id:
            resource = get_object_or_404(resources, id=resource_id)
            return Response(WorkspaceResourceSerializer(resource).data)
        return Response(WorkspaceResourceSerializer(resources, many=True).data)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = WorkspaceResourceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(workspace=workspace, created_by=request.user)
        return Response(serializer.data, status=201)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, resource_id):
        with transaction.atomic():
            resource = get_object_or_404(WorkspaceResource, workspace__slug=slug, id=resource_id)
            lock_resource_workspace(resource.workspace_id)
            resource.refresh_from_db()
            serializer = WorkspaceResourceSerializer(resource, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(updated_by=request.user)
            validate_resource_workspace(resource.workspace_id)
        return Response(serializer.data)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, resource_id):
        with transaction.atomic():
            resource = get_object_or_404(WorkspaceResource, workspace__slug=slug, id=resource_id)
            lock_resource_workspace(resource.workspace_id)
            resource.archived_at = timezone.now()
            resource.save(update_fields=["archived_at", "updated_at"])
            validate_resource_workspace(resource.workspace_id)
        return Response(status=204)


class ResourceAvailabilityEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, resource_id):
        resource = get_object_or_404(WorkspaceResource, workspace__slug=slug, id=resource_id)
        try:
            start = date.fromisoformat(request.query_params.get("from", str(timezone.localdate())))
            end = date.fromisoformat(request.query_params.get("to", str(start + timedelta(days=27))))
            if end < start or (end - start).days > 365:
                raise ValueError()
        except (ValueError, OverflowError):
            raise serializers.ValidationError("Invalid date range (maximum 366 days).")
        requirements = IssueResourceRequirement.objects.filter(
            resource=resource,
            issue__deleted_at__isnull=True,
            issue__archived_at__isnull=True,
            issue__is_draft=False,
            issue__project__archived_at__isnull=True,
            issue__project__deleted_at__isnull=True,
            issue__state__deleted_at__isnull=True,
            issue__state__is_triage=False,
            issue__start_date__lte=end,
            issue__target_date__gte=start,
        ).exclude(issue__state__group__in=["completed", "cancelled"])
        requirements = list(requirements.select_related("issue", "issue__project"))
        visible = set(
            visible_issues(resource.workspace, request.user)
            .filter(id__in=[item.issue_id for item in requirements])
            .values_list("id", flat=True)
        )
        blackouts = list(
            ResourceBlackout.objects.filter(resource=resource, start_date__lte=end, target_date__gte=start)
        )
        bookings = [
            (max(start, item.issue.start_date), min(end, item.issue.target_date), item.allocation_percent)
            for item in requirements
        ]
        bookings += [(max(start, item.start_date), min(end, item.target_date), 100) for item in blackouts]
        segments = capacity_segments(bookings)
        days = [
            {"date": start + timedelta(days=index), "allocated_percent": 0} for index in range((end - start).days + 1)
        ]
        for day in days:
            day["allocated_percent"] = next(
                (
                    item["allocated_percent"]
                    for item in segments
                    if item["start_date"] <= day["date"] <= item["target_date"]
                ),
                0,
            )
        tasks = []
        private_bookings = []
        for item in requirements:
            task = {
                "start_date": item.issue.start_date,
                "target_date": item.issue.target_date,
                "allocation_percent": item.allocation_percent,
            }
            if item.issue_id in visible:
                task.update(
                    issue_id=item.issue_id,
                    project_id=item.issue.project_id,
                    name=item.issue.name,
                    identifier=f"{item.issue.project.identifier}-{item.issue.sequence_id}",
                )
                tasks.append(task)
            else:
                private_bookings.append((item.issue.start_date, item.issue.target_date, item.allocation_percent))
        tasks.extend(
            {
                "start_date": item["start_date"],
                "target_date": item["target_date"],
                "allocation_percent": item["allocated_percent"],
            }
            for item in capacity_segments(private_bookings)
        )
        return Response(
            {"days": days, "bookings": tasks, "blackouts": ResourceBlackoutSerializer(blackouts, many=True).data}
        )


class ResourceBlackoutsEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, resource_id):
        resource = get_object_or_404(WorkspaceResource, workspace__slug=slug, id=resource_id)
        return Response(ResourceBlackoutSerializer(ResourceBlackout.objects.filter(resource=resource), many=True).data)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, resource_id):
        with transaction.atomic():
            resource = get_object_or_404(
                WorkspaceResource, workspace__slug=slug, id=resource_id, archived_at__isnull=True
            )
            lock_resource_workspace(resource.workspace_id)
            serializer = ResourceBlackoutSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(resource=resource, workspace_id=resource.workspace_id, created_by=request.user)
            validate_resource_workspace(resource.workspace_id)
        return Response(serializer.data, status=201)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, resource_id, blackout_id):
        with transaction.atomic():
            blackout = get_object_or_404(
                ResourceBlackout, id=blackout_id, resource_id=resource_id, workspace__slug=slug
            )
            lock_resource_workspace(blackout.workspace_id)
            blackout.refresh_from_db()
            serializer = ResourceBlackoutSerializer(blackout, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(updated_by=request.user)
            validate_resource_workspace(blackout.workspace_id)
        return Response(serializer.data)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, resource_id, blackout_id):
        with transaction.atomic():
            blackout = get_object_or_404(
                ResourceBlackout, id=blackout_id, resource_id=resource_id, workspace__slug=slug
            )
            lock_resource_workspace(blackout.workspace_id)
            ResourceBlackout.objects.filter(pk=blackout.pk).delete()
        return Response(status=204)


class IssueResourcesEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        issue = get_object_or_404(visible_issues(workspace, request.user), pk=issue_id, project_id=project_id)
        return Response(ResourceRequirementsField().to_representation(issue.resource_requirements))

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id):
        requirements = ResourceRequirementsField().run_validation(request.data.get("resource_requirements"))
        with transaction.atomic():
            workspace = get_object_or_404(Workspace, slug=slug)
            lock_resource_workspace(workspace.id)
            issue = get_object_or_404(
                Issue.objects.select_for_update(), workspace=workspace, project_id=project_id, id=issue_id
            )
            replace_requirements(issue, requirements, request.user)
            validate_resource_workspace(workspace.id)
        return Response(ResourceRequirementsField().to_representation(issue.resource_requirements))


class ProjectOverviewPreferencesEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        preferences, _ = WorkspaceUserProperties.objects.get_or_create(workspace=workspace, user=request.user)
        return Response(preferences.project_overview_preferences)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug):
        data = request.data
        choices = {
            "default_layout": {"list", "dashboard", "timeline"},
            "gantt_zoom": {"week", "month", "quarter"},
            "enabled_widgets": {"metrics", "timeline", "projects", "dependencies", "people", "resources"},
            "widget_order": {"metrics", "timeline", "projects", "dependencies", "people", "resources"},
            "columns": {"period", "progress", "overdue", "dependencies", "resources", "quality", "lead"},
            "sort": {"name", "-name", "overdue", "progress"},
        }
        if not isinstance(data, dict) or set(data) - {*choices, "schema_version", "filters"}:
            raise serializers.ValidationError("Invalid project preferences.")
        for key, allowed in choices.items():
            if key not in data:
                continue
            values = data[key] if key in {"enabled_widgets", "widget_order", "columns"} else [data[key]]
            if (
                not isinstance(values, list)
                or any(not isinstance(value, str) or value not in allowed for value in values)
                or len(set(values)) != len(values)
            ):
                raise serializers.ValidationError({key: "Invalid choice."})
        filters = data.get("filters", {})
        if (
            not isinstance(filters, dict)
            or set(filters) - {"search", "project_ids", "lead_id", "risk", "resource_id", "from", "to"}
            or any(not isinstance(value, str) for value in filters.values())
            or len(str(filters)) > 24576
        ):
            raise serializers.ValidationError("Invalid project filters.")
        with transaction.atomic():
            workspace = get_object_or_404(Workspace, slug=slug)
            preferences, _ = WorkspaceUserProperties.objects.get_or_create(workspace=workspace, user=request.user)
            preferences = WorkspaceUserProperties.objects.select_for_update().get(pk=preferences.pk)
            preferences.project_overview_preferences = {
                **preferences.project_overview_preferences,
                **data,
                "schema_version": 1,
            }
            preferences.save(update_fields=["project_overview_preferences", "updated_at"])
        return Response(preferences.project_overview_preferences)
