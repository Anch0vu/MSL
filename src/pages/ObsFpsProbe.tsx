import { useEffect, useState } from 'react'

/** Frame pacing in this browser. OBS capture/encoding must be measured in OBS Stats. */
export function ObsFpsProbe() {
  const [sample, setSample] = useState({ fps: 0, slow: 0, worst: 0, seconds: 0 })
  useEffect(() => {
    let id = 0, start = 0, previous = 0, frames = 0, slow = 0, worst = 0, seconds = 0
    const reset = () => { start = 0; previous = 0; frames = 0 }
    const tick = (now: number) => {
      if (!document.hidden) {
        if (!start) { start = now; previous = now }
        else {
          const gap = now - previous
          previous = now
          if (gap > 25) slow++
          worst = Math.max(worst, gap)
          frames++
          if (now - start >= 1000) {
            const elapsed = (now - start) / 1000
            seconds += elapsed
            setSample({ fps: Math.round(frames / elapsed), slow, worst: Math.round(worst), seconds: Math.floor(seconds) })
            frames = 0
            start = now
          }
        }
      }
      id = requestAnimationFrame(tick)
    }
    document.addEventListener('visibilitychange', reset)
    id = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(id); document.removeEventListener('visibilitychange', reset) }
  }, [])
  return <output className="obs-perf" aria-label="OBS performance monitor">
    {sample.seconds ? <>RAF {sample.fps} FPS · кадры &gt;25 мс: {sample.slow} · максимум {sample.worst} мс · {sample.seconds} с</> : 'Измеряю FPS…'}
  </output>
}
