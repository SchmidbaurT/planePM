from django.db import migrations


SQL = """
CREATE FUNCTION resource_workspace_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_key text;
BEGIN
    FOR workspace_key IN
        SELECT DISTINCT value FROM unnest(ARRAY[
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD)->>'workspace_id' END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW)->>'workspace_id' END
        ]) value WHERE value IS NOT NULL ORDER BY value
    LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended('resource-capacity:' || workspace_key, 0));
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION resource_validate_workspace(workspace_key uuid) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE conflict record;
BEGIN
    IF EXISTS (
        SELECT 1 FROM issue_resource_requirements q
        JOIN issues i ON i.id = q.issue_id
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN states s ON s.id = i.state_id
        JOIN workspace_resources r ON r.id = q.resource_id
        WHERE (q.workspace_id = workspace_key OR i.workspace_id = workspace_key OR r.workspace_id = workspace_key)
          AND q.deleted_at IS NULL
        AND (q.workspace_id <> i.workspace_id OR q.workspace_id <> r.workspace_id OR q.project_id <> i.project_id
            OR q.workspace_id <> p.workspace_id OR s.workspace_id <> i.workspace_id OR s.project_id <> i.project_id
               OR (i.start_date IS NOT NULL AND i.target_date IS NOT NULL AND i.start_date > i.target_date))
    ) OR EXISTS (
        SELECT 1 FROM resource_blackouts b JOIN workspace_resources r ON r.id = b.resource_id
        WHERE b.workspace_id = workspace_key AND b.deleted_at IS NULL AND b.workspace_id <> r.workspace_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'resource_requirement_guard',
            MESSAGE = 'INVALID_RESOURCE_REQUIREMENT';
    END IF;

    WITH bookings AS (
        SELECT q.resource_id, i.start_date, i.target_date, q.allocation_percent::integer AS percent,
               r.archived_at, r.deleted_at AS resource_deleted
        FROM issue_resource_requirements q
        JOIN issues i ON i.id = q.issue_id
        JOIN projects p ON p.id = i.project_id
        JOIN states s ON s.id = i.state_id
        JOIN workspace_resources r ON r.id = q.resource_id
        WHERE q.workspace_id = workspace_key AND q.deleted_at IS NULL
          AND i.deleted_at IS NULL AND i.archived_at IS NULL AND NOT i.is_draft
          AND p.deleted_at IS NULL AND p.archived_at IS NULL
          AND s.deleted_at IS NULL AND NOT s.is_triage AND s."group" NOT IN ('completed', 'cancelled')
          AND i.start_date IS NOT NULL AND i.target_date IS NOT NULL AND i.start_date <= i.target_date
        UNION ALL
        SELECT b.resource_id, b.start_date, b.target_date, 100, NULL::timestamptz, NULL::timestamptz
        FROM resource_blackouts b WHERE b.workspace_id = workspace_key AND b.deleted_at IS NULL
    ), events AS (
        SELECT resource_id, start_date AS day, percent AS delta FROM bookings
        UNION ALL SELECT resource_id, target_date + 1, -percent FROM bookings
    ), usage AS (
        SELECT resource_id, day, SUM(SUM(delta)) OVER (PARTITION BY resource_id ORDER BY day) AS percent
        FROM events GROUP BY resource_id, day
    )
    SELECT resource_id, day, percent INTO conflict FROM usage WHERE percent > 100 ORDER BY day, resource_id LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'resource_capacity_guard',
            MESSAGE = 'RESOURCE_CAPACITY_EXCEEDED',
            DETAIL = json_build_object('resource_id', conflict.resource_id, 'date', conflict.day,
                                       'allocated_percent', conflict.percent)::text;
    END IF;

    SELECT q.resource_id INTO conflict
    FROM issue_resource_requirements q
    JOIN issues i ON i.id = q.issue_id JOIN projects p ON p.id = i.project_id JOIN states s ON s.id = i.state_id
    JOIN workspace_resources r ON r.id = q.resource_id
    WHERE q.workspace_id = workspace_key AND q.deleted_at IS NULL
      AND i.deleted_at IS NULL AND i.archived_at IS NULL AND NOT i.is_draft
      AND p.deleted_at IS NULL AND p.archived_at IS NULL AND s.deleted_at IS NULL AND NOT s.is_triage
      AND s."group" NOT IN ('completed', 'cancelled') AND i.start_date IS NOT NULL
      AND i.target_date >= CURRENT_DATE AND i.start_date <= i.target_date
      AND (r.archived_at IS NOT NULL OR r.deleted_at IS NOT NULL) LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'resource_requirement_guard',
            MESSAGE = 'RESOURCE_IN_USE', DETAIL = json_build_object('resource_id', conflict.resource_id)::text;
    END IF;
END;
$$;

CREATE FUNCTION resource_capacity_check() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE workspace_key text;
BEGIN
    FOR workspace_key IN
        SELECT DISTINCT value FROM unnest(ARRAY[
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD)->>'workspace_id' END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW)->>'workspace_id' END
        ]) value WHERE value IS NOT NULL ORDER BY value
    LOOP
        PERFORM resource_validate_workspace(workspace_key::uuid);
    END LOOP;
    RETURN NULL;
END;
$$;
"""

TABLES = {
    "issue_resource_requirements": "INSERT OR UPDATE OR DELETE",
    "resource_blackouts": "INSERT OR UPDATE OR DELETE",
    "workspace_resources": "UPDATE OR DELETE",
    "issues": (
        "UPDATE OF start_date, target_date, state_id, archived_at, deleted_at, "
        "is_draft, project_id, workspace_id OR DELETE"
    ),
    "projects": "UPDATE OF archived_at, deleted_at, workspace_id OR DELETE",
    "states": 'UPDATE OF "group", is_triage, deleted_at, project_id, workspace_id OR DELETE',
}

for table, events in TABLES.items():
    SQL += f"""
CREATE TRIGGER {table}_resource_lock BEFORE {events} ON {table}
FOR EACH ROW EXECUTE FUNCTION resource_workspace_lock();
CREATE CONSTRAINT TRIGGER {table}_resource_check AFTER {events} ON {table}
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resource_capacity_check();
"""

REVERSE = (
    "\n".join(
        f"DROP TRIGGER IF EXISTS {table}_resource_check ON {table}; "
        f"DROP TRIGGER IF EXISTS {table}_resource_lock ON {table};"
        for table in TABLES
    )
    + """
DROP FUNCTION resource_capacity_check();
DROP FUNCTION resource_validate_workspace(uuid);
DROP FUNCTION resource_workspace_lock();
"""
)


class Migration(migrations.Migration):
    dependencies = [("db", "0123_workspace_resources")]
    operations = [migrations.RunSQL(SQL, reverse_sql=REVERSE)]
