# GateKit

Outcome-calibrated thresholds for AI decision gates.

A guard model (for example a classifier that scores whether an agent's tool
call is safe) returns a probability, and most gates turn that into allow or
deny with a fixed 0.5 cutoff. That cutoff is a guess on day one and drifts
further from reality as traffic changes.

GateKit sits beside an existing guard. It logs each decision, accepts the
real outcome once it is known ("was that action actually safe?"), and refits
the allow/deny threshold per customer and per question type from that
history.

## How the threshold is fitted

`calibrate.js` holds all of the logic; the rest is plumbing.

- **Decision rule:** allow only if `probability > threshold`. Because the
  comparison is strict, a threshold of 0 allows everything above zero and a
  threshold equal to the highest observed score denies everything. Both
  extremes are reachable without leaving `[0, 1]`.
- **Candidates:** allow-all, the midpoint between each pair of adjacent
  observed scores, and deny-all. Midpoints keep a margin on both sides
  instead of sitting on a sample.
- **Asymmetric cost:** letting an unsafe action through costs
  `UNSAFE_ALLOW_COST` (5); blocking a safe one costs 1. The cheapest
  candidate wins.
- **Ties go to the stricter threshold.** A safety gate that is unsure should
  deny.
- **Cold start:** below 5 labeled outcomes the fit is noise, so the
  threshold stays at 0.5.

## API

| Endpoint | Purpose |
|---|---|
| `POST /decisions` | Log a guard decision (`customer_id`, `question_shape`, `jev_probability` in `[0, 1]`, `jev_answer` of `allow`/`deny`). Returns the current threshold and a recalibrated answer. |
| `POST /decisions/:id/outcome` | Report ground truth (`was_safe`). Refits that customer and question type. One outcome per decision; a second report is rejected with 409 so no decision is counted twice. |

All input is validated at the boundary: probabilities must be numbers in
`[0, 1]`, keys are bounded strings, and ids are positive integers.

`sdk.js` is the client wrapper a guard hook calls: `logDecision()` before
acting and `reportOutcome()` once the result is known.

## Run it

Requires Node.js 22 or newer.

```bash
npm install
node demo.js     # the whole loop: log, label, watch the threshold move
node --test      # unit and HTTP integration tests
node server.js   # the API on :3000 (PORT to override), stored in gatekit.db
```

The demo logs six labeled decisions, then scores a new decision at 0.6.
A static 0.5 cutoff allows it; the fitted threshold (0.665) denies it,
because the outcomes showed that scores in that range were unsafe.

## Scope

Not built yet:

- Authentication and tenant isolation (`customer_id` is trusted as given)
- Drift detection and alerting (only threshold fitting exists)
- A production database (SQLite proves the mechanism)

The approach depends on outcome labels arriving. GateKit can only be as
good as the feedback the integrating system reports.
