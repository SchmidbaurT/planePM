# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Module imports
from .base import BaseSerializer
from rest_framework import serializers

from plane.db.models import State, StateGroup


class StateSerializer(BaseSerializer):
    order = serializers.FloatField(required=False)

    class Meta:
        model = State
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "color",
            "group",
            "default",
            "description",
            "sequence",
            "order",
            "is_blocked",
        ]
        read_only_fields = ["workspace", "project", "is_blocked"]

    def validate(self, attrs):
        if self.instance and self.instance.is_blocked and (attrs.get("group", "started") != "started" or attrs.get("default", False) or attrs.get("color", "#D14343") != "#D14343"):
            raise serializers.ValidationError({"code": "BLOCKING_SYSTEM_STATE"})
        if self.instance and self.instance.blocked_release_projects.exists() and attrs.get("group", self.instance.group) != "backlog":
            raise serializers.ValidationError({"code": "BLOCKING_RELEASE_STATE"})
        if attrs.get("group") == StateGroup.TRIAGE.value:
            raise serializers.ValidationError("Cannot create triage state")
        return attrs


class StateLiteSerializer(BaseSerializer):
    class Meta:
        model = State
        fields = ["id", "name", "color", "group", "is_blocked"]
        read_only_fields = fields
