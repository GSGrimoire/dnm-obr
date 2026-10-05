// =============================================================
// The GM's rules, as data (1.5)
// -------------------------------------------------------------
// Everything the GM panel offers, with the book's own words and the page they are on.
// Kept here, SDK-free, for the same reason the event reducer lives in dnm.js: a rule
// nobody can test is a rule nobody can trust, and the costs below are exactly the kind
// of number that drifts when it is written into a button handler.
//
// THE QUOTES ARE THE BOOK'S WORDING, by request. Page numbers are the PRINTED page
// numbers in the footers of the Dreams and Machines Gamemaster's Guide, Chapter 4. The
// chapter's own cross-references point two pages earlier than its printed footers (it
// sends you to "page 105" for Threat, which is printed as 107), so where a reader finds a
// mismatch, the footer is what these follow. An ellipsis marks text left out; nothing is
// paraphrased inside quotation marks.
//
// Chapter 5 (Adversaries and NPCs) was not available when this was written. Nothing here
// claims to know what Menacing or the NPC tiers say beyond what Chapter 4 says about
// them, and the sample stat blocks are marked as samples.
// =============================================================

export const GM_GUIDE = "GM Guide";

// -------------------------------------------------------------
// Gaining Threat
// -------------------------------------------------------------
// `amount` is a fixed delta; `ask` means the button has a stepper and the amount is the
// GM's to choose within [min, max]. `pub` decides what the PUBLIC log says: gains are
// announced by name, because the book asks the GM to announce them ("always announce the
// Threat cost and let the players consider whether the action is worth the cost").
export const GAIN_RULES = [
  {
    id: "escalation", label: "Escalation", amount: 1, page: 112,
    quote: "The GM — or the rules — may note that specific actions or decisions risk Escalation, making a situation more dangerous or unpredictable. If a character performs an action that risks Escalation, they immediately add one to Threat. … The GM should declare that an action risks Escalation, and then allow the player character to choose whether they wish to continue with that choice: springing an Escalation cost on a player after the fact is unlikely to be well-received.",
  },
  {
    id: "dithering", label: "Dithering", amount: 2, page: 110,
    quote: "In these situations, particularly in time-sensitive situations like combat, the GM may wish to announce to the group that their debating and time-wasting will add to Threat… and if this doesn’t stir them to action, add 2 points to Threat. This Threat could even be spent right away to change the situation in such a way that makes the players react and gets the game moving again.",
  },
  {
    id: "threatening", label: "Threatening circumstances", ask: true, min: 1, max: 2, amount: 1, page: 112,
    quote: "Threatening Circumstances: The environment or situation of a new scene may be threatening or dangerous in some way, adding one or two Threat to the pool automatically when the scene begins.",
  },
  {
    id: "buyoff", label: "Complication bought off", amount: 2, page: 112,
    quote: "Complications: Whenever a player character suffers one or more complications on a Skill Test, they or the GM may choose to add two points to Threat to “buy off” the complication.",
  },
  {
    id: "insteadOfMomentum", label: "Paid in Threat instead of Momentum", ask: true, min: 1, max: 6, amount: 1, page: 111,
    quote: "Instead of Momentum: Whenever a player character could spend Momentum, even if they do not have any Momentum left to spend, they may choose to pay some or all the cost by adding to Threat. Each point of Threat added to the GM’s pool counts as one Momentum towards whatever use of Momentum the player character wishes to use. NPCs allied to the player characters generate Threat in this way as well.",
  },
  {
    id: "adversaryMomentum", label: "Adversary Momentum to Threat", ask: true, min: 1, max: 6, amount: 1, page: 112,
    quote: "Adversary Momentum: Adversary NPCs with unspent Momentum may spend that Momentum to add to Threat. Each Momentum spent adds one to Threat.",
  },
  {
    id: "restBreak", label: "Rested too long: Break", amount: 2, page: 121,
    quote: "Rest: Under most circumstances, let the player characters rest after an action scene, even if it’s only a Breather (5 minute rest). If it seems like the amount of time the players want to rest is too long, the GM can add to Threat (2 for a Break rest, 4 for Bed rest), to represent problems and situations getting worse while the player characters sit idle. When adding to Threat in this way, always announce the Threat cost and let the players consider whether the action is worth the cost.",
  },
  {
    id: "restBed", label: "Rested too long: Bed", amount: 4, page: 121,
    quote: "Rest: Under most circumstances, let the player characters rest after an action scene, even if it’s only a Breather (5 minute rest). If it seems like the amount of time the players want to rest is too long, the GM can add to Threat (2 for a Break rest, 4 for Bed rest), to represent problems and situations getting worse while the player characters sit idle. When adding to Threat in this way, always announce the Threat cost and let the players consider whether the action is worth the cost.",
  },
  {
    id: "hazardWorsens", label: "The hazard makes things worse", ask: true, min: 1, max: 2, amount: 1, page: 116,
    quote: "The Hazard Takes a Turn. If including a hazardous environment as part of an action scene, treat the Hazard itself as a creature, and have it take a turn in the action order. On the Hazard’s turn, either describe how the Hazard is making the situation worse and add one or two points to the Threat pool, or spend some Threat to have the Hazard actually affect one or more of the PCs.",
  },
];

// -------------------------------------------------------------
// Spending Threat
// -------------------------------------------------------------
// `cost` is either a number or the name of a function in COSTS below, which turns the
// button's inputs into a number. The PUBLIC log line for a spend is only ever "GM spent N
// Threat" — the reason goes to the GM's own log. A Reveal named in the shared log would
// tell the table there is a bomb in the room.
export const SPEND_RULES = [
  {
    id: "complication", label: "Create a Complication", cost: 2, page: 113,
    quote: "Complication: The Gamemaster may create a Complication by spending two Threat. This must come naturally from the current situation. This can be a useful way to generate complications without waiting for them to occur, but it should be used sparingly. … as a rule of thumb, a complication should only ever occur in reaction to an event, rather than appearing out of nowhere.",
  },
  {
    id: "adversaryComplication", label: "Adversary buys off a complication", cost: 2, page: 113,
    quote: "Adversary Complications: If an Adversary NPC suffers a complication, the GM may buy off that complication by spending two Threat, a natural counterpart to how the rules work for player characters.",
  },
  {
    id: "adversaryMomentumSpend", label: "Adversary uses Threat as Momentum", cost: "ask", min: 1, max: 6, page: 113,
    quote: "Adversary Momentum: Threat serves in part as a mirror of the players’ Momentum pool. Thus, Adversary NPCs may spend Threat in all the ways that the player characters can use Momentum.",
  },
  {
    id: "adversaryThreatCost", label: "Adversary pays a Threat cost", cost: "ask", min: 1, max: 6, page: 113,
    quote: "Adversary Threat Costs: On any action where a player character would be required to add one or more points to Threat, an Adversary NPC performing the same action or making the same choice must spend an equivalent number of points of Threat. Similarly, some Adversaries will have special abilities which are triggered by spending Threat.",
  },
  {
    id: "reinforcements", label: "Reinforcements", cost: "reinforcements", page: 113,
    quote: "Reinforcements: The GM may bring in additional Adversary NPCs during a scene. Normal NPCs cost one Threat each. A group of Normal NPCs costs Threat equal to half the number of NPCs in the group, rounded up. In a conflict, this should be done at the start of a round, with the reinforcements able to act during that round as normal. This does not apply to NPCs who are present at the start of the scene, only additional ones who arrive while the scene is in progress. There must be some logical reason why those reinforcements have arrived and where they’ve come from.",
  },
  {
    id: "incidental", label: "Incidental Effect", cost: "incidental", page: 114,
    quote: "Incidental Effects cost one Threat, and they appear in play as things such as flickering lights, unstable floors, and thick smoke. These don’t cause a significant problem, but might increase the complication range of a Skill Test by one, make some routine action require a Difficulty 1 Skill Test when success would normally be automatic, or require a Difficulty 1 Skill Test to avoid a problem. … The effect applies to a single character when the Threat is spent; extra Threat may be spent to affect additional characters, though it shouldn’t affect too many characters at once.",
  },
  {
    id: "changeCircumstances", label: "Change of Circumstances", cost: "truths", page: 114,
    quote: "A Change of Circumstances is more significant, and such an effect should cost at least two Threat. An environmental effect like this can be represented by taking an existing location or situation Truth, and then replacing it with another Truth of the same type (such as going from bright light to deep darkness), or by adding a new Truth that alters the situation in some way, shape, or form. … Each Truth changed, added, or removed costs 2 Threat, and some changes of circumstances could see several Truths change in quick succession.",
  },
  {
    id: "divide", label: "Divide the Group", cost: "divide", page: 115,
    quote: "Dividing the Group can complicate the player characters’ plans like nothing else. … When used, the gamemaster splits the group into two, choosing how many and which characters end up in which part of the group. The gamemaster then pays Threat equal to the number of player characters in the larger of the two parts of the group. The two parts of the group cannot directly interact with one another while divided … At the very most, the separation lasts only until the end of the current scene.",
  },
  {
    id: "reveal", label: "Reveal", cost: 4, page: 115,
    quote: "A Reveal shows the player characters some fact that they wish wasn’t true. This could be an ally betraying the player characters, or it could be the discovery that that the situation they’re in is an ambush, or that there’s a bomb in the room. This sets up a new situation, changing the nature of the scene … A Reveal costs 4 Threat.",
  },
];

// The starred GM actions. Each is its own button because the book lists them as separate
// things and a GM scanning for "they lose something valuable" should find those words.
// One deliberate departure from the printed text: the first simple action reads "an
// action in their stat blockstatblock" in the book, a typesetting slip, given here as
// "stat block". Every other quote in this file keeps the book's wording as printed,
// including its "that that" under Reveal.
export const GM_ACTIONS = {
  simple: {
    cost: 1, page: 120,
    quote: "Simple Actions: any of the following actions marked with a * should also cost the GM 1 Threat.",
    starred: [
      "One of the PCs, or a friend or ally, is separated from the group*.",
      "An adversary reveals some hidden advantage or secret ability*.",
      "A new adversary or peril is revealed*.",
    ],
    free: [
      "An adversary takes an action (such as an attack, or an action in their stat block).",
      "Something or someone the PCs care about is vulnerable to danger.",
      "Foreshadow some future danger.",
      "A PC needs to make a difficult choice, or to compromise in some way.",
      "An existing peril gets worse in some way.",
    ],
  },
  serious: {
    cost: 2, page: 120,
    quote: "Serious Actions: any of the following actions marked with a * should cost the GM 2 Threat.",
    starred: [
      "A PC, or a friend or ally, suffers an Injury*.",
      "A PC loses something valuable*.",
      "A new adversary or peril appears suddenly and then takes an action*.",
    ],
    free: [
      "An adversary uses an action, and automatically succeeds!",
      "An adversary uses an advantage or ability they’ve revealed.",
    ],
  },
};

export const RUSH_RULE = {
  id: "rush", label: "End Scene, rushed", cost: 2, page: 101,
  quote: "At the end of most scenes, the players can normally expect to be able to take at least a Breather rest — a few minutes, sufficient to recover 2 Spirit and recharge some simple items — if they need it. However, one option the GM has at the end of a scene is to rush or hurry the players. If the next scene is only a short time later, with no opportunity to rest between them — perhaps the characters haven’t had time to stop, or the next scene begins only moments later — the GM may spend 2 Threat to reflect this, preventing the players from taking this rest.",
};

export const REVERSAL_RULE = {
  id: "reversal", label: "Reversal", page: 115,
  quote: "A Reversal is a significant turning point or change of fortunes, and the gamemaster may only use this once per adventure. By spending two Threat per player character present in the scene, the gamemaster ends the scene immediately, with the situation unresolved. … The reversal cannot be used to harm or kill the player characters directly, only to radically change their circumstances … To compensate the player characters for facing this reversal, let each of the PCs recover half their maximum Spirit when the scene ends.",
};

export const TICKER_RULE = {
  page: 109,
  quote: "Alternately, the GM may wish to try adding one or two to Threat periodically (either in general, or because of NPC actions, like setting explosives or building a weapon) to represent a ticking clock or escalating problem, to urge the players to action if they’re being overly cautious.",
};

export const LINGERING_RULE = {
  page: 114,
  quote: "Lingering Hazards are effects applied to an area (one zone), which deal damage to anyone within that area, at the start of each round. This may represent something like a raging fire, radiation, choking fumes, or a room flooding with corrosive chemicals. The GM should spend the Threat to create a Truth describing this effect when the player characters first become aware of it. Lingering Hazards may generate Threat over time, building to something more severe, or they may be precarious, representing an unstable situation that could go wrong at any time.",
};

export const GROWTH_RULE = {
  page: 125,
  quote: "Characters gain growth when they face adversity, in any situation where you spend three or more Threat in one go. Naturally, this is up to the GM, but players can encourage it by providing Threat to spend, and creating situations like inflicting injuries on NPCs with a high damage rating, as that’ll create situations for the GM to spend lots of Threat.",
};

export const PERSONAL_THREAT_RULE = {
  page: 113,
  quote: "Many NPCs, especially Major NPCs like Wakers, have a pool of Personal Threat which they can use in place of the GM’s main Threat pool. In practical terms, this is a lot like the Spirit pool that player characters have, giving these powerful NPCs extra potency. These points can only be spent on effects which directly benefit the NPC they belong to, and they cannot be replenished during the course of a scene. If the same NPC appears again in a later scene, their Personal Threat is refilled.",
};

export const MENACING_RULE = {
  page: 112,
  quote: "Some NPCs may generate Threat simply by turning up (this is covered by the Menacing special ability, in Chapter 5: Adversaries and NPCs, page 124) … Allies with the Menacing ability are an interesting idea too — it’s a nice compromise for having a capable friend, as their presence draws attention that helps offset their abilities.",
};

// -------------------------------------------------------------
// Starting Threat
// -------------------------------------------------------------
export const STAKES = [
  { id: "low", label: "Low", perPc: 1, page: 111,
    quote: "A low stakes adventure begins with 1 Threat per player character. These adventures are likely to be simple, straightforward affairs. This is useful for short one-off games, while in a campaign it suits low-key adventures that serve as a reprieve after a few tense adventures." },
  { id: "standard", label: "Standard", perPc: 2, page: 111,
    quote: "The gamemaster begins every adventure with a set amount of Threat, based on both the number of players and on the underlying tension and danger of the adventure itself. By default, this is 2 Threat per player character, but some adventures may begin with a larger or smaller number." },
  { id: "high", label: "High", perPc: 3, page: 111,
    quote: "A high stakes adventure begins with 3 Threat per player character. These adventures are likely to be high in action, drama, and uncertainty. In a campaign, several adventures may lead up to a high stakes adventure, building in tension over time." },
  { id: "catastrophic", label: "Catastrophic", perPc: 4, page: 111,
    quote: "A catastrophic adventure begins with 4 Threat per player character. These adventures are likely to be explosive, whether literally or figuratively, and are ideally suited to climactic struggles against major adversaries. They should also be extremely rare, used as the very climax of a campaign." },
];

// -------------------------------------------------------------
// The hazard builder (p.116 baseline, p.117 table)
// -------------------------------------------------------------
export const HAZARD_BASE = {
  damage: 2, cost: 1, difficulty: 2, page: 116,
  quote: "Hazards are Attacks the Environment Makes. … As a baseline, an Injury with a damage rating of 2 should cost 1 Threat to make, and the targeted character can make a Skill Test (such as a Quickness (Move) Test to dodge falling debris, or a Might (Survive) Test to resist toxins or contaminants) with a Difficulty of 2 to avoid the Hazard, and the right equipment (such as environment suits for toxic gasses, radiation, etc.) can affect these Tests. Characters can spend Spirit to avoid these Injuries as normal.",
};

export const HAZARD_OPTIONS = [
  { id: "damage", label: "+1 Damage Rating", cost: 1, stack: true, page: 117,
    quote: "+1 Damage Rating — 1 Threat. You may be bought multiple times." },
  { id: "breaker", label: "Breaker", cost: 1, page: 117,
    quote: "Breaker — 1 Threat. The Hazard gains the Breaker quality. Protection from Armor against this Injury is reduced as a result." },
  { id: "nonLethal", label: "Non-Lethal", cost: -1, page: 117,
    quote: "Non-Lethal — −1 Threat. The Hazard gains the Non-Lethal quality. Injuries inflicted by a Non-Lethal hazard are instantly healed (and removed completely) when treated by an ally, or at the start of the next scene, whichever happens first." },
  { id: "targets", label: "Additional Target", cost: 1, stack: true, page: 117,
    quote: "Additional Target — 1 Threat. The Hazard affects one additional character per Threat spent. Each character may Test to avoid the Hazard individually." },
  { id: "blast", label: "Blast", cost: 2, page: 117,
    quote: "Blast — +2 Threat. The Hazard affects all characters within the zone - PCs and NPCs alike. Each character may Test to avoid the Hazard individually." },
  { id: "easier", label: "Easier to Avoid", cost: -2, page: 117,
    quote: "Easier to Avoid — −2 Threat. The Skill Test to avoid the Hazard is only Difficulty 1. This can reduce the cost to 0." },
  { id: "harder", label: "Harder to Avoid", cost: 2, page: 117,
    quote: "Harder to Avoid — +2 Threat. The Skill Test to avoid the Hazard is Difficulty 3." },
];

const HAZARD_MAX_STACK = 6;

// Takes { damage: extraDamage, targets: extraTargets, breaker, nonLethal, blast, easier,
// harder } and returns what the hazard is and what it costs. Easier and Harder are one
// choice, not two: a hazard cannot be both Difficulty 1 and Difficulty 3, so Harder wins
// when a caller somehow sets both — the more expensive reading, and the one a GM who
// pressed both would notice.
export function hazardCost(opts = {}) {
  const extraDamage = clampInt(opts.damage, 0, HAZARD_MAX_STACK);
  const extraTargets = opts.blast ? 0 : clampInt(opts.targets, 0, HAZARD_MAX_STACK);
  const harder = !!opts.harder;
  const easier = !!opts.easier && !harder;
  let cost = HAZARD_BASE.cost + extraDamage + extraTargets;
  if (opts.breaker) cost += 1;
  if (opts.nonLethal) cost -= 1;
  if (opts.blast) cost += 2;
  if (harder) cost += 2;
  if (easier) cost -= 2;
  // "This can reduce the cost to 0." Not below.
  cost = Math.max(0, cost);
  const qualities = [];
  if (opts.breaker) qualities.push("Breaker");
  if (opts.nonLethal) qualities.push("Non-Lethal");
  if (opts.blast) qualities.push("Blast");
  else if (extraTargets) qualities.push(`+${extraTargets} target${extraTargets === 1 ? "" : "s"}`);
  return {
    cost,
    damage: HAZARD_BASE.damage + extraDamage,
    difficulty: harder ? 3 : easier ? 1 : HAZARD_BASE.difficulty,
    qualities,
  };
}

// One line for the GM log. The kind of damage is the GM's word ("burning", "pinned and
// trapped") because the book's examples name it that way.
export function hazardSummary(h, name) {
  const what = String(name || "Hazard").trim().slice(0, 30) || "Hazard";
  const q = h.qualities.length ? `, ${h.qualities.join(", ")}` : "";
  return `${what} ${h.damage}${q}, avoid at D${h.difficulty}`;
}

// -------------------------------------------------------------
// Costs that depend on the button's inputs
// -------------------------------------------------------------
export function reinforcementCost(count, asGroup) {
  const n = clampInt(count, 1, 24);
  // "A group of Normal NPCs costs Threat equal to half the number of NPCs in the group,
  // rounded up." A group of one is just one NPC, and costs one either way.
  return asGroup ? Math.ceil(n / 2) : n;
}

// The larger part of a split group. A party of five split 3 and 2 costs 3; the GM types
// the larger part, so this only has to keep it a plausible party size.
export function divideCost(largerPart) {
  return clampInt(largerPart, 1, 12);
}

export function incidentalCost(characters) {
  return clampInt(characters, 1, 6);
}

export function truthsCost(truths) {
  return 2 * clampInt(truths, 1, 6);
}

export function reversalCost(pcsPresent) {
  return 2 * clampInt(pcsPresent, 1, 12);
}

export function startingThreat(stakesId, pcs) {
  const s = STAKES.find((x) => x.id === stakesId) || STAKES[1];
  return s.perPc * clampInt(pcs, 1, 12);
}

export const COSTS = {
  reinforcements: (inp) => reinforcementCost(inp.count, inp.group),
  incidental: (inp) => incidentalCost(inp.count),
  truths: (inp) => truthsCost(inp.count),
  divide: (inp) => divideCost(inp.count),
  ask: (inp) => clampInt(inp.count, 1, 6),
};

export function spendCost(rule, inputs = {}) {
  if (typeof rule.cost === "number") return rule.cost;
  const fn = COSTS[rule.cost];
  return fn ? fn(inputs) : 0;
}

// -------------------------------------------------------------
// Tickers: Threat that arrives every round
// -------------------------------------------------------------
// Several named sources, each 0 to 6, each on or off, each public or not. The amount per
// source is the range the table asked for; the book's own ticking clock is "one or two",
// and a raging Lingering Hazard building to something worse can reasonably be more.
export const TICKER_MAX = 6;
export const MAX_TICKERS = 8;
export const TICKER_PRESETS = [
  { name: "Ticking clock", amount: 1, page: 109 },
  { name: "Lingering hazard", amount: 1, page: 114 },
  { name: "Alarm sounding", amount: 1, page: 112 },
  { name: "Reinforcements closing in", amount: 1, page: 113 },
  { name: "The hazard takes a turn", amount: 1, page: 116 },
];

function cleanName(v, max = 32) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// Storage is untrusted on the way OUT — the same rule the dock and the recovery buffer
// follow. These are rendered in a loop, so the list is capped as well as cleaned.
export function normalizeTickers(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && typeof t === "object")
    .slice(0, MAX_TICKERS)
    .map((t, i) => ({
      id: cleanName(t.id, 24) || `tk${i}`,
      name: cleanName(t.name) || "Ticker",
      amount: clampInt(t.amount, 0, TICKER_MAX),
      on: t.on !== false,
      // Public by default would put "Reinforcements closing in" in the shared log the
      // first time it ticked. A ticker is the GM's secret until the GM says otherwise.
      visible: t.visible === true,
      // Kept across End Scene. Off by default: most clocks belong to one scene.
      pinned: t.pinned === true,
    }));
}

export function tickerTotal(list) {
  return normalizeTickers(list).reduce((sum, t) => sum + (t.on ? t.amount : 0), 0);
}

// What End Scene leaves behind.
export function tickersAfterScene(list) {
  return normalizeTickers(list).filter((t) => t.pinned);
}

// The lines one round produces, one per ticker that contributes. Each carries the
// public and the private wording, so the caller never has to decide which is which.
export function tickLines(list, round) {
  const r = clampInt(round, 0, 999);
  const lead = r ? `Round ${r} ended` : "Round ended";
  return normalizeTickers(list)
    .filter((t) => t.on && t.amount > 0)
    .map((t) => ({
      ticker: t.id,
      amount: t.amount,
      publicLabel: t.visible ? t.name : "Threat rises",
      publicDetail: `${lead}: +${t.amount} Threat`,
      privateLabel: t.name,
      privateDetail: `${lead}: +${t.amount} Threat${t.visible ? "" : " (hidden from the table)"}`,
    }));
}

// -------------------------------------------------------------
// Chapter 5: Non-Player Characters (1.6)
// -------------------------------------------------------------
// Quoted from the printed pages 126-131, as the Chapter 4 quotes are. Two printed slips
// are corrected and say so: "akill" (p.127) is shown as "skill". Chapter 4 sends the
// reader to a "Menacing" ability in this chapter; there is none. The ability the
// chapter prints is THREATENING, and the table treats them as one (decided 1.6). The
// old "Threat when it turns up" reading survives only as a house rule the GM switches on.
export const NPC_SPEND_RULE = {
  page: 126,
  quote: "NPCs do not have Spirit. Rather, they can spend Threat from the GM’s pool in all the ways that the PCs can spend Spirit, including to avoid attacks. An NPC cannot spend Threat to avoid an attack if they have less than the amount needed. Some NPCs — including all Major NPCs — have a personal Threat pool that they alone can spend.",
};

export const SIDES = [
  { id: "adversary", label: "Adversary", page: 126,
    quote: "Adversaries are NPCs who oppose the player characters, often because they are affiliated with opposing factions." },
  { id: "ally", label: "Ally", page: 126,
    quote: "Allies are NPCs who work with or for the player characters. Players can often take direct control of NPCs in situations where their normal player character is absent or busy elsewhere." },
  { id: "bystander", label: "Bystander", page: 126,
    quote: "Bystanders are NPCs who are neither opposed to or aligned with the player characters, and who are just trying to get on with their lives." },
];

export const ALLY_RULE = {
  page: 127,
  quote: "With an allied NPC — one currently helping the player characters — any situation where they would spend Threat, they add an equivalent amount to Threat instead. Allied NPCs with a personal Threat pool spend points from that as normal, but must otherwise add to Threat to use special abilities, buy extra dice, or avoid injuries, etc.",
};

export const NORMAL_NPC_RULE = {
  page: 127,
  quote: "Normal NPCs have two attributes: a main attribute named for the NPC’s Truth, and a second, lower attribute simply called “Default”. Each of these attributes has an associated skill rating; this is normally 1 for the Default skill, and it is always lower than the main skill.",
};

export const NORMAL_DEFEAT_RULE = {
  page: 127,
  quote: "Normal NPCs are defeated after suffering a single Injury, of any kind.",
};

export const MAJOR_DEFEAT_RULE = {
  page: 129,
  quote: "Defeat: A Major NPC must suffer several Injuries before they are defeated. This is normally equal to the number of Truths it has plus +1.",
};

export const MAJOR_PT_RULE = {
  page: 129,
  quote: "Personal Threat: All Major NPCs have a pool of Personal Threat, typically containing 3-6 points. The GM may spend this Threat on any actions or abilities the NPC has, including avoiding Injury.",
};

export const MAJOR_ACTIONS_RULE = {
  page: 129,
  quote: "Special Actions: Major NPCs have a specific list of special actions they can perform. These include the NPC’s attacks and weapons, and they will often be presented in a table allowing the actions the NPC takes to be determined randomly on a given turn. Each Major NPC has 4-6 actions.",
};

export const COMPETENCE_RULE = {
  page: 128,
  quote: "Select a Competence level for the NPC at their main area of expertise — this determines their ratings for their main attribute and skill. Then, select a lower level of Competence, and use that to determine the ratings for the NPC’s default attribute and skill.",
};

// p.128. `attr` is the top of the printed range: the picker fills it and the GM can take
// one off.
export const COMPETENCE = [
  { id: "basic", label: "Basic", range: "7-8", attr: 8, skill: 1 },
  { id: "proficient", label: "Proficient", range: "9-10", attr: 10, skill: 2 },
  { id: "talented", label: "Talented", range: "11-12", attr: 12, skill: 3 },
  { id: "exceptional", label: "Exceptional", range: "13-14", attr: 14, skill: 4 },
  { id: "master", label: "Master", range: "15-16", attr: 16, skill: 5 },
];

export function competenceOf(attr, skill) {
  const a = clampInt(attr, 0, 20);
  return COMPETENCE.find((c) => c.skill === clampInt(skill, 0, 6) && a >= c.attr - 1 && a <= c.attr) || null;
}

export const NATURAL_WEAPON_RULE = {
  page: 128,
  quote: "For NPCs with a “natural” form of attack (i.e., one from their own body, not from a weapon they carry), a rating equal to 1 lower than their main Skill, or equal to their main Skill if they’re meant to be particularly deadly.",
};

export const GROUP_RULES = {
  action: { page: 128, label: "Group Action",
    quote: "Group Action: when a group of NPCs attempts a Test, one of the NPCs in the group leads the action, and the rest assist that leader." },
  attack: { page: 128, label: "Attacking a Group",
    quote: "Attacking a Group: Attacks against groups are always normal Skill Tests, rather than contests. If a group is able to defend itself (such as from a melee attack that they are aware of, or from a ranged attack while in cover), the difficulty of the attack increases by +1 for every 2 NPCs in the group (i.e., attacking a group of 4 Thralls in melee would have a difficulty of 3). NPCs who receive this bonus may spend 2 points of Threat to counter-attack if an attack against them misses." },
  defeat: { page: 128, label: "Defeating Groups",
    quote: "Defeating Groups: when a group of NPCs is attacked, a single NPC in the group is hit by the attack, suffers an Injury and is thus defeated unless they spend Threat to avoid the Injury. The attacker may spend Momentum to hit additional NPCs in that group; every 2 Momentum spent hits one extra NPC. If the weapon has the Burst quality, it hits one extra NPC for every 1 Momentum spent instead." },
};
export const COUNTER_ATTACK_COST = 2;

// The difficulty ADDED to an attack on a group that can defend itself. The book's own
// example is the check: four Thralls take a Difficulty 1 attack to 3.
export function groupDefenceBonus(count) {
  return Math.floor(clampInt(count, 0, 24) / 2);
}

// Momentum for `extra` more NPCs hit in a group (p.128).
export function extraHitsMomentum(extra, burst = false) {
  return clampInt(extra, 0, 24) * (burst ? 1 : 2);
}

// The common abilities and actions (pp.130-131). `aliases` are the names the book's
// own stat blocks use for the same thing — the Waker's "Armor Plating", the Prowlcat's
// "Armored Hide" — so a stat block typed or imported with those names is recognised.
// `cost` is what a press spends; `gain` is what it adds. `kind` decides the button.
export const NPC_ABILITIES = [
  { key: "armored", label: "Armored", page: 130, type: "ability", aliases: ["armor plating", "armour plating", "armored hide", "armoured"],
    quote: "The NPC has a Protection rating, reducing the amount of Threat it must spend to avoid Injury. This Protection rating is halved by attacks with the Breaker quality." },
  { key: "threatening", label: "Threatening", page: 130, type: "ability", aliases: ["menacing"], gain: 1,
    quote: "The NPC is especially dangerous, and the situation will only get worse while they are present. The NPC adds +1 to Threat at the start of each of its actions." },
  { key: "incorporeal", label: "Incorporeal", page: 131, type: "ability",
    quote: "The NPC’s form is not solid, but a collection of nanites and projected kinetic fields. Any attack which does not inflict a Shocked Injury counts as inflicting an Injury of Disrupted 1." },
  { key: "swift", label: "Swift", page: 131, type: "ability", cost: 1,
    quote: "The NPC is quick and maneuverable. When this NPC takes an action, it may spend 1 Threat to move one extra zone before or after its action." },
  { key: "decrepit", label: "Decrepit", page: 131, type: "ability", compAt: 19,
    quote: "The NPC is damaged or malfunctioning, and suffers complications on a 19 or 20, gaining a malfunction Truth on its next turn if a complication is rolled." },
  { key: "bigAndSlow", label: "Big and Slow", page: 131, type: "ability",
    quote: "The NPC is especially large and slow-moving. Reduce the difficulty of ranged attacks against this NPC by 1." },
  { key: "solitary", label: "Solitary", page: 131, type: "ability",
    quote: "The NPC typically operates alone, often against numerous foes. It may take more than one turn each round, but each turn after the first costs Threat: the first extra turn costs 1 Threat, the second costs 2, and so forth." },
  { key: "ambush", label: "Ambush", page: 131, type: "action",
    quote: "May only attempt while hidden. The NPC emerges from the shadows in a zone of its choosing and makes a melee attack. The target cannot defend against this attack. The melee attack is made with a weapon chosen when this action is added to an NPC." },
  { key: "defend", label: "Defend", page: 131, type: "action",
    quote: "The NPC adopts a defensive stance. Until the start of its next turn, the NPC either gains +2 Protection or increases the difficulty of attacks against it by +1 (choose when adding this action to an NPC). In addition, it may counter-attack against failed melee attacks for free using a melee weapon chosen when this action is added to an NPC." },
  { key: "hunt", label: "Hunt", page: 131, type: "action",
    quote: "The NPC carefully observes its surroundings and watches its enemies. Make a difficulty 0 Insight (Study) Test. Any successes are immediately converted to Threat." },
  { key: "lurk", label: "Lurk", page: 131, type: "action", cost: 1,
    quote: "The NPC moves slowly and cautiously, preparing to strike. Spend 1 Threat while the NPC is in darkness or otherwise has cover or concealment. The NPC is hidden: remove their token from its current zone. PCs must succeed at an Insight (Sneak) Test contested by the NPC’s Quickness (Sneak) Test to locate it. When located, place the NPC in any zone." },
  { key: "meleeAttack", label: "Melee Attack", page: 131, type: "action",
    quote: "The NPC makes a melee attack with the chosen melee weapon." },
  { key: "pounce", label: "Pounce", page: 131, type: "action", cost: 1,
    quote: "When the NPC moves to an enemy and makes a melee attack, spend 1 Threat to Pounce. If the attack is successful, the target gains a knocked prone Truth." },
  { key: "rangedAttack", label: "Ranged Attack", page: 131, type: "action",
    quote: "The NPC makes a ranged attack with the chosen ranged weapon." },
  { key: "recharge", label: "Recharge", page: 131, type: "action",
    quote: "The NPC draws power from an internal source. If the NPC’s Powered weapon has discharged, it is now recharged." },
  { key: "retreat", label: "Retreat", page: 131, type: "action",
    quote: "The NPC retreats from battle. The NPC takes no further part in this scene. Add X to Threat where X is the number of Injuries the NPC can withstand before being defeated." },
  { key: "selfRepair", label: "Self-Repair", page: 131, type: "action", aliases: ["selfrepair", "self repair"],
    quote: "The machine pauses, activating diagnostics and self-repair protocols. It makes a Resolve (Operate) Test with a Difficulty of 2 to remove any one hindering Truth affecting it." },
];

const ABILITY_NAMES = NPC_ABILITIES.flatMap((a) => [a, ...(a.aliases || []).map((n) => ({ ...a, alias: n }))]
  .map((x) => ({ key: x.key, name: (x.alias || x.label).toLowerCase() })))
  .sort((a, b) => b.name.length - a.name.length);

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

// Which library entry a stat block line is, from its NAME. Starts-with, longest name
// first, so "Armored Hide" is Armored and "Self-Repair" is not read as anything shorter.
export function abilityKey(name) {
  const n = squash(name);
  if (!n) return null;
  const hit = ABILITY_NAMES.find((a) => n === squash(a.name) || n.startsWith(squash(a.name) + " "));
  return hit ? hit.key : null;
}

export function abilityByKey(key) {
  return NPC_ABILITIES.find((a) => a.key === key) || null;
}

// Every library key a stat block carries, abilities and actions alike.
export function npcKeys(npc) {
  const keys = new Set();
  for (const x of [...(npc?.abilities || []), ...(npc?.actions || [])]) {
    const k = abilityKey(x.name);
    if (k) keys.add(k);
  }
  return keys;
}

// The Threat a creature-specific action asks for, read off its own text: "Spend 2
// Threat", "spend 1 Threat to Pounce", "Spend 1, 2, or 3 Threat". This is how the
// Barg's Trample and the Cryptid's Stun-flash get a button without the library knowing
// them. Null when the text names no spend.
export function threatCostIn(text) {
  const m = /spend\s+(\d+(?:\s*,\s*\d+)*(?:\s*,?\s*or\s+\d+)?)\s+threat/i.exec(String(text || ""));
  if (!m) return null;
  const nums = m[1].match(/\d+/g).map(Number).filter((n) => n > 0 && n <= 20);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// How many Injuries take it down (pp.127, 129). A Major NPC with no number set uses the
// book's "Truths plus 1".
export function defeatLimit(npc) {
  if (!npc || npc.kind !== "major") return 1;
  if (npc.defeat > 0) return npc.defeat;
  return Math.max(1, (npc.truths || []).length) + 1;
}

// The Threat to avoid an Injury (pp.126, 130): the damage rating less Protection.
// Breaker halves Protection, rounded down — the book's own blocks agree (2 → 1, 4 → 2).
// `ranged` adds a block's extra Protection against ranged attacks (the Prowlcat's), and
// `defending` the Defend action's +2.
export function avoidInjuryCost({ damage, protection = 0, rangedProtection = 0, ranged = false, defending = false, breaker = false } = {}) {
  let p = clampInt(protection, 0, 20) + (ranged ? clampInt(rangedProtection, 0, 20) : 0) + (defending ? 2 : 0);
  if (breaker) p = Math.floor(p / 2);
  return Math.max(0, clampInt(damage, 0, 20) - p);
}

// The Injuries it could still take: what Retreat adds to Threat (p.131). A group counts
// each of its NPCs, since each is defeated by one.
export function injuriesLeft(npc, row) {
  const count = clampInt(row?.count ?? 1, 0, 24);
  if (!npc || npc.kind !== "major") return count;
  return Math.max(0, defeatLimit(npc) - clampInt(row?.injuries, 0, 20));
}

// A weapon's damage rating: the first number in "Impaled 3" or "Plasma Burn 3, Breaker".
export function damageRating(text) {
  const m = /(\d{1,2})/.exec(String(text || ""));
  return m ? clampInt(m[1], 0, 20) : 0;
}

export function hasQuality(weapon, quality) {
  return new RegExp(`\\b${quality}\\b`, "i").test(`${weapon?.qualities || ""} ${weapon?.damage || ""}`);
}

// Solitary: the n-th extra turn this round costs n (p.131).
export function solitaryCost(extraTurnsTaken) {
  return clampInt(extraTurnsTaken, 0, 20) + 1;
}

// A d20 range off an action ("1-4", "17–20", "9") and the action a roll lands on.
export function parseRollRange(text) {
  const m = /^\s*(\d{1,2})\s*(?:[-–—]|to)?\s*(\d{1,2})?\s*$/.exec(String(text || ""));
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  if (lo < 1 || hi > 20 || hi < lo) return null;
  return { lo, hi };
}

export function hasActionTable(npc) {
  return (npc?.actions || []).some((a) => parseRollRange(a.roll));
}

export function actionForRoll(npc, d20) {
  return (npc?.actions || []).find((a) => {
    const r = parseRollRange(a.roll);
    return r && d20 >= r.lo && d20 <= r.hi;
  }) || null;
}

// The house rule the table may switch on: the 1.5 reading of Chapter 4's "Menacing", Threat
// added when the NPC enters the scene, on top of the printed Threatening.
export const ARRIVAL_HOUSE_RULE = {
  label: "House rule: Threat on arrival",
  note: "Not in the book. Chapter 4 says Menacing NPCs \"generate Threat simply by turning up\" and points to Chapter 5, which prints Threatening (+1 Threat at each of its actions) instead. Switched on, a stat block's Arrival Threat is added when it is revealed, as 1.5 did.",
};

// -------------------------------------------------------------
// NPC stat blocks
// -------------------------------------------------------------
// The SHAPE follows the community Foundry VTT system for Dreams and Machines (built with
// Modiphius's consent), which models the two kinds the book uses:
//
//   NORMAL  a Truth that describes it, an attribute/skill pair for things that Truth is
//           good at, and a default pair for everything else. Its weapons, actions and
//           special abilities are text.
//   MAJOR   the four attributes and seven skills a character has, Truths, how many
//           Injuries defeat it, a Personal Threat pool, and actions with a roll range.
//
// `menacing` (1.5) is now ARRIVAL Threat, used only under the house rule above. Chapter 5
// has no Menacing; it has Threatening, and a 1.5 stat block with Menacing set is given
// the Threatening ability on the way out of storage so it behaves as printed.
export const NPC_KINDS = ["normal", "major"];
export const NPC_ATTRS = ["might", "quickness", "insight", "resolve"];
export const NPC_SKILLS = ["fight", "move", "operate", "sneak", "study", "survive", "talk"];
export const MAX_ROSTER = 120;
const MAX_LIST = 12;
const TEXT_MAX = 400;

function cleanPairs(list, fields) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x === "object")
    .slice(0, MAX_LIST)
    .map((x) => {
      const out = {};
      for (const [k, max] of fields) out[k] = cleanName(x[k], max);
      return out;
    })
    .filter((x) => Object.values(x).some(Boolean));
}

// Every field clamped, every list capped. A roster arrives from localStorage or from an
// imported file someone sent the GM, and the panel renders it with loops — so this runs
// on the way OUT of storage and on the way IN from an import.
export function normalizeNpc(raw) {
  const n = raw && typeof raw === "object" ? raw : {};
  const kind = n.kind === "major" ? "major" : "normal";
  const pair = (p, a, s) => ({
    attr: clampInt(p && p.attr, 0, 20) || a,
    skill: clampInt(p && p.skill, 0, 6),
  });
  const attrs = {};
  const skills = {};
  for (const a of NPC_ATTRS) attrs[a] = clampInt(n.attrs && n.attrs[a], 0, 20) || 8;
  for (const s of NPC_SKILLS) skills[s] = clampInt(n.skills && n.skills[s], 0, 6);
  const out = {
    id: cleanName(n.id, 40) || newNpcId(),
    kind,
    name: cleanName(n.name, 32) || "Unnamed adversary",
    source: cleanName(n.source, 60),
    sample: n.sample === true,
    truth: cleanName(n.truth, 60),
    truths: (Array.isArray(n.truths) ? n.truths : []).slice(0, MAX_LIST).map((t) => cleanName(t, 60)).filter(Boolean),
    main: pair(n.main, 10, 2),
    fallback: pair(n.fallback, 8, 1),
    attrs,
    skills,
    defeat: clampInt(n.defeat, 0, 12),
    personalThreat: clampInt(n.personalThreat, 0, 20),
    menacing: clampInt(n.menacing, 0, 6),
    protection: clampInt(n.protection, 0, 10),
    rangedProtection: clampInt(n.rangedProtection, 0, 10),
    // Damage holds the Injury and its rating: "Plasma Burn 3" is 13 characters, and a cap of
    // 10 (1.5) cut it to "Plasma Bur" and lost the number Avoid the Injury reads.
    weapons: cleanPairs(n.weapons, [["name", 40], ["range", 12], ["damage", 24], ["qualities", 80]]),
    actions: cleanPairs(n.actions, [["name", 40], ["roll", 10], ["text", TEXT_MAX]]),
    abilities: cleanPairs(n.abilities, [["name", 40], ["text", TEXT_MAX]]),
    notes: String(n.notes == null ? "" : n.notes).slice(0, TEXT_MAX * 2),
  };
  // Menacing is Threatening (decided 1.6). Added once, never twice, and only while the
  // list has room.
  if (out.menacing > 0 && !out.abilities.some((a) => abilityKey(a.name) === "threatening") && out.abilities.length < MAX_LIST) {
    out.abilities.push({ name: "Threatening", text: abilityByKey("threatening").quote });
  }
  return out;
}

export function normalizeRoster(list) {
  const seen = new Set();
  const out = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, MAX_ROSTER)) {
    const npc = normalizeNpc(raw);
    if (seen.has(npc.id)) continue;
    seen.add(npc.id);
    out.push(npc);
  }
  return out;
}

export function newNpcId() {
  return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// What the roller fills in when the GM rolls for an NPC. A Normal NPC has no per-
// attribute values — it has its Truth pair and its default pair, and which one applies
// is the GM's call — so `mode` picks. A Major NPC answers like a character.
export function npcRollValues(npc, { attr, skill, mode } = {}) {
  const n = normalizeNpc(npc);
  if (n.kind === "major") {
    return {
      attr: n.attrs[attr] ?? 8,
      skill: n.skills[skill] ?? 0,
    };
  }
  const p = mode === "default" ? n.fallback : n.main;
  return { attr: p.attr, skill: p.skill };
}

// What goes ON THE TOKEN. Only an opaque id: token metadata is readable by every client
// in the room, hidden tokens included, so a name or a stat block written there is public
// whatever the map draws. The roster that turns the id into an adversary lives in the
// GM's browser, the same split the hidden initiative names use.
export function npcTokenRef(npc) {
  return { v: 1, id: cleanName(npc && npc.id, 40) };
}

export function readNpcTokenRef(meta) {
  if (!meta || typeof meta !== "object") return null;
  const id = cleanName(meta.id, 40);
  return id ? { id } : null;
}

// A token to put on the map for an NPC (1.6). The vendored SDK carries no item builders,
// so this is the object `buildImage(...).build()` makes in @owlbear-rodeo/sdk 3.1.0
// (ImageBuilder over GenericItemBuilder), field for field, with our choices on top:
//   - the CHARACTER layer, one grid square (a 300px image at 300 dpi)
//   - HIDDEN: it lands where only the GM sees it, the same rule as a hidden initiative
//     row, and the GM shows it when the table should
//   - named "NPC", never the adversary's name, and the metadata is the opaque id only
//     (npcTokenRef). Everything on an item is readable by every client in the room.
export const NPC_TOKEN_SIZE = 300;
export function buildNpcTokenItem({ url, playerId, position, id, now = Date.now() }) {
  const pid = String(playerId || "");
  return {
    createdUserId: pid,
    id: String(id),
    name: "NPC",
    zIndex: now,
    lastModified: new Date(now).toISOString(),
    lastModifiedUserId: pid,
    locked: false,
    metadata: {},
    position: { x: Number(position?.x) || 0, y: Number(position?.y) || 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    type: "IMAGE",
    visible: false,
    layer: "CHARACTER",
    image: { width: NPC_TOKEN_SIZE, height: NPC_TOKEN_SIZE, url: String(url), mime: "image/svg+xml" },
    // An image's own dpi is its pixels per grid square, whatever the scene's grid is.
    grid: { dpi: NPC_TOKEN_SIZE, offset: { x: NPC_TOKEN_SIZE / 2, y: NPC_TOKEN_SIZE / 2 } },
    text: {
      richText: [{ type: "paragraph", children: [{ text: "" }] }],
      plainText: "",
      style: { padding: 8, fontFamily: "Roboto", fontSize: 24, fontWeight: 400, textAlign: "CENTER", textAlignVertical: "BOTTOM", fillColor: "white", fillOpacity: 1, strokeColor: "white", strokeOpacity: 1, strokeWidth: 0, lineHeight: 1.5 },
      type: "PLAIN",
      width: "AUTO",
      height: "AUTO",
    },
    textItemType: "LABEL",
  };
}

// The export file. Plain JSON under a header line, so it reads in a text editor and
// pastes back through Import.
export const ROSTER_FILE_HEADER = "Dreams & Machines — NPC roster";

export function rosterToText(list) {
  return `${ROSTER_FILE_HEADER}\n${JSON.stringify(normalizeRoster(list).filter((n) => !n.sample), null, 1)}`;
}

export function rosterFromText(text) {
  const raw = String(text || "");
  const at = raw.indexOf("[");
  if (at < 0) return { error: "That does not look like an NPC roster." };
  try {
    const parsed = JSON.parse(raw.slice(at));
    if (!Array.isArray(parsed)) return { error: "That does not look like an NPC roster." };
    // Imported NPCs keep their ids, so importing the same file twice updates rather
    // than doubling. A sample flag in a file is ignored: samples ship with the panel.
    return { npcs: normalizeRoster(parsed).map((n) => ({ ...n, sample: false })) };
  } catch (err) {
    return { error: "That roster file is damaged and could not be read." };
  }
}

// -------------------------------------------------------------
// Sample adversaries
// -------------------------------------------------------------
// PLACEHOLDERS, and marked as such in the panel. The official stat blocks are in the
// Gamemaster's Guide, Chapter 5, and in the free Quickstart PDF; neither is published on
// the open web in a form that could be copied here. These are generic, setting-neutral
// opponents built in the book's stat block SHAPE with plausible numbers, so the panel
// has something to show and test against. Replace them with the book's when it is to
// hand: a custom stat block with the same name sits alongside, and a sample can be
// deleted like any other.
export const SAMPLE_NPCS = normalizeRoster([
  {
    id: "sample-raider", kind: "normal", sample: true, name: "Raider",
    source: "Sample — not from the book",
    truth: "Desperate scavenger with a blade",
    main: { attr: 10, skill: 2 }, fallback: { attr: 7, skill: 1 },
    weapons: [{ name: "Scrap blade", range: "Melee", damage: "Bleeding 2", qualities: "" }],
    actions: [{ name: "Retreat", roll: "", text: "Breaks and runs when the fight turns. Takes no further part in the scene; add 1 to Threat." }],
  },
  {
    id: "sample-drone", kind: "normal", sample: true, name: "Sentry drone",
    source: "Sample — not from the book",
    truth: "Hovering pre-War security machine",
    main: { attr: 11, skill: 3 }, fallback: { attr: 7, skill: 1 },
    protection: 1,
    weapons: [{ name: "Stun emitter", range: "Ranged", damage: "Shocked 2", qualities: "" }],
    actions: [{ name: "Hunt", roll: "", text: "Sweeps the area. Difficulty 0 Insight (Study) Test; every success becomes Threat." }],
    abilities: [{ name: "Armored", text: "Protection 1 (reduced to 0 vs Breaker attacks)." }],
  },
  {
    id: "sample-beast", kind: "normal", sample: true, name: "Feral hound",
    source: "Sample — not from the book",
    truth: "Pack hunter of the ruins",
    main: { attr: 10, skill: 2 }, fallback: { attr: 7, skill: 1 },
    weapons: [{ name: "Bite", range: "Melee", damage: "Ripped 2", qualities: "" }],
    actions: [{ name: "Pounce", roll: "", text: "When it moves to an enemy and makes a melee attack, spend 1 Threat: on a hit the target gains a knocked prone Truth." }],
  },
  {
    id: "sample-captain", kind: "major", sample: true, name: "Raider captain",
    source: "Sample — not from the book",
    truths: ["Scarred veteran of a dozen raids", "Commands by fear"],
    attrs: { might: 11, quickness: 9, insight: 9, resolve: 10 },
    skills: { fight: 3, move: 2, operate: 1, sneak: 1, study: 1, survive: 2, talk: 2 },
    defeat: 3, personalThreat: 4, protection: 1,
    weapons: [
      { name: "Heavy cleaver", range: "Melee", damage: "Impaled 3", qualities: "Breaker" },
      { name: "Salvaged rifle", range: "Ranged", damage: "Bleeding 2", qualities: "" },
    ],
    actions: [
      { name: "Cleave", roll: "1-6", text: "Wades in and attacks the nearest character with the heavy cleaver. Might (Fight): 11 (3)." },
      { name: "Bark orders", roll: "7-12", text: "One Raider in the scene may take an extra action straight away." },
      { name: "Covering fire", roll: "13-16", text: "Fires the rifle at an enemy it can see. Quickness (Fight): 9 (3)." },
      { name: "Rally", roll: "17-20", text: "Spend 2 Threat: every Raider defeated this round gets back up with one Injury fewer." },
    ],
    abilities: [
      { name: "Armored", text: "Protection 1 (reduced to 0 vs Breaker attacks)." },
      { name: "Threatening", text: "Adds +1 to Threat each time it takes an action." },
    ],
  },
]);

// -------------------------------------------------------------
// The cheat sheet: reference only, nothing to press
// -------------------------------------------------------------
export const REFERENCE = [
  { title: "What a Truth can do", page: 103,
    quote: "TRUTHS CAN: Make an activity easier (-1 Difficulty on a Skill Test). Make an activity harder (+1 Difficulty on a Skill Test, or require a Skill Test where success would normally be automatic). Make an activity possible where it wouldn’t normally be. Make an activity impossible where it would normally be possible." },
  { title: "Stacked Truths", page: 104,
    quote: "Especially potent Truths may be stacked: this is indicated by a number after the Truth’s name. A dense smoke 2 Truth will have twice as much effect on the situation as an ordinary Truth, perhaps increasing Difficulties by 2, or having two different effects." },
  { title: "Because X, Y", page: 104,
    quote: "Because I am [Character Truth], this activity is… Because of [Situation or Location Truth], this activity is… Because I have [Equipment Truth], this activity is… The end of each of those statements is one of “easier”, “harder”, “possible”, or “impossible”." },
  { title: "Change Difficulty before dice are bought", page: 105,
    quote: "Regardless of how they are used, changing Difficulty by spending Momentum or Threat must be done before the decision to buy bonus d20s for that Test is made: it would be decidedly unfair to see if a player wants to buy any dice before choosing to change the Difficulty." },
  { title: "Risks, costs and consequences", page: 105,
    quote: "A risk is something that might happen because of a Skill Test. … A cost is something that must be paid or faced to get a desired outcome, but which can be avoided. … A consequence is something that will happen because of action; it might be the result of a failed test, or it might come automatically if the Test is even attempted." },
  { title: "Price and Injury", page: 105,
    quote: "Price: A straightforward problem is a price, usually in the form of lost resources. … Injury: Equally straightforward, suffering damage and risking Injury is useful as a risk, cost, or consequence." },
  { title: "Revelation, Confusion, Waste", page: 106,
    quote: "Revelation: The character reveals something that they didn’t intend to, such as something they know, or even where they are. … Confusion: The character miscommunicates or otherwise creates uncertainty, leading to upset, poor timing, offense, or misunderstanding. … Waste: Like price, but where a price is intentional, waste is the misuse or misapplication of resources." },
  { title: "Ineffectiveness, Overkill, Delay, Closed Path", page: 106,
    quote: "Ineffectiveness: The effect of the Skill Test is less than expected in some way, or the character’s success is only partial or incomplete. … Overkill: The character succeeds too well. … Delay: Sometimes, things just take longer than anticipated. … Closed Path: A possible problem is that a specific way of doing something is no longer possible, at least in the short term, and the characters will have to find a different approach." },
  { title: "A problem in Threat", page: 106,
    quote: "Complications have two universal outcomes — create a Truth or add 2 to Threat — which means that they are useful for quantifying a problem. If a problem is equivalent to two complications, then it’s equal to 4 Threat, for example." },
  { title: "Status gauge", page: 111,
    quote: "The overall quantity of Threat can be used as a gauge for the situation currently playing out. … Higher Threat means adversaries will be alert, wary, and quick to respond, while bystanders may withdraw from the area or hide if startled." },
  { title: "Proportionate resistance", page: 110,
    quote: "If the players give Threat freely, then the GM should use Threat eagerly and often: using Threat roughly as often as the players generate it is a good benchmark." },
  { title: "Desperation", page: 121,
    quote: "Desperation: A player character can buy back some Spirit by adding to Threat. … Characters with rivalry bonds particularly benefit from this option: a character gains 1 Spirit each time their rival buys Spirit by adding to Threat. … When players use this option, it’s advisable not to spend the Threat gained too quickly, as it may feel like the players are being punished." },
  { title: "Every Hazard comes from a Truth", page: 116,
    quote: "Such Truths may be part of a scene from the start (in which case, there's no need to spend Threat to create them), or they may be something that changes or is revealed during the scene (in which case, spend 2 Threat to add the Truth to the scene)." },
];

export function cite(page) {
  return `${GM_GUIDE} p.${page}`;
}
