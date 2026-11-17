/**
 * A tiny text notation for scores, e.g. "F#4 F#4 G4 A4 | E4:1.5 D4:.5 D4:2".
 *
 *   C#4        a note (default length: 1 beat)
 *   D3+F#3+A3  a chord
 *   E4:1.5     length in beats
 *   r:2        a rest
 *   |          bar line: every bar is checked to add up to the time signature
 */

export interface NoteEv {
  /** start, in beats from the start of the piece */
  beat: number
  /** length in beats */
  dur: number
  notes: string[]
  vel: number
}

export function seq(text: string, startBar: number, meter: number, vel = 0.75): NoteEv[] {
  const out: NoteEv[] = []
  const bars = text.split('|').map((b) => b.trim())
  let beat = startBar * meter
  bars.forEach((bar, i) => {
    if (!bar) return
    let len = 0
    for (const tok of bar.split(/\s+/)) {
      const [pitch, d] = tok.split(':')
      const dur = d === undefined ? 1 : Number(d)
      if (!(dur > 0)) throw new Error(`bad length in "${tok}"`)
      if (pitch !== 'r') out.push({ beat: beat + len, dur, notes: pitch.split('+'), vel })
      len += dur
    }
    if (Math.abs(len - meter) > 1e-6) throw new Error(`bar ${startBar + i + 1} has ${len} beats, expected ${meter}: "${bar}"`)
    beat += len
  })
  return out
}

/** repeat a pattern bar-by-bar with different chords, e.g. waltz "oom-pah-pah" */
export function perBar(chords: string[], startBar: number, meter: number, pattern: (chord: string) => string, vel = 0.6): NoteEv[] {
  return seq(chords.map(pattern).join(' | '), startBar, meter, vel)
}

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** "F#4" / "Eb3" → MIDI number */
export function midi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name)
  if (!m) throw new Error(`bad note "${name}"`)
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

/** shift every note in a notation string by `n` octaves */
export function oct(text: string, n: number): string {
  return text.replace(/([A-G][#b]?)(-?\d)/g, (_, p: string, o: string) => `${p}${Number(o) + n}`)
}

/** one held chord, possibly spanning bar lines (finales, fermatas) */
export function hold(beat: number, dur: number, chord: string, vel = 0.8): NoteEv {
  return { beat, dur, notes: chord.split('+'), vel }
}
