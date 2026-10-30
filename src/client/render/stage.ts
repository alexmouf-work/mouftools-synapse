// The 3-D stage for the training view, ported from the look mock-up: renderer with ACES tone mapping and bloom,
// sky dome, fog, sun with shadows, the track ribbon, scenery and the ghost swarm, seen from the training camera
// (hovering high over the swarm and slowly circling). The detailed car, sensor rays and race cameras come in S4.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Track } from '../../common/sim/track';
import { GhostSwarm } from './ghosts';
import { assertFiniteArray } from './guard';
import { buildScenery, type Scenery } from './scenery';
import { makeTextures, type Textures } from './textures';
import { trackCentre, trackParts, type PartKey } from './trackMesh';

const FOG = new THREE.Color('#bcd4f2');
const SUN_DIR = new THREE.Vector3(0.62, 0.36, -0.42).normalize();

/** Software rasterisers (SwiftShader, llvmpipe) cannot keep up with full quality; neither can some old iGPUs. */
export type Quality = 'high' | 'low';
function softwareRenderer(r: THREE.WebGLRenderer): boolean {
  const gl = r.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|software/i.test(name);
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  /** low: pixel ratio 1, no shadows, no MSAA (bloom stays: it is where a NaN pixel would show). */
  readonly quality: Quality;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.3, 4000);
  readonly swarm = new GhostSwarm();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly sun = new THREE.DirectionalLight('#fff0dc', 2.6);
  private readonly tex: Textures;
  private readonly mats: Record<PartKey, THREE.Material>;
  private readonly world = new THREE.Group();
  private scenery: Scenery | null = null;
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private centre = new THREE.Vector3();
  private snap = true;
  private readonly reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly disposables: { dispose(): void }[] = [];

  /** Throws if WebGL is unavailable; the caller shows a message and keeps training. */
  constructor(private readonly canvas: HTMLCanvasElement, quality?: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.quality = quality ?? (softwareRenderer(this.renderer) ? 'low' : 'high');
    const high = this.quality === 'high';
    const PR = high ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.renderer.setPixelRatio(PR);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    this.scene.environment = env;
    this.disposables.push(pmrem, env);

    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.7, 0.45, 1.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.disposables.push(rt, this.bloom);

    this.scene.fog = new THREE.Fog(FOG, 600, 2300);
    const skyGeo = new THREE.SphereGeometry(1900, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#1847c4') }, mid: { value: new THREE.Color('#4f9cff') },
        horizon: { value: FOG.clone() }, sunCol: { value: new THREE.Color('#ffe6c2') }, sunDir: { value: SUN_DIR },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, mid, horizon, sunCol, sunDir; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.2, h));
          c = mix(c, top, smoothstep(0.18, 0.8, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 1400.0) * 9.0 + pow(s, 40.0) * 0.35 + pow(s, 4.0) * 0.12);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1; sky.frustumCulled = false;
    this.scene.add(sky);
    this.disposables.push(skyGeo, skyMat);
    this.scene.add(new THREE.HemisphereLight('#cfe2ff', '#3f6f45', 0.55));
    const sun = this.sun;
    sun.castShadow = high;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    const sc = sun.shadow.camera; sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 1; sc.far = 900; sc.updateProjectionMatrix();
    this.scene.add(sun, sun.target);

    this.tex = makeTextures(this.renderer.capabilities.getMaxAnisotropy());
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.45 });
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.9, 2.5), side: THREE.DoubleSide });
    this.mats = {
      road: new THREE.MeshStandardMaterial({ map: this.tex.road, roughness: 0.78, metalness: 0, side: THREE.DoubleSide }),
      kerb: vc, runoff: vc, wall: vc, wallTop: vc, skirt: vc, strip,
      pad: new THREE.MeshBasicMaterial({ map: this.tex.boost, color: new THREE.Color(1.7, 1.5, 1.4), transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      start: new THREE.MeshStandardMaterial({ map: this.tex.checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    this.scene.add(this.world, this.swarm.mesh);
    this.resize();
  }

  /** Build the track, scenery and an empty swarm for one training track. */
  setTrack(t: Track): void {
    this.clearWorld();
    for (const p of trackParts(t)) {
      const m = new THREE.Mesh(p.geometry, this.mats[p.key]);
      m.receiveShadow = p.key !== 'strip' && p.key !== 'pad';
      m.castShadow = p.key === 'wall' || p.key === 'skirt';
      this.world.add(m);
    }
    this.scenery = buildScenery(t, t.seed);
    this.world.add(this.scenery.group);
    this.centre = trackCentre(t);
    this.look.set(t.px[t.startIdx], 0, -t.py[t.startIdx]);
    this.snap = true;
  }

  private clearWorld(): void {
    for (const c of [...this.world.children]) {
      this.world.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    this.scenery?.dispose();
    this.scenery = null;
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Advance the swarm and camera by dt seconds and draw. */
  frame(dt: number, time: number): void {
    this.swarm.update(dt, time);
    // hover high over the swarm (between its leader and its middle), circling slowly
    const target = this.tmp.copy(this.swarm.mesh.count ? this.swarm.leader : this.look).lerp(this.swarm.mesh.count ? this.swarm.centre : this.look, 0.5).lerp(this.centre, 0.05);
    this.look.lerp(target, this.snap ? 1 : 1 - Math.exp(-dt * 3));
    this.snap = false;
    const a = (this.reduceMotion ? 0 : time * 0.05) + 0.6, R = 150;
    this.camera.position.set(this.look.x + Math.sin(a) * R, this.look.y + 175, this.look.z + Math.cos(a) * R);
    this.camera.lookAt(this.look);
    assertFiniteArray(this.camera.matrixWorld.elements, 'camera');
    this.sun.target.position.copy(this.look);
    this.sun.position.copy(this.look).addScaledVector(SUN_DIR, 400);
    this.tex.boost.offset.y -= dt * 1.6;
    this.composer.render();
  }

  /** Mean luminance (0–255) and its spread over the frame just drawn (render smoke check). */
  probe(): { mean: number; sd: number; w: number; h: number } {
    this.composer.render();
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = 0, s2 = 0;
    const n = w * h;
    for (let i = 0; i < n; i++) { const l = 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2]; s += l; s2 += l * l; }
    const mean = s / n;
    return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), w, h };
  }

  dispose(): void {
    this.clearWorld();
    this.swarm.dispose();
    this.tex.dispose();
    for (const m of new Set(Object.values(this.mats))) m.dispose();
    for (const d of this.disposables) d.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
