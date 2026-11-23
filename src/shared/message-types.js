export const MSG = Object.freeze({
  PING: 'MI_PING',
  GET_STATE: 'MI_GET_STATE',
  SET_MODE: 'MI_SET_MODE', // -> content (all frames)
  COPY_HOVERED: 'MI_COPY_HOVERED', // -> content
  ACTIVATE: 'MI_ACTIVATE', // popup -> service worker
  MODE_CHANGED: 'MI_MODE_CHANGED', // content -> service worker
  PREVIEW_TOKEN: 'MI_PREVIEW_TOKEN', // content -> service worker: token for the preview page
  PREVIEW_CHECK: 'MI_PREVIEW_CHECK', // preview page -> service worker: is this token valid?
  OPEN_OPTIONS: 'MI_OPEN_OPTIONS', // content -> service worker
  UPLOAD_SHOT: 'MI_UPLOAD_SHOT', // content -> service worker: upload the edited screenshot to the built-in share API, get a link
  CAPTURE: 'MI_CAPTURE', // content -> service worker: chrome.tabs.captureVisibleTab of the sender's tab
});
