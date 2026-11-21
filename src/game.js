// Game mode: walk through the scene the studio edits, as your own character
// (third person, default) or through its eyes (first person, V to switch).
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
import { Crowd, createAvatar, DEFAULT_CHARACTER, CHARACTERS, NAME_MAX } from './characters.js';

const SETTINGS_KEY = 'room-studio:game-settings';
const DEFAULT_SETTINGS = { tapToWalk: false, gyro: false, stepUp: true, lookSpeed: 1, view: 'third', character: DEFAULT_CHARACTER, name: '' };
const WALK_SPEED = 2.2;
const RUN_SPEED = 4;
const GRAVITY = 9.8;
const MOUSE_LOOK = 0.0022; // rad per px
const TOUCH_LOOK = 0.0055;
// Third-person camera: orbits a point at the avatar's shoulders.
const CAM_PIVOT = 1.6; // m above the feet (just above the head, so you look over it)
const CAM_DISTANCE = 2.8; // m behind
const CAM_WALL_GAP = 0.2; // stay this far in front of a wall behind the avatar
const CAM_HIDE_AVATAR = 1.0; // closer than this, hide the avatar so it doesn't fill the screen
const SHOWCASE_DISTANCE = 3; // character select: camera this far in front of the avatar

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
    this.avatar = null; // loaded on first entry
    this.avatarYaw = 0;
    this.camDist = CAM_DISTANCE;
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
    this.wallMeshes = [...studio.views.values()].flatMap((v) => v.walls.children);
    this.crowd = new Crowd(studio.roots.values());
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
    this.avatarYaw = this.yaw + Math.PI; // the model faces +z; the camera looks along -z
    this.pitch = this.settings.view === 'third' ? -0.25 : 0;
    this.camDist = CAM_DISTANCE;
    this.ensureAvatar();
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
    if (this.avatar) this.avatar.root.visible = false;
    this.crowd?.restore(); // people go back to where the studio placed them
    for (const v of this.studio.views.values()) v.group.visible = true;
    document.body.dataset.app = 'studio';
    this.setPixelRatio(2);
    this.studio.resume();
    this.onModeChange?.(false);
  }

  // ---------- your character ----------
  ensureAvatar() {
    const want = this.settings.character;
    if (this.avatarCharacter === want) { // loaded, or loading
      this.syncAvatarVisibility();
      return;
    }
    this.avatarCharacter = want;
    createAvatar(want).then((a) => {
      if (this.avatarCharacter !== want) { a.dispose(); return; } // switched again while loading
      if (this.avatar) { // keep the old one's place and facing
        a.root.position.copy(this.avatar.root.position);
        a.root.rotation.copy(this.avatar.root.rotation);
        this.avatar.dispose();
      }
      this.avatar = a;
      a.setName(this.settings.name);
      this.scene.add(a.root);
      this.syncAvatarVisibility();
    }).catch((err) => {
      if (this.avatarCharacter === want) this.avatarCharacter = null; // allow a retry
      console.warn('Avatar failed to load; keeping the current view.', err);
    });
  }

  /** Start screen: step through the characters (dir = 1 or -1). */
  cycleCharacter(dir) {
    const ids = Object.keys(CHARACTERS);
    const i = Math.max(0, ids.indexOf(this.settings.character));
    this.setCharacter(ids[(i + dir + ids.length) % ids.length]);
  }

  /** Character select on the start screen: show the avatar from the front, beside the card. */
  setChoosing(on) {
    this.choosing = on;
    this.camDist = CAM_DISTANCE;
    this.syncAvatarVisibility();
  }

  /** Your name, shown above your character. */
  setName(name) {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (clean === this.settings.name) return;
    this.setSetting('name', clean);
    this.avatar?.setName(clean);
  }

  /** Swap your character (Settings). The old one stays until the new model is ready. */
  setCharacter(id) {
    if (id === this.settings.character) return;
    this.setSetting('character', id);
    this.hud.updateCharacter();
    if (this.avatarCharacter) this.ensureAvatar(); // otherwise it loads on the next entry
  }

  syncAvatarVisibility() {
    if (this.avatar) this.avatar.root.visible = this.active && (this.choosing || this.settings.view === 'third');
    this.hud.updateView();
  }

  setView(view) {
    if (view === this.settings.view) return;
    this.setSetting('view', view);
    this.pitch = view === 'third' ? -0.25 : 0;
    this.camDist = CAM_DISTANCE;
    this.syncAvatarVisibility();
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
    if (this.choosing) { // start screen: arrows pick a character, Enter starts
      if (!down || e.target.closest?.('button')) return;
      if (['ArrowLeft', 'KeyA'].includes(e.code)) this.cycleCharacter(-1);
      else if (['ArrowRight', 'KeyD'].includes(e.code)) this.cycleCharacter(1);
      else if (e.code === 'Enter') this.hud.begin();
      return;
    }
    if (down && e.code === 'KeyV' && !e.repeat) { this.setView(this.settings.view === 'third' ? 'first' : 'third'); return; }
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
    if (this.choosing) {
      if (this.avatar) {
        this.placeShowcaseCamera();
        this.updateAvatar(dt, 0, 0, 0, false);
      }
      this.updateVisibility();
      this.crowd.update(dt, this.pos, this.colliders);
      return;
    }
    const third = this.settings.view === 'third' && this.avatar;
    this.pitch = third ? THREE.MathUtils.clamp(this.pitch, -1.2, 0.35) : THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    const k = this.keys;
    let f = 0, s = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    f -= this.hud.joy.y;
    s += this.hud.joy.x;

    let mx = 0, mz = 0, expected = 0, intent = 0;
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    if (f || s) {
      this.walkTarget = null;
      const len = Math.hypot(f, s);
      if (len > 1) { f /= len; s /= len; }
      intent = Math.min(1, len);
      const speed = (running ? RUN_SPEED : WALK_SPEED) * dt;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      mx = (-sin * f + cos * s) * speed; // forward = (-sin, -cos), right = (cos, -sin)
      mz = (-cos * f - sin * s) * speed;
    } else if (this.walkTarget) {
      const dx = this.walkTarget[0] - this.pos[0], dz = this.walkTarget[1] - this.pos[1];
      const d = Math.hypot(dx, dz);
      if (d < 0.15) this.walkTarget = null;
      else {
        expected = Math.min(d, WALK_SPEED * dt);
        intent = 1;
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
    if (this.crowd.people.length) {
      // People move, so they push the visitor out directly; then re-check walls.
      this.crowd.pushPlayer(this.pos);
      this.pos = moveWithCollision(this.pos, 0, 0, this.feet, step, this.colliders);
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

    if (third) this.placeThirdPersonCamera(dt);
    else {
      this.camera.position.set(this.pos[0], this.feet + PLAYER.eye, this.pos[1]);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
    if (this.avatar) this.updateAvatar(dt, mx, mz, intent, running);
    this.updateVisibility();
    this.crowd.update(dt, this.pos, this.colliders);
  }

  /** Orbit camera behind the avatar; pulls in when a wall is in the way. */
  placeThirdPersonCamera(dt) {
    const pivot = new THREE.Vector3(this.pos[0], this.feet + CAM_PIVOT, this.pos[1]);
    const cp = Math.cos(this.pitch);
    const look = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const back = look.clone().negate();
    this.raycaster.set(pivot, back);
    this.raycaster.far = CAM_DISTANCE + CAM_WALL_GAP;
    const hit = this.raycaster.intersectObjects(this.wallMeshes, false)[0];
    const want = hit ? Math.max(0.35, hit.distance - CAM_WALL_GAP) : CAM_DISTANCE;
    // snap in instantly (never show the inside of a wall), ease back out
    this.camDist = want < this.camDist ? want : this.camDist + (want - this.camDist) * Math.min(1, dt * 4);
    this.camera.position.copy(pivot).addScaledVector(back, this.camDist);
    this.camera.position.y = Math.max(this.camera.position.y, this.feet + 0.25); // not under the floor
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /**
   * Camera in front of the avatar, facing it, shifted so the avatar sits beside
   * the start card: right of it on wide screens, above it on tall ones.
   */
  placeShowcaseCamera() {
    const cam = this.camera;
    const a = this.avatarYaw;
    const front = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)); // the model faces +z
    const wide = cam.aspect > 1.1;
    const chest = new THREE.Vector3(this.pos[0], this.feet + 0.9, this.pos[1]);
    this.raycaster.set(chest, front);
    this.raycaster.far = SHOWCASE_DISTANCE + 2 + CAM_WALL_GAP;
    const hit = this.raycaster.intersectObjects(this.wallMeshes, false)[0];
    let d = SHOWCASE_DISTANCE + (wide ? 0 : 1.5);
    if (hit) d = Math.max(1.2, Math.min(d, hit.distance - CAM_WALL_GAP));
    // move the camera so the avatar lands at (ndcX, ndcY) on screen
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const ndcX = wide ? 0.42 : 0, ndcY = wide ? 0 : 0.42;
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)); // camera right when looking along -front
    cam.position.copy(chest).addScaledVector(front, d)
      .addScaledVector(right, -ndcX * d * tanV * cam.aspect);
    cam.rotation.set(-Math.atan(ndcY * tanV), a, 0); // tilt down rather than sink below the floor
  }

  updateAvatar(dt, mx, mz, intent, running) {
    const a = this.avatar;
    a.root.position.set(this.pos[0], this.feet, this.pos[1]);
    const moving = dt > 0 && Math.hypot(mx, mz) / dt > 0.2;
    if (moving) {
      // turn to face where we're going (the model faces +z)
      let diff = Math.atan2(mx, mz) - this.avatarYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.avatarYaw += diff * Math.min(1, dt * 12);
      a.setMotion(running ? 'run' : 'walk', running ? 1 : intent);
    } else {
      a.setMotion('idle');
    }
    a.root.rotation.y = this.avatarYaw;
    // Backed against a wall the camera sits inside the character's head: hide it until there's room.
    a.root.visible = this.choosing || (this.settings.view === 'third' && this.camDist >= CAM_HIDE_AVATAR);
    a.update(dt);
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
