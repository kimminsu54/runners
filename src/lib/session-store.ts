/**
 * Saved sessions, in the browser only.
 *
 * No network, no account. IndexedDB rather than localStorage because this is
 * structured data that grows one run at a time, and because localStorage is
 * synchronous on the main thread.
 */
"use client";

import { SNAPSHOT_VERSION, type SessionSnapshot } from "./session-snapshot";

const DB_NAME = "stride-lab";
const DB_VERSION = 1;
const STORE = "sessions";

/** Old runs stop being comparable long before they stop being small. */
export const MAX_SAVED_SESSIONS = 30;

export function storageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!storageAvailable()) {
      reject(new Error("이 브라우저에서는 세션을 저장할 수 없습니다."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    // A private window, a blocked origin, or a full disk all land here.
    request.onerror = () => reject(request.error ?? new Error("저장소를 열지 못했습니다."));
    request.onblocked = () => reject(new Error("다른 탭이 저장소를 잡고 있습니다. 탭을 닫고 다시 시도해 주세요."));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("저장소 요청이 실패했습니다."));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function listSnapshots(): Promise<SessionSnapshot[]> {
  const all = await tx<SessionSnapshot[]>("readonly", (store) => store.getAll());
  return all
    .filter((snapshot) => snapshot?.version === SNAPSHOT_VERSION)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
  await tx("readwrite", (store) => store.put(snapshot));
  const all = await listSnapshots();
  // Prune oldest-first so the store cannot grow without bound.
  for (const stale of all.slice(MAX_SAVED_SESSIONS)) {
    await deleteSnapshot(stale.id);
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
}

export async function clearSnapshots(): Promise<void> {
  await tx("readwrite", (store) => store.clear());
}

/** Stable enough for a local store, and available without a dependency. */
export function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
