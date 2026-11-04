// The senses' 3-D symbols (ported from reference/brain-v2-mockup.html): plain matte low-poly models drawn on one WebGL
// canvas under the designer's diagram, one small viewport per tray button and per sense cell. Build mode is still, so
// they only keep a gentle idle motion (the wall turns, the flag waves). Loaded after first paint (three.js).
import * as THREE from 'three';

type Upd = (t: number) => void;
interface Sym { s: THREE.Scene; upd: Upd }

const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, flatShading: true });
function scene(build: (g: THREE.Group) => Upd | void): Sym {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 1.4); d.position.set(2, 3, 4); s.add(d);
  const g = new THREE.Group(); s.add(g);
  return { s, upd: build(g) || (() => {}) };
}

function buildSymbols(): Record<string, Sym> {
  return {
    wall: scene((g) => {
      const m1 = mat(0xd98a6c), m2 = mat(0xc5755a);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.4), (r + c) % 2 ? m1 : m2);
        b.position.set((c - 1.5) * 0.66 + (r % 2) * 0.33 - 0.16, r * 0.33 - 0.5, 0); g.add(b);
      }
      return (t) => { g.rotation.set(0.25, Math.sin(t * 0.6) * 0.5, 0); };
    }),
    flag: scene((g) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), mat(0x8a8f99)); pole.position.x = -0.9; g.add(pole);
      const geo = new THREE.PlaneGeometry(1.6, 1, 8, 5), cols: number[] = [], pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const c = (Math.floor((pos.getX(i) + 0.8) * 4) + Math.floor((pos.getY(i) + 0.5) * 4)) % 2 ? 0.95 : 0.12; cols.push(c, c, c); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }));
      flag.position.set(-0.1, 0.55, 0); g.add(flag);
      const base = (pos.array as ArrayLike<number> & { slice(): ArrayLike<number> }).slice();
      return (t) => { for (let i = 0; i < pos.count; i++) { const x = base[i * 3]; pos.setZ(i, Math.sin(x * 3 + t * 4) * 0.12 * (x + 0.8)); } pos.needsUpdate = true; geo.computeVertexNormals(); g.rotation.y = -0.4; };
    }),
    arrow: scene((g) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 6, 28, Math.PI * 1.6), mat(0x5b8def)); g.add(ring);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 6), mat(0x5b8def));
      tip.position.set(0.85 * Math.cos(Math.PI * 1.6), 0.85 * Math.sin(Math.PI * 1.6), 0); tip.rotation.z = Math.PI * 1.6; g.add(tip);
      return (t) => { g.rotation.set(0.9, 0, -t * 0.4); };
    }),
    hex: scene((g) => {
      const discs: THREE.Mesh[] = [], geo = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 18);
      const pts = [[0, 0], ...[0, 1, 2, 3, 4, 5].map((i) => [0.78 * Math.cos((i * Math.PI) / 3), 0.78 * Math.sin((i * Math.PI) / 3)])];
      for (const [x, z] of pts) { const d = new THREE.Mesh(geo, mat(0x3fb3a3)); d.position.set(x, 0, z); g.add(d); discs.push(d); }
      return (t) => {
        const on = Math.floor(t * 0.8) % 7; // flat against the screen, one button lit at a time
        discs.forEach((d, i) => { d.position.y = i === on ? 0.14 : 0; (d.material as THREE.MeshStandardMaterial).color.setHex(i === on ? 0x7fe0cf : 0x3fb3a3); });
        g.rotation.set(Math.PI / 2, 0, 0);
      };
    }),
    gauge: scene((g) => {
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.15, 20, 1, false, 0, Math.PI), mat(0xb9c0cc));
      dial.rotation.set(Math.PI / 2, Math.PI / 2, 0); g.add(dial);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.08), mat(0xe25a4a));
      needle.geometry.translate(0, 0.42, 0); needle.position.z = 0.12; g.add(needle);
      return (t) => { needle.rotation.z = Math.PI / 2 - (0.5 + 0.35 * Math.sin(t * 0.7)) * Math.PI; g.position.y = -0.35; };
    }),
  };
}

export function createSymbols(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const SYM = buildSymbols();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 0.2, 5.6); cam.lookAt(0, 0, 0);
  return {
    /** Draw every symbol at its centre (CSS px of the board) and size; pixelScale: the layout's scale on screen. */
    draw(list: { sym: string; x: number; y: number; size: number }[], t: number, pixelScale: number): void {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * pixelScale);
      renderer.setSize(w, h, false);
      renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
      for (const it of list) {
        const sym = SYM[it.sym];
        if (!sym || it.size < 8) continue;
        const x = it.x - it.size / 2, y = h - it.y - it.size / 2;
        renderer.setViewport(x, y, it.size, it.size); renderer.setScissor(x, y, it.size, it.size);
        sym.upd(t);
        renderer.render(sym.s, cam);
      }
    },
  };
}
