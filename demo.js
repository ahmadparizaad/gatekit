// Runs the whole loop for real, using the SDK as an external caller would:
// start the server, log decisions, report outcomes, watch the threshold move.
// This is the "does it actually work" demo, and doubles as SDK coverage
// (api.test.js already covers the HTTP layer sdk.js talks to).
const { openDb } = require('./db');
const { createApp } = require('./api');
const { logDecision, reportOutcome } = require('./sdk');
const { decide, DEFAULT_THRESHOLD } = require('./calibrate');

async function main() {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const baseUrl = `http://localhost:${server.address().port}`;

  const samples = [
    [0.2, false], [0.35, false], [0.55, false],
    [0.58, false], [0.75, true], [0.9, true],
  ];

  console.log('Logging 6 labeled tool-call decisions for customer "acme"...\n');
  for (const [probability, wasSafe] of samples) {
    const decision = await logDecision(baseUrl, {
      customerId: 'acme',
      questionShape: 'tool-call-risk',
      jevProbability: probability,
      jevAnswer: decide(probability, DEFAULT_THRESHOLD),
    });
    const outcome = await reportOutcome(baseUrl, decision.decision_id, wasSafe);
    console.log(
      `probability=${probability.toFixed(2)} was_safe=${wasSafe}` +
      `  ->  threshold now ${outcome.threshold} (n=${outcome.sample_count})`
    );
  }

  console.log('\nNew decision at probability=0.6, against the recalibrated threshold:');
  const next = await logDecision(baseUrl, {
    customerId: 'acme',
    questionShape: 'tool-call-risk',
    jevProbability: 0.6,
    jevAnswer: 'allow',
  });
  console.log(`  threshold=${next.threshold} -> recalibrated_answer=${next.recalibrated_answer}`);
  console.log(`  (a static 0.5 cutoff would have said "${decide(0.6, DEFAULT_THRESHOLD)}"; the fitted threshold decides now)`);

  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
