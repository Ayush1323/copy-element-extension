import { MSG } from '../shared/message-types.js';
import { createPickerController } from './core/picker-controller.js';
import { logger } from '../utils/logger.js';

(function bootstrap() {
  const KEY = '__linkLens';
  if (window[KEY]) return; // already injected in this frame
  const controller = createPickerController();
  Object.defineProperty(window, KEY, { value: controller, enumerable: false });
  const isTop = window.top === window;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case MSG.PING:
        sendResponse({ ok: true });
        return false;
      case MSG.GET_STATE:
        if (isTop) sendResponse({ mode: controller.getMode() });
        return false;
      case MSG.SET_MODE:
        controller
          .setMode(msg.toggle && msg.mode === controller.getMode() ? null : msg.mode || null, { broadcast: !!msg.broadcast })
          .then((mode) => sendResponse({ ok: true, mode }))
          .catch((e) => { logger.error(e); sendResponse({ ok: false, error: String(e && e.message) }); });
        return true; // async response
      case MSG.COPY_HOVERED:
        if (!controller.getMode()) return false;
        controller.copyHovered().then((ok) => { try { sendResponse({ ok }); } catch (_) { /* noop */ } });
        return true;
      default:
        return false;
    }
  });
})();
