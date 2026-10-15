from datetime import date, timedelta

import pytest
from django.utils import timezone

from plane.db.models import Issue, IssueAssignee, IssueRelation, ProjectMember, ProjectMilestone, State, WorkspaceMember
from plane.tests.factories import ProjectFactory, UserFactory

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture
def milestone_project(workspace, create_user):
    project = ProjectFactory(workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    return project


def create_milestone(client, workspace, project, owner):
    return client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/milestones/",
        {
            "name": "Acceptance",
            "target_date": "2026-10-01",
            "owner_id": str(owner.id),
        },
        format="json",
    )


def test_required_date_owner_and_manual_confirmation(session_client, workspace, milestone_project, create_user):
    root = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestones/"
    assert session_client.post(root, {"name": "Incomplete"}, format="json").status_code == 400
    response = create_milestone(session_client, workspace, milestone_project, create_user)
    assert response.status_code == 201, response.data
    url = f"{root}{response.data['id']}/"
    assert session_client.patch(url, {"target_date": "2026-11-01"}, format="json").status_code == 400
    changed = session_client.patch(url, {"target_date": "2026-11-01", "reason": "Customer rescheduled"}, format="json")
    assert changed.status_code == 200, changed.data
    assert changed.data["original_target_date"] == date(2026, 10, 1)
    assert changed.data["history"][-1]["reason"] == "Customer rescheduled"
    reached = session_client.patch(url, {"reached": True}, format="json")
    assert reached.status_code == 200, reached.data
    assert reached.data["completed_by"] == str(create_user.id)
    assert session_client.patch(url, {"reached": False}, format="json").status_code == 400
    assert session_client.patch(url, {"reached": False, "reason": "Correction"}, format="json").status_code == 200


def test_owner_can_shift_but_other_members_cannot_confirm(session_client, workspace, milestone_project, create_user):
    owner, other = UserFactory(username="milestone-owner"), UserFactory(username="milestone-other")
    for user in [owner, other]:
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        ProjectMember.objects.create(project=milestone_project, member=user, role=15)
    response = create_milestone(session_client, workspace, milestone_project, owner)
    assert response.status_code == 201, response.data
    url = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestones/{response.data['id']}/"
    session_client.force_authenticate(user=other)
    assert session_client.patch(url, {"reached": True}, format="json").status_code == 403
    session_client.force_authenticate(user=owner)
    assert (
        session_client.patch(url, {"target_date": "2026-12-01", "reason": "New appointment"}, format="json").status_code
        == 200
    )
    assert session_client.delete(url).status_code == 403


def test_identity_foreign_owner_and_foreign_tasks_rejected(session_client, workspace, milestone_project, create_user):
    root = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestones/"
    payload = {
        "name": "Review",
        "target_date": "2026-10-01",
        "owner_id": str(UserFactory(username="milestone-outsider").id),
    }
    assert session_client.post(root, payload, format="json").status_code == 400
    payload["owner_id"] = str(create_user.id)
    payload["project_id"] = str(milestone_project.id)
    assert session_client.post(root, payload, format="json").status_code == 400
    assert ProjectMilestone.objects.count() == 0


def test_work_plan_counts_full_results_and_paginates(session_client, workspace, milestone_project, create_user):
    state = State.objects.create(project=milestone_project, name="Open", group="unstarted", color="#888888")
    today = timezone.localdate()
    for index in range(28):
        issue = Issue.objects.create(
            project=milestone_project, state=state, name=f"Job {index}", target_date=today - timedelta(days=1)
        )
        IssueAssignee.objects.create(project=milestone_project, issue=issue, assignee=create_user)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/users/{create_user.id}/work-plan/")
    assert response.status_code == 200, response.data
    section = response.data["sections"]["today"]
    assert section["count"] == 28
    assert len(section["items"]) == 25
    assert section["next_cursor"] == 25


def test_private_milestones_and_work_plan_do_not_leak(session_client, workspace, milestone_project, create_user):
    milestone_project.network = 0
    milestone_project.save()
    response = create_milestone(session_client, workspace, milestone_project, create_user)
    outsider = UserFactory(username="milestone-private-outsider")
    WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=15)
    session_client.force_authenticate(user=outsider)
    root = f"/api/workspaces/{workspace.slug}"
    assert session_client.get(f"{root}/projects/{milestone_project.id}/milestones/").status_code == 404
    plan = session_client.get(f"{root}/users/{create_user.id}/work-plan/")
    assert plan.status_code == 200, plan.data
    assert plan.data["sections"]["milestones"]["count"] == 0
    assert response.data["name"] not in str(plan.data)


def test_stale_edits_are_rejected_without_changing_history(session_client, workspace, milestone_project, create_user):
    response = create_milestone(session_client, workspace, milestone_project, create_user)
    url = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestones/{response.data['id']}/"
    stamp = response.data["updated_at"]
    assert session_client.patch(url, {"name": "Updated"}, format="json").status_code == 200
    stale = session_client.patch(url, {"name": "Stale", "expected_updated_at": stamp}, format="json")
    assert stale.status_code == 409
    milestone = ProjectMilestone.objects.get(pk=response.data["id"])
    assert milestone.name == "Updated"
    assert len(milestone.history) == 2


def test_linked_tasks_do_not_auto_confirm_and_late_confirmation_is_preserved(
    session_client, workspace, milestone_project, create_user
):
    state = State.objects.create(project=milestone_project, name="Done", group="completed", color="#888888")
    issue = Issue.objects.create(project=milestone_project, state=state, name="Preparation done")
    response = create_milestone(session_client, workspace, milestone_project, create_user)
    url = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestones/{response.data['id']}/"
    linked = session_client.patch(url, {"issue_ids": [str(issue.id)]}, format="json")
    assert linked.status_code == 200, linked.data
    assert linked.data["completed_at"] is None
    assert linked.data["issues"] == [{"id": str(issue.id), "name": "Preparation done"}]
    late = session_client.patch(url, {"reached": True}, format="json")
    assert late.status_code == 200, late.data
    assert late.data["is_late"] is True
    assert (
        session_client.patch(url, {"target_date": "2099-01-01", "reason": "Hide delay"}, format="json").status_code
        == 400
    )


def test_tasks_from_other_projects_are_rejected(session_client, workspace, milestone_project, create_user):
    other_project = ProjectFactory(workspace=workspace, name="Foreign milestone project", identifier="FOREIGNMS")
    assert other_project.id != milestone_project.id
    ProjectMember.objects.get_or_create(project=other_project, member=create_user, defaults={"role": 20})
    state = State.objects.create(project=other_project, name="Open", group="unstarted", color="#888888")
    foreign = Issue.objects.create(project=other_project, state=state, name="Foreign")
    response = create_milestone(session_client, workspace, milestone_project, create_user)
    url = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestones/{response.data['id']}/"
    assert session_client.patch(url, {"issue_ids": [str(foreign.id)]}, format="json").status_code == 400
    assert ProjectMilestone.objects.get(pk=response.data["id"]).issues.count() == 0


def test_noop_updates_and_deleted_milestones(session_client, workspace, milestone_project, create_user):
    response = create_milestone(session_client, workspace, milestone_project, create_user)
    url = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestones/{response.data['id']}/"
    unchanged = session_client.patch(url, {"name": "Acceptance", "issue_ids": []}, format="json")
    assert unchanged.status_code == 200
    assert unchanged.data["updated_at"] == response.data["updated_at"]
    assert unchanged.data["history"] == response.data["history"]
    assert session_client.delete(url).status_code == 204
    assert session_client.patch(url, {"name": "Resurrected"}, format="json").status_code == 404


def test_milestone_task_picker_searches_names_identifiers_and_pages(session_client, workspace, milestone_project):
    state = State.objects.create(project=milestone_project, name="Ready", group="unstarted", color="#888888")
    items = [
        Issue.objects.create(project=milestone_project, state=state, name=f"Preparation {index}") for index in range(28)
    ]
    url = f"/api/workspaces/{workspace.slug}/projects/{milestone_project.id}/milestone-work-items/"
    response = session_client.get(url)
    assert response.status_code == 200, response.data
    assert response.data["count"] == 28
    assert len(response.data["results"]) == 25
    assert response.data["next_cursor"] == 25
    identifier = f"{milestone_project.identifier}-{items[0].sequence_id}"
    found = session_client.get(url, {"search": identifier})
    assert len(found.data["results"]) == 1
    assert found.data["results"][0]["identifier"] == identifier
    assert session_client.get(url, {"cursor": 25}).data["next_cursor"] is None
    assert session_client.get(url, {"search": "Preparation 27"}).data["count"] == 1


def test_planned_prerequisite_does_not_set_explicit_blocked_status(
    session_client, workspace, milestone_project, create_user
):
    state = State.objects.create(project=milestone_project, name="Planned", group="unstarted", color="#888888")
    today = timezone.localdate()
    source = Issue.objects.create(project=milestone_project, state=state, name="Material")
    target = Issue.objects.create(
        project=milestone_project, state=state, name="Assembly", start_date=today + timedelta(days=2)
    )
    IssueAssignee.objects.create(project=milestone_project, issue=target, assignee=create_user)
    IssueRelation.objects.create(
        project=milestone_project, issue=source, related_issue=target, relation_type="finish_to_start"
    )
    url = f"/api/workspaces/{workspace.slug}/users/{create_user.id}/work-plan/"
    assert session_client.get(url).data["sections"]["blocked"]["count"] == 0
    target.start_date = today
    target.save()
    blocked = session_client.get(url).data["sections"]["blocked"]
    assert blocked["count"] == 0
    assert blocked["items"] == []
