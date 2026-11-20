// Entry point: renderer, scene, camera, lights, controls and the render loop.
import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Studio } from './studio.js';
import { Game } from './game.js';
import { initRouter } from './router.js';
import { initUI } from './ui/panels.js';
import { newProject, loadAutosave } from './storage.js';

const canvas = document.getElementById('c');
const coarse = window.matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: window.devicePixelRatio < 2, // high-DPI screens don't need MSAA
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfd4db');

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);

scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(6, 12, 8);
scene.add(sun);

const grid = new THREE.GridHelper(80, 80, 0x9aa3ad, 0xb8bfc8);
grid.position.y = -0.09;
grid.raycast = () => {};
scene.add(grid);

// TransformControls is created before OrbitControls so its pointerdown runs
// first and can disable orbiting while an object is being dragged.
const tc = new TransformControls(camera, canvas);
tc.setSize(coarse ? 1.5 : 1);
scene.add(tc.getHelper());

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.minDistance = 1;
orbit.maxDistance = 80;
tc.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });

let dirty = true;
const requestRender = () => { dirty = true; };
orbit.addEventListener('change', requestRender);
tc.addEventListener('change', requestRender);

const studio = new Studio({ scene, camera, renderer, orbit, tc, canvas, requestRender });

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  for (const cam of [camera, game.camera]) {
    cam.aspect = w / Math.max(h, 1);
    cam.updateProjectionMatrix();
  }
  requestRender();
}

// Game mode renders every frame, so phones get a lower pixel ratio there.
function setPixelRatio(max) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, max));
  resize();
}

const game = new Game({ scene, studio, canvas, setPixelRatio });
document.getElementById('btn-play').onclick = () => game.enter();
new ResizeObserver(resize).observe(canvas);

// Block iOS Safari's page pinch-zoom gestures (viewport meta alone isn't enough).
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

// Studio renders only when something changed (saves battery on phones);
// game mode renders continuously.
let last = performance.now();
function frame(now = performance.now()) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.active) {
    game.update(dt);
    renderer.render(scene, game.camera);
    dirty = true; // redraw the studio view once we return
    return;
  }
  const moving = orbit.update();
  if (!dirty && !moving) return;
  dirty = false;
  studio.beforeRender();
  renderer.render(scene, camera);
}

(async () => {
  resize();
  await studio.load(loadAutosave() || newProject());
  initUI(studio);
  initRouter(game); // /studio or /play
  frame();
})();

if (import.meta.env.DEV) Object.assign(window, { studio, game }); // handy for debugging in the console
