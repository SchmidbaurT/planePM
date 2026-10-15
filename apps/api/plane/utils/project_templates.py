import json
from datetime import date, datetime, timedelta
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import (
    Cycle,
    CycleIssue,
    Estimate,
    EstimatePoint,
    Issue,
    IssueAssignee,
    IssueLabel,
    IssueRelation,
    IssueResourceRequirement,
    Label,
    Module,
    ModuleIssue,
    ModuleMember,
    Page,
    PageLabel,
    Project,
    ProjectIdentifier,
    ProjectMember,
    ProjectPage,
    ProjectTemplate,
    ProjectMilestone,
    State,
    WorkspaceMember,
    IssueSequence,
    IssueLink,
    WorkspaceResource,
    IssueType,
)
from plane.db.models.issue_type import ProjectIssueType
from plane.utils.resource_booking import lock_resource_workspace, validate_resource_workspace
from plane.utils.html_processor import strip_tags


PROJECT_FIELDS = [
    "description",
    "description_text",
    "description_html",
    "network",
    "module_view",
    "cycle_view",
    "issue_views_view",
    "page_view",
    "intake_view",
    "guest_view_all_features",
    "archive_in",
    "close_in",
    "timezone",
    "logo_props",
    "default_state_id",
    "estimate_id",
    "project_lead_id",
    "default_assignee_id",
    "is_issue_type_enabled",
    "is_time_tracking_enabled",
]
SNAPSHOT_FIELDS = {
    "states": ["id", "name", "description", "color", "slug", "sequence", "group", "default"],
    "labels": ["id", "name", "description", "color", "sort_order", "parent_id"],
    "estimates": ["id", "name", "description", "type", "last_used"],
    "estimate_points": ["id", "estimate_id", "key", "description", "value"],
    "issues": [
        "id",
        "name",
        "description_json",
        "description_html",
        "parent_id",
        "state_id",
        "point",
        "estimate_point_id",
        "type_id",
        "priority",
        "start_date",
        "target_date",
        "sort_order",
        "sequence_id",
    ],
    "modules": [
        "id",
        "name",
        "description",
        "description_text",
        "description_html",
        "start_date",
        "target_date",
        "lead_id",
        "sort_order",
        "logo_props",
    ],
    "cycles": [
        "id",
        "name",
        "description",
        "start_date",
        "end_date",
        "owned_by_id",
        "sort_order",
        "timezone",
        "logo_props",
    ],
    "pages": [
        "id",
        "name",
        "description_json",
        "description_html",
        "parent_id",
        "access",
        "color",
        "logo_props",
        "view_props",
        "sort_order",
    ],
}


def _rows(queryset, fields):
    return list(queryset.order_by("id").select_for_update(of=("self",)).values(*fields))


def _clean_json(value):
    if isinstance(value, dict):
        if value.get("type") in {"image", "file", "video", "imageBlock", "fileBlock", "videoBlock"}:
            return None
        result = {key: _clean_json(item) for key, item in value.items()}
        if isinstance(result.get("attrs"), dict) and "checked" in result["attrs"]:
            result["attrs"]["checked"] = False
        return result
    if isinstance(value, list):
        return [result for item in value if (result := _clean_json(item)) is not None]
    return value


def _clean_html(value):
    if not isinstance(value, str):
        return value
    soup = BeautifulSoup(value, "html.parser")
    for element in soup.find_all(
        ["img", "video", "audio", "iframe", "object", "embed", "file-component", "image-component", "video-component"]
    ):
        element.decompose()
    for element in soup.select("[data-checked]"):
        element["data-checked"] = "false"
    for element in soup.select('input[type="checkbox"][checked]'):
        del element["checked"]
    return str(soup)


def available_templates(workspace, user):
    role = (
        WorkspaceMember.objects.filter(workspace=workspace, member=user, is_active=True)
        .values_list("role", flat=True)
        .first()
    )
    if role not in (15, 20):
        raise PermissionDenied()
    templates = ProjectTemplate.objects.filter(workspace=workspace)
    return templates.filter(Q(created_by=user) | Q(is_shared=True))


@transaction.atomic
def capture_project_template(project, user, name, description="", is_shared=False):
    if (
        not WorkspaceMember.objects.filter(
            workspace_id=project.workspace_id, member=user, is_active=True, role__gte=15
        ).exists()
        or not ProjectMember.objects.filter(project=project, member=user, is_active=True, role=20).exists()
    ):
        raise PermissionDenied()
    lock_resource_workspace(project.workspace_id)
    project = Project.objects.select_for_update().get(pk=project.id, archived_at__isnull=True)
    issues = Issue.issue_objects.filter(project=project)
    if issues.count() > 5000:
        raise ValidationError("A template supports at most 5000 work items.")
    pages = Page.objects.filter(
        pk__in=project.pages.values("id"),
        archived_at__isnull=True,
        project_pages__project=project,
        project_pages__deleted_at__isnull=True,
    ).filter(Q(access=Page.PUBLIC_ACCESS) | Q(owned_by=user))
    page_ids = list(pages.values_list("id", flat=True))
    snapshot = {
        "project": {field: getattr(project, field) for field in PROJECT_FIELDS},
        "states": _rows(State.objects.filter(project=project, is_triage=False), SNAPSHOT_FIELDS["states"]),
        "labels": _rows(Label.objects.filter(project=project), SNAPSHOT_FIELDS["labels"]),
        "estimates": _rows(Estimate.objects.filter(project=project), SNAPSHOT_FIELDS["estimates"]),
        "estimate_points": _rows(EstimatePoint.objects.filter(project=project), SNAPSHOT_FIELDS["estimate_points"]),
        "issues": _rows(issues, SNAPSHOT_FIELDS["issues"]),
        "modules": _rows(Module.objects.filter(project=project, archived_at__isnull=True), SNAPSHOT_FIELDS["modules"]),
        "cycles": _rows(Cycle.objects.filter(project=project, archived_at__isnull=True), SNAPSHOT_FIELDS["cycles"]),
        "pages": _rows(Page.objects.filter(pk__in=page_ids), SNAPSHOT_FIELDS["pages"]),
        "milestones": [
            {
                "id": str(item.id),
                "name": item.name,
                "description": item.description,
                "target_date": item.target_date,
                "owner_id": str(item.owner_id),
                "issue_ids": [
                    str(value) for value in item.issues.filter(id__in=issues.values("id")).values_list("id", flat=True)
                ],
            }
            for item in ProjectMilestone.objects.filter(project=project).prefetch_related("issues")
        ],
        "assignees": list(IssueAssignee.objects.filter(issue__in=issues).values("issue_id", "assignee_id")),
        "issue_labels": list(IssueLabel.objects.filter(issue__in=issues).values("issue_id", "label_id")),
        "module_issues": list(
            ModuleIssue.objects.filter(
                module__project=project, module__archived_at__isnull=True, issue__in=issues
            ).values("module_id", "issue_id")
        ),
        "cycle_issues": list(
            CycleIssue.objects.filter(cycle__project=project, cycle__archived_at__isnull=True, issue__in=issues).values(
                "cycle_id", "issue_id"
            )
        ),
        "module_members": list(
            ModuleMember.objects.filter(module__project=project, module__archived_at__isnull=True).values(
                "module_id", "member_id"
            )
        ),
        "relations": list(
            IssueRelation.objects.filter(issue__in=issues, related_issue__in=issues).values(
                "issue_id", "related_issue_id", "relation_type"
            )
        ),
        "requirements": list(
            IssueResourceRequirement.objects.filter(issue__in=issues).values(
                "issue_id", "resource_id", "allocation_percent"
            )
        ),
        "page_labels": list(PageLabel.objects.filter(page_id__in=page_ids).values("page_id", "label_id")),
        "issue_types": list(
            ProjectIssueType.objects.filter(project=project).values("issue_type_id", "level", "is_default")
        ),
        "links": list(IssueLink.objects.filter(issue__in=issues).values("issue_id", "title", "url", "metadata")),
    }
    for key in ("issues", "modules", "pages"):
        for item in snapshot[key]:
            for field in ("description_json", "description_text"):
                if field in item:
                    item[field] = _clean_json(item[field])
            if "description_html" in item:
                item["description_html"] = _clean_html(item["description_html"])
    snapshot["project"]["description_html"] = _clean_html(snapshot["project"]["description_html"])
    snapshot = json.loads(json.dumps(snapshot, cls=DjangoJSONEncoder))
    calendar_starts = [
        str(item["start_date"]) for item in snapshot["issues"] + snapshot["modules"] if item["start_date"]
    ]
    calendar_starts.extend(
        str(datetime.fromisoformat(item["start_date"]).astimezone(ZoneInfo(item["timezone"])).date())
        for item in snapshot["cycles"]
        if item["start_date"]
    )
    calendar_ends = [
        str(item["target_date"]) for item in snapshot["issues"] + snapshot["modules"] if item["target_date"]
    ]
    calendar_ends.extend(
        str(datetime.fromisoformat(item["end_date"]).astimezone(ZoneInfo(item["timezone"])).date())
        for item in snapshot["cycles"]
        if item["end_date"]
    )
    calendar_ends.extend(item["target_date"] for item in snapshot["milestones"])
    snapshot["base_date"] = min(calendar_starts or calendar_ends) if calendar_starts or calendar_ends else None
    if len(json.dumps(snapshot).encode()) > 10 * 1024 * 1024:
        raise ValidationError("Template content exceeds 10 MB.")
    template = ProjectTemplate(
        workspace_id=project.workspace_id,
        name=name.strip(),
        description=description,
        source_project_id=project.id,
        source_project_name=project.name,
        is_shared=is_shared,
        snapshot=snapshot,
    )
    template.save(created_by_id=user.id)
    return template


def _remap_content(value, id_map):
    if isinstance(value, dict):
        return {key: _remap_content(item, id_map) for key, item in value.items()}
    if isinstance(value, list):
        return [_remap_content(item, id_map) for item in value]
    if isinstance(value, str):
        if value in id_map:
            return str(id_map[value])
        if value.startswith(("https://", "http://", "/")):
            parts = urlsplit(value)
            path = "/".join(str(id_map.get(segment, segment)) for segment in parts.path.split("/"))
            return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))
    return value


def _remap_html(value, id_map):
    if not isinstance(value, str):
        return _remap_content(value, id_map)
    soup = BeautifulSoup(value, "html.parser")
    for element in soup.find_all(True):
        for attribute, content in list(element.attrs.items()):
            element[attribute] = _remap_content(content, id_map)
    return str(soup)


@transaction.atomic
def instantiate_project_template(
    template, user, project_data, start_date, copy_assignees=False, milestone_owner_id=None
):
    if not available_templates(template.workspace, user).filter(id=template.id).exists():
        raise PermissionDenied()
    if template.schema_version != 1:
        raise ValidationError({"template_id": "Unsupported template version."})
    lock_resource_workspace(template.workspace_id)
    snapshot = template.snapshot
    milestone_owner_id = milestone_owner_id or user.id
    if (
        snapshot.get("milestones")
        and not WorkspaceMember.objects.filter(
            workspace_id=template.workspace_id,
            member_id=milestone_owner_id,
            is_active=True,
            member__is_active=True,
            role__gte=15,
        ).exists()
    ):
        raise ValidationError({"template_milestone_owner_id": "An active workspace member is required."})
    if snapshot["base_date"] and start_date is None:
        raise ValidationError({"template_start_date": "A new start date is required."})
    offset = (
        (start_date - date.fromisoformat(snapshot["base_date"]))
        if start_date and snapshot["base_date"]
        else timedelta()
    )
    resource_ids = {item["resource_id"] for item in snapshot["requirements"]}
    if WorkspaceResource.objects.filter(
        workspace_id=template.workspace_id, id__in=resource_ids, archived_at__isnull=True
    ).count() != len(resource_ids):
        raise ValidationError({"template_id": "A template resource is no longer available."})
    type_ids = {item["type_id"] for item in snapshot["issues"] if item["type_id"]} | {
        item["issue_type_id"] for item in snapshot["issue_types"]
    }
    if IssueType.objects.filter(workspace_id=template.workspace_id, id__in=type_ids, is_active=True).count() != len(
        type_ids
    ):
        raise ValidationError({"template_id": "A template work item type is no longer available."})
    person_ids = {item["assignee_id"] for item in snapshot["assignees"]} | {
        item["member_id"] for item in snapshot["module_members"]
    }
    person_ids.update(item["lead_id"] for item in snapshot["modules"] if item["lead_id"])
    person_ids.update(item["owned_by_id"] for item in snapshot["cycles"])
    person_ids.update(item["owner_id"] for item in snapshot.get("milestones", []))
    person_ids.update(
        snapshot["project"][key] for key in ("project_lead_id", "default_assignee_id") if snapshot["project"][key]
    )
    active_people = (
        set(
            str(value)
            for value in WorkspaceMember.objects.filter(
                workspace_id=template.workspace_id,
                member_id__in=person_ids,
                is_active=True,
                member__is_active=True,
                role__gte=15,
            ).values_list("member_id", flat=True)
        )
        if copy_assignees
        else set()
    )
    fields = {
        key: value
        for key, value in snapshot["project"].items()
        if key not in {"default_state_id", "estimate_id", "project_lead_id", "default_assignee_id"}
    }
    for key in ("project_lead_id", "default_assignee_id"):
        if snapshot["project"][key] in active_people and key.removesuffix("_id") not in project_data:
            fields[key] = snapshot["project"][key]
    project = Project(**{**fields, **project_data})
    project.workspace_id = template.workspace_id
    project.save(force_insert=True, created_by_id=user.id)
    ProjectIdentifier.objects.create(project=project, workspace_id=project.workspace_id, name=project.identifier)
    id_map = {item["id"]: uuid4() for key in SNAPSHOT_FIELDS for item in snapshot[key]}
    id_map.update({item["id"]: uuid4() for item in snapshot.get("milestones", [])})
    id_map[str(template.source_project_id)] = project.id
    audit = {"workspace_id": project.workspace_id, "created_by_id": user.id, "updated_by_id": user.id}
    project_audit = {**audit, "project_id": project.id}

    def shifted(value, calendar_timezone=None):
        if value is None:
            return None
        try:
            parsed = datetime.fromisoformat(value) if "T" in value else date.fromisoformat(value)
            if isinstance(parsed, datetime):
                parsed = parsed.astimezone(ZoneInfo(calendar_timezone or project.timezone))
            return parsed + offset
        except (ValueError, OverflowError):
            raise ValidationError({"template_start_date": "The shifted template dates are invalid."})

    def clone_section(key, model):
        instances = []
        for item in snapshot[key]:
            values = {**item, "id": id_map[item["id"]]}
            for field in ("parent_id", "estimate_id"):
                if field in values:
                    values[field] = id_map.get(values[field])
            for field in ("start_date", "target_date", "end_date"):
                if field in values:
                    values[field] = shifted(values[field], values.get("timezone"))
            for field in ("description_json", "description_text"):
                if field in values:
                    values[field] = _remap_content(values[field], id_map)
            if "description_html" in values:
                values["description_html"] = _remap_html(values["description_html"], id_map)
            if key == "modules":
                values.update(
                    status="planned", lead_id=values["lead_id"] if values["lead_id"] in active_people else None
                )
            if key == "cycles":
                values["owned_by_id"] = values["owned_by_id"] if values["owned_by_id"] in active_people else user.id
            if key == "pages":
                values.update(
                    owned_by=user, description_binary=None, description_stripped=strip_tags(values["description_html"])
                )
            instances.append(model(**values, **(audit if key == "pages" else project_audit)))
        model.objects.bulk_create(instances, batch_size=500)
        return instances

    states = clone_section("states", State)
    open_states = [
        state for state in sorted(states, key=lambda state: state.sequence) if state.group in ("backlog", "unstarted")
    ]
    if not open_states:
        raise ValidationError({"template_id": "The template needs a backlog or unstarted state."})
    initial_state = next((state for state in open_states if state.default), open_states[0])
    State.objects.filter(project=project).update(default=False)
    State.objects.filter(pk=initial_state.id).update(default=True)
    clone_section("labels", Label)
    clone_section("estimates", Estimate)
    clone_section("estimate_points", EstimatePoint)
    clone_section("modules", Module)
    clone_section("cycles", Cycle)
    pages = clone_section("pages", Page)
    project.default_state_id = initial_state.id
    project.estimate_id = id_map.get(snapshot["project"]["estimate_id"])
    project.description_html = _remap_html(project.description_html, id_map)
    project.description_text = _remap_content(project.description_text, id_map)
    project.save(
        update_fields=["default_state", "estimate", "description_html", "description_text", "updated_at"],
        created_by_id=user.id,
    )
    issues = []
    for index, item in enumerate(sorted(snapshot["issues"], key=lambda item: item["sequence_id"]), 1):
        values = {
            **item,
            "id": id_map[item["id"]],
            "state_id": initial_state.id,
            "sequence_id": index,
            "parent_id": id_map.get(item["parent_id"]),
            "estimate_point_id": id_map.get(item["estimate_point_id"]),
            "start_date": shifted(item["start_date"]),
            "target_date": shifted(item["target_date"]),
            "description_json": _remap_content(item["description_json"], id_map),
            "description_html": _remap_html(item["description_html"], id_map),
        }
        values["description_stripped"] = strip_tags(values["description_html"])
        issues.append(Issue(**values, **project_audit))
    Issue.objects.bulk_create(issues, batch_size=500)
    IssueSequence.objects.bulk_create(
        [IssueSequence(issue=issue, sequence=issue.sequence_id, **project_audit) for issue in issues], batch_size=500
    )
    global_label_ids = {
        item["label_id"]
        for key in ("issue_labels", "page_labels")
        for item in snapshot[key]
        if item["label_id"] not in id_map
    }
    if Label.objects.filter(
        workspace_id=project.workspace_id, project__isnull=True, id__in=global_label_ids
    ).count() != len(global_label_ids):
        raise ValidationError({"template_id": "A workspace label is no longer available."})
    relation_sections = {
        "module_issues": (ModuleIssue, ("module_id", "issue_id")),
        "cycle_issues": (CycleIssue, ("cycle_id", "issue_id")),
        "issue_labels": (IssueLabel, ("issue_id",)),
        "relations": (IssueRelation, ("issue_id", "related_issue_id")),
        "requirements": (IssueResourceRequirement, ("issue_id",)),
        "links": (IssueLink, ("issue_id",)),
        "issue_types": (ProjectIssueType, ()),
        "page_labels": (PageLabel, ("page_id",)),
    }
    for key, (model, remap_fields) in relation_sections.items():
        instances = []
        for item in snapshot[key]:
            values = {**item}
            if key == "relations" and item["relation_type"] == "blocked_by":
                continue
            for field in remap_fields:
                values[field] = id_map[values[field]]
            if "label_id" in values:
                values["label_id"] = id_map.get(values["label_id"], values["label_id"])
            if key == "links":
                values["url"] = _remap_content(values["url"], id_map)
            instances.append(model(**values, **(audit if key == "page_labels" else project_audit)))
        model.objects.bulk_create(instances, batch_size=500)
    ProjectPage.objects.bulk_create([ProjectPage(page=page, **project_audit) for page in pages], batch_size=500)
    if active_people:
        for person_id in active_people - {str(user.id), str(project.project_lead_id)}:
            ProjectMember.objects.create(member_id=person_id, role=15, **project_audit)
        IssueAssignee.objects.bulk_create(
            [
                IssueAssignee(issue_id=id_map[item["issue_id"]], assignee_id=item["assignee_id"], **project_audit)
                for item in snapshot["assignees"]
                if item["assignee_id"] in active_people
            ],
            batch_size=500,
        )
        ModuleMember.objects.bulk_create(
            [
                ModuleMember(module_id=id_map[item["module_id"]], member_id=item["member_id"], **project_audit)
                for item in snapshot["module_members"]
                if item["member_id"] in active_people
            ],
            batch_size=500,
        )
    milestone_people = {str(milestone_owner_id)} if snapshot.get("milestones") else set()
    for person_id in milestone_people - {str(user.id), str(project.project_lead_id)}:
        ProjectMember.objects.get_or_create(
            project=project,
            member_id=person_id,
            defaults={"workspace_id": project.workspace_id, "role": 20 if person_id == str(user.id) else 15},
        )
    for item in snapshot.get("milestones", []):
        deadline = shifted(item["target_date"])
        milestone = ProjectMilestone.objects.create(
            id=id_map[item["id"]],
            name=item["name"],
            description=item["description"],
            target_date=deadline,
            original_target_date=deadline,
            owner_id=item["owner_id"] if item["owner_id"] in active_people else milestone_owner_id,
            history=[{"action": "created_from_template", "actor_id": str(user.id), "at": timezone.now().isoformat()}],
            **project_audit,
        )
        milestone.issues.set([id_map[value] for value in item["issue_ids"] if value in id_map])
    validate_resource_workspace(project.workspace_id)
    return project
