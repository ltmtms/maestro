import type { Ictus } from '../conduct/gesture.ts'
import { strokeDir } from '../conduct/pattern.ts'
import type { Meter } from '../conduct/pattern.ts'
import type { Hand } from '../pose/pose.ts'
import type { Orchestra } from '../music/orchestra.ts'
import { DYN_LEVEL, dynamicAt } from '../music/scores.ts'
import type { Dyn, Part, Piece } from '../music/scores.ts'

// ───────────────────────── scoring ─────────────────────────

export type Judgment = 'bravissimo' | 'bravo' | 'bene' | 'ancora' | 'missed'

export const JUDGMENT_TEXT: Record<Judgment, string> = {
  bravissimo: 'BRAVISSIMO!',
  bravo: 'BRAVO!',
  bene: 'BENE',
  ancora: 'ANCORA…',
  missed: '—',
}

export interface BeatResult {
  beat: number
  judgment: Judgment
  score: number
  /** 0–1 parts of the score */
  timing: number
  direction: number
  dynamics: number
  /** ms early (−) / late (+) against the music */
  offsetMs: number
}

export interface Stats {
  beats: number
  total: number
  counts: Record<Judgment, number>
  combo: number
  maxCombo: number
  points: number
  tempoSum: number
  tempoN: number
}

export type Grade = 'S+++' | 'S++' | 'S+' | 'S' | 'A' | 'B' | 'C'

export const GRADES: [Grade, number, string][] = [
  ['S+++', 0.92, 'Maestro'],
  ['S++', 0.86, 'Virtuoso'],
  ['S+', 0.8, 'Principal Conductor'],
  ['S', 0.74, 'Guest Conductor'],
  ['A', 0.64, 'Assistant Conductor'],
  ['B', 0.5, 'Conservatory Student'],
  ['C', 0, 'Music Lover'],
]

export function gradeOf(s: Stats): { grade: Grade; title: string; accuracy: number } {
  const accuracy = s.beats ? s.total / s.beats : 0
  for (const [grade, min, title] of GRADES) {
    if (grade === 'S+++' && s.counts.missed > 0) continue
    if (accuracy >= min) return { grade, title, accuracy }
  }
  return { grade: 'C', title: 'Music Lover', accuracy }
}

function newStats(): Stats {
  return {
    beats: 0,
    total: 0,
    counts: { bravissimo: 0, bravo: 0, bene: 0, ancora: 0, missed: 0 },
    combo: 0,
    maxCombo: 0,
    points: 0,
    tempoSum: 0,
    tempoN: 0,
  }
}

/** timing: |offset| as a share of a beat */
function timingScore(offsetBeats: number): number {
  const o = Math.abs(offsetBeats)
  return o <= 0.08 ? 1 : o <= 0.16 ? 0.75 : o <= 0.28 ? 0.45 : 0.15
}

function directionScore(dir: { x: number; y: number }, want: { x: number; y: number }): number {
  const cos = dir.x * want.x + dir.y * want.y
  return cos >= 0.8 ? 1 : cos >= 0.55 ? 0.7 : cos >= 0.2 ? 0.35 : 0
}

function dynamicsScore(level: number, target: number): number {
  const d = Math.abs(level - target)
  return d <= 0.14 ? 1 : d <= 0.28 ? 0.6 : 0.25
}

function record(stats: Stats, r: BeatResult): void {
  stats.beats++
  stats.total += r.score
  stats.counts[r.judgment]++
  if (r.judgment === 'missed' || r.judgment === 'ancora') stats.combo = 0
  else stats.combo++
  stats.maxCombo = Math.max(stats.maxCombo, stats.combo)
  stats.points += Math.round(1000 * r.score * (1 + Math.min(stats.combo, 50) / 50))
}

function judge(beat: number, timing: number, direction: number, dynamics: number, offsetMs: number): BeatResult {
  const score = 0.4 * timing + 0.4 * direction + 0.2 * dynamics
  const judgment: Judgment = score >= 0.86 ? 'bravissimo' : score >= 0.68 ? 'bravo' : score >= 0.48 ? 'bene' : 'ancora'
  return { beat, judgment, score, timing, direction, dynamics, offsetMs }
}

function missed(beat: number): BeatResult {
  return { beat, judgment: 'missed', score: 0, timing: 0, direction: 0, dynamics: 0, offsetMs: 0 }
}

/** AudioContext time that is *heard* at a performance.now() timestamp */
export function heardCtxTime(ctx: AudioContext, perfMs: number): number {
  const ts = ctx.getOutputTimestamp?.()
  if (ts && ts.performanceTime && ts.contextTime !== undefined) return ts.contextTime + (perfMs - ts.performanceTime) / 1000
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) + (perfMs - performance.now()) / 1000
}

// ───────────────────────── common interface ─────────────────────────

export type Phase = 'ready' | 'prep' | 'playing' | 'waiting' | 'done'

export interface Performance {
  phase: Phase
  meter: Meter
  stats: Stats
  totalBeats: number
  markingBpm: number
  /** current tempo */
  bpm: number
  title: string
  subtitle: string
  marking: string
  /** heard musical position in beats from the start */
  pos(): number
  /** dynamic marking (or the music's loudness) the gestures should match */
  targetDyn(): { label: Dyn | null; level: number }
  /** a prompt for the player, if any */
  message: string
  onResult: ((r: BeatResult) => void) | null
  onIctus(i: Ictus, level: number): void
  update(level: number): void
  stop(): void
}

// ───────────────────────── live orchestra: follows the conductor ─────────────────────────

interface Ev {
  beat: number
  dur: number
  notes: string[]
  vel: number
  part: Part
  artic: number
}

/** musical position ↔ AudioContext time, at a tempo that can change any time */
class Transport {
  private pos0 = 0
  private t0 = 0
  tempo: number
  running = false

  constructor(bpm: number) {
    this.tempo = bpm
  }

  posAt(t: number): number {
    return this.running ? this.pos0 + ((t - this.t0) * this.tempo) / 60 : this.pos0
  }

  timeAt(pos: number): number {
    return this.t0 + ((pos - this.pos0) * 60) / this.tempo
  }

  start(pos: number, t: number, bpm: number): void {
    this.pos0 = pos
    this.t0 = t
    this.tempo = bpm
    this.running = true
  }

  setTempo(bpm: number, t: number): void {
    this.pos0 = this.posAt(t)
    this.t0 = t
    this.tempo = bpm
  }

  pause(t: number): void {
    this.pos0 = this.posAt(t)
    this.running = false
  }
}

const LOOKAHEAD = 0.14

export class OrchestraPerformance implements Performance {
  phase: Phase = 'ready'
  meter: Meter
  stats = newStats()
  totalBeats: number
  markingBpm: number
  title: string
  subtitle: string
  marking: string
  message = 'Raise your baton: give the upbeat ↑'
  onResult: ((r: BeatResult) => void) | null = null

  private piece: Piece
  private orchestra: Orchestra
  private ctx: AudioContext
  private hand: Hand
  private transport: Transport
  private events: Ev[]
  private next = 0
  private judged = new Set<number>()
  private checkBeat = 0
  private missesInRow = 0
  private prepT = 0
  private last: { t: number; beat: number } | null = null
  private lastLevel = -1
  /** beats after this are a held final chord: nothing to conduct */
  private judgeUntil: number
  /** while waiting: the orchestra comes back in at this bar's downbeat */
  private resumeBeat = 0

  constructor(piece: Piece, orchestra: Orchestra, ctx: AudioContext, hand: Hand) {
    this.piece = piece
    this.orchestra = orchestra
    this.ctx = ctx
    this.hand = hand
    this.meter = piece.meter
    this.totalBeats = piece.bars * piece.meter
    this.judgeUntil = piece.holdFromBar !== undefined ? piece.holdFromBar * piece.meter + 1 : this.totalBeats
    this.markingBpm = piece.bpm
    this.title = piece.title
    this.subtitle = `${piece.composer} · ${piece.work}`
    this.marking = piece.marking
    this.transport = new Transport(piece.bpm)
    this.events = piece.tracks
      .flatMap((tr) => tr.notes.map((n) => ({ ...n, part: tr.part, artic: tr.artic ?? 0.95 })))
      .sort((a, b) => a.beat - b.beat)
  }

  get bpm(): number {
    return this.transport.tempo
  }

  pos(): number {
    if (this.phase === 'ready' || this.phase === 'prep') return -1
    if (this.phase === 'waiting') return this.resumeBeat
    return this.transport.posAt(heardCtxTime(this.ctx, performance.now()))
  }

  targetDyn(): { label: Dyn; level: number } {
    const bar = Math.max(0, Math.floor(Math.max(0, this.pos()) / this.meter))
    const d = dynamicAt(this.piece, bar)
    return { label: d, level: DYN_LEVEL[d] }
  }

  onIctus(i: Ictus, level: number): void {
    const t = heardCtxTime(this.ctx, i.t)
    const now = this.ctx.currentTime
    if (this.phase === 'done') return

    if (this.phase === 'ready' || this.phase === 'prep') {
      // a conductor starts with a preparatory upbeat, then the downbeat:
      // their distance sets the tempo
      const down = i.dir.y > 0.35
      if (this.phase === 'prep' && down) {
        const beat = 60 / this.markingBpm
        const iv = t - this.prepT
        const bpm = iv > beat * 0.6 && iv < beat * 1.7 ? 60 / iv : this.markingBpm
        this.transport.start(0, Math.max(t, now + 0.04), this.clampTempo(bpm))
        this.phase = 'playing'
        this.message = ''
        this.score(0, i, level, 0)
        this.last = { t, beat: 0 }
        return
      }
      this.prepT = t
      this.phase = 'prep'
      this.message = 'Now the downbeat ↓'
      return
    }

    if (this.phase === 'waiting') {
      // the orchestra comes back in at the start of the bar it is waiting at
      const b = this.resumeBeat
      if (b >= this.judgeUntil) return
      this.transport.start(b, Math.max(t, now + 0.04), this.transport.tempo)
      this.next = this.events.findIndex((e) => e.beat >= b)
      if (this.next < 0) this.next = this.events.length
      this.checkBeat = b
      this.phase = 'playing'
      this.message = ''
      this.missesInRow = 0
      this.score(b, i, level, 0)
      this.last = { t, beat: b }
      return
    }

    // playing: which beat did the conductor just give?
    const p = this.transport.posAt(t)
    const b = Math.round(p)
    if (b < 0 || b >= this.judgeUntil || this.judged.has(b)) return
    this.score(b, i, level, p - b)
    this.missesInRow = 0

    // follow: aim the next beat at where the conductor will put it
    const beatSec = 60 / this.transport.tempo
    let userSec = beatSec
    if (this.last && b - this.last.beat === 1) {
      const iv = t - this.last.t
      if (iv > beatSec * 0.5 && iv < beatSec * 2) userSec = iv
    }
    this.last = { t, beat: b }
    const remain = b + 1 - this.transport.posAt(now)
    const until = t + userSec - now
    if (remain > 0.05 && until > 0.05) {
      const want = (remain * 60) / until
      // the orchestra follows, a little behind the baton like a real one
      const cur = this.transport.tempo
      const next = Math.min(cur * 1.35, Math.max(cur / 1.35, cur + (want - cur) * 0.75))
      this.transport.setTempo(this.clampTempo(next), now)
    }
    this.stats.tempoSum += this.transport.tempo
    this.stats.tempoN++
  }

  private clampTempo(bpm: number): number {
    return Math.min(this.markingBpm * 1.6, Math.max(this.markingBpm * 0.6, bpm))
  }

  private score(b: number, i: Ictus, level: number, offsetBeats: number): void {
    this.judged.add(b)
    const want = strokeDir(this.meter, b % this.meter, this.hand)
    const target = DYN_LEVEL[dynamicAt(this.piece, Math.floor(b / this.meter))]
    const r = judge(b, timingScore(offsetBeats), directionScore(i.dir, want), dynamicsScore(level, target), (offsetBeats * 60000) / this.transport.tempo)
    record(this.stats, r)
    this.onResult?.(r)
  }

  update(level: number): void {
    if (Math.abs(level - this.lastLevel) > 0.02) {
      this.lastLevel = level
      this.orchestra.setDynamics(this.phase === 'waiting' ? level * 0.5 : level)
    }
    if (this.phase !== 'playing') return
    const now = this.ctx.currentTime
    // schedule the score a little ahead, at the current tempo
    const horizon = this.transport.posAt(now + LOOKAHEAD)
    while (this.next < this.events.length && this.events[this.next].beat < horizon) {
      const e = this.events[this.next++]
      const time = this.transport.timeAt(e.beat)
      if (time < now - 0.03) continue
      this.orchestra.play(e.part, e.notes, time, (e.dur * 60 * e.artic) / this.transport.tempo, e.vel)
    }
    // beats that went by without the baton
    const heard = this.transport.posAt(heardCtxTime(this.ctx, performance.now()))
    while (this.checkBeat < this.judgeUntil && heard > this.checkBeat + 0.55) {
      const b = this.checkBeat++
      if (this.judged.has(b)) continue
      this.judged.add(b)
      const r = missed(b)
      record(this.stats, r)
      this.onResult?.(r)
      this.missesInRow++
      // no beat: the orchestra hesitates…
      this.transport.setTempo(this.clampTempo(this.transport.tempo * 0.96), now)
      if (this.missesInRow > this.meter) {
        // …and after a whole bar it stops and waits at the next bar for the conductor's downbeat
        this.transport.pause(now)
        this.orchestra.hush()
        this.resumeBeat = Math.ceil((heard - 1e-6) / this.meter) * this.meter
        this.phase = 'waiting'
        this.message = `The orchestra is waiting at bar ${this.resumeBeat / this.meter + 1}: give the downbeat ↓`
        return
      }
    }
    if (heard >= this.totalBeats + 1) {
      this.phase = 'done'
      this.message = ''
    }
  }

  stop(): void {
    this.phase = 'done'
    this.orchestra.hush()
  }
}

// ───────────────────────── a recording: plays at its own tempo ─────────────────────────

export interface RecordingInput {
  name: string
  buffer: AudioBuffer
  beats: number[]
  downbeats: number[]
  bpm: number
}

export class RecordingPerformance implements Performance {
  phase: Phase = 'ready'
  meter: Meter
  stats = newStats()
  totalBeats: number
  markingBpm: number
  bpm: number
  title: string
  subtitle = 'Your recording'
  marking = ''
  message = 'Give the downbeat ↓ to start the music'
  onResult: ((r: BeatResult) => void) | null = null

  private ctx: AudioContext
  private hand: Hand
  private rec: RecordingInput
  private beatPos: number[]
  private loud: number[]
  private src: AudioBufferSourceNode | null = null
  private gain: GainNode
  private startCtx = 0
  private judged = new Set<number>()
  private checkBeat = 0

  constructor(rec: RecordingInput, ctx: AudioContext, hand: Hand, meter: Meter) {
    this.rec = rec
    this.ctx = ctx
    this.hand = hand
    this.meter = meter
    this.title = rec.name
    this.totalBeats = rec.beats.length
    this.markingBpm = this.bpm = Math.round(rec.bpm)
    this.marking = `${this.markingBpm} BPM`
    // position of each beat in its bar, counted from the detected downbeats
    let since = 0
    this.beatPos = rec.beats.map((t) => {
      if (rec.downbeats.some((d) => Math.abs(d - t) < 0.03)) since = 0
      return since++ % meter
    })
    this.loud = loudnessPerBeat(rec.buffer, rec.beats)
    this.gain = ctx.createGain()
    this.gain.gain.value = 0.7
    this.gain.connect(ctx.destination)
  }

  private songTime(perfMs: number): number {
    return heardCtxTime(this.ctx, perfMs) - this.startCtx
  }

  private beatIndexAt(t: number): number {
    const b = this.rec.beats
    let lo = 0
    let hi = b.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (b[mid] <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  pos(): number {
    if (this.phase === 'ready' || this.phase === 'prep') return -1
    const t = this.songTime(performance.now())
    const b = this.rec.beats
    const k = this.beatIndexAt(t)
    const span = (b[k + 1] ?? b[k] + 60 / this.bpm) - b[k]
    return k + Math.max(-1, Math.min(1, (t - b[k]) / span))
  }

  targetDyn(): { label: null; level: number } {
    const k = Math.max(0, Math.min(this.loud.length - 1, Math.floor(this.pos())))
    return { label: null, level: this.loud[k] ?? 0.5 }
  }

  onIctus(i: Ictus, level: number): void {
    if (this.phase === 'ready' || this.phase === 'prep') {
      if (i.dir.y < 0.35) return
      const src = this.ctx.createBufferSource()
      src.buffer = this.rec.buffer
      src.connect(this.gain)
      this.startCtx = this.ctx.currentTime + 0.05
      src.start(this.startCtx)
      src.onended = () => {
        if (this.phase === 'playing') this.phase = 'done'
      }
      this.src = src
      this.phase = 'playing'
      this.message = ''
      return
    }
    if (this.phase !== 'playing') return
    const t = this.songTime(i.t)
    const b = this.rec.beats
    let k = this.beatIndexAt(t)
    if (k + 1 < b.length && Math.abs(b[k + 1] - t) < Math.abs(b[k] - t)) k++
    const span = (b[k + 1] ?? b[k] + 60 / this.bpm) - (b[k - 1] ?? b[k] - 60 / this.bpm)
    const offset = t - b[k]
    if (Math.abs(offset) > span * 0.25 || this.judged.has(k)) return
    this.judged.add(k)
    const want = strokeDir(this.meter, this.beatPos[k], this.hand)
    const r = judge(k, timingScore(offset / (span / 2)), directionScore(i.dir, want), dynamicsScore(level, this.loud[k]), offset * 1000)
    record(this.stats, r)
    this.onResult?.(r)
  }

  update(level: number): void {
    // the music only has full energy while you conduct it
    this.gain.gain.setTargetAtTime(0.25 + 0.75 * level, this.ctx.currentTime, 0.15)
    if (this.phase !== 'playing') return
    const t = this.songTime(performance.now())
    const b = this.rec.beats
    while (this.checkBeat < b.length && t > b[this.checkBeat] + 0.3) {
      const k = this.checkBeat++
      if (this.judged.has(k) || b[k] < 0.5) continue
      this.judged.add(k)
      const r = missed(k)
      record(this.stats, r)
      this.onResult?.(r)
    }
    if (t > this.rec.buffer.duration) this.phase = 'done'
  }

  stop(): void {
    this.phase = 'done'
    try {
      this.src?.stop()
    } catch {
      /* already stopped */
    }
    this.gain.disconnect()
  }
}

/** loudness around each beat, 0 (quiet) – 1 (the loudest passages) */
function loudnessPerBeat(buf: AudioBuffer, beats: number[]): number[] {
  const d = buf.getChannelData(0)
  const sr = buf.sampleRate
  const raw = beats.map((t, i) => {
    const a = Math.floor(t * sr)
    const e = Math.min(d.length, Math.floor((beats[i + 1] ?? t + 0.5) * sr))
    let s = 0
    for (let j = a; j < e; j += 8) s += d[j] * d[j]
    return Math.sqrt(s / Math.max(1, (e - a) / 8))
  })
  const sorted = [...raw].sort((x, y) => x - y)
  const hi = sorted[Math.floor(sorted.length * 0.95)] || 1
  return raw.map((v) => Math.min(1, v / hi))
}
