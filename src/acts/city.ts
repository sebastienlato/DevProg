import * as THREE from 'three'
import { type Act, type Frame, smooth } from '../shared'

const SIZE = 220
const MAX_H = 9
// the bright "core district" of the die, in world space
const CORE = new THREE.Vector3(16.5, 0, -19.8)

const VERT = /* glsl */ `
uniform sampler2D uMap;
uniform float uTexel;
varying vec3 vWorld;
varying vec2 vUv;
void main(){
  // snap to texel centres so blocks get hard vertical walls
  vec2 suv = (floor(uv * uTexel) + 0.5) / uTexel;
  vec3 c = texture2D(uMap, suv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 pos = position;
  pos.z = pow(l, 0.6) * ${MAX_H.toFixed(1)};
  vec4 w = modelMatrix * vec4(pos, 1.0);
  vWorld = w.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform vec3 uCore;
varying vec3 vWorld;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float top = smoothstep(0.5, 0.9, abs(n.y));
  vec3 base = texture2D(uMap, vUv).rgb;
  float h = vWorld.y / ${MAX_H.toFixed(1)};

  // rooftops: dim plates, bright where they are tall
  vec2 gl = abs(fract(vWorld.xz * 0.8) - 0.5);
  float grid = smoothstep(0.44, 0.5, max(gl.x, gl.y));
  vec3 roof = base * (0.05 + 0.22 * h * h + grid * 0.35 * h);

  // walls: rows of lit windows that flicker
  vec2 cell = vec2(floor((vWorld.x + vWorld.z) * 2.2), floor(vWorld.y * 2.6));
  float lit = step(0.45, hash(cell)) * (0.6 + 0.4 * sin(uTime * (1.0 + hash(cell + 7.0) * 3.0) + hash(cell) * 40.0));
  float win = step(0.35, fract(vWorld.y * 2.6)) * step(0.3, fract((vWorld.x + vWorld.z) * 2.2));
  vec3 wall = mix(vec3(0.05, 0.0, 0.16), vec3(0.1, 0.94, 1.0), h) * (0.12 + win * lit * 0.9);

  vec3 col = mix(wall, roof, top);

  // streets: pulses of data running along the grid
  float street = 1.0 - smoothstep(0.0, 0.35, vWorld.y);
  float lane = smoothstep(0.92, 1.0, sin(vWorld.x * 0.9 + uTime * 6.0)) + smoothstep(0.92, 1.0, sin(vWorld.z * 0.9 - uTime * 5.0));
  col += street * lane * vec3(0.3, 0.9, 0.2) * 0.35;

  // a scan wave radiating out of the core district
  float r = distance(vWorld.xz, uCore.xz);
  float wave = smoothstep(3.0, 0.0, abs(r - mod(uTime * 22.0, 190.0)));
  col += wave * top * base * 0.9;

  // fog to black
  float dist = distance(vWorld, cameraPosition);
  col *= exp(-dist * 0.011);
  col += vec3(0.02, 0.0, 0.07) * (1.0 - exp(-dist * 0.006));
  gl_FragColor = vec4(col, 1.0);
}`

export function createCity(map: THREE.Texture): Act {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, 640, 640)
  const uniforms = {
    uMap: { value: map },
    uTexel: { value: (map.image as HTMLImageElement).width },
    uTime: { value: 0 },
    uCore: { value: CORE },
  }
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: THREE.DoubleSide }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.frustumCulled = false
  const group = new THREE.Group()
  group.add(mesh)

  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const path = new THREE.CatmullRomCurve3(
    [
      v(-20, 95, 120),
      v(-62, 30, 78),
      v(-52, 14, 30),
      v(-18, 12.5, 6),
      v(18, 13, 14),
      v(44, 14, -8),
      v(30, 20, -30),
      v(CORE.x, 24, CORE.z + 6),
      v(CORE.x, 10.5, CORE.z + 1),
    ],
    false,
    'centripetal',
  )
  const ahead = new THREE.Vector3()
  const target = new THREE.Vector3()

  return {
    group,
    update(f: Frame) {
      uniforms.uTime.value = f.time
      const t = smooth(f.t, 0, 1) * 0.5 + f.t * 0.5
      path.getPointAt(t, f.camera.position)
      path.getPointAt(Math.min(1, t + 0.07), ahead)
      ahead.y -= 5
      // towards the end, tip over and stare down into the core
      target.copy(ahead).lerp(CORE, smooth(t, 0.78, 0.94))
      target.x += f.mouse.x * 4
      target.y += f.mouse.y * 2
      f.camera.lookAt(target)
      f.camera.rotateZ(Math.sin(t * 9) * 0.08 * (1 - smooth(t, 0.7, 0.9)))
    },
  }
}
