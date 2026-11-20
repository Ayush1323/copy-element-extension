import { test } from 'node:test';
import assert from 'node:assert/strict';

test('onStorageChange does not throw when chrome.storage is gone (orphaned content script)', async () => {
  const saved = globalThis.chrome;
  try {
    globalThis.chrome = { runtime: {} }; // an invalidated context: no storage API
    const { onStorageChange } = await import('../../src/shared/storage.js');
    const off = onStorageChange(() => {});
    assert.equal(typeof off, 'function');
    off();
    delete globalThis.chrome;
    assert.doesNotThrow(() => onStorageChange(() => {})());
  } finally { globalThis.chrome = saved; }
});

test('extensionAlive reflects whether the extension context is still valid', async () => {
  const saved = globalThis.chrome;
  try {
    const { extensionAlive } = await import('../../src/shared/helpers.js');
    globalThis.chrome = { runtime: { id: 'abc' } };
    assert.equal(extensionAlive(), true);
    globalThis.chrome = { runtime: {} };
    assert.equal(extensionAlive(), false);
    delete globalThis.chrome;
    assert.equal(extensionAlive(), false);
  } finally { if (saved === undefined) delete globalThis.chrome; else globalThis.chrome = saved; }
});
