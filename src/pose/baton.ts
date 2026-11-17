import { OneEuro } from './oneEuro.ts'
import { ARM } from './pose.ts'
import type { Hand, PoseFrame, Vec } from './pose.ts'

/**
 * Finds a conductor's baton (or a pencil / chopstick) held in the hand.
 *
 * Pose models track the hand, not what it holds, so we look at the camera
 * image itself: a small patch around the hand is scanned along rays fanning
 * out from the fist (±75° around the direction the forearm and fingers
 * point). A baton is a thin straight *ridge*: along the ray each pixel is
 * brighter (or darker) than the pixels just beside it on BOTH sides. Edges
 * of sleeves or furniture are one-sided steps and are rejected. The longest
 * steady ridge that starts at the fist is the baton; its far end is the tip.
 *
 * A baton is "held" once it is found in most recent frames. Without one,
 * the tip of an imaginary baton extending from the hand is used, so the
 * game still works with just a pointing hand.
 */

const N = 96 // patch resolution
const ANGLES = 31 // rays, 5° apart
const SPAN = (75 * Math.PI) / 180
const THRESH = 13 // ridge contrast on 0–255
const MIN_RUN = 0.34 // baton must cover a third of the search length
const FINE = (5 * Math.PI) / 180 // fine pass: ±5° around the best coarse ray, 1° apart

export interface BatonState {
  /** baton tip in mirrored camera px */
  tip: Vec
  /** the hand holding it, mirrored camera px */
  hand: Vec
  /** a real stick is seen (vs. the imaginary baton) */
  held: boolean
  /** how sure we are 0–1 (share of recent frames with a stick) */
  confidence: number
}

export class BatonFinder {
  private cv: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private gray = new Float32Array(N * N)
  private history: boolean[] = []
  /** baton angle relative to the forearm, and its length in forearm units */
  private relAngle = 0
  private relLen = 1.1
  private fx = new OneEuro(1.5, 0.02)
  private fy = new OneEuro(1.5, 0.02)
  private lastT = 0
  hand: Hand = 'R'

  constructor() {
    this.cv = document.createElement('canvas')
    this.cv.width = this.cv.height = N
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true })!
  }

  update(video: HTMLVideoElement, f: PoseFrame): BatonState | null {
    const lm = f.raw
    if (!lm) return null
    const arm = ARM[this.hand]
    const w = lm[arm.wrist]
    const e = lm[arm.elbow]
    const ix = lm[arm.index]
    const pk = lm[arm.pinky]
    if (!w || (w.visibility ?? 1) < 0.4) return null
    const vw = f.vw
    const vh = f.vh
    // raw (un-mirrored) camera px
    const W = { x: w.x * vw, y: w.y * vh }
    const E = e && (e.visibility ?? 1) > 0.3 ? { x: e.x * vw, y: e.y * vh } : { x: W.x, y: W.y + 0.25 * vh }
    const I = ix ? { x: ix.x * vw, y: ix.y * vh } : W
    const P = pk ? { x: pk.x * vw, y: pk.y * vh } : W
    const H = { x: (W.x + I.x + P.x) / 3, y: (W.y + I.y + P.y) / 3 }
    const forearm = Math.max(20, Math.hypot(W.x - E.x, W.y - E.y))
    const armDir = norm({ x: W.x - E.x, y: W.y - E.y })
    const fingerDir = norm({ x: I.x - W.x, y: I.y - W.y })
    const prior = norm({ x: armDir.x + fingerDir.x, y: armDir.y + fingerDir.y })
    const priorAng = Math.atan2(prior.y, prior.x)

    const found = this.scan(video, H, forearm, priorAng)
    this.history.push(!!found)
    if (this.history.length > 12) this.history.shift()
    const confidence = this.history.filter(Boolean).length / this.history.length
    const held = confidence >= 0.5

    if (found) {
      // remember the baton relative to the forearm, so it follows the wrist
      // smoothly through frames where the stick is motion-blurred
      const rel = wrapAngle(found.angle - Math.atan2(armDir.y, armDir.x))
      this.relAngle += wrapAngle(rel - this.relAngle) * 0.35
      this.relLen += (found.length / forearm - this.relLen) * 0.35
    } else if (!held) {
      this.relAngle *= 0.9
      this.relLen += (1.0 - this.relLen) * 0.1
    }
    const ang = held ? Math.atan2(armDir.y, armDir.x) + this.relAngle : priorAng
    const len = (held ? this.relLen : 0.9) * forearm
    const tipRaw = { x: H.x + Math.cos(ang) * len, y: H.y + Math.sin(ang) * len }
    const dt = this.lastT ? Math.max(0.001, (f.t - this.lastT) / 1000) : 0
    this.lastT = f.t
    // mirror to match what the player sees
    const tip = { x: this.fx.filter(vw - tipRaw.x, dt), y: this.fy.filter(tipRaw.y, dt) }
    return { tip, hand: { x: vw - H.x, y: H.y }, held, confidence }
  }

  /** returns the strongest stick-like ridge from the hand, in raw camera px */
  private scan(video: HTMLVideoElement, H: Vec, forearm: number, priorAng: number): { angle: number; length: number } | null {
    const side = forearm * 2.8
    const sx = H.x - side / 2
    const sy = H.y - side / 2
    try {
      this.ctx.drawImage(video, sx, sy, side, side, 0, 0, N, N)
    } catch {
      return null
    }
    const px = this.ctx.getImageData(0, 0, N, N).data
    const g = this.gray
    for (let i = 0; i < N * N; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]

    const k = N / side
    const c = N / 2
    const r0 = 0.2 * forearm * k // just outside the fist
    const r1 = Math.min(N / 2 - 3, 1.35 * forearm * k)
    const half = Math.max(1.6, 0.03 * forearm * k) // ridge half-width
    // bilinear sampling: the stick is thin, sub-pixel positions matter
    const at = (x: number, y: number) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      if (xi < 0 || yi < 0 || xi >= N - 1 || yi >= N - 1) return -1
      const fx = x - xi
      const fy = y - yi
      const i = yi * N + xi
      return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + N] * (1 - fx) + g[i + N + 1] * fx) * fy
    }
    // coarse fan of rays, then a fine pass around the best one: the stick is
    // only a pixel or two wide here, so a ray a few degrees off loses it
    let best = this.bestRay(at, c, r0, r1, half, k, priorAng - SPAN, priorAng + SPAN, ANGLES)
    if (best) best = this.bestRay(at, c, r0, r1, half, k, best.angle - FINE, best.angle + FINE, 11) ?? best
    return best
  }

  private bestRay(
    at: (x: number, y: number) => number,
    c: number,
    r0: number,
    r1: number,
    half: number,
    k: number,
    from: number,
    to: number,
    rays: number,
  ): { angle: number; length: number; score: number } | null {
    let best: { angle: number; length: number; score: number } | null = null
    for (let a = 0; a < rays; a++) {
      const ang = from + ((to - from) * a) / (rays - 1)
      const dx = Math.cos(ang)
      const dy = Math.sin(ang)
      // perpendicular
      const nx = -dy
      const ny = dx
      let run = 0
      let gap = 0
      let sign = 0
      let bestRun = 0
      let bestEnd = 0
      let started = false
      for (let r = r0; r <= r1; r += 1) {
        const x = c + dx * r
        const y = c + dy * r
        const m = at(x, y)
        const s1 = at(x + nx * half * 2, y + ny * half * 2)
        const s2 = at(x - nx * half * 2, y - ny * half * 2)
        if (m < 0 || s1 < 0 || s2 < 0) break
        const ridge = m - (s1 + s2) / 2
        // a true ridge stands out from BOTH sides (a step edge does not)
        const ok = Math.abs(ridge) > THRESH && Math.abs(s1 - s2) < Math.abs(ridge) * 0.8 && (sign === 0 || Math.sign(ridge) === sign)
        if (ok) {
          if (!started && r - r0 > (r1 - r0) * 0.25) break // must start at the hand
          started = true
          sign = Math.sign(ridge)
          run += 1 + gap
          gap = 0
          if (run > bestRun) {
            bestRun = run
            bestEnd = r
          }
        } else if (started) {
          if (++gap > 3) break // allow small gaps (blur, glare)
        }
      }
      const score = bestRun / (r1 - r0)
      if (score >= MIN_RUN && (!best || score > best.score)) best = { angle: ang, length: bestEnd / k, score }
    }
    return best
  }
}

function norm(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}
