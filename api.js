// Thin HTTP layer. All real logic lives in calibrate.js; this validates
// input at the boundary and wires SQLite rows to it. No auth yet.
const express = require('express');
const { fitThreshold, decide, DEFAULT_THRESHOLD } = require('./calibrate');

const MAX_KEY_LENGTH = 200;
const ANSWERS = new Set(['allow', 'deny']);

const isKey = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_KEY_LENGTH;
const isProbability = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

function decisionError({ customer_id, question_shape, jev_probability, jev_answer }) {
  if (!isKey(customer_id)) return `customer_id must be a non-empty string of at most ${MAX_KEY_LENGTH} chars`;
  if (!isKey(question_shape)) return `question_shape must be a non-empty string of at most ${MAX_KEY_LENGTH} chars`;
  if (!isProbability(jev_probability)) return 'jev_probability must be a number between 0 and 1';
  if (!ANSWERS.has(jev_answer)) return "jev_answer must be 'allow' or 'deny'";
  return null;
}

function createApp(db) {
  const app = express();
  app.use(express.json());

  // Log a decision Jev just made, get back the calibrated threshold for
  // this customer+question_shape so the caller can override Jev's raw
  // allow/deny if their own accumulated data says the raw answer is wrong.
  app.post('/decisions', (req, res) => {
    const error = decisionError(req.body ?? {});
    if (error) return res.status(400).json({ error });
    const { customer_id, question_shape, jev_probability, jev_answer } = req.body;

    const insert = db.prepare(`
      INSERT INTO decisions (customer_id, question_shape, jev_probability, jev_answer)
      VALUES (?, ?, ?, ?)
    `);
    const { lastInsertRowid } = insert.run(customer_id, question_shape, jev_probability, jev_answer);

    const curve = db.prepare(`
      SELECT threshold FROM calibration_curves WHERE customer_id = ? AND question_shape = ?
    `).get(customer_id, question_shape);
    const threshold = curve ? curve.threshold : DEFAULT_THRESHOLD;

    res.status(201).json({
      decision_id: lastInsertRowid,
      threshold,
      recalibrated_answer: decide(jev_probability, threshold),
    });
  });

  // Feed back ground truth for a past decision, then refit that
  // customer+question_shape's threshold from all labeled outcomes so far.
  app.post('/decisions/:id/outcome', (req, res) => {
    const decisionId = Number(req.params.id);
    if (!Number.isSafeInteger(decisionId) || decisionId < 1) {
      return res.status(400).json({ error: 'decision id must be a positive integer' });
    }
    const { was_safe } = req.body ?? {};
    if (typeof was_safe !== 'boolean') {
      return res.status(400).json({ error: 'was_safe (boolean) is required' });
    }

    const decision = db.prepare('SELECT * FROM decisions WHERE id = ?').get(decisionId);
    if (!decision) return res.status(404).json({ error: 'decision not found' });

    // One label per decision: a second report would count the decision twice
    // in the fit. The UNIQUE index enforces it even under concurrent requests.
    const inserted = db.prepare(
      'INSERT INTO outcomes (decision_id, was_safe) VALUES (?, ?) ON CONFLICT(decision_id) DO NOTHING'
    ).run(decisionId, was_safe ? 1 : 0);
    if (inserted.changes === 0) {
      return res.status(409).json({ error: 'an outcome was already reported for this decision' });
    }

    const labeled = db.prepare(`
      SELECT d.jev_probability AS probability, o.was_safe AS was_safe
      FROM outcomes o JOIN decisions d ON d.id = o.decision_id
      WHERE d.customer_id = ? AND d.question_shape = ?
    `).all(decision.customer_id, decision.question_shape)
      .map((r) => ({ probability: r.probability, was_safe: !!r.was_safe }));

    const { threshold, sampleCount } = fitThreshold(labeled);

    db.prepare(`
      INSERT INTO calibration_curves (customer_id, question_shape, threshold, sample_count, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(customer_id, question_shape)
      DO UPDATE SET threshold = excluded.threshold, sample_count = excluded.sample_count, updated_at = excluded.updated_at
    `).run(decision.customer_id, decision.question_shape, threshold, sampleCount);

    res.json({ threshold, sample_count: sampleCount });
  });

  return app;
}

module.exports = { createApp };
