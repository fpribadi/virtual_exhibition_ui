// Game mode: first-person walk-through of the same scene the studio edits.
//
// Laptops: WASD/arrows + pointer-lock mouse look. Phones: on-screen joystick +
// swipe look (see ui/gameHud.js). Collision uses 2D footprints (collision.js).
// Only the room the player is in is drawn, plus a neighbour when the doorway
// between them is in view.
import * as THREE from 'three';
import { PLAYER, STEP_HEIGHT, NO_STEP, buildColliders, moveWithCollision, groundAt, freeSpot } from './collision.js';
import { pointInPolygon, centroid } from './geometry.js';
import { worldOutline, doorwayFrame, doorwayRooms } from './rooms.js';
import { GameHud } from './ui/gameHud.js';

const SETTINGS_KEY = 'room-studio:game-settings';
const DEFAULT_SETTINGS = { tapToWalk: false, gyro: false, stepUp: true, lookSpeed: 1 };
const WALK_SPEED = 2.2;
const RUN_SPEED = 4;
const GRAVITY = 9.8;
const MOUSE_LOOK = 0.0022; // rad per px
const TOUCH_LOOK = 0.0055;

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class Game {
  constructor({ scene, studio, canvas, setPixelRatio }) {
    Object.assign(this, { scene, studio, canvas, setPixelRatio });
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.active = false;
    this.locked = false;
    this.touch = window.matchMedia('(pointer: coarse)').matches;
    this.settings = loadSettings();
    this.settings.gyro = false; // motion access needs a fresh tap each session
    this.gyroError = '';
    this.pos = [0, 0];
    this.feet = 0;
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.walkTarget = null;
    this.stuck = 0;
    this.currentRoom = null;
    this.visibleRooms = new Set();
    this.frustum = new THREE.Frustum();
    this.projScreen = new THREE.Matrix4();
    this.raycaster = new THREE.Raycaster();
    this.onModeChange = null; // set by the router: (active) => void
    this.hud = new GameHud(this);
    this.hud.setTouch(this.touch);
    this.onMotion = this.onMotion.bind(this);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (this.active && this.locked) this.addLook(e.movementX, e.movementY, 'mouse');
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.hud.updateHelp();
    });
    // While playing, stop iOS rubber-band scrolling (settings panel excepted).
    document.addEventListener('touchmove', (e) => {
      if (this.active && !e.target.closest('.g-panel')) e.preventDefault();
    }, { passive: false });
  }

  // ---------- enter / exit ----------
  enter() {
    if (this.active) return;
    const studio = this.studio;
    const project = studio.project;
    studio.suspend();
    this.active = true;
    document.body.dataset.app = 'game';

    this.colliders = buildColliders(studio.views, studio.roots);
    this.outlines = project.rooms.map((r) => ({ id: r.id, poly: worldOutline(r) }));
    this.doors = project.doorways.map((d) => {
      const f = doorwayFrame(project, d);
      const rooms = doorwayRooms(project, d).map((r) => r.id);
      if (!f || rooms.length < 2) return null;
      const n = [-f.dir[1], f.dir[0]];
      const pts = [];
      for (const s of [-1, 1]) for (const t of [-1, 1]) for (const y of [0, d.height]) {
        pts.push(new THREE.Vector3(
          f.center[0] + f.dir[0] * (d.width / 2) * s + n[0] * 0.5 * t, y,
          f.center[1] + f.dir[1] * (d.width / 2) * s + n[1] * 0.5 * t));
      }
      return { rooms, box: new THREE.Box3().setFromPoints(pts), center: f.center };
    }).filter(Boolean);

    // Spawn in the middle of the room being edited, facing its doorway.
    const room = studio.activeRoom;
    this.pos = freeSpot(centroid(worldOutline(room)), this.colliders);
    this.feet = 0;
    this.vy = 0;
    this.pitch = 0;
    const door = this.doors.find((d) => d.rooms.includes(room.id));
    this.yaw = door ? Math.atan2(-(door.center[0] - this.pos[0]), -(door.center[1] - this.pos[1])) : 0;
    this.currentRoom = room.id;
    this.keys.clear();
    this.walkTarget = null;

    this.setPixelRatio(this.touch ? 1.5 : 2);
    this.hud.show();
    this.hud.showStart();
    this.update(0);
    this.onModeChange?.(true);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    if (document.pointerLockElement) document.exitPointerLock();
    try { screen.orientation?.unlock?.(); } catch { /* not supported */ }
    this.disableGyro();
    this.settings.gyro = false;
    this.hud.hide();
    for (const v of this.studio.views.values()) v.group.visible = true;
    document.body.dataset.app = 'studio';
    this.setPixelRatio(2);
    this.studio.resume();
    this.onModeChange?.(false);
  }

  // ---------- input ----------
  setTouch(on) {
    this.touch = on;
    this.hud.setTouch(on);
  }

  requestLock() {
    if (this.touch || !this.canvas.requestPointerLock) return;
    try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* unsupported */ }
  }

  onKey(e, down) {
    if (!this.active) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (down && e.code === 'Escape' && !this.locked) { this.exit(); return; }
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  }

  addLook(dx, dy, type) {
    const k = (type === 'mouse' ? MOUSE_LOOK : TOUCH_LOOK) * this.settings.lookSpeed;
    this.yaw -= dx * k;
    this.pitch -= dy * k;
  }

  async setSetting(key, value) {
    if (key === 'gyro') {
      const ok = value ? await this.enableGyro() : (this.disableGyro(), true);
      this.settings.gyro = value && ok;
      return ok;
    }
    this.settings[key] = value;
    try {
      const { gyro, ...persist } = this.settings;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(persist));
    } catch { /* storage unavailable */ }
    return true;
  }

  /** Walk to the floor point under a screen tap (tap-to-walk). */
  walkTo(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.feet), hit)) return;
    if (Math.hypot(hit.x - this.pos[0], hit.z - this.pos[1]) > 30) return;
    this.walkTarget = [hit.x, hit.z];
    this.stuck = 0;
  }

  // ---------- gyroscope look (relative: uses rotation rate, so no calibration) ----------
  async enableGyro() {
    this.gyroError = '';
    if (!window.isSecureContext) {
      this.gyroError = 'Gyroscope needs HTTPS.';
      return false;
    }
    const DM = window.DeviceMotionEvent;
    if (!DM) { this.gyroError = 'This device has no motion sensor.'; return false; }
    if (typeof DM.requestPermission === 'function') {
      try {
        if ((await DM.requestPermission()) !== 'granted') throw new Error();
      } catch {
        this.gyroError = 'Motion access was not allowed.';
        return false;
      }
    }
    this.lastMotion = 0;
    window.addEventListener('devicemotion', this.onMotion);
    return true;
  }

  disableGyro() {
    window.removeEventListener('devicemotion', this.onMotion);
  }

  onMotion(e) {
    const rr = e.rotationRate;
    const now = performance.now();
    const dt = this.lastMotion ? Math.min(0.1, (now - this.lastMotion) / 1000) : 0;
    this.lastMotion = now;
    if (!rr || !this.active || !dt) return;
    const beta = rr.beta || 0, gamma = rr.gamma || 0; // deg/s around device x / y
    const angle = (((screen.orientation?.angle ?? window.orientation ?? 0) % 360) + 360) % 360;
    let yawRate = gamma, pitchRate = beta; // portrait
    if (angle === 90) { yawRate = beta; pitchRate = -gamma; }
    else if (angle === 270) { yawRate = -beta; pitchRate = gamma; }
    else if (angle === 180) { yawRate = -gamma; pitchRate = -beta; }
    const k = THREE.MathUtils.DEG2RAD * dt * this.settings.lookSpeed;
    this.yaw += yawRate * k;
    this.pitch += pitchRate * k;
  }

  // ---------- per frame ----------
  update(dt) {
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    const k = this.keys;
    let f = 0, s = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    f -= this.hud.joy.y;
    s += this.hud.joy.x;

    let mx = 0, mz = 0, expected = 0;
    if (f || s) {
      this.walkTarget = null;
      const len = Math.hypot(f, s);
      if (len > 1) { f /= len; s /= len; }
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN_SPEED : WALK_SPEED) * dt;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      mx = (-sin * f + cos * s) * speed; // forward = (-sin, -cos), right = (cos, -sin)
      mz = (-cos * f - sin * s) * speed;
    } else if (this.walkTarget) {
      const dx = this.walkTarget[0] - this.pos[0], dz = this.walkTarget[1] - this.pos[1];
      const d = Math.hypot(dx, dz);
      if (d < 0.15) this.walkTarget = null;
      else {
        expected = Math.min(d, WALK_SPEED * dt);
        mx = (dx / d) * expected;
        mz = (dz / d) * expected;
      }
    }

    const step = this.settings.stepUp ? STEP_HEIGHT : NO_STEP;
    if (mx || mz) {
      const next = moveWithCollision(this.pos, mx, mz, this.feet, step, this.colliders);
      if (this.walkTarget && expected > 0) {
        const moved = Math.hypot(next[0] - this.pos[0], next[1] - this.pos[1]);
        this.stuck = moved < expected * 0.25 ? this.stuck + dt : 0;
        if (this.stuck > 0.4) this.walkTarget = null; // blocked: give up
      }
      this.pos = next;
    }

    // Step up onto low platforms smoothly; fall back down with gravity.
    const g = groundAt(this.pos, this.feet, step, this.colliders);
    if (g > this.feet) {
      this.feet += (g - this.feet) * Math.min(1, dt * 14);
      if (g - this.feet < 0.005) this.feet = g;
      this.vy = 0;
    } else if (g < this.feet) {
      this.vy -= GRAVITY * dt;
      this.feet = Math.max(g, this.feet + this.vy * dt);
      if (this.feet === g) this.vy = 0;
    }

    this.camera.position.set(this.pos[0], this.feet + PLAYER.eye, this.pos[1]);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.updateVisibility();
  }

  updateVisibility() {
    for (const o of this.outlines) {
      if (pointInPolygon(this.pos, o.poly)) { this.currentRoom = o.id; break; }
    }
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const visible = new Set([this.currentRoom]);
    for (const d of this.doors) {
      if (d.rooms.includes(this.currentRoom) && this.frustum.intersectsBox(d.box)) d.rooms.forEach((id) => visible.add(id));
    }
    for (const [id, v] of this.studio.views) v.group.visible = visible.has(id);
    this.visibleRooms = visible;
  }
}
