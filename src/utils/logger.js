const PREFIX = '[Instant Copy]';
let debug = false;
export const logger = {
  setDebug(v) { debug = !!v; },
  debug(...a) { if (debug) console.debug(PREFIX, ...a); },
  warn(...a) { console.warn(PREFIX, ...a); },
  error(...a) { console.error(PREFIX, ...a); },
};
