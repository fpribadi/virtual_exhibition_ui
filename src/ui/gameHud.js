// Game-mode overlay: touch joystick (left), swipe-to-look (right), buttons,
// settings, start screen and the "rotate your phone" hint. It only collects
// input; movement and collision happen in game.js.
//
// Multi-touch: each finger is tracked by pointerId, so one thumb can hold the
// joystick while the other looks around.
import { h, button, checkbox, slider, canFullscreen, isFullscreen, toggleFullscreen, enterFullscreen, onFullscreenChange } from './dom.js';

const JOY_RADIUS = 56; // px of knob travel
const JOY_DEADZONE = 0.12;
const TAP_MS = 300;
const TAP_PX = 10;

export class GameHud {
  constructor(game) {
    this.game = game;
    this.joy = { id: null, cx: 0, cy: 0, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0, sx: 0, sy: 0, t: 0, type: '' };
    this.rotateDismissed = false;

    this.knob = h('div', { class: 'g-knob' });
    this.joyEl = h('div', { class: 'g-joy' }, this.knob);
    this.help = h('div', { class: 'g-help', hidden: true });
    this.fsBtn = button('⛶', () => toggleFullscreen(), 'g-btn');
    this.fsBtn.title = 'Fullscreen';
    this.fsBtn.hidden = !canFullscreen();
    onFullscreenChange(() => this.fsBtn.classList.toggle('on', isFullscreen()));
    this.panel = h('div', { class: 'g-panel', hidden: true });
    const settingsBtn = button('⚙', () => this.togglePanel(), 'g-btn');
    settingsBtn.title = 'Settings';
    this.start = h('div', { class: 'g-overlay', hidden: true });
    this.rotate = h('div', { class: 'g-overlay g-rotate', hidden: true },
      h('div', { class: 'g-card' },
        h('div', { class: 'g-rotate-icon', 'aria-hidden': 'true' }, '⟳'),
        h('p', {}, 'Turn your phone sideways for the best view.'),
        button('Play in portrait', () => { this.rotateDismissed = true; this.updateRotate(); })));

    this.root = h('div', { id: 'game-hud', hidden: true },
      h('div', { class: 'g-cross' }),
      this.joyEl,
      this.help,
      h('div', { class: 'g-top' }, this.fsBtn, settingsBtn, button('Exit', () => game.exit(), 'g-btn')),
      this.panel,
      this.start,
      this.rotate,
    );
    document.body.append(this.root);

    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointermove', (e) => this.onMove(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e, true));
    this.root.addEventListener('pointercancel', (e) => this.onUp(e, false));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.updateRotate());
  }

  // ---------- visibility ----------
  show() {
    this.root.hidden = false;
    this.panel.hidden = true;
    this.resetInput();
    this.updateRotate();
  }

  hide() {
    this.root.hidden = true;
    this.start.hidden = true;
    this.resetInput();
  }

  resetInput() {
    this.releaseJoy();
    this.look.id = null;
  }

  showStart() {
    const touch = this.game.touch;
    const actions = [];
    if (touch && canFullscreen()) {
      actions.push(button('Fullscreen & play', async () => {
        await enterFullscreen();
        try { await screen.orientation?.lock?.('landscape'); } catch { /* not supported (e.g. iOS) */ }
        this.begin();
      }, 'primary'));
    }
    actions.push(button(touch ? 'Play' : 'Click to play', () => this.begin(), touch && canFullscreen() ? '' : 'primary'));
    this.start.replaceChildren(h('div', { class: 'g-card' },
      h('h2', {}, 'Walk-through'),
      touch
        ? h('p', {}, 'Left thumb: move. Right thumb: swipe to look around.')
        : h('p', {}, 'W A S D or arrow keys to move, Shift to run, mouse to look. Esc frees the mouse, then Esc again leaves.'),
      h('div', { class: 'row buttons' }, actions),
    ));
    this.start.hidden = false;
    this.updateHelp();
  }

  begin() {
    this.start.hidden = true;
    this.game.requestLock();
    this.updateHelp();
  }

  setTouch(on) {
    document.body.dataset.touch = on ? 'yes' : 'no';
    this.updateHelp();
    this.updateRotate();
    if (!this.panel.hidden) this.renderPanel();
  }

  updateHelp() {
    const g = this.game;
    const show = !g.touch && !g.locked && this.start.hidden;
    this.help.hidden = !show;
    this.help.textContent = 'Click to look around · Esc to leave';
  }

  updateRotate() {
    const portrait = window.innerHeight > window.innerWidth;
    this.rotate.hidden = !(this.game.active && this.game.touch && portrait && !this.rotateDismissed);
  }

  // ---------- settings ----------
  togglePanel() {
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden) this.renderPanel();
  }

  renderPanel() {
    const g = this.game;
    const s = g.settings;
    const nodes = [h('h2', {}, 'Settings')];
    if (g.touch) {
      nodes.push(
        checkbox('Tap to walk', s.tapToWalk, (v) => g.setSetting('tapToWalk', v)),
        checkbox('Gyroscope look', s.gyro, async (v) => {
          const ok = await g.setSetting('gyro', v);
          if (!ok) this.renderPanel();
        }),
      );
    }
    nodes.push(
      checkbox('Step onto low platforms', s.stepUp, (v) => g.setSetting('stepUp', v)),
      slider('Look speed', s.lookSpeed, { min: 0.3, max: 2.5, step: 0.05, onInput: (v) => g.setSetting('lookSpeed', v) }),
      h('div', { class: 'row buttons' }, button('Close', () => this.togglePanel())),
    );
    if (g.gyroError) nodes.splice(3, 0, h('p', { class: 'warn small' }, g.gyroError));
    this.panel.replaceChildren(...nodes);
  }

  // ---------- pointer input ----------
  onDown(e) {
    if (e.target.closest('button, input, label, .g-panel, .g-card')) return;
    const g = this.game;
    if (e.pointerType === 'mouse') {
      if (!g.touch) {
        g.requestLock();
        this.startLook(e); // drag-to-look fallback if pointer lock is unavailable
      }
      return;
    }
    if (!g.touch) g.setTouch(true);
    e.preventDefault();
    if (e.clientX < window.innerWidth * 0.45 && this.joy.id === null) this.startJoy(e);
    else if (this.look.id === null) this.startLook(e);
  }

  onMove(e) {
    if (e.pointerId === this.joy.id) {
      this.updateJoy(e);
    } else if (e.pointerId === this.look.id && !this.game.locked) {
      this.game.addLook(e.clientX - this.look.x, e.clientY - this.look.y, this.look.type);
      this.look.x = e.clientX;
      this.look.y = e.clientY;
    }
  }

  onUp(e, allowTap) {
    if (e.pointerId === this.joy.id) this.releaseJoy();
    if (e.pointerId === this.look.id) {
      const l = this.look;
      l.id = null;
      const tap = performance.now() - l.t < TAP_MS && Math.hypot(e.clientX - l.sx, e.clientY - l.sy) < TAP_PX;
      if (allowTap && tap && l.type !== 'mouse' && this.game.settings.tapToWalk) this.game.walkTo(e.clientX, e.clientY);
    }
  }

  startLook(e) {
    Object.assign(this.look, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), type: e.pointerType });
    this.root.setPointerCapture?.(e.pointerId);
  }

  startJoy(e) {
    const j = this.joy;
    j.id = e.pointerId;
    j.cx = e.clientX;
    j.cy = e.clientY;
    // the base jumps under the thumb, so you never start with a sudden push
    this.joyEl.style.left = `${e.clientX - 64}px`;
    this.joyEl.style.top = `${e.clientY - 64}px`;
    this.joyEl.style.bottom = 'auto';
    this.joyEl.classList.add('active');
    this.root.setPointerCapture?.(e.pointerId);
    this.updateJoy(e);
  }

  updateJoy(e) {
    const j = this.joy;
    let dx = e.clientX - j.cx, dy = e.clientY - j.cy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) { dx *= JOY_RADIUS / d; dy *= JOY_RADIUS / d; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / JOY_RADIUS);
    const k = m < JOY_DEADZONE ? 0 : (m - JOY_DEADZONE) / (1 - JOY_DEADZONE) / (m || 1);
    j.x = (dx / JOY_RADIUS) * k;
    j.y = (dy / JOY_RADIUS) * k;
  }

  releaseJoy() {
    Object.assign(this.joy, { id: null, x: 0, y: 0 });
    this.knob.style.transform = '';
    this.joyEl.style.left = this.joyEl.style.top = this.joyEl.style.bottom = '';
    this.joyEl.classList.remove('active');
  }
}
