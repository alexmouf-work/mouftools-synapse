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
import { makeCar, type CarModel } from './car';
import { DriveRig, type DrivePose } from './drive';
import { buildStadium, type Stadium } from './stadium';
import { Swarm } from './ghosts';
import { buildFinish, type Finish } from './finish';
import { fadeNear } from './glow';
import { assertFiniteArray } from './guard';
import { buildScenery, type Scenery } from './scenery';
import { makeTextures, stadiumTextures, type StadiumTextures, type Textures } from './textures';
import { at, trackParts, type PartKey } from './trackMesh';

const FOG = new THREE.Color('#bcd4f2');
/** Bloom picks up HDR luminance above this. Scenery stays under it; only lights, pads, wall strips and cars' lamps
 * (objects tagged userData.glow) go over (bloomAudit checks it). */
export const BLOOM_THRESHOLD = 1.3;
/**
 * Lit scenery is kept under the bloom threshold by construction: all scene light (sun, sky light, environment, fog,
 * sky dome, emissive scenery) is scaled by LIGHT and the exposure by 1/LIGHT, so the picture looks the same but a
 * sunlit white kerb sits near 1.2 instead of 1.9. Glow-tagged things keep their HDR values and still bloom.
 */
const LIGHT = 0.6;
// training camera: chase angle over the pack, metres
const CAM_BACK = 46, CAM_SIDE = 14, CAM_UP = 44, CAM_AHEAD = 24;
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
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);
  readonly swarm: Swarm;
  private readonly car: CarModel;
  private track: Track | null = null;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly sun = new THREE.DirectionalLight('#fff0dc', 2.6 * LIGHT);
  private readonly tex: Textures;
  private readonly mats: Record<PartKey, THREE.Material>;
  private readonly world = new THREE.Group();
  private scenery: Scenery | null = null;
  private finish: Finish | null = null;
  /** Chequered flags at the finish line of the track on show (for the checks). */
  get finishFlags(): number { return this.finish?.flags ?? 0; }
  private stadium: Stadium | null = null;
  private stadTex: StadiumTextures | null = null;
  /** train: the swarm and the pack camera · drive: the yellow car, rays, stadium and the drive cameras. */
  mode: 'train' | 'drive' = 'train';
  readonly drive: DriveRig;
  private readonly look = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
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
    this.renderer.toneMappingExposure = 0.88 / LIGHT;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    this.scene.environment = env;
    this.disposables.push(pmrem, env);

    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // radius 0.32 (mock-up 0.45): glows stay lines instead of spreading into haze near the camera
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.7, 0.32, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.disposables.push(rt, this.bloom);

    const fog = FOG.clone().multiplyScalar(LIGHT);
    this.scene.fog = new THREE.Fog(fog, 600, 2300);
    const skyGeo = new THREE.SphereGeometry(1900, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#1847c4') }, mid: { value: new THREE.Color('#4f9cff') },
        horizon: { value: FOG.clone() }, sunCol: { value: new THREE.Color('#ffe6c2') }, sunDir: { value: SUN_DIR },
        scale: { value: LIGHT },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, mid, horizon, sunCol, sunDir; uniform float scale; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.2, h));
          c = mix(c, top, smoothstep(0.18, 0.8, h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 1400.0) * 9.0 + pow(s, 40.0) * 0.35 + pow(s, 4.0) * 0.12);
          gl_FragColor = vec4(c * scale, 1.0); }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1; sky.frustumCulled = false; sky.userData.glow = true; // the sun disc blooms
    this.scene.add(sky);
    this.disposables.push(skyGeo, skyMat);
    this.scene.add(new THREE.HemisphereLight('#cfe2ff', '#3f6f45', 0.55 * LIGHT));
    const sun = this.sun;
    sun.castShadow = high;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    const sc = sun.shadow.camera; sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 1; sc.far = 900; sc.updateProjectionMatrix();
    this.scene.add(sun, sun.target);

    this.tex = makeTextures(this.renderer.capabilities.getMaxAnisotropy());
    // kerbs, run-off and walls: rough enough that a grazing low sun can't glare over the bloom threshold (a kerb
    // reached 1.38 at roughness 0.6; bloom audit, brain v2 drive)
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.45 });
    const strip = fadeNear(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.9, 2.5), side: THREE.DoubleSide }));
    this.mats = {
      road: new THREE.MeshStandardMaterial({ map: this.tex.road, roughness: 0.78, metalness: 0, side: THREE.DoubleSide }),
      kerb: vc, runoff: vc, wall: vc, wallTop: vc, skirt: vc, soffit: vc, pillar: vc, strip,
      pad: new THREE.MeshBasicMaterial({ map: this.tex.boost, color: new THREE.Color(1.7, 1.5, 1.4), transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      start: new THREE.MeshStandardMaterial({ map: this.tex.checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    this.car = makeCar('#ffc21a', '#14161d', this.tex.glow);
    this.swarm = new Swarm(this.car);
    this.swarm.mesh.userData.glow = true;
    this.scene.add(this.world, this.swarm.mesh, this.car.car);
    this.drive = new DriveRig(this.tex.glow, this.camera, canvas);
    this.drive.group.visible = false;
    this.scene.add(this.drive.group);
    this.scaleLight(this.car.car);
    this.scaleLight(this.drive.group);
    this.scaleLight(this.world);
    this.resize();
  }

  /** Build the track and scenery for one view: training (swarm) or drive (stadium, car, rays). */
  async setTrack(t: Track, mode: 'train' | 'drive' = 'train'): Promise<void> {
    if (mode === 'drive' && !this.stadTex) this.stadTex = await stadiumTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.clearWorld();
    this.mode = mode;
    for (const p of trackParts(t)) {
      const m = new THREE.Mesh(p.geometry, this.mats[p.key]);
      m.receiveShadow = p.key !== 'strip' && p.key !== 'pad';
      m.castShadow = p.key === 'wall' || p.key === 'skirt' || p.key === 'soffit' || p.key === 'pillar';
      if (p.key === 'strip' || p.key === 'pad') m.userData.glow = true;
      this.world.add(m);
    }
    let keep: { x: number; z: number; r: number }[] = [];
    if (mode === 'drive' && this.stadTex) {
      this.stadium = buildStadium(t, this.stadTex);
      this.world.add(this.stadium.group);
      keep = this.stadium.keepClear;
      this.drive.setTrack(t, this.stadium.tvSpots);
    }
    this.finish = buildFinish(t, this.tex.checker);
    this.world.add(this.finish.group);
    this.scenery = buildScenery(t, t.seed, keep);
    this.world.add(this.scenery.group);
    this.scaleLight(this.world);
    this.track = t;
    this.swarm.setTrack(t);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = mode === 'drive' ? 420 : 600; fog.far = mode === 'drive' ? 1600 : 2300;
    this.swarm.mesh.visible = mode === 'train';
    this.car.car.visible = false;
    this.drive.group.visible = mode === 'drive';
    if (mode === 'train') { this.camera.fov = 50; this.camera.updateProjectionMatrix(); }
    this.snap = true;
  }

  private readonly scaled = new WeakSet<THREE.Material>();
  /** Apply LIGHT to the environment reflections and emission of lit, non-glow materials (once per material). */
  private scaleLight(root: THREE.Object3D): void {
    root.traverse((o) => {
      if (o.userData.glow || !(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!(m instanceof THREE.MeshStandardMaterial) || this.scaled.has(m)) continue;
        this.scaled.add(m);
        m.envMapIntensity *= LIGHT;
        m.emissiveIntensity *= LIGHT;
      }
    });
  }

  private clearWorld(): void {
    for (const c of [...this.world.children]) {
      this.world.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    this.scenery?.dispose();
    this.scenery = null;
    this.finish?.dispose();
    this.finish = null;
    this.stadium?.dispose();
    this.stadium = null;
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

  /** Advance by dt seconds and draw. Drive mode takes the car's pose for this frame. */
  frame(dt: number, time: number, pose?: DrivePose): void {
    if (this.mode === 'drive') {
      if (!pose) throw new Error('stage: drive frame without a pose');
      this.drive.update(pose, dt, time, this.reduceMotion);
      const c = this.drive.car.car.position;
      this.sun.target.position.copy(c);
      this.sun.position.copy(c).addScaledVector(SUN_DIR, 400);
      this.tex.boost.offset.y -= dt * 1.6;
      this.composer.render();
      return;
    }
    this.swarm.update(dt, time);
    if (this.swarm.jumped) { this.snap = true; this.swarm.jumped = false; } // another generation: cut, don't fly
    // chase the highlighted car from behind and a little to the side, low enough that a car reads as a car; at 12×
    // it covers the camera's offset in a fraction of a second, so the camera keeps up closely
    const t = this.track;
    if (t) {
      const i = this.swarm.focusIdx, back = Math.round(CAM_BACK / t.ds), ahead = Math.round(CAM_AHEAD / t.ds);
      const want = at(t, i - back, CAM_SIDE, CAM_UP, this.tmp);
      const look = at(t, i + ahead, 0, 0, this.tmp2);
      const k = this.snap ? 1 : 1 - Math.exp(-dt * (this.reduceMotion ? 3 : 12));
      this.camera.position.lerp(want, k);
      this.look.lerp(look, k);
      this.snap = false;
    }
    this.camera.lookAt(this.look);
    assertFiniteArray(this.camera.matrixWorld.elements, 'camera');
    this.sun.target.position.copy(this.look);
    this.sun.position.copy(this.look).addScaledVector(SUN_DIR, 400);
    this.tex.boost.offset.y -= dt * 1.6;
    this.composer.render();
  }

  /**
   * Training view: seek what is on screen to t seconds, snap the camera there and audit that frame (deterministic for
   * a given run, so a pass means pass).
   */
  auditTrainAt(t: number): { over: number; max: number; mask?: string } {
    if (this.mode !== 'train') throw new Error('stage: auditTrainAt outside the training view');
    const was = this.swarm.at;
    this.swarm.seek(t);
    this.snap = true;
    this.frame(0, 0);
    const a = this.bloomAudit();
    this.swarm.seek(was); // the playback carries on where it was
    this.snap = true;
    return a;
  }

  /**
   * Bloom audit: render the scene without its glow-tagged objects to a float target and report how much of it is
   * above the bloom threshold (it should be none: scenery must not glow).
   */
  bloomAudit(mask = false): { over: number; max: number; mask?: string } {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => { if (o.userData.glow && o.visible) { o.visible = false; hidden.push(o); } });
    const w = 320, h = 200;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const bg = this.scene.background;
    this.scene.background = new THREE.Color(0, 0, 0);
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.scene.background = bg;
    for (const o of hidden) o.visible = true;
    const px = new Float32Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    rt.dispose();
    let over = 0, max = 0;
    for (let i = 0; i < w * h; i++) {
      const l = 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2];
      if (l > BLOOM_THRESHOLD) over++;
      if (l > max) max = l;
    }
    let maskUrl: string | undefined;
    if (mask) { // debug: where scenery goes over, as a small image (red = over)
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d') as CanvasRenderingContext2D, img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (h - 1 - y) * w + x, o = 4 * (y * w + x);
        const l = 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2];
        img.data[o] = l > BLOOM_THRESHOLD ? 255 : Math.min(255, l * 150); img.data[o + 1] = l > BLOOM_THRESHOLD ? 0 : Math.min(255, l * 150); img.data[o + 2] = l > BLOOM_THRESHOLD ? 0 : Math.min(255, l * 150); img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0); maskUrl = c.toDataURL();
    }
    return { over: over / (w * h), max, mask: maskUrl };
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
    this.car.dispose();
    this.drive.dispose();
    this.stadTex?.dispose();
    this.tex.dispose();
    for (const m of new Set(Object.values(this.mats))) m.dispose();
    for (const d of this.disposables) d.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
