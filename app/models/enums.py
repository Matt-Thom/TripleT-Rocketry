"""NAR/TRA domain enumerations for the Phase 1 schema.

See: wiki/concepts/phase1-implementation-plan.md
"""

from enum import IntEnum, StrEnum


class CertifyingBody(StrEnum):
    """Self-reported certifying organisation."""

    NAR = "NAR"
    TRA = "TRA"


class CertLevel(IntEnum):
    """NAR/TRA certification levels: L1=H–I, L2=J–L, L3=M–O."""

    LEVEL_1 = 1
    LEVEL_2 = 2
    LEVEL_3 = 3


class ImpulseClass(StrEnum):
    """NAR/TRA motor impulse classes A–O (total impulse doubles each step)."""

    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"
    F = "F"
    G = "G"
    H = "H"
    I = "I"  # noqa: E741
    J = "J"
    K = "K"
    L = "L"
    M = "M"
    N = "N"
    O = "O"  # noqa: E741


class PropellantType(StrEnum):
    """Common consumer-rocket propellant families."""

    BLACK_POWDER = "black_powder"
    APCP = "apcp"
    HYBRID = "hybrid"
    OTHER = "other"


class CertifyingOrg(StrEnum):
    """Organisation that certified a catalog motor."""

    NAR = "NAR"
    TRA = "TRA"
    BOTH = "BOTH"
    NONE = "NONE"


class RocketStatus(StrEnum):
    """Airframe lifecycle status."""

    FLIGHT_READY = "flight_ready"
    IN_BUILD = "in_build"
    DAMAGED = "damaged"
    RETIRED = "retired"


class RecoveryType(StrEnum):
    """Recovery device used on a configuration snapshot."""

    PARACHUTE = "parachute"
    STREAMER = "streamer"
    DUAL_DEPLOY = "dual_deploy"
    TUMBLE = "tumble"
    OTHER = "other"


class FlightOutcome(StrEnum):
    """Logged flight result. Soft taxonomy only — not a legal finding."""

    SUCCESSFUL = "successful"
    CATO = "cato"
    SEPARATION = "separation"
    RECOVERY_FAILURE = "recovery_failure"
    TREE = "tree"
    POWERLINE = "powerline"
    LOST = "lost"
    OTHER = "other"
