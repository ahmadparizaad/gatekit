// Standalone entry point: `node server.js` to run the API on its own,
// separate from demo.js's in-process usage.
const { openDb } = require('./db');
const { createApp } = require('./api');

const PORT = process.env.PORT || 3000;
const db = openDb('gatekit.db');
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`gatekit listening on :${PORT}`);
});
