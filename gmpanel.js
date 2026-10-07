// =============================================================
// GM Tools (1.5)
// -------------------------------------------------------------
// The GM's cheat sheet with buttons on it: every way the book gives the GM to gain and
// spend Threat, Threat that arrives every round, the hazard builder, starting Threat, an
// NPC roster with stat blocks, and the rest of Chapter 4 as reference.
//
// ONE MODULE, TWO PLACES. The panel is drawn inside the roller (collapsible) and inside
// its own docked popover (gm.html), by this same code. Everything it remembers lives in
// localStorage — the two frames share an origin — so a ticker added in one is there in
// the other, and the `storage` event keeps them level.
//
// WHAT IS PUBLIC AND WHAT IS NOT. Room metadata is readable by every client, so anything
// written there is public whatever the interface draws (see the hidden initiative names
// in dnm.js). So:
//
//   GAINS     are logged by name. The book asks the GM to announce them.
//   SPENDS    are logged to the table as "Threat spent", and the reason goes to the GM's
//             own log in this browser. A Reveal named in the shared log would tell the
//             table there is a bomb in the room.
//   TICKERS   are public only when the GM marks them so.
//   THE ROSTER, the fight list and Personal Threat never leave this browser at all.
//
// Each private line SHADOWS the public one it belongs to, so the GM reads one line per
// press, not two.
//
// CONFIRMATION. Every button that changes Threat or reaches the table asks first, with
// the same two-press arm the roller's table controls use. Steppers, toggles and the
// roster's own editing do not: they change nothing until a button that does is pressed.
// =============================================================

import {
  ID, NPC_KEY, CHAR_KEY, EMPTY_STATE, EPOCH_LABELS, ATTRS, SKILLS,
  readEpochs, readRushed, readInitiative, parseCode, characterTokens,
  DRIVE_THREAT_SPEND_MIN, INITIATIVE_NAME_MAX, MAX_INITIATIVE_ROWS, bondNameKey,
} from "./dnm.js";
import * as R from "./gmrules.js";

// -------------------------------------------------------------
// Storage
// -------------------------------------------------------------
export function safeStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

function readJson(key, fallback) {
  const s = safeStorage();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (err) {
    return fallback;
  }
}

function writeJson(key, value) {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("[dnm] could not save GM tools state", err);
  }
}

// Per ROOM where the thing belongs to one table's fight; per BROWSER where it is the
// GM's own library or preference.
export const GM_KEYS = {
  tickers: (room) => `${ID}/tickers/${room}`,
  log: (room) => `${ID}/gmlog/${room}`,
  fight: (room) => `${ID}/fight/${room}`,
  roomPrefs: (room) => `${ID}/gm-room/${room}`,
  // The SAME key the roller's initiative uses, so a name remembered here is the name the
  // party panel draws. Changing one without the other unnames every hidden row.
  hiddenNames: (room) => `${ID}/initnames/${room}`,
  roster: `${ID}/roster`,
  settings: `${ID}/gm-settings`,
  ui: `${ID}/gm-ui`,
  popped: `${ID}/gm-popped`,
};

export const MAX_GM_LOG = 40;

export function readTickers(room) { return R.normalizeTickers(readJson(GM_KEYS.tickers(room), [])); }
export function writeTickers(room, list) { writeJson(GM_KEYS.tickers(room), R.normalizeTickers(list)); }

const cleanStr = (v, max) => String(v == null ? "" : v).slice(0, max);

// The GM's private log. Shaped like a room log action entry, plus `shadows` (the public
// entry it stands in for) and `gm: true`, so the roller can merge it into the same list.
export function readGmLog(room) {
  const raw = readJson(GM_KEYS.log(room), []);
  return (Array.isArray(raw) ? raw : [])
    .filter((e) => e && typeof e === "object" && e.id)
    .slice(0, MAX_GM_LOG)
    .map((e) => ({
      id: cleanStr(e.id, 48),
      t: Number.isFinite(Number(e.t)) ? Number(e.t) : 0,
      kind: "action",
      gm: true,
      who: "GM",
      label: cleanStr(e.label, 60),
      detail: cleanStr(e.detail, 120),
      pool: e.pool === "threat" || e.pool === "momentum" ? e.pool : null,
      delta: Math.max(-999, Math.min(999, Math.round(Number(e.delta) || 0))),
      shadows: e.shadows ? cleanStr(e.shadows, 48) : null,
    }));
}

export function appendGmLog(room, entry) {
  const list = readGmLog(room);
  list.unshift({ ...entry, t: entry.t || Date.now() });
  writeJson(GM_KEYS.log(room), list.slice(0, MAX_GM_LOG));
}

export function clearGmLog(room) { writeJson(GM_KEYS.log(room), []); }

// The roster. A browser that has never had one gets the samples, so the panel is never
// empty on first open; after that it is whatever the GM has kept, samples included until
// deleted.
export function readRoster() {
  const raw = readJson(GM_KEYS.roster, null);
  return raw == null ? R.SAMPLE_NPCS.map((n) => ({ ...n })) : R.normalizeRoster(raw);
}
export function writeRoster(list) { writeJson(GM_KEYS.roster, R.normalizeRoster(list)); }
export function findNpc(id) { return readRoster().find((n) => n.id === id) || null; }

// Who is in tonight's fight, keyed to their initiative row. Name and stats stay here.
export function readFight(room) {
  const raw = readJson(GM_KEYS.fight(room), []);
  return (Array.isArray(raw) ? raw : [])
    .filter((f) => f && typeof f === "object" && f.rowId)
    .slice(0, MAX_INITIATIVE_ROWS)
    .map((f) => ({
      rowId: cleanStr(f.rowId, 40),
      npcId: cleanStr(f.npcId, 40),
      name: cleanStr(f.name, INITIATIVE_NAME_MAX),
      count: Math.max(1, Math.min(24, Math.round(Number(f.count) || 1))),
      revealed: f.revealed === true,
      pt: Math.max(0, Math.min(20, Math.round(Number(f.pt) || 0))),
      // 1.6. Chapter 5's bookkeeping, all of it GM-local like the rest of the row.
      startCount: Math.max(1, Math.min(24, Math.round(Number(f.startCount ?? f.count) || 1))),
      side: R.SIDES.some((x) => x.id === f.side) ? f.side : "adversary",
      injuries: Math.max(0, Math.min(20, Math.round(Number(f.injuries) || 0))),
      payPt: f.payPt !== false,
      extraRound: Number.isFinite(Number(f.extraRound)) ? Math.round(Number(f.extraRound)) : -1,
      extraTurns: Math.max(0, Math.min(20, Math.round(Number(f.extraTurns) || 0))),
      lastAction: f.lastAction && typeof f.lastAction === "object"
        ? { d: Math.max(1, Math.min(20, Math.round(Number(f.lastAction.d) || 1))), name: cleanStr(f.lastAction.name, 40) }
        : null,
    }));
}
export function writeFight(room, list) { writeJson(GM_KEYS.fight(room), list); }

// The fight is over: its rows are gone from the order, and so are their names. The
// roller's End button and End Scene both come through here.
export function endFight(room) {
  for (const f of readFight(room)) rememberHiddenName(room, f.rowId, null);
  writeFight(room, []);
}

export function readSettings() {
  const raw = readJson(GM_KEYS.settings, {});
  return {
    stakes: R.STAKES.some((s) => s.id === raw.stakes) ? raw.stakes : "standard",
    // GM Guide p.125: "Naturally, this is up to the GM". On by default because it is the
    // rule; a switch because the book says it is the GM's call.
    awardGrowth: raw.awardGrowth !== false,
    // 1.6. Off by default: it is not in the book (gmrules.js ARRIVAL_HOUSE_RULE).
    arrivalThreat: raw.arrivalThreat === true,
  };
}
export function writeSettings(next) { writeJson(GM_KEYS.settings, { ...readSettings(), ...next }); }

export function readRoomPrefs(room) {
  const raw = readJson(GM_KEYS.roomPrefs(room), {});
  const at = Math.round(Number(raw.reversalAt));
  return { reversalAt: Number.isFinite(at) && raw.reversalAt !== null && raw.reversalAt !== undefined ? at : null };
}
export function writeRoomPrefs(room, next) { writeJson(GM_KEYS.roomPrefs(room), { ...readRoomPrefs(room), ...next }); }

function readHiddenNames(room) {
  const found = readJson(GM_KEYS.hiddenNames(room), {});
  return found && typeof found === "object" && !Array.isArray(found) ? found : {};
}
export function rememberHiddenName(room, id, name) {
  const all = readHiddenNames(room);
  if (name) all[id] = String(name).slice(0, INITIATIVE_NAME_MAX);
  else delete all[id];
  writeJson(GM_KEYS.hiddenNames(room), all);
}

// The pop-out writes a heartbeat rather than a flag. A flag would outlive a room reload,
// which closes every popover, and leave the roller insisting the panel is somewhere else.
export const POPPED_FRESH_MS = 6000;
export function isPoppedOut(now = Date.now()) {
  const at = Number(readJson(GM_KEYS.popped, 0));
  return Number.isFinite(at) && at > 0 && now - at < POPPED_FRESH_MS;
}
export function markPopped(on) { writeJson(GM_KEYS.popped, on ? Date.now() : 0); }

// -------------------------------------------------------------
// Table actions
// -------------------------------------------------------------
// A host is what the panel needs from wherever it is mounted: the room's state, a way to
// announce, and the scene. The roller passes its own; gm.js builds one from the SDK.
// Every action is written against the host so it runs identically in both.
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// The names of the characters on tokens in this scene: who is "present", for Reversal's
// half-Spirit and for adversity Growth. Parsed the same way the party panel does.
export async function scenePcNames(host) {
  try {
    const items = await host.items();
    const names = [];
    const seen = new Set();
    for (const { code } of characterTokens(items)) {
      const r = parseCode(code);
      const name = r && !r.error ? String(r.snap?.name || "").trim() : "";
      const key = bondNameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name.slice(0, 24));
    }
    return names;
  } catch (err) {
    return [];
  }
}

// What a spend of 3 or more sets off. Exported so the roller's own − button, which goes
// through its batcher, sets off exactly the same things as a press in this panel.
export async function spendSideEffects(host, spent) {
  if (!(spent >= DRIVE_THREAT_SPEND_MIN)) return [];
  const said = [];
  // The Maverick drive (0.9.8): "When the GM spends 3 or more Threat at once, regain 1
  // Spirit." Every Maverick, whoever they are — the drive does not ask who is present.
  await host.announce({
    type: "bond",
    effect: { id: uid(), t: Date.now(), kind: "drive", drive: "maverick", from: host.playerName(), amount: spent },
  });
  said.push("every Maverick regains 1 Spirit");
  if (readSettings().awardGrowth) {
    const targets = await scenePcNames(host);
    await host.announce({
      type: "bond",
      effect: { id: uid(), t: Date.now(), kind: "adversity", from: host.playerName(), amount: spent, targets },
    });
    said.push(targets.length
      ? `${targets.length === 1 ? targets[0] : targets.length + " characters"} gain 1 Growth`
      : "every character gains 1 Growth");
  }
  return said;
}

let lastUndo = null;

// The one function that moves Threat for the panel. `pub` is false for a spend whose
// reason is the GM's business.
export async function gmThreat(host, delta, opts = {}) {
  const d = Math.max(-99, Math.min(99, Math.round(Number(delta) || 0)));
  if (!d) return null;
  const id = uid();
  const spent = d < 0;
  const named = opts.pub !== false || !spent;
  const label = named ? (opts.label || (spent ? "Threat spent" : "Threat added")) : "Threat spent";
  const detail = named
    ? (opts.detail || (spent ? `the GM spent ${-d} Threat` : `added ${d} Threat`))
    : `the GM spent ${-d} Threat`;
  await host.announce({ type: "pool", pool: "threat", delta: d });
  await host.announce({
    type: "action",
    entry: { id, t: Date.now(), kind: "action", who: "GM", label, detail, pool: "threat", delta: d },
  });
  let after = [];
  if (spent && !opts.noSideEffects) after = await spendSideEffects(host, -d);
  appendGmLog(host.room(), {
    id: id + "-gm",
    shadows: id,
    label: opts.privateLabel || opts.label || label,
    detail: [opts.privateDetail || opts.detail || detail, ...after].filter(Boolean).join("; "),
    pool: "threat",
    delta: d,
  });
  if (!opts.isUndo) lastUndo = { delta: d, label: opts.privateLabel || opts.label || label };
  host.changed();
  return { delta: d, after };
}

export function undoAvailable() { return lastUndo; }

export async function undoLast(host) {
  const u = lastUndo;
  if (!u) return;
  lastUndo = null;
  await gmThreat(host, -u.delta, {
    label: "Undo",
    detail: `${u.delta > 0 ? "took back" : "gave back"} ${Math.abs(u.delta)} Threat`,
    privateLabel: `Undo: ${u.label}`,
    noSideEffects: true,
    isUndo: true,
  });
}

// The boundaries, moved here from roller.js so the GM panel's End Scene and the table
// controls' End Scene are the same press with the same consequences.
export async function pushEpochVia(host, boundary) {
  const label = EPOCH_LABELS[boundary] || boundary;
  await host.announce({
    type: "epoch",
    boundary,
    entry: { id: uid(), t: Date.now(), kind: "action", who: "GM", label, detail: "called for the whole table" },
  });
  // 0.9.5. Ending a scene costs the group 1 Momentum, per the rules. Applied on the GM's
  // single press so five sheets ending one scene do not cost the table five Momentum.
  if (boundary === "scene") {
    await host.announce({ type: "pool", pool: "momentum", delta: -1 });
    await host.announce({
      type: "action",
      entry: { id: uid(), t: Date.now(), kind: "action", who: "GM", label: "End Scene", detail: "the group loses 1 Momentum", pool: "momentum", delta: -1 },
    });
    // Tickers belong to the scene unless pinned, and an NPC met again in a later scene
    // has its Personal Threat back (GM Guide p.113).
    // End Scene also ends the round (dnm.js clears the initiative on a scene epoch), so
    // the fight list goes with it. Personal Threat needs no refill for the same reason:
    // an NPC met again in a later scene goes back in from the roster, full (p.113).
    const room = host.room();
    writeTickers(room, R.tickersAfterScene(readTickers(room)));
    endFight(room);
  }
  host.changed();
}

// Seeds the order from the characters on tokens. Moved here with pushEpochVia() so
// "add an NPC to the fight" can start a round the same way the Start button does.
export async function startInitiativeVia(host) {
  await host.announce({ type: "init", action: "start" });
  try {
    for (const name of await scenePcNames(host)) {
      await host.announce({ type: "init", action: "add", id: "pc:" + bondNameKey(name), name, kind: "pc" });
    }
  } catch (err) {
    console.error("[dnm] could not read the scene to seed initiative", err);
  }
}

// One line per ticker that contributes, for the round that just ENDED.
export async function tickRound(host, round) {
  const room = host.room();
  const lines = R.tickLines(readTickers(room), round);
  for (const line of lines) {
    await gmThreat(host, line.amount, {
      label: line.publicLabel,
      detail: line.publicDetail,
      privateLabel: line.privateLabel,
      privateDetail: line.privateDetail,
    });
  }
  return lines.length;
}

export async function rushScene(host) {
  await pushEpochVia(host, "scene");
  await gmThreat(host, -R.RUSH_RULE.cost, {
    label: "Rushed",
    detail: "no time to rest before the next scene",
    privateLabel: "End Scene, rushed",
    // A spend of 2 never reaches the 3 that sets anything off; said for the reader.
    noSideEffects: true,
  });
  await host.announce({ type: "rush", value: true });
  host.changed();
}

export async function liftRush(host) {
  await host.announce({
    type: "rush",
    value: false,
    entry: { id: uid(), t: Date.now(), kind: "action", who: "GM", label: "Rest allowed", detail: "the GM lifted the rush" },
  });
  host.changed();
}

export function reversalUsed(host) {
  const at = readRoomPrefs(host.room()).reversalAt;
  return at !== null && at === readEpochs(host.state()).adventure;
}

export async function reversal(host, pcsPresent) {
  const cost = R.reversalCost(pcsPresent);
  const targets = await scenePcNames(host);
  // Marked used FIRST. A second press while the first is still sending must find the
  // button already spent, or a double-click is two Reversals in one adventure.
  writeRoomPrefs(host.room(), { reversalAt: readEpochs(host.state()).adventure });
  await gmThreat(host, -cost, {
    label: "Reversal",
    detail: `the scene ends unresolved (${cost} Threat)`,
    privateLabel: "Reversal",
  });
  await host.announce({
    type: "bond",
    effect: { id: uid(), t: Date.now(), kind: "reversal", from: host.playerName(), targets },
  });
  await pushEpochVia(host, "scene");
}

export async function setStartingThreat(host, stakesId, pcs) {
  const target = R.startingThreat(stakesId, pcs);
  const current = Math.max(0, Math.round(Number(host.state().threat) || 0));
  const stakes = R.STAKES.find((s) => s.id === stakesId) || R.STAKES[1];
  const delta = target - current;
  if (!delta) return 0;
  await gmThreat(host, delta, {
    label: "Starting Threat",
    detail: `${stakes.label} stakes: ${target} for ${pcs} character${pcs === 1 ? "" : "s"}`,
    privateDetail: `${stakes.label} stakes: Threat set to ${target} (${stakes.perPc} × ${pcs})`,
    // Setting the pool DOWN to a starting value is bookkeeping, not adversity.
    noSideEffects: true,
  });
  return delta;
}

// -------------------------------------------------------------
// The fight: NPCs from the roster in the initiative order
// -------------------------------------------------------------
export async function addNpcToFight(host, npc, count = 1) {
  const room = host.room();
  const n = Math.max(1, Math.min(24, Math.round(Number(count) || 1)));
  const init = readInitiative(host.state());
  if (init && init.rows.length >= MAX_INITIATIVE_ROWS) return { error: "The order is full." };
  if (!init) await startInitiativeVia(host);
  const id = "npc:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const name = (n > 1 ? `${npc.name} ×${n}` : npc.name).slice(0, INITIATIVE_NAME_MAX);
  // Remembered BEFORE the event goes out and never sent — the 1.4C rule. The row reaches
  // the room hidden and nameless.
  rememberHiddenName(room, id, name);
  await host.announce({ type: "init", action: "add", id, name: "", kind: "npc", hidden: true });
  const fight = readFight(room);
  fight.push({ rowId: id, npcId: npc.id, name, count: n, startCount: n, revealed: false, pt: npc.personalThreat, side: "adversary", injuries: 0 });
  writeFight(room, fight);
  appendGmLog(room, { id: uid() + "-gm", label: "Into the fight", detail: `${name}, hidden from the table`, pool: null, delta: 0 });
  host.changed();
  return { id };
}

// Entering the scene. Reinforcements are charged per the p.113 rule. Threat on arrival is
// a HOUSE RULE since 1.6 (Chapter 5 prints Threatening, not Menacing) and is added only
// while the GM has it switched on, once for the row, group or not.
export async function revealFighter(host, rowId, { reinforcements = false } = {}) {
  const room = host.room();
  const fight = readFight(room);
  const f = fight.find((x) => x.rowId === rowId);
  if (!f) return;
  const npc = findNpc(f.npcId);
  rememberHiddenName(room, rowId, null);
  await host.announce({ type: "init", action: "hide", id: rowId, hidden: false, name: f.name });
  if (reinforcements) {
    const cost = R.reinforcementCost(f.count, f.count > 1);
    await gmThreat(host, -cost, {
      label: "Reinforcements",
      detail: `${f.name} arrive (${cost} Threat)`,
      privateDetail: `${f.name}: ${f.count > 1 ? `a group of ${f.count}, half rounded up` : "one Normal NPC"}`,
    });
  }
  if (npc && npc.menacing > 0 && readSettings().arrivalThreat) {
    await gmThreat(host, npc.menacing, {
      label: "Threat rises",
      detail: `${f.name} enters the scene`,
      privateLabel: "Arrival (house rule)",
    });
  }
  f.revealed = true;
  writeFight(room, fight);
  host.changed();
}

export async function dropFighter(host, rowId) {
  const room = host.room();
  rememberHiddenName(room, rowId, null);
  await host.announce({ type: "init", action: "remove", id: rowId });
  writeFight(room, readFight(room).filter((f) => f.rowId !== rowId));
  host.changed();
}

export function spendPersonalThreat(host, rowId, delta, why = "") {
  const room = host.room();
  const fight = readFight(room);
  const f = fight.find((x) => x.rowId === rowId);
  if (!f) return;
  const npc = findNpc(f.npcId);
  const max = npc ? npc.personalThreat : 20;
  const next = Math.max(0, Math.min(max, f.pt + delta));
  if (next === f.pt) return;
  appendGmLog(room, {
    id: uid() + "-gm",
    label: "Personal Threat",
    detail: `${f.name} ${delta < 0 ? "spent" : "regained"} ${Math.abs(next - f.pt)}${why ? ": " + why : ""} (${next}/${max} left)`,
    pool: null,
    delta: 0,
  });
  f.pt = next;
  writeFight(room, fight);
  host.changed();
}

// -------------------------------------------------------------
// Chapter 5 at the table (1.6)
// -------------------------------------------------------------
function fighterAndNpc(host, rowId) {
  const room = host.room();
  const fight = readFight(room);
  const f = fight.find((x) => x.rowId === rowId);
  return { room, fight, f, npc: f ? findNpc(f.npcId) : null };
}

export function updateFighter(host, rowId, patch) {
  const { room, fight, f } = fighterAndNpc(host, rowId);
  if (!f) return;
  Object.assign(f, patch);
  writeFight(room, fight);
  host.changed();
}

// What the table may be told about a fighter. A row still hidden in the order has no
// name in the room, and the log must not give it one.
const publicName = (f) => (f.revealed ? f.name.replace(/ ×\d+$/, "") : "An adversary");

// The one way an NPC pays Threat (pp.126, 127, 129). Personal Threat first when it has
// some and the GM has not switched that off; otherwise the GM's pool, and an NPC cannot
// spend what is not there. An ALLY adds the amount to Threat instead — unless it is
// paying from its own Personal Threat, which it spends "as normal".
export async function npcSpend(host, rowId, amount, { what = "uses an ability", publicWhat = null, pool = null } = {}) {
  const { f } = fighterAndNpc(host, rowId);
  if (!f) return { error: "That NPC is no longer in the fight." };
  const n = Math.max(0, Math.min(20, Math.round(Number(amount) || 0)));
  if (!n) return { error: "That costs nothing." };
  const usePt = pool === "pt" || (pool === null && f.payPt && f.pt > 0);
  if (usePt) {
    if (f.pt < n) return { error: `${f.name} has only ${f.pt} Personal Threat.` };
    spendPersonalThreat(host, rowId, -n, `${what}`);
    return { paid: "pt", amount: n };
  }
  if (f.side === "ally") {
    await gmThreat(host, n, {
      label: "Ally",
      detail: `${publicWhat || publicName(f) + " " + what}: added ${n} Threat`,
      privateLabel: `Ally: ${f.name}`,
      privateDetail: `${what}, added ${n} Threat instead of spending it`,
    });
    return { paid: "ally", amount: n };
  }
  const have = Math.max(0, Math.round(Number(host.state().threat) || 0));
  if (have < n) return { error: `Only ${have} Threat in the pool: ${f.name} cannot spend ${n}.` };
  await gmThreat(host, -n, { pub: false, label: f.name, privateLabel: f.name, privateDetail: `${what} (${n} Threat)` });
  return { paid: "threat", amount: n };
}

// One Injury landed. A group loses one of its number (each is defeated by one, p.128);
// anything else counts towards its limit (pp.127, 129). GM bookkeeping only.
export function injureFighter(host, rowId, delta = 1) {
  const { room, fight, f, npc } = fighterAndNpc(host, rowId);
  if (!f) return null;
  const d = delta < 0 ? -1 : 1;
  let note;
  if (f.startCount > 1) {
    f.count = Math.max(0, Math.min(f.startCount, f.count - d));
    note = d > 0 ? `one falls, ${f.count} of ${f.startCount} left` : `one back up, ${f.count} of ${f.startCount}`;
  } else {
    const limit = R.defeatLimit(npc);
    f.injuries = Math.max(0, Math.min(limit, f.injuries + d));
    note = `${f.injuries} of ${limit} Injuries${f.injuries >= limit ? ": defeated" : ""}`;
  }
  appendGmLog(room, { id: uid() + "-gm", label: d > 0 ? "Injury" : "Injury undone", detail: `${f.name}: ${note}`, pool: null, delta: 0 });
  writeFight(room, fight);
  host.changed();
  return fighterDefeated(f, npc);
}

export function fighterDefeated(f, npc) {
  if (!f) return false;
  if (f.startCount > 1) return f.count <= 0;
  return f.injuries >= R.defeatLimit(npc);
}

// Threatening (p.130): +1 at the start of each of its actions. Public, like any gain, and
// the row is ticked as having acted so the party panel keeps count.
export async function threateningAct(host, rowId) {
  const { f } = fighterAndNpc(host, rowId);
  if (!f) return;
  await gmThreat(host, 1, { label: "Threatening", detail: `${publicName(f)} acts: added 1 Threat`, privateDetail: `${f.name} acts` });
  await host.announce({ type: "init", action: "act", id: rowId, acted: true });
}

// Solitary (p.131): the first extra turn this round costs 1, the next 2, and so on. The
// count resets when the round number moves on.
export async function solitaryTurn(host, rowId) {
  const { f } = fighterAndNpc(host, rowId);
  if (!f) return null;
  const round = readInitiative(host.state())?.round ?? 0;
  const taken = f.extraRound === round ? f.extraTurns : 0;
  const cost = R.solitaryCost(taken);
  const r = await npcSpend(host, rowId, cost, { what: `takes extra turn ${taken + 1} this round (Solitary)` });
  if (!r.error) updateFighter(host, rowId, { extraRound: round, extraTurns: taken + 1 });
  return r;
}

export function solitaryNextCost(host, f) {
  const round = readInitiative(host.state())?.round ?? 0;
  return R.solitaryCost(f.extraRound === round ? f.extraTurns : 0);
}

// Hunt (p.131): the successes on its Insight (Study) roll become Threat.
export async function huntGain(host, rowId, successes) {
  const { f } = fighterAndNpc(host, rowId);
  const n = Math.max(0, Math.min(20, Math.round(Number(successes) || 0)));
  if (!f || !n) return;
  await gmThreat(host, n, { label: "Hunt", detail: `${publicName(f)} watches and waits: added ${n} Threat`, privateDetail: `${f.name}: ${n} success${n === 1 ? "" : "es"} on Hunt` });
}

// Retreat (p.131): it leaves the scene, and Threat rises by the Injuries it could still
// have taken. The Thrall's own Tomorrow's Problem is this with X = 1.
export async function retreatFighter(host, rowId) {
  const { f, npc } = fighterAndNpc(host, rowId);
  if (!f) return;
  const x = R.injuriesLeft(npc, f);
  if (x) await gmThreat(host, x, { label: "Retreat", detail: `${publicName(f)} withdraws: added ${x} Threat`, privateDetail: `${f.name} retreats with ${x} Injur${x === 1 ? "y" : "ies"} to spare` });
  await dropFighter(host, rowId);
}

// A Major NPC's d20 action table (p.129). Rolled here, told only to the GM.
export function rollFighterAction(host, rowId, d20 = null) {
  const { room, fight, f, npc } = fighterAndNpc(host, rowId);
  if (!f || !npc) return null;
  const d = d20 || (1 + Math.floor(Math.random() * 20));
  const a = R.actionForRoll(npc, d);
  f.lastAction = { d, name: a ? a.name : "" };
  appendGmLog(room, { id: uid() + "-gm", label: "Action roll", detail: `${f.name}: ${d} — ${a ? a.name : "no action on that number"}`, pool: null, delta: 0 });
  writeFight(room, fight);
  host.changed();
  return { d, action: a };
}

// Puts an NPC on the selected token. Only the opaque roster id — see npcTokenRef().
export async function attachNpcToSelected(host, npc) {
  const selection = (await host.selection()) || [];
  if (selection.length !== 1) return { error: "Select exactly one token first." };
  const [item] = await host.itemsById(selection);
  if (!item) return { error: "That token is no longer in the scene." };
  if (item.metadata?.[CHAR_KEY]?.code) return { error: "That token carries a character. Pick another." };
  let refused = false;
  await host.updateItems(selection, (items) => {
    for (const target of items) {
      if (target.metadata?.[CHAR_KEY]?.code) { refused = true; continue; }
      target.metadata[NPC_KEY] = R.npcTokenRef(npc);
    }
  });
  if (refused) return { error: "That token carries a character. Pick another." };
  return { ok: true };
}

// 1.6. A new token for an NPC, in the middle of the GM's view. A popover cannot drag
// onto the map — it is a separate document Owlbear places over it, and the SDK has no
// drag-and-drop — so the press puts the token where the GM is looking, HIDDEN, carrying
// only the opaque id. The GM moves it and shows it like any other token.
export const NPC_TOKEN_URL = new URL("./npc-token.svg", import.meta.url).href;

export async function placeNpcOnMap(host, npc) {
  if (!host.addItems) return { error: "Placing tokens needs the room's map." };
  const [playerId, at] = await Promise.all([host.playerId(), host.viewCenter()]);
  const item = R.buildNpcTokenItem({ url: NPC_TOKEN_URL, playerId, position: at, id: crypto.randomUUID() });
  item.metadata[NPC_KEY] = R.npcTokenRef(npc);
  await host.addItems([item]);
  return { ok: true, id: item.id };
}

export async function detachNpcFromSelected(host) {
  const selection = (await host.selection()) || [];
  if (selection.length !== 1) return { error: "Select exactly one token first." };
  await host.updateItems(selection, (items) => {
    for (const target of items) delete target.metadata[NPC_KEY];
  });
  return { ok: true };
}

// -------------------------------------------------------------
// Rendering helpers
// -------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "hidden" || k === "open") el[k] = !!v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}

// One floating tooltip for the whole panel. Built as DOM, never innerHTML: some tooltips
// carry roster text, which came from an imported file.
let tipEl = null;
function ensureTip() {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = h("div", { class: "gm-tip", role: "tooltip", hidden: true });
  document.body.append(tipEl);
  return tipEl;
}
function showTip(target) {
  const t = target.__tip;
  if (!t) return;
  const el = ensureTip();
  el.textContent = "";
  if (t.title) el.append(h("div", { class: "gm-tip-title", text: t.title }));
  if (t.quote) el.append(h("div", { class: "gm-tip-quote", text: `“${t.quote}”` }));
  if (t.page) el.append(h("div", { class: "gm-tip-cite", text: R.cite(t.page) }));
  if (t.note) el.append(h("div", { class: "gm-tip-note", text: t.note }));
  el.hidden = false;
  const r = target.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 12);
  el.style.width = w + "px";
  const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left));
  el.style.left = left + "px";
  const below = r.bottom + 6;
  const height = el.offsetHeight;
  el.style.top = (below + height < window.innerHeight - 4 ? below : Math.max(4, r.top - height - 6)) + "px";
}
function hideTip() { if (tipEl) tipEl.hidden = true; }
function tip(el, t) {
  el.__tip = t;
  el.addEventListener("mouseenter", () => showTip(el));
  el.addEventListener("mouseleave", hideTip);
  el.addEventListener("focus", () => showTip(el));
  el.addEventListener("blur", hideTip);
  return el;
}

// The two-press arm. First press relabels and arms, second sends. Arming one disarms any
// other, and it lapses after four seconds, so a stray click cannot fire something armed
// a minute ago.
let armed = null;
let armTimer = null;
function disarm() {
  if (armed) {
    armed.btn.textContent = armed.label;
    armed.btn.classList.remove("armed");
    armed = null;
  }
  if (armTimer) { clearTimeout(armTimer); armTimer = null; }
}
function confirmButton(btn, prompt, fn, status) {
  btn.addEventListener("click", async () => {
    if (armed && armed.btn === btn) {
      disarm();
      btn.disabled = true;
      try {
        await fn();
      } catch (err) {
        console.error("[dnm] GM tools action failed", err);
        status && status("That did not go through. Check the room has a GM connected.");
      } finally {
        setTimeout(() => { if (btn.isConnected) btn.disabled = false; }, 600);
      }
      return;
    }
    disarm();
    armed = { btn, label: btn.textContent };
    btn.textContent = typeof prompt === "function" ? prompt() : prompt;
    btn.classList.add("armed");
    armTimer = setTimeout(disarm, 4000);
  });
  return btn;
}

function stepper(value, { min, max, onChange, label }) {
  const out = h("span", { class: "gm-stepper" });
  const show = h("span", { class: "gm-stepper-val", text: String(value) });
  const set = (v) => {
    const next = Math.max(min, Math.min(max, v));
    show.textContent = String(next);
    onChange(next);
  };
  out.append(
    h("button", { type: "button", class: "ghost gm-step", "aria-label": `Fewer ${label || ""}`.trim(), text: "−", onclick: () => set(Number(show.textContent) - 1) }),
    show,
    h("button", { type: "button", class: "ghost gm-step", "aria-label": `More ${label || ""}`.trim(), text: "+", onclick: () => set(Number(show.textContent) + 1) }),
  );
  return out;
}

// -------------------------------------------------------------
// The panel
// -------------------------------------------------------------
// mountGmPanel(root, host, { mode, onPopOut, onBringBack }) draws into `root` and
// returns { refresh }. `mode` is "inline" inside the roller or "popover" in gm.html.
//
// A refresh while the GM is typing in one of its fields would throw the field away
// mid-word, so a refresh that lands then only updates the Threat readout and leaves the
// rest for when focus leaves the field.
const SECTION_DEFAULTS = { tickers: true, gain: true, spend: false, hazard: false, setup: false, fight: true, bestiary: false, log: false, ref: false };

function readUi() {
  const raw = readJson(GM_KEYS.ui, {});
  const open = { ...SECTION_DEFAULTS, ...(raw && typeof raw.open === "object" ? raw.open : {}) };
  for (const k of Object.keys(open)) open[k] = open[k] === true;
  return { open, collapsed: raw && raw.collapsed === true };
}

function linesToPairs(text, keys) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    const out = {};
    keys.forEach((k, i) => {
      // The last key takes the rest of the line, so a description may contain "|".
      out[k] = i === keys.length - 1 ? parts.slice(i).join(" | ") : (parts[i] || "");
    });
    return out;
  });
}
function pairsToLines(list, keys) {
  return (list || []).map((x) => keys.map((k) => x[k] || "").join(" | ").replace(/( \| )+$/, "")).join("\n");
}

function blankDraft(kind = "normal") {
  const n = R.normalizeNpc({ kind, name: "", id: R.newNpcId() });
  n.name = "";
  return n;
}

export function mountGmPanel(root, host, opts = {}) {
  const mode = opts.mode || "inline";
  const ui = readUi();
  const inputs = {
    gain: {}, spend: {}, reinforcementsGroup: true,
    hazard: { name: "", damage: 0, targets: 0, breaker: false, nonLethal: false, blast: false, avoid: "normal" },
    pcs: null, reversalPcs: null, rosterFilter: "", rosterKind: "all", fightCount: {}, viewing: null,
    avoid: {}, hunt: {}, cost: {}, fightOpen: null,
    editing: null, importing: false, importText: "", tickerPreset: 0,
  };
  let dirty = false;
  let lastPcCount = 0;

  const status = (msg) => host.status(msg);
  const saveUi = () => writeJson(GM_KEYS.ui, { open: ui.open, collapsed: ui.collapsed });

  function section(key, title, tipInfo, body) {
    const d = h("details", { class: "gm-sec", open: ui.open[key], dataset: { sec: key } });
    const sum = h("summary", { class: "gm-sec-head" }, h("span", { class: "gm-sec-title", text: title }));
    if (tipInfo) {
      const i = h("span", { class: "gm-info", tabindex: "0", text: "?" });
      tip(i, tipInfo);
      sum.append(i);
    }
    d.append(sum);
    d.addEventListener("toggle", () => {
      ui.open[key] = d.open;
      saveUi();
      // Built lazily: a closed section costs nothing, and the roster in particular can
      // be long.
      if (d.open && !d.querySelector(".gm-sec-body")) d.append(h("div", { class: "gm-sec-body" }, body()));
    });
    if (ui.open[key]) d.append(h("div", { class: "gm-sec-body" }, body()));
    return d;
  }

  function actionButton(text, cls, tipInfo, prompt, fn) {
    const b = h("button", { type: "button", class: "gm-btn " + (cls || ""), text });
    if (tipInfo) tip(b, tipInfo);
    return confirmButton(b, prompt, fn, status);
  }

  // ---- header ----
  function renderHead() {
    const state = host.state();
    const head = h("div", { class: "gm-panel-head gmt-head" },
      h("h2", { text: "GM Tools" }),
      h("span", { class: "gm-badge", text: "GM" }),
      h("span", { class: "gmt-threat", title: "Threat in the pool" },
        h("span", { class: "gmt-threat-label", text: "Threat" }),
        h("span", { class: "gmt-threat-value", id: mode + "-gmt-threat", text: String(Math.max(0, Number(state.threat) || 0)) })),
    );
    const u = undoAvailable();
    const undo = actionButton("Undo", "ghost gmt-undo", {
      title: "Undo the last GM Threat change",
      note: u ? `Takes back: ${u.label} (${u.delta > 0 ? "+" : ""}${u.delta} Threat).` : "Nothing to undo yet.",
    }, "Undo?", () => undoLast(host));
    undo.disabled = !u;
    head.append(undo);
    if (mode === "inline") {
      head.append(h("button", {
        type: "button", class: "ghost", text: ui.collapsed ? "Show" : "Hide",
        title: ui.collapsed ? "Show the GM tools" : "Fold the GM tools away",
        onclick: () => { ui.collapsed = !ui.collapsed; saveUi(); render(); },
      }));
      if (opts.onPopOut) {
        head.append(h("button", {
          type: "button", class: "ghost", text: "Pop out",
          title: "Open the GM tools in their own panel, docked like the character sheet",
          onclick: () => opts.onPopOut(),
        }));
      }
    }
    return head;
  }

  function renderBanner() {
    const state = host.state();
    const out = h("div", { class: "gmt-banners" });
    if (readRushed(state)) {
      const lift = actionButton("Lift", "gmt-lift", { title: "Allow rests again", note: "The next End Scene lifts the rush anyway. Lift it sooner if the table does get time to rest." },
        "Lift the rush?", () => liftRush(host));
      out.append(h("div", { class: "gmt-banner is-rushed" },
        h("span", { text: "Rushed: no rests until the next End Scene." }), lift));
    }
    return out;
  }

  // ---- tickers ----
  function renderTickers() {
    const room = host.room();
    const list = readTickers(room);
    const body = h("div", { class: "gmt-tickers" });
    const save = (next) => { writeTickers(room, next); host.changed(); };
    if (!list.length) body.append(h("p", { class: "gm-note", text: "Nothing adds Threat each round yet." }));
    list.forEach((t, i) => {
      const row = h("div", { class: "gmt-ticker" + (t.on ? "" : " is-off") });
      row.append(
        h("input", { type: "checkbox", checked: t.on, title: "On or off", onchange: (e) => { list[i].on = e.target.checked; save(list); } }),
        h("input", { type: "text", class: "gmt-ticker-name", value: t.name, maxlength: "32", "aria-label": "Ticker name",
          onchange: (e) => { list[i].name = e.target.value; save(list); } }),
        stepper(t.amount, { min: 0, max: R.TICKER_MAX, label: "Threat", onChange: (v) => { list[i].amount = v; writeTickers(room, list); refreshTotals(); } }),
        h("button", { type: "button", class: "ghost gmt-eye" + (t.visible ? " is-on" : ""), text: t.visible ? "Public" : "Hidden",
          title: t.visible ? "The table sees this ticker's name in the log. Press to hide it." : "The table sees only \"Threat rises\". Press to show the name.",
          onclick: () => { list[i].visible = !t.visible; save(list); } }),
        h("button", { type: "button", class: "ghost gmt-pin" + (t.pinned ? " is-on" : ""), text: t.pinned ? "Pinned" : "Scene",
          title: t.pinned ? "Kept when the scene ends. Press to let End Scene clear it." : "Cleared at End Scene. Press to keep it across scenes.",
          onclick: () => { list[i].pinned = !t.pinned; save(list); } }),
        h("button", { type: "button", class: "ghost init-drop", text: "×", title: "Remove this ticker",
          onclick: () => { list.splice(i, 1); save(list); } }),
      );
      body.append(row);
    });
    if (list.length < R.MAX_TICKERS) {
      const pick = h("select", { class: "gmt-preset", "aria-label": "Ticker preset",
        onchange: (e) => { inputs.tickerPreset = Number(e.target.value); } },
        R.TICKER_PRESETS.map((p, i) => h("option", { value: String(i), text: p.name })));
      pick.value = String(inputs.tickerPreset);
      body.append(h("div", { class: "gmt-row" }, pick, h("button", {
        type: "button", class: "gm-btn", text: "Add ticker",
        onclick: () => {
          const p = R.TICKER_PRESETS[inputs.tickerPreset] || R.TICKER_PRESETS[0];
          list.push({ id: "tk" + Date.now().toString(36), name: p.name, amount: p.amount, on: true, visible: false, pinned: false });
          save(list);
        },
      })));
    }
    const total = h("span", { class: "gmt-total", id: mode + "-gmt-ticktotal" });
    const tick = actionButton("Tick now", "", { title: "Add this round's Threat now", note: "Next Round in the party panel does this for you while initiative is running. This is for a clock running outside a fight." },
      () => `Add ${R.tickerTotal(readTickers(room))}?`,
      async () => {
        const init = readInitiative(host.state());
        const n = await tickRound(host, init ? init.round : 0);
        status(n ? "Round Threat added." : "Nothing to add: every ticker is off or at 0.");
      });
    body.append(h("div", { class: "gmt-row gmt-tick-row" }, total, tick));
    queueMicrotask(refreshTotals);
    return body;
  }

  function refreshTotals() {
    const el = document.getElementById(mode + "-gmt-ticktotal");
    if (el) {
      const n = R.tickerTotal(readTickers(host.room()));
      el.textContent = n ? `+${n} Threat each round` : "Adds nothing each round";
    }
  }

  // ---- gain ----
  function renderGain() {
    const body = h("div", { class: "gmt-grid" });
    for (const rule of R.GAIN_RULES) {
      const amount = () => (rule.ask ? (inputs.gain[rule.id] ?? rule.amount) : rule.amount);
      const btn = actionButton(rule.ask ? rule.label : `${rule.label} +${rule.amount}`, "gmt-gain",
        { title: rule.ask ? `${rule.label}: +${rule.min} to +${rule.max}` : `${rule.label}: +${rule.amount} Threat`, quote: rule.quote, page: rule.page },
        () => `Add ${amount()}?`,
        () => gmThreat(host, amount(), { label: rule.label, detail: `added ${amount()} Threat` }));
      const row = h("div", { class: "gmt-cell" }, btn);
      if (rule.ask) row.append(stepper(amount(), { min: rule.min, max: rule.max, label: "Threat", onChange: (v) => { inputs.gain[rule.id] = v; } }));
      body.append(row);
    }
    return body;
  }

  // ---- spend ----
  function spendInputsFor(rule) {
    if (rule.cost === "reinforcements") return { count: inputs.spend.reinforcements ?? 2, group: inputs.reinforcementsGroup };
    return { count: inputs.spend[rule.id] ?? (rule.cost === "divide" ? 2 : rule.min || 1) };
  }

  function describeSpend(rule, inp) {
    switch (rule.cost) {
      case "reinforcements": return `${inp.count} Normal NPC${inp.count === 1 ? "" : "s"}${inp.group && inp.count > 1 ? " as a group" : ""}`;
      case "incidental": return `affects ${inp.count} character${inp.count === 1 ? "" : "s"}`;
      case "truths": return `${inp.count} Truth${inp.count === 1 ? "" : "s"} changed, added or removed`;
      case "divide": return `larger part is ${inp.count} character${inp.count === 1 ? "" : "s"}`;
      default: return "";
    }
  }

  function renderSpend() {
    const body = h("div", {});
    const grid = h("div", { class: "gmt-grid" });
    for (const rule of R.SPEND_RULES) {
      const cost = () => R.spendCost(rule, spendInputsFor(rule));
      const label = () => (typeof rule.cost === "number" ? `${rule.label} −${rule.cost}` : rule.label);
      const btn = actionButton(label(), "gmt-spend",
        { title: typeof rule.cost === "number" ? `${rule.label}: ${rule.cost} Threat` : rule.label, quote: rule.quote, page: rule.page,
          note: "The table's log shows only that Threat was spent. The reason goes to your own log." },
        () => `Spend ${cost()}?`,
        () => {
          const inp = spendInputsFor(rule);
          const what = describeSpend(rule, inp);
          return gmThreat(host, -cost(), { pub: false, label: rule.label, privateLabel: rule.label, privateDetail: what || `spent ${cost()} Threat` });
        });
      const cell = h("div", { class: "gmt-cell" }, btn);
      if (typeof rule.cost !== "number") {
        const key = rule.cost === "reinforcements" ? "reinforcements" : rule.id;
        const inp = spendInputsFor(rule);
        const shown = h("span", { class: "gmt-cost", text: `= ${cost()}` });
        const max = rule.cost === "reinforcements" ? 24 : rule.cost === "divide" ? 12 : rule.max || 6;
        cell.append(stepper(inp.count, { min: 1, max, label: "", onChange: (v) => { inputs.spend[key] = v; shown.textContent = `= ${cost()}`; } }));
        if (rule.cost === "reinforcements") {
          cell.append(h("label", { class: "gmt-check", title: "A group costs half its number, rounded up (GM Guide p.113)" },
            h("input", { type: "checkbox", checked: inputs.reinforcementsGroup, onchange: (e) => { inputs.reinforcementsGroup = e.target.checked; shown.textContent = `= ${cost()}`; } }),
            "group"));
        }
        cell.append(shown);
      }
      grid.append(cell);
    }
    body.append(grid);

    // Starred GM actions, one button each.
    for (const tier of ["simple", "serious"]) {
      const t = R.GM_ACTIONS[tier];
      const head = h("div", { class: "gmt-subhead", tabindex: "0", text: `${tier === "simple" ? "Simple" : "Serious"} GM actions (${t.cost} Threat each)` });
      tip(head, { title: `${tier === "simple" ? "Simple" : "Serious"} actions`, quote: t.quote, page: t.page,
        note: "Free actions of this kind: " + t.free.join(" ") });
      body.append(head);
      const list = h("div", { class: "gmt-actions" });
      for (const text of t.starred) {
        const short = text.replace(/\*\.?$/, "");
        list.append(actionButton(`${short} −${t.cost}`, "gmt-spend gmt-wide", { title: short, quote: `${t.quote} … ${text}`, page: t.page },
          `Spend ${t.cost}?`,
          () => gmThreat(host, -t.cost, { pub: false, label: "GM action", privateLabel: `${tier === "simple" ? "Simple" : "Serious"} action`, privateDetail: short })));
      }
      body.append(list);
    }

    // The two that end the scene.
    body.append(h("div", { class: "gmt-subhead", text: "Ending the scene" }));
    const state = host.state();
    const rushed = readRushed(state);
    const rush = actionButton(`${R.RUSH_RULE.label} −${R.RUSH_RULE.cost}`, "gmt-spend gmt-wide",
      { title: "End the scene and deny the rest", quote: R.RUSH_RULE.quote, page: R.RUSH_RULE.page,
        note: "Ends the scene (the group loses 1 Momentum, as End Scene always does), spends 2 Threat, and greys out Breather, Break and Bed on every sheet and in Table Controls until the next End Scene." },
      "End scene, rushed?", () => rushScene(host));
    rush.disabled = rushed;
    body.append(rush);

    const used = reversalUsed(host);
    const pcs = inputs.reversalPcs ?? (lastPcCount || 1);
    const revCost = h("span", { class: "gmt-cost", text: `= ${R.reversalCost(pcs)}` });
    const rev = actionButton(used ? "Reversal (used this adventure)" : "Reversal", "gmt-spend",
      { title: "Reversal: 2 Threat per character present", quote: R.REVERSAL_RULE.quote, page: R.REVERSAL_RULE.page,
        note: "Spends the Threat, ends the scene, and every character on a token in this scene recovers half their maximum Spirit on their sheet. Once per adventure: available again after New Adventure." },
      () => `Spend ${R.reversalCost(inputs.reversalPcs ?? (lastPcCount || 1))} and end the scene?`,
      () => reversal(host, inputs.reversalPcs ?? (lastPcCount || 1)));
    rev.disabled = used;
    body.append(h("div", { class: "gmt-cell" }, rev,
      h("span", { class: "gmt-mini", text: "characters" }),
      stepper(pcs, { min: 1, max: 12, label: "characters", onChange: (v) => { inputs.reversalPcs = v; revCost.textContent = `= ${R.reversalCost(v)}`; } }),
      revCost));
    return body;
  }

  // ---- hazard builder ----
  function renderHazard() {
    const hz = inputs.hazard;
    const body = h("div", { class: "gmt-hazard" });
    const result = h("div", { class: "gmt-hazard-result" });
    const compute = () => R.hazardCost({ ...hz, easier: hz.avoid === "easier", harder: hz.avoid === "harder" });
    const update = () => {
      const c = compute();
      result.textContent = `${R.hazardSummary(c, hz.name)} — ${c.cost} Threat`;
    };
    const opt = (id) => R.HAZARD_OPTIONS.find((o) => o.id === id);
    const toggle = (id) => {
      const o = opt(id);
      const lab = h("label", { class: "gmt-check", tabindex: "0" },
        h("input", { type: "checkbox", checked: hz[id], onchange: (e) => { hz[id] = e.target.checked; update(); } }),
        `${o.label} (${o.cost > 0 ? "+" : "−"}${Math.abs(o.cost)})`);
      tip(lab, { title: o.label, quote: o.quote, page: o.page });
      return lab;
    };
    body.append(
      h("input", { type: "text", class: "gmt-hazard-name", placeholder: "What is it? (burning, falling rubble…)", maxlength: "30", value: hz.name,
        oninput: (e) => { hz.name = e.target.value; update(); } }),
      h("div", { class: "gmt-row" },
        tip(h("span", { class: "gmt-mini", tabindex: "0", text: `Damage ${R.HAZARD_BASE.damage} +` }), { title: "+1 Damage Rating", quote: opt("damage").quote, page: 117 }),
        stepper(hz.damage, { min: 0, max: 6, label: "damage", onChange: (v) => { hz.damage = v; update(); } }),
        tip(h("span", { class: "gmt-mini", tabindex: "0", text: "Extra targets" }), { title: "Additional Target", quote: opt("targets").quote, page: 117 }),
        stepper(hz.targets, { min: 0, max: 6, label: "targets", onChange: (v) => { hz.targets = v; update(); } })),
      h("div", { class: "gmt-row gmt-wrap" }, toggle("breaker"), toggle("nonLethal"), toggle("blast")),
      h("div", { class: "segmented gmt-avoid" },
        ["easier", "normal", "harder"].map((k) => {
          const b = h("button", { type: "button", class: hz.avoid === k ? "on" : "", text: k === "easier" ? "Avoid D1 (−2)" : k === "harder" ? "Avoid D3 (+2)" : "Avoid D2",
            onclick: (e) => { hz.avoid = k; e.currentTarget.parentNode.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === e.currentTarget)); update(); } });
          if (k !== "normal") tip(b, { title: opt(k).label, quote: opt(k).quote, page: 117 });
          return b;
        })),
      result,
    );
    const spend = actionButton("Spend on this hazard", "gmt-spend gmt-wide",
      { title: "An immediate hazard", quote: R.HAZARD_BASE.quote, page: R.HAZARD_BASE.page,
        note: "The table's log shows only that Threat was spent. The hazard, its damage and its qualities go to your own log, to read out as you describe it." },
      () => `Spend ${compute().cost}?`,
      () => {
        const c = compute();
        if (!c.cost) { status("That hazard costs nothing. Describe it and roll."); return null; }
        return gmThreat(host, -c.cost, { pub: false, label: "Hazard", privateLabel: "Hazard", privateDetail: R.hazardSummary(c, hz.name) });
      });
    const linger = h("p", { class: "gm-note", tabindex: "0", text: "Lingering hazards: build it here, then add a \"Lingering hazard\" ticker if it should also build Threat each round." });
    tip(linger, { title: "Lingering Hazards", quote: R.LINGERING_RULE.quote, page: R.LINGERING_RULE.page });
    body.append(spend, linger);
    update();
    return body;
  }

  // ---- adventure setup ----
  function renderSetup() {
    const settings = readSettings();
    const body = h("div", {});
    const pcs = inputs.pcs ?? (lastPcCount || 4);
    const out = h("span", { class: "gmt-cost" });
    const update = () => {
      const s = readSettings();
      out.textContent = `= ${R.startingThreat(s.stakes, inputs.pcs ?? (lastPcCount || 4))} Threat`;
    };
    const seg = h("div", { class: "segmented gmt-stakes" }, R.STAKES.map((s) => {
      const b = h("button", { type: "button", class: settings.stakes === s.id ? "on" : "", text: `${s.label} ${s.perPc}`,
        onclick: (e) => { writeSettings({ stakes: s.id }); e.currentTarget.parentNode.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === e.currentTarget)); update(); } });
      tip(b, { title: `${s.label} stakes: ${s.perPc} Threat per character`, quote: s.quote, page: s.page });
      return b;
    }));
    body.append(seg, h("div", { class: "gmt-row" },
      h("span", { class: "gmt-mini", text: "characters" }),
      stepper(pcs, { min: 1, max: 12, label: "characters", onChange: (v) => { inputs.pcs = v; update(); } }),
      out));
    body.append(actionButton("Set Threat to this", "gmt-gain gmt-wide",
      { title: "Set the pool to the adventure's starting Threat", quote: R.STAKES[1].quote, page: 111,
        note: "Moves the pool to exactly this number, up or down, and logs it. Press it after New Adventure." },
      () => `Set to ${R.startingThreat(readSettings().stakes, inputs.pcs ?? (lastPcCount || 4))}?`,
      async () => {
        const d = await setStartingThreat(host, readSettings().stakes, inputs.pcs ?? (lastPcCount || 4));
        if (!d) status("Threat is already at that number.");
      }));
    const growth = h("label", { class: "gmt-check gmt-growth", tabindex: "0" },
      h("input", { type: "checkbox", checked: settings.awardGrowth, onchange: (e) => { writeSettings({ awardGrowth: e.target.checked }); } }),
      "Spending 3 or more Threat at once gives each character in the scene 1 Growth");
    tip(growth, { title: "Growth from adversity", quote: R.GROWTH_RULE.quote, page: R.GROWTH_RULE.page,
      note: "Applies to every spend of 3 or more from these tools or the roller's − button. Each sheet adds it the next time it is open, up to the 10 unspent Growth a character may hold." });
    body.append(growth);
    const arrival = h("label", { class: "gmt-check gmt-growth", tabindex: "0" },
      h("input", { type: "checkbox", checked: settings.arrivalThreat, onchange: (e) => { writeSettings({ arrivalThreat: e.target.checked }); host.changed(); } }),
      R.ARRIVAL_HOUSE_RULE.label);
    tip(arrival, { title: R.ARRIVAL_HOUSE_RULE.label, quote: R.MENACING_RULE.quote, page: R.MENACING_RULE.page, note: R.ARRIVAL_HOUSE_RULE.note });
    body.append(arrival);
    return body;
  }

  // ---- NPCs ----
  function statLine(npc) {
    if (npc.kind === "major") {
      const a = R.NPC_ATTRS.map((k) => `${ATTRS[k].slice(0, 3)} ${npc.attrs[k]}`).join(" · ");
      const s = R.NPC_SKILLS.filter((k) => npc.skills[k]).map((k) => `${SKILLS[k]} ${npc.skills[k]}`).join(" · ");
      return `${a}${s ? " — " + s : ""}`;
    }
    return `${npc.truth || "Truth"} ${npc.main.attr}/${npc.main.skill} · Default ${npc.fallback.attr}/${npc.fallback.skill}`;
  }

  // A stat block line's name, with the book's wording on hover when it is one of the
  // common abilities or actions (pp.130-131).
  function abilityName(name, extra) {
    const key = R.abilityKey(name);
    const lib = key && R.abilityByKey(key);
    const b = h("b", { class: lib ? "gmt-has-tip" : "", tabindex: lib ? "0" : null, text: name + (extra || "") });
    if (lib) tip(b, { title: lib.label, quote: lib.quote, page: lib.page });
    return b;
  }

  function fact(text, t) {
    const el = h("span", { class: "gmt-fact", tabindex: t ? "0" : null, text });
    if (t) tip(el, t);
    return el;
  }

  function competenceLabel(attr, skill) {
    const c = R.competenceOf(attr, skill);
    return c ? c.label : "";
  }

  function renderStatblock(npc) {
    const box = h("div", { class: "gmt-statblock" });
    if (npc.kind === "major") {
      if (npc.truths.length) box.append(h("div", { class: "gmt-sb-truth", text: npc.truths.join(" · ") }));
      box.append(h("div", { class: "gmt-sb-grid" },
        R.NPC_ATTRS.map((k) => h("span", { class: "gmt-sb-cell" }, h("small", { text: ATTRS[k] }), String(npc.attrs[k])))));
      box.append(h("div", { class: "gmt-sb-grid is-skills" },
        R.NPC_SKILLS.map((k) => h("span", { class: "gmt-sb-cell" }, h("small", { text: SKILLS[k] }), String(npc.skills[k])))));
    } else {
      const main = competenceLabel(npc.main.attr, npc.main.skill);
      const def = competenceLabel(npc.fallback.attr, npc.fallback.skill);
      const pair = h("div", { class: "gmt-sb-grid is-normal", tabindex: "0" },
        h("span", { class: "gmt-sb-cell" }, h("small", { text: npc.truth || "Truth" }), `${npc.main.attr} / ${npc.main.skill}`, main ? h("em", { text: main }) : null),
        h("span", { class: "gmt-sb-cell" }, h("small", { text: "Default" }), `${npc.fallback.attr} / ${npc.fallback.skill}`, def ? h("em", { text: def }) : null));
      tip(pair, { title: "Truth and Default", quote: R.NORMAL_NPC_RULE.quote, page: R.NORMAL_NPC_RULE.page,
        note: "Competence (p.128) is shown under each pair where the numbers match the table." });
      box.append(pair);
    }
    const facts = h("div", { class: "gmt-sb-facts" });
    const limit = R.defeatLimit(npc);
    facts.append(fact(`Defeat: ${limit} Injur${limit === 1 ? "y" : "ies"}`, npc.kind === "major"
      ? { title: "Defeat", quote: R.MAJOR_DEFEAT_RULE.quote, page: R.MAJOR_DEFEAT_RULE.page, note: npc.defeat ? null : "No number set, so Truths + 1." }
      : { title: "Defeat", quote: R.NORMAL_DEFEAT_RULE.quote, page: R.NORMAL_DEFEAT_RULE.page }));
    if (npc.personalThreat) facts.append(fact(`Personal Threat ${npc.personalThreat}`, { title: "Personal Threat", quote: R.MAJOR_PT_RULE.quote, page: R.MAJOR_PT_RULE.page }));
    if (npc.protection || npc.rangedProtection) {
      const arm = R.abilityByKey("armored");
      facts.append(fact(`Protection ${npc.protection}${npc.rangedProtection ? ` (+${npc.rangedProtection} vs ranged)` : ""}`, { title: "Protection", quote: arm.quote, page: arm.page }));
    }
    if (npc.menacing && readSettings().arrivalThreat) facts.append(fact(`Arrival +${npc.menacing}`, { title: R.ARRIVAL_HOUSE_RULE.label, note: R.ARRIVAL_HOUSE_RULE.note }));
    box.append(facts);
    if (npc.weapons.length) box.append(h("div", { class: "gmt-sb-head", text: "Weapons" }));
    for (const w of npc.weapons) {
      box.append(h("div", { class: "gmt-sb-item" }, h("b", { text: w.name }),
        ` (${w.range || "—"}): ${w.damage || "—"}${w.qualities ? ", " + w.qualities : ""}`));
    }
    if (npc.actions.length) {
      const head = h("div", { class: "gmt-sb-head", tabindex: npc.kind === "major" ? "0" : null, text: R.hasActionTable(npc) ? "Actions (d20)" : "Actions" });
      if (npc.kind === "major") tip(head, { title: "Special Actions", quote: R.MAJOR_ACTIONS_RULE.quote, page: R.MAJOR_ACTIONS_RULE.page });
      box.append(head);
    }
    for (const a of npc.actions) box.append(h("div", { class: "gmt-sb-item" }, abilityName(a.name, a.roll ? ` (${a.roll})` : ""), `: ${a.text}`));
    if (npc.abilities.length) box.append(h("div", { class: "gmt-sb-head", text: "Special abilities" }));
    for (const a of npc.abilities) box.append(h("div", { class: "gmt-sb-item" }, abilityName(a.name), `: ${a.text}`));
    if (npc.notes) box.append(h("div", { class: "gmt-sb-notes", text: npc.notes }));
    if (npc.source) box.append(h("div", { class: "gmt-sb-source", text: npc.source }));
    return box;
  }

  // The fighter's own tools: everything Chapter 5 lets an NPC do that touches Threat or
  // its Injuries. Drawn when its name is opened.
  function renderFighterTools(f, npc) {
    const box = h("div", { class: "gmt-tools" });
    const ally = f.side === "ally";
    const run = async (p) => { const r = await p; if (r && r.error) status(r.error); return r; };
    const costLabel = (c) => (ally && !(f.payPt && f.pt >= c) ? `+${c}` : `−${c}`);
    const costPrompt = (c) => (ally && !(f.payPt && f.pt >= c) ? `Add ${c}?` : `Spend ${c}?`);

    // Who it is to the characters (p.126), and what that does to its spending (p.127).
    box.append(h("div", { class: "segmented gmt-side" }, R.SIDES.map((sd) => {
      const b = h("button", { type: "button", class: f.side === sd.id ? "on" : "", text: sd.label,
        onclick: () => updateFighter(host, f.rowId, { side: sd.id }) });
      tip(b, { title: sd.label, quote: sd.quote, page: sd.page, note: sd.id === "ally" ? `${R.ALLY_RULE.quote} (GM Guide p.${R.ALLY_RULE.page})` : null });
      return b;
    })));

    // Injuries and defeat.
    const limit = R.defeatLimit(npc);
    const group = f.startCount > 1;
    const down = fighterDefeated(f, npc);
    const count = h("span", { class: "gmt-fact" + (down ? " is-down" : ""), tabindex: "0",
      text: group ? `${f.count} of ${f.startCount} standing` : `Injuries ${f.injuries}/${limit}` });
    tip(count, group
      ? { title: R.GROUP_RULES.defeat.label, quote: R.GROUP_RULES.defeat.quote, page: R.GROUP_RULES.defeat.page }
      : npc.kind === "major"
        ? { title: "Defeat", quote: R.MAJOR_DEFEAT_RULE.quote, page: R.MAJOR_DEFEAT_RULE.page }
        : { title: "Defeat", quote: R.NORMAL_DEFEAT_RULE.quote, page: R.NORMAL_DEFEAT_RULE.page });
    box.append(h("div", { class: "gmt-row gmt-wrap" }, count,
      h("button", { type: "button", class: "gm-btn", text: group ? "One falls" : "Injury", disabled: down,
        title: "Record an Injury it did not avoid. Your notes only.", onclick: () => injureFighter(host, f.rowId, 1) }),
      h("button", { type: "button", class: "ghost gm-step", text: "−", title: "Undo the last Injury",
        disabled: group ? f.count >= f.startCount : f.injuries <= 0, onclick: () => injureFighter(host, f.rowId, -1) }),
      down ? h("span", { class: "gmt-tag is-down", text: "Defeated" }) : null));

    // Avoid an Injury (pp.126, 130).
    const av = inputs.avoid[f.rowId] || (inputs.avoid[f.rowId] = { damage: 2, breaker: false, ranged: false, defending: false });
    const keys = R.npcKeys(npc);
    const avoidCost = () => R.avoidInjuryCost({ damage: av.damage, protection: npc.protection, rangedProtection: npc.rangedProtection, ranged: av.ranged, defending: av.defending, breaker: av.breaker });
    const shown = h("span", { class: "gmt-cost" });
    const avoidBtn = actionButton("Avoid the Injury", ally ? "gmt-gain" : "gmt-spend",
      { title: "Avoid an Injury", quote: R.NPC_SPEND_RULE.quote, page: R.NPC_SPEND_RULE.page,
        note: `Costs the attack's damage rating less Protection${npc.protection ? ` (${npc.protection}, halved by Breaker)` : ""}. Paid from Personal Threat first when it has enough and the box below is ticked; an ally adds to Threat instead.` },
      () => costPrompt(avoidCost()),
      async () => {
        const c = avoidCost();
        if (!c) { status("Protection stops it: there is nothing to pay."); return; }
        const r = await run(npcSpend(host, f.rowId, c, { what: "avoids an Injury", publicWhat: "Injury avoided" }));
        if (r && !r.error) status(`${f.name} avoids the Injury.`);
      });
    const upd = () => { const c = avoidCost(); shown.textContent = c ? `= ${costLabel(c)}` : "= nothing"; };
    const chk = (k, label, t) => {
      const l = h("label", { class: "gmt-check", tabindex: t ? "0" : null },
        h("input", { type: "checkbox", checked: av[k], onchange: (e) => { av[k] = e.target.checked; upd(); } }), label);
      if (t) tip(l, t);
      return l;
    };
    box.append(h("div", { class: "gmt-subhead", text: "Avoid an Injury" }),
      h("div", { class: "gmt-row gmt-wrap" },
        h("span", { class: "gmt-mini", text: "damage" }),
        stepper(av.damage, { min: 0, max: 12, label: "damage", onChange: (v) => { av.damage = v; upd(); } }),
        chk("breaker", "Breaker", { title: "Breaker", quote: R.abilityByKey("armored").quote, page: 130 }),
        npc.rangedProtection ? chk("ranged", "ranged attack") : null,
        keys.has("defend") ? chk("defending", "Defending (+2)", { title: "Defend", quote: R.abilityByKey("defend").quote, page: 131 }) : null,
        shown, avoidBtn));
    upd();
    if (f.pt > 0 || (npc.personalThreat > 0)) {
      box.append(h("label", { class: "gmt-check", tabindex: "0" },
        h("input", { type: "checkbox", checked: f.payPt, onchange: (e) => updateFighter(host, f.rowId, { payPt: e.target.checked }) }),
        `Pay from Personal Threat first (${f.pt} left)`));
    }

    // A group (p.128).
    if (group) {
      const bonus = R.groupDefenceBonus(f.count);
      const g = h("span", { class: "gmt-fact", tabindex: "0", text: `Attacks on it: +${bonus} Difficulty while it can defend` });
      tip(g, { title: R.GROUP_RULES.attack.label, quote: R.GROUP_RULES.attack.quote, page: R.GROUP_RULES.attack.page });
      const hits = h("span", { class: "gmt-fact", tabindex: "0", text: "Extra hits: 2 Momentum each (1 with Burst)" });
      tip(hits, { title: R.GROUP_RULES.defeat.label, quote: R.GROUP_RULES.defeat.quote, page: R.GROUP_RULES.defeat.page });
      const lead = h("span", { class: "gmt-fact", tabindex: "0", text: "Tests: one leads, the rest assist" });
      tip(lead, { title: R.GROUP_RULES.action.label, quote: R.GROUP_RULES.action.quote, page: R.GROUP_RULES.action.page });
      box.append(h("div", { class: "gmt-subhead", text: "Group" }), h("div", { class: "gmt-row gmt-wrap" }, g, hits, lead,
        actionButton(`Counter-attack ${costLabel(R.COUNTER_ATTACK_COST)}`, ally ? "gmt-gain" : "gmt-spend",
          { title: "Counter-attack", quote: R.GROUP_RULES.attack.quote, page: R.GROUP_RULES.attack.page, note: "Only for a group that had the defence bonus, after an attack on it misses." },
          costPrompt(R.COUNTER_ATTACK_COST),
          () => run(npcSpend(host, f.rowId, R.COUNTER_ATTACK_COST, { what: "counter-attacks" })))));
    }

    // Its abilities and actions that have a price or a payout.
    const btns = h("div", { class: "gmt-row gmt-wrap" });
    const lib = (k) => R.abilityByKey(k);
    if (keys.has("threatening")) {
      btns.append(actionButton("Acts: +1 Threat", "gmt-gain", { title: "Threatening", quote: lib("threatening").quote, page: 130, note: "Adds 1 to Threat and ticks its row as having acted." },
        "Add 1?", () => threateningAct(host, f.rowId)));
    }
    if (keys.has("solitary")) {
      const c = solitaryNextCost(host, f);
      btns.append(actionButton(`Extra turn ${costLabel(c)}`, ally ? "gmt-gain" : "gmt-spend", { title: "Solitary", quote: lib("solitary").quote, page: 131, note: "The count starts again each round." },
        costPrompt(c), () => run(solitaryTurn(host, f.rowId))));
    }
    if (keys.has("hunt")) {
      const n = inputs.hunt[f.rowId] ?? 1;
      btns.append(h("span", { class: "gmt-cell" },
        actionButton("Hunt", "gmt-gain", { title: "Hunt", quote: lib("hunt").quote, page: 131, note: "Roll its Insight (Study) at Difficulty 0, then set the successes here." },
          () => `Add ${inputs.hunt[f.rowId] ?? 1}?`, () => huntGain(host, f.rowId, inputs.hunt[f.rowId] ?? 1)),
        stepper(n, { min: 1, max: 10, label: "successes", onChange: (v) => { inputs.hunt[f.rowId] = v; } })));
    }
    const retreatText = (npc.actions || []).some((a) => /retreat/i.test(a.name + " " + a.text));
    if (keys.has("retreat") || retreatText) {
      const x = R.injuriesLeft(npc, f);
      btns.append(actionButton(`Retreat +${x}`, "gmt-gain", { title: "Retreat", quote: lib("retreat").quote, page: 131, note: "Adds the Threat and takes it out of the fight." },
        `Add ${x} and remove?`, () => retreatFighter(host, f.rowId)));
    }
    const handled = new Set(["threatening", "solitary", "hunt", "retreat"]);
    for (const a of [...npc.actions, ...npc.abilities]) {
      const k = R.abilityKey(a.name);
      if (k && handled.has(k)) continue;
      const range = R.threatCostIn(a.text) || (k && lib(k).cost ? { min: lib(k).cost, max: lib(k).cost } : null);
      if (!range) continue;
      const key = f.rowId + ":" + a.name;
      const amount = () => Math.max(range.min, Math.min(range.max, inputs.cost[key] ?? range.min));
      const t = k ? { title: lib(k).label, quote: lib(k).quote, page: lib(k).page, note: `This stat block: ${a.text}` } : { title: a.name, note: a.text };
      const b = actionButton(range.min === range.max ? `${a.name} ${costLabel(range.min)}` : a.name, ally ? "gmt-gain" : "gmt-spend", t,
        () => costPrompt(amount()), () => run(npcSpend(host, f.rowId, amount(), { what: `uses ${a.name}` })));
      btns.append(range.min === range.max ? b : h("span", { class: "gmt-cell" }, b,
        stepper(amount(), { min: range.min, max: range.max, label: "Threat", onChange: (v) => { inputs.cost[key] = v; } })));
    }
    if (btns.childNodes.length) box.append(h("div", { class: "gmt-subhead", text: "Abilities and actions" }), btns);

    // A Major NPC's action table (p.129).
    if (R.hasActionTable(npc)) {
      const last = f.lastAction;
      const res = h("span", { class: "gmt-fact", text: last ? `Rolled ${last.d}: ${last.name || "nothing on that number"}` : "Not rolled yet" });
      const roll = h("button", { type: "button", class: "gm-btn", text: "Roll its action (d20)", onclick: () => {
        const r = rollFighterAction(host, f.rowId);
        if (r) status(`${f.name}: ${r.d} — ${r.action ? r.action.name : "no action on that number"}.`);
      } });
      tip(roll, { title: "Special Actions", quote: R.MAJOR_ACTIONS_RULE.quote, page: R.MAJOR_ACTIONS_RULE.page, note: "Rolled here and told only to you, in your own log." });
      box.append(h("div", { class: "gmt-row gmt-wrap" }, roll, res));
    }
    return box;
  }

  function renderFight() {
    const room = host.room();
    const init = readInitiative(host.state());
    const rows = new Set(init ? init.rows.map((r) => r.id) : []);
    // A fighter whose row is not in the order is not SHOWN — the GM took it out with the
    // party panel's ×, or the round ended. It is not deleted here, though: a render can
    // run before the room has echoed back the row this browser has just added, and
    // pruning against that stale order deleted the NPC it had just put in. The list is
    // cleared where the fight actually ends (End Scene, End) instead.
    const fight = readFight(room).filter((f) => rows.has(f.rowId));
    const body = h("div", { class: "gmt-fight" });
    if (!fight.length) {
      body.append(h("p", { class: "gm-note", text: "No NPCs in the order. Add one from the Bestiary; it goes in hidden." }));
      return body;
    }
    for (const f of fight) {
      const npc = findNpc(f.npcId);
      const open = inputs.fightOpen === f.rowId;
      const down = npc && fighterDefeated(f, npc);
      const row = h("div", { class: "gmt-fighter" + (f.revealed ? "" : " is-hidden") + (down ? " is-down" : "") },
        h("button", { type: "button", class: "gmt-fighter-name", "aria-expanded": open ? "true" : "false", text: (open ? "▾ " : "▸ ") + f.name,
          title: "Show its tools and stat block",
          onclick: () => { inputs.fightOpen = open ? null : f.rowId; render(); } }),
        f.side !== "adversary" ? h("span", { class: "gmt-tag", text: f.side === "ally" ? "Ally" : "Bystander" }) : null,
        h("span", { class: "init-hidden-mark", hidden: f.revealed, text: "hidden" }),
        npc ? h("span", { class: "gmt-mini", text: f.startCount > 1 ? `${f.count}/${f.startCount}` : `${f.injuries}/${R.defeatLimit(npc)} inj` }) : null);
      if (!f.revealed) {
        const arrive = npc && npc.menacing && readSettings().arrivalThreat ? ` and adds ${npc.menacing} Threat (house rule)` : "";
        row.append(
          actionButton("Reveal", "", { title: "It enters the scene", note: `Shows its name in the order${arrive}.` },
            "Reveal?", () => revealFighter(host, f.rowId, { reinforcements: false })),
          actionButton("Arrives", "", { title: "Arrives as reinforcements", quote: R.SPEND_RULES.find((r) => r.id === "reinforcements").quote, page: 113,
            note: `Reveals it and spends ${R.reinforcementCost(f.startCount, f.startCount > 1)} Threat for reinforcements${arrive}.` },
            `Spend ${R.reinforcementCost(f.startCount, f.startCount > 1)}?`, () => revealFighter(host, f.rowId, { reinforcements: true })),
        );
      }
      if (npc && npc.personalThreat > 0) {
        const pt = h("span", { class: "gmt-pt", tabindex: "0", text: `PT ${f.pt}/${npc.personalThreat}` });
        tip(pt, { title: "Personal Threat", quote: R.PERSONAL_THREAT_RULE.quote, page: R.PERSONAL_THREAT_RULE.page,
          note: "It comes into each scene full. Kept in your browser only." });
        row.append(pt,
          h("button", { type: "button", class: "ghost gm-step", text: "−", title: "Spend 1 Personal Threat", disabled: f.pt <= 0, onclick: () => spendPersonalThreat(host, f.rowId, -1) }),
          h("button", { type: "button", class: "ghost gm-step", text: "+", title: "Give back 1 Personal Threat", disabled: f.pt >= npc.personalThreat, onclick: () => spendPersonalThreat(host, f.rowId, 1) }));
      }
      row.append(actionButton("×", "ghost init-drop", { title: "Take out of the fight" }, "Remove?", () => dropFighter(host, f.rowId)));
      body.append(row);
      if (open && npc) body.append(renderFighterTools(f, npc), renderStatblock(npc));
      else if (open) body.append(h("p", { class: "gm-note", text: "Its stat block is not in this browser's Bestiary." }));
    }
    return body;
  }

  function renderBestiary() {
    const body = h("div", { class: "gmt-roster" });
    const roster = readRoster();
    const filter = inputs.rosterFilter.trim().toLowerCase();
    const shown = roster.filter((n) => (inputs.rosterKind === "all" || n.kind === inputs.rosterKind)
      && (!filter || n.name.toLowerCase().includes(filter) || (n.truth || "").toLowerCase().includes(filter) || n.truths.some((t) => t.toLowerCase().includes(filter))));
    body.append(h("div", { class: "gmt-row gmt-wrap" },
      h("input", { type: "text", class: "gmt-filter", placeholder: `Find among ${roster.length}…`, value: inputs.rosterFilter,
        oninput: (e) => { inputs.rosterFilter = e.target.value; const list = e.target.closest(".gmt-roster"); list && list.replaceWith(renderBestiary()); const f = root.querySelector(".gmt-filter"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } } }),
      h("div", { class: "segmented gmt-kind" }, [["all", "All"], ["normal", "Normal"], ["major", "Major"]].map(([k, label]) => h("button", {
        type: "button", class: inputs.rosterKind === k ? "on" : "", text: label, onclick: () => { inputs.rosterKind = k; render(); } }))),
      h("button", { type: "button", class: "gm-btn", text: "New stat block", onclick: () => { inputs.editing = blankDraft(); render(); } }),
    ));
    if (roster.some((n) => n.sample)) {
      body.append(h("p", { class: "gm-note gmt-sample-note", text: "SAMPLE entries are placeholders in the book's shape, not the book's creatures. Import the Chapter 5 roster file to add those." }));
    }
    for (const npc of shown) {
      const count = inputs.fightCount[npc.id] ?? 1;
      const open = inputs.viewing === npc.id;
      const row = h("div", { class: "gmt-npc" },
        h("button", { type: "button", class: "gmt-npc-name", "aria-expanded": open ? "true" : "false", text: (open ? "▾ " : "▸ ") + npc.name, title: "Show the stat block",
          onclick: () => { inputs.viewing = open ? null : npc.id; render(); } }),
        h("span", { class: "gmt-tag", text: npc.kind === "major" ? "Major" : "Normal" }),
        npc.sample ? h("span", { class: "gmt-tag is-sample", text: "Sample" }) : null,
        h("span", { class: "gmt-npc-line", text: statLine(npc) }),
      );
      const actions = h("div", { class: "gmt-npc-actions" },
        stepper(count, { min: 1, max: 24, label: "in the group", onChange: (v) => { inputs.fightCount[npc.id] = v; } }),
        actionButton("Into fight", "", { title: "Add to the initiative order, hidden",
          note: "Goes into the order as a hidden row: the table sees \"Hidden\" until you press Reveal or Arrives under In this fight. More than one makes a single group row (p.128). Starts initiative if it is not running." },
          "Add hidden?", async () => {
            const r = await addNpcToFight(host, npc, inputs.fightCount[npc.id] ?? 1);
            status(r && r.error ? r.error : `${npc.name} is in the order, hidden.`);
          }),
        actionButton("On token", "", { title: "Attach to the selected token",
          note: "Select one token on the map first. It gets an anonymous id only, never the name or the stats, so players learn nothing from it. Select it later and the roller fills in this stat block." },
          "Attach?", async () => {
            const r = await attachNpcToSelected(host, npc);
            status(r.error || `${npc.name} attached. Select the token to roll for it.`);
          }),
        actionButton("Place on map", "", { title: "Put a new token for it on the map",
          note: "A popover cannot drag onto the map, so this drops a token in the middle of your view instead: HIDDEN, named only \"NPC\", carrying the anonymous id. Move it, then show it from Owlbear's own menu when the table should see it." },
          "Place?", async () => {
            const r = await placeNpcOnMap(host, npc);
            status(r.error || `A hidden token for ${npc.name} is in the middle of your view.`);
          }),
        h("button", { type: "button", class: "ghost", text: "Edit", onclick: () => { inputs.editing = { ...npc, sample: false }; render(); } }),
        actionButton("×", "ghost init-drop", { title: `Delete ${npc.name} from the Bestiary` }, "Delete?", () => {
          writeRoster(readRoster().filter((n) => n.id !== npc.id));
          host.changed();
        }),
      );
      body.append(h("div", { class: "gmt-npc-wrap" + (open ? " is-open" : "") }, row, actions, open ? renderStatblock(npc) : null));
    }
    if (!shown.length) body.append(h("p", { class: "gm-note", text: "Nothing matches." }));
    body.append(h("div", { class: "gmt-row gmt-wrap" },
      h("button", { type: "button", class: "ghost", text: "Export", onclick: exportRoster }),
      h("button", { type: "button", class: "ghost", text: "Import", onclick: () => { inputs.importing = !inputs.importing; render(); } }),
      h("button", { type: "button", class: "ghost", text: "Detach NPC from token",
        onclick: async () => { const r = await detachNpcFromSelected(host); status(r.error || "NPC detached from the token."); } }),
    ));
    if (inputs.importing) {
      const ta = h("textarea", { class: "backup-text", rows: "5", placeholder: "Paste a roster file here (an export, or the Chapter 5 file)", value: inputs.importText,
        oninput: (e) => { inputs.importText = e.target.value; } });
      const file = h("input", { type: "file", accept: ".txt,.json,text/plain,application/json", class: "gmt-file",
        onchange: async (e) => { const fl = e.target.files && e.target.files[0]; if (fl) { inputs.importText = (await fl.text()).slice(0, 400000); ta.value = inputs.importText; } } });
      body.append(file, ta, h("button", { type: "button", class: "gm-btn", text: "Add these to the Bestiary", onclick: () => {
        const r = R.rosterFromText(inputs.importText);
        if (r.error) { status(r.error); return; }
        const byId = new Map(readRoster().map((n) => [n.id, n]));
        for (const n of r.npcs) byId.set(n.id, n);
        writeRoster([...byId.values()]);
        inputs.importing = false; inputs.importText = "";
        status(`${r.npcs.length} stat block${r.npcs.length === 1 ? "" : "s"} imported.`);
        host.changed();
      } }));
    }
    return body;
  }

  function exportRoster() {
    const text = R.rosterToText(readRoster());
    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: "dnm-npc-roster-" + new Date().toISOString().slice(0, 10) + ".txt" });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status("Roster saved. Samples are left out; import puts the rest back.");
    } catch (err) {
      inputs.importing = true; inputs.importText = text; render();
      status("Download blocked here. Copy the text instead.");
    }
  }

  function renderEditor() {
    const d = inputs.editing;
    const box = h("div", { class: "gmt-editor" });
    const field = (label, el) => h("label", { class: "gmt-field" }, label, el);
    const num = (val, min, max, set) => h("input", { type: "number", min: String(min), max: String(max), value: String(val), oninput: (e) => set(Number(e.target.value)) });
    const text = (val, max, set, ph) => h("input", { type: "text", maxlength: String(max), value: val || "", placeholder: ph || "", oninput: (e) => set(e.target.value) });
    const area = (val, set, ph, rows = 3) => h("textarea", { class: "backup-text", rows: String(rows), placeholder: ph, value: val, oninput: (e) => set(e.target.value) });

    box.append(h("div", { class: "gmt-subhead", text: d.name ? `Editing ${d.name}` : "New stat block" }));
    box.append(h("div", { class: "segmented" }, ["normal", "major"].map((k) => h("button", {
      type: "button", class: d.kind === k ? "on" : "", text: k === "major" ? "Major NPC" : "Normal NPC",
      onclick: () => { d.kind = k; render(); },
    }))));
    box.append(field("Name", text(d.name, 32, (v) => { d.name = v; }, "Raider")));
    box.append(field("Source", text(d.source, 60, (v) => { d.source = v; }, "Homebrew, or the adventure it is from")));
    if (d.kind === "normal") {
      box.append(field("Truth", text(d.truth, 60, (v) => { d.truth = v; }, "What it is and what it is good at")));
      // Competence (p.128) fills a pair; the numbers stay editable.
      const pick = (pair) => {
        const sel = h("select", { "aria-label": "Competence", onchange: (e) => {
          const c = R.COMPETENCE.find((x) => x.id === e.target.value);
          if (c) { pair.attr = c.attr; pair.skill = c.skill; render(); }
        } }, h("option", { value: "", text: "Competence…" }), R.COMPETENCE.map((c) => h("option", { value: c.id, text: `${c.label} (${c.range} / ${c.skill})` })));
        const c = R.competenceOf(pair.attr, pair.skill);
        sel.value = c ? c.id : "";
        tip(sel, { title: "NPC Competence", quote: R.COMPETENCE_RULE.quote, page: R.COMPETENCE_RULE.page });
        return sel;
      };
      box.append(h("div", { class: "gmt-row gmt-wrap" },
        field("Truth", pick(d.main)),
        field("attribute", num(d.main.attr, 0, 20, (v) => { d.main.attr = v; })),
        field("skill", num(d.main.skill, 0, 6, (v) => { d.main.skill = v; }))));
      box.append(h("div", { class: "gmt-row gmt-wrap" },
        field("Default", pick(d.fallback)),
        field("attribute", num(d.fallback.attr, 0, 20, (v) => { d.fallback.attr = v; })),
        field("skill", num(d.fallback.skill, 0, 6, (v) => { d.fallback.skill = v; }))));
      if (d.fallback.skill >= d.main.skill && d.main.skill > 0) box.append(h("p", { class: "gm-note", text: "The book: the Default skill \"is always lower than the main skill\" (p.127)." }));
    } else {
      box.append(field("Truths, one per line", area(d.truths.join("\n"), (v) => { d.truths = v.split("\n"); }, "Scarred veteran\nCommands by fear")));
      box.append(h("div", { class: "gmt-row gmt-wrap" }, R.NPC_ATTRS.map((k) => field(ATTRS[k], num(d.attrs[k], 0, 20, (v) => { d.attrs[k] = v; })))));
      box.append(h("div", { class: "gmt-row gmt-wrap" }, R.NPC_SKILLS.map((k) => field(SKILLS[k], num(d.skills[k], 0, 6, (v) => { d.skills[k] = v; })))));
      box.append(h("div", { class: "gmt-row" },
        tip(field(`Injuries to defeat (0 = Truths + 1 = ${Math.max(1, d.truths.filter((t) => String(t).trim()).length) + 1})`, num(d.defeat, 0, 12, (v) => { d.defeat = v; })),
          { title: "Defeat", quote: R.MAJOR_DEFEAT_RULE.quote, page: R.MAJOR_DEFEAT_RULE.page }),
        field("Personal Threat", num(d.personalThreat, 0, 20, (v) => { d.personalThreat = v; }))));
    }
    const arm = R.abilityByKey("armored");
    box.append(h("div", { class: "gmt-row gmt-wrap" },
      tip(field("Protection", num(d.protection, 0, 10, (v) => { d.protection = v; })), { title: "Armored", quote: arm.quote, page: arm.page }),
      field("+ vs ranged", num(d.rangedProtection, 0, 10, (v) => { d.rangedProtection = v; })),
      readSettings().arrivalThreat
        ? tip(field("Arrival Threat (house rule)", num(d.menacing, 0, 6, (v) => { d.menacing = v; })), { title: R.ARRIVAL_HOUSE_RULE.label, note: R.ARRIVAL_HOUSE_RULE.note })
        : null));
    const wKeys = ["name", "range", "damage", "qualities"];
    const aKeys = ["name", "roll", "text"];
    const sKeys = ["name", "text"];
    box.append(tip(field("Weapons: name | Melee or Ranged | damage | qualities",
      area(pairsToLines(d.weapons, wKeys), (v) => { d._weapons = v; }, "Scrap blade | Melee | Impaled 2 | Breaker")),
      { title: "Natural weapons", quote: R.NATURAL_WEAPON_RULE.quote, page: R.NATURAL_WEAPON_RULE.page }));
    const actionsArea = area(pairsToLines(d.actions, aKeys), (v) => { d._actions = v; }, d.kind === "major" ? "Crush | 1-4 | Moves to one enemy and makes a melee attack" : "Pounce |  | When it moves to an enemy…");
    const abilitiesArea = area(pairsToLines(d.abilities, sKeys), (v) => { d._abilities = v; }, "Armored | Protection 2 (reduced to 1 vs Breaker attacks)");
    // The book's list (pp.130-131), one pick to add its line with the printed wording.
    const libPick = (type, ta, setter, keys) => {
      const sel = h("select", { "aria-label": `Add a common ${type}`, onchange: (e) => {
        const a = R.abilityByKey(e.target.value);
        e.target.value = "";
        if (!a) return;
        const line = keys.length === 3 ? `${a.label} |  | ${a.quote}` : `${a.label} | ${a.quote}`;
        ta.value = ta.value.trim() ? `${ta.value.trim()}\n${line}` : line;
        setter(ta.value);
      } }, h("option", { value: "", text: `+ common ${type} (pp.130-131)…` }),
        R.NPC_ABILITIES.filter((a) => a.type === type).map((a) => h("option", { value: a.key, text: a.label })));
      return sel;
    };
    box.append(field(d.kind === "major" ? "Actions: name | d20 range | what it does" : "Actions: name | (no roll) | what it does", actionsArea),
      libPick("action", actionsArea, (v) => { d._actions = v; }, aKeys));
    box.append(field("Special abilities: name | what it does", abilitiesArea),
      libPick("ability", abilitiesArea, (v) => { d._abilities = v; }, sKeys));
    box.append(h("p", { class: "gm-note", text: "A line named like one of the book's abilities or actions (Armored, Swift, Hunt, Retreat…) gets its button in the fight. Any line whose text says \"spend N Threat\" gets a button for that spend." }));
    box.append(field("Notes", area(d.notes, (v) => { d.notes = v; }, "", 2)));
    box.append(h("div", { class: "gmt-row" },
      h("button", { type: "button", class: "gm-btn", text: "Save", onclick: () => {
        const draft = { ...d };
        if (d._weapons !== undefined) draft.weapons = linesToPairs(d._weapons, wKeys);
        if (d._actions !== undefined) draft.actions = linesToPairs(d._actions, aKeys);
        if (d._abilities !== undefined) draft.abilities = linesToPairs(d._abilities, sKeys);
        const npc = R.normalizeNpc({ ...draft, sample: false });
        const list = readRoster().filter((n) => n.id !== npc.id);
        list.unshift(npc);
        writeRoster(list);
        inputs.editing = null;
        inputs.viewing = npc.id;
        status(`${npc.name} saved to the roster.`);
        host.changed();
      } }),
      h("button", { type: "button", class: "ghost", text: "Cancel", onclick: () => { inputs.editing = null; render(); } })));
    return box;
  }

  function renderBestiarySection() {
    const body = h("div", {});
    body.append(inputs.editing ? renderEditor() : renderBestiary());
    return body;
  }

  // ---- the GM's own log ----
  function renderLog() {
    const room = host.room();
    const list = readGmLog(room).slice(0, 15);
    const body = h("div", {});
    if (!list.length) { body.append(h("p", { class: "gm-note", text: "Nothing yet. Every press in these tools is recorded here, with its reason." })); return body; }
    const ol = h("ol", { class: "log gmt-log" });
    for (const e of list) {
      ol.append(h("li", { class: "entry entry-action is-gm" },
        h("div", { class: "entry-head" }, h("strong", { text: e.label }),
          e.delta ? h("span", { class: "entry-sum pool-threat", text: `${e.delta > 0 ? "+" : "−"}${Math.abs(e.delta)}` }) : null),
        e.detail ? h("div", { class: "entry-test", text: e.detail }) : null));
    }
    body.append(ol, h("button", { type: "button", class: "ghost", text: "Clear my log", onclick: () => { clearGmLog(room); host.changed(); } }));
    return body;
  }

  function renderRef() {
    const body = h("div", { class: "gmt-ref" });
    for (const r of R.REFERENCE) {
      body.append(h("details", { class: "gmt-ref-item" },
        h("summary", { text: r.title }),
        h("p", { class: "gmt-ref-quote", text: `“${r.quote}”` }),
        h("p", { class: "gmt-tip-cite", text: R.cite(r.page) })));
    }
    return body;
  }

  // ---- assembly ----
  let dead = false;

  function render() {
    // A refresh can still be in flight when the panel is taken down (a GM demoted, or
    // the tools popped out); drawing then would put the panel back into a box that was
    // just emptied on purpose.
    if (dead) return;
    hideTip();
    disarm();
    root.textContent = "";
    root.append(renderHead());
    if (mode === "inline" && ui.collapsed) return;
    root.append(renderBanner());
    root.append(
      section("tickers", "Threat each round", { title: "Ticking clocks", quote: R.TICKER_RULE.quote, page: R.TICKER_RULE.page,
        note: "Each ticker adds its amount when you press Next Round, with its own line in the log. Hidden tickers show the table only \"Threat rises\"." }, renderTickers),
      section("gain", "Gain Threat", null, renderGain),
      section("spend", "Spend Threat", { title: "Spending Threat", note: "The table's log says only that Threat was spent. Your own log keeps the reason. A spend of 3 or more at once also sets off the Maverick drive and, if switched on below, Growth." }, renderSpend),
      section("hazard", "Hazard builder", { title: "Hazards", quote: R.HAZARD_BASE.quote, page: R.HAZARD_BASE.page }, renderHazard),
      section("setup", "Adventure setup", { title: "Starting Threat", quote: R.STAKES[1].quote, page: 111 }, renderSetup),
      section("fight", "In this fight", { title: "NPCs in the order", quote: R.NPC_SPEND_RULE.quote, page: R.NPC_SPEND_RULE.page,
        note: "Open a name for its tools: Injuries, Avoid the Injury, Ally or Adversary, group rules, and a button for each ability that costs or adds Threat. All of it is kept in your browser only." }, renderFight),
      section("bestiary", "Bestiary", { title: "Bestiary", note: "Your stat blocks, kept in this browser only and never in the room. Put one into the fight, on the selected token, or on the map as a new hidden token. Export it to keep a copy or move it to another computer." }, renderBestiarySection),
    );
    if (mode === "popover") root.append(section("log", "My GM log", { title: "Your private log", note: "Only in this browser. The roller's log shows these lines to you too, in place of the plain public line." }, renderLog));
    root.append(section("ref", "Cheat sheet", { title: "Chapter 4 at a glance" }, renderRef));
  }

  async function countPcs() {
    const n = (await scenePcNames(host)).length;
    if (n && n !== lastPcCount) { lastPcCount = n; return true; }
    return false;
  }

  function typing() {
    const a = document.activeElement;
    return !!(a && root.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT"));
  }

  function refresh() {
    if (dead) return;
    if (typing()) {
      dirty = true;
      const t = document.getElementById(mode + "-gmt-threat");
      if (t) t.textContent = String(Math.max(0, Number(host.state().threat) || 0));
      return;
    }
    dirty = false;
    render();
  }

  root.addEventListener("focusout", () => {
    setTimeout(() => { if (dirty && !typing()) { dirty = false; render(); } }, 0);
  });

  render();
  countPcs().then((changed) => { if (changed) refresh(); });
  return {
    refresh,
    // The scene changed: who is present may have too.
    sceneChanged() { countPcs().then((changed) => { if (changed) refresh(); }); },
    destroy() { dead = true; hideTip(); disarm(); },
  };
}
