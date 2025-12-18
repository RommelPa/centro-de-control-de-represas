const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

process.env.API_KEY = 'test-key';
process.env.RATE_LIMIT_MAX = '1';

const requireApiKey = require('../middleware/auth');
const errorHandler = require('../middleware/error-handler');
const rateLimiter = require('../middleware/rate-limit');
const requestContext = require('../middleware/request-context');

const startServer = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });

test('API key middleware rejects missing key', async () => {
  const app = express();
  app.get('/secure', requireApiKey, (req, res) => res.json({ ok: true }));
  const { server, url } = await startServer(app);

  try {
    const res = await fetch(`${url}/secure`);
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.ok, false);
  } finally {
    server.close();
  }
});

test('API key middleware accepts valid key', async () => {
  const app = express();
  app.get('/secure', requireApiKey, (req, res) => res.json({ ok: true }));
  const { server, url } = await startServer(app);

  try {
    const res = await fetch(`${url}/secure`, {
      headers: { 'x-api-key': 'test-key' },
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
  } finally {
    server.close();
  }
});

test('Error handler normalizes server errors', async () => {
  const app = express();
  app.use(requestContext);
  app.get('/boom', () => {
    throw new Error('boom');
  });
  app.use(errorHandler);

  const { server, url } = await startServer(app);

  try {
    const res = await fetch(`${url}/boom`);
    assert.strictEqual(res.status, 500);
    const json = await res.json();
    assert.strictEqual(json.ok, false);
    assert.strictEqual(json.message, 'boom');
    assert.ok(json.requestId);
    assert.ok(res.headers.get('x-request-id'));
  } finally {
    server.close();
  }
});

test('Rate limiter blocks after threshold', async () => {
  const app = express();
  app.get('/limited', rateLimiter, (req, res) => res.json({ ok: true }));
  const { server, url } = await startServer(app);

  try {
    const first = await fetch(`${url}/limited`);
    assert.strictEqual(first.status, 200);

    const second = await fetch(`${url}/limited`);
    assert.strictEqual(second.status, 429);
    const json = await second.json();
    assert.strictEqual(json.code, 'RATE_LIMITED');
  } finally {
    server.close();
  }
});
