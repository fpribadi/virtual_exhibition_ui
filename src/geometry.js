// 2D polygon helpers (points are [x, z] on the floor plane) and prism geometry.
import * as THREE from 'three';

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function pointInPolygon([x, z], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const c = x1 * z2 - x2 * z1;
    a += c; cx += (x1 + x2) * c; cz += (z1 + z2) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [s[0] / pts.length, s[1] / pts.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cz / (6 * a)];
}

export function bbox(pts) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ, w: Math.max(maxX - minX, 1e-6), d: Math.max(maxZ - minZ, 1e-6) };
}

export function perimeter(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

export function closestOnSegment([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  const x = ax + dx * t, z = az + dz * t;
  return { point: [x, z], t, dist: Math.hypot(px - x, pz - z) };
}

/** Unit normal of each edge i (pts[i] -> pts[i+1]) pointing into the polygon. */
export function inwardNormals(pts) {
  const sign = signedArea(pts) > 0 ? 1 : -1;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [(-dz / l) * sign, (dx / l) * sign];
  });
}

/** Mitered inset of a polygon by distance t (used for the inner face of walls). */
export function insetPolygon(pts, t, normals = inwardNormals(pts)) {
  const n = pts.length;
  return pts.map((p, i) => {
    const n0 = normals[(i - 1 + n) % n], n1 = normals[i];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const len = t / Math.max(0.25, mx * n0[0] + mz * n0[1]);
    return [p[0] + mx * len, p[1] + mz * len];
  });
}

/** Regular polygon points, used for cylinders and prisms. */
export function regularPolygon(sides, radius, rotation = 0) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

/**
 * Extrude a 2D outline between y0 and y1. Non-indexed so normals are flat.
 * Group 0 = caps (top + bottom), group 1 = sides.
 * UVs: caps from the outline's bounding box, sides by perimeter distance
 * (or a custom uv(x, y, z) function, used for walls).
 */
export function makePrism(points, y0, y1, opts = {}) {
  const pts = points.slice();
  if (signedArea(pts) > 0) pts.reverse(); // makes side faces point outward
  const box = bbox(pts);
  const h = Math.max(y1 - y0, 1e-6);
  const pos = [], uv = [];
  const capUv = opts.uv || ((x, _y, z) => [(x - box.minX) / box.w, (box.maxZ - z) / box.d]);

  const push = (x, y, z, u) => { pos.push(x, y, z); uv.push(...u); };

  // caps
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const top of [true, false]) {
    if (top === false && opts.bottom === false) continue;
    const y = top ? y1 : y0;
    for (let [i, j, k] of tris) {
      const A = pts[i], B = pts[j], C = pts[k];
      const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
      if ((ny > 0) !== top) [j, k] = [k, j];
      for (const idx of [i, j, k]) push(pts[idx][0], y, pts[idx][1], capUv(pts[idx][0], y, pts[idx][1]));
    }
  }
  const capCount = pos.length / 3;

  // sides
  const P = perimeter(pts);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ua = s / P, ub = (s + len) / P;
    s += len;
    const quad = [[a, y0, ua], [b, y0, ub], [b, y1, ub], [a, y0, ua], [b, y1, ub], [a, y1, ua]];
    for (const [p, y, u] of quad) {
      push(p[0], y, p[1], opts.uv ? opts.uv(p[0], y, p[1]) : [u, (y - y0) / h]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  geo.addGroup(0, capCount, 0);
  geo.addGroup(capCount, pos.length / 3 - capCount, 1);
  geo.userData.aspect = { cap: box.w / box.d, side: P / h };
  geo.computeBoundingSphere();
  return geo;
}

export function disposeObject3D(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
  });
}
