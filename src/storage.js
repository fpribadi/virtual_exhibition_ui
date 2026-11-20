// Project creation, JSON save/load, and a best-effort local autosave.
import { defaultRoom, defaultDoorway } from './rooms.js';
import { defaultFill, collectUsedImages } from './textures.js';
import defaultProjectData from './default-project.json';

export const FORMAT_VERSION = 1;
const AUTOSAVE_KEY = 'room-studio:autosave';

/** The starting project: the designed layout in default-project.json. */
export function newProject() {
  return normalizeProject(structuredClone(defaultProjectData));
}

/** Two plain rectangular rooms joined by a doorway (fallback / reference). */
export function blankProject() {
  const a = defaultRoom('Room A', 0);
  const b = defaultRoom('Room B', 6);
  // Room A edge 1 runs along x = 3, which Room B's left edge shares.
  return { version: FORMAT_VERSION, rooms: [a, b], doorways: [defaultDoorway(a.id, 1)], images: {} };
}

/** Fill in missing fields so older or hand-edited files still load. */
export function normalizeProject(p) {
  if (!p || !Array.isArray(p.rooms) || p.rooms.length === 0) throw new Error('This file has no rooms.');
  if (p.version > FORMAT_VERSION) throw new Error('This file was made by a newer version of Room Studio.');
  p.version = FORMAT_VERSION;
  p.images = p.images || {};
  p.doorways = Array.isArray(p.doorways) ? p.doorways : [];
  const fill = (f, color) => Object.assign(defaultFill(color), f || {});
  p.rooms = p.rooms.map((r, i) => {
    const base = defaultRoom(r.name || `Room ${i + 1}`, i * 6);
    const room = Object.assign(base, r);
    room.floorFill = fill(r.floorFill, base.floorFill.color);
    room.wallFill = fill(r.wallFill, base.wallFill.color);
    room.items = (r.items || []).map((it) => ({
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...it, fill: fill(it.fill, '#cccccc'),
    }));
    return room;
  });
  return p;
}

export function serialize(project) {
  return JSON.stringify({ ...project, images: collectUsedImages(project) });
}

export function downloadProject(project) {
  const blob = new Blob([serialize(project)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'room-studio.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readProjectFile(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  return normalizeProject(data);
}

let saveTimer = null;
let warned = false;
export function scheduleAutosave(project, onError) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(project));
    } catch {
      if (!warned) { warned = true; onError?.('Autosave skipped (project too large for browser storage). Use Save.'); }
    }
  }, 800);
}

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/* global __BUILD_ID__ */
const BUILD_KEY = 'room-studio:build';
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * Called once at startup. If this is a new release since the browser's last
 * visit, delete the old autosave so the new default layout loads.
 * Returns true when an older release's autosave was cleared.
 */
export function checkRelease() {
  try {
    const seen = localStorage.getItem(BUILD_KEY);
    if (seen === BUILD_ID) return false;
    const hadAutosave = localStorage.getItem(AUTOSAVE_KEY) !== null;
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.setItem(BUILD_KEY, BUILD_ID);
    return seen !== null && hadAutosave;
  } catch {
    return false; // storage blocked: nothing cached anyway
  }
}

export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}
