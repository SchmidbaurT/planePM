from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from .base import BaseModel
from .project import ProjectBaseModel


class WorkspaceResource(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="resources")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    category = models.CharField(max_length=100, blank=True, default="")
    location = models.CharField(max_length=255, blank=True, default="")
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "workspace_resources"
        ordering = ("name", "id")
        constraints = [
            models.UniqueConstraint(
                Lower("name"), "workspace", condition=Q(deleted_at__isnull=True), name="resource_workspace_name_unique"
            )
        ]


class IssueResourceRequirement(ProjectBaseModel):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="resource_requirements")
    resource = models.ForeignKey(WorkspaceResource, on_delete=models.RESTRICT, related_name="requirements")
    allocation_percent = models.PositiveSmallIntegerField(default=100)

    class Meta:
        db_table = "issue_resource_requirements"
        constraints = [
            models.CheckConstraint(
                condition=Q(allocation_percent__gte=1, allocation_percent__lte=100), name="resource_percent_range"
            ),
            models.UniqueConstraint(
                fields=["issue", "resource"], condition=Q(deleted_at__isnull=True), name="issue_resource_unique"
            ),
        ]


class ResourceBlackout(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="resource_blackouts")
    resource = models.ForeignKey(WorkspaceResource, on_delete=models.RESTRICT, related_name="blackouts")
    start_date = models.DateField()
    target_date = models.DateField()
    reason = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "resource_blackouts"
        ordering = ("start_date", "id")
        constraints = [
            models.CheckConstraint(condition=Q(start_date__lte=models.F("target_date")), name="resource_blackout_dates")
        ]
