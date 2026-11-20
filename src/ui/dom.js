// Tiny DOM helpers for building panels without a framework.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function slider(label, value, { min, max, step = 0.01, fmt = (v) => (+v).toFixed(2), onInput }) {
  const out = h('output', {}, fmt(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    onInput: (e) => { const v = parseFloat(e.target.value); out.textContent = fmt(v); onInput(v); },
  });
  return h('label', { class: 'row slider' }, h('span', { class: 'lbl' }, label), input, out);
}

export function numberField(label, value, { step = 0.05, onChange }) {
  return h('label', { class: 'row' }, h('span', { class: 'lbl' }, label),
    h('input', {
      type: 'number', step, value: +(+value).toFixed(3), inputmode: 'decimal',
      onChange: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); },
    }));
}

export function colorField(label, value, onInput) {
  return h('label', { class: 'row' }, h('span', { class: 'lbl' }, label),
    h('input', { type: 'color', value, onInput: (e) => onInput(e.target.value) }));
}

export function selectField(label, value, options, onChange) {
  return h('label', { class: 'row' }, h('span', { class: 'lbl' }, label),
    h('select', { onChange: (e) => onChange(e.target.value) },
      options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
}

export function checkbox(label, checked, onChange) {
  return h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) }), label);
}

export function button(text, onClick, cls = '') {
  return h('button', { type: 'button', class: cls, onClick }, text);
}

export function segmented(options, value, onChange) {
  return h('div', { class: 'seg' }, options.map(([v, text]) =>
    h('button', { type: 'button', class: v === value ? 'on' : '', onClick: () => onChange(v) }, text)));
}
