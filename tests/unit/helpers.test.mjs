import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRestrictedUrl, domainOf, truncate, timeAgo, clamp } from '../../src/shared/helpers.js';

test('restricted URLs are detected', () => {
  for (const u of ['chrome://extensions', 'chrome-extension://abc/popup.html', 'about:blank', 'view-source:https://a.com', 'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/x', '', undefined]) {
    assert.equal(isRestrictedUrl(u), true, String(u));
  }
  for (const u of ['https://www.mindinventory.com/cloud-managed-services/', 'http://localhost:3000/', 'file:///tmp/a.html']) assert.equal(isRestrictedUrl(u), false, u);
});
test('domainOf strips www and tolerates garbage', () => {
  assert.equal(domainOf('https://www.mindinventory.com/x?y=1'), 'mindinventory.com');
  assert.equal(domainOf('not a url'), '');
});
test('truncate / clamp / timeAgo', () => {
  assert.equal(truncate('abcdefghij', 6), 'abcde…');
  assert.equal(truncate('abc', 6), 'abc');
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(timeAgo(1000, 1000 + 5000), 'just now');
  assert.equal(timeAgo(0, 120000), '2m ago');
});
