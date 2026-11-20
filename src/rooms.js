// Rooms: data defaults, floor/wall building, and doorways.
//
// A room is a 2D outline (local [x, z] points) placed at room.offset.
// Walls are extruded *inward* from the outline, so two rooms sharing an
// outline edge get two walls back to back with no overlap.
//
// A doorway is anchored to one room's edge (roomId, edge, t). Its world
// centre is computed from that edge, and every room wall that runs along the
// same line near that centre gets the same opening — so the door exists in
// both rooms' walls and follows when a room moves.
import * as THREE from 'three';
import { makePrism, inwardNormals, insetPolygon, closestOnSegment, bbox, centroid } from './geometry.js';
import { defaultFill, makeFillMaterial, applyFill, disposeFillMaterial } from './textures.js';

export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

export function defaultRoom(name, offsetX) {
  return {
    id: uid('room'),
    name,
    offset: [offsetX, 0],
    outline: [[-3, -2.5], [3, -2.5], [3, 2.5], [-3, 2.5]],
    wallHeight: 2.8,
    wallThickness: 0.15,
    floorFill: defaultFill('#b8a48a'),
    wallFill: defaultFill('#ebe6dd'),
    items: [],
  };
}

export function defaultDoorway(roomId, edge, t = 0.5) {
  return { id: uid('door'), roomId, edge, t, width: 1.2, height: 2.2 };
}

export function worldOutline(room) {
  return room.outline.map(([x, z]) => [x + room.offset[0], z + room.offset[1]]);
}

/** World centre + direction of a doorway, or null if its anchor is gone. */
export function doorwayFrame(project, d) {
  const room = project.rooms.find((r) => r.id === d.roomId);
  if (!room || d.edge >= room.outline.length) return null;
  const w = worldOutline(room);
  const a = w[d.edge], b = w[(d.edge + 1) % w.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { room, center: [a[0] + (b[0] - a[0]) * d.t, a[1] + (b[1] - a[1]) * d.t], dir, edgeLength: len };
}

/** For each edge of `room`, the openings [start, end, height] in edge-local metres. */
export function doorCuts(project, room) {
  const w = worldOutline(room);
  const cuts = w.map(() => []);
  for (const d of project.doorways) {
    const f = doorwayFrame(project, d);
    if (!f) continue;
    let best = null;
    for (let i = 0; i < w.length; i++) {
      const a = w[i], b = w[(i + 1) % w.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      if (Math.abs(u[0] * f.dir[0] + u[1] * f.dir[1]) < 0.985) continue;
      const rx = f.center[0] - a[0], rz = f.center[1] - a[1];
      const perp = Math.abs(rx * u[1] - rz * u[0]);
      const reach = f.room.wallThickness + room.wallThickness + 0.06;
      if (perp > reach) continue;
      const s = rx * u[0] + rz * u[1];
      if (s < 0 || s > L) continue;
      if (!best || perp < best.perp) best = { i, s, perp };
    }
    if (best) cuts[best.i].push([best.s - d.width / 2, best.s + d.width / 2, d.height, d.id]);
  }
  return cuts;
}

/** Which rooms a doorway actually cuts through (for UI feedback). */
export function doorwayRooms(project, d) {
  return project.rooms.filter((r) => doorCuts(project, r).some((c) => c.some((x) => x[3] === d.id)));
}

/** Re-anchor doorways of a room to its nearest edge after corners were added/removed. */
export function reanchorDoorways(project, room, mutate) {
  const saved = project.doorways
    .filter((d) => d.roomId === room.id)
    .map((d) => ({ d, f: doorwayFrame(project, d) }));
  mutate();
  const w = worldOutline(room);
  for (const { d, f } of saved) {
    if (!f) continue;
    let best = null;
    for (let i = 0; i < w.length; i++) {
      const c = closestOnSegment(f.center, w[i], w[(i + 1) % w.length]);
      if (!best || c.dist < best.dist) best = { i, t: c.t, dist: c.dist };
    }
    d.edge = best.i;
    d.t = best.t;
  }
}

const wallCapMaterial = new THREE.MeshLambertMaterial({ color: '#8a8580' });
const floorEdgeMaterial = new THREE.MeshLambertMaterial({ color: '#6e655a' });
const ghostMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false });

/** Scene objects for one room. Geometry is always derived from room data. */
export class RoomView {
  constructor(room) {
    this.room = room;
    this.group = new THREE.Group();
    this.group.userData.roomId = room.id;
    this.floorMat = makeFillMaterial();
    this.wallMat = makeFillMaterial();
    this.wallMats = [wallCapMaterial, this.wallMat];
    this.ghostMats = [ghostMaterial, ghostMaterial];
    this.floor = null;
    this.walls = new THREE.Group();
    this.items = new THREE.Group();
    this.outlineLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff7a1a' }));
    this.outlineLine.raycast = () => {};
    this.group.add(this.walls, this.items, this.outlineLine);
  }

  rebuild(project) {
    const room = this.room;
    this.group.position.set(room.offset[0], 0, room.offset[1]);

    // floor: thin slab so the edge is visible from outside
    if (this.floor) { this.group.remove(this.floor); this.floor.geometry.dispose(); }
    const fgeo = makePrism(room.outline, -0.08, 0);
    this.floor = new THREE.Mesh(fgeo, [this.floorMat, floorEdgeMaterial]);
    this.floor.userData = { kind: 'floor', roomId: room.id };
    this.group.add(this.floor);

    this.outlineLine.geometry.dispose();
    this.outlineLine.geometry = new THREE.BufferGeometry().setFromPoints(
      room.outline.map(([x, z]) => new THREE.Vector3(x, 0.015, z)),
    );

    // walls
    for (const m of this.walls.children) m.geometry.dispose();
    this.walls.clear();
    const pts = room.outline;
    const n = pts.length;
    const T = room.wallThickness, H = room.wallHeight;
    const normals = inwardNormals(pts);
    const inner = insetPolygon(pts, T, normals);
    const cuts = doorCuts(project, room);
    let totalLen = 0;

    for (let i = 0; i < n; i++) {
      const P0 = pts[i], P1 = pts[(i + 1) % n];
      const L = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
      if (L < 1e-4) continue;
      totalLen += L;
      const dir = [(P1[0] - P0[0]) / L, (P1[1] - P0[1]) / L];
      const nrm = normals[i];
      const a = (inner[i][0] - P0[0]) * dir[0] + (inner[i][1] - P0[1]) * dir[1];
      const b = L + (inner[(i + 1) % n][0] - P1[0]) * dir[0] + (inner[(i + 1) % n][1] - P1[1]) * dir[1];
      const toLocal = ([u, v]) => [P0[0] + dir[0] * u + nrm[0] * v, P0[1] + dir[1] * u + nrm[1] * v];
      const uvFn = (x, y, z) => [((x - P0[0]) * dir[0] + (z - P0[1]) * dir[1]) / L, y / H];

      const lo = Math.max(0, a) + 0.05, hi = Math.min(L, b) - 0.05;
      const openings = cuts[i]
        .map(([s, e, h]) => [Math.max(lo, s), Math.min(hi, e), Math.min(h, H)])
        .filter(([s, e]) => e - s > 0.1)
        .sort((x, y) => x[0] - y[0]);

      const pieces = []; // [polygon(u,v), y0, y1]
      let startOuter = 0, startInner = a, cursor = null;
      for (const [s, e, h] of openings) {
        if (cursor !== null && s < cursor) continue; // overlapping doors
        pieces.push([[[startOuter, 0], [s, 0], [s, T], [startInner, T]], 0, H]);
        if (h < H - 0.01) pieces.push([[[s, 0], [e, 0], [e, T], [s, T]], h, H]);
        startOuter = e; startInner = e; cursor = e;
      }
      pieces.push([[[startOuter, 0], [L, 0], [b, T], [startInner, T]], 0, H]);

      const mid = toLocal([L / 2, T / 2]);
      for (const [poly, y0, y1] of pieces) {
        const geo = makePrism(poly.map(toLocal), y0, y1, { uv: uvFn, bottom: false });
        const mesh = new THREE.Mesh(geo, this.wallMats);
        mesh.userData = { kind: 'wall', roomId: room.id, edge: i, inward: nrm, center: mid, ghost: false };
        this.walls.add(mesh);
      }
    }
    this.wallAspect = totalLen / n / H;
    this.applyFills();
  }

  applyFills() {
    const r = this.room;
    const b = bbox(r.outline);
    applyFill(this.floorMat, r.floorFill, b.w / b.d);
    applyFill(this.wallMat, r.wallFill, this.wallAspect || 2);
  }

  setActive(active) {
    this.outlineLine.visible = active;
  }

  /** Fade walls that stand between the camera and the room interior. */
  updateCutaway(camera, enabled) {
    const cx = camera.position.x - this.group.position.x;
    const cz = camera.position.z - this.group.position.z;
    for (const m of this.walls.children) {
      const { inward, center } = m.userData;
      const ghost = enabled && camera.position.y > 0.3 &&
        inward[0] * (cx - center[0]) + inward[1] * (cz - center[1]) < 0;
      if (ghost !== m.userData.ghost) {
        m.userData.ghost = ghost;
        m.material = ghost ? this.ghostMats : this.wallMats;
      }
    }
  }

  center() {
    const c = centroid(this.room.outline);
    return new THREE.Vector3(c[0] + this.room.offset[0], 0, c[1] + this.room.offset[1]);
  }

  dispose() {
    this.floor?.geometry.dispose();
    for (const m of this.walls.children) m.geometry.dispose();
    this.outlineLine.geometry.dispose();
    this.outlineLine.material.dispose();
    disposeFillMaterial(this.floorMat);
    disposeFillMaterial(this.wallMat);
  }
}
