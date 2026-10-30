// NaN / overflow guards for the renderer. One non-finite vertex or matrix turns the whole frame black through the
// bloom pass, and an InstancedMesh write past its capacity is silently dropped, so both throw here instead.
import type { BufferGeometry, InstancedMesh, Matrix4 } from 'three';

export function assertFiniteArray(a: ArrayLike<number>, what: string): void {
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) throw new Error(`render: non-finite value in ${what} at ${i} (${a[i]})`);
  }
}

/** Every attribute of the geometry must be finite. */
export function assertFiniteGeometry(g: BufferGeometry, what: string): BufferGeometry {
  for (const [name, attr] of Object.entries(g.attributes)) assertFiniteArray(attr.array as ArrayLike<number>, `${what}.${name}`);
  return g;
}

/** Write instance i's matrix after checking the index is within capacity and the matrix is finite. */
export function setInstance(mesh: InstancedMesh, i: number, m: Matrix4): void {
  const cap = mesh.instanceMatrix.count;
  if (!(i >= 0 && i < cap)) throw new Error(`render: instance ${i} outside capacity ${cap} of ${mesh.name || 'InstancedMesh'}`);
  assertFiniteArray(m.elements, `${mesh.name || 'instance'} matrix ${i}`);
  mesh.setMatrixAt(i, m);
}

export function assertCapacity(mesh: InstancedMesh, n: number): void {
  const cap = mesh.instanceMatrix.count;
  if (n > cap) throw new Error(`render: ${n} instances wanted, ${mesh.name || 'InstancedMesh'} holds ${cap}`);
}
