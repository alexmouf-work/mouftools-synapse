import { describe, expect, it } from 'vitest';
import { scanSource } from '../../scripts/checks/purity';

describe('purity scanner', () => {
  const bad = [
    'const x = Math.sin(a);', 'Math.random()', 'const t = Date.now();', 'performance.now()', 'new Float32Array(4)',
    'const y = 2 ** 3;', "import * as THREE from 'three';", 'xs.sort();', 'Math.hypot(a, b)', 'Math.exp(1)',
    'Math.tanh(x)', 'Math.pow(2, 3)', 'Math.atan2(y, x)', 'Math.cos(x)', 'Math.tan(x)', 'Math.fround(x)',
    'document.body', "const m = Math['sin'];", "import { Vector3 } from 'three/src/math/Vector3';",
  ];
  for (const src of bad) it(`flags: ${src}`, () => expect(scanSource(src).length).toBeGreaterThan(0));
  const ok = [
    '// Math.sin is banned here', "const s = 'Math.random';", '/* Date */ const a = Math.sqrt(2) + Math.imul(3, 4);',
    'xs.sort((a, b) => a - b);', 'const p = Math.PI * Math.abs(x);', 'const z = a * b; // 2 ** 3',
  ];
  for (const src of ok) it(`passes: ${src}`, () => expect(scanSource(src)).toEqual([]));
});
