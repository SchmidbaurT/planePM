import importlib
import pytest
from django.db import connection
from rest_framework.exceptions import ValidationError

from plane.db.models import Issue, IssueRelation, ProjectMember, State
from plane.tests.factories import ProjectFactory
from plane.utils.issue_blocking import blocking_states, reconcile_blockers, set_blockers

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def blocking_guard():
    migration = importlib.import_module("plane.db.migrations.0130_blocking_workflow")
    with connection.cursor() as cursor:
        cursor.execute(migration.REVERSE_SQL)
        cursor.execute(migration.BLOCKING_SQL)
    yield
    with connection.cursor() as cursor:
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        cursor.execute(migration.REVERSE_SQL)


def test_last_blocker_releases_to_backlog(workspace, create_user):
    project = ProjectFactory(workspace=workspace, name="Blocking core", identifier="BLCORE")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Working", group="started", color="#888888")
    done = State.objects.create(project=project, name="Done", group="completed", color="#888888")
    target, first, second = [Issue.objects.create(project=project, state=state, name=name) for name in ["Target", "First", "Second"]]
    target = set_blockers(target, [first.id, second.id], create_user)
    assert target.state.is_blocked
    first.state = done
    first.save()
    reconcile_blockers(workspace.id)
    target.refresh_from_db()
    assert target.state.is_blocked
    second.archived_at = "2026-10-15"
    second.save()
    reconcile_blockers(workspace.id)
    target.refresh_from_db()
    assert target.state.group == "backlog"
    assert not IssueRelation.objects.filter(issue=target, relation_type="blocked_by").exists()


def test_manual_clear_with_database_guard(workspace, create_user, blocking_guard):
    project = ProjectFactory(workspace=workspace, name="Manual clear guard", identifier="BLMAN")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Open", group="unstarted", color="#888888")
    target = Issue.objects.create(project=project, state=state, name="Target")
    source = Issue.objects.create(project=project, state=state, name="Source")
    target = set_blockers(target, [source.id], create_user)
    target = set_blockers(target, [], create_user)
    assert target.state.group == "backlog"
    assert target.issue_activity.filter(new_value="Backlog").count() == 1


def test_invalid_blockers_leave_original_state(workspace, create_user):
    project = ProjectFactory(workspace=workspace, name="Blocking validation", identifier="BLVALID")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Ready", group="unstarted", color="#888888")
    issue = Issue.objects.create(project=project, state=state, name="Target")
    with pytest.raises(ValidationError):
        set_blockers(issue, [issue.id], create_user)
    issue.refresh_from_db()
    assert issue.state == state


def test_app_api_requires_causes_and_relation_entry_sets_status(session_client, workspace, create_user):
    project = ProjectFactory(workspace=workspace, name="Blocking API", identifier="BLAPI")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Ready", group="unstarted", color="#888888")
    target = Issue.objects.create(project=project, state=state, name="Target")
    source = Issue.objects.create(project=project, state=state, name="Source")
    blocked, release = blocking_states(project)
    root = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{target.id}/"
    assert session_client.patch(root, {"state_id": str(blocked.id)}, format="json").status_code == 400
    response = session_client.post(f"{root}issue-relation/", {"relation_type": "blocked_by", "issues": [str(source.id)]}, format="json")
    assert response.status_code == 201, response.data
    target.refresh_from_db()
    assert target.state_id == blocked.id
    assert session_client.patch(root, {"state_id": str(release.id)}, format="json").status_code == 400
    response = session_client.patch(root, {"blocker_issue_ids": []}, format="json")
    assert response.status_code == 204, response.data
    target.refresh_from_db()
    assert target.state_id == release.id


@pytest.mark.parametrize("operation", ["completed", "cancelled", "archive", "delete", "hard_delete"])
def test_database_lifecycle_releases_bulk_paths(workspace, create_user, blocking_guard, operation):
    project = ProjectFactory(workspace=workspace, name=f"Bulk blocking {operation}", identifier=f"B{operation[:6].upper()}")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Open", group="unstarted", color="#888888")
    target = Issue.objects.create(project=project, state=state, name="Target")
    source = Issue.objects.create(project=project, state=state, name="Source")
    set_blockers(target, [source.id], create_user)
    if operation in ("completed", "cancelled"):
        terminal = State.objects.create(project=project, name=operation, group=operation, color="#888888")
        Issue.objects.filter(pk=source.id).update(state=terminal)
    elif operation == "archive":
        Issue.objects.filter(pk=source.id).update(archived_at="2026-10-15")
    elif operation == "delete":
        source.delete()
    else:
        source.delete(soft=False)
    target.refresh_from_db()
    assert target.state.group == "backlog"
    assert not IssueRelation.objects.filter(issue=target, relation_type="blocked_by").exists()


@pytest.mark.django_db(transaction=True)
def test_parallel_last_blockers_release_once(workspace, create_user, blocking_guard):
    from concurrent.futures import ThreadPoolExecutor
    from django.db import close_old_connections, transaction
    from plane.utils.resource_booking import lock_resource_workspace

    project = ProjectFactory(workspace=workspace, name="Parallel blockers", identifier="BLPAR")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Open", group="unstarted", color="#888888")
    done = State.objects.create(project=project, name="Done", group="completed", color="#888888")
    target, first, second = [Issue.objects.create(project=project, state=state, name=name) for name in ["Target", "First", "Second"]]
    set_blockers(target, [first.id, second.id], create_user)
    def finish(issue_id):
        close_old_connections()
        try:
            with transaction.atomic():
                lock_resource_workspace(workspace.id)
                Issue.objects.filter(pk=issue_id).update(state_id=done.id)
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(finish, [first.id, second.id]))
    target.refresh_from_db()
    assert target.state.group == "backlog"
    assert target.issue_activity.filter(new_value="Backlog").count() == 1