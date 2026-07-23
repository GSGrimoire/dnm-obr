// =============================================================
// Dreams & Machines — Rolls
// -------------------------------------------------------------
// A shared 2d20 roller for Owlbear Rodeo.
//
// WHY THIS SHAPE:
// The roll log and the Momentum/Threat pools are stored in Owlbear's
// ROOM METADATA rather than being sent as broadcast messages. Broadcast
// is fire-and-forget: anyone who joins late, refreshes, or drops their
// connection misses whatever was sent while they were away. Room metadata
// is synced state, so a new joiner sees the existing log immediately and a
// refresh loses nothing. That removes the whole class of reconnect and
// ordering bugs we would otherwise have to handle ourselves.
//
// The cost is a size cap: Owlbear allows 16 kB of room metadata TOTAL,
// shared across every extension installed in the room. We therefore trim
// the log aggressively (see MAX_LOG_ENTRIES and the byte guard in save()).
//
// HIDDEN ROLLS:
// A hidden roll is never written to room metadata at all, so it cannot be
// read out of the network response or devtools by a player. It lives only
// in the GM's own browser for the current session. See HIDDEN NOTE below.
// =============================================================

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

// Namespaced so we do not collide with other extensions in the same room.
const KEY = "com.thuknights.dnm-rolls/state";

const MAX_LOG_ENTRIES = 40;
const MAX_STATE_BYTES = 11000; // stay well under the shared 16 kB room budget

const EMPTY_STATE = { v: 1, momentum: 0, threat: 0, log: [] };

let state = structuredClone(EMPTY_STATE);
let role = "PLAYER";
let playerName = "Someone";
let standalone = false;

// HIDDEN NOTE: hidden rolls are session-only and live in this array.
// They are deliberately not persisted anywhere shared. If the GM closes
// the panel they are gone, which is fine for "did the guard notice you"
// rolls. Persisting them would mean writing them somewhere a player's
// browser could reach.
let hiddenLog = [];

// -------------------------------------------------------------
// Element handles
// -------------------------------------------------------------
const el = (id) => document.getElementById(id);
const attrEl = el("attr");
const skillEl = el("skill");
const tnEl = el("tn");
const critEl = el("crit");
const compEl = el("comp");
const labelEl = el("roll-label");
const logEl = el("log");
const statusEl = el("status");
const hiddenWrap = el("hidden-wrap");
const hiddenCheck = el("hidden-roll");
const clearBtn = el("clear-log");

let diceCount = 2;
let difficulty = 1;

// -------------------------------------------------------------
// Roll engine
// -------------------------------------------------------------
// Generic 2d20: each die at or under the target number scores a success.
// A die at or under the critical threshold scores two. A die at or above
// the complication threshold generates a complication.
//
// The thresholds are exposed in the UI rather than hard-coded because the
// D&M rulebook specifics (particularly whether the critical range is driven
// by a focus value) still need confirming against the character creator's
// existing roller.
function rollDice(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 20));
  return out;
}

function resolve(dice, tn, critAt, compAt, diff) {
  let successes = 0;
  let complications = 0;
  const detail = dice.map((d) => {
    let kind = "miss";
    if (d <= critAt) {
      successes += 2;
      kind = "crit";
    } else if (d <= tn) {
      successes += 1;
      kind = "hit";
    }
    if (d >= compAt) {
      complications += 1;
      kind = kind === "miss" ? "comp" : kind + " comp";
    }
    return { d, kind };
  });
  return {
    detail,
    successes,
    complications,
    passed: successes >= diff,
    momentumGained: Math.max(0, successes - diff),
  };
}

// -------------------------------------------------------------
// Shared state
// -------------------------------------------------------------
async function load() {
  if (standalone) return;
  const meta = await OBR.room.getMetadata();
  const found = meta[KEY];
  state = found ? { ...structuredClone(EMPTY_STATE), ...found } : structuredClone(EMPTY_STATE);
}

async function save() {
  // Trim by count first, then by bytes, so we never exceed the room budget.
  state.log = state.log.slice(0, MAX_LOG_ENTRIES);
  while (state.log.length > 1 && JSON.stringify(state).length > MAX_STATE_BYTES) {
    state.log.pop();
  }

  if (standalone) {
    render();
    return;
  }

  try {
    // Partial update: this key is spread into the existing metadata, so
    // other extensions' keys are left alone.
    await OBR.room.setMetadata({ [KEY]: state });
  } catch (err) {
    setStatus("Could not save to the room. Your roll may not have reached the others.");
    console.error("[dnm-rolls] setMetadata failed", err);
  }
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

// -------------------------------------------------------------
// Actions
// -------------------------------------------------------------
async function doRoll() {
  const tn = currentTN();
  const critAt = clamp(+critEl.value, 0, 20);
  const compAt = clamp(+compEl.value, 1, 20);
  const dice = rollDice(diceCount);
  const result = resolve(dice, tn, critAt, compAt, difficulty);

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    t: Date.now(),
    who: playerName,
    label: labelEl.value.trim().slice(0, 60),
    tn,
    diff: difficulty,
    detail: result.detail,
    succ: result.successes,
    comp: result.complications,
    pass: result.passed,
    gain: result.momentumGained,
  };

  const isHidden = role === "GM" && hiddenCheck.checked;

  if (isHidden) {
    hiddenLog.unshift({ ...entry, hidden: true });
    hiddenLog = hiddenLog.slice(0, MAX_LOG_ENTRIES);
    render();
    setStatus("Hidden roll. Only you can see this one.");
    return;
  }

  // Re-read before writing so we do not clobber a roll that landed while
  // this panel was idle. Two truly simultaneous rolls can still race;
  // last write wins. Acceptable at a five-person table.
  await load();
  state.log.unshift(entry);
  await save();
  setStatus("");
}

async function stepPool(pool, delta) {
  if (pool === "threat" && role !== "GM") return;
  await load();
  state[pool] = Math.max(0, (state[pool] || 0) + delta);
  await save();
}

async function clearLog() {
  if (role !== "GM") return;
  await load();
  state.log = [];
  await save();
  hiddenLog = [];
  setStatus("Log cleared.");
}

// -------------------------------------------------------------
// Rendering
// -------------------------------------------------------------
function currentTN() {
  const tn = clamp(+attrEl.value, 0, 20) + clamp(+skillEl.value, 0, 20);
  return clamp(tn, 0, 20);
}

function clamp(n, lo, hi) {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function updateTN() {
  tnEl.textContent = String(currentTN());
}

function render() {
  el("momentum-value").textContent = state.momentum ?? 0;
  el("threat-value").textContent = state.threat ?? 0;

  document
    .querySelectorAll('[data-pool="threat"]')
    .forEach((b) => (b.disabled = role !== "GM"));

  // Hidden entries are merged in locally for the GM only, sorted by time
  // alongside the shared ones so the log reads as one sequence.
  const merged = [...state.log, ...hiddenLog].sort((a, b) => b.t - a.t);

  logEl.innerHTML = "";
  if (merged.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No rolls yet.";
    logEl.append(li);
    return;
  }

  for (const e of merged) {
    logEl.append(renderEntry(e));
  }
}

function renderEntry(e) {
  const li = document.createElement("li");
  li.className = "entry" + (e.hidden ? " is-hidden" : "");

  const head = document.createElement("div");
  head.className = "entry-head";
  const who = document.createElement("strong");
  who.textContent = e.hidden ? `${e.who} (hidden)` : e.who;
  head.append(who);
  if (e.label) {
    const lab = document.createElement("span");
    lab.className = "entry-label";
    lab.textContent = e.label;
    head.append(lab);
  }
  li.append(head);

  const dice = document.createElement("div");
  dice.className = "dice";
  for (const d of e.detail) {
    const b = document.createElement("span");
    b.className = "die " + d.kind;
    b.textContent = d.d;
    dice.append(b);
  }
  li.append(dice);

  const sum = document.createElement("div");
  sum.className = "entry-sum " + (e.pass ? "pass" : "fail");
  const parts = [
    `${e.succ} ${e.succ === 1 ? "success" : "successes"} vs difficulty ${e.diff}`,
    `TN ${e.tn}`,
  ];
  if (e.pass && e.gain > 0) parts.push(`+${e.gain} Momentum`);
  if (!e.pass) parts.push("failed");
  if (e.comp > 0) parts.push(`${e.comp} complication${e.comp === 1 ? "" : "s"}`);
  sum.textContent = parts.join(" · ");
  li.append(sum);

  return li;
}

// -------------------------------------------------------------
// Wiring
// -------------------------------------------------------------
function wireUI() {
  attrEl.addEventListener("input", updateTN);
  skillEl.addEventListener("input", updateTN);

  el("dice-seg").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-dice]");
    if (!btn) return;
    diceCount = +btn.dataset.dice;
    setSegmented("dice-seg", btn);
  });

  el("diff-seg").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-diff]");
    if (!btn) return;
    difficulty = +btn.dataset.diff;
    setSegmented("diff-seg", btn);
  });

  document.querySelectorAll(".step").forEach((b) => {
    b.addEventListener("click", () => stepPool(b.dataset.pool, +b.dataset.delta));
  });

  el("roll-btn").addEventListener("click", doRoll);
  clearBtn.addEventListener("click", clearLog);

  updateTN();
}

function setSegmented(containerId, active) {
  el(containerId)
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", b === active));
}

function applyRole() {
  const isGM = role === "GM";
  hiddenWrap.hidden = !isGM;
  clearBtn.hidden = !isGM;
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function startInOwlbear() {
  role = await OBR.player.getRole();
  playerName = (await OBR.player.getName()) || "Someone";
  applyRole();

  await load();
  render();

  OBR.player.onChange(async (player) => {
    role = player.role;
    playerName = player.name || playerName;
    applyRole();
    render();
  });

  OBR.room.onMetadataChange((meta) => {
    const found = meta[KEY];
    state = found ? { ...structuredClone(EMPTY_STATE), ...found } : structuredClone(EMPTY_STATE);
    render();
  });
}

function startStandalone() {
  // Opening index.html directly in a browser tab runs the panel with local
  // state only. Useful for checking the layout and the roll maths before
  // installing the extension into a room.
  standalone = true;
  role = "GM";
  playerName = "Local test";
  applyRole();
  render();
  setStatus("Standalone preview. Not connected to an Owlbear room.");
}

wireUI();

if (OBR.isAvailable) {
  OBR.onReady(startInOwlbear);
} else {
  startStandalone();
}
