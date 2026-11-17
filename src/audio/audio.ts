import type { Chart } from '../game/types.ts'
import { ANALYSIS_RATE } from './beatTrack.ts'

let shared: AudioContext | null = null

/** Must first be called from a user gesture (iOS). */
export function audioContext(): AudioContext {
  if (!shared) shared = new AudioContext({ latencyHint: 'interactive' })
  if (shared.state === 'suspended') void shared.resume()
  return shared
}

export async function decodeFile(file: File): Promise<AudioBuffer> {
  return audioContext().decodeAudioData(await file.arrayBuffer())
}

/** tempo, beats and downbeats of a recording (runs in a worker) */
export async function analyzeRecording(buffer: AudioBuffer, onProgress: (r: number) => void): Promise<Chart> {
  const len = Math.ceil(buffer.duration * ANALYSIS_RATE)
  const off = new OfflineAudioContext(1, len, ANALYSIS_RATE)
  const src = off.createBufferSource()
  src.buffer = buffer
  src.connect(off.destination)
  src.start()
  const samples = (await off.startRendering()).getChannelData(0)
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<Chart>((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'progress') onProgress(m.value)
        else if (m.type === 'done') resolve(m.chart)
        else reject(new Error(m.message))
      }
      worker.onerror = (e) => reject(new Error(e.message || 'analysis failed'))
      worker.postMessage({ samples, duration: buffer.duration, difficulty: 'normal', seed: 1 }, [samples.buffer])
    })
  } finally {
    worker.terminate()
  }
}

/** an audience applauding: hundreds of synthesized hand claps */
export function applause(intensity: number, seconds = 5): void {
  const ctx = audioContext()
  const sr = ctx.sampleRate
  const buf = ctx.createBuffer(2, Math.ceil(seconds * sr), sr)
  const claps = Math.round(300 + 1500 * intensity)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < claps; i++) {
      // the crowd swells quickly, then slowly dies away
      const u = Math.random()
      const t = seconds * (u < 0.15 ? u * 2 : 0.3 + 0.7 * Math.pow((u - 0.15) / 0.85, 1.6))
      const start = Math.floor(t * sr)
      const len = Math.floor(sr * (0.012 + Math.random() * 0.02))
      const amp = (0.05 + Math.random() * 0.1) * (1 - (t / seconds) * 0.7)
      let lp = 0
      for (let k = 0; k < len && start + k < d.length; k++) {
        const n = Math.random() * 2 - 1
        lp += (n - lp) * 0.55 // soften the hiss a little
        d[start + k] += (n - lp) * amp * Math.exp(-k / (len * 0.3))
      }
    }
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.value = 0.5 + 0.5 * intensity
  src.connect(g).connect(ctx.destination)
  src.start()
}
