// Hit tolerance control shared by Settings and the practice screen: difficulty presets plus a
// ± ms slider. Moving the slider switches to the 'custom' difficulty.

import { h } from '../dom.js';
import { DIFFICULTY, CUSTOM_WINDOW_RANGE, hitWindowMs } from '../drumMap.js';

/** `settings` is updated in place; onChange runs after every change (save and apply there). */
export function toleranceControl(settings, onChange) {
  const customOption = h('option', { value: 'custom' });
  const select = h('select', { title: 'Difficulty' },
    Object.entries(DIFFICULTY).map(([k, d]) => h('option', { value: k }, d.label)), customOption);
  const slider = h('input', {
    type: 'range', min: CUSTOM_WINDOW_RANGE.min, max: CUSTOM_WINDOW_RANGE.max, step: 5, title: 'Hit window',
  });
  const value = h('span.value');

  const show = () => {
    const ms = hitWindowMs(settings.difficulty, settings);
    customOption.textContent = `Custom (±${settings.customWindowMs}ms)`;
    select.value = settings.difficulty;
    slider.value = ms;
    value.textContent = `±${ms} ms`;
  };

  select.addEventListener('change', () => {
    settings.difficulty = select.value;
    show();
    onChange();
  });
  slider.addEventListener('input', () => {
    settings.difficulty = 'custom';
    settings.customWindowMs = Number(slider.value);
    show();
    onChange();
  });
  show();
  return h('div.row.tolerance', select, slider, value);
}
