from datetime import date

import pytest
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Issue, Module, Page, ProjectMember, ProjectPage, State, WorkspaceMember
from plane.tests.factories import ProjectFactory
from plane.utils.project_templates import available_templates, capture_project_template, instantiate_project_template


@pytest.fixture
def source_project(workspace, create_user):
    project = ProjectFactory(workspace=workspace, name="Template source", identifier="SOURCE", module_view=True)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(project=project, name="Template open", color="#888888", group="backlog")
    Issue.objects.create(
        project=project, state=state, name="Parent", start_date=date(2026, 10, 1), target_date=date(2026, 10, 3)
    )
    Module.objects.create(
        project=project, name="Preparation", start_date=date(2026, 9, 28), target_date=date(2026, 10, 2)
    )
    page = Page.objects.create(
        workspace=workspace,
        owned_by=create_user,
        name="Instructions",
        description_json={
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "Keep this"}]},
                {"type": "image", "attrs": {"src": "private-file"}},
            ],
        },
        description_html="<p>Keep this</p><img src='private-file'>",
    )
    ProjectPage.objects.create(project=project, page=page, workspace=workspace)
    return project


@pytest.mark.unit
@pytest.mark.django_db
def test_snapshot_preserves_plan_independently_of_source(source_project, create_user):
    template = capture_project_template(source_project, create_user, "Small series")
    assert template.created_by_id == create_user.id
    assert template.snapshot["base_date"] == "2026-09-28"
    assert template.snapshot["issues"][0]["name"] == "Parent"
    Issue.objects.filter(project=source_project).update(name="Changed")
    template.refresh_from_db()
    assert template.snapshot["issues"][0]["name"] == "Parent"
    assert "private-file" not in str(template.snapshot["pages"])
    assert template.snapshot["pages"][0]["description_html"] == "<p>Keep this</p>"


@pytest.mark.unit
@pytest.mark.django_db
def test_template_permissions_and_visibility(source_project, create_user, workspace):
    from plane.tests.factories import UserFactory

    member = UserFactory(username="template-member")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    private = capture_project_template(source_project, create_user, "Private")
    shared = capture_project_template(source_project, create_user, "Shared", is_shared=True)
    assert list(available_templates(workspace, member).values_list("id", flat=True)) == [shared.id]
    assert private in available_templates(workspace, create_user)
    with pytest.raises(PermissionDenied):
        capture_project_template(source_project, member, "Forbidden")


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
@pytest.mark.usefixtures("resource_database_guard")
def test_instantiation_remaps_relationships_and_resets_progress(source_project, create_user):
    from plane.db.models import Cycle, CycleIssue, IssueRelation, ModuleIssue, ProjectPage

    parent = Issue.objects.get(project=source_project)
    done = State.objects.create(project=source_project, name="Done", color="#888888", group="completed")
    child = Issue.objects.create(
        project=source_project,
        name="Child",
        parent=parent,
        state=done,
        start_date=date(2026, 10, 2),
        target_date=date(2026, 10, 4),
    )
    IssueRelation.objects.create(project=source_project, issue=child, related_issue=parent, relation_type="blocked_by")
    IssueRelation.objects.create(project=source_project, issue=parent, related_issue=child, relation_type="finish_to_start")
    ModuleIssue.objects.create(project=source_project, module=Module.objects.get(project=source_project), issue=child)
    cycle = Cycle.objects.create(project=source_project, name="Cycle", owned_by=create_user)
    CycleIssue.objects.create(project=source_project, cycle=cycle, issue=child)
    template = capture_project_template(source_project, create_user, "Complete")
    project = instantiate_project_template(
        template, create_user, {"name": "Series 1", "identifier": "SERIES1"}, date(2026, 11, 1)
    )
    copied = {issue.name: issue for issue in Issue.objects.filter(project=project).select_related("state")}
    assert copied["Parent"].start_date == date(2026, 11, 4)
    assert copied["Child"].parent_id == copied["Parent"].id
    assert copied["Child"].completed_at is None
    assert copied["Child"].state.group == "backlog"
    assert copied["Parent"].id != parent.id
    assert IssueRelation.objects.get(project=project, relation_type="finish_to_start").related_issue_id == copied["Child"].id
    assert not IssueRelation.objects.filter(project=project, relation_type="blocked_by").exists()
    assert IssueRelation.objects.filter(project=source_project, relation_type="blocked_by").exists()
    assert ModuleIssue.objects.get(project=project).issue_id == copied["Child"].id
    assert CycleIssue.objects.get(project=project).issue_id == copied["Child"].id
    assert ProjectPage.objects.get(project=project).page_id != ProjectPage.objects.get(project=source_project).page_id


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
@pytest.mark.usefixtures("resource_database_guard")
def test_conflicting_resource_rolls_back_entire_new_project(source_project, create_user):
    from django.db import IntegrityError
    from plane.db.models import IssueResourceRequirement, Project, WorkspaceResource

    resource = WorkspaceResource.objects.create(workspace=source_project.workspace, name="Paint booth")
    issue = Issue.objects.get(project=source_project)
    IssueResourceRequirement.objects.create(project=source_project, issue=issue, resource=resource)
    template = capture_project_template(source_project, create_user, "Booked")
    with pytest.raises(IntegrityError, match="RESOURCE_CAPACITY_EXCEEDED"):
        instantiate_project_template(
            template, create_user, {"name": "Conflict", "identifier": "CONFLICT"}, date(2026, 9, 28)
        )
    assert not Project.objects.filter(name="Conflict").exists()
    assert IssueResourceRequirement.objects.count() == 1


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
@pytest.mark.usefixtures("resource_database_guard")
def test_template_reuse_optional_assignees_and_inactive_members(source_project, create_user):
    from plane.db.models import IssueAssignee, ProjectUserProperty
    from plane.tests.factories import UserFactory

    member = UserFactory(username="series-worker")
    membership = WorkspaceMember.objects.create(workspace=source_project.workspace, member=member, role=15)
    ProjectMember.objects.create(project=source_project, member=member, role=15)
    IssueAssignee.objects.create(
        project=source_project, issue=Issue.objects.get(project=source_project), assignee=member
    )
    template = capture_project_template(source_project, create_user, "Reusable")
    for index in range(5):
        project = instantiate_project_template(
            template,
            create_user,
            {"name": f"Series {index}", "identifier": f"SER{index}"},
            date(2026, 11, 1),
            copy_assignees=index > 0,
        )
        assert IssueAssignee.objects.filter(project=project).count() == (0 if index == 0 else 1)
        if index:
            assert ProjectUserProperty.objects.filter(project=project, user=member).exists()
    membership.is_active = False
    membership.save()
    project = instantiate_project_template(
        template, create_user, {"name": "Inactive", "identifier": "INACTIVE"}, date(2026, 12, 1), copy_assignees=True
    )
    assert not IssueAssignee.objects.filter(project=project).exists()


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
@pytest.mark.usefixtures("resource_database_guard")
def test_cycle_dates_preserve_local_day_across_daylight_saving_time(source_project, create_user):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from plane.db.models import Cycle

    Issue.objects.filter(project=source_project).delete(soft=False)
    Module.objects.filter(project=source_project).delete(soft=False)
    source_project.timezone = "Europe/Berlin"
    source_project.save()
    zone = ZoneInfo("Europe/Berlin")
    Cycle.objects.create(
        project=source_project,
        name="Local dates",
        timezone="Europe/Berlin",
        owned_by=create_user,
        start_date=datetime(2026, 10, 1, 0, 0, tzinfo=zone),
        end_date=datetime(2026, 10, 3, 0, 0, tzinfo=zone),
    )
    template = capture_project_template(source_project, create_user, "Clock change")
    assert template.snapshot["base_date"] == "2026-10-01"
    project = instantiate_project_template(
        template, create_user, {"name": "November", "identifier": "NOV"}, date(2026, 11, 1)
    )
    cycle = Cycle.objects.get(project=project)
    assert cycle.start_date.astimezone(zone) == datetime(2026, 11, 1, 0, 0, tzinfo=zone)
    assert cycle.end_date.astimezone(zone) == datetime(2026, 11, 3, 0, 0, tzinfo=zone)


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
@pytest.mark.usefixtures("resource_database_guard")
def test_cycle_uses_its_own_timezone_when_project_timezone_differs(source_project, create_user):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from plane.db.models import Cycle

    Issue.objects.filter(project=source_project).delete(soft=False)
    Module.objects.filter(project=source_project).delete(soft=False)
    source_project.timezone = "Europe/Berlin"
    source_project.save()
    zone = ZoneInfo("America/New_York")
    Cycle.objects.create(
        project=source_project,
        name="Separate calendar",
        owned_by=create_user,
        timezone="America/New_York",
        start_date=datetime(2026, 3, 10, 0, 0, tzinfo=zone),
        end_date=datetime(2026, 3, 12, 0, 0, tzinfo=zone),
    )
    template = capture_project_template(source_project, create_user, "Separate timezone")
    assert template.snapshot["base_date"] == "2026-03-10"
    project = instantiate_project_template(
        template, create_user, {"name": "April", "identifier": "APR"}, date(2026, 4, 10)
    )
    cycle = Cycle.objects.get(project=project)
    assert cycle.start_date.astimezone(zone) == datetime(2026, 4, 10, 0, 0, tzinfo=zone)
    assert cycle.end_date.astimezone(zone) == datetime(2026, 4, 12, 0, 0, tzinfo=zone)
