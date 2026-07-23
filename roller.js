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
import {
  ROOM_KEY as KEY, CHANNEL, ATTRS, SKILLS, EMPTY_STATE,
  rollDice, resolveRoll, clamp, applyEvent,
} from "./dnm.js";

const MAX_LOG_ENTRIES = 40;

let state = structuredClone(EMPTY_STATE);
let role = "PLAYER";
let playerName = "Someone";
let standalone = false;
let hiddenLog = [];
let diceCount = 2;
let difficulty = 1;

// The roll engine, the attribute and skill names, and the room metadata key
// all live in dnm.js so the sheet and the roller can never disagree about what
// a Skill Test means.

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

// Rolls and pool changes are announced rather than written. The GM's
// background page is the only writer of room metadata; see applyEvent in
// dnm.js for why.
async function announce(ev) {
  try {
    await OBR.broadcast.sendMessage(CHANNEL, ev, { destination: "ALL" });
  } catch (err) {
    setStatus("Could not reach the room. The others may not have seen that.");
    console.error("[dnm] broadcast failed", err);
  }
}

const setStatus = (msg) => { statusEl.textContent = msg || ""; };

// -------------------------------------------------------------
// Actions
// -------------------------------------------------------------
async function doRoll() {
  const attrValue = clamp(+attrValEl.value, 0, 20);
  const skillValue = clamp(+skillValEl.value, 0, 20);
  const dice = rollDice(diceCount);
  const result = resolveRoll(dice, attrValue, skillValue, difficulty);

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
    // Never announced, so it cannot be read from the network by a player.
    hiddenLog.unshift({ ...entry, hidden: true });
    hiddenLog = hiddenLog.slice(0, MAX_LOG_ENTRIES);
    render();
    setStatus("Hidden roll. Only you can see this one.");
    return;
  }

  await announce({ type: "roll", entry });
  setStatus("");
}

async function stepPool(pool, delta) {
  if (pool === "threat" && role !== "GM") return;
  // Pool events are deltas, so they are not applied optimistically. Applying
  // locally and then again from the GM's update would double count.
  await announce({ type: "pool", pool, delta });
}

async function clearLog() {
  if (role !== "GM") return;
  await announce({ type: "clear" });
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

  // Optimistic local view. Roll entries carry an id and applyEvent
  // deduplicates, so this can safely be applied again from the GM's update.
  OBR.broadcast.onMessage(CHANNEL, (event) => {
    const ev = event.data;
    if (ev?.type !== "roll") return;
    state = applyEvent(state, ev);
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
