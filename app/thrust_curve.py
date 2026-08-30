"""Thrust-curve helpers for TripleT-Rocketry.

A small, stdlib-only module for parsing + interpolating solid-motor
thrust-curve data. The shape we accept is the common CSV form
(time_s, thrust_N) one pair per row; we return a sorted series and
support piecewise-linear interpolation between sample points.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ThrustPoint:
    time_s: float
    thrust_n: float


def parse_csv(text: str) -> list[ThrustPoint]:
    """Parse a CSV-style thrust-curve dump.

    Lines starting with '#' and blank lines are skipped. The first
    non-skipped line is treated as a header if it does not look like
    two floats. Float parsing is silent — anything we can't parse as
    two numbers is dropped.
    """
    points: list[ThrustPoint] = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.replace(",", " ").split()
        if len(parts) < 2:
            continue
        try:
            t, f = float(parts[0]), float(parts[1])
        except ValueError:
            continue  # likely a header line; skip silently
        points.append(ThrustPoint(time_s=t, thrust_n=f))
    return points


def interpolate(curve: list[ThrustPoint], t: float) -> float:
    """Piecewise-linear interpolation; clamps to the endpoints outside
    the sampled range so callers never see a KeyError or IndexError.
    """
    if not curve:
        return 0.0
    ordered = sorted(curve, key=lambda p: p.time_s)
    if t <= ordered[0].time_s:
        return ordered[0].thrust_n
    if t >= ordered[-1].time_s:
        return ordered[-1].thrust_n
    for a, b in zip(ordered, ordered[1:]):
        if a.time_s <= t <= b.time_s:
            span = b.time_s - a.time_s
            if span <= 0:
                return b.thrust_n
            frac = (t - a.time_s) / span
            return a.thrust_n + frac * (b.thrust_n - a.thrust_n)
    return ordered[-1].thrust_n


def total_impulse_n_s(curve: list[ThrustPoint]) -> float:
    """Trapezoidal-Riemann total impulse over the curve.

    Returns the integral of thrust (N) over time (s), which is total
    impulse in N*s — divide by gravity (9.80665 m/s^2) for N*s-of-impulse
    in physical units.
    """
    ordered = sorted(curve, key=lambda p: p.time_s)
    if len(ordered) < 2:
        return 0.0
    total = 0.0
    for a, b in zip(ordered, ordered[1:]):
        total += 0.5 * (a.thrust_n + b.thrust_n) * (b.time_s - a.time_s)
    return total


__all__ = ["ThrustPoint", "parse_csv", "interpolate", "total_impulse_n_s"]