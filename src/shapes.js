// Shape library: everything except the sphere is an extruded point list,
// so all of them (including the stage) can have their corners edited.
import * as THREE from 'three';
import { makePrism, regularPolygon, bbox, perimeter } from './geometry.js';
import { defaultFill, makeFillMaterial, applyFill } from './textures.js';
import { uid } from './rooms.js';

export const SHAPE_TYPES = {
  box: { label: 'Box', points: () => [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], height: 1, color: '#7aa6c2' },
  cylinder: { label: 'Cylinder', points: () => regularPolygon(24, 0.5), height: 1, color: '#9ec27a' },
  triangle: { label: 'Triangle', points: () => regularPolygon(3, 0.6, -Math.PI / 2), height: 1, color: '#c29a7a' },
  sphere: { label: 'Sphere', radius: 0.5, color: '#c27a9e' },
  stage: { label: 'Stage', points: () => [[-1.5, -1], [1.5, -1], [1.5, 1], [-1.5, 1]], height: 0.4, color: '#5b4a3f' },
};

export function createShapeItem(type, extra = {}) {
  const def = SHAPE_TYPES[type];
  const item = {
    id: uid('item'),
    type,
    name: def.label,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    fill: defaultFill(def.color),
  };
  if (type === 'sphere') item.radius = def.radius;
  else { item.points = def.points(); item.height = def.height; }
  return Object.assign(item, extra);
}

/** Custom shape from world-space floor points (already room-local). */
export function createCustomShape(localPoints, height) {
  const cx = localPoints.reduce((s, p) => s + p[0], 0) / localPoints.length;
  const cz = localPoints.reduce((s, p) => s + p[1], 0) / localPoints.length;
  return {
    id: uid('item'),
    type: 'custom',
    name: 'Custom shape',
    position: [cx, 0, cz],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    points: localPoints.map(([x, z]) => [x - cx, z - cz]),
    height,
    fill: defaultFill('#a08cc8'),
  };
}

export function isPointShape(item) {
  return Array.isArray(item.points);
}

export function buildShape(item, root) {
  if (item.type === 'sphere') {
    const geo = new THREE.SphereGeometry(item.radius, 24, 16);
    const mat = makeFillMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = item.radius;
    root.add(mesh);
    root.userData.fillSlots = [{ mat, aspect: () => 2, face: 'all' }];
    return;
  }
  const geo = makePrism(item.points, 0, item.height);
  const cap = makeFillMaterial();
  const side = makeFillMaterial();
  root.add(new THREE.Mesh(geo, [cap, side]));
  const b = bbox(item.points);
  const P = perimeter(item.points);
  const s = root.scale;
  root.userData.fillSlots = [
    { mat: cap, face: 'top', aspect: () => (b.w * s.x) / (b.d * s.z) },
    { mat: side, face: 'sides', aspect: () => (P * (s.x + s.z) / 2) / (item.height * s.y) },
  ];
}

export function applyShapeFill(root, item) {
  for (const slot of root.userData.fillSlots || []) {
    const use = slot.face === 'all' || item.fill.faces === 'all' || item.fill.faces === slot.face;
    applyFill(slot.mat, item.fill, slot.aspect(), use);
  }
}
