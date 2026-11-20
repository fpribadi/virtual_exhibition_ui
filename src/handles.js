// Draggable corner handles (room outlines and shape points).
// Picking is done in screen space with a 44px target, so handles are easy to
// hit with a fingertip no matter how far away the camera is.
import * as THREE from 'three';

const VERTEX_PX = 9; // visual radius in CSS px
const MID_PX = 6;
const HIT_PX = 22; // 44px diameter touch target

const sphereGeo = new THREE.SphereGeometry(1, 16, 10);
sphereGeo.userData.shared = true;
const vertexMat = new THREE.MeshBasicMaterial({ color: '#1e88ff', depthTest: false });
const selectedMat = new THREE.MeshBasicMaterial({ color: '#ff7a1a', depthTest: false });
const midMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.9 });

export class Handles {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    scene.add(this.group);
    this.vertices = [];
    this.mids = [];
    this.spec = null;
    this.selected = -1;
  }

  /** spec: { points(): Vector3[] (world), onDrag(i, p), onInsert(edge, p), onEnd() } */
  set(spec) {
    this.spec = spec;
    this.selected = -1;
    this.sync();
  }

  clear() {
    this.spec = null;
    this.selected = -1;
    this.sync();
  }

  get active() { return !!this.spec; }

  sync() {
    const pts = this.spec ? this.spec.points() : [];
    const ensure = (arr, n, mat) => {
      while (arr.length < n) {
        const m = new THREE.Mesh(sphereGeo, mat);
        m.renderOrder = 10;
        m.raycast = () => {};
        this.group.add(m);
        arr.push(m);
      }
      while (arr.length > n) this.group.remove(arr.pop());
    };
    ensure(this.vertices, pts.length, vertexMat);
    ensure(this.mids, pts.length, midMat);
    pts.forEach((p, i) => {
      this.vertices[i].position.copy(p);
      this.vertices[i].material = i === this.selected ? selectedMat : vertexMat;
      const q = pts[(i + 1) % pts.length];
      this.mids[i].position.copy(p).add(q).multiplyScalar(0.5);
    });
  }

  /** Keep handles a constant size on screen. */
  updateScale(camera, viewportHeight) {
    if (!this.spec) return;
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewportHeight;
    const scale = (m, px) => m.scale.setScalar(m.position.distanceTo(camera.position) * k * px);
    this.vertices.forEach((m) => scale(m, VERTEX_PX));
    this.mids.forEach((m) => scale(m, MID_PX));
  }

  /** Returns { type: 'vertex' | 'mid', index } or null. */
  pick(clientX, clientY, camera, rect) {
    if (!this.spec) return null;
    const v = new THREE.Vector3();
    const toScreen = (p) => {
      v.copy(p).project(camera);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z];
    };
    let best = null;
    const test = (arr, type, bonus) => arr.forEach((m, index) => {
      const [x, y, z] = toScreen(m.position);
      if (z > 1) return;
      const d = Math.hypot(x - clientX, y - clientY) - bonus;
      if (d < HIT_PX && (!best || d < best.d)) best = { type, index, d };
    });
    test(this.vertices, 'vertex', 4); // corners win ties with midpoints
    test(this.mids, 'mid', 0);
    return best;
  }
}
