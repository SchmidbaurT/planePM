from django.db.models import Q
from collections import defaultdict
from datetime import date
from uuid import UUID

from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Issue, Project, ProjectMember, WorkspaceMember


def visible_projects(workspace, user):
    role = (
        WorkspaceMember.objects.filter(workspace=workspace, member=user, is_active=True)
        .values_list("role", flat=True)
        .first()
    )
    if role is None:
        raise PermissionDenied()
    projects = Project.objects.filter(workspace=workspace, archived_at__isnull=True)
    memberships = ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True).values("project_id")
    if role == 5:
        return projects.filter(pk__in=memberships)
    if role == 15:
        return projects.filter(Q(pk__in=memberships) | Q(network=2))
    return projects


def visible_issues(workspace, user):
    projects = visible_projects(workspace, user)
    memberships = ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True).values("project_id")
    restricted = ProjectMember.objects.filter(
        workspace=workspace, member=user, role=5, is_active=True, project__guest_view_all_features=False
    ).values("project_id")
    return Issue.issue_objects.filter(project__in=projects, project_id__in=memberships).filter(
        ~Q(project_id__in=restricted) | Q(created_by=user)
    )


def timeline_relations(workspace, user, issue_ids, offset=0, project_ids=()):
    from plane.db.models import IssueRelation

    visible = visible_issues(workspace, user)
    query = (
        IssueRelation.objects.filter(issue__in=visible, related_issue__in=visible)
        .filter(
            Q(issue_id__in=issue_ids)
            | Q(related_issue_id__in=issue_ids)
            | Q(issue__project_id__in=project_ids)
            | Q(related_issue__project_id__in=project_ids)
        )
        .select_related("issue__state", "related_issue__state")
        .order_by("id")
    )
    rows = list(query[offset : offset + 201])
    result = []
    for relation in rows[:200]:
        source, target = relation.issue, relation.related_issue
        if relation.relation_type == "blocked_by":
            source, target = target, source
        if source.id == target.id:
            continue
        if relation.relation_type == "start_before":
            source_date, target_date = source.start_date, target.start_date
        elif relation.relation_type == "finish_before":
            source_date, target_date = source.target_date, target.target_date
        elif relation.relation_type in ("blocked_by", "finish_to_start"):
            source_date, target_date = source.target_date, target.start_date
        else:
            source_date, target_date = None, None
        active = source.state.group not in ("completed", "cancelled") and target.state.group not in (
            "completed",
            "cancelled",
        )
        result.append(
            {
                "id": str(relation.id),
                "relation_type": relation.relation_type,
                "source_id": str(source.id),
                "source_name": source.name,
                "source_project_id": str(source.project_id),
                "target_id": str(target.id),
                "target_name": target.name,
                "target_project_id": str(target.project_id),
                "source_date": source_date,
                "target_date": target_date,
                "date_conflict": bool(source_date and target_date and source_date > target_date),
                "is_assessable": bool(source_date and target_date),
                "is_blocking": bool(
                    active and relation.relation_type == "blocked_by"
                ),
            }
        )
    return {"results": result, "next_cursor": offset + 200 if len(rows) > 200 else None}


def portfolio_filters(params):
    today = timezone.localdate()
    from datetime import timedelta

    try:
        start = date.fromisoformat(params.get("from", str(today - timedelta(days=14))))
        end = date.fromisoformat(params.get("to", str(today + timedelta(days=70))))
        if end < start or (end - start).days > 365:
            raise ValueError()
        ids = [UUID(value) for value in params.get("project_ids", "").split(",") if value]
        lead = UUID(params["lead_id"]) if params.get("lead_id") else None
        resource = UUID(params["resource_id"]) if params.get("resource_id") else None
        page = max(0, int(params.get("cursor", "0")))
        size = min(100, max(1, int(params.get("per_page", "100"))))
    except (ValueError, TypeError, OverflowError):
        raise serializers.ValidationError("Invalid portfolio filters.")
    risk = params.get("risk", "")
    if risk not in ("", "overdue", "dependencies", "people", "quality", "resources"):
        raise serializers.ValidationError("Invalid risk filter.")
    return {
        "start": start,
        "end": end,
        "ids": ids,
        "lead": lead,
        "resource": resource,
        "page": page,
        "size": size,
        "risk": risk,
    }


def build_portfolio(workspace, user, params):
    from plane.db.models import IssueAssignee, IssueRelation, IssueResourceRequirement, Module, ProjectMember

    filters = portfolio_filters(params)
    projects = visible_projects(workspace, user)
    if filters["ids"]:
        projects = projects.filter(id__in=filters["ids"])
    if filters["lead"]:
        projects = projects.filter(project_lead_id=filters["lead"])
    if params.get("search"):
        projects = projects.filter(name__icontains=params["search"][:255])
    if filters["resource"]:
        projects = projects.filter(
            id__in=IssueResourceRequirement.objects.filter(
                resource_id=filters["resource"], issue__in=visible_issues(workspace, user)
            ).values("project_id")
        )
    rows = list(projects.order_by("name", "id").values("id", "name", "identifier", "logo_props", "project_lead_id"))
    summaries = {}
    endpoints = defaultdict(list)
    for row in rows:
        row.update(
            total=0,
            completed=0,
            overdue=0,
            dependencies=0,
            dated_issue_count=0,
            undated_issue_count=0,
            partial_dates_count=0,
            invalid_dates_count=0,
            pending_resources=0,
            resource_ids=[],
            period_source="none",
            milestones=[],
        )
        summaries[row["id"]] = row
    issues_query = visible_issues(workspace, user).filter(project_id__in=summaries).exclude(state__group="cancelled")
    issues = {
        item["id"]: item
        for item in issues_query.values(
            "id", "name", "project_id", "sequence_id", "start_date", "target_date", "state__group"
        )
    }

    def add_period(row, source, kind):
        start, end = source["start_date"], source["target_date"]
        if start and end and start > end:
            row["invalid_dates_count"] += 1
            return
        if not start and not end:
            if kind == "issues":
                row["undated_issue_count"] += 1
            return
        if not start or not end:
            row["partial_dates_count"] += 1
        elif kind == "issues":
            row["dated_issue_count"] += 1
        endpoints[row["id"]].extend(value for value in (start, end) if value)
        row["period_source"] = kind if row["period_source"] in ("none", kind) else "mixed"

    today = timezone.localdate()
    for item in issues.values():
        row = summaries[item["project_id"]]
        row["total"] += 1
        row["completed"] += item["state__group"] == "completed"
        row["overdue"] += (
            item["state__group"] != "completed" and item["target_date"] is not None and item["target_date"] < today
        )
        add_period(row, item, "issues")
    restricted_modules = ProjectMember.objects.filter(
        workspace=workspace, member=user, role=5, is_active=True, project__guest_view_all_features=False
    ).values("project_id")
    modules = (
        Module.objects.filter(project_id__in=summaries, project__module_view=True, archived_at__isnull=True)
        .exclude(status="cancelled")
        .exclude(project_id__in=restricted_modules)
        .filter(
            project_id__in=ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True).values(
                "project_id"
            )
        )
    )
    for module in modules.values("project_id", "start_date", "target_date"):
        add_period(summaries[module["project_id"]], module, "modules")
    dependencies = []
    for relation in IssueRelation.objects.filter(
        issue_id__in=issues, related_issue_id__in=issues, relation_type="blocked_by"
    ).values("issue_id", "related_issue_id"):
        source, target = issues[relation["related_issue_id"]], issues[relation["issue_id"]]
        if (
            source["project_id"] == target["project_id"]
            or source["state__group"] == "completed"
            or target["state__group"] == "completed"
        ):
            continue
        summaries[target["project_id"]]["dependencies"] += 1
        dependencies.append(
            {
                "source_project_id": source["project_id"],
                "target_project_id": target["project_id"],
                "source_issue_id": source["id"],
                "target_issue_id": target["id"],
                "source_name": source["name"],
                "target_name": target["name"],
                "source_end": source["target_date"],
                "target_start": target["start_date"],
                "date_conflict": bool(
                    source["target_date"] and target["start_date"] and source["target_date"] > target["start_date"]
                ),
            }
        )
    person_events = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    person_names = {}
    for assignment in IssueAssignee.objects.filter(issue_id__in=issues).values(
        "issue_id", "assignee_id", "assignee__first_name", "assignee__last_name"
    ):
        issue = issues[assignment["issue_id"]]
        if (
            issue["state__group"] == "completed"
            or not issue["start_date"]
            or not issue["target_date"]
            or issue["start_date"] > issue["target_date"]
        ):
            continue
        start, end = max(issue["start_date"], filters["start"]), min(issue["target_date"], filters["end"])
        if start > end:
            continue
        person_id, project_id = assignment["assignee_id"], issue["project_id"]
        person_names[person_id] = " ".join(
            value for value in (assignment["assignee__first_name"], assignment["assignee__last_name"]) if value
        )
        person_events[person_id][start.toordinal()][project_id] += 1
        person_events[person_id][end.toordinal() + 1][project_id] -= 1
    overlaps = []
    overlap_projects = set()
    for person_id, events in person_events.items():
        active = defaultdict(int)
        days = sorted(events)
        for index, day in enumerate(days[:-1]):
            for project_id, delta in events[day].items():
                active[project_id] += delta
            project_ids = sorted((project_id for project_id, count in active.items() if count > 0), key=str)
            if len(project_ids) > 1:
                overlap_projects.update(project_ids)
                overlaps.append(
                    {
                        "person_id": person_id,
                        "name": person_names[person_id],
                        "project_ids": project_ids,
                        "start_date": date.fromordinal(day),
                        "target_date": date.fromordinal(days[index + 1] - 1),
                    }
                )
    for requirement in IssueResourceRequirement.objects.filter(issue_id__in=issues).values("issue_id", "resource_id"):
        issue = issues[requirement["issue_id"]]
        row = summaries[issue["project_id"]]
        if requirement["resource_id"] not in row["resource_ids"]:
            row["resource_ids"].append(requirement["resource_id"])
        if issue["state__group"] != "completed" and (not issue["start_date"] or not issue["target_date"]):
            row["pending_resources"] += 1
    for row in rows:
        dates = endpoints[row["id"]]
        row.update(
            start_date=min(dates) if dates else None,
            target_date=max(dates) if dates else None,
            progress=round(100 * row["completed"] / row["total"]) if row["total"] else None,
            people_overlap=row["id"] in overlap_projects,
        )
    if filters["risk"]:
        keys = {
            "overdue": lambda row: row["overdue"],
            "dependencies": lambda row: row["dependencies"],
            "people": lambda row: row["people_overlap"],
            "resources": lambda row: row["pending_resources"],
            "quality": lambda row: row["undated_issue_count"] + row["partial_dates_count"] + row["invalid_dates_count"],
        }
        rows = [row for row in rows if keys[filters["risk"]](row)]
        selected = {row["id"] for row in rows}
        dependencies = [
            edge
            for edge in dependencies
            if edge["source_project_id"] in selected and edge["target_project_id"] in selected
        ]
        overlaps = [
            {**item, "project_ids": [value for value in item["project_ids"] if value in selected]} for item in overlaps
        ]
        overlaps = [item for item in overlaps if len(item["project_ids"]) > 1]
    sort = params.get("sort", "name")
    if sort in ("overdue", "progress"):
        rows.sort(key=lambda row: (-(row[sort] or 0), row["name"], str(row["id"])))
    elif sort == "-name":
        rows.reverse()
    offset = filters["page"]
    result = rows[offset : offset + filters["size"]]
    from zoneinfo import ZoneInfo
    from plane.db.models import ProjectMilestone

    memberships = ProjectMember.objects.filter(workspace=workspace, member=user, is_active=True)
    visible_milestones = (
        ProjectMilestone.objects.filter(project_id__in=[row["id"] for row in result])
        .filter(project_id__in=memberships.values("project_id"))
        .exclude(project_id__in=memberships.filter(role=5, project__guest_view_all_features=False).values("project_id"))
        .select_related("owner", "project")
    )
    for milestone in visible_milestones:
        milestone_today = timezone.localdate(timezone=ZoneInfo(milestone.project.timezone))
        completed_date = (
            timezone.localtime(milestone.completed_at, ZoneInfo(milestone.project.timezone)).date()
            if milestone.completed_at
            else None
        )
        summaries[milestone.project_id]["milestones"].append(
            {
                "id": milestone.id,
                "name": milestone.name,
                "target_date": milestone.target_date,
                "owner_name": milestone.owner.display_name,
                "status": "reached"
                if completed_date
                else "overdue"
                if milestone.target_date < milestone_today
                else "open",
                "is_late": bool(completed_date and completed_date > milestone.target_date),
            }
        )
    return {
        "results": result,
        "next_cursor": str(offset + len(result)) if offset + len(result) < len(rows) else None,
        "selected_project_count": len(rows),
        "generated_at": timezone.now(),
        "as_of_date": today,
        "timezone": user.user_timezone,
        "from": filters["start"],
        "to": filters["end"],
        "metrics": {
            "projects": len(rows),
            "total": sum(row["total"] for row in rows),
            "completed": sum(row["completed"] for row in rows),
            "overdue_projects": sum(bool(row["overdue"]) for row in rows),
            "dependencies": len(dependencies),
            "pending_resources": sum(row["pending_resources"] for row in rows),
        },
        "dependencies": dependencies,
        "people_overlaps": overlaps,
    }
