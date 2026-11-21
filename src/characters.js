// Phase 3: animated characters — the visitor's own avatar in the walk-through,
// plus optional people placed in the studio.
//
// Each character's GLB (public/models, CC0) and GLTFLoader are only fetched the
// first time that character is used, so unused models are never downloaded.
// Every person is a SkeletonUtils clone of one shared asset per character
// (geometry shared, own skeleton + AnimationMixer).
//
// Studio: people stand in their idle pose. Game: Crowd animates them — idle or
// walking back and forth — and they turn and wave when the visitor comes close.
import * as THREE from 'three';
import { moveWithCollision, NO_STEP, PLAYER } from './collision.js';

export const PERSON = {
    height: 1.7, // every model is scaled to this height
    radius: 0.3,
    walkSpeed: 0.9,
    waveDistance: 2.2, // start waving when the visitor is this close (m)
    resetDistance: 3.5, // visitor must step this far away before the next wave
};

// Characters you can pick for your avatar and for placed people. All CC0;
// see public/models/CREDITS.md. Urls are relative to the page, so they work
// under a sub-path (/v1/) too. `tint` names the material the Colour setting
// recolours (textured models have none). `waveRepeat` loops short greetings.
const KENNEY_CLIPS = {
    idle: 'idle',
    walk: 'walk',
    run: 'sprint',
    wave: 'emote-yes',
};
const female = (l) => ({
    label: `Female ${l.toUpperCase()}`,
    url: `models/characters/character-female-${l}.glb`,
    clips: KENNEY_CLIPS,
    waveRepeat: 2,
});
export const CHARACTERS = {
    robot: {
        label: 'Robot',
        url: 'models/person.glb',
        clips: { idle: 'Idle', walk: 'Walking', run: 'Running', wave: 'Wave' },
        tint: 'Main',
        waveRepeat: 1,
    },
    'female-a': female('a'),
    'female-b': female('b'),
    'female-c': female('c'),
    'female-d': female('d'),
    'female-e': female('e'),
    'female-f': female('f'),
};
export const DEFAULT_CHARACTER = 'robot';
const charId = (id) => (CHARACTERS[id] ? id : DEFAULT_CHARACTER);
/** [id, label] pairs for a select field. */
export const characterOptions = () =>
    Object.entries(CHARACTERS).map(([id, c]) => [id, c.label]);
/** Whether the Colour setting does anything for this character. */
export const isTintable = (id) => !!CHARACTERS[charId(id)].tint;

const assets = new Map(); // character id -> Promise<asset>
let onModelReady = () => {};

/** Called after a model finishes loading so the (on-demand) studio view redraws. */
export function setModelReadyCallback(fn) {
    onModelReady = fn;
}

function loadAsset(id) {
    const key = charId(id);
    if (!assets.has(key)) {
        const def = CHARACTERS[key];
        const p = (async () => {
            const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([
                import('three/addons/loaders/GLTFLoader.js'),
                import('three/addons/utils/SkeletonUtils.js'),
            ]);
            const gltf = await new GLTFLoader().loadAsync(
                new URL(def.url, document.baseURI).href,
            );
            const size = new THREE.Box3()
                .setFromObject(gltf.scene)
                .getSize(new THREE.Vector3());
            gltf.scene.traverse((o) => {
                if (o.isMesh) o.geometry.userData.shared = true; // owned by the asset, never disposed per person
            });
            return {
                def,
                scene: gltf.scene,
                clips: gltf.animations,
                scale: PERSON.height / size.y,
                clone: SkeletonUtils.clone,
            };
        })();
        p.catch(() => assets.delete(key)); // allow a retry after a network error
        assets.set(key, p);
    }
    return assets.get(key);
}

/** One animated copy of the asset with its own tinted material and mixer. */
function instantiate(asset, color) {
    const model = asset.clone(asset.scene);
    model.scale.setScalar(asset.scale);
    const tinted = new Map(); // one clone of the tint material per copy, so colours are independent
    model.traverse((o) => {
        if (!o.isMesh) return;
        o.raycast = () => {}; // picking uses a proxy box; skinned raycasts are slow
        if (asset.def.tint && o.material.name === asset.def.tint) {
            if (!tinted.has(o.material))
                tinted.set(o.material, o.material.clone());
            o.material = tinted.get(o.material);
        }
    });
    const mats = [...tinted.values()];
    if (color) mats.forEach((m) => m.color.set(color));
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    const n = asset.def.waveRepeat || 1;
    for (const [key, name] of Object.entries(asset.def.clips)) {
        const clip = THREE.AnimationClip.findByName(asset.clips, name);
        if (clip) actions[key] = mixer.clipAction(clip);
    }
    if (actions.wave) {
        actions.wave.setLoop(n > 1 ? THREE.LoopRepeat : THREE.LoopOnce, n);
        actions.wave.clampWhenFinished = true;
    }
    const waveTime = actions.wave ? actions.wave.getClip().duration * n : 0;
    return { model, mats, mixer, actions, waveTime };
}

/**
 * The visitor's own character in the walk-through. Loads the model on first
 * use. The game moves `root` and calls setMotion()/update() every frame.
 */
export async function createAvatar(character = DEFAULT_CHARACTER) {
    const asset = await loadAsset(character);
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
            if (a)
                a.timeScale =
                    state === 'idle'
                        ? 1
                        : THREE.MathUtils.clamp(speed, 0.4, 1.2);
        },
        update(dt) {
            mixer.update(dt);
        },
        /** Floating name above the head; an empty name removes it. */
        setName(name) {
            disposeNameTag(root.userData.nameTag);
            root.userData.nameTag = name ? makeNameTag(name) : null;
            if (root.userData.nameTag) root.add(root.userData.nameTag);
        },
        dispose() {
            disposeNameTag(root.userData.nameTag);
            mixer.stopAllAction();
            mixer.uncacheRoot(model);
            root.removeFromParent();
        },
    };
}

export const NAME_MAX = 24;
const TAG_HEIGHT = 0.24; // m

/** A camera-facing label: the name drawn on a canvas, shown on a Sprite. */
function makeNameTag(name) {
    const text = name.slice(0, NAME_MAX);
    const px = 64; // font size on the canvas; the sprite is scaled to TAG_HEIGHT
    const pad = px * 0.45;
    const font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2);
    canvas.height = Math.ceil(px + pad * 1.2);
    ctx.font = font; // resizing the canvas resets the context
    ctx.fillStyle = 'rgba(15, 17, 21, 0.65)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + px * 0.04);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    sprite.scale.set((TAG_HEIGHT * canvas.width) / canvas.height, TAG_HEIGHT, 1);
    sprite.position.y = PERSON.height + 0.28;
    sprite.renderOrder = 10;
    sprite.raycast = () => {}; // never picked (sprite raycasts need a camera)
    return sprite;
}

function disposeNameTag(sprite) {
    if (!sprite) return;
    sprite.material.map.dispose();
    sprite.material.dispose();
    sprite.removeFromParent();
}

// Invisible box used for selecting and collision (the bind pose has arms out,
// so the model's own bounds would be ~3 m wide).
const proxyGeo = new THREE.BoxGeometry(0.6, PERSON.height, 0.45).translate(
    0,
    PERSON.height / 2,
    0,
);
proxyGeo.userData.shared = true;
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

export function buildPerson(item, root) {
    root.add(new THREE.Mesh(proxyGeo, proxyMat));
    root.userData.colorMats = [];
    root.userData.plainMats = [];

    loadAsset(item.model)
        .then((asset) => {
            if (root.userData.disposed) return;
            const { model, mats, mixer, actions, waveTime } = instantiate(
                asset,
                item.fill.color,
            );
            root.userData.colorMats = mats;
            root.userData.plainMats = mats;
            Object.assign(root.userData, {
                model,
                mixer,
                actions,
                waveTime,
                current: null,
            });
            root.add(model);
            poseIdle(root);
            onModelReady();
        })
        .catch((err) => {
            console.warn('Person model failed to load:', err);
            if (root.userData.disposed) return;
            // Visible fallback so the person can still be placed and selected.
            const mat = new THREE.MeshLambertMaterial({
                color: item.fill.color,
            });
            root.add(
                new THREE.Mesh(
                    new THREE.CapsuleGeometry(0.25, 1.2, 4, 8).translate(
                        0,
                        0.85,
                        0,
                    ),
                    mat,
                ),
            );
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
                root,
                item,
                start: {
                    pos: root.position.clone(),
                    rot: root.rotation.clone(),
                },
                home,
                away: [
                    home[0] + Math.sin(yaw) * dist,
                    home[1] + Math.cos(yaw) * dist,
                ], // the model faces +z
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
            const dx = pos[0] - _w.x,
                dz = pos[1] - _w.z;
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
            const dx = playerPos[0] - _w.x,
                dz = playerPos[1] - _w.z;
            const dist = Math.hypot(dx, dz);

            if (item.wave !== false) {
                if (dist > PERSON.resetDistance) p.canWave = true;
                if (
                    p.state !== 'wave' &&
                    p.canWave &&
                    dist < PERSON.waveDistance &&
                    root.userData.actions.wave
                ) {
                    p.state = 'wave';
                    p.canWave = false;
                    p.waveLeft = root.userData.waveTime;
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
        const tx = target[0] - root.position.x,
            tz = target[1] - root.position.z;
        if (Math.hypot(tx, tz) < 0.15) {
            p.goingAway = !p.goingAway;
            p.pause = 1.2; // look around for a moment at each end
            return;
        }
        if (playerDist < PLAYER.radius + PERSON.radius + 0.25) {
            // politely wait for the visitor
            fadeTo(root, 'idle');
            return;
        }
        fadeTo(root, 'walk');
        turnToward(root, Math.atan2(tx, tz), 4, dt);
        const step = PERSON.walkSpeed * dt;
        const mx = Math.sin(root.rotation.y) * step,
            mz = Math.cos(root.rotation.y) * step;
        const off = root.parent.parent.position; // room offset (rooms are never rotated)
        const world = [root.position.x + off.x, root.position.z + off.z];
        const next = moveWithCollision(
            world,
            mx,
            mz,
            0,
            NO_STEP,
            colliders,
            PERSON.radius,
        );
        const moved = Math.hypot(next[0] - world[0], next[1] - world[1]);
        root.position.x = next[0] - off.x;
        root.position.z = next[1] - off.z;
        p.stuck = moved < step * 0.3 ? p.stuck + dt : 0;
        if (p.stuck > 0.6) {
            // blocked by a wall or object: head back
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
