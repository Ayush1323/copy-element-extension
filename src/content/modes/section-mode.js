import { sectionCandidates } from '../core/section-extractor.js';

export const sectionMode = {
  id: 'section',
  hover: true,
  primary: 'section',
  candidates: (raw) => sectionCandidates(raw.el),
};
