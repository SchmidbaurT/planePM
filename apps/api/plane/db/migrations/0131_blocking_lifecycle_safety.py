import importlib
from django.db import migrations

workflow = importlib.import_module("plane.db.migrations.0130_blocking_workflow")


class Migration(migrations.Migration):
    dependencies = [("db", "0130_blocking_workflow")]
    operations = [migrations.RunSQL(workflow.REVERSE_SQL + workflow.BLOCKING_SQL, workflow.REVERSE_SQL)]