// =============================================================
// Shared Dreams & Machines helpers
// Used by both the roller popover and the character sheet modal.
// =============================================================

export const ID = "com.thuknights.dnm-obr";
export const CHAR_KEY = `${ID}/char`;
// Kept at the original key so existing rooms do not lose their roll log.
export const ROOM_KEY = "com.thuknights.dnm-rolls/state";
export const CHANNEL = `${ID}/events`;

// v2 (extension 0.8.0): epochs added. A client running the v1 shape simply has no
// epochs key; readers must default it rather than assume presence, because room
// metadata written before 0.8.0 is still sitting in live rooms.
export const EMPTY_STATE = {
  v: 2, momentum: 0, threat: 0, log: [],
  epochs: { scene: 0, session: 0, adventure: 0, breather: 0, break: 0, bed: 0 },
};

// The boundaries a GM can push to the whole table. Rests are listed alongside scene
// boundaries because they work the same way here: a counter the GM increments and
// each sheet catches up to. They differ only in what the sheet does on arrival.
export const EPOCH_KEYS = ["scene", "session", "adventure", "breather", "break", "bed"];

export function emptyEpochs() {
  return EPOCH_KEYS.reduce((acc, k) => { acc[k] = 0; return acc; }, {});
}

// Always read epochs through this. Rooms predating 0.8.0 have no epochs key at all,
// and a partial object is possible if a key is added in a later version.
export function readEpochs(state) {
  return { ...emptyEpochs(), ...(state?.epochs || {}) };
}

// Display names for the boundaries. Lived in roller.js until 0.9.0; moved here
// because the party panel names the same boundaries when it says what a character
// is waiting on, and two copies would drift the first time one is renamed.
export const EPOCH_LABELS = {
  breather: "Breather", break: "Break", bed: "Bed",
  scene: "End Scene", session: "New Session", adventure: "New Adventure",
};

// -------------------------------------------------------------
// Party status (0.9.0)
// -------------------------------------------------------------
// The character's half of the epoch bargain, read from the CP payload. This
// deliberately MIRRORS readAppliedEpochs() in the creator rather than reimplementing
// it: same six keys, same coercion, same "missing means null, not zero".
//
// The distinction that matters is null vs all-zeros. A character with no
// appliedEpochs has never met this room. The creator's catchUpToRoomEpochs() adopts
// the room's position for it and applies nothing, on purpose — otherwise every newly
// built character would arrive and immediately run a rest it was never present for.
// Reading that as zeros would report it as behind by however many boundaries the
// table has been through, and send the GM chasing a player with nothing to catch up
// on. That is the opposite of what this panel is for.
export function readAppliedEpochs(char) {
  const stored = char?.appliedEpochs;
  if (!stored || typeof stored !== "object") return null;
  return EPOCH_KEYS.reduce((acc, k) => {
    acc[k] = Math.max(0, Math.round(Number(stored[k]) || 0));
    return acc;
  }, {});
}

// Returns { state: "unsynced" | "behind" | "current", pending: [boundaryKey] }.
//
// Applied ahead of the room is treated as current, not as an error. It happens
// legitimately when room metadata is cleared or a room is rebuilt, and the creator's
// own comparison is `room > applied` for the same reason.
export function epochStatus(char, roomEpochs) {
  const applied = readAppliedEpochs(char);
  if (!applied) return { state: "unsynced", pending: [] };
  const room = { ...emptyEpochs(), ...(roomEpochs || {}) };
  const pending = EPOCH_KEYS.filter((k) => (Number(room[k]) || 0) > applied[k]);
  return { state: pending.length ? "behind" : "current", pending };
}
export const MAX_LOG_ENTRIES = 40;
export const MAX_STATE_BYTES = 11000; // headroom inside the shared 16 kB room budget

// -------------------------------------------------------------
// Shared event reducer
// -------------------------------------------------------------
// Rolls and pool changes travel as broadcast events rather than each client
// writing room metadata directly. Two reasons:
//
//   1. Broadcast is not role restricted, so a player can announce a roll even
//      where a direct metadata write would be refused.
//   2. It makes the GM the only writer. The previous read-modify-write from
//      every client meant two simultaneous rolls could clobber each other.
//
// Every client applies events locally for an instant view; the GM's background
// page applies the same events to room metadata so history survives refreshes
// and late joins. Because both sides run this same function, they converge.
//
// Roll events carry an id and are deduplicated, so applying one twice is safe.
// Pool events are deltas and cannot be, which is why clients do not apply them
// optimistically and instead wait for the GM's metadata update.
export function applyEvent(state, ev) {
  const next = { ...EMPTY_STATE, ...state };
  next.log = Array.isArray(next.log) ? next.log.slice() : [];

  if (ev?.type === "roll" && ev.entry) {
    if (next.log.some((e) => e.id === ev.entry.id)) return next;
    next.log.unshift(ev.entry);
    next.log = next.log.slice(0, MAX_LOG_ENTRIES);
  } else if (ev?.type === "action" && ev.entry) {
    // v1.17. Actions share the log with rolls: same dedupe by id, same cap, same
    // trim budget. They are deliberately not a second list — the point of the log
    // is one ordered record of what happened at the table, and two lists would
    // need interleaving by timestamp at every consumer instead of once here.
    //
    // An action entry carries kind:"action". A roll entry carries no kind at all,
    // including the ones already sitting in a live room's metadata from before
    // v1.17, which is why consumers must treat a missing kind as a roll rather
    // than requiring the field.
    if (next.log.some((e) => e.id === ev.entry.id)) return next;
    next.log.unshift(ev.entry);
    next.log = next.log.slice(0, MAX_LOG_ENTRIES);
  } else if (ev?.type === "epoch" && EPOCH_KEYS.includes(ev.boundary)) {
    // v0.8.0. The GM pushes a boundary to the whole table by incrementing a counter
    // here. Nothing about any character is touched, and nothing needs to know what a
    // character looks like — this file stays ignorant of the DM1 format, which is the
    // whole reason the snapshot split exists.
    //
    // Each sheet stores the epoch it last applied and catches up when it next opens.
    // That is what makes this work for the sheets that are CLOSED, which at any moment
    // is nearly all of them. A broadcast alone would only reach whoever happened to be
    // looking at their sheet when the GM pressed the button.
    //
    // Monotonic increment, never assignment: two GMs, or a GM with the panel open in
    // two windows, cannot clobber each other into a lower value.
    const epochs = readEpochs(next);
    epochs[ev.boundary] = epochs[ev.boundary] + 1;
    next.epochs = epochs;
    // The press is logged like any other action so the table sees who called the rest.
    if (ev.entry && !next.log.some((e) => e.id === ev.entry.id)) {
      next.log.unshift(ev.entry);
      next.log = next.log.slice(0, MAX_LOG_ENTRIES);
    }
  } else if (ev?.type === "pool" && (ev.pool === "momentum" || ev.pool === "threat")) {
    next[ev.pool] = Math.max(0, (next[ev.pool] || 0) + (ev.delta || 0));
  } else if (ev?.type === "clear") {
    next.log = [];
  }
  return next;
}

// Trim to fit the room metadata budget before writing.
export function trimState(state) {
  const next = { ...state };
  // Epochs are a fixed handful of integers and must survive trimming. Losing one
  // would send every sheet backwards and re-apply a boundary the table already had.
  next.epochs = readEpochs(next);
  next.log = (next.log || []).slice(0, MAX_LOG_ENTRIES);
  while (next.log.length > 1 && JSON.stringify(next).length > MAX_STATE_BYTES) next.log.pop();
  return next;
}

export const ATTRS = { might: "Might", quickness: "Quickness", insight: "Insight", resolve: "Resolve" };
export const SKILLS = {
  fight: "Fight", move: "Move", operate: "Operate", sneak: "Sneak",
  study: "Study", survive: "Survive", talk: "Talk",
};

// -------------------------------------------------------------
// Base64 helpers
// -------------------------------------------------------------
// The creator strips '=' padding when building a code, so we re-pad before
// decoding. It also URI-encodes before base64 so non-ASCII names survive.
export function b64decode(v) {
  let x = v.replace(/-/g, "+").replace(/_/g, "/");
  const pad = x.length % 4;
  if (pad === 2) x += "==";
  else if (pad === 3) x += "=";
  return decodeURIComponent(atob(x));
}

export function b64encode(str) {
  return btoa(encodeURIComponent(str)).replace(/=/g, "");
}

// -------------------------------------------------------------
// Character codes
// -------------------------------------------------------------
// A DM1 code is a '-' joined list of segments. We only care about two:
//
//   CP  the full character object, which holds everything mutable
//   SN  the computed snapshot the creator adds from v1.11 onward
//
// Every other segment is left untouched. That is what makes the round trip
// lossless: we never need to understand a segment in order to preserve it.
export function parseCode(code) {
  const trimmed = (code || "").trim();
  if (!trimmed) return { error: "Paste a character code first." };
  const parts = trimmed.split("-");
  if (parts[0] !== "DM1") return { error: "That does not look like a Dreams & Machines code." };

  const cpIndex = parts.findIndex((p) => p.startsWith("CP"));
  const snIndex = parts.findIndex((p) => p.startsWith("SN"));
  if (cpIndex < 0) return { error: "This code has no character payload." };
  if (snIndex < 0) {
    return { error: "This code was made before Owlbear support was added. Re-export it from the character creator (version 1.11 or newer)." };
  }

  let char, snap;
  try {
    char = JSON.parse(b64decode(parts[cpIndex].slice(2)));
    snap = JSON.parse(b64decode(parts[snIndex].slice(2)));
  } catch (err) {
    return { error: "That code is damaged and could not be read." };
  }
  return { parts, char, snap, cpIndex, snIndex };
}

// Rebuild a code with an edited character object, leaving all other segments
// byte for byte identical to how the creator wrote them.
export function rebuildCode(parts, cpIndex, char) {
  const next = parts.slice();
  next[cpIndex] = "CP" + b64encode(JSON.stringify(char));
  return next.join("-");
}

// -------------------------------------------------------------
// Roll engine
// -------------------------------------------------------------
// Lifted from classifyDie() in the character creator, and confirmed against
// the core rulebook: a die equal to or under the Attribute is a success, a die
// equal to or under the Skill is a critical worth two successes, and a natural
// 20 is a Complication. Order matters, 20 is never a success.
export function classifyDie(value, attrValue, skillValue) {
  if (value === 20) return "complication";
  if (value <= skillValue) return "crit";
  if (value <= attrValue) return "success";
  return "fail";
}

export function rollDice(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 20));
  return out;
}

export function resolveRoll(dice, attrValue, skillValue, diff) {
  let successes = 0;
  let complications = 0;
  const detail = dice.map((d) => {
    const kind = classifyDie(d, attrValue, skillValue);
    if (kind === "crit") successes += 2;
    else if (kind === "success") successes += 1;
    else if (kind === "complication") complications += 1;
    return { d, kind };
  });
  return {
    detail, successes, complications,
    passed: successes >= diff,
    momentumGained: Math.max(0, successes - diff),
  };
}

// Exhaustion shuts down an attribute: tests against it fail automatically.
// The types themselves ride in the snapshot from creator v1.12 so this file
// does not need a copy of the rules table.
export function shutDownAttrs(snap, char) {
  const active = Array.isArray(char?.activeExhaustion) ? char.activeExhaustion : [];
  const types = snap?.exhaustionTypes || [];
  return new Set(types.filter((t) => active.includes(t.key)).map((t) => t.attr));
}

export const clamp = (n, lo, hi) => (Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)));
