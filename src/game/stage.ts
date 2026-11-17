import type { GestureTracker } from '../conduct/gesture.ts'
import { beatPoints, glyph } from '../conduct/pattern.ts'
import type { Meter } from '../conduct/pattern.ts'
import type { Section } from '../music/orchestra.ts'
import type { BatonState } from '../pose/baton.ts'
import type { Hand, PoseFrame, Vec } from '../pose/pose.ts'
import { ARM } from '../pose/pose.ts'
import { JUDGMENT_TEXT } from './concert.ts'
import type { BeatResult, Phase } from './concert.ts'

const GOLD = '#f3c76b'
const GOLD_DEEP = '#b8862f'
const CREAM = '#fff4dc'
const JUDGE_COLOR: Record<string, string> = {
  bravissimo: '#ffe39a',
  bravo: '#f3c76b',
  bene: '#d9b98a',
  ancora: '#c98a7a',
  missed: '#8a6f66',
}
/** size of the beat pattern, in shoulder widths from its centre */
const PATTERN_R = 0.5

interface Seat {
  x: number
  y: number
  k: number
  section: Section
}

interface Popup {
  x: number
  y: number
  text: string
  color: string
  born: number
}

interface Note {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  glyph: string
  size: number
}

export interface StageState {
  phase: Phase
  meter: Meter
  /** heard musical position in beats (−1 before the start) */
  pos: number
  energy: Record<Section, number>
  gesture: GestureTracker
  frame: PoseFrame | null
  baton: BatonState | null
  hand: Hand
  video: HTMLVideoElement
  /** 0–1 dynamics of the conductor, for the spotlight */
  level: number
}

export class Stage {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private bg: HTMLCanvasElement
  private w = 1
  private h = 1
  private dpr = 1
  private seats: Seat[] = []
  private centroid = new Map<Section, { x: number; y: number; r: number }>()
  private popups: Popup[] = []
  private notes: Note[] = []
  private flash = 0
  /** the conducting area: body-space → screen */
  private zone = { x: 0, y: 0, s: 1 }
  pip = { x: 0, y: 0, w: 0, h: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.bg = document.createElement('canvas')
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect()
    this.w = Math.max(1, r.width)
    this.h = Math.max(1, r.height)
    this.dpr = Math.min(window.devicePixelRatio || 1, Math.min(r.width, r.height) < 600 ? 1.5 : 2)
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    const portrait = this.h > this.w
    this.zone = { x: this.w * 0.5, y: this.h * (portrait ? 0.68 : 0.68), s: portrait ? Math.min(this.w * 0.48, this.h * 0.26) : Math.min(this.w * 0.3, this.h * 0.36) }
    const pw = Math.min(this.w * (portrait ? 0.34 : 0.2), 260)
    this.pip = { w: pw, h: pw * 0.75, x: 14, y: this.h - pw * 0.75 - 14 }
    this.layout()
    this.paintHall()
  }

  // ───────────── the concert hall (painted once) ─────────────

  private layout(): void {
    const { w, h } = this
    const portrait = h > w
    const cx = w / 2
    const baseY = h * (portrait ? 0.5 : 0.56)
    const spread = w * (portrait ? 0.46 : 0.36)
    const rows = [
      { n: 10, r: 1.0, y: 0, k: 1.0 },
      { n: 12, r: 0.86, y: -0.06, k: 0.86 },
      { n: 12, r: 0.72, y: -0.115, k: 0.74 },
      { n: 12, r: 0.58, y: -0.165, k: 0.64 },
    ]
    this.seats = []
    rows.forEach((row, ri) => {
      for (let i = 0; i < row.n; i++) {
        const th = -1.25 + (2.5 * (i + 0.5)) / row.n // radians around the conductor
        if (ri === 0 && Math.abs(th) < 0.2) continue // the podium
        const x = cx + Math.sin(th) * spread * row.r
        const y = baseY + row.y * h + (1 - Math.cos(th)) * h * 0.11 * row.r
        const deg = (th * 180) / Math.PI
        let section: Section
        if (ri === 0) section = deg < 0 ? 'violins' : 'cellos'
        else if (ri === 1) section = deg < -8 ? 'violins' : 'violas'
        else if (ri === 2) section = deg < -42 ? 'harp' : deg > 42 ? 'basses' : 'woodwinds'
        else section = deg > 34 ? 'percussion' : 'brass'
        this.seats.push({ x, y, k: row.k * Math.min(1, h / 700) * (portrait ? 0.8 : 1), section })
      }
    })
    this.centroid.clear()
    const groups = new Map<Section, Seat[]>()
    for (const s of this.seats) groups.set(s.section, [...(groups.get(s.section) ?? []), s])
    for (const [sec, ss] of groups) {
      const x = ss.reduce((a, s) => a + s.x, 0) / ss.length
      const y = ss.reduce((a, s) => a + s.y, 0) / ss.length
      const r = Math.max(...ss.map((s) => Math.hypot(s.x - x, s.y - y))) + 40 * ss[0].k
      this.centroid.set(sec, { x, y, r })
    }
  }

  private paintHall(): void {
    const { w, h } = this
    this.bg.width = Math.round(w * this.dpr)
    this.bg.height = Math.round(h * this.dpr)
    const g = this.bg.getContext('2d')!
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

    // walls: warm wood and shadow
    const wall = g.createLinearGradient(0, 0, 0, h)
    wall.addColorStop(0, '#1b0907')
    wall.addColorStop(0.45, '#2b110b')
    wall.addColorStop(1, '#080302')
    g.fillStyle = wall
    g.fillRect(0, 0, w, h)

    // organ pipes behind the orchestra
    const pipesW = Math.min(w * 0.62, 900)
    const px0 = w / 2 - pipesW / 2
    const n = 31
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const ph = h * (0.18 + 0.16 * Math.pow(Math.sin(Math.PI * t), 1.5))
      const x = px0 + t * pipesW
      const pw = (pipesW / n) * 0.62
      const top = h * 0.4 - ph
      const pg = g.createLinearGradient(x, 0, x + pw, 0)
      pg.addColorStop(0, '#4a3415')
      pg.addColorStop(0.45, '#a07b3c')
      pg.addColorStop(1, '#3a2810')
      g.fillStyle = pg
      g.globalAlpha = 0.55
      g.beginPath()
      g.roundRect(x, top, pw, ph, [pw / 2, pw / 2, 0, 0])
      g.fill()
      g.fillStyle = '#120804'
      g.fillRect(x + pw * 0.2, top + ph - pw * 1.2, pw * 0.6, pw * 0.35)
    }
    g.globalAlpha = 1

    // chandeliers
    for (const fx of [0.22, 0.5, 0.78]) {
      const x = w * fx
      const y = h * 0.07
      const glow = g.createRadialGradient(x, y, 2, x, y, h * 0.22)
      glow.addColorStop(0, 'rgba(255,214,140,0.55)')
      glow.addColorStop(0.25, 'rgba(255,190,110,0.16)')
      glow.addColorStop(1, 'rgba(255,190,110,0)')
      g.fillStyle = glow
      g.fillRect(x - h * 0.22, y - h * 0.22, h * 0.44, h * 0.44)
      g.fillStyle = 'rgba(255,236,190,0.9)'
      for (let i = -3; i <= 3; i++) {
        g.beginPath()
        g.arc(x + i * 9, y + Math.abs(i) * -2 + 8, 1.8, 0, Math.PI * 2)
        g.fill()
      }
    }

    // the stage floor, in perspective
    const floorY = h * (h > w ? 0.42 : 0.44)
    const fl = g.createLinearGradient(0, floorY, 0, h)
    fl.addColorStop(0, '#3b2111')
    fl.addColorStop(1, '#1a0c05')
    g.fillStyle = fl
    g.beginPath()
    g.moveTo(w * 0.12, floorY)
    g.lineTo(w * 0.88, floorY)
    g.lineTo(w * 1.1, h)
    g.lineTo(-w * 0.1, h)
    g.closePath()
    g.fill()
    g.strokeStyle = 'rgba(0,0,0,0.25)'
    g.lineWidth = 1
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      g.beginPath()
      g.moveTo(w * (0.12 + 0.76 * t), floorY)
      g.lineTo(w * (-0.1 + 1.2 * t), h)
      g.stroke()
    }

    // the orchestra: seats, stand lamps, players
    for (const s of [...this.seats].sort((a, b) => a.y - b.y)) this.paintPlayer(g, s)

    // velvet curtains
    const cw = Math.max(40, w * 0.12)
    for (const side of [0, 1]) {
      const x0 = side ? w - cw : 0
      const cg = g.createLinearGradient(x0, 0, x0 + cw, 0)
      for (let i = 0; i <= 8; i++) {
        const t = i / 8
        const shade = 0.55 + 0.45 * Math.sin(t * Math.PI * 4 + (side ? 1 : 0))
        cg.addColorStop(t, `rgb(${Math.round(90 * shade + 20)},${Math.round(8 * shade)},${Math.round(14 * shade + 4)})`)
      }
      g.fillStyle = cg
      g.beginPath()
      if (side) {
        g.moveTo(w, 0)
        g.lineTo(w - cw, 0)
        g.quadraticCurveTo(w - cw * 0.55, h * 0.55, w - cw * 0.9, h)
        g.lineTo(w, h)
      } else {
        g.moveTo(0, 0)
        g.lineTo(cw, 0)
        g.quadraticCurveTo(cw * 0.55, h * 0.55, cw * 0.9, h)
        g.lineTo(0, h)
      }
      g.closePath()
      g.fill()
    }
    // valance with gold trim
    const vh = h * 0.07
    const vg = g.createLinearGradient(0, 0, 0, vh)
    vg.addColorStop(0, '#4d0610')
    vg.addColorStop(1, '#7d0f1d')
    g.fillStyle = vg
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(w, 0)
    g.lineTo(w, vh)
    const sw = w / 14
    for (let i = 14; i >= 0; i--) g.quadraticCurveTo(i * sw + sw / 2, vh + 14, i * sw, vh)
    g.closePath()
    g.fill()
    g.strokeStyle = GOLD_DEEP
    g.lineWidth = 2
    g.stroke()

    // vignette
    const vig = g.createRadialGradient(w / 2, h * 0.55, h * 0.3, w / 2, h * 0.55, Math.max(w, h) * 0.8)
    vig.addColorStop(0, 'rgba(0,0,0,0)')
    vig.addColorStop(1, 'rgba(0,0,0,0.65)')
    g.fillStyle = vig
    g.fillRect(0, 0, w, h)
  }

  private paintPlayer(g: CanvasRenderingContext2D, s: Seat): void {
    const k = s.k * 1.15
    const { x, y } = s
    // music stand with a little lamp
    g.fillStyle = '#0d0604'
    g.fillRect(x - 9 * k, y - 34 * k, 18 * k, 3 * k)
    g.fillRect(x - 0.8 * k, y - 34 * k, 1.6 * k, 22 * k)
    const lamp = g.createRadialGradient(x, y - 36 * k, 0, x, y - 36 * k, 16 * k)
    lamp.addColorStop(0, 'rgba(255,215,140,0.55)')
    lamp.addColorStop(1, 'rgba(255,215,140,0)')
    g.fillStyle = lamp
    g.fillRect(x - 16 * k, y - 52 * k, 32 * k, 32 * k)
    // player silhouette (behind the stand, facing the conductor)
    const py = y - 20 * k
    g.fillStyle = '#0a0403'
    g.beginPath()
    g.ellipse(x, py - 10 * k, 5.2 * k, 6 * k, 0, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(x - 9 * k, py + 12 * k)
    g.quadraticCurveTo(x - 9 * k, py - 3 * k, x, py - 3.5 * k)
    g.quadraticCurveTo(x + 9 * k, py - 3 * k, x + 9 * k, py + 12 * k)
    g.closePath()
    g.fill()
    // a rim of warm light from the stand lamp
    g.strokeStyle = 'rgba(255,200,120,0.35)'
    g.lineWidth = 1
    g.beginPath()
    g.ellipse(x, py - 10 * k, 5.2 * k, 6 * k, 0, Math.PI * 1.1, Math.PI * 1.9)
    g.stroke()
    // instrument hints
    g.strokeStyle = 'rgba(214,160,80,0.75)'
    g.fillStyle = 'rgba(150,90,40,0.85)'
    g.lineWidth = 1.4 * k
    switch (s.section) {
      case 'violins':
      case 'violas':
        g.beginPath()
        g.moveTo(x - 7 * k, py - 2 * k)
        g.lineTo(x + 6 * k, py - 9 * k)
        g.stroke()
        break
      case 'cellos':
        g.beginPath()
        g.ellipse(x + 6 * k, py + 8 * k, 4 * k, 7 * k, 0.2, 0, Math.PI * 2)
        g.fill()
        break
      case 'basses':
        g.beginPath()
        g.ellipse(x + 7 * k, py + 4 * k, 5 * k, 11 * k, 0.15, 0, Math.PI * 2)
        g.fill()
        break
      case 'woodwinds':
        g.beginPath()
        g.moveTo(x, py - 6 * k)
        g.lineTo(x + 1 * k, py + 9 * k)
        g.stroke()
        break
      case 'brass':
        g.fillStyle = 'rgba(232,180,70,0.85)'
        g.beginPath()
        g.arc(x + 6 * k, py - 4 * k, 3.4 * k, 0, Math.PI * 2)
        g.fill()
        break
      case 'percussion': {
        const kg = g.createLinearGradient(x - 14 * k, 0, x + 14 * k, 0)
        kg.addColorStop(0, '#5a3110')
        kg.addColorStop(0.5, '#c07a2c')
        kg.addColorStop(1, '#4a280c')
        g.fillStyle = kg
        g.beginPath()
        g.ellipse(x, py + 12 * k, 13 * k, 5 * k, 0, 0, Math.PI)
        g.fill()
        g.strokeStyle = GOLD
        g.beginPath()
        g.ellipse(x, py + 12 * k, 13 * k, 4 * k, 0, 0, Math.PI * 2)
        g.stroke()
        break
      }
      case 'harp':
        g.strokeStyle = GOLD
        g.beginPath()
        g.moveTo(x - 10 * k, py + 12 * k)
        g.lineTo(x - 10 * k, py - 26 * k)
        g.quadraticCurveTo(x + 4 * k, py - 20 * k, x + 4 * k, py + 12 * k)
        g.stroke()
        break
    }
  }

  // ───────────── every frame ─────────────

  /** body space (shoulder widths, relative to the pattern centre) → screen */
  private toScreen(p: Vec, home: Vec): Vec {
    return { x: this.zone.x + (p.x - home.x) * this.zone.s, y: this.zone.y + (p.y - home.y) * this.zone.s }
  }

  result(r: BeatResult, meter: Meter, hand: Hand, home: Vec): void {
    const pts = beatPoints(meter, hand)
    const p = pts[r.beat % meter]
    const at = this.toScreen({ x: home.x + p.x * PATTERN_R, y: home.y + p.y * PATTERN_R }, home)
    this.popups.push({ x: at.x, y: at.y - 26, text: JUDGMENT_TEXT[r.judgment], color: JUDGE_COLOR[r.judgment], born: performance.now() })
    if (r.judgment === 'missed') return
    const n = r.judgment === 'bravissimo' ? 14 : r.judgment === 'bravo' ? 9 : 5
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
      const sp = 60 + Math.random() * 120
      this.notes.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 0.9 + Math.random() * 0.6,
        glyph: ['♪', '♫', '♩', '♬'][i % 4],
        size: 14 + Math.random() * 12,
      })
    }
    if (r.judgment === 'bravissimo') this.flash = 1
  }

  draw(st: StageState, dt: number): void {
    const g = this.ctx
    const { w, h } = this
    g.clearRect(0, 0, w, h)
    g.drawImage(this.bg, 0, 0, w, h)

    // the sections light up as they play
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (const [sec, c] of this.centroid) {
      const e = st.energy[sec]
      if (e < 0.02) continue
      const gl = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 1.2)
      gl.addColorStop(0, `rgba(255,196,110,${0.32 * e})`)
      gl.addColorStop(1, 'rgba(255,196,110,0)')
      g.fillStyle = gl
      g.fillRect(c.x - c.r * 1.2, c.y - c.r * 1.2, c.r * 2.4, c.r * 2.4)
      // a few notes float up from the busiest sections
      if (Math.random() < e * dt * 3) {
        this.notes.push({
          x: c.x + (Math.random() - 0.5) * c.r,
          y: c.y - 20,
          vx: (Math.random() - 0.5) * 12,
          vy: -30 - Math.random() * 30,
          life: 0,
          max: 1.8,
          glyph: Math.random() < 0.5 ? '♪' : '♫',
          size: 12 + Math.random() * 8,
        })
      }
    }
    // spotlight on the podium, brighter when you conduct big
    const sp = g.createRadialGradient(this.zone.x, this.zone.y, 0, this.zone.x, this.zone.y, this.zone.s * 1.3)
    sp.addColorStop(0, `rgba(255,232,180,${0.07 + 0.08 * st.level})`)
    sp.addColorStop(1, 'rgba(255,232,180,0)')
    g.fillStyle = sp
    g.fillRect(0, 0, w, h)
    g.restore()

    this.drawPattern(st)
    this.drawBaton(st)
    this.drawNotes(dt)
    this.drawPopups()
    this.drawPip(st)

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,236,190,${this.flash * 0.08})`
      g.fillRect(0, 0, w, h)
      this.flash = Math.max(0, this.flash - dt * 4)
    }
  }

  private drawPattern(st: StageState): void {
    const g = this.ctx
    const home = st.gesture.home
    const pts = beatPoints(st.meter, st.hand).map((p) => this.toScreen({ x: home.x + p.x * PATTERN_R, y: home.y + p.y * PATTERN_R }, home))
    const m = st.meter
    // the whole figure, faint
    g.save()
    g.strokeStyle = 'rgba(243,199,107,0.22)'
    g.lineWidth = 2
    g.setLineDash([3, 7])
    g.beginPath()
    for (let i = 0; i <= m; i++) {
      const a = pts[(i + m - 1) % m]
      const b = pts[i % m]
      if (i === 0) g.moveTo(a.x, a.y)
      // conducting strokes curve gently
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2 + Math.abs(b.x - a.x) * 0.18
      g.quadraticCurveTo(mx, my, b.x, b.y)
    }
    g.stroke()
    g.setLineDash([])
    g.font = `600 ${Math.round(this.zone.s * 0.09 + 8)}px "Cormorant Garamond", Georgia, serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    pts.forEach((p, i) => {
      g.fillStyle = 'rgba(243,199,107,0.45)'
      g.fillText(String(i + 1), p.x + (i === 0 ? 0 : (p.x - this.zone.x) * 0.18), p.y + (i === 0 ? 22 : -18))
    })
    g.restore()

    if (st.phase === 'ready' || st.phase === 'prep' || st.phase === 'waiting') {
      // a big pulsing cue: upbeat first, then the downbeat
      const up = st.phase === 'ready'
      const t = performance.now() / 1000
      const a = up ? pts[0] : pts[m - 1]
      const b = up ? pts[m - 1] : pts[0]
      this.arrow(a, b, 0.55 + 0.45 * Math.sin(t * 4), 7, ((t * 0.8) % 1) as number)
      return
    }
    if (st.pos < 0) return
    // the beat that is coming: its arrow, with a light travelling along it to land on the beat
    const next = Math.ceil(st.pos + 1e-6)
    const frac = 1 - (next - st.pos)
    const k = next % m
    const from = pts[(k + m - 1) % m]
    const to = pts[k]
    this.arrow(from, to, 1, 6, frac)
    // the one after, faint
    const k2 = (k + 1) % m
    this.arrow(pts[k], pts[k2], 0.18, 3, -1)
    // landing ring closing in on the beat point
    g.save()
    g.strokeStyle = GOLD
    g.globalAlpha = 0.3 + 0.6 * frac
    g.lineWidth = 2
    g.beginPath()
    g.arc(to.x, to.y, 10 + (1 - frac) * this.zone.s * 0.18, 0, Math.PI * 2)
    g.stroke()
    g.restore()
    // the beat's direction glyph
    g.save()
    g.font = `700 ${Math.round(this.zone.s * 0.12 + 10)}px "Playfair Display", Georgia, serif`
    g.fillStyle = 'rgba(255,240,205,0.85)'
    g.textAlign = 'center'
    g.fillText(glyph(m, k, st.hand), to.x + (to.x - this.zone.x) * 0.35, to.y + (to.y - this.zone.y) * 0.35)
    g.restore()
  }

  /** a golden arrow from a to b; `travel` 0–1 places a light along it (−1: none) */
  private arrow(a: Vec, b: Vec, alpha: number, width: number, travel: number): void {
    const g = this.ctx
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2 + Math.abs(b.x - a.x) * 0.18
    const ang = Math.atan2(b.y - my, b.x - mx)
    g.save()
    g.globalAlpha = alpha
    g.lineCap = 'round'
    const grad = g.createLinearGradient(a.x, a.y, b.x, b.y)
    grad.addColorStop(0, 'rgba(243,199,107,0.15)')
    grad.addColorStop(1, GOLD)
    g.strokeStyle = grad
    g.lineWidth = width
    g.shadowColor = 'rgba(255,200,110,0.8)'
    g.shadowBlur = width * 2.5
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.quadraticCurveTo(mx, my, b.x, b.y)
    g.stroke()
    const hs = width * 3.2
    g.fillStyle = GOLD
    g.beginPath()
    g.moveTo(b.x + Math.cos(ang) * hs * 0.6, b.y + Math.sin(ang) * hs * 0.6)
    g.lineTo(b.x + Math.cos(ang + 2.5) * hs, b.y + Math.sin(ang + 2.5) * hs)
    g.lineTo(b.x + Math.cos(ang - 2.5) * hs, b.y + Math.sin(ang - 2.5) * hs)
    g.closePath()
    g.fill()
    if (travel >= 0) {
      const t = 1 - Math.pow(1 - Math.min(1, travel), 1.6)
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y
      const r = width * 2.2
      const glow = g.createRadialGradient(x, y, 0, x, y, r * 3)
      glow.addColorStop(0, 'rgba(255,248,225,1)')
      glow.addColorStop(0.3, 'rgba(255,210,130,0.7)')
      glow.addColorStop(1, 'rgba(255,210,130,0)')
      g.shadowBlur = 0
      g.fillStyle = glow
      g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6)
    }
    g.restore()
  }

  private drawBaton(st: StageState): void {
    const g = this.ctx
    const home = st.gesture.home
    const tr = st.gesture.trail
    if (tr.length < 2) return
    const now = performance.now()
    g.save()
    g.globalCompositeOperation = 'lighter'
    g.lineCap = 'round'
    for (let i = 1; i < tr.length; i++) {
      const a = this.toScreen(tr[i - 1], home)
      const b = this.toScreen(tr[i], home)
      const age = (now - tr[i].t) / 450
      g.strokeStyle = `rgba(255,214,140,${Math.max(0, 0.75 * (1 - age))})`
      g.lineWidth = 1 + 7 * (1 - age)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
      g.stroke()
    }
    const tip = this.toScreen(tr[tr.length - 1], home)
    const glow = g.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 22)
    glow.addColorStop(0, 'rgba(255,252,240,1)')
    glow.addColorStop(0.35, 'rgba(255,214,140,0.6)')
    glow.addColorStop(1, 'rgba(255,214,140,0)')
    g.fillStyle = glow
    g.fillRect(tip.x - 22, tip.y - 22, 44, 44)
    g.restore()
  }

  private drawNotes(dt: number): void {
    const g = this.ctx
    g.save()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    this.notes = this.notes.filter((n) => {
      n.life += dt
      if (n.life > n.max) return false
      n.x += n.vx * dt
      n.y += n.vy * dt
      n.vy -= 10 * dt
      g.globalAlpha = Math.min(1, (1 - n.life / n.max) * 1.4)
      g.fillStyle = GOLD
      g.font = `${n.size}px Georgia, serif`
      g.fillText(n.glyph, n.x, n.y)
      return true
    })
    if (this.notes.length > 220) this.notes.splice(0, this.notes.length - 220)
    g.restore()
  }

  private drawPopups(): void {
    const g = this.ctx
    const now = performance.now()
    const size = Math.max(20, Math.min(40, this.zone.s * 0.12))
    g.save()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    this.popups = this.popups.filter((p) => {
      const age = (now - p.born) / 900
      if (age > 1) return false
      g.globalAlpha = 1 - age * age
      g.font = `italic 700 ${size * (age < 0.1 ? 0.8 + age * 2 : 1)}px "Playfair Display", Georgia, serif`
      g.lineWidth = 4
      g.strokeStyle = 'rgba(20,6,4,0.8)'
      g.strokeText(p.text, p.x, p.y - age * 30)
      g.fillStyle = p.color
      g.fillText(p.text, p.x, p.y - age * 30)
      return true
    })
    g.restore()
  }

  /** small mirrored camera view with the tracked arm and baton */
  private drawPip(st: StageState): void {
    const g = this.ctx
    const { x, y, w, h } = this.pip
    const v = st.video
    if (v.readyState < 2) return
    const vw = v.videoWidth || 640
    const vh = v.videoHeight || 480
    g.save()
    g.beginPath()
    g.roundRect(x, y, w, h, 10)
    g.clip()
    g.translate(x + w, y)
    g.scale(-1, 1)
    g.globalAlpha = 0.85
    g.drawImage(v, 0, 0, w, h)
    g.restore()
    const sx = w / vw
    const sy = h / vh
    const map = (p: Vec) => ({ x: x + p.x * sx, y: y + p.y * sy })
    const f = st.frame
    g.save()
    if (f) {
      const arm = ARM[st.hand]
      const chain = [arm.shoulder, arm.elbow, arm.wrist].map((i) => f.pts[i])
      g.strokeStyle = 'rgba(255,230,180,0.7)'
      g.lineWidth = 2
      g.beginPath()
      let started = false
      for (const p of chain) {
        if (!p) continue
        const q = map(p)
        if (started) g.lineTo(q.x, q.y)
        else g.moveTo(q.x, q.y)
        started = true
      }
      g.stroke()
    }
    const b = st.baton
    if (b) {
      const a = map(b.hand)
      const t = map(b.tip)
      g.strokeStyle = b.held ? '#fff6dc' : 'rgba(243,199,107,0.6)'
      g.setLineDash(b.held ? [] : [4, 4])
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(t.x, t.y)
      g.stroke()
      g.setLineDash([])
    }
    g.strokeStyle = GOLD_DEEP
    g.lineWidth = 2
    g.beginPath()
    g.roundRect(x, y, w, h, 10)
    g.stroke()
    g.font = '600 12px "Cormorant Garamond", Georgia, serif'
    g.fillStyle = CREAM
    g.textAlign = 'left'
    g.fillText(b?.held ? '✓ Baton detected' : 'Hand as baton', x + 8, y + 16)
    g.restore()
  }
}
