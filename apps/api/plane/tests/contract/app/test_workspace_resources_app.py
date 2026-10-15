from datetime import date

import pytest

from plane.db.models import Issue, IssueResourceRequirement, ProjectMember, State, WorkspaceResource
from plane.tests.factories import ProjectFactory

pytestmark = pytest.mark.usefixtures("resource_database_guard")


@pytest.mark.contract
@pytest.mark.django_db(transaction=True)
def test_overview_includes_partial_bookings_maintenance_and_visible_pending(session_client, workspace, create_user):
    from plane.db.models import ResourceBlackout, WorkspaceMember

    project = ProjectFactory(workspace=workspace, name="Overview project", identifier="RO")
    ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
    state = State.objects.create(project=project, workspace=workspace, name="Overview active", group="started")
    resource = WorkspaceResource.objects.create(workspace=workspace, name="Paint booth")
    empty = WorkspaceResource.objects.create(workspace=workspace, name="Welding table")
    for index, allocation in enumerate([60, 40]):
        issue = Issue.objects.create(
            project=project,
            state=state,
            name=f"Partial {index}",
            start_date=date(2026, 10, 1),
            target_date=date(2026, 10, 2),
        )
        IssueResourceRequirement.objects.create(
            issue=issue, project=project, workspace=workspace, resource=resource, allocation_percent=allocation
        )
    pending = Issue.objects.create(project=project, state=state, name="Pending")
    IssueResourceRequirement.objects.create(issue=pending, project=project, workspace=workspace, resource=resource)
    ResourceBlackout.objects.create(
        workspace=workspace, resource=resource, start_date=date(2026, 10, 3), target_date=date(2026, 10, 3)
    )
    url = f"/api/workspaces/{workspace.slug}/resource-overview/?from=2026-10-01&to=2026-10-04"
    response = session_client.get(url)
    assert response.status_code == 200
    rows = {str(row["id"]): row for row in response.data["resources"]}
    assert [day["allocated_percent"] for day in rows[str(resource.id)]["days"]] == [100, 100, 100, 0]
    assert rows[str(resource.id)]["days"][2]["maintenance"]
    assert rows[str(resource.id)]["average_percent"] == 75
    assert rows[str(resource.id)]["pending_count"] == 1
    assert rows[str(empty.id)]["average_percent"] == 0
    WorkspaceMember.objects.filter(workspace=workspace).update(role=15)
    ProjectMember.objects.filter(project=project).update(is_active=False)
    response = session_client.get(url)
    rows = {str(row["id"]): row for row in response.data["resources"]}
    assert rows[str(resource.id)]["pending_count"] == 0
    assert rows[str(resource.id)]["days"][0]["allocated_percent"] == 100
    assert "Partial" not in str(response.data)
    assert session_client.get(f"/api/workspaces/{workspace.slug}/resource-overview/?from=bad").status_code == 400


@pytest.mark.contract
@pytest.mark.django_db(transaction=True)
def test_resource_api_conflict_and_preferences(session_client, workspace, create_user):
    root = f"/api/workspaces/{workspace.slug}"
    response = session_client.post(f"{root}/resources/", {"name": "Paint booth"}, format="json")
    assert response.status_code == 201
    resource_id = response.data["id"]
    project = ProjectFactory(workspace=workspace)
    ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
    state = State.objects.create(project=project, workspace=workspace, name="Started", group="started")
    issues = [
        Issue.objects.create(
            project=project,
            workspace=workspace,
            state=state,
            name=f"Job {index}",
            start_date=date(2026, 10, 1),
            target_date=date(2026, 10, 3),
        )
        for index in range(2)
    ]
    for index, issue in enumerate(issues):
        response = session_client.patch(
            f"{root}/projects/{project.id}/issues/{issue.id}/resources/",
            {"resource_requirements": [{"resource_id": resource_id, "allocation_percent": 100}]},
            format="json",
        )
        assert response.status_code == (200 if index == 0 else 409)
    assert IssueResourceRequirement.objects.count() == 1
    response = session_client.get(f"{root}/resources/{resource_id}/availability/?from=2026-10-01&to=2026-10-05")
    assert response.status_code == 200
    assert [item["allocated_percent"] for item in response.data["days"]] == [100, 100, 100, 0, 0]
    response = session_client.patch(
        f"{root}/project-overview-preferences/", {"default_layout": "dashboard", "columns": ["progress"]}, format="json"
    )
    assert response.status_code == 200
    assert session_client.get(f"{root}/project-overview-preferences/").data["default_layout"] == "dashboard"
    assert (
        session_client.patch(
            f"{root}/project-overview-preferences/", {"columns": ["unknown"]}, format="json"
        ).status_code
        == 400
    )


@pytest.mark.contract
@pytest.mark.django_db(transaction=True)
def test_private_booking_redacted(session_client, workspace):
    from plane.db.models import WorkspaceMember

    private = ProjectFactory(workspace=workspace, network=0)
    state = State.objects.create(project=private, workspace=workspace, name="Started", group="started")
    issue = Issue.objects.create(
        project=private,
        workspace=workspace,
        state=state,
        name="Secret job",
        start_date=date(2026, 10, 1),
        target_date=date(2026, 10, 3),
    )
    resource = WorkspaceResource.objects.create(workspace=workspace, name="Booth")
    IssueResourceRequirement.objects.create(issue=issue, project=private, workspace=workspace, resource=resource)
    WorkspaceMember.objects.filter(workspace=workspace).update(role=15)
    response = session_client.get(
        f"/api/workspaces/{workspace.slug}/resources/{resource.id}/availability/?from=2026-10-01&to=2026-10-03"
    )
    assert response.status_code == 200
    assert response.data["days"][0]["allocated_percent"] == 100
    assert "name" not in response.data["bookings"][0]
    assert "issue_id" not in response.data["bookings"][0]


@pytest.mark.contract
@pytest.mark.django_db(transaction=True)
def test_issue_create_patch_and_bulk_conflict_are_atomic(session_client, workspace, create_user, mocker):
    activity = mocker.patch("plane.app.views.issue.base.issue_activity.delay")
    mocker.patch("plane.app.views.issue.base.model_activity.delay")
    mocker.patch("plane.app.views.issue.base.issue_description_version_task.delay")
    project = ProjectFactory(workspace=workspace, name="Resource scheduling", identifier="RS")
    ProjectMember.objects.create(project=project, workspace=workspace, member=create_user, role=20)
    state = State.objects.create(project=project, workspace=workspace, name="Resource active", group="started")
    resource = WorkspaceResource.objects.create(workspace=workspace, name="Resource")
    root = f"/api/workspaces/{workspace.slug}/projects/{project.id}"
    payload = {
        "name": "First",
        "state_id": str(state.id),
        "start_date": "2026-10-01",
        "target_date": "2026-10-03",
        "resource_requirements": [{"resource_id": str(resource.id), "allocation_percent": 100}],
    }
    first = session_client.post(f"{root}/issues/", payload, format="json")
    assert first.status_code == 201, first.data
    payload.update(name="Second", start_date="2026-10-04", target_date="2026-10-06")
    second = session_client.post(f"{root}/issues/", payload, format="json")
    assert second.status_code == 201, second.data
    activity.reset_mock()
    response = session_client.patch(f"{root}/issues/{second.data['id']}/", {"start_date": "2026-10-03"}, format="json")
    assert response.status_code == 409, response.data
    assert not activity.called
    assert Issue.objects.get(id=second.data["id"]).start_date == date(2026, 10, 4)
    response = session_client.post(
        f"{root}/issue-dates/",
        {
            "updates": [
                {"id": first.data["id"], "start_date": "2026-10-04", "target_date": "2026-10-06"},
                {"id": second.data["id"], "start_date": "2026-10-01", "target_date": "2026-10-03"},
            ]
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert activity.call_count == 2
    activity.reset_mock()
    response = session_client.post(
        f"{root}/issue-dates/",
        {"updates": [{"id": first.data["id"], "start_date": "2026-10-01", "target_date": "2026-10-03"}]},
        format="json",
    )
    assert response.status_code == 409, response.data
    assert not activity.called
