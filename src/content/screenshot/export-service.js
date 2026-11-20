// Turning the edited canvas into a file / clipboard image. Runs entirely in the page; no extra permissions needed
// (clipboardWrite is already granted; downloads use a normal anchor download).

const pad = (n) => String(n).padStart(2, '0');

export function defaultFilename(ext = 'png', d = new Date()) {
  return `LinkLens-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext}`;
}

export function sanitizeFilename(name, ext) {
  const base = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/\.(png|jpe?g)$/i, '') || defaultFilename(ext).replace(/\.[a-z]+$/, '');
  return `${base.slice(0, 120)}.${ext}`;
}

export function canvasToBlob(canvas, type = 'image/png', quality = 1) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image (it may be too large).'))), type, quality);
  });
}

export async function copyImage(blob) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('This browser cannot copy images to the clipboard.');
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  } catch (e) {
    throw new Error(e && e.name === 'NotAllowedError' ? 'The browser blocked clipboard access. Click the page once and try again.' : `Copy failed: ${(e && e.message) || e}`);
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
  (document.body || document.documentElement).appendChild(a);
  a.click();
  a.remove(); // the page DOM is left exactly as it was; the blob URL stays valid until the download has started
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Save with the native "Save as" dialog where the browser has one; otherwise a normal download. Returns the final name. */
export async function saveBlob(blob, filename) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = filename.split('.').pop().toLowerCase();
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: ext === 'png' ? 'PNG image' : 'JPEG image', accept: { [blob.type]: [`.${ext}`] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { name: handle.name, native: true };
    } catch (e) {
      if (e && e.name === 'AbortError') return { cancelled: true };
      // blocked in this frame / context: fall back to a plain download
    }
  }
  downloadBlob(blob, filename);
  return { name: filename, native: false };
}
