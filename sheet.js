// =============================================================
// Dreams & Machines — character sheet
// -------------------------------------------------------------
// Opens as a full-screen modal against one token.
//
// STORAGE MODEL:
// The token's metadata holds the character's DM1 code string and nothing
// else. Everything on screen is derived from it, and every edit rewrites it.
// Keeping one representation rather than a code plus a parallel "live state"
// object means the two can never disagree, and the code handed back to the
// creator at end of session is always current by construction.
//
// The cost is that each edit rewrites a few kB of item metadata, so writes
// are debounced. See queueSave().
//
// WHAT IS SAFE TO EDIT:
// Only fields whose shape was confirmed against the creator source are
// mutated: the current* resource numbers, injuries, truths, and the equipped
// and discharged flags on items. Anything else is preserved untouched, which
// is what makes the round trip lossless. activeExhaustion is deliberately
// left alone: it holds keys into a rules table the snapshot does not carry
// yet, so editing it here could write a value the creator cannot read back.
// =============================================================

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import {
  ID, CHAR_KEY, CHANNEL, ATTRS, SKILLS,
  parseCode, rebuildCode, rollDice, resolveRoll, clamp,
} from "./dnm.js";

const params = new URLSearchParams(location.search);
const itemId = params.get("item");

let parsed = null;      // { parts, char, snap, cpIndex }
let saveTimer = null;
let playerName = "Someone";
let pickedAttr = null;
let pickedSkill = null;
let diceCount = 2;
let difficulty = 1;

const el = (id) => document.getElementById(id);
const setStatus = (m) => { el("sheet-status").textContent = m || ""; };

// -------------------------------------------------------------
// Persistence
// -------------------------------------------------------------
async function readItem() {
  const items = await OBR.scene.items.getItems([itemId]);
  return items && items[0] ? items[0] : null;
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, 350);
}

async function commit() {
  if (!parsed) return;
  const code = rebuildCode(parsed.parts, parsed.cpIndex, parsed.char);
  try {
    await OBR.scene.items.updateItems([itemId], (items) => {
      for (const it of items) it.metadata[CHAR_KEY] = { v: 1, code };
    });
  } catch (err) {
    setStatus("Could not save to the token.");
    console.error("[dnm] save failed", err);
  }
}

// -------------------------------------------------------------
// Import
// -------------------------------------------------------------
function showImport(msg) {
  el("import-view").hidden = false;
  el("sheet-view").hidden = true;
  el("import-error").textContent = msg || "";
}

async function doImport() {
  const result = parseCode(el("code-input").value);
  if (result.error) { el("import-error").textContent = result.error; return; }
  parsed = result;
  await commit();
  showSheet();
}

// -------------------------------------------------------------
// Rendering
// -------------------------------------------------------------
function showSheet() {
  el("import-view").hidden = true;
  el("sheet-view").hidden = false;
  render();
}

function render() {
  const { snap, char } = parsed;

  el("char-name").textContent = snap.name || "Unnamed";
  const bits = [snap.pronouns, snap.origin, snap.archetype, snap.temperament].filter(Boolean);
  if (snap.techLevel != null) bits.push(`Tech Level ${snap.techLevel}`);
  el("char-sub").textContent = bits.join(" · ");

  const img = el("portrait");
  if (snap.portraitUrl) { img.src = snap.portraitUrl; img.hidden = false; }
  else img.hidden = true;

  renderStats();
  renderResources();
  renderInjuries();
  renderTruths();
  renderTalents();
  renderBonds();
  renderItems();
  renderTestBar();
}

function renderStats() {
  const { snap } = parsed;

  const attrBox = el("attrs");
  attrBox.innerHTML = "";
  for (const [key, label] of Object.entries(ATTRS)) {
    attrBox.append(statRow(key, label, snap.attrs?.[key] ?? 0, "attr"));
  }

  const skillBox = el("skills");
  skillBox.innerHTML = "";
  for (const [key, label] of Object.entries(SKILLS)) {
    skillBox.append(statRow(key, label, snap.skills?.[key] ?? 0, "skill"));
  }
}

function statRow(key, label, value, kind) {
  const row = document.createElement("button");
  row.className = "stat-row-btn";
  row.dataset.kind = kind;
  row.dataset.key = key;
  if ((kind === "attr" && pickedAttr === key) || (kind === "skill" && pickedSkill === key)) {
    row.classList.add("picked");
  }
  const n = document.createElement("span");
  n.className = "stat-name";
  n.textContent = label;
  const v = document.createElement("span");
  v.className = "stat-num";
  v.textContent = value;
  row.append(n, v);
  row.addEventListener("click", () => {
    if (kind === "attr") pickedAttr = pickedAttr === key ? null : key;
    else pickedSkill = pickedSkill === key ? null : key;
    renderStats();
    renderTestBar();
  });
  return row;
}

// Resource maxima come from the snapshot where the creator computes them, and
// from the character object for the two it tracks per character (coin and
// momentum). Momentum here is this character's personal pool as the creator
// models it, which is separate from the shared room pool in the roller.
function renderResources() {
  const { snap, char } = parsed;
  const defs = [
    { field: "currentSpirit", label: "Spirit", max: snap.spiritMax },
    { field: "currentSupply", label: "Supply", max: snap.supplyMax },
    { field: "currentCoin", label: "Coin", max: char.coinMax ?? null },
    { field: "currentMomentum", label: "Momentum", max: char.momentumMax ?? null },
  ];
  const box = el("resources");
  box.innerHTML = "";
  for (const d of defs) {
    if (d.max == null && char[d.field] == null) continue;
    box.append(resourceRow(d));
  }
}

function resourceRow({ field, label, max }) {
  const { char } = parsed;
  const wrap = document.createElement("div");
  wrap.className = "res-row";

  const name = document.createElement("span");
  name.className = "res-name";
  name.textContent = label;

  const minus = document.createElement("button");
  minus.className = "step";
  minus.textContent = "\u2212";

  const val = document.createElement("span");
  val.className = "res-val";
  const cur = char[field] ?? 0;
  val.textContent = max != null ? `${cur} / ${max}` : `${cur}`;

  const plus = document.createElement("button");
  plus.className = "step";
  plus.textContent = "+";

  const step = (delta) => {
    const hi = max != null ? max : 99;
    char[field] = clamp((char[field] ?? 0) + delta, 0, hi);
    renderResources();
    renderTestBar();
    queueSave();
  };
  minus.addEventListener("click", () => step(-1));
  plus.addEventListener("click", () => step(1));

  wrap.append(name, minus, val, plus);
  return wrap;
}

function renderInjuries() {
  const { char } = parsed;
  const list = el("injuries");
  list.innerHTML = "";
  const injuries = Array.isArray(char.injuries) ? char.injuries : [];
  if (injuries.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "None";
    list.append(li);
  }
  injuries.forEach((text, i) => {
    const li = document.createElement("li");
    li.className = "tag";
    li.textContent = typeof text === "string" ? text : JSON.stringify(text);
    const heal = document.createElement("button");
    heal.className = "tag-x";
    heal.textContent = "\u00d7";
    heal.title = "Heal";
    heal.addEventListener("click", () => {
      // Mirrors the creator's Heal control: healed injuries are archived
      // rather than deleted, so the history survives the round trip.
      if (!Array.isArray(char.healedInjuries)) char.healedInjuries = [];
      char.healedInjuries.push(injuries[i]);
      char.injuries = injuries.filter((_, j) => j !== i);
      renderInjuries();
      queueSave();
    });
    li.append(heal);
    list.append(li);
  });
}

function renderTruths() {
  const { char } = parsed;
  const box = el("truths");
  box.innerHTML = "";
  const truths = Array.isArray(char.truths) ? char.truths : ["", ""];
  truths.forEach((t, i) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = t || "";
    input.placeholder = `Truth ${i + 1}`;
    input.maxLength = 120;
    input.addEventListener("input", () => {
      char.truths[i] = input.value;
      queueSave();
    });
    box.append(input);
  });
}

function renderTalents() {
  const box = el("talents");
  box.innerHTML = "";
  const talents = parsed.snap.talents || [];
  if (!talents.length) { box.innerHTML = '<p class="empty">None</p>'; return; }
  for (const t of talents) {
    const d = document.createElement("div");
    d.className = "prose-item";
    const h = document.createElement("h3");
    h.textContent = t.name;
    const p = document.createElement("p");
    p.textContent = t.desc || "";
    d.append(h, p);
    box.append(d);
  }
}

function renderBonds() {
  const { snap } = parsed;
  const box = el("bonds");
  box.innerHTML = "";
  for (const b of snap.bonds || []) {
    const d = document.createElement("div");
    d.className = "prose-item";
    const h = document.createElement("h3");
    h.textContent = b.name;
    const p = document.createElement("p");
    p.textContent = b.type || "";
    d.append(h, p);
    box.append(d);
  }
  for (const [label, text] of [["Short-term goal", snap.shortTermGoal], ["Long-term goal", snap.longTermGoal]]) {
    if (!text) continue;
    const d = document.createElement("div");
    d.className = "prose-item";
    const h = document.createElement("h3");
    h.textContent = label;
    const p = document.createElement("p");
    p.textContent = text;
    d.append(h, p);
    box.append(d);
  }
  if (!box.children.length) box.innerHTML = '<p class="empty">None</p>';
}

function renderItems() {
  const { snap, char } = parsed;
  const box = el("items");
  box.innerHTML = "";
  const items = snap.items || [];
  if (!items.length) { box.innerHTML = '<p class="empty">Nothing carried</p>'; return; }

  for (const it of items) {
    const ref = (char.items || []).find((r) => r.id === it.id);
    const card = document.createElement("div");
    card.className = "item-card";
    if (ref?.equipped) card.classList.add("equipped");
    if (ref?.discharged) card.classList.add("discharged");

    const head = document.createElement("div");
    head.className = "item-head";
    const nm = document.createElement("strong");
    nm.textContent = it.qty > 1 ? `${it.name} \u00d7${it.qty}` : it.name;
    head.append(nm);
    card.append(head);

    // Only the numbers that get consulted mid-scene. Protection can be a
    // string such as "2 (1)" for vehicles, so it is printed rather than parsed.
    const facts = [];
    if (it.damage != null) facts.push(`Damage ${it.damage}`);
    if (it.injury) facts.push(`Injury: ${it.injury}`);
    if (it.protection != null) facts.push(`Protection ${it.protection}`);
    if (it.techLevel != null) facts.push(`TL${it.techLevel}`);
    if (facts.length) {
      const f = document.createElement("div");
      f.className = "item-facts";
      f.textContent = facts.join(" · ");
      card.append(f);
    }

    if (it.qualities?.length) {
      const q = document.createElement("div");
      q.className = "item-qualities";
      q.textContent = it.qualities.join(", ");
      card.append(q);
    }

    if (it.description) {
      const p = document.createElement("p");
      p.className = "item-desc";
      p.textContent = it.description;
      card.append(p);
    }

    if (ref) {
      const toggles = document.createElement("div");
      toggles.className = "item-toggles";
      toggles.append(
        toggle("Equipped", !!ref.equipped, (v) => { ref.equipped = v; renderItems(); queueSave(); }),
        toggle("Discharged", !!ref.discharged, (v) => { ref.discharged = v; renderItems(); queueSave(); }),
      );
      card.append(toggles);
    }

    box.append(card);
  }

  for (const ci of parsed.snap.customItems || []) {
    const card = document.createElement("div");
    card.className = "item-card custom";
    card.textContent = typeof ci === "string" ? ci : (ci.name || JSON.stringify(ci));
    box.append(card);
  }
}

function toggle(label, on, onChange) {
  const b = document.createElement("button");
  b.className = "toggle" + (on ? " on" : "");
  b.textContent = label;
  b.addEventListener("click", () => onChange(!on));
  return b;
}

// -------------------------------------------------------------
// Rolling
// -------------------------------------------------------------
// Extra d20s beyond the first two are bought with Spirit, one each, which is
// why the cost is shown next to the button and deducted on roll rather than
// left as bookkeeping for the player to remember.
function extraDiceCost() {
  return Math.max(0, diceCount - 2);
}

function renderTestBar() {
  const { snap, char } = parsed;
  const av = pickedAttr ? snap.attrs?.[pickedAttr] ?? 0 : null;
  const sv = pickedSkill ? snap.skills?.[pickedSkill] ?? 0 : null;

  el("pick-attr").textContent = pickedAttr ? `${ATTRS[pickedAttr]} ${av}` : "pick an attribute";
  el("pick-skill").textContent = pickedSkill ? `${SKILLS[pickedSkill]} ${sv}` : "pick a skill";

  const cost = extraDiceCost();
  const spirit = char.currentSpirit ?? 0;
  const costEl = el("spirit-cost");
  if (cost > 0) {
    costEl.textContent = `costs ${cost} Spirit (have ${spirit})`;
    costEl.classList.toggle("short", cost > spirit);
  } else {
    costEl.textContent = "";
    costEl.classList.remove("short");
  }

  el("sheet-roll").disabled = !pickedAttr || !pickedSkill || cost > spirit;
}

async function doRoll() {
  const { snap, char } = parsed;
  const av = snap.attrs?.[pickedAttr] ?? 0;
  const sv = snap.skills?.[pickedSkill] ?? 0;
  const cost = extraDiceCost();

  const dice = rollDice(diceCount);
  const result = resolveRoll(dice, av, sv, difficulty);

  if (cost > 0) {
    char.currentSpirit = Math.max(0, (char.currentSpirit ?? 0) - cost);
    renderResources();
    queueSave();
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    t: Date.now(),
    who: snap.name || playerName,
    label: cost > 0 ? `spent ${cost} Spirit` : "",
    an: ATTRS[pickedAttr], av,
    sn: SKILLS[pickedSkill], sv,
    diff: difficulty,
    detail: result.detail,
    succ: result.successes,
    comp: result.complications,
    pass: result.passed,
    gain: result.momentumGained,
  };

  // Announced on the same channel the roller uses, so a roll made from the
  // sheet reaches the whole table exactly like any other.
  try {
    await OBR.broadcast.sendMessage(CHANNEL, { type: "roll", entry }, { destination: "ALL" });
  } catch (err) {
    setStatus("Rolled, but the others may not have seen it.");
    console.error("[dnm] broadcast failed", err);
    return;
  }

  const summary = `${result.successes} ${result.successes === 1 ? "success" : "successes"}`
    + (result.passed ? " — passed" : " — failed")
    + (result.complications ? `, ${result.complications} complication${result.complications === 1 ? "" : "s"}` : "");
  setStatus(`${dice.join(", ")} → ${summary}`);
  renderTestBar();
}

// -------------------------------------------------------------
// Wiring
// -------------------------------------------------------------
function setSegmented(id, active) {
  el(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === active));
}

function wire() {
  el("do-import").addEventListener("click", doImport);
  el("cancel-import").addEventListener("click", () => OBR.modal.close(`${ID}/sheet-modal`));
  el("close-sheet").addEventListener("click", () => OBR.modal.close(`${ID}/sheet-modal`));

  el("copy-code").addEventListener("click", async () => {
    const code = rebuildCode(parsed.parts, parsed.cpIndex, parsed.char);
    try {
      await navigator.clipboard.writeText(code);
      setStatus("Code copied. Paste it into the character creator to carry this session's changes back.");
    } catch {
      // Clipboard access can be refused inside an iframe, so fall back to
      // putting the code on screen for a manual copy.
      el("code-input").value = code;
      showImport("Clipboard blocked. Select the text above and copy it manually.");
    }
  });

  el("detach").addEventListener("click", async () => {
    await OBR.scene.items.updateItems([itemId], (items) => {
      for (const it of items) delete it.metadata[CHAR_KEY];
    });
    OBR.modal.close(`${ID}/sheet-modal`);
  });

  el("add-injury").addEventListener("click", () => {
    const v = el("injury-input").value.trim();
    if (!v) return;
    if (!Array.isArray(parsed.char.injuries)) parsed.char.injuries = [];
    parsed.char.injuries.push(v);
    el("injury-input").value = "";
    renderInjuries();
    queueSave();
  });

  el("dice-seg").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-dice]");
    if (!b) return;
    diceCount = +b.dataset.dice;
    setSegmented("dice-seg", b);
    renderTestBar();
  });

  el("diff-seg").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-diff]");
    if (!b) return;
    difficulty = +b.dataset.diff;
    setSegmented("diff-seg", b);
  });

  el("sheet-roll").addEventListener("click", doRoll);
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function start() {
  playerName = (await OBR.player.getName()) || "Someone";

  if (!itemId) { showImport("No token was selected."); return; }

  const item = await readItem();
  if (!item) { showImport("That token is no longer in the scene."); return; }

  const stored = item.metadata?.[CHAR_KEY];
  if (!stored?.code) { showImport(""); return; }

  const result = parseCode(stored.code);
  if (result.error) { showImport(result.error); return; }
  parsed = result;
  showSheet();
}

wire();

if (OBR.isAvailable) {
  OBR.onReady(start);
} else {
  showImport("Open this from a token's context menu inside an Owlbear room.");
}
