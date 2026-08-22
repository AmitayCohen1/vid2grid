/* ------------------------------------------------------------------
   The shared movement-languages IndexedDB. The vanilla twin used by
   the static pages is public/movement-languages/section-store.js —
   same DB name, stores, and format; keep them in step.
   ------------------------------------------------------------------ */

import { type Choreography, type Section, validateSection } from "./sectionize";

export const DB_NAME = "movement-languages";
export const DB_VERSION = 1;
export const STORE_SECTIONS = "sections";
export const STORE_CHOREOGRAPHIES = "choreographies";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SECTIONS)) db.createObjectStore(STORE_SECTIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_CHOREOGRAPHIES)) db.createObjectStore(STORE_CHOREOGRAPHIES, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => { db.close(); resolve(req.result); };
        t.onerror = () => { db.close(); reject(t.error); };
      }),
  );
}

export function putSection(s: Section): Promise<void> {
  validateSection(s);
  return tx(STORE_SECTIONS, "readwrite", (st) => st.put(s)).then(() => undefined);
}
export function listSections(): Promise<Section[]> {
  return tx<Section[]>(STORE_SECTIONS, "readonly", (st) => st.getAll() as IDBRequest<Section[]>)
    .then((all) => all.sort((a, b) => b.createdAt - a.createdAt));
}
export function deleteSection(id: string): Promise<void> {
  return tx(STORE_SECTIONS, "readwrite", (st) => st.delete(id)).then(() => undefined);
}
export function putChoreography(c: Choreography): Promise<void> {
  return tx(STORE_CHOREOGRAPHIES, "readwrite", (st) => st.put(c)).then(() => undefined);
}
export function listChoreographies(): Promise<Choreography[]> {
  return tx<Choreography[]>(STORE_CHOREOGRAPHIES, "readonly", (st) => st.getAll() as IDBRequest<Choreography[]>);
}
