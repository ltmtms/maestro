import * as Tone from 'tone'
import { midi } from './notation.ts'
import type { Part } from './scores.ts'
import manifest from './samples.json'

/**
 * The orchestra: one Tone.js Sampler per instrument, using FluidR3 GM
 * samples (MIT), a concert-hall reverb, and a master "dynamics" stage the
 * conductor controls. Playing softer also makes the sound darker, as a real
 * orchestra does.
 */

export type Section = 'violins' | 'violas' | 'cellos' | 'basses' | 'woodwinds' | 'brass' | 'percussion' | 'harp'

const PARTS: Record<Part, { inst: keyof typeof manifest; section: Section; db: number }> = {
  violins: { inst: 'violin', section: 'violins', db: -2 },
  strings: { inst: 'string_ensemble_1', section: 'violas', db: -6 },
  cellos: { inst: 'cello', section: 'cellos', db: -2 },
  basses: { inst: 'contrabass', section: 'basses', db: -3 },
  flute: { inst: 'flute', section: 'woodwinds', db: -6 },
  oboe: { inst: 'oboe', section: 'woodwinds', db: -8 },
  horns: { inst: 'french_horn', section: 'brass', db: -5 },
  trumpets: { inst: 'trumpet', section: 'brass', db: -9 },
  timpani: { inst: 'timpani', section: 'percussion', db: -3 },
  harp: { inst: 'orchestral_harp', section: 'harp', db: -6 },
  pizz: { inst: 'pizzicato_strings', section: 'violas', db: -4 },
}

export const SECTIONS: Section[] = ['violins', 'violas', 'cellos', 'basses', 'woodwinds', 'brass', 'percussion', 'harp']

/** samples are ~1.5 s long: longer notes are re-bowed so they keep sounding */
const SAMPLE_LEN = 1.25

const BASE = import.meta.env.BASE_URL

export class Orchestra {
  private samplers = new Map<Part, Tone.Sampler>()
  private master: Tone.Gain
  private tone: Tone.Filter
  /** how strongly each section is playing right now (0–1), for the stage lights */
  energy: Record<Section, number> = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<Section, number>
  private ringUntil: Record<Section, number> = Object.fromEntries(SECTIONS.map((s) => [s, 0])) as Record<Section, number>

  private constructor() {
    const limiter = new Tone.Limiter(-1).toDestination()
    // the soundfont is recorded quietly: ~+12 dB make-up, the limiter catches peaks
    const makeup = new Tone.Gain(4).connect(limiter)
    const hall = new Tone.Reverb({ decay: 2.8, preDelay: 0.03, wet: 0.3 }).connect(makeup)
    this.tone = new Tone.Filter({ type: 'lowpass', frequency: 9000, rolloff: -12 }).connect(hall)
    this.master = new Tone.Gain(0.6).connect(this.tone)
  }

  static async load(ctx: AudioContext, parts: Part[], onProgress: (r: number) => void): Promise<Orchestra> {
    Tone.setContext(ctx)
    Tone.getContext().lookAhead = 0
    const o = new Orchestra()
    let done = 0
    await Promise.all(
      [...new Set(parts)].map(
        (part) =>
          new Promise<void>((resolve, reject) => {
            const { inst, db } = PARTS[part]
            const urls: Record<number, string> = {}
            for (const n of manifest[inst]) urls[midi(n)] = `${n}.mp3`
            const s = new Tone.Sampler({
              urls,
              baseUrl: `${BASE}samples/${inst}/`,
              release: part === 'pizz' || part === 'harp' || part === 'timpani' ? 1.2 : 0.6,
              volume: db,
              onload: () => {
                onProgress(++done / parts.length)
                resolve()
              },
              onerror: (e) => reject(e instanceof Error ? e : new Error(`could not load ${inst}`)),
            }).connect(o.master)
            o.samplers.set(part, s)
          }),
      ),
    )
    return o
  }

  /** play notes at an AudioContext time */
  play(part: Part, notes: string[], time: number, dur: number, vel: number): void {
    const s = this.samplers.get(part)
    if (!s) return
    const t = Math.max(time, Tone.now() + 0.005)
    try {
      if (dur <= SAMPLE_LEN * 1.15 || part === 'pizz' || part === 'harp' || part === 'timpani') {
        s.triggerAttackRelease(notes, dur, t, vel)
      } else {
        // a long note: re-articulate softly so it doesn't die out (like a new bow stroke)
        for (let o = 0; o < dur - 0.05; o += SAMPLE_LEN) {
          s.triggerAttackRelease(notes, Math.min(SAMPLE_LEN + 0.15, dur - o), t + o, o === 0 ? vel : vel * 0.8)
        }
      }
    } catch (err) {
      console.warn(err)
    }
    const sec = PARTS[part].section
    const delay = Math.max(0, (t - Tone.now()) * 1000)
    window.setTimeout(() => {
      this.energy[sec] = Math.max(this.energy[sec], Math.min(1, vel * 1.1))
      this.ringUntil[sec] = Math.max(this.ringUntil[sec], performance.now() + dur * 1000)
    }, delay)
  }

  /** conductor's dynamics: 0 = pianissimo … 1 = fortissimo */
  setDynamics(level: number, ramp = 0.25): void {
    const db = -20 + 20 * level
    this.master.gain.rampTo(Tone.dbToGain(db) * 0.9, ramp)
    // soft playing is darker, loud playing is brilliant
    this.tone.frequency.rampTo(1800 + 9000 * level * level, ramp)
  }

  /** the orchestra stops (fermata / waiting for the conductor) */
  hush(): void {
    for (const s of this.samplers.values()) s.releaseAll(Tone.now() + 0.05)
  }

  /** stage lights fade with the music */
  tick(dt: number): void {
    const now = performance.now()
    for (const s of SECTIONS) {
      const ringing = now < this.ringUntil[s]
      this.energy[s] = Math.max(0, this.energy[s] - dt * (ringing ? 0.35 : 1.6))
    }
  }

  dispose(): void {
    this.hush()
    for (const s of this.samplers.values()) s.dispose()
    this.samplers.clear()
  }
}
