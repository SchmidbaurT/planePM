import pytest

from plane.api.serializers.project import ProjectCreateSerializer, ProjectUpdateSerializer
from plane.api.serializers.project import ProjectSerializer as PublicProjectSerializer
from plane.app.serializers.project import ProjectSerializer as AppProjectSerializer
from plane.tests.factories import ProjectFactory


pytestmark = [pytest.mark.unit, pytest.mark.django_db]

SPECIAL_NAMES = [
    "Montage - Halle A",
    "Lackierung (A+B) & Endkontrolle",
    "\u00dcberholung \u2013 M\u00fcnchen #1: 50% / F&E",
    "<Versuch> @Werk; 'Sonderprojekt'!",
]


@pytest.mark.parametrize("serializer_type", [AppProjectSerializer, ProjectCreateSerializer, PublicProjectSerializer])
@pytest.mark.parametrize("name", SPECIAL_NAMES)
def test_create_project_preserves_special_characters(workspace, serializer_type, name):
    serializer = serializer_type(
        data={"name": name, "identifier": "SPECIAL"}, context={"workspace_id": workspace.id}
    )
    assert serializer.is_valid(), serializer.errors
    project = serializer.save()
    project.refresh_from_db()
    assert project.name == name
    assert project.identifier == "SPECIAL"


@pytest.mark.parametrize("serializer_type", [AppProjectSerializer, ProjectUpdateSerializer, PublicProjectSerializer])
@pytest.mark.parametrize("name", SPECIAL_NAMES)
def test_rename_project_preserves_special_characters(workspace, serializer_type, name):
    project = ProjectFactory(workspace=workspace, name="Original project", identifier="ORIGINAL")
    serializer = serializer_type(project, data={"name": name}, partial=True, context={"workspace_id": workspace.id})
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    project.refresh_from_db()
    assert project.name == name
    assert project.identifier == "ORIGINAL"


@pytest.mark.parametrize(
    "serializer_type", [AppProjectSerializer, ProjectCreateSerializer, ProjectUpdateSerializer, PublicProjectSerializer]
)
def test_identifier_restrictions_are_unchanged(workspace, serializer_type):
    serializer = serializer_type(
        data={"name": "Project (A+B)", "identifier": "A+B"}, context={"workspace_id": workspace.id}
    )
    assert not serializer.is_valid()
    assert "special" in str(serializer.errors).lower()


@pytest.mark.parametrize("serializer_type", [AppProjectSerializer, ProjectCreateSerializer, PublicProjectSerializer])
@pytest.mark.parametrize("name", ["", "   ", "A" * 256])
def test_name_remains_required_and_length_limited(workspace, serializer_type, name):
    serializer = serializer_type(
        data={"name": name, "identifier": "SPECIAL"}, context={"workspace_id": workspace.id}
    )
    assert not serializer.is_valid()
    assert "name" in serializer.errors


def test_app_rejects_duplicate_special_character_name(workspace):
    ProjectFactory(workspace=workspace, name="Production (A+B)", identifier="FIRST")
    serializer = AppProjectSerializer(
        data={"name": "Production (A+B)", "identifier": "SECOND"}, context={"workspace_id": workspace.id}
    )
    assert not serializer.is_valid()
    assert "PROJECT_NAME_ALREADY_EXIST" in str(serializer.errors)