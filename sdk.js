// The 10-line wrapper a customer's existing guard hook (jev-guard, pi-verdict,
// a homegrown one) drops in alongside its own Jev call. Not a replacement for
// their guard; an add-on that recalibrates the threshold over time.
async function logDecision(baseUrl, { customerId, questionShape, jevProbability, jevAnswer }) {
  const res = await fetch(`${baseUrl}/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer_id: customerId,
      question_shape: questionShape,
      jev_probability: jevProbability,
      jev_answer: jevAnswer,
    }),
  });
  if (!res.ok) throw new Error(`gatekit: failed to log decision (${res.status})`);
  return res.json(); // { decision_id, threshold, recalibrated_answer }
}

async function reportOutcome(baseUrl, decisionId, wasSafe) {
  const res = await fetch(`${baseUrl}/decisions/${decisionId}/outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ was_safe: wasSafe }),
  });
  if (!res.ok) throw new Error(`gatekit: failed to report outcome (${res.status})`);
  return res.json(); // { threshold, sample_count }
}

module.exports = { logDecision, reportOutcome };
