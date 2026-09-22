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
// CONCEALED ROLLS (0.9.4):
// SECRET is absolute — never broadcast, never in room metadata, GM only.
// HIDDEN travels in full and is redacted at RENDER time, because the GM has to
// be able to read a player's hidden roll and Owlbear offers no private channel.
// It hides a result from other players' screens, not from their devtools.
// See canRevealConcealed() in dnm.js.
// =============================================================

import OBR from "./sdk.js";
import {
  ROOM_KEY as KEY, CHANNEL, CHAR_KEY, ATTRS, SKILLS, EMPTY_STATE, EPOCH_KEYS,
  EPOCH_LABELS, rollDice, resolveRoll, clamp, applyEvent, parseCode, shutDownAttrs,
  readRecovery, writeRecovery, visibleRecovery, characterTokens,
  readInitiative, initiativeAllActed, MAX_INITIATIVE_ROWS, INITIATIVE_NAME_MAX,
  HIDDEN_NAMES_PREFIX, mayMarkRow, initRowLabel, initRowIdForCharacter,
  readEpochs, epochStatus, canRevealConcealed, readCompAt, COMP_AT_MIN, COMP_AT_MAX,
  createPoolBatcher, DRIVE_THREAT_SPEND_MIN, openSheetPopover,
} from "./dnm.js";

const MAX_LOG_ENTRIES = 40;

let state = structuredClone(EMPTY_STATE);
let role = "PLAYER";
let playerName = "Someone";
let myPlayerId = null;   // whose hidden rolls this client may read in full
let standalone = false;
let hasGM = true;   // fails OPEN: a transient party read must not cry wolf
let hiddenLog = [];
let concealMode = "open";   // "open" | "hidden" | "secret"
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
const concealWrap = el("conceal-wrap");
const concealSeg = el("conceal-seg");
const concealSecretBtn = el("conceal-secret");
const concealHint = el("conceal-hint");
const clearBtn = el("clear-log");
const gmPanel = el("gm-panel");
const partyPanel = el("party-panel");
const partyListEl = el("party-list");
const recoveryEl = el("recovery");
const recoveryListEl = el("recovery-list");
const recoveryCountEl = el("recovery-count");
const backupEl = el("backup");
const backupTextEl = el("backup-text");
const backupSummaryEl = el("backup-summary");
const initRoundEl = el("init-round");
const noGmEl = el("no-gm");

// 0.9.10. Reported from play: in a room with no GM, a player presses + on Momentum,
// the sheet moves and the pool never does. That is background.js working as designed —
// only the GM's client writes room metadata, so with no GM nobody writes and every pool
// change is dropped. The single-writer rule is what stops two clients clobbering each
// other and is worth keeping; what was wrong is that it failed SILENTLY.
//
// getPlayers() lists everyone EXCEPT this client, so this client's own role has to be
// checked separately — without it a lone GM would be told there is no GM.
async function refreshHasGM() {
  if (standalone) { hasGM = true; }
  else if (role === "GM") { hasGM = true; }
  else {
    try {
      const players = await OBR.party.getPlayers();
      hasGM = players.some((p) => p.role === "GM");
    } catch (err) {
      // Failing open. A party read that races a disconnect must not put a warning on
      // every panel at the table saying the GM has vanished.
      hasGM = true;
    }
  }
  if (noGmEl) noGmEl.hidden = hasGM || standalone;
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

// Rolls and pool changes are announced rather than written. The GM's
// background page is the only writer of room metadata; see applyEvent in
// dnm.js for why.
async function announce(ev) {
  // 0.9.7. Anything else going out ends a run of pool nudges first, so a roll cannot
  // land in the log ahead of the presses that came before it. Re-entrant by design and
  // harmless: the batcher clears `pending` before it calls send, so the flush this
  // triggers from inside its own broadcast finds nothing to do.
  poolBatch.flush();
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
  const compAt = readCompAt(state);
  const result = resolveRoll(dice, attrValue, skillValue, difficulty, compAt);

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
    compAt,
    detail: result.detail,
    succ: result.successes,
    comp: result.complications,
    pass: result.passed,
    gain: result.momentumGained,
  };

  // SECRET: nothing leaves this browser, so no one can tell a roll happened. GM only
  // — the role is re-checked here and not merely in the button's visibility, because
  // a hidden attribute is not a control.
  if (concealMode === "secret" && role === "GM") {
    keepPrivately({ ...entry, conceal: "secret" });
    setStatus("Secret roll. Nothing was sent to the table.");
    return;
  }

  // HIDDEN: the whole roll is announced, tagged with who made it, and each client
  // decides what to draw — the GM and the roller see the result, everyone else sees
  // that a roll happened. It is NOT kept in the private log, because it comes back
  // through room metadata like any other roll and would otherwise appear twice.
  //
  // 0.9.3 broadcast a redacted placeholder instead. That was genuinely unreadable, and
  // it also meant the GM could not see a player's hidden roll — which is the point of
  // a GM. Owlbear has no private channel to send a result down (see
  // canRevealConcealed in dnm.js), so this hides the roll from other players' screens
  // and not from their devtools. Secret remains the mode for a result nobody else can
  // reach at all.
  if (concealMode === "hidden") {
    await announce({ type: "roll", entry: { ...entry, conceal: "hidden", by: myPlayerId } });
    setStatus("Hidden roll. The GM sees it; the rest of the table sees only that you rolled.");
    return;
  }

  await announce({ type: "roll", entry: { ...entry, by: myPlayerId } });
  setStatus("");
}

// The roller's own copy of a concealed roll. Never broadcast, never written to room
// metadata; see loadHiddenLog() for why it is in localStorage.
function keepPrivately(entry) {
  hiddenLog.unshift(entry);
  hiddenLog = hiddenLog.slice(0, MAX_LOG_ENTRIES);
  saveHiddenLog();
  render();
}

// 0.9.7. One press no longer means one broadcast. stepPool() only counts; the batcher
// decides when a run of presses has ended and hands the total here.
//
// v0.8.1: the roller's own +/- buttons were the last unlogged way to move a pool. The
// sheet has logged its pool changes since v1.17, so a number moving with no entry
// beside it meant someone had used these buttons — invisible, and exactly the
// ambiguity the log exists to remove.
//
// The roller has no idea which character an Owlbear login is playing. It knows the
// Owlbear display name and, when a token is selected, that token's character name.
// Prefer the character, fall back to the login, and say plainly that it was a manual
// adjustment so it is not mistaken for an ability. `who` is also the batcher's key, so
// two people cannot have their nudges summed into one line.
const poolBatch = createPoolBatcher(async ({ pool, delta, label }) => {
  // Pool events are deltas, so they are not applied optimistically. Applying locally
  // and then again from the GM's update would double count — which is why the display
  // reads the batcher's peek() instead.
  await announce({ type: "pool", pool, delta });
  await announce({
    type: "action",
    entry: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      t: Date.now(),
      kind: "action",
      who: label,
      label: "Manual adjustment",
      detail: `${delta > 0 ? "added" : "removed"} ${Math.abs(delta)} ${pool === "momentum" ? "Momentum" : "Threat"}`,
      pool,
      delta,
    },
  });
  announceThreatSpendDrive(pool, delta);
  render();
});

// 0.9.8. "When the GM spends 3 or more Threat at once, regain 1 Spirit" — the Maverick
// drive. Announced from wherever the spend happened, because only that client knows a
// run of presses was one decision; the room's metadata just shows a number that moved.
//
// Sent once for the whole table. Every sheet decides for itself whether it is a
// Maverick, exactly as a rivalry bond has every sheet decide whether it holds the bond.
// Role-checked here to stop an honest misclick, and GM-only in the reducer where it
// actually counts.
async function announceThreatSpendDrive(pool, delta) {
  if (pool !== "threat" || role !== "GM") return;
  if (delta > -DRIVE_THREAT_SPEND_MIN) return;
  const spent = Math.abs(delta);
  await announce({
    type: "bond",
    effect: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      t: Date.now(),
      kind: "drive",
      drive: "maverick",
      from: playerName,
      amount: spent,
    },
  });
  // The GM gets told too. A drive that fires silently on somebody else's sheet is
  // exactly the thing the log exists to prevent.
  setStatus(`Spent ${spent} Threat at once — every Maverick regains 1 Spirit.`);
}

function stepPool(pool, delta) {
  if (pool === "threat" && role !== "GM") return;
  const who = (charEl.value || "").trim().slice(0, 24) || playerName;
  poolBatch.add(pool, delta, who);
  // Redrawn now so the number answers the press. What it shows is committed plus
  // uncounted, marked as unsettled until the room confirms it.
  render();
}

// -------------------------------------------------------------
// Hidden rolls (0.9.2: persisted)
// -------------------------------------------------------------
// A hidden roll is still never broadcast and never written to room metadata — that
// is the whole property, and it is unchanged. What changed is where the GM's own
// copy lives.
//
// It used to be a plain array, so closing the popover threw the lot away. From the
// GM's seat that reads as hidden rolls behaving inconsistently: three are listed,
// the panel is closed to look at the map, and on reopening they are gone with no
// sign they ever existed.
//
// localStorage is the right home. It is this browser only, so it never reaches a
// player, and it does not consume the room's shared 16 kB. Every access is wrapped:
// private windows and blocked site data throw on the accessor itself.
const HIDDEN_KEY = "dnm-obr/hidden-log";

function loadHiddenLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    // Concealment is asserted on the way back in regardless of what was stored, so a
    // mangled record can never render as an ordinary roll the roller believes the
    // table saw. Anything written before 0.9.3 was a GM secret roll by definition,
    // because that was the only kind there was.
    return raw.slice(0, MAX_LOG_ENTRIES)
      .map((e) => ({ ...e, conceal: e.conceal || "secret" }));
  } catch {
    return [];
  }
}

function saveHiddenLog() {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenLog.slice(0, MAX_LOG_ENTRIES)));
  } catch (err) {
    // Not fatal: the roll is already in memory and on screen. It just will not
    // survive the panel closing, which is exactly the old behaviour.
    console.warn("[dnm] could not persist the hidden log", err);
  }
}

// 0.9.5. The room's Complication threshold. GM only, re-checked here rather than
// trusted from the panel being hidden.
async function pushCompAt(value) {
  if (role !== "GM") return;
  const next = Math.max(COMP_AT_MIN, Math.min(COMP_AT_MAX, Math.round(Number(value) || COMP_AT_MAX)));
  if (next === readCompAt(state)) return;
  await announce({
    type: "compAt",
    value: next,
    entry: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      t: Date.now(),
      kind: "action",
      who: "GM",
      label: "Complication range",
      detail: next >= COMP_AT_MAX ? "back to 20 only" : `now ${next} or higher`,
    },
  });
  setStatus(next >= COMP_AT_MAX ? "Complications on 20 only." : `Complications on ${next}+.`);
}

function applyCompAtButtons() {
  const seg = el("comp-at-seg");
  if (!seg) return;
  const current = readCompAt(state);
  seg.querySelectorAll("[data-comp]").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.comp) === current);
  });
}

// 0.9.5. Takes a roll's surplus successes into the group Momentum pool.
//
// Offered to the person who rolled and to the GM, and nobody else: it is their
// Momentum to claim or to spend instead, and the GM needs it for rolls made on a
// sheet whose owner has since closed it. The claim is announced separately from the
// pool change so the greying-out reaches every client even if the pool write is
// refused.
async function claimMomentum(entry) {
  if (!entry || entry.claimed || !(entry.gain > 0)) return;
  // 0.9.8B: `!entry.by` — see renderEntry. A roll nobody is recorded as having made
  // must not be a roll nobody can claim.
  if (role !== "GM" && entry.by && entry.by !== myPlayerId) return;
  await announce({ type: "claim", id: entry.id });
  await announce({ type: "pool", pool: "momentum", delta: entry.gain });
  await announce({
    type: "action",
    entry: {
      id: `${entry.id}-m`,
      t: Date.now(),
      kind: "action",
      who: entry.who,
      label: "Momentum from a roll",
      detail: `added ${entry.gain} to the group pool`,
      pool: "momentum",
      delta: entry.gain,
    },
  });
  setStatus(`Added ${entry.gain} Momentum to the group pool.`);
}

async function clearLog() {
  if (role !== "GM") return;
  await announce({ type: "clear" });
  hiddenLog = [];
  saveHiddenLog();
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
  const compAt = readCompAt(state);
  // Named explicitly rather than left at "20": once the GM lowers it, a player reading
  // the old line would be working from the wrong odds.
  // 0.9.10. Two lines, always broken in the same place. It wrapped to two lines anyway
  // at this width, so the break is put somewhere it reads rather than wherever the box
  // happened to run out — and a RAISED danger is drawn in the Threat colour, because a
  // player who does not notice the change is playing on the wrong odds.
  hintEl.textContent = "";
  const base = document.createElement("span");
  base.textContent = `Success on ${a} or under · Critical on ${s} or under`;
  hintEl.append(base);

  const comp = document.createElement("span");
  comp.className = "rule-hint-comp";
  if (compAt >= COMP_AT_MAX) {
    comp.textContent = "Complication on 20";
  } else {
    comp.classList.add("raised");
    comp.textContent = `Complication on ${compAt}+ (GM raised the danger)`;
  }
  hintEl.append(comp);
}

// A pool reads as committed + whatever the batcher is still holding, so the number
// answers a press straight away. `unsettled` is the visual admission that the room has
// not confirmed it yet — without it the display would be claiming more than it knows.
function renderPool(pool, committed) {
  const pendingDelta = poolBatch.peek(pool);
  const node = el(`${pool}-value`);
  node.textContent = Math.max(0, committed + pendingDelta);
  node.classList.toggle("unsettled", pendingDelta !== 0);
}

function render() {
  applyCompAtButtons();
  updateHint();
  renderInitiativeHeader();
  renderPool("momentum", state.momentum ?? 0);
  renderPool("threat", state.threat ?? 0);
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
  li.className = "entry" + (e.conceal || e.hidden ? " is-hidden" : "");

  // 0.9.4. A hidden roll reaches every client in full, and this is what stops it being
  // DRAWN for people who should not read it. Redacting at render rather than at send
  // is what lets the GM see a player's hidden roll at all.
  if (!canRevealConcealed(e, { role, playerId: myPlayerId })) {
    const head = document.createElement("div");
    head.className = "entry-head";
    const who = document.createElement("strong");
    who.textContent = e.who;
    head.append(who);
    const tag = document.createElement("span");
    tag.className = "entry-hidden-tag is-hidden";
    tag.textContent = "Hidden";
    tag.title = "This roll was made privately. The GM can see the result.";
    head.append(tag);
    li.append(head);
    const note = document.createElement("div");
    note.className = "entry-test";
    // The typed label survives because "Hidden roll — Spotting the ambush" is useful
    // at the table. The dice, the target and the verdict are simply not drawn.
    note.textContent = e.label ? e.label : "Result not shared.";
    li.append(note);
    return li;
  }

  const head = document.createElement("div");
  head.className = "entry-head";
  const who = document.createElement("strong");
  who.textContent = e.who;
  head.append(who);
  // 0.9.3: names WHICH kind of concealment, because they differ in what the table
  // knows. `hidden` posted a placeholder, so the others know you rolled; `secret`
  // posted nothing at all. Reading one as the other would be a real misunderstanding
  // at the table, so they never share a label.
  //
  // `e.hidden` is the pre-0.9.3 shape, still sitting in GMs' stored private logs.
  const conceal = e.conceal || (e.hidden ? "secret" : null);
  if (conceal) {
    const tag = document.createElement("span");
    tag.className = `entry-hidden-tag is-${conceal}`;
    tag.textContent = conceal === "hidden" ? "Hidden" : "Secret";
    tag.title = conceal === "hidden"
      ? "Only you can see this result. The table was told that you rolled."
      : "Only you can see this. Nothing was sent to the table at all.";
    head.append(tag);
  }
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

  // 0.9.5. The surplus is claimable from the log rather than only reported there.
  if (e.gain > 0) {
    const claim = document.createElement("button");
    claim.className = "mini claim-momentum";
    // 0.9.8B. An entry with no `by` is unattributable — every roll made from a
    // character sheet before v1.28B is one of these, and there will be some sitting in
    // live rooms for a while yet. Offering it to nobody but the GM is what the bug
    // looked like from a player's seat, so an unstamped roll is open to anyone: the
    // pool is the group's, the claim is one-way and idempotent, and refusing it helps
    // no one.
    const mine = role === "GM" || !e.by || e.by === myPlayerId;
    claim.disabled = !!e.claimed || !mine;
    claim.textContent = e.claimed ? `+${e.gain} Momentum taken` : `Add ${e.gain} Momentum`;
    claim.title = e.claimed
      ? "Already added to the group pool."
      : mine
        ? "Add this roll's surplus to the group Momentum pool."
        : "Only the person who rolled, or the GM, can add this.";
    if (!claim.disabled) claim.addEventListener("click", () => claimMomentum(e));
    li.append(claim);
  }

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
  // 1.4B. The Character box now decides which initiative row is yours, so a change
  // to it has to redraw the party list. It had no listener at all before, because
  // nothing outside the roll itself had ever read it.
  charEl.addEventListener("input", () => { refreshParty(); });

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

  concealSeg?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-conceal]");
    if (!btn || btn.hidden) return;
    // Re-checked rather than trusted from the button: Secret is the GM's.
    if (btn.dataset.conceal === "secret" && role !== "GM") return;
    setConcealMode(btn.dataset.conceal);
  });

  el("comp-at-seg")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-comp]");
    if (btn) pushCompAt(btn.dataset.comp);
  });

  el("roll-btn").addEventListener("click", doRoll);
  clearBtn.addEventListener("click", clearLog);
  updateHint();
}

function applyRole() {
  const isGM = role === "GM";
  // Hidden is available to everyone from 0.9.3, so the mode picker is always visible.
  // Only Secret is the GM's.
  if (concealSecretBtn) concealSecretBtn.hidden = !isGM;
  if (!isGM && concealMode === "secret") setConcealMode("open");
  clearBtn.hidden = !isGM;
  if (gmPanel) gmPanel.hidden = !isGM;
  updateConcealHint();
}

const CONCEAL_HINTS = {
  open: "The table sees this roll and its result.",
  // Says the GM plainly, because that is the whole difference between the two, and a
  // player choosing Hidden should not be surprised later that the GM read it.
  hidden: "The GM sees the result. The rest of the table sees only that you rolled.",
  secret: "Nothing is sent at all. No one can tell a roll happened.",
};

function updateConcealHint() {
  if (concealHint) concealHint.textContent = CONCEAL_HINTS[concealMode] || "";
}

function setConcealMode(mode) {
  concealMode = mode;
  if (concealSeg) {
    concealSeg.querySelectorAll("[data-conceal]").forEach((b) => {
      b.classList.toggle("on", b.dataset.conceal === mode);
    });
  }
  updateConcealHint();
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
  // 0.9.5. Ending a scene costs the group 1 Momentum, per the rules.
  //
  // Applied HERE, on the GM's single press, and deliberately not on the sheet's own
  // End Scene button. A sheet-side deduction would fire once per character — five
  // players ending the same scene would cost the table five Momentum. The scene ends
  // once, so the pool moves once, and the GM is the one who ends it.
  if (boundary === "scene") {
    await announce({ type: "pool", pool: "momentum", delta: -1 });
    await announce({
      type: "action",
      entry: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        t: Date.now(),
        kind: "action",
        who: "GM",
        label: "End Scene",
        detail: "the group loses 1 Momentum",
        pool: "momentum",
        delta: -1,
      },
    });
  }
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
  // 1.3. Exhaustion and injuries join Spirit on the row. Both are read the same way
  // the rest of this panel reads a character: the live values from CP, the names for
  // them from SN. Neither needs a creator change.
  //
  // A character from before exhaustionTypes rode in the snapshot has no names to look
  // up, so an unknown key falls back to its own first letter rather than being
  // dropped — a mark with a weak tooltip is still the warning the GM needs.
  const types = Array.isArray(r.snap?.exhaustionTypes) ? r.snap.exhaustionTypes : [];
  const active = Array.isArray(r.char?.activeExhaustion) ? r.char.activeExhaustion : [];
  const exhaustion = active.map((key) => {
    const found = types.find((t) => t.key === key);
    const name = (found?.name || String(key || "")).trim() || "Exhausted";
    return { initial: name.slice(0, 1).toUpperCase(), name, attrName: found?.attrName || null };
  });
  const member = {
    name: r.snap?.name || "Unnamed",
    spirit: typeof r.char?.currentSpirit === "number" ? r.char.currentSpirit : null,
    spiritMax: r.snap?.spiritMax ?? null,
    exhaustion,
    injuries: Array.isArray(r.char?.injuries) ? r.char.injuries.length : 0,
    char: r.char,
  };
  // Bounded so a long session of edits cannot grow this without limit. Every edit
  // writes a new code, so without a cap this is one entry per keystroke-save.
  if (partyCache.size > 60) partyCache.clear();
  partyCache.set(code, member);
  return member;
}

// 1.4B. ONE row renderer for everything in the list: a character, an adversary, and
// either of those with a place in the initiative order. It was two panels for one
// release and they printed the same four names side by side.
//
// `status` is null for an adversary — it has no epochs to be level with. `initRow` is
// null when no round is running, which is what hides the whole initiative half.
function partyRow(member, status, initRow, init) {
  const li = document.createElement("li");
  li.className = "party-row";
  if (initRow?.acted) li.classList.add("is-acted");

  const head = document.createElement("div");
  head.className = "party-head";

  if (initRow && role === "GM") {
    const moves = document.createElement("span");
    moves.className = "init-moves";
    const at = init.rows.indexOf(initRow);
    for (const [delta, glyph, label] of [[-1, "\u25b2", "Move up"], [1, "\u25bc", "Move down"]]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost init-move";
      btn.textContent = glyph;
      btn.title = label;
      btn.disabled = delta < 0 ? at <= 0 : at >= init.rows.length - 1;
      btn.addEventListener("click", () => sendInit("move", { id: initRow.id, delta }));
      moves.append(btn);
    }
    head.append(moves);
  }

  // 1.4B: the name IS the link to the sheet, which is what freed the room for the
  // initiative controls. A separate "Sheet" button sat on every row spending space to
  // say a second time what the name already identified.
  // 1.5: the name and the hidden tag share ONE flex slot. As siblings the tag was an
  // extra flex item, and on a narrow panel its width was enough to wrap the whole row
  // onto a second line the moment the GM pressed Hide. Inside the slot the name
  // ellipsises to make room instead, which is what it already does for a long name.
  const nameWrap = document.createElement("span");
  nameWrap.className = "party-name-wrap";

  const name = document.createElement(member.itemId ? "button" : "span");
  name.className = "party-name";
  name.textContent = member.name;
  if (member.itemId) {
    name.type = "button";
    name.classList.add("is-link");
    name.title = `Open ${member.name}'s sheet`;
    name.addEventListener("click", () => openSheetFor(member.itemId));
  }
  if (member.kind === "npc") name.classList.add("is-npc");
  nameWrap.append(name);
  head.append(nameWrap);

  if (member.kind === "npc") {
    // An adversary has no Spirit, no exhaustion and no epochs. The row is its name
    // and its place in the order, which is all it was ever asked to be.
    appendHiddenMark(head, initRow);
    appendInitControls(head, initRow, member);
    li.append(head);
    return li;
  }

  if (!partyStatsVisible()) {
    appendInitControls(head, initRow, member);
    li.append(head);
    return li;
  }

  const spirit = document.createElement("span");
  spirit.className = "party-spirit";
  spirit.textContent = member.spirit == null
    ? "Spirit ?"
    : `Spirit ${member.spirit}/${member.spiritMax ?? "?"}`;
  head.append(spirit);

  // 1.3. Exhaustion as initials, injuries as a count. Deliberately not more than
  // that: the GM asked for something scannable across six rows, and the party panel
  // is a glance, not a sheet. The initials carry the full name in a tooltip.
  //
  // The injury COUNT is shown and the injuries themselves never are. What someone is
  // carrying is theirs to tell the table; that it is four of them is what the GM has
  // to know to pitch the next scene.
  if (member.exhaustion?.length) {
    const marks = document.createElement("span");
    marks.className = "party-exhaustion";
    marks.title = member.exhaustion
      .map((e) => (e.attrName ? `${e.name} (${e.attrName})` : e.name))
      .join(", ");
    for (const e of member.exhaustion) {
      const mark = document.createElement("span");
      mark.className = "party-mark";
      mark.textContent = e.initial;
      // Per-mark too, so hovering one of four marks says which one it is.
      mark.title = e.attrName ? `${e.name} (${e.attrName})` : e.name;
      marks.append(mark);
    }
    head.append(marks);
  }

  if (member.injuries > 0) {
    const hurt = document.createElement("span");
    hurt.className = "party-injuries";
    hurt.textContent = member.injuries === 1 ? "1 Injury" : `${member.injuries} Injuries`;
    hurt.title = "Open the sheet to see what they are.";
    head.append(hurt);
  }

  // Three states, not two. "Not synced" is a character that has never met this room
  // — newly built, or attached to a token for the first time. It is not behind and
  // must not read as behind: there is nothing for it to catch up on, and the creator
  // will adopt the room's position silently the first time its sheet opens.
  //
  // 1.4B: not drawn while a round is running. It answers "did my rest reach
  // everyone", which is a between-scenes question, and it is the longest thing on the
  // row — so during a fight it is the first thing worth spending on the controls.
  if (status && !readInitiative(state)) {
    const labels = { current: "Caught up", behind: "Behind", unsynced: "Not synced" };
    const classes = { current: "is-current", behind: "is-behind", unsynced: "is-unsynced" };
    const badge = document.createElement("span");
    badge.className = `party-status ${classes[status.state]}`;
    badge.textContent = labels[status.state];
    badge.title = status.state === "unsynced"
      ? "Never synchronised to this room. Nothing to catch up on."
      : status.state === "behind"
        ? "Has not yet applied a boundary the table has passed."
        : "Level with the room.";
    head.append(badge);
  }

  appendHiddenMark(head, initRow);
  appendInitControls(head, initRow, member);
  li.append(head);

  if (status && !readInitiative(state) && status.state === "behind" && status.pending.length) {
    const detail = document.createElement("div");
    detail.className = "party-detail";
    detail.textContent = `Waiting on ${status.pending.map((k) => EPOCH_LABELS[k] || k).join(", ")}`;
    li.append(detail);
  }

  return li;
}

// The right-hand end of a row while a round is running. Split out because a character
// row and an adversary row share it exactly, and they agree on nothing else.
// Only the GM ever receives a hidden row, so this only ever draws for them — but it
// is written as a check on the row rather than on the role, because the row not being
// there is what actually keeps it from a player.
function appendHiddenMark(head, initRow) {
  if (!initRow?.hidden) return;
  const mark = document.createElement("span");
  mark.className = "init-hidden-mark";
  mark.textContent = "hidden";
  mark.title = "The table sees this row but not its name.";
  // Into the name's slot, not the head. See partyRow: as a sibling this tag was enough
  // to wrap a narrow row onto two lines. The class widens the slot's floor to cover the
  // tag, so a panel too narrow for both wraps rather than squeezing the name away.
  const wrap = head.querySelector(".party-name-wrap");
  if (wrap) wrap.classList.add("has-hidden-mark");
  (wrap || head).append(mark);
}

// Appends the controls only when there ARE any. An empty flex child still occupies a
// slot and counts as a zero-width child, which is the shape the layout suite is
// watching for — and with no round running this div would be empty on every row.
function appendInitControls(head, initRow, member) {
  const actions = initControls(initRow, member);
  if (actions.childElementCount) head.append(actions);
}

function initControls(initRow, member) {
  const actions = document.createElement("div");
  actions.className = "party-row-actions";
  const init = readInitiative(state);

  // No round running. A GM may still want a character's sheet, and that is the name.
  if (!init) return actions;

  // In the scene but not in the order — someone who arrived after the fight started.
  // The GM gets one press to put them in rather than retyping a name that is already
  // on screen; a player just sees they are not in it yet.
  if (!initRow) {
    if (role === "GM" && member.kind !== "npc" && member.itemId) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "ghost";
      add.textContent = "+ Order";
      add.title = "Put them into the initiative order";
      add.addEventListener("click", () =>
        sendInit("add", { id: initRowIdForCharacter(member.name), name: member.name, kind: "pc" }));
      actions.append(add);
    }
    return actions;
  }

  if (mayToggleRow(initRow)) {
    const act = document.createElement("button");
    act.type = "button";
    act.className = "ghost init-act";
    act.textContent = initRow.acted ? "Undo" : "Acted";
    act.addEventListener("click", () => sendInit("act", { id: initRow.id, acted: !initRow.acted }));
    actions.append(act);
  }

  if (role === "GM") {
    const hide = document.createElement("button");
    hide.type = "button";
    hide.className = "ghost";
    hide.textContent = initRow.hidden ? "Show" : "Hide";
    hide.title = initRow.hidden
      ? "Let the table see this name"
      : "Keep this name from the table";
    hide.addEventListener("click", () => toggleHidden(initRow));
    actions.append(hide);

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "ghost init-drop";
    drop.textContent = "\u00d7";
    drop.title = "Take out of the order";
    drop.addEventListener("click", () => {
      if (initRow.hidden) rememberHiddenName(initRow.id, null);
      sendInit("remove", { id: initRow.id });
    });
    actions.append(drop);
  }

  return actions;
}

// Deliberately the same route the token context menu uses in background.js, now down
// to the same function. Opening under a second id would let a token's sheet be open
// twice at once, in two panels, both saving to the same token.
async function openSheetFor(itemId) {
  try {
    await openSheetPopover(OBR, itemId, safeStorage());
  } catch (err) {
    setStatus("Could not open that sheet.");
    console.error("[dnm] sheet open failed", err);
  }
}

// localStorage throws outright in a frame whose cookies are blocked, rather than
// returning null, so every read of it goes through this.
function safeStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

// 1.4B. One list. With no round running it is the party sorted by name, as it always
// was. With a round running it is the ORDER — which means adversaries are in it, and
// characters are wherever the GM put them rather than alphabetical.
//
// A character in the scene but not in the order is appended after it: they joined
// late, or the GM took them out. They keep their stats and lose the ordering controls.
function renderParty(members) {
  partyListEl.innerHTML = "";
  const init = readInitiative(state);
  const roomEpochs = readEpochs(state);
  const byId = new Map(members.map((m) => [initRowIdForCharacter(m.name), m]));

  const rows = [];
  if (init) {
    // A hidden row reaches a player's client with no name and nothing to draw, so
    // they simply do not get one. The GM sees it, named from their own storage.
    for (const initRow of init.rows) {
      if (initRow.hidden && role !== "GM") continue;
      const member = byId.get(initRow.id);
      rows.push(member
        ? { member, status: epochStatus(member.char, roomEpochs), initRow }
        : { member: { name: initRowName(initRow), kind: "npc" }, status: null, initRow });
    }
    for (const member of members) {
      if (!init.rows.some((r) => r.id === initRowIdForCharacter(member.name))) {
        rows.push({ member, status: epochStatus(member.char, roomEpochs), initRow: null });
      }
    }
  } else {
    for (const member of members) {
      rows.push({ member, status: epochStatus(member.char, roomEpochs), initRow: null });
    }
  }

  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "party-empty";
    li.textContent = init
      ? "Nobody in the order yet."
      : "No characters attached to tokens in this scene.";
    partyListEl.append(li);
    return;
  }
  for (const { member, status, initRow } of rows) {
    partyListEl.append(partyRow(member, status, initRow, init));
  }
}

// items is optional: scene.items.onChange hands us the full list already, so passing
// it through avoids a round trip. Without it we fetch, which is the path used on
// open and whenever room metadata changes underneath us.
async function refreshParty(items) {
  // 1.4: not GM-only any more. A player builds the same list when the GM has shared
  // it, and builds nothing when they have not — so a player's client never parses
  // characters it is not meant to be showing.
  if (standalone) return;
  // 1.4B: a running round is reason enough to build the list, because the list IS
  // the order now. The row renderer leaves the stats out when they are not shared.
  if (role !== "GM" && !partyIsShared() && !readInitiative(state)) return;
  // 0.9.2: the token id travels with the code now, so a row can open that token's
  // sheet. It is also part of the signature, so dragging a NEW character into the
  // scene still redraws even if some other token carries an identical code.
  let entries = [];
  try {
    const all = items || (await OBR.scene.items.getItems());
    entries = all
      .filter((i) => typeof i.metadata?.[CHAR_KEY]?.code === "string" && i.metadata[CHAR_KEY].code)
      .map((i) => ({ id: i.id, code: i.metadata[CHAR_KEY].code }));
  } catch {
    // No scene open, or the read raced a scene change. Leave whatever is on screen
    // rather than blanking the panel on a transient failure.
    return;
  }

  // entries carries each token's whole code string, and every edit to a character
  // rewrites that code — so exhaustion and injuries moving IS a signature change
  // already. Nothing extra is needed here, and adding it would only cost a parse.
  // 1.4B: the initiative joins the signature. The list is now ORDERED by it and
  // carries its adversaries, so a move, a tick or a new row has to redraw even
  // though not one character changed.
  const roomEpochs = readEpochs(state);
  const signature = JSON.stringify([
    entries, roomEpochs, readInitiative(state), role,
    // Who this client is. It decides which row gets an Acted button, so a player
    // typing their character's name has to redraw the list — without this they get
    // no button at all until some unrelated change happens to move the signature.
    myRowIdentity(),
  ]);
  if (signature === partySignature) return;
  partySignature = signature;

  const members = entries
    .map(({ id, code }) => {
      const member = readPartyMember(code);
      // Spread rather than mutate: readPartyMember() returns the CACHED object, and
      // writing itemId onto it would pin the first token that happened to carry this
      // code — wrong the moment two tokens share one character's code.
      return member ? { ...member, itemId: id } : null;
    })
    .filter(Boolean);
  members.sort((a, b) => a.name.localeCompare(b.name));
  renderParty(members);
}

// -------------------------------------------------------------
// Initiative (1.4)
// -------------------------------------------------------------
// The table does not play in a strict order — anyone who has not gone may go — so this
// tracks WHO IS LEFT rather than whose turn it is. Greyed out means done.
//
// Everyone sees it. The GM gets the controls; a player gets the list and a button on
// their own row. Rows the GM has hidden are not in room metadata at all, so a player's
// client has nothing to draw even if it wanted to.
//
// HIDDEN NAMES LIVE IN THE GM's BROWSER, not in the room. Room metadata is readable by
// every client, so a name published there is public whatever the interface draws —
// the same reason the hidden roll log is kept in localStorage. This is the lookup that
// puts the names back for the GM alone.
function hiddenNamesKey() {
  let room = "unknown";
  try { room = OBR.room.id; } catch (err) { /* standalone */ }
  return `${HIDDEN_NAMES_PREFIX}/${room}`;
}

function readHiddenNames() {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const found = JSON.parse(storage.getItem(hiddenNamesKey()) || "{}");
    return found && typeof found === "object" && !Array.isArray(found) ? found : {};
  } catch (err) {
    return {};
  }
}

function rememberHiddenName(id, name) {
  const storage = safeStorage();
  if (!storage) return;
  const all = readHiddenNames();
  if (name) all[id] = String(name).slice(0, INITIATIVE_NAME_MAX);
  else delete all[id];
  try {
    storage.setItem(hiddenNamesKey(), JSON.stringify(all));
  } catch (err) {
    console.warn("[dnm] could not remember that name", err);
  }
}

// Both rules live in dnm.js, where party.test.mjs can reach them. This file only
// supplies the two things it alone knows: which seat this client is in, and what is
// in its own storage.
function initRowName(row) {
  return initRowLabel(row, { role, hiddenNames: readHiddenNames() });
}

// The character this client is speaking as: the selected token's if there is one,
// otherwise whatever is typed in the Character box.
function myRowIdentity() {
  return activeChar?.snap?.name || charEl.value || "";
}

function mayToggleRow(row) {
  return mayMarkRow(row, { role, myNameKey: myRowIdentity() });
}

function sendInit(action, extra = {}) {
  return announce({ type: "init", action, ...extra });
}

// Starting seeds the tracker from the characters already on tokens, because that is
// the party and typing them in would be the first thing anyone complained about.
async function startInitiative() {
  if (role !== "GM") return;
  await sendInit("start");
  try {
    const items = await OBR.scene.items.getItems();
    for (const { code } of characterTokens(items)) {
      const name = nameForCode(code);
      if (!name) continue;
      // Keyed on the name, the same identity the roll merge and the recovery list
      // use, so one character on two tokens is still one row in the order.
      await sendInit("add", { id: initRowIdForCharacter(name), name, kind: "pc" });
    }
  } catch (err) {
    console.error("[dnm] could not read the scene to seed initiative", err);
  }
  setStatus("Initiative started.");
}

function addAdversary(name) {
  const clean = String(name || "").trim().slice(0, INITIATIVE_NAME_MAX);
  if (!clean) return;
  const init = readInitiative(state);
  if (init && init.rows.length >= MAX_INITIATIVE_ROWS) {
    setStatus("That is as many rows as the tracker holds.");
    return;
  }
  // 1.5: an adversary joins hidden, so the GM keeps the name the same way toggleHidden
  // does — locally, and BEFORE the event goes out, because the reducer is what erases it
  // from the room. Sending the name at all would publish it: the reducer drops it, but
  // the broadcast itself is readable by every client in the room.
  const id = "npc:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  rememberHiddenName(id, clean);
  sendInit("add", { id, name: "", kind: "npc" });
}

function toggleHidden(row) {
  if (role !== "GM") return;
  const next = !row.hidden;
  const name = initRowName(row);
  // Remembered BEFORE the event goes out, because the event is what erases the name
  // from the room — after it, there is nothing left to remember.
  if (next) rememberHiddenName(row.id, name);
  else rememberHiddenName(row.id, null);
  sendInit("hide", { id: row.id, hidden: next, name: next ? "" : name });
}

// 1.4B. Only the header now — round number, Next Round, End. The rows themselves are
// the party list, which is the whole point of the merge.
function renderInitiativeHeader() {
  const init = readInitiative(state);
  const gm = role === "GM";
  const running = !!init && !standalone;

  if (initRoundEl) {
    initRoundEl.hidden = !running;
    initRoundEl.textContent = running ? `Round ${init.round}` : "";
  }
  const next = el("init-next");
  if (next) {
    next.hidden = !running || !gm;
    if (running) {
      const allActed = initiativeAllActed(init);
      // Lit, never automatic. The GM decides when a round is over; one that ended
      // itself while somebody was still deciding would be worse than no tracker.
      next.classList.toggle("ready", allActed);
      next.title = allActed ? "Everyone has acted" : "Some are still to act — you can still advance";
    }
  }
  const end = el("init-end");
  if (end) end.hidden = !running || !gm;
  const addRow = el("init-add-row");
  if (addRow) addRow.hidden = !running || !gm;

  const note = el("party-note");
  if (note) {
    if (!running) {
      note.textContent = "A character catches up when its sheet is next opened. "
        + "Not synced means the character has never met this room and has nothing to catch up on.";
      return;
    }
    const counted = gm ? init.rows : init.rows.filter((row) => !row.hidden);
    const left = counted.filter((row) => !row.acted).length;
    note.textContent = left === 0
      ? "Everyone has acted."
      : left === 1 ? "1 still to act." : `${left} still to act.`;
  }
}

function wirePartyShare() {
  const share = el("party-share");
  if (!share) return;
  share.addEventListener("click", () => {
    if (role !== "GM") return;
    announce({ type: "partyShared", value: !partyIsShared() });
  });
}

function wireInitiative() {
  const start = el("init-start");
  if (start) start.addEventListener("click", startInitiative);
  const next = el("init-next");
  if (next) next.addEventListener("click", () => sendInit("next"));
  const end = el("init-end");
  if (end) {
    end.addEventListener("click", () => {
      // Every hidden name in this room goes with it. They name adversaries in a fight
      // that is now over, and leaving them behind would have the next fight's row 3
      // inherit the last one's name.
      const storage = safeStorage();
      if (storage) { try { storage.removeItem(hiddenNamesKey()); } catch (err) { /* blocked */ } }
      sendInit("end");
    });
  }
  const add = el("init-add");
  if (add) {
    add.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      addAdversary(add.value);
      // Cleared rather than a fresh element: the input IS the always-present blank
      // row, so emptying it is what makes the next one appear.
      add.value = "";
    });
  }
}

// -------------------------------------------------------------
// Lost characters, and backups (1.3)
// -------------------------------------------------------------
// The buffer itself is filled by background.js, which runs for the whole room
// session — a token is usually deleted with this drawer shut. This half only
// reads it, filters it against what is live, and offers two ways back.
//
// The filter is the important part and it runs HERE rather than when the buffer
// is written: an entry is shown only while no token in the scene holds that
// character. Restore one and it leaves the list on the next scene change, so the
// GM is never looking at a stale copy of a character that is already in play, and
// there is no button anywhere that can put an old version over a current one.
let lastRecoveryItems = [];

function recoveryRoomId() {
  try { return OBR.room.id; } catch (err) { return "unknown"; }
}

// readPartyMember() is the party panel's cache, so a character already on screen
// costs nothing here. A recovered one is parsed once and cached with the rest.
function nameForCode(code) {
  const member = readPartyMember(code);
  return member ? member.name : "";
}

function renderRecovery(items) {
  if (!recoveryEl) return;
  // GM only even when the panel around it is shared: restoring a character is not a
  // thing a player should be able to do to somebody else's.
  if (role !== "GM" || standalone) { recoveryEl.hidden = true; return; }
  if (items) lastRecoveryItems = items;

  const stored = readRecovery(safeStorage(), recoveryRoomId());
  const shown = visibleRecovery(stored, lastRecoveryItems, nameForCode);

  recoveryEl.hidden = shown.length === 0;
  recoveryCountEl.textContent = shown.length ? String(shown.length) : "";
  recoveryListEl.innerHTML = "";

  for (const entry of shown) {
    const li = document.createElement("li");
    li.className = "recovery-row";

    const head = document.createElement("div");
    head.className = "recovery-head-row";

    const name = document.createElement("span");
    name.className = "recovery-name";
    // A code that will not parse still gets a row. It is still a character someone
    // lost, and "Copy code" works on it whether or not this build can read it —
    // which matters most for a code from a NEWER creator than this extension.
    name.textContent = nameForCode(entry.code) || "Unreadable character";
    head.append(name);

    const when = document.createElement("span");
    when.className = "recovery-when";
    when.textContent = describeAge(Date.now() - entry.at);
    when.title = new Date(entry.at).toLocaleString();
    head.append(when);

    li.append(head);

    const actions = document.createElement("div");
    actions.className = "recovery-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost";
    copy.textContent = "Copy code";
    copy.addEventListener("click", () => copyText(entry.code, "Character code copied."));
    actions.append(copy);

    const attach = document.createElement("button");
    attach.type = "button";
    attach.className = "ghost";
    attach.textContent = "Attach to selected";
    attach.title = "Select one token with no character on it first";
    attach.addEventListener("click", () => attachToSelected(entry.code));
    actions.append(attach);

    const forget = document.createElement("button");
    forget.type = "button";
    forget.className = "ghost recovery-forget";
    forget.textContent = "Dismiss";
    forget.addEventListener("click", () => forgetRecovery(entry.code));
    actions.append(forget);

    li.append(actions);
    recoveryListEl.append(li);
  }
}

function describeAge(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

function forgetRecovery(code) {
  const storage = safeStorage();
  const next = readRecovery(storage, recoveryRoomId()).filter((e) => e.code !== code);
  writeRecovery(storage, recoveryRoomId(), next);
  renderRecovery();
}

// Writes the character onto a token the GM has selected. Guarded twice, because
// this is the only place in the extension that can put a character onto a token
// and the thing it must never do is land on one that already has a character.
//
// The second guard is not redundant with the first: getSelection() returns ids,
// and the item behind an id can have gained a character between the read and the
// write. The check therefore happens INSIDE the mutator, where it sees the item
// Owlbear is about to hand back.
async function attachToSelected(code) {
  try {
    const selection = (await OBR.player.getSelection()) || [];
    if (selection.length !== 1) {
      setStatus("Select exactly one token first.");
      return;
    }
    const [item] = await OBR.scene.items.getItems(selection);
    if (!item) { setStatus("That token is no longer in the scene."); return; }
    if (item.metadata?.[CHAR_KEY]?.code) {
      setStatus("That token already has a character. Pick an empty one.");
      return;
    }
    let refused = false;
    await OBR.scene.items.updateItems(selection, (items) => {
      for (const target of items) {
        if (target.metadata?.[CHAR_KEY]?.code) { refused = true; continue; }
        target.metadata[CHAR_KEY] = { v: 1, code };
      }
    });
    if (refused) { setStatus("That token already has a character. Pick an empty one."); return; }
    setStatus("Character attached. Open its sheet to check it over.");
    // The entry disappears on its own once the scene change comes back through
    // visibleRecovery(), so nothing is deleted here.
  } catch (err) {
    console.error("[dnm] attach failed", err);
    setStatus("Could not attach that character.");
  }
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(done);
  } catch (err) {
    // Clipboard permission is not guaranteed inside someone else's iframe, so
    // there is always a selectable fallback rather than a dead button.
    showBackup(text, "Copy failed — select the text and copy it by hand.");
  }
}

// -------------------------------------------------------------
// Backups
// -------------------------------------------------------------
// Everything in the scene, as codes, in a format that is still readable if both
// halves of this toolchain disappear: the codes are plain text on their own lines
// under a header, and each one pastes back through Attach D&M character.
//
// It deliberately does NOT offer a one-click restore of the whole file. Reading a
// backup back in would mean deciding which token each character belongs on, and
// the only safe answer to that is the GM deciding one at a time.
function buildBackup(items) {
  const rows = characterTokens(items).map(({ code }) => ({ name: nameForCode(code) || "Unnamed", code }));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const stamp = new Date().toISOString();
  const lines = [
    "Dreams & Machines — character backup",
    stamp,
    rows.length === 1 ? "1 character" : rows.length + " characters",
    "",
    "Paste any one of these into a token with Attach D&M character.",
    "",
  ];
  for (const row of rows) lines.push(row.name, row.code, "");
  return { text: lines.join("\n"), count: rows.length, stamp };
}

function showBackup(text, summary) {
  if (!backupEl) return;
  backupEl.hidden = false;
  backupTextEl.value = text;
  backupSummaryEl.textContent = summary;
  backupTextEl.focus();
  backupTextEl.select();
}

async function openBackup() {
  try {
    const items = await OBR.scene.items.getItems();
    const backup = buildBackup(items);
    if (!backup.count) { setStatus("No characters in this scene to back up."); return; }
    showBackup(backup.text, backup.count === 1 ? "1 character" : backup.count + " characters");
  } catch (err) {
    console.error("[dnm] backup failed", err);
    setStatus("Could not read the scene.");
  }
}

function downloadBackup() {
  const text = backupTextEl.value;
  if (!text) return;
  try {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dnm-characters-" + new Date().toISOString().slice(0, 10) + ".txt";
    document.body.append(link);
    link.click();
    link.remove();
    // Revoked on a timer rather than immediately: revoking in the same tick can
    // cancel the download in some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus("Saved. If nothing downloaded, copy the text instead.");
  } catch (err) {
    setStatus("Download blocked here — copy the text instead.");
  }
}

function wireBackup() {
  const open = el("party-backup");
  if (open) open.addEventListener("click", openBackup);
  const copy = el("backup-copy");
  if (copy) copy.addEventListener("click", () => copyText(backupTextEl.value, "Backup copied."));
  const download = el("backup-download");
  if (download) download.addEventListener("click", downloadBackup);
  const close = el("backup-close");
  if (close) close.addEventListener("click", () => { backupEl.hidden = true; });
}

// 1.4. The panel is no longer the GM's alone. It shows Spirit, exhaustion and injury
// counts for the whole party, and the table asked to see it — knowing where everyone
// stands is what makes a player lean in rather than wait to be told.
//
// It is a switch rather than simply public, because that is the GM's call to make per
// room, and the state lives in room metadata so every client agrees about it.
//
// The GM-only PARTS stay GM-only whatever the switch says: Back up reads every
// character in the scene, and Lost characters could hand someone a copy of a character
// that is not theirs.
function partyIsShared() {
  return state.partyShared !== false;
}

// Spirit, exhaustion, injuries and the epoch badge. A player sees them only when the
// GM has shared them — a running round opens the panel so they can see the ORDER, and
// must not smuggle the party's condition in with it.
function partyStatsVisible() {
  return role === "GM" || partyIsShared();
}

function applyPartyVisibility() {
  if (!partyPanel) return;
  const gm = role === "GM";
  // 1.4B. Two separate questions, and folding the tracker into this panel made it
  // easy to answer them as one by accident. Whether players see the party's Spirit
  // and injuries is the GM's switch; whether they can see whose turn it is is not.
  // A running round therefore opens the panel regardless, and the stat columns stay
  // behind the switch — see partyStatsVisible().
  const running = !!readInitiative(state);
  partyPanel.hidden = standalone || (!gm && !partyIsShared() && !running);
  if (partyPanel.hidden && backupEl) backupEl.hidden = true;

  const backup = el("party-backup");
  if (backup) backup.hidden = !gm;
  const share = el("party-share");
  if (share) {
    share.hidden = !gm;
    share.textContent = partyIsShared() ? "Shared" : "GM only";
    share.classList.toggle("is-on", partyIsShared());
    share.title = partyIsShared()
      ? "The players can see this panel. Press to keep it to yourself."
      : "Only you can see this panel. Press to share it with the table.";
  }
  const badge = partyPanel.querySelector(".gm-badge");
  if (badge) badge.hidden = partyIsShared();

  renderRecovery();
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function startInOwlbear() {
  role = await OBR.player.getRole();
  try { myPlayerId = await OBR.player.getId(); } catch { myPlayerId = null; }
  // Restored before the first render so concealed rolls are on screen immediately
  // rather than appearing after some later redraw. Everyone has one from 0.9.3:
  // Hidden is no longer the GM's alone.
  hiddenLog = loadHiddenLog();
  playerName = (await OBR.player.getName()) || "Someone";
  if (!charEl.value) charEl.value = playerName;
  applyRole();
  wireGmPanel();
  wireBackup();
  wireInitiative();
  wirePartyShare();
  await refreshHasGM();

  await load();
  render();

  // v0.9.0 fix: the selection was only ever read inside player.onChange, so opening
  // the popover with a token already selected showed no character until you clicked
  // something else. Reading once at startup is the whole fix.
  await refreshSelection();

  applyPartyVisibility();
  refreshParty();
  // Seeded from a real read rather than waiting for a change: the drawer is
  // usually opened BECAUSE a token has just gone, and the change that lost it
  // happened while this page was not running.
  OBR.scene.items.getItems().then((items) => renderRecovery(items)).catch(() => renderRecovery([]));

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
    refreshHasGM();
    render();
  });

  // 0.9.10. Someone else being promoted or leaving changes whether the room has a GM,
  // and player.onChange only reports THIS client.
  OBR.party.onChange(() => { refreshHasGM(); });

  // Fires on every item change including drags. refreshParty() is signature-guarded
  // precisely because of this: a move changes no code and no epoch, so it costs a
  // string comparison and returns.
  OBR.scene.items.onChange((items) => {
    refreshParty(items);
    // Not signature-guarded the way refreshParty() is: the recovery list changes
    // when a token appears as well as when one goes, and an appearing token is
    // exactly the case that must remove a row.
    renderRecovery(items);
  });

  // A scene change swaps the whole item set out. The cache is keyed on code strings
  // rather than scene, so it stays valid, but the signature must not survive.
  OBR.scene.onReadyChange((sceneReady) => {
    partySignature = null;
    if (sceneReady) {
      refreshParty();
      OBR.scene.items.getItems().then((items) => renderRecovery(items)).catch(() => {});
    }
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
    const wasShared = partyIsShared();
    const wasRunning = !!readInitiative(state);
    state = found ? { ...structuredClone(EMPTY_STATE), ...found } : structuredClone(EMPTY_STATE);
    // The GM flipping the switch reaches everyone else as a metadata change and
    // nothing else, so the visibility has to be re-applied here or a player would
    // keep whatever they had until something unrelated redrew.
    if (partyIsShared() !== wasShared || !!readInitiative(state) !== wasRunning) {
      applyPartyVisibility();
      // The signature guard would otherwise suppress the first draw for a client
      // that has never built the list.
      partySignature = null;
    }
    // The room's own number has arrived, so what the batcher was promising is now
    // real. Settled before the render, or the display would add it on twice.
    poolBatch.settle();
    render();
    // The room's epochs are half of every party row's verdict, so a boundary press
    // moves every character from caught up to behind at once.
    refreshParty();
  });
}

// -------------------------------------------------------------
// Panel height (0.9.2)
// -------------------------------------------------------------
// Owlbear sizes the popover from the manifest and offers the viewer no drag handle,
// so with the log, the roller, the party panel and the table controls stacked in one
// column the default was a long scroll. OBR.action.setHeight() is the only lever.
//
// Stored in localStorage rather than room metadata on purpose: this is one person's
// window on their own screen, not shared table state, and room metadata is a scarce
// 16 kB shared with every other extension.
const HEIGHT_KEY = "dnm-obr/panel-height";
const HEIGHT_MIN = 480;
const HEIGHT_MAX = 1600;
const HEIGHT_STEP = 120;
const HEIGHT_DEFAULT = 900;

function readStoredHeight() {
  try {
    const raw = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(raw) && raw >= HEIGHT_MIN && raw <= HEIGHT_MAX) return raw;
  } catch {
    // Private windows and blocked site data both throw. The default is fine.
  }
  return HEIGHT_DEFAULT;
}

let panelHeight = HEIGHT_DEFAULT;

async function applyHeight(next, { persist = true } = {}) {
  panelHeight = clamp(Math.round(next), HEIGHT_MIN, HEIGHT_MAX);
  const label = el("height-value");
  if (label) label.textContent = panelHeight;
  const shorter = el("shorter");
  const taller = el("taller");
  if (shorter) shorter.disabled = panelHeight <= HEIGHT_MIN;
  if (taller) taller.disabled = panelHeight >= HEIGHT_MAX;
  if (persist) {
    try { localStorage.setItem(HEIGHT_KEY, String(panelHeight)); } catch { /* see above */ }
  }
  if (standalone) return;
  try {
    await OBR.action.setHeight(panelHeight);
  } catch (err) {
    console.warn("[dnm] could not resize the panel", err);
  }
}

function wireHeightControls() {
  el("shorter")?.addEventListener("click", () => applyHeight(panelHeight - HEIGHT_STEP));
  el("taller")?.addEventListener("click", () => applyHeight(panelHeight + HEIGHT_STEP));

  // 0.9.3: a real drag. The popover has no resizable edge of its own, so the strip at
  // the foot of the page stands in for one — grab it and the panel follows the
  // pointer. Pointer events rather than mouse events so a trackpad or a touch screen
  // behaves the same, and setPointerCapture so the drag survives the pointer leaving
  // the strip, which it does immediately since the strip is only a few pixels tall.
  const grip = el("resizer");
  if (!grip) return;

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  grip.addEventListener("pointerdown", (e) => {
    // Ignore the +/- buttons living in the same strip.
    if (e.target.closest("button")) return;
    dragging = true;
    startY = e.clientY;
    startHeight = panelHeight;
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("is-dragging");
    e.preventDefault();
  });

  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // Dragging DOWN grows the panel: the strip is its bottom edge, so the pointer and
    // the edge move together. Not persisted per frame — a drag would otherwise write
    // to localStorage a hundred times on the way down.
    applyHeight(startHeight + (e.clientY - startY), { persist: false });
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove("is-dragging");
    try { grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // Written once, at the end, with whatever the drag settled on.
    applyHeight(panelHeight);
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
}

function startStandalone() {
  // Opening index.html directly in a tab runs with local state only, so the
  // layout and the roll maths can be checked before installing anything.
  standalone = true;
  role = "GM";
  playerName = "Local test";
  charEl.value = playerName;
  applyRole();
  setConcealMode("open");
  render();
  setStatus("Standalone preview. Not connected to an Owlbear room.");
}

wireUI();
wireHeightControls();
// Applied without persisting: this is restoring what was already stored, and in
// standalone it only updates the label.
applyHeight(readStoredHeight(), { persist: false });

if (OBR.isAvailable) {
  OBR.onReady(startInOwlbear);
} else {
  startStandalone();
}
