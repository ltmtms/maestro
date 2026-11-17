import type { Vec } from '../pose/pose.ts'

/**
 * Conducting gesture analysis, in body space: baton-tip position relative to
 * the shoulders, in shoulder widths, so it works at any distance.
 *
 * A conductor's beat (the *ictus*) is the instant the baton "clicks" at the
 * end of a stroke: it either rebounds (sharp change of direction) or stops.
 * Each ictus carries the stroke's direction (from the previous beat point to
 * this one, which is what the arrows ask for) and its size, which sets the
 * orchestra's dynamics: small gestures = piano, big gestures = forte.
 */

export interface Ictus {
  /** performance.now() ms */
  t: number
  /** body-space position */
  pos: Vec
  /** unit direction of the stroke that led here */
  dir: Vec
  /** stroke size in shoulder widths */
  size: number
}

export interface TrailPoint extends Vec {
  t: number
  speed: number
}

/** a stroke must be at least this fast (shoulder widths / s) and long */
const MIN_SPEED = 0.55
const MIN_PATH = 0.1
/** turning by more than this counts as a rebound */
const TURN_COS = Math.cos((80 * Math.PI) / 180)

export class GestureTracker {
  private prev: { t: number; p: Vec } | null = null
  /** the last few samples, to find exactly where a stroke peaked */
  private recent: { t: number; p: Vec }[] = []
  private v: Vec = { x: 0, y: 0 }
  private start: Vec = { x: 0, y: 0 }
  private dirAcc: Vec = { x: 0, y: 0 }
  private maxSpeed = 0
  private path = 0
  private extent = 0
  private lastIctus: Ictus | null = null
  /** dynamics 0 (pp) – 1 (ff), follows gesture size */
  level = 0.45
  /** where the baton usually is: the centre of the beat pattern */
  home: Vec = { x: 0.6, y: 0.3 }
  speed = 0
  /** ignore a second "beat" sooner than this; set from the tempo (≈45% of a beat) */
  minGapMs = 180
  trail: TrailPoint[] = []
  onIctus: ((i: Ictus) => void) | null = null

  reset(): void {
    this.prev = null
    this.recent = []
    this.lastIctus = null
    this.resetStroke({ x: 0, y: 0 })
    this.trail = []
  }

  private resetStroke(p: Vec): void {
    this.start = { ...p }
    this.dirAcc = { x: 0, y: 0 }
    this.maxSpeed = 0
    this.path = 0
    this.extent = 0
  }

  /** feed one baton-tip sample (body space, shoulder widths) */
  update(p: Vec, t: number): void {
    const prev = this.prev
    this.prev = { t, p }
    this.recent.push({ t, p })
    if (this.recent.length > 6) this.recent.shift()
    this.trail.push({ x: p.x, y: p.y, t, speed: this.speed })
    while (this.trail.length && t - this.trail[0].t > 450) this.trail.shift()
    if (!prev) {
      this.resetStroke(p)
      return
    }
    const dt = (t - prev.t) / 1000
    if (dt <= 0) return
    if (dt > 0.3) {
      // tracking gap: start over
      this.resetStroke(p)
      this.v = { x: 0, y: 0 }
      return
    }
    const raw = { x: (p.x - prev.p.x) / dt, y: (p.y - prev.p.y) / dt }
    this.v = { x: this.v.x * 0.5 + raw.x * 0.5, y: this.v.y * 0.5 + raw.y * 0.5 }
    const speed = Math.hypot(this.v.x, this.v.y)
    this.speed = speed
    // the baton's resting area drifts slowly with the player
    this.home = { x: this.home.x + (p.x - this.home.x) * 0.01, y: this.home.y + (p.y - this.home.y) * 0.01 }

    // ictus? the stroke was a real one, and now it rebounds or stops
    const accLen = Math.hypot(this.dirAcc.x, this.dirAcc.y)
    const turned = accLen > 0 && speed > 0.15 && (this.v.x * this.dirAcc.x + this.v.y * this.dirAcc.y) / (speed * accLen) < TURN_COS
    const stopped = speed < this.maxSpeed * 0.35
    const since = this.lastIctus ? t - this.lastIctus.t : Infinity
    if (this.maxSpeed >= MIN_SPEED && this.path >= MIN_PATH && since >= this.minGapMs && (turned || stopped)) {
      // the ictus is where the stroke went furthest in its own direction; the
      // turn is only visible a frame or two later
      let peak = this.recent[this.recent.length - 2] ?? { t: prev.t, p: prev.p }
      let best = -Infinity
      for (const s of this.recent) {
        if (s.t <= (this.lastIctus?.t ?? -Infinity)) continue
        const proj = (s.p.x - this.start.x) * this.dirAcc.x + (s.p.y - this.start.y) * this.dirAcc.y
        if (proj > best) {
          best = proj
          peak = s
        }
      }
      const at = peak.p
      const from = this.lastIctus && since < 2500 ? this.lastIctus.pos : this.start
      let dir = { x: at.x - from.x, y: at.y - from.y }
      if (Math.hypot(dir.x, dir.y) < 0.08) dir = this.dirAcc
      const len = Math.hypot(dir.x, dir.y) || 1
      const ictus: Ictus = {
        t: peak.t,
        pos: { ...at },
        dir: { x: dir.x / len, y: dir.y / len },
        size: Math.max(this.extent, Math.hypot(at.x - from.x, at.y - from.y)),
      }
      // gesture size → dynamics (0.25 shoulder widths = pp, 1.4 = ff)
      const target = Math.min(1, Math.max(0, (ictus.size - 0.25) / 1.15))
      this.level += (target - this.level) * 0.45
      this.lastIctus = ictus
      this.resetStroke(at)
      this.onIctus?.(ictus)
      return
    }

    // accumulate the stroke (fast parts weigh more)
    this.dirAcc.x += this.v.x * speed * dt
    this.dirAcc.y += this.v.y * speed * dt
    this.maxSpeed = Math.max(this.maxSpeed, speed)
    this.path += Math.hypot(p.x - prev.p.x, p.y - prev.p.y)
    this.extent = Math.max(this.extent, Math.hypot(p.x - this.start.x, p.y - this.start.y))
  }

  /** no beats for a while: the gesture energy fades */
  decay(dt: number): void {
    this.level = Math.max(0, this.level - dt * 0.05)
  }
}
