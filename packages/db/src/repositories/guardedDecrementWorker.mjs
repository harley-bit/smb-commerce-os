// Plain JS, not TypeScript: worker_threads spawns this as a genuinely
// separate Node worker (its own thread, its own module graph) rather than
// running through Vitest's transform pipeline, so it imports the *built*
// dist output (real .js files with real relative extensions) instead of
// TS source. This is what makes D040's concurrency test a real
// multi-threaded, multi-connection race against the same SQLite file
// rather than a same-thread, same-call-stack simulation of one.
import { parentPort, workerData } from "node:worker_threads";
import { createTenantContext } from "@smb-os/domain";
import { createConnection } from "../../dist/connection.js";
import { InventoryMovementRepository } from "../../dist/repositories/InventoryMovementRepository.js";

const { dbPath, merchantId, variantId, locationId, actorUserId, readyFlag, goFlag } = workerData;

const ready = new Int32Array(readyFlag);
const go = new Int32Array(goFlag);

const connection = createConnection(dbPath);
const repo = new InventoryMovementRepository(connection);
const ctx = createTenantContext(merchantId);

// Signal readiness, then block until every worker has signaled and the
// parent releases them all at once — this is what forces the attempts to
// actually overlap instead of racing to be first to start.
Atomics.add(ready, 0, 1);
Atomics.wait(go, 0, 0);

try {
  const id = repo.guardedDecrement(ctx, {
    variantId,
    locationId,
    kind: "SALE",
    quantity: 1,
    occurredAt: new Date().toISOString(),
    actorUserId,
    note: "Concurrent sale attempt",
  });
  parentPort.postMessage({ ok: true, id });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    name: err instanceof Error ? err.name : "UnknownError",
    message: err instanceof Error ? err.message : String(err),
  });
} finally {
  connection.sqlite.close();
}
