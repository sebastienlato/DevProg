import * as THREE from 'three'
import { type Act, type Frame, ramp, smooth } from '../shared'

const N = 520_000
const W = 1536
const H = 1024

/** Turn an image into N particles: pixel → xy, brightness → z. Importance-sampled by luminance. */
function sample(img: HTMLImageElement) {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, W, H)
  const px = ctx.getImageData(0, 0, W, H).data

  const luma = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++)
    luma[i] = (px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722) / 255

  // depth comes from a low-pass of the brightness: whole regions move forward together,
  // so small shapes stay rigid instead of smearing along the view axis
  const CELL = 24
  const GW = Math.ceil(W / CELL) + 1
  const GH = Math.ceil(H / CELL) + 1
  const coarse = new Float32Array(GW * GH)
  const count = new Float32Array(GW * GH)
  for (let i = 0; i < W * H; i++) {
    const c = Math.round((i % W) / CELL) + Math.round(((i / W) | 0) / CELL) * GW
    coarse[c] += luma[i]
    count[c]++
  }
  for (let c = 0; c < coarse.length; c++) coarse[c] /= Math.max(1, count[c])
  const depthAt = (x: number, y: number) => {
    const gx = x / CELL
    const gy = y / CELL
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = gx - x0
    const fy = gy - y0
    const a = coarse[x0 + y0 * GW] * (1 - fx) + coarse[x0 + 1 + y0 * GW] * fx
    const b = coarse[x0 + (y0 + 1) * GW] * (1 - fx) + coarse[x0 + 1 + (y0 + 1) * GW] * fx
    return a * (1 - fy) + b * fy
  }

  const cdf = new Float32Array(W * H)
  let sum = 0
  for (let i = 0; i < W * H; i++) {
    const l = luma[i]
    const x = i % W
    // favour edges so outlines and small shapes (keys, traces) stay crisp
    const edge =
      x > 1 && x < W - 2 && i > 2 * W && i < W * (H - 2)
        ? Math.abs(luma[i + 2] - luma[i - 2]) + Math.abs(luma[i + 2 * W] - luma[i - 2 * W])
        : 0
    // cap the weight so large flat bright areas don't swallow the fine line work
    sum += l < 0.06 ? 0 : Math.min(l, 0.45) * (1 + Math.min(edge, 0.5) * 2.5) + Math.max(0, l - 0.75) * 6
    cdf[i] = sum
  }

  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  for (let n = 0; n < N; n++) {
    const r = Math.random() * sum
    let lo = 0
    let hi = W * H - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid] < r) lo = mid + 1
      else hi = mid
    }
    const x = lo % W
    let y = (lo / W) | 0
    // large flat bright areas (a lit screen, a keycap) would turn into static;
    // comb them into scanlines instead so they read as a glowing raster
    const flat =
      luma[lo] > 0.3 &&
      x > 23 && x < W - 24 && y > 23 && y < H - 24 &&
      // only areas that stay flat over a wide span, so small keys keep their shape
      Math.abs(luma[lo + 24] - luma[lo - 24]) < 0.1 &&
      Math.abs(luma[lo + 8] - luma[lo - 8]) < 0.1 &&
      Math.abs(luma[lo + 24 * W] - luma[lo - 24 * W]) < 0.2
    if (flat) y = Math.round(y / 9) * 9
    const R = px[lo * 4] / 255
    const G = px[lo * 4 + 1] / 255
    const B = px[lo * 4 + 2] / 255
    const l = R * 0.2126 + G * 0.7152 + B * 0.0722
    pos[n * 3] = ((x + Math.random()) / W - 0.5) * 15
    pos[n * 3 + 1] = (0.5 - (y + (flat ? 0.5 : Math.random())) / H) * 10
    // white-hot solids (the cursor block, a lit screen) sit on one flat plane; with blurred
    // depth their centre bulges forward and perspective smears the shape
    const solid = Math.min(1, Math.max(0, (l - 0.6) / 0.2))
    const depth = depthAt(x, y) * (1 - solid) + 0.75 * solid
    pos[n * 3 + 2] = (depth - 0.2) * 2.6 + (l - 0.35) * 0.35 + (flat ? 0 : (Math.random() - 0.5) * 0.06)
    col[n * 3] = Math.pow(R, 2.2)
    col[n * 3 + 1] = Math.pow(G, 2.2)
    col[n * 3 + 2] = Math.pow(B, 2.2)
  }
  return { pos, col }
}

const VERT = /* glsl */ `
attribute vec3 p1; attribute vec3 p2; attribute vec3 p3;
attribute vec3 c0; attribute vec3 c1; attribute vec3 c2; attribute vec3 c3;
attribute vec4 aRnd;
uniform float uMorph, uTime, uAssemble, uExplode, uSize;
uniform vec3 uMouse;
varying vec3 vCol;
varying float vFade;

void main(){
  float seg = floor(min(uMorph, 2.999));
  float f = uMorph - seg;
  // every particle leaves on its own schedule
  float k = clamp(f * 1.7 - aRnd.x * 0.7, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);

  vec3 a = position, b = p1, ca = c0, cb = c1;
  if (seg > 1.5) { a = p2; b = p3; ca = c2; cb = c3; }
  else if (seg > 0.5) { a = p1; b = p2; ca = c1; cb = c2; }

  vec3 pos = mix(a, b, k);
  vCol = mix(ca, cb, k);

  // turbulence while in flight
  float turb = sin(k * 3.14159);
  float ph = aRnd.y * 6.2831;
  vec3 flow = vec3(
    sin(pos.y * 0.9 + uTime * 0.7 + ph),
    cos(pos.x * 0.8 - uTime * 0.6 + ph * 1.3),
    sin(pos.x * 0.6 + pos.y * 0.7 + ph * 0.7)
  );
  pos += flow * turb * (0.5 + aRnd.z * 1.6);
  float ang = turb * (aRnd.w - 0.5) * 2.4;
  float cs = cos(ang), sn = sin(ang);
  pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;

  // idle shimmer
  pos += 0.02 * vec3(sin(uTime * 1.3 + ph), cos(uTime * 1.1 + ph * 2.0), sin(uTime * 0.9 + ph * 3.0));

  // pointer pushes the light away
  vec2 d = pos.xy - uMouse.xy;
  float m = exp(-dot(d, d) * 1.6) * uMouse.z;
  pos.xy += normalize(d + 1e-4) * m * 0.4;
  pos.z += m * 1.2;

  // boot: fall in from a wide shell
  vec3 dir = normalize(aRnd.xyz - 0.5 + 1e-3);
  float as = clamp(uAssemble * 1.6 - aRnd.w * 0.6, 0.0, 1.0);
  as = 1.0 - pow(1.0 - as, 4.0);
  pos = mix(dir * (18.0 + aRnd.w * 30.0), pos, as);

  // dive: the sculpture bursts open as the camera passes through
  pos.xy *= 1.0 + uExplode * uExplode * (1.5 + aRnd.z * 5.0);
  pos.z += uExplode * (aRnd.w - 0.3) * 10.0;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.55 + aRnd.z * 0.9) * (1.0 + turb * 0.4) / max(-mv.z, 0.5);
  vFade = smoothstep(0.3, 2.0, -mv.z) * (0.35 + 0.65 * as);
}`

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vFade;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(vCol * a * vFade * 0.4, 1.0);
}`

export function createGenesis(imgs: HTMLImageElement[], renderer: THREE.WebGLRenderer): Act & { assemble: number; turb: number } {
  const [hand, machine, chip, mind] = imgs.map(sample)
  // story order: idea → machine → mind → silicon
  const order = [hand, machine, mind, chip]

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(order[0].pos, 3))
  for (let i = 1; i < 4; i++) geo.setAttribute(`p${i}`, new THREE.BufferAttribute(order[i].pos, 3))
  for (let i = 0; i < 4; i++) geo.setAttribute(`c${i}`, new THREE.BufferAttribute(order[i].col, 3))
  const rnd = new Float32Array(N * 4)
  for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random()
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4))

  const uniforms = {
    uMorph: { value: 0 },
    uTime: { value: 0 },
    uAssemble: { value: 0 },
    uExplode: { value: 0 },
    uSize: { value: 30 },
    uMouse: { value: new THREE.Vector3(99, 99, 0) },
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false

  const group = new THREE.Group()
  group.add(points)

  const ray = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  const hit = new THREE.Vector3()

  const act = {
    group,
    assemble: 0,
    /** 0..1, how much of the sculpture is mid-flight; drives the sound */
    turb: 0,
    update(f: Frame) {
      const { p, camera, mouse } = f
      uniforms.uTime.value = f.time
      uniforms.uAssemble.value = act.assemble
      uniforms.uMorph.value = ramp(p, 0.02, 0.09) + ramp(p, 0.17, 0.22) + ramp(p, 0.27, 0.32)
      const m = uniforms.uMorph.value
      act.turb = Math.sin(Math.PI * (m - Math.floor(Math.min(m, 2.999)))) * (m < 3 ? 1 : 0)
      const dive = smooth(p, 0.35, 0.39)
      uniforms.uExplode.value = dive
      uniforms.uSize.value = 0.0095 * renderer.domElement.height

      // keep the whole sculpture in frame on narrow screens
      const dist = 11.5 * Math.max(1, 0.8 / f.aspect)
      camera.position.set(mouse.x * 1.6, mouse.y * 1.0, dist - dive * (dist + 3))
      camera.lookAt(0, 0, -dive * 20)
      group.rotation.y = mouse.x * 0.28
      group.rotation.x = -mouse.y * 0.18

      ray.setFromCamera(mouse, camera)
      if (ray.ray.intersectPlane(plane, hit)) {
        group.worldToLocal(hit)
        // z carries the strength: nothing until the pointer has actually moved
        uniforms.uMouse.value.set(hit.x, hit.y, mouse.lengthSq() > 1e-6 ? 1 : 0)
      }
    },
  }
  return act
}
