// Fits a decision threshold from labeled (probability, was_safe) outcomes.
// This is the one piece of real logic in GateKit; db, api and sdk are
// plumbing around it.
//
// Decision rule: allow iff probability > threshold. Strict, so a threshold
// equal to the highest observed probability denies everything and 0 allows
// everything above zero. Both extremes stay reachable without leaving [0, 1].
const DEFAULT_THRESHOLD = 0.5;
const MIN_SAMPLES = 5; // below this, a fitted threshold is just noise

// Letting an unsafe action through is worse than blocking a safe one. A
// wrong deny costs 1; a wrong allow costs this much.
const UNSAFE_ALLOW_COST = 5;

function decide(probability, threshold) {
  return probability > threshold ? 'allow' : 'deny';
}

// Every distinct cut of the observed probabilities: allow-all (0), the
// midpoint between each adjacent pair, and deny-all (the maximum).
// Midpoints leave a margin on both sides instead of sitting on a sample.
function candidateThresholds(labeled) {
  const values = [...new Set(labeled.map((d) => d.probability))].sort((a, b) => a - b);
  const midpoints = values.slice(1).map((v, i) => (values[i] + v) / 2);
  return [0, ...midpoints, values[values.length - 1]];
}

function cost(labeled, threshold, unsafeAllowCost) {
  return labeled.reduce((total, d) => {
    const allowed = decide(d.probability, threshold) === 'allow';
    if (allowed && !d.was_safe) return total + unsafeAllowCost;
    if (!allowed && d.was_safe) return total + 1;
    return total;
  }, 0);
}

function fitThreshold(labeled, { unsafeAllowCost = UNSAFE_ALLOW_COST } = {}) {
  if (labeled.length < MIN_SAMPLES) {
    return { threshold: DEFAULT_THRESHOLD, sampleCount: labeled.length };
  }

  // Lowest cost wins; ties go to the higher (stricter) threshold, since a
  // safety gate that is unsure should deny.
  let best = { threshold: DEFAULT_THRESHOLD, cost: Infinity };
  for (const t of candidateThresholds(labeled)) {
    const c = cost(labeled, t, unsafeAllowCost);
    if (c < best.cost || (c === best.cost && t > best.threshold)) {
      best = { threshold: t, cost: c };
    }
  }

  return { threshold: best.threshold, sampleCount: labeled.length };
}

module.exports = { fitThreshold, decide, DEFAULT_THRESHOLD, MIN_SAMPLES, UNSAFE_ALLOW_COST };
