from collections import defaultdict
from datetime import date
import json

from django.db import connection


def lock_resource_workspace(workspace_id):
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"resource-capacity:{workspace_id}"])


def validate_resource_workspace(workspace_id):
    with connection.cursor() as cursor:
        cursor.execute("SELECT resource_validate_workspace(%s::uuid)", [str(workspace_id)])


def resource_error_response(exc):
    from rest_framework.response import Response

    cause = getattr(exc, "__cause__", None)
    diagnostic = getattr(cause, "diag", None)
    if getattr(diagnostic, "constraint_name", None) not in ("resource_capacity_guard", "resource_requirement_guard"):
        return None
    code = diagnostic.message_primary
    try:
        detail = json.loads(diagnostic.message_detail or "{}")
    except (ValueError, TypeError):
        detail = {}
    return Response(
        {"code": code, "error": code, **detail}, status=409 if code != "INVALID_RESOURCE_REQUIREMENT" else 400
    )


def capacity_segments(bookings):
    events = defaultdict(int)
    for start, end, percent in bookings:
        if start is None or end is None:
            continue
        if start > end or not 1 <= percent <= 100:
            raise ValueError("Invalid resource requirement")
        events[start.toordinal()] += percent
        events[end.toordinal() + 1] -= percent
    boundaries = sorted(events)
    used = 0
    segments = []
    for index, boundary in enumerate(boundaries[:-1]):
        used += events[boundary]
        if used:
            segments.append(
                {
                    "start_date": date.fromordinal(boundary),
                    "target_date": date.fromordinal(boundaries[index + 1] - 1),
                    "allocated_percent": used,
                }
            )
    return segments


def capacity_conflicts(bookings):
    return [segment for segment in capacity_segments(bookings) if segment["allocated_percent"] > 100]
