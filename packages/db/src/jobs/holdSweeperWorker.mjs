// Plain JS, not TypeScript — see `reservationRaceWorker.mjs` (D052) for why:
// worker_threads spawns this as a genuinely separate Node worker (its own
// thread, its own module graph, its own better-sqlite3 connection handle)
// rather than running through Vitest's transform pipeline, so it imports the
// *built* dist output instead of TS source. This is what makes this card's
// sweeper race a real multi-threaded, multi-connection contest against the
// same on-disk file, not a same-thread simulation of one.
import { parentPort, workerData } from "node:worker_threads";
import { createConnection } from "../../dist/connection.js";
import { sweepExpiredHoldsSqlite } from "../../dist/jobs/HoldExpirySweeper.js";

const { dbPath, asOf, readyFlag, goFlag } = workerData;

const ready = new Int32Array(readyFlag);
const go = new Int32Array(goFlag);

const connection = createConnection(dbPath);

// Signal readiness, then block until every worker has signaled and the
// parent releases them all at once — this is what forces the sweeper
// invocations to actually overlap instead of racing to be first to start
// (same start-gate pattern as D052's `reservationRaceWorker.mjs`).
Atomics.add(ready, 0, 1);
Atomics.wait(go, 0, 0);

try {
  const result = sweepExpiredHoldsSqlite(connection, asOf);
  parentPort.postMessage(result);
} finally {
  connection.sqlite.close();
}
