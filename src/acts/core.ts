import * as THREE from 'three'
import { type Act, type Frame, SNOISE, smooth } from '../shared'

const VERT = /* glsl */ `
${SNOISE}
uniform float uTime;
uniform vec3 uPoke;
varying vec3 vN;
varying vec3 vWN;
varying vec3 vWP;
varying float vD;

float disp(vec3 p){
  float n = snoise(p * 0.5 + uTime * 0.2) * 0.5 + snoise(p * 1.1 - uTime * 0.28) * 0.08;
  // the surface reaches for the pointer
  float m = pow(max(dot(normalize(p), uPoke), 0.0), 6.0);
  return n + m * 0.9;
}

void main(){
  vec3 n = normalize(position);
  vec3 tg = normalize(cross(n, vec3(0.0, 1.0, 0.0) + n.zxy * 0.01));
  vec3 bt = cross(n, tg);
  float e = 0.05;
  float d0 = disp(position);
  vec3 p0 = position + n * d0;
  vec3 a = position + tg * e; a += normalize(a) * disp(a);
  vec3 b = position + bt * e; b += normalize(b) * disp(b);
  vec3 nn = normalize(cross(a - p0, b - p0));
  if (dot(nn, n) < 0.0) nn = -nn;
  vN = normalize(normalMatrix * nn);
  vWN = normalize(mat3(modelMatrix) * nn);
  vWP = (modelMatrix * vec4(p0, 1.0)).xyz;
  vD = d0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p0, 1.0);
}`

const FRAG = /* glsl */ `
uniform sampler2D uChrome;
uniform sampler2D uHolo;
uniform sampler2D uEnv;
varying vec3 vN;
varying vec3 vWN;
varying vec3 vWP;
varying float vD;
void main(){
  vec3 n = normalize(vN);
  vec2 uv = n.xy * 0.47 + 0.5;
  vec3 chrome = texture2D(uChrome, uv).rgb;
  vec3 holo = texture2D(uHolo, uv).rgb;
  float fres = pow(1.0 - max(n.z, 0.0), 2.0);
  // liquid chrome in the valleys, oil-slick pearl on the crests
  // real chrome is a mirror: a neutral studio (bright sky, hard horizon, dark floor)
  // plus the nebula it is actually sitting in
  vec3 r = reflect(normalize(vWP - cameraPosition), normalize(vWN));
  vec3 sky = mix(vec3(0.5, 0.51, 0.53), vec3(0.01, 0.01, 0.013), smoothstep(0.0, 0.22, r.y));
  vec3 floorC = mix(vec3(0.05, 0.05, 0.055), vec3(0.0), smoothstep(0.0, -0.3, r.y));
  vec3 studio = mix(floorC, sky, smoothstep(-0.01, 0.01, r.y));
  // an overhead strip light, for the banding polished metal has
  studio += vec3(0.4, 0.41, 0.43) * smoothstep(0.6, 0.64, r.y) * smoothstep(0.82, 0.78, r.y);
  vec2 euv = vec2(atan(r.z, r.x) / 6.2831853 + 0.5, asin(clamp(r.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  // the surroundings are violet; keep their light but drain most of the hue so the metal stays neutral
  vec3 env = texture2D(uEnv, euv).rgb;
  env = mix(vec3(dot(env, vec3(0.2126, 0.7152, 0.0722))), env, 0.2);
  vec3 rimLight = mix(vec3(dot(chrome, vec3(0.2126, 0.7152, 0.0722))), chrome, 0.3);
  vec3 col = studio + env * 0.45 + rimLight * 0.22;
  // pearl only as a thin film on grazing angles
  col += holo * pow(fres, 4.0) * 0.12;
  col += vec3(1.0) * pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 90.0) * 0.9;
  col += vec3(0.1, 0.94, 1.0) * smoothstep(0.9, 1.6, vD) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}`

const DISK_VERT = /* glsl */ `
attribute vec4 aOrbit; // radius, phase, height, size
uniform float uTime, uScale;
varying float vA;
void main(){
  float a = aOrbit.y + uTime * 1.6 / aOrbit.x;
  vec3 p = vec3(cos(a) * aOrbit.x, aOrbit.z, sin(a) * aOrbit.x);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aOrbit.w * uScale / -mv.z;
  vA = smoothstep(11.0, 4.0, aOrbit.x);
}`

const DISK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(uColor * smoothstep(0.5, 0.0, d) * (0.25 + vA * 0.75), 1.0);
}`

export function createCore(chrome: THREE.Texture, holo: THREE.Texture, env: THREE.Texture, renderer: THREE.WebGLRenderer): Act {
  const group = new THREE.Group()
  const uniforms = {
    uTime: { value: 0 },
    uPoke: { value: new THREE.Vector3(0, 0, 1) },
    uChrome: { value: chrome },
    uHolo: { value: holo },
    uEnv: { value: env },
  }
  const blob = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.3, 56),
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms }),
  )
  group.add(blob)

  const rings = [
    { r: 4.2, c: 0x19f0ff, rot: [1.2, 0.2, 0] },
    { r: 4.9, c: 0x7b2cff, rot: [1.75, -0.5, 0.3] },
    { r: 5.7, c: 0xc6ff3d, rot: [1.0, 0.6, -0.2] },
  ].map(({ r, c, rot }) => {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.012, 6, 220),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }),
    )
    m.rotation.set(rot[0], rot[1], rot[2])
    group.add(m)
    return m
  })

  // accretion disk of sparks
  const COUNT = 7000
  const orbit = new Float32Array(COUNT * 4)
  for (let i = 0; i < COUNT; i++) {
    const r = 3.4 + Math.pow(Math.random(), 1.8) * 9
    orbit.set([r, Math.random() * 6.2831, (Math.random() - 0.5) * 0.12 * r, 0.5 + Math.random() * 1.6], i * 4)
  }
  const dg = new THREE.BufferGeometry()
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3))
  dg.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4))
  const dUniforms = { uTime: uniforms.uTime, uScale: { value: 1 }, uColor: { value: new THREE.Color(0x4fdcff) } }
  const disk = new THREE.Points(
    dg,
    new THREE.ShaderMaterial({
      vertexShader: DISK_VERT,
      fragmentShader: DISK_FRAG,
      uniforms: dUniforms,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  )
  disk.frustumCulled = false
  disk.rotation.set(0.35, 0, 0.18)
  group.add(disk)

  const ray = new THREE.Raycaster()
  const closest = new THREE.Vector3()
  const origin = new THREE.Vector3()

  return {
    group,
    update(f: Frame) {
      uniforms.uTime.value = f.time
      dUniforms.uScale.value = renderer.domElement.height * 0.022
      const e = smooth(f.t, 0, 0.75)
      const dist = (21 - e * 11.5) * Math.max(1, 0.95 / f.aspect)
      const ang = -0.9 + e * 0.9 + f.mouse.x * 0.35
      f.camera.position.set(Math.sin(ang) * dist, 1.2 + f.mouse.y * 1.6 + (1 - e) * 4, Math.cos(ang) * dist)
      // sit the core a little above centre so the call to action has room
      f.camera.lookAt(0, -0.9 * e, 0)

      blob.rotation.y = f.time * 0.12
      // slow gyroscope
      rings[0].rotation.x = 1.2 + Math.sin(f.time * 0.21) * 0.25
      rings[1].rotation.y = -0.5 + Math.sin(f.time * 0.17 + 1) * 0.35
      rings[2].rotation.x = 1.0 + Math.sin(f.time * 0.13 + 2) * 0.3

      ray.setFromCamera(f.mouse, f.camera)
      ray.ray.closestPointToPoint(origin, closest)
      uniforms.uPoke.value.lerp(blob.worldToLocal(closest).normalize(), 0.08).normalize()
    },
  }
}
