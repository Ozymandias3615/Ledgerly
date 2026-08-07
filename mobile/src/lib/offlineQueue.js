// Local queue for receipts captured with no connection. Stored in IndexedDB
// (not localStorage) since a compressed receipt photo can run a few hundred
// KB and localStorage's ~5MB string-only quota fills up fast. There's no
// Background Sync here - iOS Safari doesn't implement that API at all, so
// syncing only happens while the app is actually open, triggered from
// ReceiptsScreen on mount and on the browser's `online` event.
const DB_NAME = "ledgerly-offline";
const DB_VERSION = 1;
const STORE = "pending-receipts";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "localId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueReceipt(payload) {
  const db = await openDb();
  const record = {
    localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...payload,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return record;
}

export async function listQueuedReceipts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedReceipt(localId) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(localId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Uploads whatever's queued, one at a time. Stops at the first request that
// never reached the server (still offline / connection dropped again) rather
// than burning through retries in a tight loop - the next `online` event or
// screen visit picks up where this left off. A queued item the server
// actually rejects (4xx/5xx with a response) is skipped, not retried
// forever, so one bad record can't block the rest of the queue.
export async function flushQueuedReceipts(api) {
  const items = await listQueuedReceipts();
  let synced = 0;
  for (const item of items) {
    const { localId, createdAt, ...payload } = item;
    try {
      await api.post("/transactions", payload);
      await removeQueuedReceipt(localId);
      synced += 1;
    } catch (err) {
      if (!err.response) break;
    }
  }
  return { synced, remaining: items.length - synced };
}
