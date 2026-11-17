import type { Vec } from '../pose/pose.ts'
import type { Hand } from '../pose/pose.ts'

/**
 * The classic conducting beat patterns, as a right-handed conductor sees them
 * in a mirror (y down). Beat points in pattern units; each beat is a stroke
 * from the previous beat point to this one.
 *
 *   2/4:  1 ↓  2 ↑
 *   3/4:  1 ↓  2 →  3 ↑
 *   4/4:  1 ↓  2 ←  3 →  4 ↑
 */
export type Meter = 2 | 3 | 4

const POINTS: Record<Meter, Vec[]> = {
  2: [
    { x: 0, y: 1 },
    { x: 0.08, y: -0.9 },
  ],
  3: [
    { x: 0, y: 1 },
    { x: 0.95, y: 0.45 },
    { x: 0.1, y: -0.9 },
  ],
  4: [
    { x: 0, y: 1 },
    { x: -0.95, y: 0.5 },
    { x: 0.95, y: 0.5 },
    { x: 0.12, y: -0.9 },
  ],
}

export const BEAT_NAMES: Record<Meter, string[]> = {
  2: ['↓', '↑'],
  3: ['↓', '→', '↑'],
  4: ['↓', '←', '→', '↑'],
}

/** left-handed conductors mirror the pattern */
export function beatPoints(meter: Meter, hand: Hand): Vec[] {
  return POINTS[meter].map((p) => ({ x: hand === 'L' ? -p.x : p.x, y: p.y }))
}

export function glyph(meter: Meter, beat: number, hand: Hand): string {
  const g = BEAT_NAMES[meter][beat]
  if (hand === 'R') return g
  return g === '←' ? '→' : g === '→' ? '←' : g
}

/** unit direction of the stroke that lands on `beat` (0-based in the bar) */
export function strokeDir(meter: Meter, beat: number, hand: Hand): Vec {
  const pts = beatPoints(meter, hand)
  const a = pts[(beat - 1 + meter) % meter]
  const b = pts[beat]
  const d = { x: b.x - a.x, y: b.y - a.y }
  const l = Math.hypot(d.x, d.y) || 1
  return { x: d.x / l, y: d.y / l }
}
