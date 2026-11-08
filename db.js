// SQLite schema. Rows carry customer_id, but nothing enforces tenant
// isolation yet; see README "Scope".
const Database = require('better-sqlite3');

function openDb(path = 'gatekit.db') {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      question_shape TEXT NOT NULL,   -- groups similar questions for calibration
      jev_probability REAL NOT NULL,  -- Jev's raw confidence, 0..1
      jev_answer TEXT NOT NULL,       -- 'allow' | 'deny'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER NOT NULL REFERENCES decisions(id),
      was_safe INTEGER NOT NULL,      -- 1 = the allowed/denied action was correct, 0 = it wasn't
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One outcome per decision. An index (not a table constraint) so existing
    -- databases pick it up too.
    CREATE UNIQUE INDEX IF NOT EXISTS outcomes_one_per_decision ON outcomes(decision_id);

    CREATE TABLE IF NOT EXISTS calibration_curves (
      customer_id TEXT NOT NULL,
      question_shape TEXT NOT NULL,
      threshold REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (customer_id, question_shape)
    );
  `);
  return db;
}

module.exports = { openDb };
