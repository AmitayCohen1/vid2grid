/* movement-languages shared store — the vanilla twin of lib/sectionize.ts +
   lib/sectionsDb.ts. One DB per origin: "movement-languages" v1, stores
   "sections" and "choreographies" (keyPath "id"). Keep in step with the TS side. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.SectionStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const DB_NAME = "movement-languages", DB_VERSION = 1;
  const S = "sections", C = "choreographies";
  const BONE_IDS = ["torso","head","ruarm","rfarm","luarm","lfarm","rthigh","rshin","lthigh","lshin"];

  function isQuarter(b) { return Number.isFinite(b) && Math.round(b * 4) === b * 4; }

  function validateSection(o) {
    const s = o;
    if (!s || typeof s !== "object") throw new Error("not an object");
    if (s.v !== 1) throw new Error("unsupported section version");
    if (typeof s.id !== "string" || !s.id) throw new Error("missing id");
    if (typeof s.name !== "string") throw new Error("missing name");
    if (typeof s.createdAt !== "number") throw new Error("missing createdAt");
    if (!Number.isInteger(s.beats) || s.beats < 1 || s.beats > 8) throw new Error("beats must be an integer 1–8");
    if (typeof s.tempo !== "number" || s.tempo <= 0) throw new Error("bad tempo");
    if (!s.source || typeof s.source !== "object" || typeof s.source.file !== "string" ||
        typeof s.source.startSec !== "number" || typeof s.source.endSec !== "number")
      throw new Error("bad source (need file, startSec, endSec)");
    if (!Array.isArray(s.keys) || !s.keys.length) throw new Error("a key at beat 0 is required");
    for (const k of s.keys) {
      if (!isQuarter(k.beat) || k.beat < 0 || k.beat >= s.beats)
        throw new Error("key beats must be quarter multiples in [0, beats)");
      if (!k.pose || typeof k.pose !== "object" || !k.pose.bones) throw new Error("key missing pose");
      for (const id of BONE_IDS) {
        const b = k.pose.bones[id];
        if (!Array.isArray(b) || b.length !== 2 || typeof b[0] !== "number" || typeof b[1] !== "number")
          throw new Error("pose missing bone " + id);
      }
      for (const f of ["x", "z", "facing", "hipY"]) if (typeof k.pose[f] !== "number") throw new Error("pose missing " + f);
    }
    if (s.keys[0].beat !== 0) throw new Error("a key at beat 0 is required");
    return s;
  }

  function buildChoreographyKeys(items, sectionsById) {
    const keys = [], missing = [];
    let cursor = 0;
    for (const it of items || []) {
      const sec = sectionsById[it.sectionId];
      if (!sec) { missing.push(it.sectionId); continue; }
      const rep = Math.max(1, Math.round(it.repeat || 1));
      for (let r = 0; r < rep; r++) {
        for (const k of sec.keys) keys.push({ beat: cursor + k.beat, pose: JSON.parse(JSON.stringify(k.pose)) });
        cursor += sec.beats;
      }
    }
    return { keys, totalBeats: cursor, missing };
  }

  function available() { return typeof indexedDB !== "undefined"; }
  function open() {
    return new Promise(function (resolve, reject) {
      if (!available()) return reject(new Error("IndexedDB unavailable in this browser/mode"));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(S)) db.createObjectStore(S, { keyPath: "id" });
        if (!db.objectStoreNames.contains(C)) db.createObjectStore(C, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB open failed")); };
    });
  }
  function tx(store, mode, run) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          const t = db.transaction(store, mode);
          const req = run(t.objectStore(store));
          t.oncomplete = function () { db.close(); resolve(req && req.result); };
          t.onerror = function () { db.close(); reject(t.error); };
        } catch (e) {
          db.close();
          reject(e);
        }
      });
    });
  }

  return {
    DB_NAME, validateSection, buildChoreographyKeys, available,
    putSection: (s) => Promise.resolve()
      .then(() => { validateSection(s); })
      .then(() => tx(S, "readwrite", (st) => st.put(s))),
    getSection: (id) => tx(S, "readonly", (st) => st.get(id)),
    listSections: () => tx(S, "readonly", (st) => st.getAll()).then((a) => (a || []).sort((x, y) => y.createdAt - x.createdAt)),
    deleteSection: (id) => tx(S, "readwrite", (st) => st.delete(id)),
    putChoreography: (c) => tx(C, "readwrite", (st) => st.put(c)),
    getChoreography: (id) => tx(C, "readonly", (st) => st.get(id)),
    listChoreographies: () => tx(C, "readonly", (st) => st.getAll()).then((a) => a || []),
    deleteChoreography: (id) => tx(C, "readwrite", (st) => st.delete(id)),
    exportAll: function () {
      return Promise.all([this.listSections(), this.listChoreographies()]).then(function (r) {
        return { v: 1, sections: r[0], choreographies: r[1] };
      });
    },
    importData: function (obj) {
      const self = this;
      const secs = (obj && obj.sections) || (obj && obj.v === 1 && obj.keys ? [obj] : []);
      const chors = (obj && obj.choreographies) || [];
      return Promise.all(
        secs.map((s) => self.putSection(s)).concat(chors.map((c) => self.putChoreography(c))),
      ).then(() => ({ sections: secs.length, choreographies: chors.length }));
    },
  };
});
