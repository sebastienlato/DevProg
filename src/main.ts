import * as THREE from 'three'
import { ACTS, type Act, type Frame, clamp01, loadImage, loadTexture } from './shared'
import { createPost } from './post'
import { createBoot, createHud } from './hud'
import { createAudio } from './audio'
import { createGenesis } from './acts/genesis'
import { createCity } from './acts/city'
import { createTunnel } from './acts/tunnel'
import { createCards } from './acts/cards'
import { createCore } from './acts/core'

import handUrl from '../assets/morph-01-hand.png'
import machineUrl from '../assets/morph-02-machine.png'
import chipUrl from '../assets/morph-03-chip.png'
import mindUrl from '../assets/morph-04-mind.png'
import cityUrl from '../assets/chip-city.png'
import circuitUrl from '../assets/tunnel-circuit.png'
import keycapsUrl from '../assets/sprites-keycaps.png'
import card1Url from '../assets/card-01-write.png'
import card2Url from '../assets/card-02-compile.png'
import card3Url from '../assets/card-03-ship.png'
import card4Url from '../assets/card-04-scale.png'
import chromeUrl from '../assets/matcap-chrome.png'
import holoUrl from '../assets/matcap-holo.png'
import nebulaUrl from '../assets/env-nebula.png'

// how visible the nebula backdrop is in each act
const BACKDROP = [0.16, 0.2, 0, 0.4, 0.8]
// how hard the bloom hits in each act
const BLOOM = [0.34, 0.7, 0.9, 0.55, 0.6]

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#gl')!
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200)
  const post = createPost(renderer, scene, camera)

  const boot = createBoot()
  let loaded = 0
  const TOTAL = 14
  const track = <T,>(label: string, pr: Promise<T>) =>
    pr.then((v) => {
      boot.line(label, ++loaded / TOTAL)
      return v
    })

  const [imgs, cityTex, circuit, keycaps, cardTex, chrome, holo, nebula] = await Promise.all([
    Promise.all([
      track('mount /dev/hand', loadImage(handUrl)),
      track('mount /dev/machine', loadImage(machineUrl)),
      track('mount /dev/silicon', loadImage(chipUrl)),
      track('mount /dev/mind', loadImage(mindUrl)),
    ]),
    track('map silicon city', loadTexture(cityUrl)),
    track('route bus traces', loadTexture(circuitUrl, true)),
    track('cast keycaps', loadTexture(keycapsUrl)),
    Promise.all([
      track('load artifact: write', loadTexture(card1Url)),
      track('load artifact: compile', loadTexture(card2Url)),
      track('load artifact: ship', loadTexture(card3Url)),
      track('load artifact: scale', loadTexture(card4Url)),
    ]),
    track('polish chrome', loadTexture(chromeUrl)),
    track('pour holographic pearl', loadTexture(holoUrl)),
    track('ignite nebula', loadTexture(nebulaUrl)),
  ])
  // heights are read per texel; filtering would round the walls off
  cityTex.generateMipmaps = false
  cityTex.minFilter = cityTex.magFilter = THREE.NearestFilter

  const genesis = createGenesis(imgs, renderer)
  const acts: Act[] = [
    genesis,
    createCity(cityTex),
    createTunnel(circuit, keycaps),
    createCards(cardTex, holo),
    createCore(chrome, holo, nebula, renderer),
  ]
  acts.forEach((a) => scene.add(a.group))

  const backdropMat = new THREE.MeshBasicMaterial({
    map: nebula,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  })
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), backdropMat)
  backdrop.renderOrder = -1
  scene.add(backdrop)

  // ---- input ----
  const track$ = document.querySelector<HTMLElement>('#track')!
  const maxScroll = () => track$.offsetHeight - innerHeight
  const jump = (p: number) => scrollTo({ top: p * maxScroll(), behavior: 'smooth' })
  const audio = createAudio()
  const hud = createHud(jump, audio)

  const pointer = new THREE.Vector2()
  const mouse = new THREE.Vector2()
  addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  })

  let aspect = 1
  const resize = () => {
    const pr = Math.min(devicePixelRatio, 1.6)
    aspect = innerWidth / innerHeight
    renderer.setPixelRatio(pr)
    renderer.setSize(innerWidth, innerHeight, false)
    camera.aspect = aspect
    // widen the lens on tall screens so scenes keep their framing
    camera.fov = aspect < 1 ? 62 : 50
    camera.updateProjectionMatrix()
    post.resize(innerWidth, innerHeight, pr)
  }
  addEventListener('resize', resize)
  resize()

  // ?p=0.5 pins the scroll position, handy for looking at one moment
  const pinned = new URLSearchParams(location.search).get('p')
  if (pinned !== null) scrollTo(0, Number(pinned) * maxScroll())
  let p = pinned !== null ? Number(pinned) : scrollY / maxScroll()
  if (pinned !== null || p > 0.01) genesis.assemble = 1

  if (await boot.done(pinned !== null)) {
    audio.setOn(true)
    hud.syncSound()
  }
  const clock = new THREE.Clock()
  let time = 0

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05)
    time += dt
    const target = clamp01(scrollY / maxScroll())
    const prev = p
    p += (target - p) * (1 - Math.exp(-dt * 4.5))
    const speed = Math.abs(p - prev) / Math.max(dt, 1e-3)
    mouse.lerp(pointer, 1 - Math.exp(-dt * 5))
    genesis.assemble = Math.min(1, genesis.assemble + dt / 3.2)

    const idx = Math.max(0, ACTS.findIndex((a) => p >= a.a && p < a.b))
    const act = ACTS[idx]
    acts.forEach((a, i) => (a.group.visible = i === idx))

    const frame: Frame = { p, t: clamp01((p - act.a) / (Math.min(act.b, 1) - act.a)), time, dt, camera, mouse, aspect }
    camera.up.set(0, 1, 0)
    acts[idx].update(frame)

    backdrop.position.copy(camera.position)
    backdropMat.opacity = BACKDROP[idx]
    backdrop.visible = BACKDROP[idx] > 0

    // a flash hides the cut between acts
    let flash = 0
    for (let i = 1; i < ACTS.length; i++) flash = Math.max(flash, 1 - Math.abs(p - ACTS[i].a) / 0.014)
    post.lens.uFlash.value = Math.max(0, flash)
    post.lens.uAberr.value = Math.min(0.03, speed * 0.06)
    post.lens.uTime.value = time
    post.bloom.strength = BLOOM[idx]

    post.render()
    hud.update(p, idx)
    audio.update({ act: idx, speed, turb: idx === 0 ? Math.max(genesis.turb, 1 - genesis.assemble) : 0, dt })
  })
}

start()
