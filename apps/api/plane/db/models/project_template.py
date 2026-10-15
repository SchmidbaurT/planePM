from django.db import models

from .base import BaseModel


class ProjectTemplate(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="project_templates")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    source_project_id = models.UUIDField(null=True)
    source_project_name = models.CharField(max_length=255)
    is_shared = models.BooleanField(default=False)
    schema_version = models.PositiveSmallIntegerField(default=1)
    snapshot = models.JSONField(default=dict)

    class Meta:
        db_table = "project_templates"
        ordering = ("name", "id")
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_template_workspace_name_unique",
            )
        ]
