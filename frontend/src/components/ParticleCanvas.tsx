import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  hue: number // 0 = pink (brand-500), 1 = purple
}

const PARTICLE_COUNT = 90
const CONNECTION_DIST = 120
const MAX_LINE_OPACITY = 0.18
const MAX_PARTICLE_OPACITY = 0.55
const SPEED = 0.3

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a)
}

export default function ParticleCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let particles: Particle[] = []
    let animationId: number
    let width = 0
    let height = 0

    function resize() {
      if (!canvas) return
      width = canvas.offsetWidth
      height = canvas.offsetHeight
      canvas.width = width
      canvas.height = height
    }

    function initParticles() {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: randomBetween(0, width),
        y: randomBetween(0, height),
        vx: randomBetween(-SPEED, SPEED),
        vy: randomBetween(-SPEED, SPEED),
        size: randomBetween(1.5, 3),
        opacity: randomBetween(0.2, MAX_PARTICLE_OPACITY),
        hue: Math.random() > 0.5 ? 0 : 1,
      }))
    }

    function particleColor(p: Particle, alpha: number) {
      // hue 0 = brand pink #dd56ca = rgb(221,86,202)
      // hue 1 = purple = rgb(168,82,255)
      if (p.hue === 0) return `rgba(221,86,202,${alpha})`
      return `rgba(168,82,255,${alpha})`
    }

    function draw() {
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < CONNECTION_DIST) {
            const lineAlpha = MAX_LINE_OPACITY * (1 - dist / CONNECTION_DIST)
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `rgba(221,86,202,${lineAlpha})`
            ctx.lineWidth = 0.7
            ctx.stroke()
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = particleColor(p, p.opacity)
        ctx.fill()
      }
    }

    function update() {
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        // Bounce off edges
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx) }
        if (p.x > width) { p.x = width; p.vx = -Math.abs(p.vx) }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy) }
        if (p.y > height) { p.y = height; p.vy = -Math.abs(p.vy) }
      }
    }

    function loop() {
      update()
      draw()
      animationId = requestAnimationFrame(loop)
    }

    const observer = new ResizeObserver(() => {
      resize()
    })
    observer.observe(canvas)

    resize()
    initParticles()
    loop()

    return () => {
      cancelAnimationFrame(animationId)
      observer.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
