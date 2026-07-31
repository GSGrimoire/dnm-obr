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
// WHERE THE CONTENT COMES FROM:
// Two sources, split by whether a value depends on the character.
//   · the code's SN segment — computed, per character: attributes, skills,
//     maxima, resolved talents and abilities, item facts
//   · rules.js — static, identical for everyone: tooltip tables, full item
//     descriptions, effect notes. Generated from the creator, not hand-copied.
// An out-of-date rules.js degrades to a sheet without expanded item text; it
// never produces a wrong number, because it holds no numbers.
//
// WHAT IS SAFE TO EDIT:
// Only fields whose shape was confirmed against the creator source are
// mutated: the current* resource numbers, injuries, truths, knowledge
// fragments, custom items, activeExhaustion, and the equipped, discharged and
// qty fields on items. Anything else is preserved untouched, which is what
// makes the round trip lossless.
//
// MOMENTUM:
// Momentum is a group pool in Dreams & Machines — the creator's own rules text
// says the group can save up to 6 — so this sheet reads and writes the shared
// room pool the roller already keeps, not a private per-character counter. The
// character's own currentMomentum field is mirrored from the pool so that a
// code carried back to the creator still shows a sensible number.
// =============================================================

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import {
  ID, CHAR_KEY, CHANNEL, ROOM_KEY, EMPTY_STATE, ATTRS, SKILLS,
  parseCode, rebuildCode, rollDice, resolveRoll, clamp, shutDownAttrs,
} from "./dnm.js";
import { tip, itemExtras } from "./rules.js";

const params = new URLSearchParams(location.search);
const itemId = params.get("item");

let parsed = null;      // { parts, char, snap, cpIndex }
let room = structuredClone(EMPTY_STATE);
let saveTimer = null;
let playerName = "Someone";
let pickedAttr = null;
let pickedSkill = null;
let diceCount = 2;
let difficulty = 1;

const el = (id) => document.getElementById(id);
const setStatus = (m) => { el("sheet-status").textContent = m || ""; };

// -------------------------------------------------------------
// Tiny DOM builder
// -------------------------------------------------------------
// Sections are built here rather than declared in sheet.html. v0.5 split them
// across both and the two drifted, which threw and killed every section after
// the first mismatch. One source of truth removes that failure mode.
function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === "data") for (const [d, dv] of Object.entries(v)) node.dataset[d] = dv;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const band = (title, hint, ...kids) =>
  h("section", { class: "band" },
    h("div", { class: "band-title" }, title, hint ? h("span", { class: "hint", text: hint }) : null),
    ...kids);

const prose = (title, text, cls) =>
  h("div", { class: "prose-item" + (cls ? " " + cls : "") },
    h("h3", { text: title }), h("p", { text: text || "" }));

const emptyNote = (text) => h("p", { class: "empty", text });

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

// Pool changes are announced, never written directly. The GM's background page
// is the only writer of room metadata; see applyEvent in dnm.js for why.
async function announce(ev) {
  try {
    await OBR.broadcast.sendMessage(CHANNEL, ev, { destination: "ALL" });
  } catch (err) {
    setStatus("Could not reach the room. The others may not have seen that.");
    console.error("[dnm] broadcast failed", err);
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

function showSheet() {
  el("import-view").hidden = true;
  el("sheet-view").hidden = false;
  render();
}

// -------------------------------------------------------------
// Render
// -------------------------------------------------------------
function render() {
  const { snap } = parsed;

  el("char-name").textContent = snap.name || "Unnamed";
  renderIdentityChips();

  const img = el("portrait");
  if (snap.portraitUrl) { img.src = snap.portraitUrl; img.hidden = false; }
  else img.hidden = true;

  const body = el("sheet-body");
  body.innerHTML = "";
  body.append(
    sectionIdentity(),
    sectionBondsTemperament(),
    sectionExhaustion(),
    sectionTruthsInjuries(),
    sectionAttributes(),
    sectionSkills(),
    sectionResources(),
    sectionTalentsAbilities(),
    sectionInventory(),
  );

  renderTestBar();
}

// A partial re-render for edits that only touch one band. Rebuilding the whole
// body on every keystroke would blur a focused input mid-typing.
function refresh(...builders) {
  const body = el("sheet-body");
  const order = [sectionIdentity, sectionBondsTemperament, sectionExhaustion,
    sectionTruthsInjuries, sectionAttributes, sectionSkills, sectionResources,
    sectionTalentsAbilities, sectionInventory];
  for (const builder of builders) {
    const i = order.indexOf(builder);
    if (i < 0 || !body.children[i]) continue;
    body.children[i].replaceWith(builder());
  }
  renderTestBar();
}

function renderIdentityChips() {
  const { snap } = parsed;
  const box = el("ident-chips");
  box.innerHTML = "";
  const chips = [
    { label: snap.pronouns, kind: null, desc: "" },
    { label: snap.origin, kind: "origin", desc: snap.originDesc },
    { label: snap.archetype, kind: "archetype", desc: snap.archetypeDesc },
    { label: snap.temperament, kind: "temperament", desc: snap.temperamentDesc },
  ];
  for (const { label, kind, desc } of chips) {
    if (!label) continue;
    box.append(h("span", {
      class: "chip",
      text: label,
      title: kind && desc ? desc : null,
      data: kind && desc ? { kind } : {},
    }));
  }
}

function sectionIdentity() {
  const { snap } = parsed;
  const cells = [
    ["Archetype goal", snap.archetypeGoal],
    ["Short-term ambition", snap.shortTermGoal],
    ["Long-term ambition", snap.longTermGoal],
  ].filter(([, text]) => text);

  const grid = h("div", { class: "ident-grid" },
    ...cells.map(([label, text]) =>
      h("div", { class: "ident-cell" },
        h("div", { class: "ident-label", text: label }),
        h("div", { class: "ident-text", text }))),
    snap.techLevel != null
      ? h("div", { class: "ident-cell tech-level" },
          h("div", { class: "ident-label", text: "Tech level" }),
          h("div", { class: "tech-num", text: snap.techLevel }))
      : null,
  );
  return band("Character", null, grid);
}

function sectionBondsTemperament() {
  const { snap } = parsed;

  const bonds = h("div", { class: "prose-list" });
  for (const b of snap.bonds || []) {
    bonds.append(h("div", { class: "prose-item" },
      h("h3", {}, b.name || "Unnamed bond",
        b.typeName ? h("span", { class: "bond-type", text: b.typeName }) : null),
      h("p", { text: b.desc || "" })));
  }
  if (!bonds.children.length) bonds.append(emptyNote("No bonds recorded."));

  const temp = h("div", { class: "prose-list" });
  for (const [label, text] of [
    ["Drive", snap.temperamentDrive],
    ["Exhaustion trigger", snap.temperamentExhaustion],
    ["Attitude", snap.temperamentAttitude],
  ]) if (text) temp.append(prose(label, text));
  if (!temp.children.length) temp.append(emptyNote(snap.temperamentDesc || "No temperament recorded."));

  return h("section", { class: "band" },
    h("div", { class: "split" },
      h("div", { class: "band" }, h("div", { class: "band-title", text: "Bonds" }), bonds),
      h("div", { class: "band" },
        h("div", { class: "band-title", text: `Temperament${snap.temperament ? ": " + snap.temperament : ""}` }),
        temp)));
}

function sectionExhaustion() {
  const { snap, char } = parsed;
  const types = snap.exhaustionTypes || [];
  const row = h("div", { class: "exh-row" });

  if (!types.length) {
    return band("Exhaustion states", null,
      emptyNote("Re-export from creator v1.12 or newer to enable exhaustion tracking."));
  }
  if (!Array.isArray(char.activeExhaustion)) char.activeExhaustion = [];

  for (const t of types) {
    const active = char.activeExhaustion.includes(t.key);
    row.append(h("button", {
      class: "exh-card" + (active ? " active" : ""),
      on: { click: () => {
        char.activeExhaustion = active
          ? char.activeExhaustion.filter((k) => k !== t.key)
          : [...char.activeExhaustion, t.key];
        refresh(sectionExhaustion, sectionAttributes);
        queueSave();
      } },
    },
      h("span", { class: "exh-name", text: t.name }),
      h("span", { class: "exh-attr", text: t.attrName || t.attr }),
      h("span", { class: "exh-desc", text: t.desc || "" })));
  }
  return band("Exhaustion states", "click to toggle", row);
}

function sectionTruthsInjuries() {
  const { char } = parsed;

  if (!Array.isArray(char.truths)) char.truths = ["", ""];
  const truths = h("div", { class: "line-list" });
  char.truths.forEach((t, i) => {
    const input = h("input", {
      type: "text", value: t || "", placeholder: `Truth ${i + 1}`, maxLength: 120,
      on: { input: (e) => { char.truths[i] = e.target.value; queueSave(); } },
    });
    truths.append(h("div", { class: "line-row" }, input,
      h("button", { class: "ghost mini", text: "Remove", on: { click: () => {
        char.truths.splice(i, 1);
        refresh(sectionTruthsInjuries);
        queueSave();
      } } })));
  });
  truths.append(h("button", { class: "mini", text: "Create truth", on: { click: () => {
    char.truths.push("");
    refresh(sectionTruthsInjuries);
    queueSave();
  } } }));

  if (!Array.isArray(char.injuries)) char.injuries = [];
  const list = h("ul", { class: "tag-list" });
  if (!char.injuries.length) list.append(h("li", { class: "empty", text: "None" }));
  char.injuries.forEach((text, i) => {
    list.append(h("li", { class: "tag" },
      typeof text === "string" ? text : JSON.stringify(text),
      h("button", {
        class: "tag-x", text: "\u00d7", title: "Heal",
        on: { click: () => {
          // Mirrors the creator's Heal control: healed injuries are archived
          // rather than deleted, so the history survives the round trip.
          if (!Array.isArray(char.healedInjuries)) char.healedInjuries = [];
          char.healedInjuries.push(char.injuries[i]);
          char.injuries.splice(i, 1);
          refresh(sectionTruthsInjuries);
          queueSave();
        } },
      })));
  });

  const addInput = h("input", { type: "text", placeholder: "Add injury or treated injury", maxLength: 60 });
  const addInjury = () => {
    const v = addInput.value.trim();
    if (!v) return;
    char.injuries.push(v);
    refresh(sectionTruthsInjuries);
    queueSave();
  };
  addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addInjury(); });

  const healed = (char.healedInjuries || []).length;

  return h("section", { class: "band" },
    h("div", { class: "split" },
      h("div", { class: "band" }, h("div", { class: "band-title", text: "Truths" }), truths),
      h("div", { class: "band" },
        h("div", { class: "band-title", text: "Injuries" }),
        list,
        h("div", { class: "line-row" }, addInput,
          h("button", { class: "mini", text: "Add", on: { click: addInjury } })),
        healed ? h("div", { class: "healed-note", text: `Healed injuries: ${healed}` }) : null)));
}

// Equipped items can carry a note about a specific attribute or skill. The
// creator badges those; the same badge is rebuilt here from the effect lists in
// rules.js, matched against whatever the character currently has equipped.
function statNotes(kind, key) {
  const { snap, char } = parsed;
  const field = kind === "attr" ? "attributeKeys" : "skillKeys";
  const notes = [];
  for (const it of snap.items || []) {
    // Equipped state is live and lives in the character payload. The snapshot's
    // copy is whatever was true when the code was exported, so reading it here
    // would leave the badges frozen at export time.
    const ref = (char.items || []).find((r) => r.id === it.id);
    if (!ref?.equipped) continue;
    for (const effect of itemExtras(it.id).situationalEffects || []) {
      if (Array.isArray(effect[field]) && effect[field].includes(key)) {
        notes.push(`${it.name}: ${effect.rulesText || effect.label || ""}`);
      }
    }
  }
  return notes;
}

function statCard(kind, key, label, value, isDown) {
  const notes = statNotes(kind, key);
  const picked = (kind === "attr" && pickedAttr === key) || (kind === "skill" && pickedSkill === key);
  return h("button", {
    class: "stat-row-btn" + (picked ? " picked" : "") + (isDown ? " down" : ""),
    title: isDown ? "Exhausted: tests against this attribute fail automatically" : null,
    on: { click: () => {
      if (isDown) return;
      if (kind === "attr") pickedAttr = pickedAttr === key ? null : key;
      else pickedSkill = pickedSkill === key ? null : key;
      refresh(sectionAttributes, sectionSkills);
    } },
  },
    h("span", { class: "stat-name", text: label }),
    h("span", { class: "stat-num", text: value }),
    notes.length
      ? h("span", { class: "stat-note", title: notes.join("\n\n"), text: `${notes.length} item note${notes.length === 1 ? "" : "s"}` })
      : null);
}

function sectionAttributes() {
  const { snap } = parsed;
  const down = shutDownAttrs(snap, parsed.char);
  const grid = h("div", { class: "stat-grid attrs" });
  for (const [key, label] of Object.entries(ATTRS)) {
    grid.append(statCard("attr", key, label, snap.attrs?.[key] ?? 0, down.has(key)));
  }
  return band("Attributes", null, grid);
}

function sectionSkills() {
  const { snap } = parsed;
  const grid = h("div", { class: "stat-grid skills" });
  for (const [key, label] of Object.entries(SKILLS)) {
    grid.append(statCard("skill", key, label, snap.skills?.[key] ?? 0, false));
  }
  return band("Skills", null, grid);
}

function resourceCard({ label, value, max, onStep, breakdown, shared, note }) {
  const controls = h("div", { class: "res-controls" },
    h("button", { class: "step", text: "\u2212", on: { click: () => onStep(-1) } }),
    h("span", { class: "res-val", text: value }),
    h("button", { class: "step", text: "+", on: { click: () => onStep(1) } }));
  return h("div", { class: "res-card" + (shared ? " shared" : "") },
    h("div", { class: "res-name", text: label, title: note || null }),
    controls,
    max != null ? h("div", { class: "res-max", text: `max ${max}` }) : null,
    shared ? h("div", { class: "res-shared-note", text: "group pool" }) : null,
    breakdown ? h("div", { class: "res-breakdown", text: breakdown }) : null);
}

function sectionResources() {
  const { snap, char } = parsed;
  const grid = h("div", { class: "res-grid" });

  const breakdownFor = (key) => {
    const b = snap.resourceBreakdown?.[key];
    return b ? `equipped +${b.total}: ${b.items.join(", ")}` : null;
  };

  const stepper = (field, max) => (delta) => {
    char[field] = clamp((char[field] ?? 0) + delta, 0, max == null ? 99 : max);
    refresh(sectionResources);
    queueSave();
  };

  const defs = [
    { field: "currentSpirit", label: "Spirit", max: snap.spiritMax, key: "spirit" },
    { field: "currentSupply", label: "Supply points", max: snap.supplyMax, key: "supply" },
    { field: "currentCoin", label: "Coin", max: snap.coinMax ?? char.coinMax ?? 20, key: "coin" },
    { field: "currentGrowth", label: "Growth", max: snap.growthMax ?? 10, key: "growth" },
  ];
  for (const d of defs) {
    grid.append(resourceCard({
      label: d.label,
      value: char[d.field] ?? 0,
      max: d.max,
      onStep: stepper(d.field, d.max),
      breakdown: breakdownFor(d.key),
    }));
  }

  // Momentum is the group's, not this character's. Steps are broadcast the way
  // the roller broadcasts them, so every open panel and the log agree.
  const momentumMax = snap.momentumMax ?? 6;
  grid.append(resourceCard({
    label: "Momentum",
    value: room.momentum ?? 0,
    max: momentumMax,
    shared: true,
    note: "Momentum is a shared group pool. The group can save up to 6 for later use.",
    onStep: (delta) => announce({ type: "pool", pool: "momentum", delta }),
  }));

  // Knowledge fragments are a list, not a count: a Weaver needs to know which
  // ones they hold.
  if (!Array.isArray(char.knowledgeFragments)) char.knowledgeFragments = [];
  const frags = h("div", { class: "line-list" });
  char.knowledgeFragments.forEach((f, i) => {
    frags.append(h("div", { class: "line-row" },
      h("input", {
        type: "text", value: f || "", maxLength: 120,
        on: { input: (e) => { char.knowledgeFragments[i] = e.target.value; queueSave(); } },
      }),
      h("button", { class: "ghost mini", text: "Remove", on: { click: () => {
        char.knowledgeFragments.splice(i, 1);
        refresh(sectionResources);
        queueSave();
      } } })));
  });
  if (!char.knowledgeFragments.length) frags.append(emptyNote("None recorded."));
  frags.append(h("button", { class: "mini", text: "Add fragment", on: { click: () => {
    char.knowledgeFragments.push("");
    refresh(sectionResources);
    queueSave();
  } } }));

  return band("Resources", null, grid,
    h("div", { class: "band-title", text: "Knowledge fragments" }), frags);
}

function sectionTalentsAbilities() {
  const { snap } = parsed;
  const talents = h("div", { class: "prose-list" });
  for (const t of snap.talents || []) talents.append(prose(t.name, t.desc, "boxed"));
  if (!talents.children.length) talents.append(emptyNote("None."));

  const abilities = h("div", { class: "prose-list" });
  for (const a of snap.abilities || []) abilities.append(prose(a.name, a.desc, "boxed origin"));
  if (!abilities.children.length) abilities.append(emptyNote("None."));

  return h("section", { class: "band" },
    h("div", { class: "split" },
      h("div", { class: "band" }, h("div", { class: "band-title", text: "Origin abilities" }), abilities),
      h("div", { class: "band" }, h("div", { class: "band-title", text: "Talents" }), talents)));
}

function itemCard(it) {
  const { char } = parsed;
  const ref = (char.items || []).find((r) => r.id === it.id);
  const extras = itemExtras(it.id);
  const powered = it.powered;

  const card = h("details", {
    class: "item-card"
      + (ref?.equipped ? " equipped" : "")
      + (ref?.discharged ? " discharged" : ""),
  });

  const tags = h("div", { class: "item-tags" });
  for (const t of extras.tags || []) {
    const info = t.k ? tip(t.k) : (t.name || t.desc ? { name: t.name, desc: t.desc } : null);
    tags.append(h("span", {
      class: "item-tag",
      text: t.label,
      title: info ? `${info.name}\n\n${info.desc}` : null,
    }));
  }

  const controls = h("div", { class: "item-controls" });
  if (ref) {
    if (powered?.trackDischarge) {
      controls.append(h("button", {
        class: "toggle charge" + (ref.discharged ? " discharged" : " on"),
        text: ref.discharged ? "Discharged" : "Charged",
        on: { click: (e) => {
          e.preventDefault(); e.stopPropagation();
          ref.discharged = !ref.discharged;
          refresh(sectionInventory);
          queueSave();
        } },
      }));
    }
    controls.append(h("button", {
      class: "toggle" + (ref.equipped ? " on" : ""),
      text: ref.equipped ? "Equipped" : "Equip",
      on: { click: (e) => {
        e.preventDefault(); e.stopPropagation();
        ref.equipped = !ref.equipped;
        // Equipping changes which item notes apply, so the stat bands move too.
        refresh(sectionInventory, sectionAttributes, sectionSkills);
        queueSave();
      } },
    }));
    controls.append(h("div", { class: "qty" },
      h("button", { class: "step", text: "\u2212", on: { click: (e) => {
        e.preventDefault(); e.stopPropagation();
        ref.qty = Math.max(1, (ref.qty || 1) - 1);
        refresh(sectionInventory);
        queueSave();
      } } }),
      h("span", { class: "qty-val", text: ref.qty || 1 }),
      h("button", { class: "step", text: "+", on: { click: (e) => {
        e.preventDefault(); e.stopPropagation();
        ref.qty = (ref.qty || 1) + 1;
        refresh(sectionInventory);
        queueSave();
      } } })));
  }

  card.append(h("summary", {},
    h("div", { class: "item-main" },
      h("div", { class: "item-name", text: it.name }),
      tags),
    controls));

  const body = h("div", { class: "item-body" },
    h("div", { class: "item-desc", text: extras.full || it.description || "No description available." }));

  if (ref?.discharged) {
    body.append(h("div", { class: "item-note status" },
      h("strong", { text: "Status: " }),
      powered?.recharge === "special"
        ? "Discharged. Special recharge rules apply; clear this state manually when recharged."
        : "Discharged."));
  }
  const noteRows = [
    ...(extras.equipEffects || []).map((e) => ["Equipped effect", e]),
    ...(extras.situationalEffects || []).map((e) => ["Situational", e]),
    ...(extras.itemActions || []).map((e) => ["Manual action", e]),
  ];
  for (const [label, e] of noteRows) {
    body.append(h("div", { class: "item-note" },
      h("strong", { text: label + ": " }), e.rulesText || e.label || ""));
  }
  if (extras.rulesNote) body.append(h("div", { class: "item-note" }, h("strong", { text: "Rules note: " }), extras.rulesNote));
  if (extras.availabilityNote) body.append(h("div", { class: "item-note" }, h("strong", { text: "Availability: " }), extras.availabilityNote));

  card.append(body);
  return card;
}

function sectionInventory() {
  const { snap, char } = parsed;

  const owned = h("div", { class: "item-list" });
  for (const it of snap.items || []) owned.append(itemCard(it));
  if (!owned.children.length) owned.append(emptyNote("Nothing carried."));

  if (!Array.isArray(char.customItems)) char.customItems = [];
  const custom = h("div", { class: "line-list" });
  char.customItems.forEach((ci, i) => {
    custom.append(h("div", { class: "line-row" },
      h("input", {
        type: "text", value: typeof ci === "string" ? ci : (ci?.name || ""), maxLength: 120,
        on: { input: (e) => { char.customItems[i] = e.target.value; queueSave(); } },
      }),
      h("button", { class: "ghost mini", text: "Remove", on: { click: () => {
        char.customItems.splice(i, 1);
        refresh(sectionInventory);
        queueSave();
      } } })));
  });
  if (!char.customItems.length) custom.append(emptyNote("None."));
  custom.append(h("button", { class: "mini", text: "Add custom item", on: { click: () => {
    char.customItems.push("");
    refresh(sectionInventory);
    queueSave();
  } } }));

  const parts = [];
  if (snap.startingEquipment) {
    parts.push(h("div", { class: "band-title", text: "Starting equipment" }));
    parts.push(h("div", { class: "item-desc", text: snap.startingEquipment }));
    if (snap.originSpecialNote) {
      parts.push(h("div", { class: "item-note" }, h("strong", { text: "Note: " }), snap.originSpecialNote));
    }
  }
  parts.push(h("div", { class: "band-title", text: "Owned items" }), owned);
  parts.push(h("div", { class: "band-title", text: "Custom items" }), custom);

  return band("Inventory & equipment", null, ...parts);
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
    refresh(sectionResources);
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
// Mirror the group pool into the character so a code carried back to the creator
// shows the table's real Momentum rather than a stale private count. Called both
// on pool changes and once after the code is parsed, because the room is read
// before the token is, and the first read would otherwise find no character.
function mirrorMomentum() {
  if (!parsed) return;
  if (parsed.char.currentMomentum === room.momentum) return;
  parsed.char.currentMomentum = room.momentum;
  queueSave();
}

function adoptRoom(meta) {
  const found = meta?.[ROOM_KEY];
  room = found ? { ...structuredClone(EMPTY_STATE), ...found } : structuredClone(EMPTY_STATE);
  mirrorMomentum();
  if (parsed && !el("sheet-view").hidden) refresh(sectionResources);
}

async function start() {
  playerName = (await OBR.player.getName()) || "Someone";

  try {
    adoptRoom(await OBR.room.getMetadata());
  } catch (err) {
    console.error("[dnm] could not read room state", err);
  }
  OBR.room.onMetadataChange(adoptRoom);

  if (!itemId) { showImport("No token was selected."); return; }

  const item = await readItem();
  if (!item) { showImport("That token is no longer in the scene."); return; }

  const stored = item.metadata?.[CHAR_KEY];
  if (!stored?.code) { showImport(""); return; }

  const result = parseCode(stored.code);
  if (result.error) { showImport(result.error); return; }
  parsed = result;
  mirrorMomentum();
  showSheet();
}

wire();

if (OBR.isAvailable) {
  OBR.onReady(start);
} else {
  showImport("Open this from a token's context menu inside an Owlbear room.");
}
