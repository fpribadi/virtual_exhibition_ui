// Panels: room tabs, library, room settings, properties, mode hint bar and
// the mobile bottom drawer. Re-rendered on studio 'structure' events.
import { h, slider, numberField, button, segmented } from './dom.js';
import { fillEditor } from './fillEditor.js';
import { SHAPE_TYPES, isPointShape } from '../shapes.js';
import { OBJECT_TYPES, hasImageFill, itemLabel } from '../objects.js';
import { doorwayRooms, doorwayFrame } from '../rooms.js';
import { newProject, downloadProject, readProjectFile, clearAutosave } from '../storage.js';

const $ = (sel) => document.querySelector(sel);
const mobileQuery = window.matchMedia('(max-width: 760px), (max-height: 500px)');

export function initUI(studio) {
  const toast = (msg) => {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 3200);
  };
  studio.addEventListener('toast', (e) => toast(e.detail));

  renderLibrary(studio);
  setupTopbar(studio, toast);
  setupDrawer(studio);

  let lastSelection = null;
  let lastMode = 'select';
  const renderAll = () => {
    renderTabs(studio);
    renderRoom(studio, toast);
    renderProps(studio, toast);
    renderHint(studio);
    const sel = studio.selectedId || studio.selectedDoorId;
    if (sel && sel !== lastSelection) {
      setMobileTab(studio.selectedDoorId ? 'room' : 'edit', false);
    }
    if (studio.mode !== lastMode && studio.mode !== 'select' && mobileQuery.matches) setDrawer(false);
    lastSelection = sel;
    lastMode = studio.mode;
  };
  studio.addEventListener('structure', renderAll);

  let raf = 0;
  studio.addEventListener('roommoved', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => renderRoom(studio, toast));
  });
  renderAll();
}

// ---------- top bar ----------
function setupTopbar(studio, toast) {
  const cut = $('#btn-cutaway');
  const syncCut = () => cut.classList.toggle('on', studio.cutaway);
  cut.onclick = () => { studio.cutaway = !studio.cutaway; syncCut(); studio.requestRender(); };
  syncCut();

  $('#btn-save').onclick = () => { downloadProject(studio.project); toast('Saved room-studio.json'); };
  const fileOpen = $('#file-open');
  $('#btn-open').onclick = () => fileOpen.click();
  fileOpen.onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await studio.load(await readProjectFile(file));
      toast('Project loaded.');
    } catch (err) {
      toast(err.message || 'Could not open that file.');
    }
  };
  $('#btn-new').onclick = async () => {
    if (!confirm('Start a new project? Unsaved changes will be lost.')) return;
    clearAutosave();
    await studio.load(newProject());
  };

  const fs = $('#btn-fullscreen');
  const root = document.documentElement;
  const canFs = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (!canFs) fs.hidden = true;
  fs.onclick = () => {
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (root.requestFullscreen || root.webkitRequestFullscreen).call(root)?.catch?.(() => {});
  };
  const syncFs = () => fs.classList.toggle('on', !!(document.fullscreenElement || document.webkitFullscreenElement));
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);
}

function renderTabs(studio) {
  $('#room-tabs').replaceChildren(...studio.project.rooms.map((room) =>
    h('button', {
      type: 'button',
      class: 'tab' + (room.id === studio.activeRoomId ? ' on' : ''),
      title: 'Double-click to rename',
      onClick: () => studio.setActiveRoom(room.id, true),
      onDblclick: () => {
        const name = prompt('Room name', room.name);
        if (name && name.trim()) { room.name = name.trim(); studio.changed(); studio.emit('structure'); }
      },
    }, room.name)));
}

// ---------- library ----------
function renderLibrary(studio) {
  const btn = (type, label) => button(label, () => studio.addItem(type), 'lib');
  $('#library').replaceChildren(
    h('h3', {}, 'Shapes'),
    h('div', { class: 'grid' },
      btn('box', 'Box'), btn('cylinder', 'Cylinder'), btn('sphere', 'Sphere'),
      btn('triangle', 'Triangle'), btn('custom', 'Custom…')),
    h('h3', {}, 'Objects'),
    h('div', { class: 'grid' },
      btn('poster', OBJECT_TYPES.poster.label), btn('table', OBJECT_TYPES.table.label),
      btn('stage', SHAPE_TYPES.stage.label), btn('projector', OBJECT_TYPES.projector.label),
      btn('screen', 'Screen')),
  );
}

// ---------- room panel ----------
function renderRoom(studio, toast) {
  const room = studio.activeRoom;
  if (!room) return;
  const project = studio.project;
  const onFill = () => studio.refreshRoomFills(room);

  const doors = project.doorways.filter((d) => doorwayRooms(project, d).some((r) => r.id === room.id) || d.roomId === room.id);
  const doorList = doors.map((d, i) => {
    const rooms = doorwayRooms(project, d);
    const f = doorwayFrame(project, d);
    const anchor = f?.room || room;
    const maxW = Math.max(0.5, Math.min(4, (f?.edgeLength || 4) - 0.3));
    return h('div', { class: 'door' + (d.id === studio.selectedDoorId ? ' on' : '') },
      h('div', { class: 'door-title' },
        h('strong', {}, `Doorway ${i + 1}`),
        h('span', { class: rooms.length < 2 ? 'warn' : 'muted' },
          rooms.length < 2 ? 'Not on a shared wall' : rooms.map((r) => r.name).join(' ↔ '))),
      slider('Position', d.t, { min: 0, max: 1, onInput: (v) => studio.updateDoorway(d, { t: v }) }),
      slider('Width', d.width, { min: 0.5, max: maxW, onInput: (v) => studio.updateDoorway(d, { width: v }) }),
      slider('Height', d.height, { min: 1.5, max: Math.max(1.6, anchor.wallHeight), onInput: (v) => studio.updateDoorway(d, { height: v }) }),
      h('div', { class: 'row buttons' }, button('Delete doorway', () => studio.deleteDoorway(d.id), 'danger')),
    );
  });

  $('#sec-room').replaceChildren(
    h('h2', {}, 'Room'),
    h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Name'),
      h('input', {
        type: 'text', value: room.name, maxlength: 40,
        onChange: (e) => { room.name = e.target.value.trim() || room.name; studio.changed(); renderTabs(studio); },
      })),
    h('div', { class: 'row2' },
      numberField('X', room.offset[0], { onChange: (v) => studio.updateRoom(room, { offset: [v, room.offset[1]] }) }),
      numberField('Z', room.offset[1], { onChange: (v) => studio.updateRoom(room, { offset: [room.offset[0], v] }) }),
    ),
    h('div', { class: 'row buttons' },
      button(studio.mode === 'moveRoom' ? 'Done moving' : 'Move room',
        () => studio.setMode(studio.mode === 'moveRoom' ? 'select' : 'moveRoom'), studio.mode === 'moveRoom' ? 'on' : ''),
      button(studio.mode === 'corners' ? 'Done editing' : 'Edit corners',
        () => studio.setMode(studio.mode === 'corners' ? 'select' : 'corners'), studio.mode === 'corners' ? 'on' : ''),
    ),
    slider('Wall height', room.wallHeight, { min: 1.5, max: 6, step: 0.05, onInput: (v) => studio.updateRoom(room, { wallHeight: v }) }),
    slider('Thickness', room.wallThickness, { min: 0.05, max: 0.5, onInput: (v) => studio.updateRoom(room, { wallThickness: v }) }),
    h('h3', {}, 'Doorways'),
    ...doorList,
    h('div', { class: 'row buttons' },
      button(studio.mode === 'door' ? 'Cancel' : '+ Add doorway',
        () => studio.setMode(studio.mode === 'door' ? 'select' : 'door'), studio.mode === 'door' ? 'on' : '')),
    h('details', { open: !!room.floorFill.image }, h('summary', {}, 'Floor'),
      fillEditor({ fill: room.floorFill, project, onChange: onFill, toast })),
    h('details', { open: !!room.wallFill.image }, h('summary', {}, 'Walls'),
      fillEditor({ fill: room.wallFill, project, onChange: onFill, toast })),
  );
}

// ---------- properties ----------
const MODE_HELP = {
  corners: 'Drag the blue corners. Tap a white dot or a wall to add a corner. Select a corner, then Delete corner to remove it.',
  points: 'Drag the blue points to reshape. Tap a white dot to add a point.',
  draw: 'Tap the floor to place points. Tap the first point or press Close shape to finish.',
  door: 'Tap a wall that two rooms share to cut a doorway.',
  moveRoom: 'Drag the arrows to move the room. Line the shared wall up with the other room so the doorway opens through both.',
};

function renderProps(studio, toast) {
  const sec = $('#sec-props');
  const item = studio.selectedItem;

  if (studio.mode !== 'select' && MODE_HELP[studio.mode]) {
    const nodes = [h('h2', {}, 'Editing'), h('p', { class: 'muted' }, MODE_HELP[studio.mode])];
    if (studio.mode === 'draw') {
      nodes.push(slider('Height', studio.draw.height, { min: 0.05, max: 4, step: 0.05, onInput: (v) => { studio.draw.height = v; } }));
    }
    sec.replaceChildren(...nodes);
    return;
  }
  if (!item) {
    sec.replaceChildren(
      h('h2', {}, 'Properties'),
      h('p', { class: 'muted' }, 'Tap an object to select it, or add one from the library.'),
      h('p', { class: 'muted small' }, 'Drag to rotate · pinch or scroll to zoom · two fingers or right-drag to pan.'),
    );
    return;
  }

  const nodes = [
    h('h2', {}, itemLabel(item.type)),
    h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Name'),
      h('input', { type: 'text', value: item.name, maxlength: 40, onChange: (e) => { item.name = e.target.value; studio.changed(); } })),
    segmented([['translate', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale']], studio.tcMode, (m) => studio.setTransformMode(m)),
  ];
  if (isPointShape(item)) {
    nodes.push(
      slider('Height', item.height, { min: 0.05, max: 6, step: 0.05, onInput: (v) => studio.updateItem(item, { height: v }, true) }),
      h('div', { class: 'row buttons' }, button('Edit points', () => studio.setMode('points'))),
    );
  } else if (item.type === 'sphere') {
    nodes.push(slider('Radius', item.radius, { min: 0.05, max: 3, step: 0.05, onInput: (v) => studio.updateItem(item, { radius: v }, true) }));
  }
  nodes.push(
    h('h3', {}, hasImageFill(item) ? 'Fill' : 'Colour'),
    fillEditor({
      fill: item.fill, project: studio.project, image: hasImageFill(item), faces: isPointShape(item),
      onChange: () => studio.refreshItemFill(item.id), toast,
    }),
    h('div', { class: 'row buttons' },
      button('Duplicate', () => studio.duplicateSelected()),
      button('Delete', () => studio.deleteSelected(), 'danger')),
  );
  sec.replaceChildren(...nodes);
}

// ---------- hint bar (mode actions, always visible) ----------
function renderHint(studio) {
  const bar = $('#hint');
  const m = studio.mode;
  const done = button('Done', () => studio.setMode('select'), 'primary');
  let nodes = null;
  if (m === 'corners' || m === 'points') {
    const canDelete = studio.handles.selected >= 0 && studio.handles.spec?.canDelete();
    nodes = [
      h('span', {}, m === 'corners' ? 'Edit corners' : 'Edit points'),
      button(m === 'corners' ? 'Delete corner' : 'Delete point', () => studio.deleteSelectedHandle(), 'danger' + (canDelete ? '' : ' disabled')),
      done,
    ];
  } else if (m === 'draw') {
    const n = studio.draw.points.length;
    nodes = [
      h('span', {}, n ? `${n} point${n > 1 ? 's' : ''}` : 'Tap the floor'),
      button('Undo', () => studio.undoDrawPoint(), n ? '' : 'disabled'),
      button('Close shape', () => studio.finishDraw(), 'primary' + (n >= 3 ? '' : ' disabled')),
      button('Cancel', () => studio.setMode('select')),
    ];
  } else if (m === 'door') {
    nodes = [h('span', {}, 'Tap a shared wall'), button('Cancel', () => studio.setMode('select'))];
  } else if (m === 'moveRoom') {
    nodes = [h('span', {}, `Moving ${studio.activeRoom.name}`), done];
  }
  bar.hidden = !nodes;
  if (nodes) bar.replaceChildren(...nodes);
}

// ---------- mobile drawer ----------
function setDrawer(open) {
  document.body.dataset.drawer = open ? 'open' : 'closed';
}
function setMobileTab(tab, open = true) {
  document.body.dataset.mtab = tab;
  for (const b of document.querySelectorAll('#mtabs [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  if (open) setDrawer(true);
}

function setupDrawer(studio) {
  setMobileTab('add', false);
  setDrawer(false);
  for (const b of document.querySelectorAll('#mtabs [data-tab]')) {
    b.onclick = () => {
      const isOpen = document.body.dataset.drawer === 'open';
      if (isOpen && document.body.dataset.mtab === b.dataset.tab) setDrawer(false);
      else setMobileTab(b.dataset.tab, true);
    };
  }
  $('#btn-drawer').onclick = () => setDrawer(document.body.dataset.drawer !== 'open');
  // Close the drawer after adding something on a phone so the user sees it.
  $('#library').addEventListener('click', (e) => {
    if (e.target.closest('button') && mobileQuery.matches) setDrawer(false);
  });
  mobileQuery.addEventListener('change', () => studio.requestRender());
}
