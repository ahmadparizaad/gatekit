const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitThreshold } = require('./calibrate');

test('picks a threshold that separates safe from unsafe outcomes', () => {
  // Below 0.5 the labeled outcomes were unsafe; at/above, safe.
  // A threshold anywhere in (0.5, 0.6) would zero-error this set; assert it lands there.
  const labeled = [
    { probability: 0.2, was_safe: false },
    { probability: 0.35, was_safe: false },
    { probability: 0.4, was_safe: false },
    { probability: 0.6, was_safe: true },
    { probability: 0.75, was_safe: true },
    { probability: 0.9, was_safe: true },
  ];

  const result = fitThreshold(labeled);

  assert.ok(result.threshold > 0.4 && result.threshold <= 0.6,
    `expected threshold in (0.4, 0.6], got ${result.threshold}`);
  assert.equal(result.sampleCount, 6);
});

test('falls back to a default threshold with too few samples', () => {
  const result = fitThreshold([{ probability: 0.8, was_safe: true }]);
  assert.equal(result.threshold, 0.5, 'default cutoff until enough data accumulates');
  assert.equal(result.sampleCount, 1);
});

test('returns the default on no data without throwing', () => {
  const result = fitThreshold([]);
  assert.equal(result.threshold, 0.5);
  assert.equal(result.sampleCount, 0);
});

const { decide, UNSAFE_ALLOW_COST } = require('./calibrate');

test('allows only strictly above the threshold', () => {
  assert.equal(decide(0.51, 0.5), 'allow');
  assert.equal(decide(0.5, 0.5), 'deny');
});

test('can learn to deny everything when every outcome was unsafe', () => {
  const labeled = [0.3, 0.5, 0.7, 0.8, 0.95].map((p) => ({ probability: p, was_safe: false }));
  const { threshold } = fitThreshold(labeled);
  for (const { probability } of labeled) assert.equal(decide(probability, threshold), 'deny');
});

test('can learn to allow everything when every outcome was safe', () => {
  const labeled = [0.3, 0.5, 0.7, 0.8, 0.95].map((p) => ({ probability: p, was_safe: true }));
  const { threshold } = fitThreshold(labeled);
  for (const { probability } of labeled) assert.equal(decide(probability, threshold), 'allow');
});

test('weighs an unsafe allow above a wrong deny', () => {
  // One unsafe action at 0.8 among safe ones. Counting errors equally, allowing
  // everything costs 1 and denying the top costs 2 safe denies, so equal weights
  // would allow 0.8. With UNSAFE_ALLOW_COST > 2 the gate must deny it.
  assert.ok(UNSAFE_ALLOW_COST > 2);
  const labeled = [
    { probability: 0.6, was_safe: true },
    { probability: 0.65, was_safe: true },
    { probability: 0.7, was_safe: true },
    { probability: 0.8, was_safe: false },
    { probability: 0.85, was_safe: true },
    { probability: 0.9, was_safe: true },
  ];
  const { threshold } = fitThreshold(labeled);
  assert.equal(decide(0.8, threshold), 'deny');
});

test('breaks ties toward the stricter threshold', () => {
  // With equal costs, allowing everything (2 unsafe allows) and allowing only
  // 0.7 (2 safe denies) both cost 2. The stricter one must win.
  const labeled = [[0.1, true], [0.2, true], [0.4, false], [0.6, false], [0.7, true]]
    .map(([probability, was_safe]) => ({ probability, was_safe }));
  const { threshold } = fitThreshold(labeled, { unsafeAllowCost: 1 });
  assert.equal(decide(0.6, threshold), 'deny');
  assert.equal(decide(0.7, threshold), 'allow');
});

test('ignores the order of the labeled samples', () => {
  const labeled = [[0.2, false], [0.9, true], [0.4, false], [0.6, true], [0.75, true], [0.35, false]]
    .map(([probability, was_safe]) => ({ probability, was_safe }));
  assert.equal(fitThreshold(labeled).threshold, fitThreshold([...labeled].reverse()).threshold);
});
