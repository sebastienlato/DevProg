// The whole soundtrack is synthesised with the Web Audio API — no audio files.
// A pad that changes chord per act, wind tied to scroll speed, a whoosh and sub drop on
// every act change, sparkles while the particles are in flight, and small UI ticks.

// one chord per act (Hz), low to high
const CHORDS = [
  [73.42, 110.0, 146.83, 220.0], // genesis — open D
  [65.41, 98.0, 155.56, 196.0], // silicon city — C minor
  [55.0, 82.41, 110.0, 164.81], // the bus — low A, hollow
  [87.31, 130.81, 220.0, 261.63], // artifacts — F major, airy
  [73.42, 110.0, 185.0, 293.66], // the core — D major, resolved
]
// how far the pad's filter opens in each act
const CUTOFF = [850, 650, 480, 1300, 1700]
// constant wind level per act, before scroll speed is added (the tunnel always rushes)
const WIND = [0, 0.012, 0.07, 0, 0.01]
// bell notes, as multiples of the act's root
// overall loudness, and how much low end sits under the pad
const VOLUME = 1.2
const BASS = 0.13

const SCALE = [4, 4.5, 5, 6, 6.75, 8, 9, 10, 12]

export interface AudioState {
  act: number
  /** scroll speed in page-progress units per second */
  speed: number
  /** 0..1, how much the particle sculpture is in flight */
  turb: number
  dt: number
}

export function createAudio() {
  let ctx: AudioContext | null = null
  let master: GainNode
  let wet: GainNode
  let padFilter: BiquadFilterNode
  let windGain: GainNode
  let windFilter: BiquadFilterNode
  let noise: AudioBuffer
  let voices: OscillatorNode[][] = []
  let subs: OscillatorNode[] = []
  let on = false
  let act = -1
  let sparkle = 0

  function build() {
    ctx = new AudioContext()
    const c = ctx

    master = c.createGain()
    master.gain.value = 0
    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    // lift everything below ~140 Hz before the compressor catches the peaks
    const shelf = c.createBiquadFilter()
    shelf.type = 'lowshelf'
    shelf.frequency.value = 140
    shelf.gain.value = 4
    // the compressor adds its own make-up gain; trim after it so peaks stay under full scale
    const trim = c.createGain()
    trim.gain.value = 0.62
    master.connect(shelf).connect(comp).connect(trim).connect(c.destination)

    // reverb from a generated impulse: decaying stereo noise
    const len = c.sampleRate * 3.5
    const impulse = c.createBuffer(2, len, c.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
    }
    const reverb = c.createConvolver()
    reverb.buffer = impulse
    wet = c.createGain()
    wet.gain.value = 0.55
    wet.connect(reverb).connect(master)

    noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const nd = noise.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

    // pad: four voices, each a pair of slightly detuned saws, through one slow-breathing filter
    padFilter = c.createBiquadFilter()
    padFilter.type = 'lowpass'
    padFilter.frequency.value = CUTOFF[0]
    padFilter.Q.value = 0.8
    const padGain = c.createGain()
    padGain.gain.value = 0.5
    padFilter.connect(padGain)
    padGain.connect(master)
    padGain.connect(wet)
    const lfo = c.createOscillator()
    lfo.frequency.value = 0.07
    const lfoAmt = c.createGain()
    lfoAmt.gain.value = 180
    lfo.connect(lfoAmt).connect(padFilter.frequency)
    lfo.start()

    voices = CHORDS[0].map((f, i) => {
      const g = c.createGain()
      g.gain.value = i === 0 ? 0.16 : 0.05
      g.connect(padFilter)
      return [-6, 7].map((detune) => {
        const o = c.createOscillator()
        o.type = i === 0 ? 'triangle' : 'sawtooth'
        o.frequency.value = f
        o.detune.value = detune + i * 2
        o.connect(g)
        o.start()
        return o
      })
    })

    // bass: pure sines under the pad, unfiltered and dry so they stay tight.
    // one at the root (audible on small speakers) and one an octave down (felt on big ones)
    subs = [1, 0.5].map((mult, i) => {
      const o = c.createOscillator()
      o.frequency.value = CHORDS[0][0] * mult
      const g = c.createGain()
      g.gain.value = BASS * (i === 0 ? 0.6 : 1)
      o.connect(g).connect(master)
      o.start()
      return o
    })

    // wind: looped noise through a band-pass that scroll speed opens up
    const src = c.createBufferSource()
    src.buffer = noise
    src.loop = true
    windFilter = c.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 400
    windFilter.Q.value = 0.7
    windGain = c.createGain()
    windGain.gain.value = 0
    src.connect(windFilter).connect(windGain)
    windGain.connect(master)
    windGain.connect(wet)
    src.start()
  }

  /** a soft bell */
  function ping(freq: number, vol: number, decay = 1.4) {
    if (!ctx || !on) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.6 - 0.8
    o.connect(g).connect(pan)
    pan.connect(master)
    pan.connect(wet)
    o.start(t)
    o.stop(t + decay + 0.05)
  }

  /** act change: a filtered noise sweep and a sub drop */
  function whoosh() {
    if (!ctx || !on) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noise
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.4
    f.frequency.setValueAtTime(180, t)
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.5)
    f.frequency.exponentialRampToValueAtTime(260, t + 1.6)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.45)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7)
    src.connect(f).connect(g)
    g.connect(master)
    g.connect(wet)
    src.start(t)
    src.stop(t + 1.8)

    const sub = ctx.createOscillator()
    sub.frequency.setValueAtTime(140, t + 0.35)
    sub.frequency.exponentialRampToValueAtTime(34, t + 1.4)
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0.0001, t + 0.35)
    sg.gain.exponentialRampToValueAtTime(0.8, t + 0.42)
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    sub.connect(sg).connect(master)
    sub.start(t + 0.35)
    sub.stop(t + 1.6)
  }

  function setOn(v: boolean) {
    on = v
    if (v && !ctx) build()
    if (!ctx) return
    if (v) ctx.resume()
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(v ? VOLUME : 0, ctx.currentTime, v ? 0.8 : 0.15)
  }

  // don't keep playing in a background tab
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return
    if (document.hidden) ctx.suspend()
    else ctx.resume()
  })

  return {
    get on() {
      return on
    },
    setOn,
    hover: () => ping(2100, 0.025, 0.12),
    click: () => {
      ping(880, 0.07, 0.35)
      ping(1320, 0.05, 0.5)
    },
    success: () => [587.33, 880, 1174.66].forEach((f, i) => setTimeout(() => ping(f, 0.08, 1.6), i * 90)),

    update(s: AudioState) {
      if (!ctx || !on) return
      const t = ctx.currentTime

      if (s.act !== act) {
        if (act !== -1) whoosh()
        act = s.act
        // glide to the new chord
        voices.forEach((pair, i) => pair.forEach((o) => o.frequency.setTargetAtTime(CHORDS[act][i], t, 0.9)))
        subs.forEach((o, i) => o.frequency.setTargetAtTime(CHORDS[act][0] * (i === 0 ? 1 : 0.5), t, 0.9))
      }

      // scrolling opens the pad and raises the wind
      const sp = Math.min(1, s.speed * 5)
      padFilter.frequency.setTargetAtTime(CUTOFF[act] * (1 + sp * 1.2), t, 0.25)
      windGain.gain.setTargetAtTime(WIND[act] + sp * 0.11, t, 0.12)
      windFilter.frequency.setTargetAtTime(350 + sp * 1500, t, 0.15)

      // bells: a few at rest, a shower while the particles fly
      sparkle += s.dt * (0.22 + s.turb * 9 + sp * 1.5)
      if (sparkle > 1) {
        sparkle = Math.random() * 0.5
        const mult = SCALE[(Math.random() * SCALE.length) | 0]
        ping(CHORDS[act][0] * mult * (Math.random() < 0.3 ? 2 : 1), 0.018 + Math.random() * 0.03)
      }
    },
  }
}
