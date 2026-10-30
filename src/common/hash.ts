// FNV-1a (32-bit) over canonical bytes. Doubles hash as their little-endian IEEE bytes, so −0 ≠ +0 and any drift in
// the last bit shows.

export class Hasher {
  private h = 0x811c9dc5;
  private readonly dv = new DataView(new ArrayBuffer(8));

  byte(b: number): this {
    this.h = Math.imul(this.h ^ (b & 0xff), 0x01000193);
    return this;
  }
  u32(n: number): this {
    n >>>= 0;
    return this.byte(n).byte(n >>> 8).byte(n >>> 16).byte(n >>> 24);
  }
  f64(x: number): this {
    this.dv.setFloat64(0, x, true);
    for (let i = 0; i < 8; i++) this.byte(this.dv.getUint8(i));
    return this;
  }
  f64s(xs: ArrayLike<number>): this {
    this.u32(xs.length);
    for (let i = 0; i < xs.length; i++) this.f64(xs[i]);
    return this;
  }
  str(s: string): this {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); this.byte(c).byte(c >>> 8); }
    return this;
  }
  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}
