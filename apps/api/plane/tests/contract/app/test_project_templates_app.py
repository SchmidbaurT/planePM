from datetime import date

import pytest

from plane.db.models import (
    Issue,
    IssueResourceRequirement,
    Project,
    ProjectMember,
    ProjectMilestone,
    State,
    WorkspaceMember,
    WorkspaceResource,
)
from plane.tests.factories import ProjectFactory, UserFactory


pytestmark = [
    pytest.mark.contract,
    pytest.mark.django_db(transaction=True),
    pytest.mark.usefixtures("resource_database_guard"),
]


@pytest.fixture
def template_source(workspace, create_user):
    project = ProjectFactory(workspace=workspace, name="API template source", identifier="APISOURCE")
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(project=project, name="Open template", group="backlog", color="#888888")
    Issue.objects.create(
        project=project, state=state, name="Plan job", start_date=date(2026, 10, 1), target_date=date(2026, 10, 3)
    )
    return project


def test_save_apply_and_delete_template(session_client, workspace, template_source, create_user):
    root = f"/api/workspaces/{workspace.slug}"
    milestone = ProjectMilestone.objects.create(
        workspace=workspace,
        project=template_source,
        name="Acceptance",
        target_date=date(2026, 10, 5),
        original_target_date=date(2026, 10, 5),
        owner=create_user,
    )
    milestone.issues.add(Issue.objects.get(project=template_source))
    response = session_client.post(
        f"{root}/project-templates/",
        {"name": "Small series", "source_project_id": str(template_source.id)},
        format="json",
    )
    assert response.status_code == 201, response.data
    template_id = response.data["id"]
    assert response.data["counts"]["issues"] == 1
    assert response.data["counts"]["milestones"] == 1
    assert str(response.data["created_by"]) == str(create_user.id)
    assert "snapshot" not in response.data
    response = session_client.post(
        f"{root}/projects/",
        {
            "name": "Series 001",
            "identifier": "SERIES001",
            "template_id": template_id,
            "template_start_date": "2026-11-01",
            "id": str(template_source.id),
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    project = Project.objects.get(pk=response.data["id"])
    assert project.id != template_source.id
    template_source.refresh_from_db()
    assert template_source.name == "API template source"
    assert Issue.objects.get(project=project).start_date == date(2026, 11, 1)
    assert State.objects.filter(project=project).count() == 1
    copied = ProjectMilestone.objects.get(project=project)
    assert copied.target_date == date(2026, 11, 5)
    assert copied.original_target_date == copied.target_date
    assert copied.owner == create_user
    assert copied.completed_at is None
    assert copied.issues.get().project == project
    assert ProjectMember.objects.get(project=project, member=create_user).role == 20
    response = session_client.patch(
        f"{root}/project-templates/{template_id}/", {"name": "Renamed", "is_shared": True}, format="json"
    )
    assert response.status_code == 200
    assert session_client.delete(f"{root}/project-templates/{template_id}/").status_code == 204
    assert session_client.get(f"{root}/project-templates/").data == []
    assert Issue.objects.filter(project=project).exists()


@pytest.mark.parametrize("role", [15, 20])
def test_private_templates_and_cross_workspace_are_not_exposed(
    session_client, workspace, template_source, create_user, role
):
    root = f"/api/workspaces/{workspace.slug}"
    template = session_client.post(
        f"{root}/project-templates/", {"name": "Private", "source_project_id": str(template_source.id)}, format="json"
    ).data
    member = UserFactory(username="template-api-member")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=role)
    session_client.force_authenticate(user=member)
    assert session_client.get(f"{root}/project-templates/").data == []
    response = session_client.post(
        f"{root}/projects/",
        {
            "name": "Forbidden",
            "identifier": "FORBIDDEN",
            "template_id": template["id"],
            "template_start_date": "2026-11-01",
        },
        format="json",
    )
    assert response.status_code == 404
    assert not Project.objects.filter(name="Forbidden").exists()
    assert (
        session_client.post(
            f"{root}/project-templates/",
            {"name": "Forbidden snapshot", "source_project_id": str(template_source.id)},
            format="json",
        ).status_code
        == 403
    )


def test_resource_conflict_leaves_no_partial_project(session_client, workspace, template_source):
    root = f"/api/workspaces/{workspace.slug}"
    resource = WorkspaceResource.objects.create(workspace=workspace, name="Booth")
    IssueResourceRequirement.objects.create(
        project=template_source, issue=Issue.objects.get(project=template_source), resource=resource
    )
    template = session_client.post(
        f"{root}/project-templates/", {"name": "Booked", "source_project_id": str(template_source.id)}, format="json"
    ).data
    response = session_client.post(
        f"{root}/projects/",
        {
            "name": "Conflict",
            "identifier": "CONFLICT",
            "template_id": template["id"],
            "template_start_date": "2026-10-01",
        },
        format="json",
    )
    assert response.status_code == 409, response.data
    assert not Project.objects.filter(name="Conflict").exists()
    assert IssueResourceRequirement.objects.count() == 1
