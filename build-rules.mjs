// Regenerates dnm-obr/rules.js from the character creator.
//   node build-rules.mjs <path-to-dnm-character-creator.html> <output-path>
// Run this whenever the creator's item catalogue or rules text changes.
import { JSDOM } from "jsdom";
import fs from "fs";

const [src, out] = process.argv.slice(2);
const dom = new JSDOM(fs.readFileSync(src, "utf8"), { runScripts: "dangerously", url: "https://x/" });
await new Promise((r) => setTimeout(r, 400));
const ev = (code) => dom.window.eval(code);

const D = ev("DM_DATA");
const version = ev("APP_VERSION");

// --- tooltip tables, flattened into the key space the snapshot emits ----------
const tips = {};
const add = (k, info) => { if (info && (info.name || info.desc)) tips[k] = { name: info.name || "", desc: info.desc || "" }; };
for (const [k, v] of Object.entries(D.itemCategoryInfo || {})) add("cat:" + k, v);
for (const [k, v] of Object.entries(D.equipmentPropertyInfo || {})) add("prop:" + k, v);
for (const [k, v] of Object.entries(D.manufacturingCategoryInfo || {})) add("mfg:" + k, v);
for (const [k, v] of Object.entries(D.coverInfo || {})) add("cover:" + k, v);
for (const [k, v] of Object.entries(D.equipmentTraitInfo || {})) add("trait:" + k, v);
for (const [k, v] of Object.entries(ev("TECH_LEVEL_INFO") || {})) add("tl:" + k, { name: `Tech Level ${k}`, desc: v });
for (const [k, v] of Object.entries(ev("RARITY_INFO") || {})) add("rarity:" + k, { name: `Rarity ${k}`, desc: v });

// --- per-item static extras, keyed by catalogue id ---------------------------
const items = {};
for (const it of D.items || []) {
  const entry = {};
  const tags = ev(`snapshotItemTags(getItemById(${JSON.stringify(it.id)}))`);
  if (tags && tags.length) entry.tags = tags;
  const full = it.fullDescription || "";
  if (full && full !== it.description) entry.full = full;
  if (it.rulesNote) entry.rulesNote = it.rulesNote;
  if (it.availabilityNote) entry.availabilityNote = it.availabilityNote;
  // attributeKeys / skillKeys are kept so the sheet can mark which attributes and
  // skills an equipped item has a note about, the way the creator does.
  const eff = (list) => (list || []).map((e) => {
    const o = { label: e.label || "", rulesText: e.rulesText || "" };
    if (e.appliesWhen) o.appliesWhen = e.appliesWhen;
    if (Array.isArray(e.attributeKeys) && e.attributeKeys.length) o.attributeKeys = e.attributeKeys;
    if (Array.isArray(e.skillKeys) && e.skillKeys.length) o.skillKeys = e.skillKeys;
    return o;
  }).filter((e) => e.label || e.rulesText);
  const equip = eff(it.equipEffects), sit = eff(it.situationalEffects), acts = eff(it.itemActions);
  if (equip.length) entry.equipEffects = equip;
  if (sit.length) entry.situationalEffects = sit;
  if (acts.length) entry.itemActions = acts;
  if (Object.keys(entry).length) items[it.id] = entry;
}

// --- action, limited-use and rest tables (used from the Actions phase onward) --
const actions = ev("ACTION_DEFINITIONS");
const limitedUse = ev("LIMITED_USE_FEATURES");
const restTypes = ev("REST_TYPES");
const resetText = Object.fromEntries(Object.keys(restTypes).concat(["scene", "session", "adventure"])
  .map((k) => [k, ev(`limitedUseResetText(${JSON.stringify(k)})`)]));

const body = `// =============================================================
// Static Dreams & Machines rules text.
// -------------------------------------------------------------
// GENERATED FILE — do not edit by hand.
// Source: dnm-character-creator.html v${version}
// Regenerate with build-rules.mjs after any change to the creator's item
// catalogue or rules text.
//
// WHY THIS EXISTS:
// Everything here is identical for every character, so carrying it inside each
// character code cost about 3.3 kB per owned item to repeat the same words.
// It is display text with no computation attached, which is what makes it safe
// to publish here; the numbers that depend on a character are still computed by
// the creator and travel in the code's SN segment.
// =============================================================

export const RULES_FROM = ${JSON.stringify(version)};
export const TOOLTIPS = ${JSON.stringify(tips, null, 0)};
export const ITEM_EXTRAS = ${JSON.stringify(items, null, 0)};
export const ACTION_DEFINITIONS = ${JSON.stringify(actions, null, 0)};
export const LIMITED_USE_FEATURES = ${JSON.stringify(limitedUse, null, 0)};
export const REST_TYPES = ${JSON.stringify(restTypes, null, 0)};
export const RESET_TEXT = ${JSON.stringify(resetText, null, 0)};

export const tip = (key) => (key && TOOLTIPS[key]) || null;
export const itemExtras = (id) => ITEM_EXTRAS[id] || {};
`;

fs.writeFileSync(out, body);
console.log(`wrote ${out}`);
console.log(`  from creator v${version}`);
console.log(`  tooltips: ${Object.keys(tips).length}`);
console.log(`  items with extras: ${Object.keys(items).length} of ${(D.items || []).length}`);
console.log(`  actions: ${actions.length}, limited-use: ${Object.keys(limitedUse).length}, rest: ${Object.keys(restTypes).length}`);
console.log(`  size: ${(body.length / 1024).toFixed(1)} kB`);
