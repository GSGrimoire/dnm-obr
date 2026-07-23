// =============================================================
// Dreams & Machines — Rolls
// -------------------------------------------------------------
// A shared Skill Test roller for Owlbear Rodeo.
//
// STORAGE:
// The roll log and the Momentum/Threat pools live in Owlbear's ROOM
// METADATA rather than being sent as broadcast messages. Broadcast is
// fire-and-forget: anyone who joins late, refreshes, or drops connection
// misses whatever was sent while they were away. Room metadata is synced
// state, so a late joiner sees the existing log and a refresh loses
// nothing. That removes the whole class of reconnect and ordering bugs.
//
// The cost is a size cap: Owlbear allows 16 kB of room metadata TOTAL
// across every extension in the room, so the log trims itself.
//
// HIDDEN ROLLS:
// A hidden roll is never written to room metadata, so a player cannot read
// it out of devtools. It lives only in the GM's open panel for the session.
// =============================================================

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

const KEY = "com.thuknights.dnm-rolls/state";
const MAX_LOG_ENTRIES = 40;
const MAX_STATE_BYTES = 11000; // headroom inside the shared 16 kB room budget

const ATTRS = { might: "Might", quickness: "Quickness", insight: "Insight", resolve: "Resolve" };
const SKILLS = {
  fight: "Fight", move: "Move", operate: "Operate", sneak: "Sneak",
  study: "Study", survive: "Survive", talk: "Talk",
};

const EMPTY_STATE = { v: 1, momentum: 0, threat: 0, log: [] };

let state = structuredClone(EMPTY_STATE);
let role = "PLAYER";
let playerName = "Someone";
let standalone = false;
let hiddenLog = [];
let diceCount = 2;
let difficulty = 1;

// -------------------------------------------------------------
// Roll engine
// -------------------------------------------------------------
// These rules are lifted directly from classifyDie() in
// dnm-character-creator.html v1.10 so that the extension and the character
// creator can never disagree about what a roll means:
//
//   - a natural 20 is a Complication and nothing else
//   - a die at or under the SKILL value is a Critical, worth 2 successes
//   - a die at or under the ATTRIBUTE value is 1 success
//   - anything else fails
//
// Note the target number is the Attribute on its own. The Skill is the
// critical range, not an addition to the target. The order of the checks
// matters: 20 is tested first, so a 20 can never also count as a success.
function classifyDie(value, attrValue, skillValue) {
  if (value === 20) return "complication";
  if (value <= skillValue) return "crit";
  if (value <= attrValue) return "success";
  return "fail";
}

function rollDice(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 20));
  return out;
}

function resolve(dice, attrValue, skillValue, diff) {
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
    detail,
    successes,
    complications,
    passed: successes >= diff,
    momentumGained: Math.max(0, successes - diff),
  };
}

// -------------------------------------------------------------
// Elements
// -------------------------------------------------------------
const el = (id) => document.getElementById(id);
const attrKeyEl = el("attr-key");
const attrValEl = el("attr-val");
const skillKeyEl = el("skill-key");
const skillValEl = el("skill-val");
const charEl = el("char-name");
const labelEl = el("roll-label");
const hintEl = el("rule-hint");
const logEl = el("log");
const statusEl = el("status");
const hiddenWrap = el("hidden-wrap");
const hiddenCheck = el("hidden-roll");
const clearBtn = el("clear-log");

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
  state.log = state.log.slice(0, MAX_LOG_ENTRIES);
  while (state.log.length > 1 && JSON.stringify(state).length > MAX_STATE_BYTES) {
    state.log.pop();
  }
  if (standalone) { render(); return; }
  try {
    // Partial update: other extensions' metadata keys are left untouched.
    await OBR.room.setMetadata({ [KEY]: state });
  } catch (err) {
    setStatus("Could not reach the room. That roll may not have been shared.");
    console.error("[dnm-rolls] setMetadata failed", err);
  }
}

const setStatus = (msg) => { statusEl.textContent = msg || ""; };

const clamp = (n, lo, hi) => (Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)));

// -------------------------------------------------------------
// Actions
// -------------------------------------------------------------
async function doRoll() {
  const attrValue = clamp(+attrValEl.value, 0, 20);
  const skillValue = clamp(+skillValEl.value, 0, 20);
  const dice = rollDice(diceCount);
  const result = resolve(dice, attrValue, skillValue, difficulty);

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    t: Date.now(),
    who: charEl.value.trim().slice(0, 24) || playerName,
    label: labelEl.value.trim().slice(0, 40),
    an: ATTRS[attrKeyEl.value],
    av: attrValue,
    sn: SKILLS[skillKeyEl.value],
    sv: skillValue,
    diff: difficulty,
    detail: result.detail,
    succ: result.successes,
    comp: result.complications,
    pass: result.passed,
    gain: result.momentumGained,
  };

  if (role === "GM" && hiddenCheck.checked) {
    hiddenLog.unshift({ ...entry, hidden: true });
    hiddenLog = hiddenLog.slice(0, MAX_LOG_ENTRIES);
    render();
    setStatus("Hidden roll. Only you can see this one.");
    return;
  }

  // Re-read before writing so a roll that landed while this panel sat idle
  // is not clobbered. Two simultaneous rolls can still race; last write
  // wins, which is acceptable at a five-person table.
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
function updateHint() {
  const a = clamp(+attrValEl.value, 0, 20);
  const s = clamp(+skillValEl.value, 0, 20);
  hintEl.textContent = `Success on ${a} or under · Critical on ${s} or under · Complication on 20`;
}

function render() {
  el("momentum-value").textContent = state.momentum ?? 0;
  el("threat-value").textContent = state.threat ?? 0;
  document.querySelectorAll('[data-pool="threat"]').forEach((b) => { b.disabled = role !== "GM"; });

  const merged = [...state.log, ...hiddenLog].sort((a, b) => b.t - a.t);

  logEl.innerHTML = "";
  if (merged.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No rolls yet.";
    logEl.append(li);
    return;
  }
  for (const e of merged) logEl.append(renderEntry(e));
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

  const test = document.createElement("div");
  test.className = "entry-test";
  test.textContent = `${e.an} ${e.av} (${e.sn} ${e.sv}) · ${e.detail.length}d20`;
  li.append(test);

  const dice = document.createElement("div");
  dice.className = "dice";
  for (const d of e.detail) {
    const b = document.createElement("span");
    b.className = "die " + d.kind;
    b.textContent = d.d;
    b.title = { crit: "Critical (2 successes)", success: "Success", complication: "Complication", fail: "No effect" }[d.kind];
    dice.append(b);
  }
  li.append(dice);

  const sum = document.createElement("div");
  sum.className = "entry-sum " + (e.pass ? "pass" : "fail");
  const parts = [`${e.succ} ${e.succ === 1 ? "success" : "successes"} vs D${e.diff}`];
  parts.push(e.pass ? "passed" : "failed");
  if (e.pass && e.gain > 0) parts.push(`+${e.gain} Momentum`);
  if (e.comp > 0) parts.push(`${e.comp} complication${e.comp === 1 ? "" : "s"}`);
  sum.textContent = parts.join(" · ");
  li.append(sum);

  return li;
}

// -------------------------------------------------------------
// Wiring
// -------------------------------------------------------------
function setSegmented(containerId, active) {
  el(containerId).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === active));
}

function wireUI() {
  attrValEl.addEventListener("input", updateHint);
  skillValEl.addEventListener("input", updateHint);

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
  updateHint();
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
  if (!charEl.value) charEl.value = playerName;
  applyRole();

  await load();
  render();

  OBR.player.onChange((player) => {
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
  // Opening index.html directly in a tab runs with local state only, so the
  // layout and the roll maths can be checked before installing anything.
  standalone = true;
  role = "GM";
  playerName = "Local test";
  charEl.value = playerName;
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
