/* movement-languages comparison model — the pure engine behind the
   "one movement, four readings" explainer (comparison.html). Vanilla UMD so
   the static page can load it and test/notation.test.mjs can require it, the
   same twin pattern as section-store.js.

   This model is ADDITIVE (invariant 1): it never redefines the frozen
   single-dancer pose (body-local [az, el] per segment over an abstract beat);
   it wraps one movement with the four notations' readings of it, a dynamics
   overlay that varies per variant, and the per-window marker of which panel is
   inert. See ../../CLAUDE.md for the eight invariants and the two reference
   docs (movement-notation-parameters.md, movement-notation-visualization2.md). */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.Notation = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Frozen segment ids, duplicated from section-store.js / lib (invariant 1:
     we reference the structure, never redefine it). */
  const BONE_IDS = ["torso","head","ruarm","rfarm","luarm","lfarm","rthigh","rshin","lthigh","lshin"];

  const SYSTEMS = ["laban", "benesh", "ewmn", "motif"];
  /* EWMN is deliberately excluded — it carries no dynamics (§4.7). That
     omission is the whole point of Window 3, so it is enforced, not assumed. */
  const DYNAMICS_SYSTEMS = ["laban", "benesh", "motif"];

  /* ---- Invariant 4: one abstract beat, four axis transforms ---------------
     A single beat drives every panel; each panel maps it onto its own time
     axis. Laban and Motif read bottom-to-top (time flows up); Benesh and EWMN
     read left-to-right (time flows right). We rotate the LAYOUT, never the
     glyphs — so the model hands out an axis unit-vector, and beat→fraction is
     identical for all four panels. */
  const PANELS = {
    laban:  { axis: "vertical",   flow: "up" },
    motif:  { axis: "vertical",   flow: "up" },
    benesh: { axis: "horizontal", flow: "right" },
    ewmn:   { axis: "horizontal", flow: "right" },
  };

  /** Unit vector of increasing time in layout space (y grows downward on a
      canvas, so "up" is -y). */
  function axisVector(panel) {
    const p = PANELS[panel];
    if (!p) throw new Error("unknown panel: " + panel);
    return p.flow === "up" ? { x: 0, y: -1 } : { x: 1, y: 0 };
  }

  /** Fraction of the loop a beat sits at — the SAME for every panel. This is
      what makes one beat advance every playhead by the same amount regardless
      of a panel's orientation (invariant 4). */
  function beatFraction(beat, beats) {
    if (!(beats > 0)) throw new Error("beats must be positive");
    return beat / beats;
  }

  /** Place a beat inside a panel box {x, y, w, h} along that panel's time axis.
      Returns the point and the axis vector used. */
  function beatToAxis(beat, beats, panel, box) {
    const f = beatFraction(beat, beats);
    const v = axisVector(panel);
    const b = box || { x: 0, y: 0, w: 1, h: 1 };
    // Origin is the low-time end of the axis: bottom for "up", left for "right".
    if (v.y === -1) return { along: f, x: b.x, y: b.y + b.h - f * b.h, axis: v };
    return { along: f, x: b.x + f * b.w, y: b.y, axis: v };
  }

  /* ---- Invariant 2: tri-state data, four ink states ----------------------- */
  const TRISTATE = ["value", "unspecified", "not_applicable"];
  /* value        → solid filled: the system states it.
     unspecified  → solid hollow outline, drawn CONFIDENTLY: the system has the
                    slot but leaves it open here.
     not_applicable → nothing drawn: the system has no such slot.
     unknown      → dashed grey: PROVENANCE only (we don't know), never a stored
                    data value (invariant 6: dash = provenance). */
  const INK = {
    value:          { drawn: true,  fill: true,  stroke: true,  dash: false },
    unspecified:    { drawn: true,  fill: false, stroke: true,  dash: false },
    not_applicable: { drawn: false, fill: false, stroke: false, dash: false },
    unknown:        { drawn: true,  fill: false, stroke: true,  dash: true  },
  };
  function inkFor(state) {
    if (!INK[state]) throw new Error("unknown ink state: " + state);
    return INK[state];
  }

  /** Normalise a reading field to {state, value}. A bare value means
      value-state; a tagged object states its own tri-state. `unknown` is a
      render state, not a data state, so it is rejected here. */
  function resolveField(f) {
    if (f && typeof f === "object" && "state" in f) {
      const st = f.state;
      if (st === "unknown") throw new Error("`unknown` is a render state, not a data value (invariant 2)");
      if (TRISTATE.indexOf(st) === -1) throw new Error("bad field state: " + st);
      if (st === "value") {
        if (!("value" in f)) throw new Error("value-state field needs a value");
        return { state: "value", value: f.value };
      }
      return { state: st };
    }
    return { state: "value", value: f };
  }

  /* ---- Dynamics overlay (never core) -------------------------------------
     Window 3's axis. Three variants over identical geometry. The envelope is a
     shape, not a glyph: it drives stage-trail brightness, the Laban wedge, the
     Benesh quality lane and the Motif effort graph. The exact glyph geometry
     (impulse/impact wedge) is school-dependent and UNVERIFIED — the page draws
     it provisionally and logs it. accent = where the stress lands. */
  const DYNAMICS = {
    impulse: { label: "impulse", accent: "start" }, // stress at onset, then decays
    impact:  { label: "impact",  accent: "end"   }, // builds toward a strike at the end
    even:    { label: "even",    accent: "none"  }, // sustained, no stress
  };
  const FLOOR = 0.08; // faint but nonzero, so a fading trail stays visible

  /** Intensity 0..1 at normalised time t (0..1) for a dynamic kind. */
  function envelope(kind, t) {
    if (!DYNAMICS[kind]) throw new Error("unknown dynamic: " + kind);
    const u = Math.max(0, Math.min(1, t));
    if (kind === "impulse") return FLOOR + (1 - FLOOR) * Math.pow(1 - u, 1.6);
    if (kind === "impact")  return FLOOR + (1 - FLOOR) * Math.pow(u, 2.2);
    return 0.55; // even
  }
  function accentAt(kind) {
    if (!DYNAMICS[kind]) throw new Error("unknown dynamic: " + kind);
    return DYNAMICS[kind].accent; // "start" | "end" | "none"
  }
  function systemCarriesDynamics(system) {
    return DYNAMICS_SYSTEMS.indexOf(system) !== -1;
  }

  /* ---- Structural disagreement (Task 7) -----------------------------------
     Which picked systems structurally CANNOT express an axis a peer can.
     Today we compare the one axis we can read from a pose-only dancer's
     capability flags: dynamics. A system that cannot carry an axis some
     *other picked* system can is a gap — invariant 8 (meaningful absence
     gets drawn), surfaced as a line, not just an inert panel badge. */
  function structuralGaps(picked) {
    const gaps = [];
    const anyCarriesDynamics = picked.some(systemCarriesDynamics);
    for (const sys of picked) {
      if (anyCarriesDynamics && !systemCarriesDynamics(sys)) {
        gaps.push({ system: sys, gap: "carries no dynamics — its reading does not change with quality (§4.7)" });
      }
    }
    return gaps;
  }

  /* ---- Reference frames (invariant 3: resolve lazily, per beat) ----------
     Window 1's axis. A written direction means different things under
     different frames; the frame must be resolved at the beat it applies to,
     against the body's state then — resolving once at load draws a figure that
     is "confidently wrong" (parameters/visualization §2.11, §6.3).
       standard — the room. The written direction is already world-relative.
       body     — relative to the torso; rotates with the torso's tilt.
       stance   — relative to the supporting leg.
     Hue = active frame (invariant 6). This is the one window where hue rides a
     near-movement quantity, and only because a frame is identity, not a param.
     NOTE: the resolver works in the sagittal plane (a forward/back torso tilt),
     which is all Window 1 needs; it is a deliberate demo simplification, not a
     general 3-D frame transform. */
  const FRAMES = ["standard", "body", "stance"];
  const FRAME_HUE = { standard: 210, body: 28, stance: 145 }; // distinct hues, degrees
  function frameHue(frame) {
    if (!(frame in FRAME_HUE)) throw new Error("unknown frame: " + frame);
    return FRAME_HUE[frame];
  }
  /** Resolve a written [az, el] against the active frame given body state
      { torsoTilt, stanceTilt } in degrees (sagittal). Returns a new [az, el]. */
  function resolveDirection(written, frame, body) {
    if (FRAMES.indexOf(frame) === -1) throw new Error("unknown frame: " + frame);
    const az = written[0];
    let el = written[1];
    const b = body || {};
    if (frame === "body") el -= (b.torsoTilt || 0);
    else if (frame === "stance") el -= (b.stanceTilt || 0);
    // standard: identity (room frame)
    el = Math.max(-90, Math.min(90, el));
    return [az, el];
  }

  /* ---- Provisional glyph registry ----------------------------------------
     Ids of glyphs whose exact form we could not verify against a manual. The
     page renders these with a provisional marker; each is logged in
     docs/glyph-verification-todo.md. Never invent a Laban-family symbol or
     autocomplete a Motif action stroke as if it were verified. */
  const PROVISIONAL_GLYPHS = [
    "laban.dynamics.impulse-wedge",
    "laban.dynamics.impact-wedge",
    "benesh.quality-lane.stress",
    "benesh.movement-line",
    "benesh.frame",
    "ewmn.movement.plane",
    "motif.effort.graph",
    "motif.action-stroke",
    "laban.key-signature",
  ];
  function isProvisional(id) { return PROVISIONAL_GLYPHS.indexOf(id) !== -1; }

  /* ---- Fixture: one window ------------------------------------------------
     A window is DATA, not code (invariant: a sixth window is a new fixture).
     {
       v, id, title, beats,
       segments: [boneId, ...]                 // which frozen segments move
       movement: { keys: [{ beat, bones: { seg:[az,el], ... } }] }  // additive
       readings: { laban, benesh, ewmn, motif } // each a bag of tri-state fields;
                                                 //   ewmn MUST NOT carry dynamics
                                                 //   a dynamics-system reading may set dynamics:true (a slot marker)
       variants: [{ id, label, dynamics }]      // geometry identical; overlay differs
       inertPanel: system                       // which panel can't tell the variants apart
       captions: { ... }                        // copy, optional
     } */
  const AXES = ["dynamics", "frame"];
  function axisOf(fx) { return fx.axis || "dynamics"; }
  function isQuarter(b) { return Number.isFinite(b) && Math.round(b * 4) === b * 4; }

  function validateFixture(fx) {
    if (!fx || typeof fx !== "object") throw new Error("not an object");
    if (fx.v !== 1) throw new Error("unsupported fixture version");
    if (typeof fx.id !== "string" || !fx.id) throw new Error("missing id");
    if (typeof fx.title !== "string" || !fx.title) throw new Error("missing title");
    if (!Number.isInteger(fx.beats) || fx.beats < 1 || fx.beats > 8) throw new Error("beats must be an integer 1–8");

    if (!Array.isArray(fx.segments) || !fx.segments.length) throw new Error("segments required");
    for (const s of fx.segments) if (BONE_IDS.indexOf(s) === -1) throw new Error("unknown segment: " + s);

    if (!fx.movement || !Array.isArray(fx.movement.keys) || !fx.movement.keys.length) throw new Error("movement.keys required");
    if (fx.movement.keys[0].beat !== 0) throw new Error("a movement key at beat 0 is required");
    for (const k of fx.movement.keys) {
      if (!isQuarter(k.beat) || k.beat < 0 || k.beat >= fx.beats) throw new Error("movement key beats must be quarter multiples in [0, beats)");
      if (!k.bones || typeof k.bones !== "object") throw new Error("movement key missing bones");
      for (const s of fx.segments) {
        const b = k.bones[s];
        if (!Array.isArray(b) || b.length !== 2 || typeof b[0] !== "number" || typeof b[1] !== "number")
          throw new Error("movement key missing segment " + s);
      }
    }

    const axis = axisOf(fx);
    if (AXES.indexOf(axis) === -1) throw new Error("unknown axis: " + axis);

    if (!fx.readings || typeof fx.readings !== "object") throw new Error("readings required");
    for (const sys of SYSTEMS) if (!fx.readings[sys] || typeof fx.readings[sys] !== "object") throw new Error("readings." + sys + " required");
    // Invariant / §4.7: EWMN never carries a dynamics slot.
    if ("dynamics" in fx.readings.ewmn) throw new Error("EWMN carries no dynamics (§4.7) — remove readings.ewmn.dynamics");
    // Every field must resolve (catches a stray `unknown` data value, etc.).
    for (const sys of SYSTEMS) for (const key of Object.keys(fx.readings[sys])) {
      if (key === "dynamics" || key === "frame") continue;
      resolveField(fx.readings[sys][key]);
    }

    if (!Array.isArray(fx.variants) || !fx.variants.length) throw new Error("variants required");
    const seen = new Set();
    for (const v of fx.variants) {
      if (!v || typeof v.id !== "string" || !v.id) throw new Error("variant missing id");
      if (seen.has(v.id)) throw new Error("duplicate variant id: " + v.id);
      seen.add(v.id);
      if (typeof v.label !== "string" || !v.label) throw new Error("variant missing label");
      if (axis === "frame") { if (FRAMES.indexOf(v.frame) === -1) throw new Error("variant has unknown frame: " + v.frame); }
      else if (!DYNAMICS[v.dynamics]) throw new Error("variant has unknown dynamics: " + v.dynamics);
    }

    if (SYSTEMS.indexOf(fx.inertPanel) === -1) throw new Error("inertPanel must be one of the four systems");
    return fx;
  }

  function variantOf(fx, variantId) {
    const v = (fx.variants || []).find((x) => x.id === variantId);
    if (!v) throw new Error("no such variant: " + variantId);
    return v;
  }

  /** The dynamics an active variant applies, as {kind, accent}. */
  function variantDynamics(fx, variantId) {
    const kind = variantOf(fx, variantId).dynamics;
    return { kind, accent: accentAt(kind) };
  }

  /** The value a variant sets on this window's axis, tagged with the axis so
      the two window kinds serialise distinctly. */
  function variantValue(fx, variantId) {
    const v = variantOf(fx, variantId);
    if (axisOf(fx) === "frame") return { axis: "frame", frame: v.frame };
    return { axis: "dynamics", kind: v.dynamics, accent: accentAt(v.dynamics) };
  }

  /** Read one resolved field of a system's reading (variant-independent —
      geometry and spatial fields never change between variants). */
  function readingField(fx, system, key) {
    const r = fx.readings[system];
    if (!r || !(key in r)) throw new Error("no field " + system + "." + key);
    return resolveField(r[key]);
  }

  function sortedKeys(o) { return Object.keys(o).sort(); }
  /** Deterministic, key-sorted JSON so serialisations compare byte-for-byte. */
  function canonical(o) {
    return JSON.stringify(o, function (k, val) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const out = {};
        for (const kk of sortedKeys(val)) out[kk] = val[kk];
        return out;
      }
      return val;
    });
  }

  /** Canonical serialisation of one system's reading under one variant. The
      active variant's axis value is folded into every system EXCEPT the inert
      panel, so the inert reading is byte-identical across variants and the
      others differ — the acceptance test for every window. (Window 3: inert
      EWMN, dynamics axis. Window 1: inert Motif, frame axis.) */
  function serializeReading(fx, system, variantId) {
    const base = fx.readings[system];
    const out = {};
    for (const key of sortedKeys(base)) {
      if (key === "dynamics" || key === "frame") continue;
      out[key] = resolveField(base[key]);
    }
    if (system !== fx.inertPanel) out[axisOf(fx)] = variantValue(fx, variantId);
    return canonical(out);
  }

  return {
    BONE_IDS, SYSTEMS, DYNAMICS_SYSTEMS, AXES,
    PANELS, axisVector, beatFraction, beatToAxis,
    TRISTATE, INK, inkFor, resolveField,
    DYNAMICS, envelope, accentAt, systemCarriesDynamics, structuralGaps,
    FRAMES, FRAME_HUE, frameHue, resolveDirection,
    PROVISIONAL_GLYPHS, isProvisional,
    validateFixture, axisOf, variantOf, variantDynamics, variantValue, readingField, serializeReading,
  };
});
