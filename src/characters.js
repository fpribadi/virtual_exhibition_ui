// Phase 3: animated characters — the visitor's own avatar in the walk-through,
// plus optional people placed in the studio.
//
// The GLB (public/models/person.glb, CC0) and GLTFLoader are only fetched the
// first time a person exists in the project, so projects without people never
// download them. Every person is a SkeletonUtils clone of one shared asset
// (geometry shared, own skeleton + AnimationMixer).
//
// Studio: people stand in their idle pose. Game: Crowd animates them — idle or
// walking back and forth — and they turn and wave when the visitor comes close.
import * as THREE from 'three';
import { moveWithCollision, NO_STEP, PLAYER } from './collision.js';

export const PERSON = {
  url: 'models/person.glb', // relative to the page, so it works under /v1/ too
  height: 1.7,
  radius: 0.3,
  walkSpeed: 0.9,
  waveDistance: 2.2, // start waving when the visitor is this close (m)
  resetDistance: 3.5, // visitor must step this far away before the next wave
  clips: { idle: 'Idle', walk: 'Walking', run: 'Running', wave: 'Wave' },
};

let assetPromise = null;
let onModelReady = () => {};

/** Called after a model finishes loading so the (on-demand) studio view redraws. */
export function setModelReadyCallback(fn) {
  onModelReady = fn;
}

function loadAsset() {
  assetPromise ??= (async () => {
    const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/utils/SkeletonUtils.js'),
    ]);
    const gltf = await new GLTFLoader().loadAsync(new URL(PERSON.url, document.baseURI).href);
    const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    gltf.scene.traverse((o) => {
      if (o.isMesh) o.geometry.userData.shared = true; // owned by the asset, never disposed per person
    });
    return { scene: gltf.scene, clips: gltf.animations, scale: PERSON.height / size.y, clone: SkeletonUtils.clone };
  })();
  return assetPromise;
}

/** One animated copy of the asset with its own tinted "Main" material and mixer. */
function instantiate(asset, color) {
  const model = asset.clone(asset.scene);
  model.scale.setScalar(asset.scale);
  const tinted = new Map(); // one clone of the "Main" material per copy, so colours are independent
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.raycast = () => {}; // picking uses a proxy box; skinned raycasts are slow
    if (o.material.name === 'Main') {
      if (!tinted.has(o.material)) tinted.set(o.material, o.material.clone());
      o.material = tinted.get(o.material);
    }
  });
  const mats = [...tinted.values()];
  if (color) mats.forEach((m) => m.color.set(color));
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [key, name] of Object.entries(PERSON.clips)) {
    const clip = THREE.AnimationClip.findByName(asset.clips, name);
    if (clip) actions[key] = mixer.clipAction(clip);
  }
  if (actions.wave) {
    actions.wave.setLoop(THREE.LoopOnce, 1);
    actions.wave.clampWhenFinished = true;
  }
  return { model, mats, mixer, actions };
}

/**
 * The visitor's own character in the walk-through. Loads the model on first
 * use. The game moves `root` and calls setMotion()/update() every frame.
 */
export async function createAvatar() {
  const asset = await loadAsset();
  const root = new THREE.Group();
  const { model, mixer, actions } = instantiate(asset);
  root.add(model);
  root.userData = { model, mixer, actions, current: null };
  poseIdle(root);
  return {
    root,
    /** 'idle' | 'walk' | 'run'; speed (0..1) scales the walk cycle for half-pushed joysticks. */
    setMotion(state, speed = 1) {
      fadeTo(root, actions[state] ? state : 'walk', 0.2);
      const a = actions[root.userData.current];
      if (a) a.timeScale = state === 'idle' ? 1 : THREE.MathUtils.clamp(speed, 0.4, 1.2);
    },
    update(dt) { mixer.update(dt); },
  };
}

// Invisible box used for selecting and collision (the bind pose has arms out,
// so the model's own bounds would be ~3 m wide).
const proxyGeo = new THREE.BoxGeometry(0.6, PERSON.height, 0.45).translate(0, PERSON.height / 2, 0);
proxyGeo.userData.shared = true;
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

export function buildPerson(item, root) {
  root.add(new THREE.Mesh(proxyGeo, proxyMat));
  root.userData.colorMats = [];
  root.userData.plainMats = [];

  loadAsset().then((asset) => {
    if (root.userData.disposed) return;
    const { model, mats, mixer, actions } = instantiate(asset, item.fill.color);
    root.userData.colorMats = mats;
    root.userData.plainMats = mats;
    Object.assign(root.userData, { model, mixer, actions, current: null });
    root.add(model);
    poseIdle(root);
    onModelReady();
  }).catch((err) => {
    console.warn('Person model failed to load:', err);
    if (root.userData.disposed) return;
    // Visible fallback so the person can still be placed and selected.
    const mat = new THREE.MeshLambertMaterial({ color: item.fill.color });
    root.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 4, 8).translate(0, 0.85, 0), mat));
    root.userData.colorMats = [mat];
    root.userData.plainMats = [mat];
    onModelReady();
  });
}

export function disposePerson(root) {
  root.userData.disposed = true;
  const { mixer, model } = root.userData;
  if (mixer) {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
  }
}

/** Reset to the first frame of Idle (used in the studio and when leaving the game). */
function poseIdle(root) {
  const { mixer, actions } = root.userData;
  if (!mixer) return;
  mixer.stopAllAction();
  actions.idle?.reset().play();
  root.userData.current = 'idle';
  mixer.update(0);
}

function fadeTo(root, key, duration = 0.25) {
  const ud = root.userData;
  if (ud.current === key || !ud.actions[key]) return;
  const next = ud.actions[key];
  next.reset().setEffectiveWeight(1).fadeIn(duration).play();
  ud.actions[ud.current]?.fadeOut(duration);
  ud.current = key;
}

/** Turn root.rotation.y toward `target` at up to `rate` rad/s. */
function turnToward(root, target, rate, dt) {
  let diff = target - root.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const step = Math.min(Math.abs(diff), rate * dt);
  root.rotation.y += Math.sign(diff) * step;
}

const _w = new THREE.Vector3();

/** Drives every person while game mode runs. */
export class Crowd {
  constructor(roots) {
    this.people = [];
    for (const root of roots) {
      const item = root.userData.item;
      if (item.type !== 'person') continue;
      const yaw = root.rotation.y;
      const home = [root.position.x, root.position.z];
      const dist = item.patrol ?? 3;
      this.people.push({
        root, item,
        start: { pos: root.position.clone(), rot: root.rotation.clone() },
        home,
        away: [home[0] + Math.sin(yaw) * dist, home[1] + Math.cos(yaw) * dist], // the model faces +z
        goingAway: true,
        pause: 0,
        stuck: 0,
        state: 'idle',
        waveLeft: 0,
        canWave: true,
      });
    }
  }

  /** Keep the visitor out of each person's circle (people move, so they aren't static colliders). */
  pushPlayer(pos) {
    const min = PLAYER.radius + PERSON.radius;
    for (const p of this.people) {
      p.root.getWorldPosition(_w);
      const dx = pos[0] - _w.x, dz = pos[1] - _w.z;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 1e-6) {
        pos[0] = _w.x + (dx / d) * min;
        pos[1] = _w.z + (dz / d) * min;
      }
    }
  }

  update(dt, playerPos, colliders) {
    for (const p of this.people) {
      const { root, item } = p;
      const room = root.parent?.parent;
      if (!root.userData.mixer || (room && !room.visible)) continue; // not loaded yet, or not drawn

      root.getWorldPosition(_w);
      const dx = playerPos[0] - _w.x, dz = playerPos[1] - _w.z;
      const dist = Math.hypot(dx, dz);

      if (item.wave !== false) {
        if (dist > PERSON.resetDistance) p.canWave = true;
        if (p.state !== 'wave' && p.canWave && dist < PERSON.waveDistance && root.userData.actions.wave) {
          p.state = 'wave';
          p.canWave = false;
          p.waveLeft = root.userData.actions.wave.getClip().duration;
          fadeTo(root, 'wave', 0.2);
        }
      }

      if (p.state === 'wave') {
        turnToward(root, Math.atan2(dx, dz), 5, dt); // face the visitor while waving
        p.waveLeft -= dt;
        if (p.waveLeft <= 0.15) p.state = 'idle';
      } else if (item.behavior === 'patrol') {
        this.patrol(p, dt, dist, colliders);
      } else {
        fadeTo(root, 'idle');
      }
      root.userData.mixer.update(dt);
    }
  }

  patrol(p, dt, playerDist, colliders) {
    const { root } = p;
    if (p.pause > 0) {
      p.pause -= dt;
      fadeTo(root, 'idle');
      return;
    }
    const target = p.goingAway ? p.away : p.home;
    const tx = target[0] - root.position.x, tz = target[1] - root.position.z;
    if (Math.hypot(tx, tz) < 0.15) {
      p.goingAway = !p.goingAway;
      p.pause = 1.2; // look around for a moment at each end
      return;
    }
    if (playerDist < PLAYER.radius + PERSON.radius + 0.25) { // politely wait for the visitor
      fadeTo(root, 'idle');
      return;
    }
    fadeTo(root, 'walk');
    turnToward(root, Math.atan2(tx, tz), 4, dt);
    const step = PERSON.walkSpeed * dt;
    const mx = Math.sin(root.rotation.y) * step, mz = Math.cos(root.rotation.y) * step;
    const off = root.parent.parent.position; // room offset (rooms are never rotated)
    const world = [root.position.x + off.x, root.position.z + off.z];
    const next = moveWithCollision(world, mx, mz, 0, NO_STEP, colliders, PERSON.radius);
    const moved = Math.hypot(next[0] - world[0], next[1] - world[1]);
    root.position.x = next[0] - off.x;
    root.position.z = next[1] - off.z;
    p.stuck = moved < step * 0.3 ? p.stuck + dt : 0;
    if (p.stuck > 0.6) { // blocked by a wall or object: head back
      p.goingAway = !p.goingAway;
      p.stuck = 0;
      p.pause = 0.6;
    }
  }

  /** Put everyone back where the studio placed them. */
  restore() {
    for (const p of this.people) {
      p.root.position.copy(p.start.pos);
      p.root.rotation.copy(p.start.rot);
      poseIdle(p.root);
    }
  }
}
