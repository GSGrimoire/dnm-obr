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
  ROOM_KEY as KEY, CHANNEL, CHAR_KEY, ATTRS, SKILLS, EMPTY_STATE, EPOCH_KEYS,
  EPOCH_LABELS, rollDice, resolveRoll, clamp, applyEvent, parseCode, shutDownAttrs,
  readEpochs, epochStatus,
} from "./dnm.js";

const MAX_LOG_ENTRIES = 40;

let state = structuredClone(EMPTY_STATE);
let role = "PLAYER";
let playerName = "Someone";
let standalone = false;
let hiddenLog = [];
let diceCount = 2;
let difficulty = 1;

// The character on the currently selected token, if it has one. The popover
// has no idea who you are on its own, so selection is what tells it. Read
// only here: the sheet owns edits to the character.
let activeChar = null;

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
const gmPanel = el("gm-panel");
const partyPanel = el("party-panel");
const partyListEl = el("party-list");

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

  // v0.8.1: the roller's own +/- buttons were the last unlogged way to move a pool.
  // The sheet has logged its pool changes since v1.17, so a number moving with no
  // entry beside it meant someone had used these buttons — invisible, and exactly the
  // ambiguity the log exists to remove.
  //
  // The roller has no idea which character an Owlbear login is playing. It knows the
  // Owlbear display name and, when a token is selected, that token's character name.
  // Prefer the character, fall back to the login, and say plainly that it was a manual
  // adjustment so it is not mistaken for an ability.
  const who = (charEl.value || "").trim().slice(0, 24) || playerName;
  await announce({
    type: "action",
    entry: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      t: Date.now(),
      kind: "action",
      who,
      label: "Manual adjustment",
      detail: `${delta > 0 ? "added" : "removed"} ${Math.abs(delta)} ${pool === "momentum" ? "Momentum" : "Threat"}`,
      pool,
      delta,
    },
  });
}

async function clearLog() {
  if (role !== "GM") return;
  await announce({ type: "clear" });
  hiddenLog = [];
  setStatus("Log cleared.");
}

// -------------------------------------------------------------
// Selected character
// -------------------------------------------------------------
async function refreshSelection() {
  let next = null;
  try {
    const sel = await OBR.player.getSelection();
    if (sel && sel.length) {
      const items = await OBR.scene.items.getItems(sel);
      const withChar = items.find((i) => i.metadata?.[CHAR_KEY]?.code);
      if (withChar) {
        const r = parseCode(withChar.metadata[CHAR_KEY].code);
        if (!r.error) next = { itemId: withChar.id, snap: r.snap, char: r.char };
      }
    }
  } catch {
    // No scene open, or the selection went away mid-read. Fall back to manual.
    next = null;
  }
  activeChar = next;
  applyChar();
}

function applyChar() {
  const banner = el("char-banner");
  const manual = [attrValEl, skillValEl];

  if (!activeChar) {
    banner.hidden = true;
    manual.forEach((i) => i.removeAttribute("readonly"));
    updateHint();
    return;
  }

  const { snap, char } = activeChar;
  charEl.value = snap.name || charEl.value;
  manual.forEach((i) => i.setAttribute("readonly", "readonly"));
  syncValuesFromChar();

  const down = shutDownAttrs(snap, char);
  const spirit = char.currentSpirit;
  const bits = [`Rolling as ${snap.name || "character"}`];
  if (spirit != null) bits.push(`Spirit ${spirit}/${snap.spiritMax ?? "?"}`);
  banner.innerHTML = "";
  const left = document.createElement("span");
  left.textContent = bits.join("  \u00b7  ");
  banner.append(left);
  if (down.size) {
    const w = document.createElement("span");
    w.className = "warn";
    w.textContent = `Exhausted: ${[...down].map((k) => ATTRS[k]).join(", ")}`;
    banner.append(w);
  }
  banner.hidden = false;
  updateHint();
}

function syncValuesFromChar() {
  if (!activeChar) return;
  attrValEl.value = activeChar.snap.attrs?.[attrKeyEl.value] ?? 0;
  skillValEl.value = activeChar.snap.skills?.[skillKeyEl.value] ?? 0;
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
  // v1.17: the log carries two shapes now. A roll entry has dice; an action entry has
  // none, and reading e.detail.length on one would throw and take the whole feed down
  // with it. Entries written before v1.17 have no kind field at all, so absent means
  // roll — the entries already in a live room's metadata have to keep rendering.
  if (e.kind === "action") return renderActionEntry(e);
  return renderRollEntry(e);
}

function renderActionEntry(e) {
  const li = document.createElement("li");
  li.className = "entry entry-action";

  const head = document.createElement("div");
  head.className = "entry-head";
  const who = document.createElement("strong");
  who.textContent = e.who;
  head.append(who);
  const lab = document.createElement("span");
  lab.className = "entry-label";
  lab.textContent = e.label;
  head.append(lab);
  li.append(head);

  if (e.detail) {
    const detail = document.createElement("div");
    detail.className = "entry-test";
    detail.textContent = e.detail;
    li.append(detail);
  }

  // The pool movement is the part a GM scans for, so it gets its own line and its own
  // colour rather than being folded into the detail text.
  if (e.pool && e.delta) {
    const sum = document.createElement("div");
    sum.className = "entry-sum pool-" + e.pool;
    const sign = e.delta > 0 ? "+" : "\u2212";
    const name = e.pool === "momentum" ? "Momentum" : "Threat";
    sum.textContent = `${sign}${Math.abs(e.delta)} ${name}`;
    li.append(sum);
  }

  return li;
}

function renderRollEntry(e) {
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
  attrKeyEl.addEventListener("change", () => { syncValuesFromChar(); updateHint(); });
  skillKeyEl.addEventListener("change", () => { syncValuesFromChar(); updateHint(); });

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
  if (gmPanel) gmPanel.hidden = !isGM;
}

// -------------------------------------------------------------
// Table controls (0.8.0)
// -------------------------------------------------------------
// A rest or a scene boundary is per-character state living inside each token's DM1
// code. The extension does not read that code and should not start now, so the GM
// does not reach into characters here — it increments a counter and each sheet
// reconciles itself against it when it opens.
//
// v0.9.0: EPOCH_LABELS moved to dnm.js. The party panel names the same boundaries
// when it reports what a character is waiting on, and two copies would drift.

async function pushEpoch(boundary) {
  if (role !== "GM" || !EPOCH_KEYS.includes(boundary)) return;
  const label = EPOCH_LABELS[boundary] || boundary;
  await announce({
    type: "epoch",
    boundary,
    entry: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      t: Date.now(),
      kind: "action",
      who: "GM",
      label,
      detail: "called for the whole table",
    },
  });
  setStatus(`${label} sent to the table.`);
}

// Two-step confirm. A disable-after-click guard stops a double press but does nothing
// about the first one being a misclick, and these are expensive to get wrong: every
// attached character acts on it, and there is no undo. First click arms and relabels,
// second click sends. Arming clears after 4 seconds, and arming one button disarms any
// other, so a stray click elsewhere in the panel cannot fire something armed earlier.
let armedEpochBtn = null;
let armTimer = null;

function disarmEpochButtons() {
  if (armedEpochBtn) {
    armedEpochBtn.textContent = armedEpochBtn.dataset.label;
    armedEpochBtn.classList.remove("armed");
    armedEpochBtn = null;
  }
  if (armTimer) { clearTimeout(armTimer); armTimer = null; }
}

function wireGmPanel() {
  if (!gmPanel) return;
  gmPanel.querySelectorAll("[data-epoch]").forEach((btn) => {
    btn.dataset.label = btn.textContent;
    btn.addEventListener("click", () => {
      if (armedEpochBtn === btn) {
        const boundary = btn.dataset.epoch;
        disarmEpochButtons();
        btn.disabled = true;
        pushEpoch(boundary).finally(() => {
          setTimeout(() => { btn.disabled = false; }, 800);
        });
        return;
      }
      disarmEpochButtons();
      armedEpochBtn = btn;
      btn.textContent = "Confirm?";
      btn.classList.add("armed");
      setStatus(`${btn.dataset.label} — press again to send to the table.`);
      armTimer = setTimeout(() => { disarmEpochButtons(); setStatus(""); }, 4000);
    });
  });
}

// -------------------------------------------------------------
// Party panel (0.9.0)
// -------------------------------------------------------------
// The table controls above push a boundary and say nothing about who received it.
// The GM presses Bed and then has no way to tell, short of reading the log, whether
// a given player's sheet has caught up. Worse is the player's side of it: someone
// who cannot tell "already applied" from "hasn't reached me" rests again.
//
// This reads every token in the scene carrying a character and reports three things
// per character: name, Spirit, and where they stand against the room's epochs.
//
// WHY THIS IS ALLOWED TO READ CHARACTERS:
// The rule that matters is narrower than "the extension never interprets character
// data". The background page never does — it relays events and writes metadata, and
// stays ignorant of the DM1 format. The sheet is the only thing that WRITES a
// character. The roller may READ one, and has since v1.12: refreshSelection() below
// already parses the selected token this way. This is the same read, widened from
// one token to all of them.
//
// Everything needed is already on the wire. Name and Spirit maximum come from the
// SN snapshot; current Spirit and appliedEpochs come from the CP payload, which is
// where the creator deliberately keeps live session values so an Owlbear round trip
// stays lossless. No creator change, no snapshot change, no share-code risk.

// Parsing is the expensive part — base64 decode plus two JSON.parse per token — and
// scene.items.onChange fires on every drag frame. So the panel keeps two guards:
//
//   1. A parse cache keyed on the code string. A token that moved but did not have
//      its character edited is a cache hit.
//   2. A render signature. If no code and no epoch changed, the DOM is left alone.
//      Dragging a token across the map changes neither, so it costs one string
//      comparison and stops.
const partyCache = new Map(); // code string -> { name, spirit, spiritMax }
let partySignature = null;

function readPartyMember(code) {
  const hit = partyCache.get(code);
  if (hit) return hit;
  const r = parseCode(code);
  if (r.error) return null;
  const member = {
    name: r.snap?.name || "Unnamed",
    spirit: typeof r.char?.currentSpirit === "number" ? r.char.currentSpirit : null,
    spiritMax: r.snap?.spiritMax ?? null,
    char: r.char,
  };
  // Bounded so a long session of edits cannot grow this without limit. Every edit
  // writes a new code, so without a cap this is one entry per keystroke-save.
  if (partyCache.size > 60) partyCache.clear();
  partyCache.set(code, member);
  return member;
}

function partyRow(member, status) {
  const li = document.createElement("li");
  li.className = "party-row";

  const head = document.createElement("div");
  head.className = "party-head";

  const name = document.createElement("span");
  name.className = "party-name";
  name.textContent = member.name;
  head.append(name);

  const spirit = document.createElement("span");
  spirit.className = "party-spirit";
  spirit.textContent = member.spirit == null
    ? "Spirit ?"
    : `Spirit ${member.spirit}/${member.spiritMax ?? "?"}`;
  head.append(spirit);

  // Three states, not two. "Not synced" is a character that has never met this room
  // — newly built, or attached to a token for the first time. It is not behind and
  // must not read as behind: there is nothing for it to catch up on, and the creator
  // will adopt the room's position silently the first time its sheet opens.
  const badge = document.createElement("span");
  const labels = { current: "Caught up", behind: "Behind", unsynced: "Not synced" };
  const classes = { current: "is-current", behind: "is-behind", unsynced: "is-unsynced" };
  badge.className = `party-status ${classes[status.state]}`;
  badge.textContent = labels[status.state];
  badge.title = status.state === "unsynced"
    ? "Never synchronised to this room. Nothing to catch up on."
    : status.state === "behind"
      ? "Has not yet applied a boundary the table has passed."
      : "Level with the room.";
  head.append(badge);

  li.append(head);

  if (status.state === "behind" && status.pending.length) {
    const detail = document.createElement("div");
    detail.className = "party-detail";
    detail.textContent = `Waiting on ${status.pending.map((k) => EPOCH_LABELS[k] || k).join(", ")}`;
    li.append(detail);
  }

  return li;
}

function renderParty(members) {
  partyListEl.innerHTML = "";
  if (!members.length) {
    const li = document.createElement("li");
    li.className = "party-empty";
    li.textContent = "No characters attached to tokens in this scene.";
    partyListEl.append(li);
    return;
  }
  const roomEpochs = readEpochs(state);
  for (const member of members) {
    partyListEl.append(partyRow(member, epochStatus(member.char, roomEpochs)));
  }
}

// items is optional: scene.items.onChange hands us the full list already, so passing
// it through avoids a round trip. Without it we fetch, which is the path used on
// open and whenever room metadata changes underneath us.
async function refreshParty(items) {
  if (role !== "GM" || standalone) return;
  let codes = [];
  try {
    const all = items || (await OBR.scene.items.getItems());
    codes = all
      .map((i) => i.metadata?.[CHAR_KEY]?.code)
      .filter((c) => typeof c === "string" && c);
  } catch {
    // No scene open, or the read raced a scene change. Leave whatever is on screen
    // rather than blanking the panel on a transient failure.
    return;
  }

  const roomEpochs = readEpochs(state);
  const signature = JSON.stringify([codes, roomEpochs]);
  if (signature === partySignature) return;
  partySignature = signature;

  const members = codes.map(readPartyMember).filter(Boolean);
  members.sort((a, b) => a.name.localeCompare(b.name));
  renderParty(members);
}

function applyPartyVisibility() {
  if (!partyPanel) return;
  partyPanel.hidden = role !== "GM" || standalone;
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function startInOwlbear() {
  role = await OBR.player.getRole();
  playerName = (await OBR.player.getName()) || "Someone";
  if (!charEl.value) charEl.value = playerName;
  applyRole();
  wireGmPanel();

  await load();
  render();

  // v0.9.0 fix: the selection was only ever read inside player.onChange, so opening
  // the popover with a token already selected showed no character until you clicked
  // something else. Reading once at startup is the whole fix.
  await refreshSelection();

  applyPartyVisibility();
  refreshParty();

  // onChange fires when the selection changes, which is how the popover
  // learns which character you are pointing at.
  OBR.player.onChange((player) => {
    role = player.role;
    playerName = player.name || playerName;
    applyRole();
    applyPartyVisibility();
    refreshSelection();
    // A promotion to GM is the moment the panel first has anything to show, and the
    // signature guard would otherwise suppress the first render for a role that has
    // just changed. Clearing it forces one pass.
    partySignature = null;
    refreshParty();
    render();
  });

  // Fires on every item change including drags. refreshParty() is signature-guarded
  // precisely because of this: a move changes no code and no epoch, so it costs a
  // string comparison and returns.
  OBR.scene.items.onChange((items) => refreshParty(items));

  // A scene change swaps the whole item set out. The cache is keyed on code strings
  // rather than scene, so it stays valid, but the signature must not survive.
  OBR.scene.onReadyChange((sceneReady) => {
    partySignature = null;
    if (sceneReady) refreshParty();
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
    // The room's epochs are half of every party row's verdict, so a boundary press
    // moves every character from caught up to behind at once.
    refreshParty();
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
