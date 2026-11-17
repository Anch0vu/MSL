import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

function motionDisabled() {
  return typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}


const SCRAMBLE_CHARS = 'MSL0123456789#@'

export function ScrambleText({ text }: { text: string }) {
  const frame = useRef(0)
  const [shown, setShown] = useState(() => (motionDisabled() ? text : ''))

  useEffect(() => {
    if (motionDisabled()) {
      setShown(text)
      return
    }
    const started = performance.now()
    const duration = 520
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration)
      const revealed = Math.floor(progress * text.length)
      setShown(
        [...text]
          .map((char, index) => {
            if (char === ' ' || index < revealed) return char
            return SCRAMBLE_CHARS[(index + Math.floor(now / 34)) % SCRAMBLE_CHARS.length]
          })
          .join(''),
      )
      if (progress < 1) frame.current = requestAnimationFrame(tick)
      else setShown(text)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [text])

  return (
    <span className="motion-scramble" aria-label={text}>
      <span aria-hidden>{shown || text}</span>
    </span>
  )
}

export function MotionReveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => motionDisabled() || typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (visible || !ref.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [visible])

  return (
    <div
      ref={ref}
      className={`motion-reveal${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--motion-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  )
}

export function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLElement>(null)
  const frame = useRef(0)
  const [shown, setShown] = useState(() => (motionDisabled() ? value : 0))

  useEffect(() => {
    if (motionDisabled() || typeof IntersectionObserver === 'undefined') {
      setShown(value)
      return
    }

    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        const started = performance.now()
        const duration = 700
        const tick = (now: number) => {
          const progress = Math.min(1, (now - started) / duration)
          const eased = 1 - Math.pow(1 - progress, 3)
          setShown(Math.round(value * eased))
          if (progress < 1) frame.current = requestAnimationFrame(tick)
        }
        frame.current = requestAnimationFrame(tick)
      },
      { threshold: 0.45 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
    }
  }, [value])

  return <b ref={ref}><span aria-hidden>{shown}</span><span className="sr-only">{value}</span></b>
}

export function HeroMotion({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
    return () => cancelAnimationFrame(frame.current)
  }, [])

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (motionDisabled() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      node.style.setProperty('--hero-art-x', `${(x * -15).toFixed(2)}px`)
      node.style.setProperty('--hero-art-y', `${(y * -10).toFixed(2)}px`)
      node.style.setProperty('--hero-img-x', `${(x * 22).toFixed(2)}px`)
      node.style.setProperty('--hero-img-y', `${(y * 15).toFixed(2)}px`)
      node.style.setProperty('--hero-grid-x', `${(x * 8).toFixed(2)}px`)
      node.style.setProperty('--hero-grid-y', `${(y * 8).toFixed(2)}px`)
    })
  }

  const reset = () => {
    const node = ref.current
    if (!node) return
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      for (const name of ['--hero-art-x', '--hero-art-y', '--hero-img-x', '--hero-img-y', '--hero-grid-x', '--hero-grid-y']) {
        node.style.setProperty(name, '0px')
      }
    })
  }

  return (
    <div
      ref={ref}
      className={`hero-motion${ready ? ' is-ready' : ''}${className ? ` ${className}` : ''}`}
      onPointerMove={move}
      onPointerLeave={reset}
    >
      {children}
    </div>
  )
}

export function MotionRouteFrame({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  return (
    <div className="motion-route-frame" key={routeKey}>
      {children}
    </div>
  )
}
