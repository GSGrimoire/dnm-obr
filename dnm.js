// =============================================================
// Shared Dreams & Machines helpers
// Used by both the roller popover and the character sheet modal.
// =============================================================

export const ID = "com.thuknights.dnm-obr";
export const CHAR_KEY = `${ID}/char`;
// Kept at the original key so existing rooms do not lose their roll log.
export const ROOM_KEY = "com.thuknights.dnm-rolls/state";

export const ATTRS = { might: "Might", quickness: "Quickness", insight: "Insight", resolve: "Resolve" };
export const SKILLS = {
  fight: "Fight", move: "Move", operate: "Operate", sneak: "Sneak",
  study: "Study", survive: "Survive", talk: "Talk",
};

// -------------------------------------------------------------
// Base64 helpers
// -------------------------------------------------------------
// The creator strips '=' padding when building a code, so we re-pad before
// decoding. It also URI-encodes before base64 so non-ASCII names survive.
export function b64decode(v) {
  let x = v.replace(/-/g, "+").replace(/_/g, "/");
  const pad = x.length % 4;
  if (pad === 2) x += "==";
  else if (pad === 3) x += "=";
  return decodeURIComponent(atob(x));
}

export function b64encode(str) {
  return btoa(encodeURIComponent(str)).replace(/=/g, "");
}

// -------------------------------------------------------------
// Character codes
// -------------------------------------------------------------
// A DM1 code is a '-' joined list of segments. We only care about two:
//
//   CP  the full character object, which holds everything mutable
//   SN  the computed snapshot the creator adds from v1.11 onward
//
// Every other segment is left untouched. That is what makes the round trip
// lossless: we never need to understand a segment in order to preserve it.
export function parseCode(code) {
  const trimmed = (code || "").trim();
  if (!trimmed) return { error: "Paste a character code first." };
  const parts = trimmed.split("-");
  if (parts[0] !== "DM1") return { error: "That does not look like a Dreams & Machines code." };

  const cpIndex = parts.findIndex((p) => p.startsWith("CP"));
  const snIndex = parts.findIndex((p) => p.startsWith("SN"));
  if (cpIndex < 0) return { error: "This code has no character payload." };
  if (snIndex < 0) {
    return { error: "This code was made before Owlbear support was added. Re-export it from the character creator (version 1.11 or newer)." };
  }

  let char, snap;
  try {
    char = JSON.parse(b64decode(parts[cpIndex].slice(2)));
    snap = JSON.parse(b64decode(parts[snIndex].slice(2)));
  } catch (err) {
    return { error: "That code is damaged and could not be read." };
  }
  return { parts, char, snap, cpIndex, snIndex };
}

// Rebuild a code with an edited character object, leaving all other segments
// byte for byte identical to how the creator wrote them.
export function rebuildCode(parts, cpIndex, char) {
  const next = parts.slice();
  next[cpIndex] = "CP" + b64encode(JSON.stringify(char));
  return next.join("-");
}

// -------------------------------------------------------------
// Roll engine
// -------------------------------------------------------------
// Lifted from classifyDie() in the character creator, and confirmed against
// the core rulebook: a die equal to or under the Attribute is a success, a die
// equal to or under the Skill is a critical worth two successes, and a natural
// 20 is a Complication. Order matters, 20 is never a success.
export function classifyDie(value, attrValue, skillValue) {
  if (value === 20) return "complication";
  if (value <= skillValue) return "crit";
  if (value <= attrValue) return "success";
  return "fail";
}

export function rollDice(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 20));
  return out;
}

export function resolveRoll(dice, attrValue, skillValue, diff) {
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
    detail, successes, complications,
    passed: successes >= diff,
    momentumGained: Math.max(0, successes - diff),
  };
}

export const clamp = (n, lo, hi) => (Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)));
