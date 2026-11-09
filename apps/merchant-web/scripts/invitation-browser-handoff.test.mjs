import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const inviteScript = readFileSync(new URL('../public/invite.js', import.meta.url), 'utf8');
const ID = 'e0846c58-68fb-4bb1-9f62-98cee54e13c4';

function launch(search, { storageFails = false } = {}) {
  class MockAnchor {
    href = '';
    hidden = false;
    textContent = '';
  }
  const elements = {
    'open-app': new MockAnchor(),
    'continue-web': new MockAnchor(),
    'invalid-link': { hidden: true, removeAttribute: function (name) { if (name === 'hidden') this.hidden = false; } },
    'invite-message': { textContent: '' },
  };
  const storage = new Map();
  const location = { search, href: 'https://app.sellertray.com/join.html' + search };
  const originalUrl = location.href;
  const window = {
    location,
    localStorage: {
      setItem(key, value) { if (storageFails) throw new Error('storage unavailable'); storage.set(key, value); },
    },
    setTimeout() { throw new Error('must never automatically open an older installed APK'); },
  };
  runInNewContext(inviteScript, {
    HTMLAnchorElement: MockAnchor,
    document: { getElementById(id) { return elements[id] ?? null; }, visibilityState: 'visible' },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 15)' },
    URLSearchParams,
    encodeURIComponent,
    window,
  });
  return { elements, window, storage, originalUrl };
}

test('valid invitation does not automatically redirect an Android recipient into an old APK', () => {
  const { elements, window, storage, originalUrl } = launch('?invitation=' + ID);
  assert.equal(window.location.href, originalUrl);
  assert.equal(elements['open-app'].href, 'sellertray://invite/' + ID);
  assert.equal(elements['continue-web'].href, '/?invitation=' + ID);
  assert.equal(storage.get('sellertray.pendingInvitationId'), ID);
  assert.equal(elements['invalid-link'].hidden, true);
});

test('no browser storage still keeps the invitation through an explicit browser link', () => {
  const { elements, window } = launch('?invitation=' + ID, { storageFails: true });
  assert.equal(elements['continue-web'].href, '/?invitation=' + ID);
  assert.ok(window.location.href.startsWith('https://app.sellertray.com/join.html'));
});

test('invalid and missing invitation IDs never produce a deep link', () => {
  for (const query of ['', '?invitation=not-an-invitation', '?invitation=%3Cscript%3E']) {
    const { elements, storage } = launch(query);
    assert.equal(elements['open-app'].hidden, true);
    assert.equal(elements['continue-web'].href, '/');
    assert.equal(elements['invalid-link'].hidden, false);
    assert.equal(storage.size, 0);
  }
});

test('normalizes upper-case invitation IDs without changing identity', () => {
  const { elements } = launch('?invitation=' + ID.toUpperCase());
  assert.equal(elements['open-app'].href, 'sellertray://invite/' + ID);
});
