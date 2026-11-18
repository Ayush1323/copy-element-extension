import { logger } from './logger.js';

export function errorMessage(err) {
  return (err && err.message) || String(err || 'Unknown error');
}

/** Wrap a function so thrown/rejected errors are logged instead of surfacing as uncaught. */
export function safe(fn, onError) {
  return function safeWrapped(...args) {
    try {
      const r = fn.apply(this, args);
      if (r && typeof r.then === 'function') {
        return r.catch((e) => {
          logger.error(e);
          if (onError) onError(e);
        });
      }
      return r;
    } catch (e) {
      logger.error(e);
      if (onError) onError(e);
      return undefined;
    }
  };
}
