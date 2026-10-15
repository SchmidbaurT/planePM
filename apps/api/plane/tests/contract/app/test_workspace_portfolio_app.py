from datetime import date

import pytest

from plane.db.models import Issue, IssueRelation, Module, ProjectMember, State
from plane.tests.factories import ProjectFactory


@pytest.mark.contract
@pytest.mark.django_db
def test_portfolio_periods_progress_and_canonical_dependency(session_client, workspace, create_user):
    first = ProjectFactory(workspace=workspace, name="Portfolio first", identifier="PF", module_view=True)
    second = ProjectFactory(workspace=workspace, name="Portfolio second", identifier="PS")
    assert first.id != second.id
    ProjectMember.objects.create(workspace=workspace, project=first, member=create_user, role=20)
    ProjectMember.objects.create(workspace=workspace, project=second, member=create_user, role=20)
    states = [
        State.objects.create(workspace=workspace, project=project, name="Portfolio active", group="started")
        for project in (first, second)
    ]
    blocker = Issue.objects.create(
        workspace=workspace,
        project=first,
        state=states[0],
        name="Blocker",
        start_date=date(2026, 1, 1),
        target_date=date(2026, 1, 5),
    )
    dependent = Issue.objects.create(
        workspace=workspace,
        project=second,
        state=states[1],
        name="Dependent",
        start_date=date(2026, 1, 4),
        target_date=date(2026, 1, 8),
    )
    IssueRelation.objects.create(
        workspace=workspace, project=second, issue=dependent, related_issue=blocker, relation_type="blocked_by"
    )
    Module.objects.create(
        workspace=workspace, project=first, name="Module", start_date=date(2025, 12, 1), target_date=date(2026, 1, 3)
    )
    response = session_client.get(f"/api/workspaces/{workspace.slug}/portfolio/?per_page=1")
    assert response.status_code == 200
    assert response.data["metrics"]["total"] == 2
    assert response.data["selected_project_count"] == 2
    assert response.data["next_cursor"] == "1"
    assert len(response.data["dependencies"]) == 1
    assert response.data["dependencies"][0]["date_conflict"]
    data = session_client.get(f"/api/workspaces/{workspace.slug}/portfolio/?project_ids={first.id}").data
    assert data["results"][0]["start_date"] == date(2025, 12, 1)
    assert data["results"][0]["period_source"] == "mixed"
    assert data["results"][0]["total"] == 1


@pytest.mark.contract
@pytest.mark.django_db
def test_portfolio_guest_scope_and_bad_filter(session_client, workspace, create_user):
    from plane.db.models import WorkspaceMember

    project = ProjectFactory(workspace=workspace, guest_view_all_features=False)
    ProjectMember.objects.create(workspace=workspace, project=project, member=create_user, role=5)
    WorkspaceMember.objects.filter(workspace=workspace).update(role=5)
    state = State.objects.create(workspace=workspace, project=project, name="Open", group="started")
    Issue.objects.create(workspace=workspace, project=project, state=state, name="Not mine")
    response = session_client.get(f"/api/workspaces/{workspace.slug}/portfolio/")
    assert response.data["metrics"]["total"] == 0
    assert session_client.get(f"/api/workspaces/{workspace.slug}/portfolio/?from=invalid").status_code == 400


@pytest.mark.contract
@pytest.mark.django_db
def test_project_visibility_does_not_grant_task_access(session_client, workspace):
    project = ProjectFactory(workspace=workspace, name="Private task access", identifier="PTA")
    state = State.objects.create(project=project, workspace=workspace, name="Private task active", group="started")
    Issue.objects.create(
        project=project, workspace=workspace, state=state, name="Private task", start_date=date(2026, 1, 1)
    )
    response = session_client.get(f"/api/workspaces/{workspace.slug}/portfolio/")
    assert response.status_code == 200
    assert response.data["selected_project_count"] == 1
    assert response.data["metrics"]["total"] == 0
    assert response.data["results"][0]["start_date"] is None


@pytest.mark.contract
@pytest.mark.django_db
def test_timeline_relations_direction_conflicts_and_private_scope(session_client, workspace, create_user):
    project = ProjectFactory(workspace=workspace, name="Timeline relations", identifier="TR")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Open dependency", group="unstarted")
    predecessor = Issue.objects.create(
        project=project, state=state, name="Material", start_date=date(2026, 10, 1), target_date=date(2026, 10, 10)
    )
    successor = Issue.objects.create(
        project=project, state=state, name="Assembly", start_date=date(2026, 10, 5), target_date=date(2026, 10, 20)
    )
    IssueRelation.objects.create(
        project=project, issue=successor, related_issue=predecessor, relation_type="blocked_by"
    )
    url = f"/api/workspaces/{workspace.slug}/timeline-relations/?issue_ids={successor.id}"
    response = session_client.get(url)
    assert response.status_code == 200, response.data
    edge = response.data["results"][0]
    assert edge["source_id"] == str(predecessor.id)
    assert edge["target_id"] == str(successor.id)
    assert edge["date_conflict"] is True
    assert edge["is_blocking"] is True
    hidden = ProjectFactory(workspace=workspace, name="Hidden timeline", identifier="HIDETR", network=0)
    hidden_state = State.objects.create(project=hidden, name="Hidden open", group="unstarted")
    hidden_issue = Issue.objects.create(project=hidden, state=hidden_state, name="Hidden dependency")
    IssueRelation.objects.create(
        project=project, issue=successor, related_issue=hidden_issue, relation_type="blocked_by"
    )
    response = session_client.get(url)
    assert len(response.data["results"]) == 1
    assert "Hidden dependency" not in str(response.data)
    assert (
        session_client.get(f"/api/workspaces/{workspace.slug}/timeline-relations/?issue_ids=invalid").status_code == 400
    )


@pytest.mark.contract
@pytest.mark.django_db
def test_planning_relations_reject_self_cycles_and_keep_existing_links(session_client, workspace, create_user):
    project = ProjectFactory(workspace=workspace, name="Safe dependencies", identifier="SAFEDEP")
    ProjectMember.objects.get_or_create(project=project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=project, name="Open", group="unstarted", color="#888888")
    first = Issue.objects.create(project=project, state=state, name="First")
    second = Issue.objects.create(project=project, state=state, name="Second")
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{first.id}/issue-relation/"
    assert (
        session_client.post(
            url, {"relation_type": "finish_to_start", "issues": [str(first.id)]}, format="json"
        ).status_code
        == 400
    )
    response = session_client.post(url, {"relation_type": "finish_to_start", "issues": [str(second.id)]}, format="json")
    assert response.status_code == 201, response.data
    edge = IssueRelation.objects.get(issue=first, related_issue=second)
    assert edge.relation_type == "finish_to_start"
    reverse_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{second.id}/issue-relation/"
    cycle = session_client.post(
        reverse_url, {"relation_type": "finish_to_start", "issues": [str(first.id)]}, format="json"
    )
    assert cycle.status_code == 400
    assert str(cycle.data["code"]) == "RELATION_CYCLE"
    assert (
        session_client.post(url, {"relation_type": "relates_to", "issues": [str(second.id)]}, format="json").status_code
        == 400
    )
    edge.refresh_from_db()
    assert edge.relation_type == "finish_to_start"
    data = session_client.get(reverse_url).data
    assert str(data["start_after_finish"][0]["id"]) == str(first.id)
    hidden = ProjectFactory(workspace=workspace, name="Private related task", identifier="PRIVREL", network=0)
    ProjectMember.objects.filter(project=hidden, member=create_user).delete()
    hidden_state = State.objects.create(project=hidden, name="Private open", group="unstarted", color="#888888")
    hidden_issue = Issue.objects.create(project=hidden, state=hidden_state, name="Secret task")
    IssueRelation.objects.create(project=project, issue=first, related_issue=hidden_issue, relation_type="relates_to")
    assert list(session_client.get(url).data["relates_to"]) == []
    remove_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{first.id}/remove-relation/"
    assert (
        session_client.post(
            remove_url, {"related_issue": str(hidden_issue.id), "relation_type": "relates_to"}, format="json"
        ).status_code
        == 404
    )
