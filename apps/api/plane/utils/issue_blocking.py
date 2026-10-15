from collections import defaultdict
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from plane.db.models import Issue, IssueActivity, IssueRelation, Project, ProjectMember, State
from plane.utils.portfolio import visible_issues
from plane.utils.resource_booking import lock_resource_workspace


def blocking_states(project):
    blocked = State.objects.filter(project=project, is_blocked=True).first()
    if blocked is None:
        candidates = list(State.objects.filter(project=project).filter(Q(name__iexact="Blocked") | Q(name__iexact="Blockiert")))
        if len(candidates) > 1 or (candidates and (candidates[0].group != "started" or candidates[0].default)):
            raise ValidationError({"code": "BLOCKING_SETUP_REQUIRED"})
        if candidates:
            blocked = candidates[0]
            blocked.is_blocked = True
            blocked.color = "#D14343"
            blocked.save(update_fields=["is_blocked", "color", "updated_at"])
        else:
            blocked = State.objects.create(project=project, name="Blocked", color="#D14343", group="started", is_blocked=True)
    release = State.objects.filter(project=project, pk=project.blocked_release_state_id, group="backlog", is_blocked=False).first()
    if release is None:
        release = State.objects.filter(project=project, group="backlog", is_blocked=False).order_by("sequence", "id").first()
        if release is None:
            release = State.objects.create(project=project, name="Backlog", color="#60646C", group="backlog")
        Project.objects.filter(pk=project.id).update(blocked_release_state=release)
        project.blocked_release_state_id = release.id
    return blocked, release


def active_issue(issue):
    return issue.deleted_at is None and issue.archived_at is None and not issue.is_draft and issue.project.deleted_at is None and issue.project.archived_at is None and issue.state is not None and issue.state.group not in ("completed", "cancelled", "triage")


def record_blocking_activity(issue, actor, action, sources, previous_state=None):
    IssueActivity.objects.create(project=issue.project, workspace=issue.workspace, issue=issue, actor=actor,
        verb="updated", field="state", old_value=previous_state.name if previous_state else "", new_value=issue.state.name,
        old_identifier=previous_state.id if previous_state else None, new_identifier=issue.state_id, comment="",)


@transaction.atomic
def set_blockers(issue, blocker_ids, actor):
    lock_resource_workspace(issue.workspace_id)
    issue = Issue.objects.select_for_update(of=("self",)).select_related("project", "state").get(pk=issue.pk)
    if not ProjectMember.objects.filter(project=issue.project, member=actor, is_active=True, role__gte=15).exists():
        raise PermissionDenied()
    if not active_issue(issue):
        raise ValidationError({"code": "BLOCKING_INACTIVE"})
    try:
        ids = {UUID(str(value)) for value in blocker_ids}
    except (TypeError, ValueError):
        raise ValidationError({"code": "BLOCKING_INVALID"})
    if len(ids) > 1000 or issue.id in ids:
        raise ValidationError({"code": "RELATION_SELF" if issue.id in ids else "BLOCKING_INVALID"})
    sources = list(visible_issues(issue.workspace, actor).filter(pk__in=ids).select_related("project", "state"))
    if len(sources) != len(ids) or any(not active_issue(source) for source in sources):
        raise ValidationError({"code": "BLOCKING_UNAVAILABLE"})
    adjacency = defaultdict(set)
    for edge in IssueRelation.objects.filter(workspace=issue.workspace, relation_type__in=["blocked_by", "finish_to_start", "start_before", "finish_before"]).exclude(issue=issue, relation_type="blocked_by").values("issue_id", "related_issue_id", "relation_type"):
        source, target = (edge["related_issue_id"], edge["issue_id"]) if edge["relation_type"] == "blocked_by" else (edge["issue_id"], edge["related_issue_id"])
        adjacency[source].add(target)
    pending, visited = [issue.id], set()
    while pending:
        current = pending.pop()
        if current in ids:
            raise ValidationError({"code": "RELATION_CYCLE"})
        if current not in visited:
            visited.add(current)
            pending.extend(adjacency[current])
    blocked, release = blocking_states(issue.project)
    previous_state = issue.state
    previous = set(IssueRelation.objects.filter(issue=issue, relation_type="blocked_by").values_list("related_issue_id", flat=True))
    IssueRelation.objects.filter(issue=issue, relation_type="blocked_by").exclude(related_issue_id__in=ids).delete()
    IssueRelation.objects.bulk_create([IssueRelation(issue=issue, related_issue_id=source_id, relation_type="blocked_by", project=issue.project, workspace=issue.workspace, created_by=actor) for source_id in ids - previous])
    released_by_database = not ids and Issue.objects.get(pk=issue.pk).state_id == release.id
    issue.state = blocked if ids else release
    issue.blocking_legacy = False
    issue.save(update_fields=["state", "blocking_legacy", "completed_at", "updated_at"])
    if ids != previous and not released_by_database:
        record_blocking_activity(issue, actor, "blocked" if ids else "released", ids, previous_state)
    return issue


@transaction.atomic
def reconcile_blockers(workspace_id, actor=None):
    lock_resource_workspace(workspace_id)
    edges = IssueRelation.objects.filter(workspace_id=workspace_id, relation_type="blocked_by").select_related("issue__state", "issue__project", "related_issue__state", "related_issue__project")
    affected = set()
    for edge in edges:
        if not active_issue(edge.related_issue) or not active_issue(edge.issue):
            affected.add(edge.issue_id)
            edge.delete()
    for issue in Issue.objects.filter(workspace_id=workspace_id, pk__in=affected, state__is_blocked=True).select_related("project", "state").order_by("id"):
        if active_issue(issue) and not IssueRelation.objects.filter(issue=issue, relation_type="blocked_by").exists():
            _, release = blocking_states(issue.project)
            previous_state = issue.state
            issue.state = release
            issue.blocking_legacy = False
            issue.save(update_fields=["state", "blocking_legacy", "completed_at", "updated_at"])
            record_blocking_activity(issue, actor, "released", [], previous_state)