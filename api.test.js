// Integration test: drives the real endpoints against a real (in-memory)
// SQLite db. This is also effectively the "does the demo work" proof.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('./db');
const { createApp } = require('./api');

function withServer(fn) {
  const db = openDb(':memory:');
  const app = createApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  return fn(base).finally(() => server.close());
}

test('logs a decision and returns the default threshold when uncalibrated', () => withServer(async (base) => {
  const res = await fetch(`${base}/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id: 'acme', question_shape: 'tool-call-risk', jev_probability: 0.7, jev_answer: 'allow' }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.threshold, 0.5);
  assert.equal(body.recalibrated_answer, 'allow');
  assert.ok(body.decision_id);
}));

test('rejects a decision missing required fields', () => withServer(async (base) => {
  const res = await fetch(`${base}/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id: 'acme' }),
  });
  assert.equal(res.status, 400);
}));

test('recalibrates the threshold as labeled outcomes accumulate', () => withServer(async (base) => {
  // Feed 6 labeled decisions where anything < 0.6 turned out unsafe;
  // mirrors calibrate.test.js's fixture, run through the real HTTP+DB path.
  const samples = [
    [0.2, false], [0.35, false], [0.4, false],
    [0.6, true], [0.75, true], [0.9, true],
  ];

  let lastOutcomeBody;
  for (const [probability, wasSafe] of samples) {
    const decisionRes = await fetch(`${base}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: 'acme', question_shape: 'tool-call-risk', jev_probability: probability, jev_answer: probability >= 0.5 ? 'allow' : 'deny' }),
    });
    const { decision_id } = await decisionRes.json();

    const outcomeRes = await fetch(`${base}/decisions/${decision_id}/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ was_safe: wasSafe }),
    });
    lastOutcomeBody = await outcomeRes.json();
  }

  assert.ok(lastOutcomeBody.threshold > 0.4 && lastOutcomeBody.threshold <= 0.6,
    `expected recalibrated threshold in (0.4, 0.6], got ${lastOutcomeBody.threshold}`);
  assert.equal(lastOutcomeBody.sample_count, 6);

  // A fresh decision at 0.55 now resolves against the recalibrated curve,
  // not the stale 0.5 default.
  const nextRes = await fetch(`${base}/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id: 'acme', question_shape: 'tool-call-risk', jev_probability: 0.55, jev_answer: 'allow' }),
  });
  const next = await nextRes.json();
  assert.equal(next.threshold, lastOutcomeBody.threshold);
}));

test('404s an outcome for an unknown decision', () => withServer(async (base) => {
  const res = await fetch(`${base}/decisions/999/outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ was_safe: true }),
  });
  assert.equal(res.status, 404);
}));

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const valid = { customer_id: 'acme', question_shape: 'tool-call-risk', jev_probability: 0.7, jev_answer: 'allow' };

for (const [name, patch] of [
  ['a probability above 1', { jev_probability: 1.5 }],
  ['a negative probability', { jev_probability: -0.1 }],
  ['a probability given as a string', { jev_probability: '0.7' }],
  ['an answer other than allow/deny', { jev_answer: 'maybe' }],
  ['a non-string customer id', { customer_id: 42 }],
  ['an oversized question shape', { question_shape: 'x'.repeat(201) }],
]) {
  test(`rejects ${name}`, () => withServer(async (base) => {
    const { status } = await post(base, '/decisions', { ...valid, ...patch });
    assert.equal(status, 400);
  }));
}

test('accepts only one outcome per decision', () => withServer(async (base) => {
  const { body } = await post(base, '/decisions', valid);
  const first = await post(base, `/decisions/${body.decision_id}/outcome`, { was_safe: true });
  const second = await post(base, `/decisions/${body.decision_id}/outcome`, { was_safe: false });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
}));

test('rejects a non-numeric decision id', () => withServer(async (base) => {
  const { status } = await post(base, '/decisions/abc/outcome', { was_safe: true });
  assert.equal(status, 400);
}));
