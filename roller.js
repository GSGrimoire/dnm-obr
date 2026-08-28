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
  ID, ROOM_KEY as KEY, CHANNEL, CHAR_KEY, ATTRS, SKILLS, EMPTY_STATE, EPOCH_KEYS,
  EPOCH_LABELS, rollDice, resolveRoll, clamp, applyEvent, parseCode, shutDownAttrs,
  readEpochs, epochStatus, canRevealConcealed, readCompAt, COMP_AT_MIN, COMP_AT_MAX,
  createPoolBatcher, DRIVE_THREAT_SPEND_MIN,
} from "./dnm.js";

const MAX_LOG_ENTRIES = 40;

let state = structuredClone(EMPTY_STATE);
let role = "PLAYER";
let playerName = "Someone";
let myPlayerId = null;   // whose hidden rolls this client may read in full
let standalone = false;
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
  if (role !== "GM" && entry.by !== myPlayerId) return;
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
  const compText = compAt >= COMP_AT_MAX
    ? "Complication on 20"
    : `Complication on ${compAt}+ (GM raised the danger)`;
  hintEl.textContent = `Success on ${a} or under · Critical on ${s} or under · ${compText}`;
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
    const mine = role === "GM" || e.by === myPlayerId;
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

  // 0.9.2. Opens this character's sheet from the row. The GM otherwise has to find
  // the token on the map, right-click it and pick the menu item — and the party panel
  // is exactly where you are standing when you decide you need to look at someone.
  if (member.itemId) {
    const open = document.createElement("button");
    open.className = "ghost party-open";
    open.type = "button";
    open.textContent = "Sheet";
    open.title = `Open ${member.name}'s sheet`;
    open.addEventListener("click", () => openSheetFor(member.itemId));
    head.append(open);
  }

  li.append(head);

  if (status.state === "behind" && status.pending.length) {
    const detail = document.createElement("div");
    detail.className = "party-detail";
    detail.textContent = `Waiting on ${status.pending.map((k) => EPOCH_LABELS[k] || k).join(", ")}`;
    li.append(detail);
  }

  return li;
}

// Deliberately the same modal id and URL shape the context menu uses in
// background.js. Opening under a second id would let a token's sheet be open twice
// at once, in two windows, both saving to the same token.
const SHEET_URL = "https://gsgrimoire.github.io/dnm-cc/";

async function openSheetFor(itemId) {
  try {
    await OBR.modal.open({
      id: `${ID}/sheet-modal`,
      url: `${SHEET_URL}?item=${encodeURIComponent(itemId)}`,
      width: 1280,
      height: 940,
    });
  } catch (err) {
    setStatus("Could not open that sheet.");
    console.error("[dnm] modal open failed", err);
  }
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

  const roomEpochs = readEpochs(state);
  const signature = JSON.stringify([entries, roomEpochs]);
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

function applyPartyVisibility() {
  if (!partyPanel) return;
  partyPanel.hidden = role !== "GM" || standalone;
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
