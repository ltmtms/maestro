import type { Meter } from '../conduct/pattern.ts'
import { hold, oct, perBar, seq } from './notation.ts'
import type { NoteEv } from './notation.ts'

/**
 * Built-in repertoire. All three works are in the public domain; these are
 * simplified orchestral arrangements written for this game.
 */

export type Part = 'violins' | 'strings' | 'cellos' | 'basses' | 'flute' | 'oboe' | 'horns' | 'trumpets' | 'timpani' | 'harp' | 'pizz'
export type Dyn = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'

/** gesture level (0–1) that matches each dynamic marking */
export const DYN_LEVEL: Record<Dyn, number> = { pp: 0.06, p: 0.22, mp: 0.4, mf: 0.58, f: 0.78, ff: 0.95 }

export interface Track {
  part: Part
  notes: NoteEv[]
  /** share of the written length actually sounded (1 = legato, 0.4 = staccato) */
  artic?: number
}

export interface Piece {
  id: string
  title: string
  composer: string
  life: string
  work: string
  marking: string
  bpm: number
  meter: Meter
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  about: string
  tip: string
  bars: number
  /** the final chord is held from this bar: no beats are expected after its downbeat */
  holdFromBar?: number
  tracks: Track[]
  /** dynamic marking from a bar (0-based) onward */
  dynamics: [number, Dyn][]
}

export function dynamicAt(piece: Piece, bar: number): Dyn {
  let d: Dyn = piece.dynamics[0][1]
  for (const [b, dyn] of piece.dynamics) if (b <= bar) d = dyn
  return d
}

// ───────────────────────── Pachelbel · Canon in D ─────────────────────────

function canon(): Piece {
  const M = 4
  const bass = 'D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2'
  const pad = 'F#3+A3+D4:2 E3+A3+C#4:2 | F#3+B3+D4:2 F#3+A3+C#4:2 | G3+B3+D4:2 F#3+A3+D4:2 | G3+B3+D4:2 E3+A3+C#4:2'
  const v1 = 'F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2'
  const v2 = 'F#5 D5 E5 C#5 | D5 B4 C#5 A4 | B4 G4 A4 F#4 | G4 B4 A4 C#5'
  const horns = 'D3+A3:2 E3+A3:2 | D3+F#3:2 C#3+F#3:2 | D3+G3:2 D3+A3:2 | D3+G3:2 E3+A3:2'
  const arp: Record<string, string> = {
    D: 'D4:.5 F#4:.5 A4:.5 F#4:.5',
    A: 'C#4:.5 E4:.5 A4:.5 E4:.5',
    Bm: 'D4:.5 F#4:.5 B4:.5 F#4:.5',
    Fm: 'C#4:.5 F#4:.5 A4:.5 F#4:.5',
    G: 'D4:.5 G4:.5 B4:.5 G4:.5',
  }
  const harp = [`${arp.D} ${arp.A}`, `${arp.Bm} ${arp.Fm}`, `${arp.G} ${arp.D}`, `${arp.G} ${arp.A}`].join(' | ')

  const t: Record<Part, NoteEv[]> = { violins: [], strings: [], cellos: [], basses: [], flute: [], oboe: [], horns: [], trumpets: [], timpani: [], harp: [] , pizz: [] }
  for (let c = 0; c < 6; c++) {
    const b = c * 4
    t.cellos.push(...seq(bass, b, M, 0.7))
    t.basses.push(...seq(oct(bass, -1), b, M, 0.65))
    t.strings.push(...seq(pad, b, M, c >= 4 ? 0.6 : 0.45))
    if (c === 1 || c === 3 || c === 5) t.violins.push(...seq(v1, b, M, 0.8))
    if (c === 2 || c === 4) t.violins.push(...seq(v2, b, M, 0.8))
    if (c === 3) t.flute.push(...seq(oct(v2, 1), b, M, 0.6))
    if (c === 4) t.flute.push(...seq(oct(v1, 1), b, M, 0.65))
    if (c === 5) t.flute.push(...seq(oct(v2, 1), b, M, 0.6))
    if (c >= 3) t.harp.push(...seq(harp, b, M, 0.55))
    if (c >= 4) t.horns.push(...seq(horns, b, M, 0.55))
  }
  // final D major chord, held over two bars
  const end = 24 * M
  t.violins.push(hold(end, 8, 'D5+F#5+A5', 0.8))
  t.flute.push(hold(end, 8, 'D6', 0.6))
  t.strings.push(hold(end, 8, 'F#3+A3+D4', 0.7))
  t.horns.push(hold(end, 8, 'D3+A3', 0.6))
  t.cellos.push(hold(end, 8, 'D3', 0.75))
  t.basses.push(hold(end, 8, 'D2', 0.7))
  t.harp.push(...seq('D3+A3+D4+F#4+A4+D5:4 | r:4', 24, M, 0.6))

  return {
    id: 'canon',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    life: '1653 – 1706',
    work: 'Canon and Gigue in D major',
    marking: 'Andante',
    bpm: 66,
    meter: 4,
    level: 'Beginner',
    about:
      'Pachelbel wrote his Canon over a bass line of just eight notes that repeats again and again, while the violins enter one after another. It was almost forgotten for two centuries, rediscovered in 1919, and is now one of the most played pieces at weddings around the world.',
    tip: 'A calm 4/4: ↓ ← → ↑. Keep your beats even and your gestures small at first; grow them when the horns join in.',
    bars: 26,
    holdFromBar: 24,
    tracks: [
      { part: 'violins', notes: t.violins },
      { part: 'flute', notes: t.flute },
      { part: 'strings', notes: t.strings },
      { part: 'cellos', notes: t.cellos },
      { part: 'basses', notes: t.basses },
      { part: 'harp', notes: t.harp, artic: 0.9 },
      { part: 'horns', notes: t.horns },
    ],
    dynamics: [
      [0, 'p'],
      [8, 'mp'],
      [12, 'mf'],
      [16, 'f'],
      [20, 'mf'],
      [24, 'f'],
    ],
  }
}

// ──────────────────── Beethoven · Symphony No. 9, "Ode to Joy" ────────────────────

function ode(): Piece {
  const M = 4
  const theme = [
    'F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | F#4:1.5 E4:.5 E4:2',
    'F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | E4:1.5 D4:.5 D4:2',
    'E4 E4 F#4 D4 | E4 F#4:.5 G4:.5 F#4 D4 | E4 F#4:.5 G4:.5 F#4 E4 | D4 E4 A3:2',
    'F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | E4:1.5 D4:.5 D4:2',
  ].join(' | ')
  // harmony, two chords per bar
  const H = ['D D', 'D A', 'D D', 'A A', 'D D', 'D A', 'D D', 'A D', 'A D', 'A D', 'A D', 'D A', 'D D', 'D A', 'D D', 'A D']
  const root: Record<string, string> = { D: 'D3', A: 'A2' }
  const padOf: Record<string, string> = { D: 'F#3+A3+D4', A: 'E3+A3+C#4' }
  const hornOf: Record<string, string> = { D: 'D3+A3', A: 'C#3+A3' }
  const halves = (map: Record<string, string>) => H.map((h) => h.split(' ').map((c) => `${map[c]}:2`).join(' ')).join(' | ')

  const t: Record<Part, NoteEv[]> = { violins: [], strings: [], cellos: [], basses: [], flute: [], oboe: [], horns: [], trumpets: [], timpani: [], harp: [], pizz: [] }
  // 1st statement: cellos and basses alone, softly, exactly as Beethoven introduces it
  t.cellos.push(...seq(oct(theme, -1), 0, M, 0.8))
  t.basses.push(...seq(oct(theme, -2), 0, M, 0.7))
  // 2nd statement: violins take the tune over the string choir
  t.violins.push(...seq(theme, 16, M, 0.8))
  t.strings.push(...seq(halves(padOf), 16, M, 0.5))
  t.cellos.push(...seq(halves(root), 16, M, 0.7))
  t.basses.push(...seq(oct(halves(root), -1), 16, M, 0.65))
  t.oboe.push(...seq(halves(hornOf).replace(/C#3/g, 'C#4').replace(/D3/g, 'D4').replace(/A3/g, 'A4').replace(/\+[A-G]#?\d/g, ''), 16, M, 0.35))
  // 3rd statement: tutti with trumpets and timpani
  t.violins.push(...seq(oct(theme, 1), 32, M, 0.85))
  t.flute.push(...seq(oct(theme, 1), 32, M, 0.65))
  t.trumpets.push(...seq(theme, 32, M, 0.7))
  t.strings.push(...seq(halves(padOf), 32, M, 0.65))
  t.horns.push(...seq(halves(hornOf), 32, M, 0.65))
  t.cellos.push(...seq(halves(root), 32, M, 0.8))
  t.basses.push(...seq(oct(halves(root), -1), 32, M, 0.75))
  t.timpani.push(...seq(H.map((h) => `${h[0] === 'D' ? 'D2' : 'A2'} r:3`).join(' | '), 32, M, 0.8))
  // finale: D major, timpani roll
  const end = 48 * M
  t.violins.push(hold(end, 8, 'D5+F#5+A5', 0.9))
  t.flute.push(hold(end, 8, 'D6', 0.7))
  t.trumpets.push(hold(end, 8, 'A4+D5', 0.75))
  t.horns.push(hold(end, 8, 'D3+A3+F#4', 0.7))
  t.strings.push(hold(end, 8, 'F#3+A3+D4', 0.75))
  t.cellos.push(hold(end, 8, 'D3', 0.85))
  t.basses.push(hold(end, 8, 'D2', 0.8))
  t.timpani.push(...seq(Array(16).fill('D2:.5').join(' ').replace(/(D2:\.5 ){8}/, (m) => `${m}| `), 48, M, 0.7))

  return {
    id: 'ode',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    life: '1770 – 1827',
    work: 'Symphony No. 9 in D minor, Op. 125 – Finale',
    marking: 'Allegro assai',
    bpm: 104,
    meter: 4,
    level: 'Intermediate',
    about:
      'Beethoven finished his Ninth Symphony in 1824, when he was almost completely deaf. In the finale the famous tune is first whispered by the cellos and double basses alone, then passed to the violins, and finally sung by the whole orchestra. Today it is the anthem of the European Union.',
    tip: 'Start with tiny gestures (piano) for the cellos. Grow them each time more instruments join; the third time is fortissimo!',
    bars: 50,
    holdFromBar: 48,
    tracks: [
      { part: 'violins', notes: t.violins },
      { part: 'flute', notes: t.flute },
      { part: 'oboe', notes: t.oboe },
      { part: 'trumpets', notes: t.trumpets },
      { part: 'horns', notes: t.horns },
      { part: 'strings', notes: t.strings },
      { part: 'cellos', notes: t.cellos },
      { part: 'basses', notes: t.basses },
      { part: 'timpani', notes: t.timpani, artic: 0.6 },
    ],
    dynamics: [
      [0, 'p'],
      [16, 'mf'],
      [32, 'f'],
      [40, 'ff'],
    ],
  }
}

// ──────────────────── Strauss · The Blue Danube ────────────────────

function danube(): Piece {
  const M = 3
  const horns = [
    'D4 D4 F#4 | A4:3 | r:3 | r:3',
    'D4 D4 F#4 | A4:3 | r:3 | r:3',
    'C#4 C#4 E4 | B4:3 | r:3 | r:3',
    'C#4 C#4 E4 | B4:3 | r:3 | r:3',
    'D4 D4 F#4 | A4:3 | r:3 | r:3',
    'D4 D4 F#4 | A4:3 | r:3 | r:3',
    'E4 E4 G4 | B4:3 | r:3 | r:3',
    'r:3 | r:3 | r:3 | r:3',
  ].join(' | ')
  const violins = [
    'r:3 | r:3 | r A5 A5 | r F#5 F#5',
    'r:3 | r:3 | r A5 A5 | r G5 G5',
    'r:3 | r:3 | r B5 B5 | r G5 G5',
    'r:3 | r:3 | r B5 B5 | r F#5 F#5',
    'r:3 | r:3 | r D6 D6 | r A5 A5',
    'r:3 | r:3 | r D6 D6 | r B5 B5',
    'r:3 | r:3 | B4 C#5 D5 | F#5:3',
    'E5 D5 C#5 | B4:2 A4 | D5:3 | r:3',
  ].join(' | ')
  const chords = [
    ...Array(7).fill('D'), 'A7', ...Array(7).fill('A7'), 'D',
    ...Array(7).fill('D'), 'G', 'Em', 'Em', 'A7', 'D', 'A7', 'A7', 'D', 'D',
  ]
  const root: Record<string, string> = { D: 'D3', A7: 'A2', G: 'G2', Em: 'E3' }
  const voicing: Record<string, string> = { D: 'F#4+A4+D5', A7: 'E4+G4+C#5', G: 'G4+B4+D5', Em: 'E4+G4+B4' }
  const timp: Record<string, string> = { D: 'D2', A7: 'A2', G: 'G2', Em: 'E2' }

  const t: Record<Part, NoteEv[]> = { violins: [], strings: [], cellos: [], basses: [], flute: [], oboe: [], horns: [], trumpets: [], timpani: [], harp: [], pizz: [] }
  for (const pass of [0, 1]) {
    const b = pass * 32
    t.horns.push(...seq(horns, b, M, pass ? 0.75 : 0.65))
    t.cellos.push(...seq(oct(horns, -1), b, M, pass ? 0.6 : 0.5))
    t.violins.push(...seq(violins, b, M, pass ? 0.85 : 0.75))
    if (pass) t.flute.push(...seq(violins, b, M, 0.6))
    // oom-pah-pah: bass on 1, light chords on 2 and 3
    t.basses.push(...perBar(chords, b, M, (c) => `${root[c]} r:2`, 0.7).map((n) => ({ ...n, notes: n.notes.map((x) => oct(x, -1)) })))
    t.pizz.push(...perBar(chords, b, M, (c) => `r ${voicing[c]} ${voicing[c]}`, pass ? 0.6 : 0.5))
    if (pass) t.timpani.push(...perBar(chords, b, M, (c) => `${timp[c]} r:2`, 0.65))
  }
  // final "dum ... dum!"
  const fin = 'F#4+A4+D5 r:2 | F#4+A4+D5:2 r'
  t.violins.push(...seq(oct(fin, 1), 64, M, 0.9))
  t.strings.push(...seq(oct(fin, -1), 64, M, 0.8))
  t.horns.push(...seq('D4+A4 r:2 | D4+A4:2 r', 64, M, 0.8))
  t.cellos.push(...seq('D3 r:2 | D3:2 r', 64, M, 0.8))
  t.basses.push(...seq('D2 r:2 | D2:2 r', 64, M, 0.8))
  t.timpani.push(...seq('D2 r:2 | D2:2 r', 64, M, 0.85))

  return {
    id: 'danube',
    title: 'The Blue Danube',
    composer: 'Johann Strauss II',
    life: '1825 – 1899',
    work: 'An der schönen blauen Donau, Op. 314 – Waltz No. 1',
    marking: 'Tempo di valse',
    bpm: 144,
    meter: 3,
    level: 'Advanced',
    about:
      'Strauss wrote this waltz in 1866–67 for Vienna, and it became one of the most famous melodies ever written. A waltz has three beats in a bar: one strong and two light ones (oom-pah-pah). Every New Year’s Day the Vienna Philharmonic plays it as an encore.',
    tip: 'Waltz time 3/4: ↓ → ↑. Make beat 1 a little heavier, beats 2 and 3 light and quick. The horns sing the tune, the violins answer.',
    bars: 66,
    tracks: [
      { part: 'horns', notes: t.horns },
      { part: 'violins', notes: t.violins, artic: 0.6 },
      { part: 'flute', notes: t.flute, artic: 0.6 },
      { part: 'cellos', notes: t.cellos },
      { part: 'basses', notes: t.basses, artic: 0.7 },
      { part: 'pizz', notes: t.pizz, artic: 0.4 },
      { part: 'strings', notes: t.strings },
      { part: 'timpani', notes: t.timpani, artic: 0.7 },
    ],
    dynamics: [
      [0, 'mp'],
      [16, 'mf'],
      [24, 'f'],
      [32, 'mf'],
      [48, 'f'],
      [56, 'ff'],
    ],
  }
}

export const PIECES: Piece[] = [canon(), ode(), danube()]
