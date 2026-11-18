import { h } from './shadow-root-ui.js';

export function createHighlight(ui) {
  const outline = h('div', 'outline snap');
  const chip = h('div', 'chip');
  outline.hidden = true;
  chip.hidden = true;
  ui.layer.append(outline, chip);

  return {
    show(rect, label, { showLabel = true, animate = true } = {}) {
      const w = Math.max(rect.width, 2);
      const hh = Math.max(rect.height, 2);
      outline.classList.toggle('snap', !animate || outline.hidden);
      outline.hidden = false;
      outline.style.width = `${w + 4}px`;
      outline.style.height = `${hh + 4}px`;
      outline.style.transform = `translate(${Math.round(rect.left - 2)}px, ${Math.round(rect.top - 2)}px)`;
      if (showLabel && label) {
        chip.textContent = label;
        chip.hidden = false;
        const y = rect.top - 24 < 2 ? rect.top + 4 : rect.top - 24;
        chip.style.transform = `translate(${Math.max(2, Math.round(rect.left - 2))}px, ${Math.round(y)}px)`;
      } else chip.hidden = true;
    },
    hide() {
      outline.hidden = true;
      chip.hidden = true;
    },
  };
}
