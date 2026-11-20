// Studio mode: owns the project data, scene objects, selection, tools and
// pointer input. The UI (ui/panels.js) listens for events and calls methods.
//
// Events: 'structure' (selection/mode/room list changed → re-render panels),
//         'roommoved', 'toast' (CustomEvent with detail = message).
import * as THREE from 'three';
import { RoomView, defaultDoorway, reanchorDoorways, worldOutline, doorwayRooms, uid } from './rooms.js';
import { buildItem, applyItemFill, disposeItem, createObjectItem } from './objects.js';
import { SHAPE_TYPES, createShapeItem, createCustomShape } from './shapes.js';
import { preloadProjectImages } from './textures.js';
import { scheduleAutosave } from './storage.js';
import { Handles } from './handles.js';
import { pointInPolygon, centroid, closestOnSegment, inwardNormals, signedArea, bbox } from './geometry.js';

const SNAP = 0.05;
const snap = (v) => +(Math.round(v / SNAP) * SNAP).toFixed(3);
const TAP_MOVE_PX = 8;
const TAP_MS = 600;

export class Studio extends EventTarget {
  constructor({ scene, camera, renderer, orbit, tc, canvas, requestRender }) {
    super();
    Object.assign(this, { scene, camera, renderer, orbit, tc, canvas, requestRender });
    this.project = null;
    this.views = new Map(); // roomId -> RoomView
    this.roots = new Map(); // itemId -> Group
    this.activeRoomId = null;
    this.selectedId = null;
    this.selectedDoorId = null;
    this.mode = 'select'; // select | corners | points | draw | door | moveRoom
    this.tcMode = 'translate';
    this.cutaway = true;
    this.handles = new Handles(scene);
    this.raycaster = new THREE.Raycaster();
    this.pointers = new Set();
    this.tap = null;
    this.drag = null;
    this.tcGrab = false;
    this.draw = { points: [], height: 1 };

    const drawMat = new THREE.LineBasicMaterial({ color: '#ff7a1a', depthTest: false });
    this.drawLine = new THREE.Line(new THREE.BufferGeometry(), drawMat);
    this.drawDots = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: '#ff7a1a', size: 12, sizeAttenuation: false, depthTest: false }),
    );
    this.drawLine.renderOrder = this.drawDots.renderOrder = 11;
    this.drawLine.raycast = this.drawDots.raycast = () => {};
    scene.add(this.drawLine, this.drawDots);

    this.setupTransformControls();
    this.setupPointer();
    this.setupKeyboard();
  }

  // ---------- events / data plumbing ----------
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  toast(msg) { this.emit('toast', msg); }
  changed() {
    scheduleAutosave(this.project, (m) => this.toast(m));
    this.requestRender();
  }

  get activeRoom() { return this.project.rooms.find((r) => r.id === this.activeRoomId); }
  get activeView() { return this.views.get(this.activeRoomId); }
  findItem(id) {
    for (const room of this.project.rooms) {
      const item = room.items.find((i) => i.id === id);
      if (item) return { room, item };
    }
    return null;
  }
  get selectedItem() { return this.selectedId ? this.findItem(this.selectedId)?.item : null; }

  // ---------- loading ----------
  async load(project) {
    await preloadProjectImages(project);
    this.setMode('select');
    this.deselect();
    for (const root of this.roots.values()) disposeItem(root);
    for (const v of this.views.values()) { v.dispose(); v.group.removeFromParent(); }
    this.roots.clear();
    this.views.clear();
    this.project = project;
    for (const room of project.rooms) {
      const view = new RoomView(room);
      this.views.set(room.id, view);
      this.scene.add(view.group);
      for (const item of room.items) this.addRoot(room, item);
    }
    this.rebuildRooms();
    this.activeRoomId = null;
    this.setActiveRoom(project.rooms[0].id);
    this.frameAll();
    this.changed();
  }

  addRoot(room, item) {
    const root = buildItem(item);
    this.views.get(room.id).items.add(root);
    this.roots.set(item.id, root);
    return root;
  }

  /** Door cuts depend on every room, so walls are always rebuilt together. */
  rebuildRooms() {
    for (const v of this.views.values()) v.rebuild(this.project);
    this.requestRender();
  }

  rebuildItem(id) {
    const old = this.roots.get(id);
    const found = this.findItem(id);
    if (!old || !found) return;
    const parent = old.parent;
    disposeItem(old);
    const root = buildItem(found.item);
    parent.add(root);
    this.roots.set(id, root);
    if (this.selectedId === id && this.mode === 'select') this.tc.attach(root);
    this.requestRender();
  }

  refreshItemFill(id) {
    const root = this.roots.get(id);
    if (root) applyItemFill(root);
    this.changed();
  }

  refreshRoomFills(room) {
    this.views.get(room.id)?.applyFills();
    this.changed();
  }

  // ---------- camera ----------
  frameAll() {
    const pts = this.project.rooms.flatMap(worldOutline);
    const b = bbox(pts);
    const target = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    // Fit the world's width and depth into the view, whatever the screen aspect.
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    // Only count the canvas area not covered by the desktop side panels.
    const rect = this.canvas.getBoundingClientRect();
    let usable = rect.width;
    for (const id of ['left', 'right']) {
      const el = document.getElementById(id);
      if (el && getComputedStyle(el).display !== 'none' && el.offsetWidth < rect.width * 0.4) usable -= el.offsetWidth + 10;
    }
    const aspect = Math.max(usable, 200) / Math.max(rect.height, 1);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = Math.max((b.d + 2) / (2 * Math.tan(vfov / 2)) * 1.4, (b.w + 1) / (2 * Math.tan(hfov / 2)));
    this.orbit.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3(0, 0.75, 0.66).normalize().multiplyScalar(dist));
    this.orbit.update();
    this.requestRender();
  }

  focusRoom(room) {
    const c = this.views.get(room.id).center();
    const delta = c.clone().sub(this.orbit.target);
    this.orbit.target.add(delta);
    this.camera.position.add(delta);
    this.orbit.update();
    this.requestRender();
  }

  // ---------- rooms ----------
  setActiveRoom(id, focus = false) {
    if (this.activeRoomId === id) return;
    if (this.mode !== 'select') this.setMode('select');
    this.deselect(false);
    this.activeRoomId = id;
    for (const [rid, v] of this.views) v.setActive(rid === id);
    if (focus) this.focusRoom(this.activeRoom);
    this.emit('structure');
    this.requestRender();
  }

  updateRoom(room, patch) {
    Object.assign(room, patch);
    this.rebuildRooms();
    if (this.mode === 'corners') this.handles.sync();
    this.changed();
  }

  // ---------- selection ----------
  select(id) {
    const root = this.roots.get(id);
    if (!root) return;
    this.selectedId = id;
    this.selectedDoorId = null;
    this.tc.attach(root);
    this.tc.setMode(this.tcMode);
    this.emit('structure');
    this.requestRender();
  }

  deselect(emit = true) {
    if (this.mode === 'points') this.setMode('select');
    this.selectedId = null;
    if (this.mode !== 'moveRoom') this.tc.detach();
    if (emit) this.emit('structure');
    this.requestRender();
  }

  setTransformMode(m) {
    this.tcMode = m;
    this.tc.setMode(m);
    this.emit('structure');
  }

  // ---------- modes ----------
  setMode(mode) {
    const prev = this.mode;
    if (prev === mode) return;
    // leave
    if (prev === 'corners' || prev === 'points') this.handles.clear();
    if (prev === 'draw') this.clearDraw();
    if (prev === 'moveRoom') {
      this.tc.detach();
      this.tc.showY = true;
      this.tc.translationSnap = null;
    }
    this.mode = mode;
    // enter
    if (mode === 'corners') {
      this.deselect(false);
      this.handles.set(this.roomCornerSpec(this.activeRoom));
    } else if (mode === 'points') {
      this.tc.detach();
      this.handles.set(this.itemPointSpec(this.selectedId));
    } else if (mode === 'draw' || mode === 'door') {
      this.deselect(false);
      if (mode === 'draw') this.updateDrawPreview();
    } else if (mode === 'moveRoom') {
      this.deselect(false);
      this.tc.attach(this.activeView.group);
      this.tc.setMode('translate');
      this.tc.showY = false;
      this.tc.translationSnap = SNAP;
    } else if (mode === 'select' && prev === 'points' && this.selectedId) {
      this.tc.attach(this.roots.get(this.selectedId));
    }
    this.emit('structure');
    this.requestRender();
  }

  roomCornerSpec(room) {
    const off = () => room.offset;
    return {
      points: () => room.outline.map(([x, z]) => new THREE.Vector3(x + off()[0], 0.03, z + off()[1])),
      planeY: () => 0,
      onDrag: (i, p) => {
        room.outline[i] = [snap(p.x - off()[0]), snap(p.z - off()[1])];
        this.rebuildRooms();
      },
      onInsert: (edge, p) => {
        reanchorDoorways(this.project, room, () =>
          room.outline.splice(edge + 1, 0, [snap(p.x - off()[0]), snap(p.z - off()[1])]));
        this.rebuildRooms();
        return edge + 1;
      },
      canDelete: () => room.outline.length > 3,
      onDelete: (i) => {
        reanchorDoorways(this.project, room, () => room.outline.splice(i, 1));
        this.rebuildRooms();
      },
      onEnd: () => this.changed(),
    };
  }

  itemPointSpec(id) {
    const item = this.findItem(id).item;
    const root = () => this.roots.get(id);
    const tmp = new THREE.Vector3();
    return {
      points: () => {
        const r = root();
        r.updateWorldMatrix(true, false);
        return item.points.map(([x, z]) => r.localToWorld(new THREE.Vector3(x, 0.02, z)));
      },
      planeY: () => root().getWorldPosition(tmp).y,
      onDrag: (i, p) => {
        const l = root().worldToLocal(p.clone());
        item.points[i] = [l.x, l.z];
        this.rebuildItem(id);
      },
      onInsert: (edge, p) => {
        const l = root().worldToLocal(p.clone());
        item.points.splice(edge + 1, 0, [l.x, l.z]);
        this.rebuildItem(id);
        return edge + 1;
      },
      canDelete: () => item.points.length > 3,
      onDelete: (i) => { item.points.splice(i, 1); this.rebuildItem(id); },
      onEnd: () => this.changed(),
    };
  }

  deleteSelectedHandle() {
    const spec = this.handles.spec;
    const i = this.handles.selected;
    if (!spec || i < 0) return;
    if (!spec.canDelete()) { this.toast('A shape needs at least 3 corners.'); return; }
    spec.onDelete(i);
    this.handles.selected = -1;
    this.handles.sync();
    this.changed();
    this.emit('structure');
  }

  // ---------- items ----------
  addItem(type) {
    if (type === 'custom') { this.setMode('draw'); return; }
    const room = this.activeRoom;
    const item = type in SHAPE_TYPES ? createShapeItem(type) : createObjectItem(type);
    const [px, pz] = this.placementPoint(room);
    if (type === 'poster' || type === 'screen') {
      // stick to the nearest wall, facing into the room
      const normals = inwardNormals(room.outline);
      let best = null;
      room.outline.forEach((a, i) => {
        const c = closestOnSegment([px, pz], a, room.outline[(i + 1) % room.outline.length]);
        if (!best || c.dist < best.dist) best = { ...c, n: normals[i] };
      });
      const gap = room.wallThickness + (type === 'poster' ? 0.012 : 0.4);
      item.position = [best.point[0] + best.n[0] * gap, item.position[1], best.point[1] + best.n[1] * gap];
      item.rotation = [0, Math.atan2(best.n[0], best.n[1]), 0];
    } else {
      item.position = [px, 0, pz];
    }
    room.items.push(item);
    this.addRoot(room, item);
    this.setMode('select');
    this.select(item.id);
    this.changed();
  }

  /** Room-local floor point under the screen centre, or the room centroid. */
  placementPoint(room) {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
      const local = [snap(hit.x - room.offset[0]), snap(hit.z - room.offset[1])];
      if (pointInPolygon(local, room.outline)) return local;
    }
    return centroid(room.outline);
  }

  deleteSelected() {
    if ((this.mode === 'corners' || this.mode === 'points') && this.handles.selected >= 0) {
      this.deleteSelectedHandle();
      return;
    }
    if (this.selectedDoorId) { this.deleteDoorway(this.selectedDoorId); return; }
    const found = this.selectedId && this.findItem(this.selectedId);
    if (!found) return;
    const { room, item } = found;
    this.deselect(false);
    disposeItem(this.roots.get(item.id));
    this.roots.delete(item.id);
    room.items.splice(room.items.indexOf(item), 1);
    this.emit('structure');
    this.changed();
  }

  duplicateSelected() {
    const found = this.selectedId && this.findItem(this.selectedId);
    if (!found) return;
    const copy = structuredClone(found.item);
    copy.id = uid('item');
    copy.position = [copy.position[0] + 0.3, copy.position[1], copy.position[2] + 0.3];
    found.room.items.push(copy);
    this.addRoot(found.room, copy);
    this.select(copy.id);
    this.changed();
  }

  updateItem(item, patch, rebuild = false) {
    Object.assign(item, patch);
    if (rebuild) {
      this.rebuildItem(item.id);
      if (this.mode === 'points') this.handles.sync();
    } else {
      this.refreshItemFill(item.id);
    }
    this.changed();
  }

  // ---------- doorways ----------
  placeDoorway(wallMesh, point) {
    const { roomId, edge } = wallMesh.userData;
    const room = this.project.rooms.find((r) => r.id === roomId);
    const w = worldOutline(room);
    const a = w[edge], b = w[(edge + 1) % w.length];
    const c = closestOnSegment([point.x, point.z], a, b);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = defaultDoorway(roomId, edge, c.t);
    d.width = Math.min(d.width, Math.max(0.5, len - 0.6));
    d.height = Math.min(d.height, room.wallHeight - 0.1);
    this.project.doorways.push(d);
    this.rebuildRooms();
    this.setMode('select');
    if (this.activeRoomId !== roomId) this.setActiveRoom(roomId);
    this.selectedDoorId = d.id;
    if (doorwayRooms(this.project, d).length < 2) {
      this.toast('Doorway added, but no other room shares this wall yet. Move a room to line them up.');
    }
    this.emit('structure');
    this.changed();
  }

  updateDoorway(d, patch) {
    Object.assign(d, patch);
    this.rebuildRooms();
    this.changed();
  }

  deleteDoorway(id) {
    this.project.doorways = this.project.doorways.filter((d) => d.id !== id);
    if (this.selectedDoorId === id) this.selectedDoorId = null;
    this.rebuildRooms();
    this.emit('structure');
    this.changed();
  }

  // ---------- custom shape drawing ----------
  clearDraw() {
    this.draw.points = [];
    this.updateDrawPreview();
  }

  undoDrawPoint() {
    this.draw.points.pop();
    this.updateDrawPreview();
    this.emit('structure');
  }

  updateDrawPreview() {
    const pts = this.draw.points.map(([x, z]) => new THREE.Vector3(x, 0.04, z));
    const line = pts.length > 2 ? [...pts, pts[0]] : pts;
    this.drawLine.geometry.dispose();
    this.drawLine.geometry = new THREE.BufferGeometry().setFromPoints(line);
    this.drawDots.geometry.dispose();
    this.drawDots.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.requestRender();
  }

  addDrawPoint(e) {
    const p = this.planePoint(e, 0);
    if (!p) return;
    const pts = this.draw.points;
    if (pts.length >= 3) {
      const first = this.toScreen(new THREE.Vector3(pts[0][0], 0, pts[0][1]));
      if (Math.hypot(first[0] - e.clientX, first[1] - e.clientY) < 24) { this.finishDraw(); return; }
    }
    pts.push([snap(p.x), snap(p.z)]);
    this.updateDrawPreview();
    this.emit('structure');
  }

  finishDraw() {
    const room = this.activeRoom;
    const local = this.draw.points.map(([x, z]) => [x - room.offset[0], z - room.offset[1]]);
    if (local.length < 3 || Math.abs(signedArea(local)) < 0.01) {
      this.toast('Tap at least 3 points on the floor to make a shape.');
      return;
    }
    const item = createCustomShape(local, this.draw.height);
    room.items.push(item);
    this.addRoot(room, item);
    this.setMode('select');
    this.select(item.id);
    this.changed();
  }

  // ---------- input ----------
  setupTransformControls() {
    const tc = this.tc;
    tc.addEventListener('mouseDown', () => { this.tcGrab = true; });
    tc.addEventListener('objectChange', () => {
      const obj = tc.object;
      if (!obj) return;
      if (this.mode === 'moveRoom') {
        const room = this.activeRoom;
        obj.position.y = 0;
        room.offset = [obj.position.x, obj.position.z];
        this.rebuildRooms();
        this.emit('roommoved');
      } else if (obj.userData.item) {
        const item = obj.userData.item;
        item.position = obj.position.toArray();
        item.rotation = [obj.rotation.x, obj.rotation.y, obj.rotation.z];
        item.scale = obj.scale.toArray();
        if (this.tcMode === 'scale') applyItemFill(obj);
      }
      this.changed();
    });
  }

  setupPointer() {
    const c = this.canvas;
    // Capture phase so corner handles can claim the pointer before
    // OrbitControls / TransformControls see it.
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e, true));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e, false));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onPointerDown(e) {
    if (this.suspended) return;
    this.pointers.add(e.pointerId);
    if (this.pointers.size > 1) { this.tap = null; return; }
    this.tcGrab = false;
    this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
    if (!this.handles.active) return;
    const hit = this.handles.pick(e.clientX, e.clientY, this.camera, this.canvas.getBoundingClientRect());
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.tap = null;
    let index = hit.index;
    if (hit.type === 'mid') {
      index = this.handles.spec.onInsert(hit.index, this.handles.mids[hit.index].position.clone());
    }
    this.handles.selected = index;
    this.handles.sync();
    this.drag = { id: e.pointerId, index };
    this.orbit.enabled = false;
    this.emit('structure');
    this.requestRender();
  }

  onPointerMove(e) {
    if (this.tap && e.pointerId === this.tap.id &&
        Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > TAP_MOVE_PX) this.tap = null;
    if (this.drag && e.pointerId === this.drag.id) {
      const p = this.planePoint(e, this.handles.spec.planeY());
      if (p) {
        this.handles.spec.onDrag(this.drag.index, p);
        this.handles.sync();
        this.requestRender();
      }
    }
  }

  onPointerUp(e, allowTap) {
    this.pointers.delete(e.pointerId);
    if (this.drag && e.pointerId === this.drag.id) {
      this.drag = null;
      this.orbit.enabled = true;
      this.handles.spec?.onEnd();
      return;
    }
    const tap = this.tap;
    if (tap && tap.id === e.pointerId) {
      this.tap = null;
      if (allowTap && tap.button === 0 && !this.tcGrab && performance.now() - tap.t < TAP_MS) this.onTap(e);
    }
  }

  setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this.suspended || e.target.closest('input, select, textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelected(); e.preventDefault(); }
      else if (e.key === 'Escape') { if (this.mode !== 'select') this.setMode('select'); else this.deselect(); }
      else if (e.key === 'Enter' && this.mode === 'draw') this.finishDraw();
      else if (this.selectedId && this.mode === 'select') {
        const m = { w: 'translate', e: 'rotate', r: 'scale' }[e.key.toLowerCase()];
        if (m) this.setTransformMode(m);
      }
    });
  }

  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  toScreen(v) {
    const r = this.canvas.getBoundingClientRect();
    const p = v.clone().project(this.camera);
    return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
  }

  planePoint(e, y) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out);
  }

  /** Raycast rooms + items; faded (cutaway) walls are skipped. */
  pick(e, { items = true, walls = true, floors = true } = {}) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const targets = [];
    for (const v of this.views.values()) {
      if (floors && v.floor) targets.push(v.floor);
      if (walls) targets.push(...v.walls.children.filter((m) => !m.userData.ghost));
      if (items) targets.push(...v.items.children);
    }
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.item && !o.userData.kind) o = o.parent;
    return o ? { hit, object: o, item: o.userData.item, kind: o.userData.kind, roomId: o.userData.roomId } : null;
  }

  onTap(e) {
    if (this.mode === 'draw') { this.addDrawPoint(e); return; }
    if (this.mode === 'door') {
      const r = this.pick(e, { items: false, floors: false });
      if (r) this.placeDoorway(r.object, r.hit.point);
      else this.toast('Tap a wall to place the doorway.');
      return;
    }
    if (this.mode === 'corners') {
      const r = this.pick(e, { items: false });
      if (r?.kind === 'wall' && r.roomId === this.activeRoomId) {
        const spec = this.handles.spec;
        const p = r.hit.point;
        this.handles.selected = spec.onInsert(r.object.userData.edge, new THREE.Vector3(p.x, 0, p.z));
        this.handles.sync();
        spec.onEnd();
        this.emit('structure');
      }
      return;
    }
    if (this.mode === 'points' || this.mode === 'moveRoom') return;

    const r = this.pick(e);
    if (r?.item) {
      const found = this.findItem(r.item.id);
      if (found.room.id !== this.activeRoomId) this.setActiveRoom(found.room.id);
      this.select(r.item.id);
    } else if (r?.roomId && r.roomId !== this.activeRoomId) {
      this.setActiveRoom(r.roomId);
    } else {
      this.selectedDoorId = null;
      this.deselect();
    }
  }

  // ---------- game mode hand-off ----------
  /** Hide editing aids and stop handling input while game mode runs. */
  suspend() {
    this.setMode('select');
    this.selectedDoorId = null;
    this.deselect(false);
    this.suspended = true;
    this.orbit.enabled = false;
    for (const v of this.views.values()) {
      v.setActive(false);
      v.updateCutaway(this.camera, false); // solid walls in first person
    }
  }

  resume() {
    this.suspended = false;
    this.orbit.enabled = true;
    for (const [id, v] of this.views) {
      v.group.visible = true;
      v.setActive(id === this.activeRoomId);
    }
    this.emit('structure');
    this.requestRender();
  }

  // ---------- per frame ----------
  beforeRender() {
    for (const v of this.views.values()) v.updateCutaway(this.camera, this.cutaway);
    this.handles.updateScale(this.camera, this.canvas.clientHeight);
  }
}

