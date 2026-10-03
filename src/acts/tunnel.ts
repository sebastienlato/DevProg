import * as THREE from 'three'
import type { Act, Frame } from '../shared'

const TUBE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vDist;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

const TUBE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
varying vec2 vUv;
varying float vDist;
void main(){
  // traces run along the tube; two layers slide at different speeds
  vec2 a = vec2(vUv.y * 6.0, vUv.x * 44.0 - uTime * 0.35);
  vec2 b = vec2(vUv.y * 3.0 + 0.37, vUv.x * 19.0 - uTime * 0.9);
  vec3 col = texture2D(uMap, a).rgb * 1.2 + texture2D(uMap, b).rgb * 0.5;
  // light gates rushing past
  float gate = smoothstep(0.965, 1.0, fract(vUv.x * 70.0 - uTime * 0.25));
  col += gate * vec3(0.48, 0.17, 1.0) * 0.6;
  float fog = exp(-vDist * 0.02);
  col *= fog;
  // light at the end
  col += vec3(0.1, 0.94, 1.0) * smoothstep(60.0, 260.0, vDist) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`

const KEY_VERT = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aData; // quad index, spin speed, scale, phase
uniform float uTime;
varying vec2 vUv;
varying float vFade;
void main(){
  float ang = aData.w * 6.2831 + uTime * aData.y;
  float c = cos(ang), s = sin(ang);
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += mat2(c, -s, s, c) * position.xy * aData.z;
  gl_Position = projectionMatrix * mv;
  vec2 q = vec2(mod(aData.x, 2.0), 1.0 - floor(aData.x / 2.0));
  vUv = (uv + q) * 0.5;
  vFade = smoothstep(0.5, 4.0, -mv.z) * exp(mv.z * 0.02);
}`

const KEY_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vFade;
void main(){
  gl_FragColor = vec4(texture2D(uMap, vUv).rgb * vFade * 1.3, 1.0);
}`

export function createTunnel(circuit: THREE.Texture, sprites: THREE.Texture): Act {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < 14; i++) pts.push(new THREE.Vector3(Math.sin(i * 1.3) * 9, Math.cos(i * 0.9) * 6, -i * 40))
  const curve = new THREE.CatmullRomCurve3(pts)

  const uniforms = { uMap: { value: circuit }, uTime: { value: 0 } }
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 500, 7, 48),
    new THREE.ShaderMaterial({ vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG, uniforms, side: THREE.BackSide }),
  )
  tube.frustumCulled = false

  // keycaps tumbling through the bore
  const COUNT = 110
  const quad = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = quad.index
  geo.setAttribute('position', quad.getAttribute('position'))
  geo.setAttribute('uv', quad.getAttribute('uv'))
  const off = new Float32Array(COUNT * 3)
  const data = new Float32Array(COUNT * 4)
  const tmp = new THREE.Vector3()
  for (let i = 0; i < COUNT; i++) {
    curve.getPoint(0.03 + (i / COUNT) * 0.9, tmp)
    const a = Math.random() * Math.PI * 2
    const r = 1.8 + Math.random() * 3.6
    off.set([tmp.x + Math.cos(a) * r, tmp.y + Math.sin(a) * r, tmp.z], i * 3)
    data.set([i % 4, (Math.random() - 0.5) * 1.6, 1.4 + Math.random() * 2.2, Math.random()], i * 4)
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3))
  geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4))
  geo.instanceCount = COUNT
  const kUniforms = { uMap: { value: sprites }, uTime: uniforms.uTime }
  const keys = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: KEY_VERT,
      fragmentShader: KEY_FRAG,
      uniforms: kUniforms,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  )
  keys.frustumCulled = false

  const group = new THREE.Group()
  group.add(tube, keys)
  const look = new THREE.Vector3()

  return {
    group,
    update(f: Frame) {
      uniforms.uTime.value = f.time
      const u = 0.01 + f.t * 0.86
      curve.getPoint(u, f.camera.position)
      curve.getPoint(u + 0.035, look)
      f.camera.position.x += f.mouse.x * 1.5
      f.camera.position.y += f.mouse.y * 1.5
      f.camera.lookAt(look)
      f.camera.rotateZ(f.t * 2.4 + f.mouse.x * 0.3)
    },
  }
}
