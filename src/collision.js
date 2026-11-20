// Game-mode collision: everything is a 2D footprint polygon on the floor plus
// a vertical range [bottom, top]. The player is a circle with a height.
// No physics engine — just circle-vs-polygon push-out and a ground height.
import * as THREE from 'three';
import { pointInPolygon, closestOnSegment, bbox, regularPolygon } from './geometry.js';

export const PLAYER = { radius: 0.25, height: 1.75, eye: 1.6 };
export const STEP_HEIGHT = 0.45; // walk onto low platforms like the stage
export const NO_STEP = 0.05; // tiny bumps only

const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3();

/** AABB of an object's geometry in the object's own (root-local) space. */
function localBox(root) {
  _inv.copy(root.matrixWorld).invert();
  const out = new THREE.Box3();
  root.traverse((o) => {
    if (!o.geometry) return;
    let b;
    if (o.isInstancedMesh) {
      o.computeBoundingBox();
      b = o.boundingBox.clone();
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b = o.geometry.boundingBox.clone();
    }
    out.union(b.applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld)));
  });
  return out;
}

/** Footprint polygon + height range for a placed item. */
export function itemCollider(root) {
  const item = root.userData.item;
  root.updateWorldMatrix(true, true);
  const world = new THREE.Box3().setFromObject(root);
  const upright = Math.abs(_up.setFromMatrixColumn(root.matrixWorld, 1).normalize().y) > 0.98;
  const toWorld = (x, z) => {
    const p = new THREE.Vector3(x, 0, z).applyMatrix4(root.matrixWorld);
    return [p.x, p.z];
  };
  let poly;
  if (upright && Array.isArray(item.points)) {
    poly = item.points.map(([x, z]) => toWorld(x, z)); // the real outline, not a box
  } else if (item.type === 'sphere') {
    const c = world.getCenter(new THREE.Vector3());
    poly = regularPolygon(12, (world.max.x - world.min.x) / 2).map(([x, z]) => [x + c.x, z + c.z]);
  } else if (upright) {
    const b = localBox(root); // oriented rectangle that follows the object's rotation
    poly = [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.max.x, b.max.z], [b.min.x, b.max.z]].map(([x, z]) => toWorld(x, z));
  } else {
    poly = [[world.min.x, world.min.z], [world.max.x, world.min.z], [world.max.x, world.max.z], [world.min.x, world.max.z]];
  }
  return { poly, bottom: world.min.y, top: world.max.y };
}

/** All colliders for the current project (walls + items), built once per game session. */
export function buildColliders(views, roots) {
  const list = [];
  for (const v of views.values()) list.push(...v.colliders);
  for (const root of roots.values()) list.push(itemCollider(root));
  for (const c of list) c.box = bbox(c.poly);
  return list;
}

const blocks = (c, feet, step) => c.top > feet + step + 1e-3 && c.bottom < feet + PLAYER.height;

/** Push point p ([x, z], mutated) out of polygon so a circle of radius r no longer overlaps. */
function pushOut(p, r, c) {
  const b = c.box;
  if (p[0] < b.minX - r || p[0] > b.maxX + r || p[1] < b.minZ - r || p[1] > b.maxZ + r) return;
  const poly = c.poly;
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const s = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (!best || s.dist < best.dist) best = s;
  }
  const inside = pointInPolygon(p, poly);
  if (!inside && best.dist >= r) return;
  let dx = p[0] - best.point[0], dz = p[1] - best.point[1];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    // exactly on the edge: push away from the polygon's centre
    dx = p[0] - (b.minX + b.maxX) / 2; dz = p[1] - (b.minZ + b.maxZ) / 2;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
  } else {
    dx /= d; dz /= d;
    if (inside) { dx = -dx; dz = -dz; }
  }
  p[0] = best.point[0] + dx * r;
  p[1] = best.point[1] + dz * r;
}

/** Move from p by (mx, mz) without passing through anything. Returns the new [x, z]. */
export function moveWithCollision(p, mx, mz, feet, step, colliders) {
  const r = PLAYER.radius;
  const solid = colliders.filter((c) => blocks(c, feet, step));
  const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (r * 0.5)));
  const out = [p[0], p[1]];
  for (let s = 0; s < steps; s++) {
    out[0] += mx / steps;
    out[1] += mz / steps;
    for (let it = 0; it < 3; it++) for (const c of solid) pushOut(out, r, c);
  }
  return out;
}

/** Height of the highest walkable surface under the player's centre. */
export function groundAt(p, feet, step, colliders) {
  let g = 0;
  for (const c of colliders) {
    if (c.top > g && c.top <= feet + step + 1e-3 && c.top < PLAYER.height && pointInPolygon(p, c.poly)) g = c.top;
  }
  return g;
}

/** Nudge a spawn point out of any obstacle. */
export function freeSpot(p, colliders) {
  return moveWithCollision(p, 0, 0, 0, NO_STEP, colliders);
}
