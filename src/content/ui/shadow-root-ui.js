import css from '../styles/injected.css';
import { HOST_TAG } from '../../shared/constants.js';
import { applyTheme } from '../../shared/themes.js';

/**
 * One isolated closed Shadow DOM host that holds every piece of extension UI.
 * Page CSS cannot reach in; our CSS cannot leak out.
 */
export function createShadowUI() {
  const host = document.createElement(HOST_TAG);
  host.setAttribute('data-linklens', '');
  host.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;display:block!important;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = css;
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.append(style, layer);

  let attached = false;
  return {
    host,
    root,
    layer,
    mount() {
      if (!attached || !host.isConnected) {
        (document.documentElement || document.body).appendChild(host);
        attached = true;
      }
    },
    unmount() {
      host.remove();
      attached = false;
    },
    /** A custom highlight colour; anything else means "follow the theme". */
    setAccent(color) {
      if (/^#[0-9a-f]{3,8}$/i.test(color)) layer.style.setProperty('--accent', color);
      else layer.style.removeProperty('--accent');
    },
    setTheme(id) { applyTheme(layer, id); },
    /** True if a DOM event came from inside our UI (works with a closed shadow root). */
    owns(event) {
      if (event.target === host) return true;
      const path = event.composedPath ? event.composedPath() : [];
      return path.includes(host);
    },
  };
}

export function h(tag, className, html) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html != null) el.innerHTML = html; // only ever static, extension-authored markup
  return el;
}
