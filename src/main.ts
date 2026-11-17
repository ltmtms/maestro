import './style.css'
import { analyzeRecording, applause, audioContext, decodeFile } from './audio/audio.ts'
import { GestureTracker } from './conduct/gesture.ts'
import { beatPoints } from './conduct/pattern.ts'
import type { Meter } from './conduct/pattern.ts'
import { gradeOf, OrchestraPerformance, RecordingPerformance } from './game/concert.ts'
import type { Performance, RecordingInput } from './game/concert.ts'
import { Stage } from './game/stage.ts'
import { Orchestra } from './music/orchestra.ts'
import { PIECES } from './music/scores.ts'
import type { Dyn, Part, Piece } from './music/scores.ts'
import { BatonFinder } from './pose/baton.ts'
import type { BatonState } from './pose/baton.ts'
import { openCamera, PoseTracker } from './pose/pose.ts'
import type { Hand, PoseFrame } from './pose/pose.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const video = $<HTMLVideoElement>('camera')
const stage = new Stage($<HTMLCanvasElement>('stage'))
const baton = new BatonFinder()
const gesture = new GestureTracker()

/** a quarter-note symbol that renders the same in every font */
const QUARTER =
  '<svg class="q" viewBox="0 0 10 16" aria-label="quarter note"><ellipse cx="4" cy="13" rx="3.6" ry="2.5" transform="rotate(-22 4 13)"/><rect x="6.5" y="1" width="1.3" height="12"/></svg>'

const DYN_NAME: Record<Dyn, string> = {
  pp: 'pianissimo',
  p: 'piano',
  mp: 'mezzo-piano',
  mf: 'mezzo-forte',
  f: 'forte',
  ff: 'fortissimo',
}

type Choice = { kind: 'piece'; piece: Piece } | { kind: 'recording'; file: File }

let choice: Choice = { kind: 'piece', piece: PIECES[0] }
let hand: Hand = 'R'
let tracker: PoseTracker | null = null
let orchestra: Orchestra | null = null
let recording: { file: File; input: RecordingInput } | null = null
let perf: Performance | null = null
let mode: 'menu' | 'play' | 'paused' | 'results' = 'menu'
let lastFrame: PoseFrame | null = null
let lastBaton: BatonState | null = null
let lastSeen = 0

try {
  const h = localStorage.getItem('maestro.hand')
  if (h === 'L' || h === 'R') hand = h
} catch {
  /* storage unavailable */
}

type Screen = 'menu' | 'loading' | 'paused' | 'results' | null
function show(s: Screen): void {
  for (const id of ['menu', 'loading', 'paused', 'results']) $(id).classList.toggle('active', id === s)
  $('hud').classList.toggle('active', s === null || s === 'paused')
}

function toast(msg: string, ms = 4500): void {
  const t = $('toast')
  t.textContent = msg
  t.classList.add('show')
  window.setTimeout(() => t.classList.remove('show'), ms)
}

function setLoading(text: string, r: number, sub = ''): void {
  $('load-text').textContent = text
  $('load-bar').style.width = `${Math.round(r * 100)}%`
  $('load-sub').textContent = sub
}

// ───────────────────────── menu ─────────────────────────

function patternSvg(meter: Meter): string {
  const pts = beatPoints(meter, hand).map((p) => ({ x: 60 + p.x * 40, y: 60 + p.y * 40 }))
  let path = ''
  let heads = ''
  for (let i = 0; i < meter; i++) {
    const a = pts[(i + meter - 1) % meter]
    const b = pts[i]
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2 + Math.abs(b.x - a.x) * 0.18
    path += `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y} `
    const ang = Math.atan2(b.y - my, b.x - mx)
    const h = (d: number) => `${b.x + Math.cos(ang + d) * 8},${b.y + Math.sin(ang + d) * 8}`
    heads += `<polygon points="${b.x + Math.cos(ang) * 3},${b.y + Math.sin(ang) * 3} ${h(2.6)} ${h(-2.6)}" fill="#f3c76b"/>`
  }
  const nums = pts
    .map((p, i) => `<text x="${p.x + (i === 0 ? 0 : (p.x - 60) * 0.25)}" y="${p.y + (i === 0 ? 16 : -8)}" fill="#fff4dc" font-size="13" text-anchor="middle" font-style="italic">${i + 1}</text>`)
    .join('')
  return `<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"><path d="${path}" fill="none" stroke="#f3c76b" stroke-width="2.5" stroke-linecap="round"/>${heads}${nums}</svg>`
}

function renderMenu(): void {
  const list = $('pieces')
  list.innerHTML = ''
  for (const p of PIECES) {
    const b = document.createElement('button')
    b.className = 'piece'
    b.classList.toggle('active', choice.kind === 'piece' && choice.piece.id === p.id)
    b.innerHTML = `
      <span class="level">${p.level}</span>
      <p class="composer">${p.composer} · ${p.life}</p>
      <p class="title">${p.title}</p>
      <p class="meta">${p.marking} · ${p.meter}/4 · ${QUARTER} = ${p.bpm}</p>
      <p class="blurb">${p.about}</p>`
    b.addEventListener('click', () => {
      choice = { kind: 'piece', piece: p }
      renderMenu()
    })
    list.append(b)
  }
  $('patterns').innerHTML = ([4, 3, 2] as Meter[])
    .map((m) => `<figure>${patternSvg(m)}<figcaption>${m}/4</figcaption></figure>`)
    .join('')
  document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.hand === hand))
  $('file').closest('.upload')!.classList.toggle('active', choice.kind === 'recording')
  ;($('start') as HTMLButtonElement).disabled = false
}

document.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    hand = b.dataset.hand as Hand
    baton.hand = hand
    try {
      localStorage.setItem('maestro.hand', hand)
    } catch {
      /* ignore */
    }
    renderMenu()
  }),
)

$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  choice = { kind: 'recording', file: f }
  $('file-name').textContent = `♪ ${f.name.replace(/\.[^.]+$/, '')}`
  renderMenu()
})

$('start').addEventListener('click', () => void begin())

// ───────────────────────── getting on stage ─────────────────────────

const ALL_PARTS: Part[] = [...new Set(PIECES.flatMap((p) => p.tracks.map((t) => t.part)))]

async function begin(): Promise<void> {
  const ctx = audioContext() // unlock audio inside the tap (iOS)
  show('loading')
  try {
    if (!video.srcObject) {
      setLoading('Opening the stage door…', 0.05, 'Please allow the camera')
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access (HTTPS is required).')
      await openCamera(video)
    }
    if (!tracker) {
      setLoading('Learning to see the conductor…', 0.15, 'MediaPipe pose model')
      const t = new PoseTracker(video)
      await t.load((m) => setLoading('Learning to see the conductor…', 0.2, m))
      t.onFrame = onFrame
      t.start()
      tracker = t
    }
    baton.hand = hand

    if (choice.kind === 'piece') {
      if (!orchestra) {
        setLoading('The musicians take their seats…', 0.3, 'Loading the orchestra (≈4 MB)')
        orchestra = await Orchestra.load(ctx, ALL_PARTS, (r) => setLoading('The musicians take their seats…', 0.3 + r * 0.6, `${Math.round(r * 100)}%`))
      }
      setLoading('Tuning…', 0.95, `${choice.piece.composer}: ${choice.piece.title}`)
      perf = new OrchestraPerformance(choice.piece, orchestra, ctx, hand)
    } else {
      const file = choice.file
      if (!recording || recording.file !== file) {
        setLoading('Listening to your recording…', 0.3, 'Finding the beat and the bars')
        const buffer = await decodeFile(file)
        const chart = await analyzeRecording(buffer, (r) => setLoading('Listening to your recording…', 0.3 + r * 0.6, `${Math.round(r * 100)}%`))
        recording = { file, input: { name: file.name.replace(/\.[^.]+$/, ''), buffer, beats: chart.beats, downbeats: chart.downbeats, bpm: chart.bpm } }
      }
      perf = new RecordingPerformance(recording.input, ctx, hand, 4)
    }
    startPerformance()
  } catch (err) {
    console.error(err)
    const msg = err instanceof Error ? err.message : String(err)
    toast(/Permission|NotAllowed|denied/i.test(msg) ? 'Camera permission was denied. Allow the camera in your browser settings and try again.' : `Something went wrong: ${msg}`, 7000)
    show('menu')
  }
}

function startPerformance(): void {
  if (!perf) return
  const p = perf
  gesture.reset()
  gesture.onIctus = (i) => {
    if (mode === 'play') p.onIctus(i, gesture.level)
  }
  p.onResult = (r) => {
    stage.result(r, p.meter, hand, gesture.home)
    bumpCombo()
  }
  $('h-title').textContent = p.title
  $('h-sub').textContent = p.subtitle
  $('h-marking').textContent = p.marking
  mode = 'play'
  show(null)
}

function onFrame(f: PoseFrame): void {
  lastFrame = f
  if (!f.center || f.shoulder <= 0) return
  const b = baton.update(video, f)
  lastBaton = b
  if (!b) return
  lastSeen = performance.now()
  // baton tip in body space: shoulder widths from the shoulders' midpoint
  gesture.update({ x: (b.tip.x - f.center.x) / f.shoulder, y: (b.tip.y - f.center.y) / f.shoulder }, f.t)
}

// ───────────────────────── HUD ─────────────────────────

function bumpCombo(): void {
  const s = perf?.stats
  $('h-points').textContent = (s?.points ?? 0).toLocaleString()
  $('h-combo').textContent = s && s.combo >= 4 ? `${s.combo} in a row` : ''
}

let shownMsg = ''
function updateHud(): void {
  if (!perf) return
  const pos = perf.pos()
  const m = perf.meter
  const bpm = Math.round(perf.bpm)
  $('h-bpm').textContent = perf.phase === 'ready' || perf.phase === 'prep' ? String(perf.markingBpm) : String(bpm)
  const ratio = perf.bpm / perf.markingBpm
  $('h-bpm-note').textContent =
    perf instanceof RecordingPerformance || perf.phase !== 'playing' ? '' : ratio > 1.1 ? 'accelerando' : ratio < 0.9 ? 'ritardando' : 'a tempo'
  $('h-bar').textContent = pos >= 0 ? `Bar ${Math.floor(pos / m) + 1} · beat ${(Math.floor(pos) % m) + 1} of ${m}` : `${m}/4`
  // dynamics meter: your gesture vs. the marking
  const target = perf.targetDyn()
  $('dyn-level').style.bottom = `${gesture.level * 92}%`
  $('dyn-target').style.bottom = `${Math.max(0, target.level * 92 - 7)}%`
  $('dyn-label').textContent = target.label ? DYN_NAME[target.label] : 'match the music'
  let msg = perf.message
  if (performance.now() - lastSeen > 1500) msg = 'Step into view: the camera needs to see you and your conducting hand'
  if (msg !== shownMsg) {
    shownMsg = msg
    const el = $('message')
    if (msg) el.textContent = msg
    el.classList.toggle('show', !!msg)
  }
}

// ───────────────────────── intermission & curtain call ─────────────────────────

$('pause').addEventListener('click', () => {
  if (mode !== 'play') return
  mode = 'paused'
  void audioContext().suspend()
  show('paused')
})
$('resume').addEventListener('click', () => {
  if (mode !== 'paused') return
  void audioContext().resume()
  mode = 'play'
  show(null)
})
$('restart').addEventListener('click', () => {
  perf?.stop()
  void audioContext().resume()
  void begin()
})
$('quit').addEventListener('click', () => {
  perf?.stop()
  perf = null
  void audioContext().resume()
  mode = 'menu'
  show('menu')
})
$('again').addEventListener('click', () => void begin())
$('to-menu').addEventListener('click', () => {
  mode = 'menu'
  show('menu')
})

function finish(): void {
  if (!perf) return
  const p = perf
  mode = 'results'
  const { grade, title, accuracy } = gradeOf(p.stats)
  window.setTimeout(() => {
    p.stop()
    $('grade').textContent = grade
    $('grade-title').textContent = title
    $('r-piece').textContent = `${p.title} · ${p.subtitle}`
    for (const k of ['bravissimo', 'bravo', 'bene', 'ancora', 'missed'] as const) $(`r-${k}`).textContent = String(p.stats.counts[k])
    const avgTempo = p.stats.tempoN ? Math.round(p.stats.tempoSum / p.stats.tempoN) : 0
    $('r-detail').textContent =
      `Accuracy ${Math.round(accuracy * 100)}% · longest run ${p.stats.maxCombo} · ${p.stats.points.toLocaleString()} points` +
      (avgTempo ? ` · your tempo ${avgTempo} BPM (marked ${p.markingBpm})` : '')
    $('r-about').textContent = choice.kind === 'piece' ? `${choice.piece.about} ${choice.piece.tip}` : 'Every recording is a different conductor’s interpretation. Try conducting the same piece by two orchestras and feel how their tempo and energy differ.'
    show('results')
    applause(Math.min(1, accuracy * 1.1))
  }, 900)
}

// ───────────────────────── main loop ─────────────────────────

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (mode === 'play' && perf) {
    // a beat can't come sooner than ~45% of a beat after the last one
    gesture.minGapMs = Math.max(150, (0.45 * 60000) / (perf.phase === 'playing' ? perf.bpm : perf.markingBpm))
    gesture.decay(dt)
    perf.update(gesture.level)
    updateHud()
    if (perf.phase === 'done') finish()
  }
  orchestra?.tick(dt)
  stage.draw(
    {
      phase: perf && mode !== 'menu' ? perf.phase : 'done',
      meter: perf?.meter ?? 4,
      pos: perf && mode !== 'menu' ? perf.pos() : -1,
      energy: orchestra?.energy ?? { violins: 0, violas: 0, cellos: 0, basses: 0, woodwinds: 0, brass: 0, percussion: 0, harp: 0 },
      gesture,
      frame: lastFrame,
      baton: lastBaton,
      hand,
      video,
      level: gesture.level,
    },
    dt,
  )
  requestAnimationFrame(frame)
}

window.addEventListener('resize', () => stage.resize())
window.addEventListener('orientationchange', () => window.setTimeout(() => stage.resize(), 200))
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'play') $('pause').click()
})
// development only (stripped from production builds): lets an automated test conduct
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__maestro = {
    gesture,
    perf: () => perf,
    seen: () => (lastSeen = performance.now()),
    pauseTracking: () => tracker?.stop(),
  }
}

stage.resize()
renderMenu()
show('menu')
requestAnimationFrame(frame)
