from django.conf import settings
from django.db import models

from .base import BaseModel


class ProjectMilestone(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="milestones")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="milestones")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    target_date = models.DateField()
    original_target_date = models.DateField()
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="milestones")
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="confirmed_milestones"
    )
    issues = models.ManyToManyField("db.Issue", blank=True, related_name="milestones")
    history = models.JSONField(default=list)

    class Meta:
        db_table = "project_milestones"
        ordering = ("target_date", "name", "id")
        indexes = [models.Index(fields=["workspace", "owner", "target_date"], name="milestone_owner_date_idx")]
