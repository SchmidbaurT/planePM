from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier

import pytest
from django.db import IntegrityError, connections, transaction
from django.db.models.deletion import RestrictedError

from plane.db.models import Issue, IssueResourceRequirement, ResourceBlackout, State, WorkspaceResource
from plane.tests.factories import ProjectFactory, WorkspaceFactory

pytestmark = pytest.mark.usefixtures("resource_database_guard")


@pytest.fixture
def schedule():
    workspace = WorkspaceFactory()
    project = ProjectFactory(workspace=workspace)
    state = State.objects.create(project=project, workspace=workspace, name="Open", group="started")
    resource = WorkspaceResource.objects.create(workspace=workspace, name="Paint booth")
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
    return workspace, project, state, resource, issues


def assign(schedule, issue, percent=100):
    workspace, project, _, resource, _ = schedule
    return IssueResourceRequirement.objects.create(
        workspace=workspace, project=project, resource=resource, issue=issue, allocation_percent=percent
    )


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_database_partial_capacity_and_direct_update(schedule):
    *_, issues = schedule
    assign(schedule, issues[0], 60)
    second = assign(schedule, issues[1], 40)
    with pytest.raises(IntegrityError, match="RESOURCE_CAPACITY_EXCEEDED"):
        IssueResourceRequirement.objects.filter(pk=second.pk).update(allocation_percent=41)
    second.refresh_from_db()
    assert second.allocation_percent == 40


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_release_reopen_and_maintenance(schedule):
    workspace, project, _, resource, issues = schedule
    assign(schedule, issues[0])
    completed = State.objects.create(workspace=workspace, project=project, name="Done", group="completed")
    Issue.objects.filter(pk=issues[0].pk).update(state=completed)
    assign(schedule, issues[1])
    with pytest.raises(IntegrityError, match="RESOURCE_CAPACITY_EXCEEDED"):
        Issue.objects.filter(pk=issues[0].pk).update(state=schedule[2])
    with pytest.raises(IntegrityError, match="RESOURCE_CAPACITY_EXCEEDED"):
        ResourceBlackout.objects.create(
            workspace=workspace, resource=resource, start_date=date(2026, 10, 3), target_date=date(2026, 10, 4)
        )


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_final_batch_slot_swap(schedule):
    *_, issues = schedule
    Issue.objects.filter(pk=issues[1].pk).update(start_date=date(2026, 10, 4), target_date=date(2026, 10, 6))
    assign(schedule, issues[0])
    assign(schedule, issues[1])
    with transaction.atomic():
        Issue.objects.filter(pk=issues[0].pk).update(start_date=date(2026, 10, 4), target_date=date(2026, 10, 6))
        Issue.objects.filter(pk=issues[1].pk).update(start_date=date(2026, 10, 1), target_date=date(2026, 10, 3))
    with pytest.raises(IntegrityError, match="RESOURCE_CAPACITY_EXCEEDED"), transaction.atomic():
        Issue.objects.filter(pk=issues[1].pk).update(start_date=date(2026, 10, 4), target_date=date(2026, 10, 6))


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_concurrent_assignments_cannot_overbook(schedule):
    *_, issues = schedule
    barrier = Barrier(2)

    def book(issue):
        connections.close_all()
        try:
            barrier.wait(timeout=10)
            with transaction.atomic():
                assign(schedule, issue)
            return "booked"
        except IntegrityError:
            return "conflict"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(book, issues))
    assert sorted(results) == ["booked", "conflict"]
    assert IssueResourceRequirement.objects.count() == 1


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_same_workspace_move_preserves_booking(schedule):
    workspace, _, _, resource, issues = schedule
    requirement = assign(schedule, issues[0])
    target = ProjectFactory(workspace=workspace, name="Move target", identifier="MT")
    state = State.objects.create(workspace=workspace, project=target, name="Moved active", group="started")
    Issue.objects.filter(pk=issues[0].pk).update(project=target, state=state)
    requirement.refresh_from_db()
    assert requirement.project_id == target.id
    assert requirement.resource_id == resource.id
    with pytest.raises(IntegrityError, match="RESOURCE_CAPACITY_EXCEEDED"):
        assign(schedule, issues[1])


@pytest.mark.unit
@pytest.mark.django_db(transaction=True)
def test_workspace_cascade_preserves_direct_resource_protection(schedule):
    workspace, _, _, resource, issues = schedule
    assign(schedule, issues[0])
    ResourceBlackout.objects.create(
        workspace=workspace, resource=resource, start_date=date(2026, 11, 1), target_date=date(2026, 11, 2)
    )
    with pytest.raises(RestrictedError):
        resource.delete(soft=False)
    workspace.delete(soft=False)
    assert not WorkspaceResource.objects.filter(pk=resource.pk).exists()
    assert not IssueResourceRequirement.objects.exists()


@pytest.mark.unit
@pytest.mark.django_db
def test_prefetched_resource_field_has_bounded_queries(schedule, django_assert_num_queries):
    from plane.api.serializers.issue import IssueSerializer

    *_, issues = schedule
    assign(schedule, issues[0], 50)
    assign(schedule, issues[1], 50)
    queryset = Issue.objects.filter(pk__in=[issue.pk for issue in issues]).prefetch_related("resource_requirements")
    with django_assert_num_queries(2):
        data = IssueSerializer(queryset, many=True, fields=["id", "resource_requirements"]).data
    assert len(data) == 2
    assert all(item["resource_requirements"][0]["allocation_percent"] == 50 for item in data)
