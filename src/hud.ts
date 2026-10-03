import { ACTS } from './shared'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const GLYPHS = '01<>/{}[]#$_=+*;:'

function scramble(el: HTMLElement) {
  const text = (el.dataset.text ??= el.textContent ?? '')
  const start = performance.now()
  const dur = 650
  const tick = (now: number) => {
    const k = (now - start) / dur
    let out = ''
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ' || i / text.length < k) out += text[i]
      else out += GLYPHS[(Math.random() * GLYPHS.length) | 0]
    }
    el.textContent = out
    if (k < 1) requestAnimationFrame(tick)
    else el.textContent = text
  }
  requestAnimationFrame(tick)
}

// boot screen pacing: time per log line, and the pause on the last line before it lifts
const LINE_MS = 170
const HOLD_MS = 500

/** terminal boot log shown while assets load */
export function createBoot() {
  const log = $('#boot-log')
  const bar = $<HTMLElement>('#boot-bar i')
  log.innerHTML = 'DEVPROG BIOS 1.0.0\n\n'
  // assets usually arrive at once; lines are queued and printed at a readable pace
  const queue: { label: string; frac: number }[] = []
  let drained = () => {}
  const timer = setInterval(() => {
    const next = queue.shift()
    if (!next) return drained()
    log.innerHTML += `> ${next.label.padEnd(34, '.')} <b>ok</b>\n`
    bar.style.width = `${next.frac * 100}%`
  }, LINE_MS)
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  return {
    line(label: string, frac: number) {
      queue.push({ label, frac })
    },
    /**
     * Shows every line, then waits for the visitor to enter. Browsers only allow audio
     * after a click or key press, so the entry buttons double as the sound opt-in.
     * Resolves true when they chose to enter with sound.
     */
    async done(skip = false) {
      let sound = false
      if (!skip) {
        if (queue.length) await new Promise<void>((r) => (drained = r))
        log.innerHTML += '\n> exec ./genesis'
        await wait(HOLD_MS)
        const gate = $('#boot-gate')
        gate.hidden = false
        $('#enter-sound').focus({ preventScroll: true })
        sound = await new Promise<boolean>((r) => {
          $('#enter-sound').addEventListener('click', () => r(true), { once: true })
          $('#enter-mute').addEventListener('click', () => r(false), { once: true })
        })
      }
      clearInterval(timer)
      $('#boot').classList.add('done')
      document.body.classList.add('live')
      return sound
    },
  }
}

interface Sfx {
  on: boolean
  setOn(v: boolean): void
  hover(): void
  click(): void
  success(): void
}

export function createHud(jump: (p: number) => void, sfx: Sfx) {
  const sections = [...document.querySelectorAll<HTMLElement>('.s')].map((el) => ({
    el,
    a: Number(el.dataset.a),
    b: Number(el.dataset.b),
    on: false,
  }))
  const act = $('#hud-act')
  const pct = $('#hud-pct')
  const cmd = $('#hud-cmd')
  const fps = $('#hud-fps')
  const rail = $('#rail')

  const ticks = ACTS.map((a, i) => {
    const b = document.createElement('button')
    b.textContent = a.name
    b.setAttribute('aria-label', `Jump to ${a.name}`)
    b.addEventListener('click', () => jump(i === 0 ? 0 : a.a + 0.03))
    b.addEventListener('click', sfx.click)
    rail.append(b)
    return b
  })

  let current = -1
  let typing = 0
  const type = (text: string) => {
    clearInterval(typing)
    let i = 0
    typing = window.setInterval(() => {
      cmd.textContent = text.slice(0, ++i)
      if (i >= text.length) clearInterval(typing)
    }, 38)
  }

  // custom cursor
  const cursor = $('#cursor')
  let cx = innerWidth / 2
  let cy = innerHeight / 2
  let tx = cx
  let ty = cy
  let hot = false
  addEventListener('pointermove', (e) => {
    tx = e.clientX
    ty = e.clientY
    const over = !!(e.target as HTMLElement).closest?.('button, a')
    if (over && !hot) sfx.hover()
    hot = over
    cursor.classList.toggle('hot', over)
  })

  // sound toggle
  const sound = $('#hud-sound')
  const soundLabel = sound.querySelector('span')!
  const syncSound = () => {
    sound.setAttribute('aria-pressed', String(sfx.on))
    soundLabel.textContent = sfx.on ? 'sound on' : 'sound off'
  }
  sound.addEventListener('click', () => {
    sfx.setOn(!sfx.on)
    syncSound()
    sfx.click()
  })

  // CTA copies the command
  const cta = $('#cta')
  const ctaText = $('#cta-text')
  cta.addEventListener('click', async () => {
    const text = 'npm create devprog@latest'
    try {
      await navigator.clipboard.writeText(text)
      ctaText.textContent = 'copied to clipboard'
      sfx.success()
    } catch {
      ctaText.textContent = 'press ⌘C to copy'
    }
    setTimeout(() => (ctaText.textContent = text), 1600)
  })

  let frames = 0
  let last = performance.now()

  return {
    syncSound,
    update(p: number, actIndex: number) {
      const F = 0.012
      for (const s of sections) {
        const o = Math.min(1, (p - s.a) / F, (s.b - p) / F)
        const vis = o > 0
        if (vis !== s.on) {
          s.on = vis
          s.el.style.visibility = vis ? 'visible' : 'hidden'
          if (vis) s.el.querySelectorAll<HTMLElement>('[data-scramble]').forEach(scramble)
        }
        if (vis) {
          s.el.style.opacity = String(o)
          // drift up on the way in, keep drifting on the way out
          const drift = p - s.a < F ? (1 - o) * 30 : -(1 - o) * 30
          s.el.style.transform = `translate3d(0, ${drift}px, 0)`
        }
      }

      if (actIndex !== current) {
        current = actIndex
        act.textContent = `ACT 0${actIndex + 1} — ${ACTS[actIndex].name}`
        ticks.forEach((t, i) => t.classList.toggle('on', i === actIndex))
        type(ACTS[actIndex].cmd)
      }
      pct.textContent = `${String(Math.round(p * 100)).padStart(3, '0')}%`

      cx += (tx - cx) * 0.22
      cy += (ty - cy) * 0.22
      cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`

      frames++
      const now = performance.now()
      if (now - last > 500) {
        fps.textContent = `${Math.round((frames * 1000) / (now - last))} fps`
        frames = 0
        last = now
      }
    },
  }
}
