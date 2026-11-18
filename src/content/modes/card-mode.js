import { cardCandidates } from '../core/card-extractor.js';

export const cardMode = {
  id: 'card',
  hover: true,
  primary: 'card',
  candidates: (raw) => cardCandidates(raw.el),
};
