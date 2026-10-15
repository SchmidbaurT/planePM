from datetime import date

import pytest

from plane.utils.resource_booking import capacity_conflicts, capacity_segments


@pytest.mark.unit
@pytest.mark.parametrize("percent,conflict", [(40, False), (41, True), (100, True)])
def test_partial_capacity(percent, conflict):
    bookings = [(date(2026, 10, 1), date(2026, 10, 3), 60), (date(2026, 10, 2), date(2026, 10, 4), percent)]
    assert bool(capacity_conflicts(bookings)) is conflict


@pytest.mark.unit
def test_inclusive_boundary_and_next_day():
    first = (date(2026, 10, 1), date(2026, 10, 3), 100)
    assert capacity_conflicts([first, (date(2026, 10, 3), date(2026, 10, 4), 100)])
    assert not capacity_conflicts([first, (date(2026, 10, 4), date(2026, 10, 5), 100)])


@pytest.mark.unit
def test_pending_and_maximum_date():
    assert capacity_segments([(None, date(2026, 10, 3), 100)]) == []
    assert capacity_segments([(date.max, date.max, 100)])[0]["target_date"] == date.max


@pytest.mark.unit
def test_three_requirements_exceed_capacity():
    assert capacity_conflicts([(date(2026, 10, 1), date(2026, 10, 1), value) for value in (50, 50, 1)])


@pytest.mark.unit
@pytest.mark.parametrize("percent", [0, 101, -1])
def test_invalid_percentage(percent):
    with pytest.raises(ValueError):
        capacity_segments([(date(2026, 10, 1), date(2026, 10, 1), percent)])
