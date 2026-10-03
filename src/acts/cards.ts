import * as THREE from 'three'
import type { Act, Frame } from '../shared'

const SPACING = 18

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vView;
void main(){
  vUv = uv;
  // direction to the camera, in the slab's own space
  vView = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uHolo;
uniform float uTime;
uniform float uFocus;
varying vec2 vUv;
varying vec3 vView;
const float LAYERS = 20.0;

float sdBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main(){
  vec2 p = (vUv - 0.5) * vec2(6.0, 9.0);
  float d = sdBox(p, vec2(3.0, 4.5), 0.4);
  if (d > 0.0) discard;

  vec3 v = normalize(vView);
  vec2 par = v.xy / max(v.z, 0.35);

  // the picture is a stack of light sheets: each brightness band sits at its own depth,
  // so tilting the slab makes the image come apart into a hologram
  vec3 acc = vec3(0.0);
  for (float i = 0.0; i < LAYERS; i++) {
    float h = (i + 0.5) / LAYERS;
    // the art is zoomed so its subject fills the slab
    vec2 uv = (vUv - 0.5) / 1.4 + 0.5 + par * (h - 0.45) * vec2(0.2, 0.133);
    vec3 c = texture2D(uMap, uv).rgb;
    float l = sqrt(dot(c, vec3(0.2126, 0.7152, 0.0722)));
    float w = exp(-pow((l - h) * LAYERS * 0.6, 2.0));
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    acc += c * w * inside;
  }
  acc /= 2.95;
  // roll off the highlights so dense bright art keeps its detail
  float L = dot(acc, vec3(0.2126, 0.7152, 0.0722));
  acc *= (1.0 - exp(-L * 1.1)) / max(L, 1e-3) * 0.75;

  // iridescent rim, colours slide as the view angle changes
  float ang = atan(p.y, p.x) + v.x * 3.0 + v.y * 2.0 + uTime * 0.15;
  vec3 holo = texture2D(uHolo, 0.5 + 0.4 * vec2(cos(ang), sin(ang))).rgb;
  float rim = smoothstep(0.05, 0.0, abs(d + 0.05));
  float inner = smoothstep(0.9, 0.0, -d) * 0.12;

  // a sheen sweeping across the glass
  float sheen = pow(max(0.0, 1.0 - abs(p.x * 0.35 + p.y * 0.2 - v.x * 5.0)), 3.0) * 0.05;

  vec3 col = acc * (0.5 + 0.35 * uFocus) + holo * (rim * 0.9 + inner) + sheen;
  gl_FragColor = vec4(col, 0.62);
}`

export function createCards(maps: THREE.Texture[], holo: THREE.Texture): Act {
  const group = new THREE.Group()
  const geo = new THREE.PlaneGeometry(6, 9)
  const time = { value: 0 }

  const cards = maps.map((map, i) => {
    const uniforms = { uMap: { value: map }, uHolo: { value: holo }, uTime: time, uFocus: { value: 0 } }
    const mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        // premultiplied: light adds, the glass body dims what's behind it
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide,
      }),
    )
    mesh.position.x = i * SPACING
    group.add(mesh)
    return { mesh, uniforms }
  })

  // drifting dust for depth
  const DUST = 1800
  const dp = new Float32Array(DUST * 3)
  for (let i = 0; i < DUST; i++) {
    dp[i * 3] = -20 + Math.random() * (SPACING * 3 + 40)
    dp[i * 3 + 1] = (Math.random() - 0.5) * 30
    dp[i * 3 + 2] = -22 + Math.random() * 30
  }
  const dg = new THREE.BufferGeometry()
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
  const dust = new THREE.Points(
    dg,
    new THREE.PointsMaterial({
      color: 0x55ddff,
      size: 0.06,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  group.add(dust)

  return {
    group,
    update(f: Frame) {
      time.value = f.time
      const wide = f.aspect > 1.05
      // glide, dwell on a card, glide again
      const w = f.t * 4 - 0.5
      const j = Math.floor(w)
      const g = w - j
      const s = THREE.MathUtils.smoothstep(g, 0.22, 0.78)
      const c = j + s

      const side = wide ? Math.cos(c * Math.PI) * 3.6 : 0
      const dist = wide ? 12.5 : 12.5 * Math.max(1, 0.72 / f.aspect)
      f.camera.position.set(c * SPACING + side + f.mouse.x * 0.8, (wide ? 0 : -2.2) + f.mouse.y * 0.5, dist)
      f.camera.lookAt(c * SPACING + side, wide ? 0 : -2.2, 0)

      cards.forEach(({ mesh, uniforms }, i) => {
        const near = Math.max(0, 1 - Math.abs(c - i))
        uniforms.uFocus.value = near
        const face = wide ? (i % 2 === 0 ? 0.32 : -0.32) : 0
        mesh.rotation.y = face + f.mouse.x * 0.45 * near + (i - c) * 0.5
        mesh.rotation.x = -f.mouse.y * 0.3 * near + Math.sin(f.time * 0.6 + i) * 0.03
        mesh.position.y = Math.sin(f.time * 0.5 + i * 1.7) * 0.25
      })
      dust.rotation.y = Math.sin(f.time * 0.05) * 0.05
    },
  }
}
