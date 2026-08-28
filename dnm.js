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
// v3 (extension 0.9.5): compAt added — the die value at or above which a roll counts
// as a Complication. 20 is the rulebook default; the GM lowers it to make a scene
// harder. Rooms written before 0.9.5 have no compAt, so readers default it rather
// than assume presence, exactly as epochs did.
// v4 (extension 0.9.6): bonds added — a short queue of pending bond effects waiting
// for the sheet they belong to. Same defaulting rule again: a room written before
// 0.9.6 has no bonds key, and a reader must treat that as an empty queue.
export const EMPTY_STATE = {
  v: 4, momentum: 0, threat: 0, log: [],
  epochs: { scene: 0, session: 0, adventure: 0, breather: 0, break: 0, bed: 0 },
  compAt: 20,
  bonds: [],
};

// The range the GM may choose from. Below 15 a d20 would complicate more often than
// not, which stops being a difficult scene and starts being a broken one.
export const COMP_AT_MIN = 15;
export const COMP_AT_MAX = 20;

export function readCompAt(state) {
  const raw = state?.compAt;
  // Checked for absence BEFORE coercion. Number(null) is 0, which is finite, so a
  // null would otherwise clamp to the floor and quietly make every roll of 15+ a
  // Complication in a room that had never set a threshold.
  if (raw === null || raw === undefined || raw === "") return COMP_AT_MAX;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return COMP_AT_MAX;
  return Math.max(COMP_AT_MIN, Math.min(COMP_AT_MAX, n));
}

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
// Event sanitising (0.9.1)
// -------------------------------------------------------------
// Every sender in this codebase already clamps these fields before broadcasting.
// That is not worth anything on its own: OBR.broadcast is open to every client in
// the room, so the clamp runs in a tab the sender controls and can simply not run.
// Until now the reducer took whatever arrived and put it straight in the log.
//
// Two things went wrong with an oversized entry, and neither needed malice — a bug
// in a future sender would do it just as well:
//
//   1. `trimState()` drops log entries until the state fits, but it stops at one
//      entry. A single entry larger than the budget therefore survives and the write
//      exceeds the room's 16 kB, which is shared with every other extension in the
//      room, not just this one.
//   2. `renderRollEntry()` builds one DOM node per die. An entry claiming a hundred
//      thousand dice freezes every client that renders the log, including the GM's.
//
// So the limits are enforced HERE, in the reducer both sides run, rather than at each
// call site. A sender that forgets to clamp is now harmless, and so is one that never
// intended to clamp at all.
export const FIELD_LIMITS = { who: 24, label: 48, detail: 80, id: 40, dice: 20 };

const DIE_KINDS = new Set(["crit", "success", "complication", "fail"]);

function cleanText(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

function cleanCount(value) {
  const n = Math.round(Number(value) || 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 0;
}

// Returns a normalised entry, or null when there is not enough here to log.
// Entries already sitting in a live room were written by clamped senders, so running
// them through this is idempotent and nothing in an existing log changes shape.
export function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = cleanText(entry.id, FIELD_LIMITS.id);
  if (!id) return null;

  const t = Number(entry.t);
  const base = {
    id,
    t: Number.isFinite(t) ? t : Date.now(),
    who: cleanText(entry.who, FIELD_LIMITS.who),
    label: cleanText(entry.label, FIELD_LIMITS.label),
  };

  if (entry.kind === "action") {
    const pool = entry.pool === "momentum" || entry.pool === "threat" ? entry.pool : null;
    const delta = Math.round(Number(entry.delta) || 0);
    return {
      ...base,
      kind: "action",
      detail: cleanText(entry.detail, FIELD_LIMITS.detail),
      pool,
      // Clamped rather than dropped: a delta is display only here, the pool itself
      // moves through the "pool" event, so a silly number misinforms rather than
      // miscounts. It still must not be unbounded text in the metadata.
      delta: Math.max(-999, Math.min(999, delta)),
    };
  }

  // A roll entry. `detail` is the dice, and it is the field that has to be bounded
  // hardest — it is the only one the renderer loops over.
  const detail = Array.isArray(entry.detail) ? entry.detail : [];
  return {
    ...base,
    detail: detail.slice(0, FIELD_LIMITS.dice).map((d) => ({
      d: cleanCount(d && d.d),
      kind: DIE_KINDS.has(d && d.kind) ? d.kind : "fail",
    })),
    an: cleanText(entry.an, FIELD_LIMITS.label),
    av: cleanCount(entry.av),
    sn: cleanText(entry.sn, FIELD_LIMITS.label),
    sv: cleanCount(entry.sv),
    diff: cleanCount(entry.diff),
    succ: cleanCount(entry.succ),
    comp: cleanCount(entry.comp),
    pass: !!entry.pass,
    gain: cleanCount(entry.gain),
    hidden: !!entry.hidden,
    // 0.9.5. `gain` already records the surplus; these two decide whether it can still
    // be claimed and by whom, so they have to survive the round trip like `conceal`.
    claimed: !!entry.claimed,
    compAt: cleanCount(entry.compAt) || COMP_AT_MAX,
    // 0.9.4. These decide who may draw the entry, so the reducer has to carry them —
    // stripping them here would turn a concealed roll into an ordinary one the moment
    // it round-tripped through room metadata, which is the worst possible failure for
    // this feature. Both are constrained rather than copied: an arbitrary `conceal`
    // string would fall through canRevealConcealed() as "not concealed".
    conceal: entry.conceal === "hidden" || entry.conceal === "secret" ? entry.conceal : null,
    by: cleanText(entry.by, FIELD_LIMITS.id) || null,
  };
}

// -------------------------------------------------------------
// Who may read a concealed roll (0.9.4)
// -------------------------------------------------------------
// Two kinds of concealment, and they give very different guarantees.
//
// SECRET is absolute. Nothing is broadcast and nothing is written to room metadata,
// so the result exists only in the roller's own browser. Only the GM may roll it.
//
// HIDDEN is a courtesy, and it is important to be straight about that. From 0.9.4 a
// player's hidden roll must reach the GM — "the GM should know everything" — and
// Owlbear offers NO private channel to do it with: `OBR.broadcast.sendMessage` takes
// only ALL, REMOTE or LOCAL, and every storage surface it has (room metadata, player
// metadata, item metadata) is readable by every client in the room.
//
// So the full entry travels to everyone and each client decides what to draw. That
// hides the result from other players' SCREENS. It does not hide it from a player who
// opens devtools. Anyone wanting a result that a player genuinely cannot read has to
// use Secret, which is why Secret still exists rather than being folded into Hidden.
//
// 0.9.3 sent a redacted placeholder instead, which really was unreadable — but it also
// meant the GM could not see a player's hidden roll, which is the thing being fixed.
export function canRevealConcealed(entry, viewer) {
  if (!entry || !entry.conceal) return true;      // an ordinary roll
  // A secret roll never leaves its own browser, so anything holding one may draw it.
  if (entry.conceal === "secret") return true;
  if (viewer?.role === "GM") return true;
  return !!(viewer?.playerId && entry.by === viewer.playerId);
}

// -------------------------------------------------------------
// Bond effects (0.9.6)
// -------------------------------------------------------------
// A bond pays out on somebody ELSE'S sheet, and at any moment nearly every sheet at
// the table is closed. That is the same problem epochs solved, so this is the same
// answer: a small queue in room metadata that each sheet drains when it next opens,
// rather than a broadcast that only reaches whoever happens to be looking.
//
// Two kinds, and they resolve at opposite ends, which is not an inconsistency but
// the rules:
//
//   RIVALRY  "When an ally with whom the character has a rivalry regains one or more
//            Spirit by adding to Threat, the character recovers one Spirit as well."
//            The BOND HOLDER benefits, and only their sheet knows their bond list.
//            So Adrenaline Rush announces the actor and nothing else; every other
//            sheet decides for itself whether it is owed a Spirit. Note the
//            direction — it reads backwards at first. The person spending Threat
//            does not need a bond at all.
//
//   GRANT    Second Wind, and giving up Spirit at a rest. Here the HELPER holds the
//            bond and the +1 lands on the ally, so the helper has to name a target
//            and works the sum out at their end. The queue just carries the total.
//
// Not GM-only. A forged rivalry effect can only land on a sheet that already holds a
// rivalry naming that actor, for one Spirit; a forged grant names a target who has to
// exist. That is ordinary play with a typo, not a privilege to guard, and putting it
// in isGmOnlyEvent() would break every bond at a GM-less table.
export const MAX_BOND_EFFECTS = 12;

// An effect older than this is dropped rather than kept waiting. A player who has not
// opened their sheet in six hours is at a different session, and arriving to a Spirit
// from a fight two weeks ago is worse than missing it.
export const BOND_EFFECT_TTL_MS = 6 * 60 * 60 * 1000;

// 0.9.8 adds "drive": the Maverick temperament's "when the GM spends 3 or more Threat
// at once, regain 1 Spirit". It travels the same queue as the two bonds because it has
// the same problem — it pays out on sheets that are shut.
const BOND_KINDS = new Set(["rivalry", "grant", "drive"]);

// The threshold in the Maverick drive's own text. Below 0.9.7 this was undetectable:
// a GM spending 3 pressed - three times and it arrived as three spends of 1, so
// "at once" had nothing to read. Coalescing is what made this possible at all.
export const DRIVE_THREAT_SPEND_MIN = 3;

// Bond names are free text typed during character creation, and the character names
// they have to match are free text too. Case and stray spaces are the difference
// between a bond that fires and one that silently does nothing, so both sides
// normalise through this single function rather than each comparing in its own way.
export function bondNameKey(name) {
  return String(name == null ? "" : name).trim().toLowerCase();
}

export function bondNamesMatch(a, b) {
  const x = bondNameKey(a);
  return !!x && x === bondNameKey(b);
}

export function sanitizeBondEffect(effect) {
  if (!effect || typeof effect !== "object") return null;
  if (!BOND_KINDS.has(effect.kind)) return null;
  const id = cleanText(effect.id, FIELD_LIMITS.id);
  if (!id) return null;
  const t = Number(effect.t);
  const base = {
    id,
    t: Number.isFinite(t) ? t : Date.now(),
    kind: effect.kind,
    // Who caused it. Present on both kinds so the recipient's log can say why.
    from: cleanText(effect.from, FIELD_LIMITS.who),
  };
  if (effect.kind === "rivalry") return base;

  if (effect.kind === "drive") {
    // No target: like a rivalry, every sheet decides for itself whether it is owed —
    // here by reading its own temperament rather than its own bond list. `amount` is
    // the size of the spend, carried only so the recipient's log can say what
    // happened, and clamped like any other untrusted number.
    return {
      ...base,
      drive: cleanText(effect.drive, FIELD_LIMITS.id),
      amount: Math.max(0, Math.min(999, Math.round(Number(effect.amount) || 0))),
    };
  }

  const amount = Math.round(Number(effect.amount) || 0);
  return {
    ...base,
    target: cleanText(effect.target, FIELD_LIMITS.who),
    // Second Wind restores at most 3, plus at most 1 from a supportive bond. Four is
    // the ceiling the rules allow and the reducer is where it is worth enforcing,
    // because the sender's clamp runs in a tab the sender controls.
    amount: Math.max(0, Math.min(4, amount)),
    source: cleanText(effect.source, FIELD_LIMITS.label),
  };
}

// Rooms written before 0.9.6 have no bonds key at all, so this defaults rather than
// assuming presence — the same rule readEpochs() and readCompAt() follow.
export function readBondQueue(state) {
  const raw = Array.isArray(state?.bonds) ? state.bonds : [];
  return raw.map(sanitizeBondEffect).filter(Boolean);
}

// Age out, then cap. Ordered oldest first so a sheet draining the queue applies
// effects in the order they happened.
export function pruneBondQueue(queue, now = Date.now()) {
  return queue
    .filter((fx) => now - fx.t <= BOND_EFFECT_TTL_MS)
    .slice(-MAX_BOND_EFFECTS);
}

// -------------------------------------------------------------
// Coalescing pool nudges (0.9.7)
// -------------------------------------------------------------
// Reported from play: raising Threat by 3 meant pressing + three times, which sent
// three pool events and wrote three "added 1 Threat" lines. The log recorded the
// clicking rather than the decision, and the table had to add the lines up.
//
// So a run of nudges to the SAME pool with the SAME label is summed and sent once:
// one pool event, one log line reading "added 3 Threat". A different pool or a
// different label flushes the run first, which is what keeps an ability from being
// folded into a manual adjustment — every ability passes a reason, and "Nanobarrier"
// is not "manual adjustment", so they can never merge.
//
// This also makes the Maverick drive readable. "When the GM spends 3 or more Threat
// AT ONCE" was undetectable when a spend of 3 arrived as three separate ones.
//
// THE DISPLAY PROBLEM, AND WHY peek() EXISTS:
// Pool events are deltas and are never applied optimistically — applying locally and
// again from the GM's update would double count. So without help the number would sit
// still for the length of the window and the buttons would feel broken. peek() reports
// what has been counted but not yet confirmed, so a display can show the value the
// player expects and mark it as unsettled.
//
// It keeps reporting across the flush, until settle() is called or the safety timeout
// fires. Clearing on flush instead would drop the number back to its old value for the
// length of the broadcast round trip — a visible flinch on every press.
export const POOL_BATCH_MS = 900;      // quiet period before a run is sent
export const POOL_BATCH_MAX_MS = 2500; // ceiling, so holding a button still lands
export const POOL_SETTLE_MS = 5000;    // give up waiting for confirmation

export function createPoolBatcher(send, opts = {}) {
  const delay = opts.delay ?? POOL_BATCH_MS;
  const maxWait = opts.maxWait ?? POOL_BATCH_MAX_MS;
  const settleAfter = opts.settleAfter ?? POOL_SETTLE_MS;

  let pending = null;   // { pool, label, delta }
  let timer = null;
  let deadline = 0;
  let settleTimer = null;
  const inFlight = { momentum: 0, threat: 0 };

  const stopTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  // Called when the room's own value arrives, which is the only real confirmation
  // there is. Until then the display is showing a promise.
  function settle() {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    inFlight.momentum = 0;
    inFlight.threat = 0;
  }

  function flush() {
    stopTimer();
    const batch = pending;
    pending = null;
    deadline = 0;
    // A run that cancels itself out — one press up, one down — is not an event and
    // not a log line. Previously it was two of each.
    if (!batch || !batch.delta) return null;
    inFlight[batch.pool] = (inFlight[batch.pool] || 0) + batch.delta;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, settleAfter);
    send(batch);
    return batch;
  }

  function add(pool, delta, label) {
    const n = Math.round(Number(delta) || 0);
    if (!n) return;
    if (pending && (pending.pool !== pool || pending.label !== label)) flush();
    if (!pending) {
      pending = { pool, label, delta: 0 };
      deadline = Date.now() + maxWait;
    }
    pending.delta += n;
    // Debounced, but never past the ceiling: someone leaning on + should still see
    // the pool move rather than nothing at all until they stop.
    stopTimer();
    timer = setTimeout(flush, Math.max(0, Math.min(delay, deadline - Date.now())));
  }

  function peek(pool) {
    const queued = pending && pending.pool === pool ? pending.delta : 0;
    return queued + (inFlight[pool] || 0);
  }

  return { add, flush, peek, settle };
}

// -------------------------------------------------------------
// Which events require the GM (0.9.2)
// -------------------------------------------------------------
// Enforced in background.js, which is the only writer of room metadata and therefore
// the only place a check counts. It lives HERE so it can be tested without a live
// room, and so there is one statement of the rule rather than one per caller.
//
// 0.9.1 made every Threat change GM-only. That was wrong about the game and broke
// real play. Adding Threat is something PLAYERS do: Nanobarrier charges it,
// Adrenaline Rush pays in it, and several items add it on use, all routed through the
// creator's addThreat(). Blocking those meant a Sentinel could press Barrier, watch
// the cost announce itself in the log, and see the pool never move.
//
// The creator's own tooltip had it right all along — "Anyone can add; only the GM
// should spend" — so what is privileged is the DIRECTION, not the pool. A player can
// pay Threat in and cannot drain it.
const GM_ONLY_TYPES = new Set(["epoch", "clear", "compAt"]);

export function isGmOnlyEvent(ev) {
  if (!ev || typeof ev !== "object") return false;
  if (GM_ONLY_TYPES.has(ev.type)) return true;
  // 0.9.8. The Maverick drive reads "when THE GM spends", so the announcement is the
  // GM's to make. Unlike the two bonds — which a forged copy could only pay to someone
  // who already holds the matching bond — a forged drive would reach every Maverick at
  // the table on nobody's authority. It is cheap to put it behind the real check, so
  // it goes behind the real check.
  if (ev.type === "bond") return ev.effect?.kind === "drive";
  // Momentum is the group's pool and stays open to everyone, both directions.
  if (ev.type !== "pool" || ev.pool !== "threat") return false;
  return (Math.round(Number(ev.delta) || 0)) < 0;
}

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
    const entry = sanitizeEntry(ev.entry);
    if (!entry) return next;
    if (next.log.some((e) => e.id === entry.id)) return next;
    next.log.unshift(entry);
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
    const entry = sanitizeEntry(ev.entry);
    if (!entry) return next;
    if (next.log.some((e) => e.id === entry.id)) return next;
    next.log.unshift(entry);
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
    const entry = sanitizeEntry(ev.entry);
    if (entry && !next.log.some((e) => e.id === entry.id)) {
      next.log.unshift(entry);
      next.log = next.log.slice(0, MAX_LOG_ENTRIES);
    }
  } else if (ev?.type === "pool" && (ev.pool === "momentum" || ev.pool === "threat")) {
    // Bounded per event. Unbounded, one forged delta sets a pool to Number.MAX_VALUE
    // and every subsequent arithmetic on it is meaningless until the room is rebuilt.
    const delta = Math.round(Number(ev.delta) || 0);
    const bounded = Math.max(-999, Math.min(999, delta));
    next[ev.pool] = Math.max(0, Math.min(9999, (next[ev.pool] || 0) + bounded));
  } else if (ev?.type === "claim" && ev.id) {
    // 0.9.5. Marks a roll's surplus Momentum as taken. Shared state rather than local,
    // so the button greys out on EVERY client — otherwise two people would each see an
    // unclaimed roll and the pool would gain the surplus twice.
    //
    // One-way and idempotent: claiming an already-claimed entry changes nothing, which
    // is what makes a double-click or a re-delivered broadcast harmless.
    next.log = next.log.map((e) => (e.id === ev.id ? { ...e, claimed: true } : e));
  } else if (ev?.type === "bond" && ev.effect) {
    // 0.9.6. Deduplicated by id like a roll, for the same reason: a broadcast can be
    // delivered twice, and an effect that pays out twice is a free Spirit.
    const effect = sanitizeBondEffect(ev.effect);
    if (!effect) return next;
    const queue = readBondQueue(next);
    if (queue.some((fx) => fx.id === effect.id)) return next;
    next.bonds = pruneBondQueue([...queue, effect]);
  } else if (ev?.type === "compAt") {
    // Assignment, not increment: the GM is choosing a value, and two GM windows
    // settling on the same number is the correct outcome rather than a conflict.
    next.compAt = Math.max(COMP_AT_MIN, Math.min(COMP_AT_MAX, Math.round(Number(ev.value) || COMP_AT_MAX)));
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
  next.compAt = readCompAt(next);
  // 0.9.6. Pending bond effects are trimmed by age and count here, and then left
  // alone by the loop below. They are a dozen small objects at most, and unlike a log
  // line an undrained one still owes somebody a Spirit — so the log gives way to them
  // rather than the other way round.
  next.bonds = pruneBondQueue(readBondQueue(next));
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

  // Searched from the END, and that is not a style preference (0.9.2).
  //
  // A code is a mix of two segment kinds. Most carry a two-letter TAG plus a payload
  // — CP, SN, NM, GW — but segments 1 to 3 are bare lookup codes with no tag at all:
  // the origin, the archetype and the temperament, written straight in as `EVR`,
  // `SNT`, `CRC`.
  //
  // Sentinel's archetype code is **SNT**. Searching from the front, `startsWith("SN")`
  // matched the archetype at index 2 rather than the snapshot at the end, so the
  // parser tried to read one character of archetype code as the snapshot JSON, threw,
  // and reported the whole code as damaged. Every Sentinel was therefore invisible to
  // the party panel and to the roller's selected-character banner, while importing
  // into the creator worked — the creator has its own parser and never looks for SN.
  //
  // Searching backwards fixes it for the same reason in every future case: the tagged
  // segments are appended after the positional ones, so the last match is always the
  // real one. A new archetype coded `CPX` would break the front search too, and cannot
  // break this one.
  const findLast = (prefix) => {
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].startsWith(prefix)) return i;
    return -1;
  };
  const cpIndex = findLast("CP");
  const snIndex = findLast("SN");
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
// compAt defaults to 20 so every existing caller keeps the rulebook behaviour.
// Order matters and has not changed: a die at or above the Complication threshold is a
// Complication and can never also be a success, even when the threshold is low enough
// to overlap the Attribute.
export function classifyDie(value, attrValue, skillValue, compAt = COMP_AT_MAX) {
  if (value >= compAt) return "complication";
  if (value <= skillValue) return "crit";
  if (value <= attrValue) return "success";
  return "fail";
}

export function rollDice(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 20));
  return out;
}

export function resolveRoll(dice, attrValue, skillValue, diff, compAt = COMP_AT_MAX) {
  let successes = 0;
  let complications = 0;
  const detail = dice.map((d) => {
    const kind = classifyDie(d, attrValue, skillValue, compAt);
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
