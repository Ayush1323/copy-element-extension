import { ancestorsOf, tagOf } from '../core/dom-utils.js';
import { cardCandidates } from '../core/card-extractor.js';

export const elementMode = {
  id: 'element',
  hover: true,
  primary: 'element',
  /**
   * Text / controls resolve to themselves. Empty space (padding, images, stretched-link overlays)
   * resolves to the card that contains it, so "empty card space" selects the whole card.
   */
  candidates(raw) {
    if (raw.kind === 'container') {
      const c = cardCandidates(raw.el);
      if (c.list[c.index] && !['HTML', 'BODY'].includes(tagOf(c.list[c.index]))) {
        return { list: c.list, index: c.index, label: 'CARD', kind: 'card' };
      }
    }
    const list = ancestorsOf(raw.el).filter((e) => !['HTML', 'BODY'].includes(tagOf(e)));
    return { list: list.length ? list : [raw.el], index: 0 };
  },
};
