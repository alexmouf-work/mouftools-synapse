// Purity check: src/common must stay deterministic and engine-free (CLAUDE.md). Fails on DOM/three, clocks,
// Math.random, engine transcendental Math (use fmath), Float32, `**`, and a comparator-less .sort().
// Math is allow-listed: anything not in ALLOWED_MATH fails, so a new engine function cannot slip in.
//   npx tsx scripts/checks/purity.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_MATH = new Set([
  'abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc', 'sign', 'sqrt', 'imul', 'clz32',
  'PI', 'SQRT2', 'SQRT1_2', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'E',
]);

const RULES: { re: RegExp; why: string }[] = [
  { re: /\bDate\b/, why: 'clock (Date)' },
  { re: /\bperformance\b/, why: 'clock (performance)' },
  { re: /\bFloat32Array\b|\bMath\.fround\b/, why: 'Float32 (sim is Float64 only)' },
  { re: /\*\*/, why: 'exponent operator (engine pow)' },
  { re: /\b(document|window|navigator|localStorage|requestAnimationFrame|setTimeout|setInterval)\b/, why: 'DOM / timers' },
  { re: /\bcrypto\b/, why: 'crypto (unseeded randomness)' },
  { re: /\.sort\(\s*\)/, why: '.sort() without a comparator' },
  { re: /\bMath\.random\b/, why: 'Math.random' },
];

/** Strip comments and string/template contents so prose about Math.sin does not trip the check. */
export function stripNonCode(src: string): string {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += q; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; else if (src[i] === '\n') out += '\n'; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

export interface Violation { line: number; why: string; text: string }

export function scanSource(src: string): Violation[] {
  // module specifiers matter for the three.js rule, so check imports on the raw text first
  const v: Violation[] = [];
  const raw = src.split('\n');
  raw.forEach((t, k) => {
    if (/(\bfrom\s*|\bimport\s*\(?\s*)['"]three(\/[^'"]*)?['"]/.test(t)) v.push({ line: k + 1, why: 'three.js import', text: t.trim() });
  });
  const code = stripNonCode(src).split('\n');
  code.forEach((t, k) => {
    for (const r of RULES) if (r.re.test(t)) v.push({ line: k + 1, why: r.why, text: raw[k].trim() });
    for (const m of t.matchAll(/\bMath\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
      if (!ALLOWED_MATH.has(m[1])) v.push({ line: k + 1, why: `Math.${m[1]} (use fmath or integer maths)`, text: raw[k].trim() });
    }
    if (/\bMath\s*\[/.test(t)) v.push({ line: k + 1, why: 'computed Math access', text: raw[k].trim() });
  });
  return v;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../../src/common', import.meta.url));
  const files = walk(root);
  let bad = 0;
  for (const f of files) {
    for (const x of scanSource(readFileSync(f, 'utf8'))) {
      bad++;
      console.error(`${relative(process.cwd(), f)}:${x.line}: ${x.why}\n    ${x.text}`);
    }
  }
  if (bad) { console.error(`purity: ${bad} violation(s) in src/common`); process.exit(1); }
  console.log(`purity: ${files.length} files in src/common clean`);
}
