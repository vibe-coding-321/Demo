# GravityProto: Increase Max Speed & Shrink Planet Radii

## Changes

- [x] Increase `MAX_SPEED` from 9.0 to 25.0 (line 7)
- [x] Shrink planet radii by 0.75x — `radius = baseRadius * Math.sqrt(scaleFactor) * 0.75` (line 113)
- [x] Update margin calculation to match — `maxRadius = maxBaseRadius * Math.sqrt(scaleFactor) * 0.75` (line 104)
- [x] Playwright verification

## What stays unchanged
- `mass` — gravity pull identical
- `THRUST_ACCEL` (0.8) — same feel
- `computeAcceleration()` — uses mass/distance, not radius
- Planet glow — scales naturally with `m.radius`
