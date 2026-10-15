from rest_framework import serializers

from plane.db.models import ProjectTemplate


class ProjectTemplateSerializer(serializers.ModelSerializer):
    description = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    counts = serializers.SerializerMethodField()
    base_date = serializers.SerializerMethodField()
    project_defaults = serializers.SerializerMethodField()

    class Meta:
        model = ProjectTemplate
        fields = [
            "id",
            "name",
            "description",
            "source_project_id",
            "source_project_name",
            "is_shared",
            "created_by",
            "created_at",
            "counts",
            "base_date",
            "project_defaults",
        ]
        read_only_fields = ["id", "source_project_name", "created_by", "created_at"]

    def validate_name(self, value):
        query = ProjectTemplate.objects.filter(workspace=self.context["workspace"], name=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if query.exists():
            raise serializers.ValidationError("TEMPLATE_NAME_ALREADY_EXISTS")
        return value

    def get_counts(self, instance):
        return {
            key: len(instance.snapshot.get(key, []))
            for key in ("issues", "modules", "cycles", "pages", "requirements", "relations", "milestones")
        }

    def get_base_date(self, instance):
        return instance.snapshot.get("base_date")

    def get_project_defaults(self, instance):
        return {
            key: value
            for key, value in instance.snapshot.get("project", {}).items()
            if key not in {"default_state_id", "estimate_id", "project_lead_id", "default_assignee_id"}
        }
