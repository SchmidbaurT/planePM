from django.db import migrations


SQL = """
CREATE FUNCTION resource_issue_project_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.workspace_id = OLD.workspace_id THEN
        UPDATE issue_resource_requirements SET project_id = NEW.project_id, updated_at = CURRENT_TIMESTAMP
        WHERE issue_id = NEW.id AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER resource_issue_project_sync AFTER UPDATE OF project_id ON issues
FOR EACH ROW EXECUTE FUNCTION resource_issue_project_sync();
"""


class Migration(migrations.Migration):
    dependencies = [("db", "0124_resource_capacity_guard")]
    operations = [migrations.RunSQL(SQL, reverse_sql="""
        DROP TRIGGER resource_issue_project_sync ON issues;
        DROP FUNCTION resource_issue_project_sync();
    """)]