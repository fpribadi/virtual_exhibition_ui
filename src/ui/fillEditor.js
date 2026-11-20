// Colour + image fill controls shared by floors, walls, shapes, posters and screens.
// Every control mutates the fill object and calls onChange() for a live preview.
import { h, slider, colorField, selectField, checkbox, button } from './dom.js';
import { addImageFile, resetFillTransform } from '../textures.js';

/**
 * @param {object} opts
 * @param {object} opts.fill      fill data (mutated in place)
 * @param {object} opts.project   project (images are stored here)
 * @param {boolean} [opts.faces]  show the top/sides/all choice
 * @param {boolean} [opts.image]  allow image fill (default true)
 * @param {Function} opts.onChange
 * @param {Function} opts.toast
 */
export function fillEditor(opts) {
  const root = h('div', { class: 'fill' });
  const render = () => root.replaceChildren(...build(opts, render));
  render();
  return root;
}

function build({ fill, project, faces = false, image = true, onChange, toast }, rerender) {
  const nodes = [colorField(fill.image ? 'Colour (no image)' : 'Colour', fill.color, (v) => { fill.color = v; onChange(); })];
  if (!image) return nodes;

  const fileInput = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onChange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        fill.image = await addImageFile(project, file);
        onChange();
        rerender();
      } catch (err) {
        toast(err.message || 'Could not load that image.');
      }
    },
  });

  nodes.push(h('div', { class: 'row buttons' },
    fileInput,
    button(fill.image ? 'Replace image' : 'Upload image', () => fileInput.click(), 'primary'),
    fill.image && button('Remove', () => { fill.image = null; onChange(); rerender(); }),
  ));

  if (!fill.image) return nodes;

  const thumb = project.images[fill.image];
  if (thumb) nodes.push(h('img', { class: 'thumb', src: thumb, alt: 'Fill image preview' }));

  nodes.push(selectField('Fit', fill.mode, [
    ['stretch', 'Stretch'], ['cover', 'Cover'], ['contain', 'Contain'], ['tile', 'Tile'],
  ], (v) => { fill.mode = v; onChange(); rerender(); }));

  if (fill.mode === 'tile') {
    nodes.push(slider('Repeat', fill.tiles, { min: 1, max: 20, step: 1, fmt: (v) => `${v}×`, onInput: (v) => { fill.tiles = v; onChange(); } }));
  }
  if (fill.mode === 'contain') {
    nodes.push(colorField('Background', fill.bg, (v) => { fill.bg = v; onChange(); }));
  }
  if (faces) {
    nodes.push(selectField('Apply to', fill.faces, [['all', 'All faces'], ['top', 'Top'], ['sides', 'Sides']],
      (v) => { fill.faces = v; onChange(); }));
  }
  nodes.push(
    slider('Offset X', fill.offsetX, { min: -1, max: 1, onInput: (v) => { fill.offsetX = v; onChange(); } }),
    slider('Offset Y', fill.offsetY, { min: -1, max: 1, onInput: (v) => { fill.offsetY = v; onChange(); } }),
    slider('Scale', fill.scale, { min: 0.1, max: 4, onInput: (v) => { fill.scale = v; onChange(); } }),
    slider('Rotate', fill.rotation, { min: -180, max: 180, step: 1, fmt: (v) => `${v}°`, onInput: (v) => { fill.rotation = v; onChange(); } }),
    h('div', { class: 'row checks' },
      checkbox('Flip H', fill.flipH, (v) => { fill.flipH = v; onChange(); }),
      checkbox('Flip V', fill.flipV, (v) => { fill.flipV = v; onChange(); }),
    ),
    h('div', { class: 'row buttons' }, button('Reset', () => { resetFillTransform(fill); onChange(); rerender(); })),
  );
  return nodes;
}
