import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/**
 * Upper-body tracking with MediaPipe PoseLandmarker (the modern successor
 * of PoseNet), one inference per new camera frame. Everything downstream
 * works in *mirrored camera pixels*, the way a mirror (and the player) sees
 * it, and in shoulder widths so it doesn't matter how far away you stand.
 */

export interface Vec {
  x: number
  y: number
}

export interface Pt extends Vec {
  /** landmark visibility 0–1 */
  v: number
}

export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lPinky: 17,
  rPinky: 18,
  lIndex: 19,
  rIndex: 20,
} as const

export type Hand = 'L' | 'R'

/** landmarks of one arm, by the player's own left/right */
export const ARM: Record<Hand, { shoulder: number; elbow: number; wrist: number; pinky: number; index: number }> = {
  L: { shoulder: LM.lShoulder, elbow: LM.lElbow, wrist: LM.lWrist, pinky: LM.lPinky, index: LM.lIndex },
  R: { shoulder: LM.rShoulder, elbow: LM.rElbow, wrist: LM.rWrist, pinky: LM.rPinky, index: LM.rIndex },
}

export interface PoseFrame {
  /** performance.now() of the camera frame */
  t: number
  /** landmarks 0–22 in mirrored camera px (null when not visible) */
  pts: (Pt | null)[]
  /** raw normalized landmarks, un-mirrored, for image analysis */
  raw: NormalizedLandmark[] | null
  /** shoulder midpoint, smoothed */
  center: Vec | null
  /** shoulder width in px, smoothed */
  shoulder: number
  /** camera frame size */
  vw: number
  vh: number
}

const BASE = import.meta.env.BASE_URL

export class PoseTracker {
  private landmarker: PoseLandmarker | null = null
  private video: HTMLVideoElement
  private running = false
  private lastTs = 0
  private center: Vec | null = null
  private shoulder = 0
  frameInterval = 33
  onFrame: ((f: PoseFrame) => void) | null = null
  latest: PoseFrame | null = null

  constructor(video: HTMLVideoElement) {
    this.video = video
  }

  async load(onStatus: (msg: string) => void): Promise<void> {
    onStatus('Loading vision runtime')
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe`)
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
    onStatus('Loading pose model')
    try {
      this.landmarker = await make('GPU')
    } catch (err) {
      console.warn('GPU delegate failed, falling back to CPU', err)
      this.landmarker = await make('CPU')
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  stop(): void {
    this.running = false
  }

  private schedule(): void {
    if (!this.running) return
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number; presentationTime?: number }) => void) => number
    }
    if (v.requestVideoFrameCallback) {
      v.requestVideoFrameCallback((now, meta) => {
        this.process(meta.captureTime ?? meta.presentationTime ?? now)
        this.schedule()
      })
    } else {
      requestAnimationFrame((now) => {
        this.process(now)
        this.schedule()
      })
    }
  }

  private process(frameTime: number): void {
    if (!this.landmarker || this.video.readyState < 2) return
    const now = performance.now()
    const ts = Math.max(now, this.lastTs + 1)
    let result
    try {
      result = this.landmarker.detectForVideo(this.video, ts)
    } catch (err) {
      console.warn(err)
      return
    }
    if (this.lastTs) this.frameInterval += (Math.min(200, ts - this.lastTs) - this.frameInterval) * 0.1
    this.lastTs = ts
    const t = Math.min(now, Math.max(frameTime, now - 150))
    this.latest = this.toFrame(result.landmarks[0] ?? null, t)
    this.onFrame?.(this.latest)
  }

  private toFrame(lm: NormalizedLandmark[] | null, t: number): PoseFrame {
    const vw = this.video.videoWidth || 640
    const vh = this.video.videoHeight || 480
    const pts: (Pt | null)[] = []
    for (let i = 0; i <= 22; i++) {
      const p = lm?.[i]
      pts.push(p && (p.visibility ?? 1) >= 0.3 ? { x: (1 - p.x) * vw, y: p.y * vh, v: p.visibility ?? 1 } : null)
    }
    const ls = pts[LM.lShoulder]
    const rs = pts[LM.rShoulder]
    if (ls && rs && ls.v > 0.5 && rs.v > 0.5) {
      const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
      const w = Math.hypot(ls.x - rs.x, ls.y - rs.y)
      const k = this.center ? 0.1 : 1
      this.center = this.center ? { x: this.center.x + (mid.x - this.center.x) * k, y: this.center.y + (mid.y - this.center.y) * k } : mid
      // turning sideways shrinks the shoulder line; let it shrink only slowly
      const target = this.shoulder ? Math.max(w, this.shoulder * 0.85) : w
      this.shoulder = this.shoulder ? this.shoulder + (target - this.shoulder) * k : w
    }
    return { t, pts, raw: lm, center: this.center, shoulder: this.shoulder, vw, vh }
  }
}

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, max: 60 } },
  })
  video.srcObject = stream
  video.playsInline = true
  video.muted = true
  await video.play()
  return stream
}
