// Near-field glow: a lit strip or gate band right beside the camera fills a third of the frame and blooms into fog.
// Glow materials keep full strength from mid distance on (the look mock-up's glow) and fade toward NEAR_K close to
// the camera, so they read as lines, not haze.
import * as THREE from 'three';

export const NEAR_FROM = 6; // m: at or nearer than this, NEAR_K of the colour
export const NEAR_TO = 60; // m: full colour from here on (mid distance keeps the look mock-up's glow)
export const NEAR_K = 0.25;

export function fadeNear<T extends THREE.MeshBasicMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying float vViewDist;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vViewDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vViewDist;\nvoid main() {')
      .replace('#include <opaque_fragment>', `outgoingLight *= mix(${NEAR_K.toFixed(2)}, 1.0, smoothstep(${NEAR_FROM.toFixed(1)}, ${NEAR_TO.toFixed(1)}, vViewDist));\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'fadeNear';
  return m;
}
