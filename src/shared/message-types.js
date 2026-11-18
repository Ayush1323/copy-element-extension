export const MSG = Object.freeze({
  PING: 'MI_PING',
  GET_STATE: 'MI_GET_STATE',
  SET_MODE: 'MI_SET_MODE', // -> content (all frames)
  COPY_HOVERED: 'MI_COPY_HOVERED', // -> content
  ACTIVATE: 'MI_ACTIVATE', // popup -> service worker
  MODE_CHANGED: 'MI_MODE_CHANGED', // content -> service worker
});
