import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uAberr: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uFlash, uAberr;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      // act change: the frame tears into slices and gets sucked through the lens
      float slice = hash(vec2(floor(uv.y * 36.0), floor(uTime * 24.0))) - 0.5;
      uv.x += slice * uFlash * uFlash * 0.12;
      vec2 c = uv - 0.5;
      float d = length(c);
      uv = 0.5 + c * (1.0 - uFlash * 0.45 * d);
      float ab = (0.004 + uAberr + uFlash * 0.05) * d;
      vec3 col = vec3(
        texture2D(tDiffuse, uv + c * ab).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - c * ab).b
      );
      col += pow(uFlash, 3.0) * vec3(0.55, 0.9, 1.0) * 1.4;
      col *= 1.0 - d * d * 0.85;
      col *= 0.965 + 0.035 * sin(vUv.y * uRes.y * 1.6);
      col += (hash(vUv * uRes + uTime) - 0.5) * 0.022;
      gl_FragColor = vec4(col, 1.0);
    }`,
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 0.25)
  composer.addPass(bloom)
  const lens = new ShaderPass(LensShader)
  composer.addPass(lens)
  composer.addPass(new OutputPass())

  return {
    bloom,
    lens: lens.uniforms,
    resize(w: number, h: number, pr: number) {
      composer.setPixelRatio(pr)
      composer.setSize(w, h)
      lens.uniforms.uRes.value.set(w * pr, h * pr)
    },
    render: () => composer.render(),
  }
}
