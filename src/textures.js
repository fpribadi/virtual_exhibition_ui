// Image uploads, the shared texture cache, and "image fill" materials.
//
// Every uploaded image is resized to max 1024px and stored once in
// project.images (id = content hash). Surfaces that use the same image get
// a Texture clone that shares one THREE.Source, so the GPU upload is shared
// while each surface keeps its own offset/repeat/rotation. When the last
// surface lets go of an image, its cache entry is dropped.
import * as THREE from 'three';

export const MAX_IMAGE_SIZE = 1024;

const images = new Map(); // id -> HTMLImageElement (decoded)
const cache = new Map(); // id -> { base: Texture, refs: number }

export function defaultFill(color = '#cccccc') {
  return {
    color,
    image: null,
    mode: 'cover', // stretch | cover | contain | tile
    tiles: 4,
    bg: '#ffffff',
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
    faces: 'all', // all | top | sides
  };
}

export function resetFillTransform(fill) {
  Object.assign(fill, { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipH: false, flipV: false });
}

function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'img_' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

/** Read an uploaded file, resize to MAX_IMAGE_SIZE, store in project. Returns image id. */
export async function addImageFile(project, file) {
  const url = URL.createObjectURL(file);
  let dataURL;
  try {
    const img = await loadImage(url);
    const s = Math.min(1, MAX_IMAGE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s));
    const h = Math.max(1, Math.round(img.naturalHeight * s));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const type = file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg';
    dataURL = canvas.toDataURL(type, 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
  const id = hash(dataURL);
  project.images[id] = dataURL;
  await ensureImage(id, dataURL);
  return id;
}

export async function ensureImage(id, dataURL) {
  if (images.has(id) || !dataURL) return;
  images.set(id, await loadImage(dataURL));
}

export async function preloadProjectImages(project) {
  await Promise.all(Object.entries(project.images || {}).map(([id, url]) => ensureImage(id, url).catch(() => {})));
}

export function imageAspect(id) {
  const img = images.get(id);
  return img ? img.naturalWidth / img.naturalHeight : 1;
}

function acquire(id) {
  let entry = cache.get(id);
  if (!entry) {
    const base = new THREE.Texture(images.get(id));
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = 4;
    entry = { base, refs: 0 };
    cache.set(id, entry);
  }
  entry.refs++;
  const tex = entry.base.clone(); // shares entry.base.source
  tex.needsUpdate = true;
  return tex;
}

function release(id, tex) {
  tex.dispose();
  const entry = cache.get(id);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.base.dispose();
    cache.delete(id);
  }
}

/** Debug helper: how many distinct images are currently on the GPU via fills. */
export function textureStats() {
  return [...cache.entries()].map(([id, e]) => ({ id, refs: e.refs }));
}

/** Lambert material whose map can be shown "contained" on a background colour. */
export function makeFillMaterial(color = '#cccccc') {
  const m = new THREE.MeshLambertMaterial({ color });
  m.userData.uContain = { value: 0 };
  m.userData.uBg = { value: new THREE.Color('#ffffff') };
  m.userData.imageId = null;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uContain = m.userData.uContain;
    shader.uniforms.uBg = m.userData.uBg;
    shader.fragmentShader = 'uniform float uContain;\nuniform vec3 uBg;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        if ( uContain > 0.5 && ( vMapUv.x < 0.0 || vMapUv.x > 1.0 || vMapUv.y < 0.0 || vMapUv.y > 1.0 ) ) {
          sampledDiffuseColor = vec4( uBg, 1.0 );
        }
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'fill-material';
  return m;
}

/**
 * Apply a fill to a material. surfaceAspect = width / height of the UV area.
 * useImage = false shows only the colour (used for "top"/"sides" face choice).
 * Only texture transforms change here; geometry is never rebuilt.
 */
export function applyFill(mat, fill, surfaceAspect = 1, useImage = true) {
  const wantId = useImage && fill.image && images.has(fill.image) ? fill.image : null;
  if (mat.userData.imageId !== wantId) {
    if (mat.map) release(mat.userData.imageId, mat.map);
    mat.map = wantId ? acquire(wantId) : null;
    mat.userData.imageId = wantId;
    mat.needsUpdate = true;
  }
  mat.color.set(wantId ? '#ffffff' : fill.color);
  mat.userData.uContain.value = wantId && fill.mode === 'contain' ? 1 : 0;
  mat.userData.uBg.value.set(fill.bg || '#ffffff');
  if (!wantId) return;

  const t = mat.map;
  const ia = imageAspect(wantId);
  const sa = Math.max(surfaceAspect, 1e-4);
  let rx = 1, ry = 1;
  if (fill.mode === 'cover') {
    if (ia > sa) rx = sa / ia; else ry = ia / sa;
  } else if (fill.mode === 'contain') {
    if (ia > sa) ry = ia / sa; else rx = sa / ia;
  } else if (fill.mode === 'tile') {
    const n = Math.max(1, fill.tiles || 1);
    rx = n; ry = (n * ia) / sa;
  }
  const s = Math.max(0.05, fill.scale || 1);
  rx /= s; ry /= s;
  if (fill.flipH) rx = -rx;
  if (fill.flipV) ry = -ry;

  const wrap = fill.mode === 'tile' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (t.wrapS !== wrap) {
    t.wrapS = t.wrapT = wrap;
    t.needsUpdate = true;
  }
  t.center.set(0.5, 0.5);
  t.repeat.set(rx, ry);
  t.offset.set(fill.offsetX || 0, fill.offsetY || 0);
  t.rotation = THREE.MathUtils.degToRad(fill.rotation || 0);
}

export function disposeFillMaterial(mat) {
  if (mat.map) release(mat.userData.imageId, mat.map);
  mat.map = null;
  mat.dispose();
}

/** Drop images no surface references (called before saving). */
export function collectUsedImages(project) {
  const used = new Set();
  const visit = (f) => f && f.image && used.add(f.image);
  for (const r of project.rooms) {
    visit(r.floorFill); visit(r.wallFill);
    for (const it of r.items) visit(it.fill);
  }
  const out = {};
  for (const id of used) if (project.images[id]) out[id] = project.images[id];
  return out;
}
