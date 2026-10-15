from django.db import migrations


def setup_blocking_states(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")
    Issue = apps.get_model("db", "Issue")
    Relation = apps.get_model("db", "IssueRelation")
    for project in Project.objects.filter(deleted_at__isnull=True).iterator():
        states = State.objects.filter(project_id=project.id, deleted_at__isnull=True)
        candidates = list(states.filter(name__iexact="Blocked")) + list(states.filter(name__iexact="Blockiert"))
        candidates = list({state.id: state for state in candidates}.values())
        if len(candidates) > 1 or (candidates and (candidates[0].group != "started" or candidates[0].default)):
            raise RuntimeError(f"BLOCKING_SETUP_REQUIRED project={project.id}: resolve ambiguous blocked status first")
        blocked = candidates[0] if candidates else State.objects.create(project_id=project.id, workspace_id=project.workspace_id, name="Blocked", slug="blocked", color="#D14343", group="started", sequence=60000)
        State.objects.filter(pk=blocked.id).update(is_blocked=True, color="#D14343")
        release = states.filter(group="backlog").order_by("sequence", "id").first()
        if release is None:
            release = State.objects.create(project_id=project.id, workspace_id=project.workspace_id, name="Backlog", slug="backlog", color="#60646C", group="backlog", sequence=15000)
        Project.objects.filter(pk=project.id).update(blocked_release_state_id=release.id)
        Issue._base_manager.filter(project_id=project.id, state_id=blocked.id).update(blocking_legacy=True)
        blocked_ids = Relation._base_manager.filter(project_id=project.id, relation_type="blocked_by", deleted_at__isnull=True).values("issue_id")
        Issue._base_manager.filter(project_id=project.id, id__in=blocked_ids, deleted_at__isnull=True, archived_at__isnull=True, state__group__in=["backlog", "unstarted", "started"]).update(state_id=blocked.id, blocking_legacy=False)


BLOCKING_SQL = r"""
CREATE OR REPLACE FUNCTION blocking_reconcile_workspace(wid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE changed record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('resource-capacity:' || wid::text, 0));
  UPDATE issue_relations r SET deleted_at=clock_timestamp(), updated_at=clock_timestamp()
  WHERE r.workspace_id=wid AND r.relation_type='blocked_by' AND r.deleted_at IS NULL
    AND (NOT EXISTS (SELECT 1 FROM issues b JOIN states s ON s.id=b.state_id JOIN projects p ON p.id=b.project_id
        WHERE b.id=r.related_issue_id AND b.deleted_at IS NULL AND b.archived_at IS NULL
        AND p.deleted_at IS NULL AND p.archived_at IS NULL AND NOT b.is_draft
        AND s.deleted_at IS NULL AND s."group" NOT IN ('completed','cancelled','triage'))
      OR NOT EXISTS (SELECT 1 FROM issues a JOIN states s ON s.id=a.state_id JOIN projects p ON p.id=a.project_id
        WHERE a.id=r.issue_id AND a.deleted_at IS NULL AND a.archived_at IS NULL
        AND p.deleted_at IS NULL AND p.archived_at IS NULL AND NOT a.is_draft
        AND s."group" NOT IN ('completed','cancelled','triage')));
  FOR changed IN
    SELECT a.id, a.project_id, a.state_id AS old_state, p.blocked_release_state_id AS next_state
    FROM issues a JOIN states s ON s.id=a.state_id JOIN projects p ON p.id=a.project_id
    JOIN states target ON target.id=p.blocked_release_state_id AND target.project_id=p.id AND target."group"='backlog' AND target.deleted_at IS NULL
    WHERE a.workspace_id=wid AND s.is_blocked AND NOT a.blocking_legacy
      AND a.deleted_at IS NULL AND a.archived_at IS NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM issue_relations r WHERE r.issue_id=a.id AND r.relation_type='blocked_by' AND r.deleted_at IS NULL)
  LOOP
    UPDATE issues SET state_id=changed.next_state, completed_at=NULL, updated_at=clock_timestamp() WHERE id=changed.id;
    INSERT INTO issue_activities(id,created_at,updated_at,workspace_id,project_id,issue_id,verb,field,old_value,new_value,old_identifier,new_identifier,comment,attachments)
      VALUES(gen_random_uuid(),clock_timestamp(),clock_timestamp(),wid,changed.project_id,changed.id,'updated','state','Blocked','Backlog',changed.old_state,changed.next_state,'Automatic blocker release',ARRAY[]::varchar[]);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION blocking_lifecycle_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='issues' AND TG_OP='UPDATE' THEN
   IF NEW.deleted_at IS NULL AND NEW.archived_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM states WHERE id=NEW.state_id AND is_blocked) THEN RETURN NULL; END IF;
    IF NEW.state_id IS DISTINCT FROM OLD.state_id
      AND EXISTS (SELECT 1 FROM states WHERE id=OLD.state_id AND is_blocked)
      AND EXISTS (SELECT 1 FROM states WHERE id=NEW.state_id AND "group" NOT IN ('cancelled'))
      AND EXISTS (SELECT 1 FROM issue_relations WHERE issue_id=NEW.id AND relation_type='blocked_by' AND deleted_at IS NULL)
    THEN RAISE EXCEPTION 'BLOCKING_ACTIVE'; END IF;
   END IF;
  END IF;
  IF TG_OP='DELETE' THEN PERFORM blocking_reconcile_workspace(OLD.workspace_id);
  ELSE PERFORM blocking_reconcile_workspace(NEW.workspace_id); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION blocking_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.state_id IS DISTINCT FROM OLD.state_id THEN
    IF EXISTS (SELECT 1 FROM issues a JOIN states s ON s.id=a.state_id WHERE a.id=NEW.id AND s.is_blocked AND NOT a.blocking_legacy AND a.deleted_at IS NULL AND a.archived_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM issue_relations r WHERE r.issue_id=NEW.id AND r.relation_type='blocked_by' AND r.deleted_at IS NULL)
    THEN RAISE EXCEPTION 'BLOCKING_REQUIRED'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER blocking_issue_lifecycle AFTER UPDATE OF state_id,archived_at,deleted_at,is_draft OR DELETE ON issues
  FOR EACH ROW EXECUTE FUNCTION blocking_lifecycle_changed();
CREATE TRIGGER blocking_relation_lifecycle AFTER UPDATE OF deleted_at OR DELETE ON issue_relations
  FOR EACH ROW EXECUTE FUNCTION blocking_lifecycle_changed();
CREATE TRIGGER blocking_project_lifecycle AFTER UPDATE OF archived_at,deleted_at OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION blocking_lifecycle_changed();
CREATE TRIGGER blocking_state_lifecycle AFTER UPDATE OF "group",deleted_at ON states
  FOR EACH ROW EXECUTE FUNCTION blocking_lifecycle_changed();
CREATE CONSTRAINT TRIGGER blocking_requires_source AFTER INSERT OR UPDATE OF state_id ON issues
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION blocking_state_guard();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS blocking_requires_source ON issues;
DROP TRIGGER IF EXISTS blocking_state_lifecycle ON states;
DROP TRIGGER IF EXISTS blocking_project_lifecycle ON projects;
DROP TRIGGER IF EXISTS blocking_relation_lifecycle ON issue_relations;
DROP TRIGGER IF EXISTS blocking_issue_lifecycle ON issues;
DROP FUNCTION IF EXISTS blocking_state_guard();
DROP FUNCTION IF EXISTS blocking_lifecycle_changed();
DROP FUNCTION IF EXISTS blocking_reconcile_workspace(uuid);
"""


class Migration(migrations.Migration):
    dependencies = [("db", "0129_issue_blocking")]
    operations = [migrations.RunPython(setup_blocking_states, migrations.RunPython.noop), migrations.RunSQL(BLOCKING_SQL, REVERSE_SQL)]