from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.project_template import ProjectTemplateSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, Workspace, WorkspaceMember
from plane.utils.project_templates import available_templates, capture_project_template


class ProjectTemplatesEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, template_id=None):
        workspace = get_object_or_404(Workspace, slug=slug)
        templates = available_templates(workspace, request.user)
        if template_id:
            return Response(
                ProjectTemplateSerializer(
                    get_object_or_404(templates, pk=template_id), context={"workspace": workspace}
                ).data
            )
        return Response(ProjectTemplateSerializer(templates, many=True, context={"workspace": workspace}).data)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        serializer = ProjectTemplateSerializer(data=request.data, context={"workspace": workspace})
        serializer.is_valid(raise_exception=True)
        source_id = serializer.validated_data.get("source_project_id")
        if source_id is None:
            raise ValidationError({"source_project_id": "A source project is required."})
        project = get_object_or_404(Project, pk=source_id, workspace=workspace, archived_at__isnull=True)
        template = capture_project_template(
            project,
            request.user,
            serializer.validated_data["name"],
            serializer.validated_data.get("description", ""),
            serializer.validated_data.get("is_shared", False),
        )
        return Response(ProjectTemplateSerializer(template, context={"workspace": workspace}).data, status=201)

    def owned_template(self, request, workspace, template_id):
        template = get_object_or_404(available_templates(workspace, request.user), pk=template_id)
        if (
            template.created_by_id != request.user.id
            and not WorkspaceMember.objects.filter(
                workspace=workspace, member=request.user, is_active=True, role=20
            ).exists()
        ):
            raise PermissionDenied()
        return template

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    @transaction.atomic
    def patch(self, request, slug, template_id):
        if set(request.data) - {"name", "description", "is_shared"}:
            raise ValidationError("Only template metadata can be changed.")
        workspace = get_object_or_404(Workspace, slug=slug)
        template = self.owned_template(request, workspace, template_id)
        serializer = ProjectTemplateSerializer(
            template, data=request.data, partial=True, context={"workspace": workspace}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, template_id):
        workspace = get_object_or_404(Workspace, slug=slug)
        template = self.owned_template(request, workspace, template_id)
        type(template).objects.filter(pk=template.id).delete()
        return Response(status=204)
