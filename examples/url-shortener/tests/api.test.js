/**
 * URL Shortener API Tests
 * Uses Node.js built-in test runner (node:test) + built-in fetch
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import { clearStore } from '../src/store.js';

let server;
let baseUrl;

// Start the server before all tests
before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

// Shut down the server after all tests
after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// Clear store before each test for isolation
beforeEach(() => {
  clearStore();
});

// ---------------------------------------------------------------------------
// POST /shorten
// ---------------------------------------------------------------------------
describe('POST /shorten', () => {
  test('returns 201 with { short, url } for a valid URL', async () => {
    const res = await fetch(`${baseUrl}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.url, 'https://example.com');
    assert.ok(body.short, 'should have a short field');

    // The short code embedded in the URL should be exactly 6 characters
    const code = body.short.split('/').pop();
    assert.match(code, /^[a-zA-Z0-9]{6}$/, 'code should be 6 alphanumeric chars');
  });

  test('returns 400 when url is missing', async () => {
    const res = await fetch(`${baseUrl}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error, 'should have an error field');
  });
});

// ---------------------------------------------------------------------------
// GET /:code
// ---------------------------------------------------------------------------
describe('GET /:code', () => {
  test('redirects (302) to the original URL', async () => {
    // First, shorten a URL
    const shortenRes = await fetch(`${baseUrl}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/redirect-test' }),
    });
    const { short } = await shortenRes.json();
    const code = short.split('/').pop();

    // Follow the short link (no auto-redirect)
    const res = await fetch(`${baseUrl}/${code}`, { redirect: 'manual' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://example.com/redirect-test');
  });

  test('returns 404 for an unknown code', async () => {
    const res = await fetch(`${baseUrl}/unknown`);

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error, 'should have an error field');
  });
});

// ---------------------------------------------------------------------------
// GET /stats/:code
// ---------------------------------------------------------------------------
describe('GET /stats/:code', () => {
  test('returns { code, url, visits } with visits starting at 0', async () => {
    // Shorten a URL
    const shortenRes = await fetch(`${baseUrl}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/stats-test' }),
    });
    const { short } = await shortenRes.json();
    const code = short.split('/').pop();

    // Check stats before any visits
    const res = await fetch(`${baseUrl}/stats/${code}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.code, code);
    assert.equal(body.url, 'https://example.com/stats-test');
    assert.equal(body.visits, 0);
  });

  test('increments visit count after each redirect', async () => {
    // Shorten a URL
    const shortenRes = await fetch(`${baseUrl}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/visit-count-test' }),
    });
    const { short } = await shortenRes.json();
    const code = short.split('/').pop();

    // Visit the short link twice
    await fetch(`${baseUrl}/${code}`, { redirect: 'manual' });
    await fetch(`${baseUrl}/${code}`, { redirect: 'manual' });

    // Verify visit count
    const statsRes = await fetch(`${baseUrl}/stats/${code}`);
    const body = await statsRes.json();
    assert.equal(body.visits, 2);
  });

  test('returns 404 for an unknown code', async () => {
    const res = await fetch(`${baseUrl}/stats/unknown`);

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error, 'should have an error field');
  });
});
