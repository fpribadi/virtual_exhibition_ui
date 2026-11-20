// Exhibition objects (poster, table, projector, projector screen) and the
// shared item build/dispose entry points. The stage lives in shapes.js because
// it is an editable extruded outline.
import * as THREE from 'three';
import { defaultFill, makeFillMaterial, disposeFillMaterial, applyFill } from './textures.js';
import { uid } from './rooms.js';
import { SHAPE_TYPES, buildShape, applyShapeFill } from './shapes.js';

export const OBJECT_TYPES = {
  poster: { label: 'Poster', color: '#f2efe8' },
  table: { label: 'Table', color: '#8b6b4a' },
  projector: { label: 'Projector', color: '#2f3237' },
  screen: { label: 'Projector screen', color: '#ffffff' },
};

const POSTER = { w: 0.6, h: 0.9, d: 0.02 };
const TABLE = { w: 1.6, d: 0.8, h: 0.75, top: 0.05, leg: 0.06 };
const SCREEN = { w: 2.4, h: 1.35, bottom: 0.9, frame: 0.05 };

export function createObjectItem(type) {
  const def = OBJECT_TYPES[type];
  return {
    id: uid('item'),
    type,
    name: def.label,
    position: [0, type === 'poster' ? 1.5 : 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    fill: defaultFill(def.color),
  };
}

export function hasImageFill(item) {
  return item.type !== 'table' && item.type !== 'projector';
}

const plain = (color) => new THREE.MeshLambertMaterial({ color });

function buildObject(item, root) {
  const color = item.fill.color;
  const s = root.scale;
  if (item.type === 'poster') {
    const front = makeFillMaterial();
    const edge = plain('#d8d4cc');
    // BoxGeometry groups: +x, -x, +y, -y, +z (front), -z
    root.add(new THREE.Mesh(new THREE.BoxGeometry(POSTER.w, POSTER.h, POSTER.d), [edge, edge, edge, edge, front, edge]));
    root.userData.fillSlots = [{ mat: front, face: 'all', aspect: () => (POSTER.w * s.x) / (POSTER.h * s.y) }];
    root.userData.plainMats = [edge];
  } else if (item.type === 'screen') {
    const frameMat = plain('#222428');
    const canvas = makeFillMaterial();
    const legH = SCREEN.bottom + SCREEN.h + 0.1;
    const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, legH, 8), frameMat, 2);
    const m = new THREE.Matrix4();
    for (const [i, x] of [[0, -SCREEN.w / 2 - 0.08], [1, SCREEN.w / 2 + 0.08]]) {
      legs.setMatrixAt(i, m.makeTranslation(x, legH / 2, -0.03));
    }
    const cy = SCREEN.bottom + SCREEN.h / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.w + 0.1, SCREEN.h + 0.1, SCREEN.frame), frameMat);
    frame.position.set(0, cy, -0.03);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), canvas);
    plane.position.set(0, cy, 0.0);
    root.add(legs, frame, plane);
    root.userData.fillSlots = [{ mat: canvas, face: 'all', aspect: () => (SCREEN.w * s.x) / (SCREEN.h * s.y) }];
    root.userData.plainMats = [frameMat];
  } else if (item.type === 'table') {
    const mat = plain(color);
    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, TABLE.top, TABLE.d), mat);
    top.position.y = TABLE.h - TABLE.top / 2;
    const legH = TABLE.h - TABLE.top;
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(TABLE.leg, legH, TABLE.leg), mat, 4);
    const m = new THREE.Matrix4();
    const lx = TABLE.w / 2 - 0.08, lz = TABLE.d / 2 - 0.08;
    [[-lx, -lz], [lx, -lz], [lx, lz], [-lx, lz]].forEach(([x, z], i) => legs.setMatrixAt(i, m.makeTranslation(x, legH / 2, z)));
    root.add(top, legs);
    root.userData.colorMats = [mat];
    root.userData.plainMats = [mat];
  } else if (item.type === 'projector') {
    const body = plain(color);
    const dark = plain('#111111');
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), dark);
    pole.position.y = 0.55;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.04, 16), dark);
    base.position.y = 0.02;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.34), body);
    box.position.y = 1.17;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 16), dark);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0.1, 1.17, 0.19);
    root.add(pole, base, box, lens);
    root.userData.colorMats = [body];
    root.userData.plainMats = [body, dark];
  }
}

/** Build the scene object for any item. Returns a Group with userData.item. */
export function buildItem(item) {
  const root = new THREE.Group();
  root.userData.item = item;
  root.position.fromArray(item.position);
  root.rotation.fromArray(item.rotation);
  root.scale.fromArray(item.scale);
  if (item.type in SHAPE_TYPES || item.type === 'custom') buildShape(item, root);
  else buildObject(item, root);
  applyItemFill(root);
  return root;
}

export function applyItemFill(root) {
  const item = root.userData.item;
  if (root.userData.colorMats) for (const m of root.userData.colorMats) m.color.set(item.fill.color);
  if (item.type in SHAPE_TYPES || item.type === 'custom') applyShapeFill(root, item);
  else for (const slot of root.userData.fillSlots || []) applyFill(slot.mat, item.fill, slot.aspect(), true);
}

export function disposeItem(root) {
  root.traverse((o) => o.geometry?.dispose());
  for (const slot of root.userData.fillSlots || []) disposeFillMaterial(slot.mat);
  for (const m of new Set(root.userData.plainMats || [])) m.dispose();
  root.removeFromParent();
}

export function itemLabel(type) {
  return (SHAPE_TYPES[type] || OBJECT_TYPES[type])?.label || 'Custom shape';
}
