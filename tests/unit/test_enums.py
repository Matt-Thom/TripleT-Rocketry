"""Unit tests for NAR/TRA domain enums.

See: wiki/concepts/phase1-implementation-plan.md
"""

from app.models.enums import (
    CertLevel,
    CertifyingBody,
    FlightOutcome,
    ImpulseClass,
)


def test_impulse_class_covers_a_through_o() -> None:
    """Impulse classes A–O match the NAR/TRA total-impulse table."""
    letters = [member.value for member in ImpulseClass]
    expected = list("ABCDEFGHIJKLMNO")
    assert letters == expected


def test_impulse_class_has_fifteen_members() -> None:
    """There are exactly fifteen NAR/TRA impulse letters A–O."""
    assert len(ImpulseClass) == 15


def test_cert_levels_are_one_two_three() -> None:
    """NAR/TRA certification levels are 1, 2, and 3."""
    assert CertLevel.LEVEL_1.value == 1
    assert CertLevel.LEVEL_2.value == 2
    assert CertLevel.LEVEL_3.value == 3


def test_certifying_body_includes_nar_and_tra() -> None:
    """Supported certifying bodies are NAR and TRA."""
    assert CertifyingBody.NAR.value == "NAR"
    assert CertifyingBody.TRA.value == "TRA"


def test_flight_outcome_includes_failure_modes() -> None:
    """Flight outcomes include success and common failure modes."""
    values = {member.value for member in FlightOutcome}
    assert "successful" in values
    assert "cato" in values
    assert "separation" in values
    assert "recovery_failure" in values
