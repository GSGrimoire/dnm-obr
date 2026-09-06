// =============================================================
// Background page
// -------------------------------------------------------------
// The action popover only runs while it is open, so context menu items cannot
// be registered from it. Owlbear loads this page for the lifetime of the room
// instead, which is where the menu registration belongs.
//
// v0.7.0: this file is the former background-beta.js, promoted. The beta
// approach — the modal opens the published character creator rather than a
// second sheet implementation in this repo — is now the only approach, so the
// "-beta" id suffixes and the "(beta)" menu labels are gone.
//
// The old background.js opened `${BASE}sheet.html`, which no longer exists.
// sheet.html, sheet.js, sheet.css, rules.js and build-rules.mjs were the
// duplicate-sheet approach and were deleted once the unified creator was
// confirmed working in play. Nothing should reintroduce a local sheet page.
// =============================================================

import OBR from "./sdk.js";
import { ID, CHAR_KEY, CHANNEL, ROOM_KEY, EMPTY_STATE, applyEvent, trimState, isGmOnlyEvent,
  POPOUT_CHANNEL, POPOUT_PROTOCOL, EXT_VERSION } from "./dnm.js";

const BASE = new URL(".", import.meta.url).href;

// The directory URL, not a filename. dnm-cc publishes the creator as index.html,
// so pointing at dnm-character-creator.html 404s — and hardcoding any filename
// makes this break again the day the file is renamed. The folder root always
// resolves to whatever index.html is there.
//
// From creator v1.14 the creator is a single file that renders itself
// differently depending on whether it is framed, so this is the normal
// published URL rather than a separate embed copy.
const SHEET_URL = "https://gsgrimoire.github.io/dnm-cc/";

function setupContextMenu() {
  OBR.contextMenu.create({
    id: `${ID}/sheet`,
    icons: [
      {
        // No character yet: the creator opens on its import screen.
        icon: `${BASE}icon-attach.svg`,
        label: "Attach D&M character",
        filter: {
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", CHAR_KEY], value: undefined },
          ],
          max: 1,
        },
      },
      {
        icon: `${BASE}icon-sheet.svg`,
        label: "Open D&M sheet",
        filter: {
          every: [{ key: "layer", value: "CHARACTER" }],
          max: 1,
        },
      },
    ],
    onClick(context) {
      const item = context.items[0];
      if (!item) return;
      // Windowed rather than full screen so the map stays visible behind it.
      // Owlbear modals are centred and fixed; the API exposes size but no
      // position or drag, so this is as close to a movable window as we get.
      OBR.modal.open({
        id: `${ID}/sheet-modal`,
        url: `${SHEET_URL}?item=${encodeURIComponent(item.id)}`,
        // Taller than the old local sheet: the creator's play view is a long
        // vertical document rather than a fitted dashboard.
        width: 1280,
        height: 940,
      });
    },
  });
}

// -------------------------------------------------------------
// Shared state writer
// -------------------------------------------------------------
// Only the GM writes room metadata. This page runs for as long as the GM is in
// the room, panel open or not, so a player's roll is still persisted even when
// the GM has the roller closed. This is also what makes player writes work at
// all: players broadcast, the GM's background page writes.
//
// Since creator v1.17 this relays action events as well as rolls and pool
// changes. No change was needed here — persist() is event-shape agnostic and
// hands everything to applyEvent(), which is the single place that knows what
// each event type means.
//
// Writes are serialised through a promise chain rather than fired in parallel,
// because two events landing in the same instant would otherwise both read the
// same state and one would overwrite the other. This matters more now than it
// did: an ability that spends Momentum and adds Threat emits several events
// back to back.
let writeChain = Promise.resolve();

function persist(ev) {
  writeChain = writeChain
    .then(async () => {
      const meta = await OBR.room.getMetadata();
      const current = meta[ROOM_KEY] || EMPTY_STATE;
      const next = trimState(applyEvent(current, ev));
      await OBR.room.setMetadata({ [ROOM_KEY]: next });
    })
    .catch((err) => console.error("[dnm] persist failed", err));
  return writeChain;
}

// -------------------------------------------------------------
// Who is allowed to ask for what (0.9.1)
// -------------------------------------------------------------
// Three event types move state the interface reserves for the GM: a boundary or rest
// pushed to the whole table, clearing the shared log, and Threat.
//
// Each sender already checks the role before broadcasting — `pushEpoch()`,
// `clearLog()` and `stepPool()` all do. None of those checks is a control. They run
// in the sender's own tab, on code the sender can edit or simply bypass by calling
// OBR.broadcast directly from the console, and the channel is open to every client
// in the room by design. The checks stop accidents, which is worth having, and stop
// nothing else.
//
// This page is the only writer of room metadata, which makes it the only place a
// real check can live. What made the gap matter is the epoch mechanism: a forged
// `bed` reaches EVERY attached character, applies to players who were not even
// online, and has no undo. A forged `clear` destroys the shared log permanently.
//
// The sender-side checks stay where they are. This is the one that counts.
//
// Which events those are is decided by isGmOnlyEvent() in dnm.js, so the rule can be
// tested without a live room. 0.9.2 corrected it: Threat is GM-only downwards only,
// because paying Threat IN is a player action the rules require.

// Connection ids, not player ids: a broadcast identifies its sender by connection.
let gmConnections = new Set();

async function refreshGmConnections() {
  try {
    const [players, self] = await Promise.all([
      OBR.party.getPlayers(),
      OBR.player.getConnectionId(),
    ]);
    const next = new Set(
      players.filter((p) => p.role === "GM").map((p) => p.connectionId),
    );
    // getPlayers() lists everyone else in the room, never this client. This page only
    // relays while this client is the GM, so its own connection belongs in the set —
    // without it the GM's own presses would be the first thing refused.
    if (self) next.add(self);
    gmConnections = next;
  } catch (err) {
    // Deliberately keeps the previous set rather than clearing it. Clearing on a
    // transient failure would refuse the GM's own controls until the next party
    // change, which reads at the table as the buttons having stopped working.
    console.error("[dnm] could not read the party; keeping the last known GMs", err);
  }
}

// player.onChange fires on any player change, including selection, so the
// subscription is guarded rather than re-registered each time.
let unsubscribeRelay = null;

function relay(event) {
  if (isGmOnlyEvent(event.data) && !gmConnections.has(event.connectionId)) {
    console.warn(
      "[dnm] refused a GM-only event from a non-GM connection:",
      event.data && event.data.type,
    );
    return;
  }
  persist(event.data);
}

async function setRelay(role) {
  const shouldRelay = role === "GM";
  if (shouldRelay && !unsubscribeRelay) {
    // Populated BEFORE subscribing. An empty set refuses everything privileged,
    // which is the safe direction to fail, but it would also refuse the GM.
    await refreshGmConnections();
    unsubscribeRelay = OBR.broadcast.onMessage(CHANNEL, relay);
  } else if (!shouldRelay && unsubscribeRelay) {
    unsubscribeRelay();
    unsubscribeRelay = null;
  }
}

// -------------------------------------------------------------
// The popout relay host (0.9.9)
// -------------------------------------------------------------
// A character sheet opened in its own browser window has no route to Owlbear — see the
// note on POPOUT_CHANNEL in dnm.js for why. This page is that route: it holds a working
// SDK, it lives for the whole room session, and it is same-origin with the creator, so
// a BroadcastChannel reaches it.
//
// The surface is deliberately NARROW rather than a general proxy of the SDK. Two
// reasons. A generic proxy would have to ship functions across the channel — the
// creator's token write is `scene.items.updateItems(ids, mutator)` and a mutator cannot
// be structured-cloned — and a narrow surface is a contract you can read in one screen
// and test without a live room. Everything the sheet actually needs is below.
//
// This is NOT a privilege boundary and must not be mistaken for one. A popout is the
// same person's own browser; anything it asks for here, they could ask for by opening
// the sheet normally. The real check stays where it has always been: relay(), which
// verifies GM-only events against connection ids before anything is written.
let popoutChannel = null;
const popouts = new Map();      // popoutId -> last seen, ms
const POPOUT_IDLE_MS = 60000;   // a window that has not spoken in a minute has gone

function livePopouts() {
  const cutoff = Date.now() - POPOUT_IDLE_MS;
  for (const [id, seen] of popouts) if (seen < cutoff) popouts.delete(id);
  return popouts.size;
}

function toPopouts(message) {
  // Skipped entirely when nobody is listening. scene.items.onChange fires on every drag
  // frame, and posting each one to an empty channel is work for nothing.
  if (!popoutChannel || !livePopouts()) return;
  popoutChannel.postMessage({ ...message, room: OBR.room.id, v: POPOUT_PROTOCOL });
}

async function handlePopoutRequest(msg) {
  switch (msg.op) {
    case "self": {
      const [role, name, id] = await Promise.all([
        OBR.player.getRole(), OBR.player.getName(), OBR.player.getId(),
      ]);
      return { role, name, id, hasGM: await roomHasGM(role) };
    }
    case "metadata":
      return { metadata: await OBR.room.getMetadata() };
    case "tokenCode": {
      const items = await OBR.scene.items.getItems([msg.itemId]);
      const stored = items && items[0] && items[0].metadata && items[0].metadata[CHAR_KEY];
      return { code: stored && stored.code ? stored.code : null };
    }
    case "writeToken":
      await OBR.scene.items.updateItems([msg.itemId], (items) => {
        for (const it of items) it.metadata[CHAR_KEY] = { v: 1, code: msg.code };
      });
      return { ok: true };
    case "clearToken":
      await OBR.scene.items.updateItems([msg.itemId], (items) => {
        for (const it of items) delete it.metadata[CHAR_KEY];
      });
      return { ok: true };
    case "partyCodes": {
      const all = await OBR.scene.items.getItems();
      return {
        codes: all
          .filter((i) => typeof i.metadata?.[CHAR_KEY]?.code === "string" && i.metadata[CHAR_KEY].code)
          .map((i) => ({ id: i.id, code: i.metadata[CHAR_KEY].code })),
      };
    }
    case "broadcast":
      // Fire and forget, exactly as the framed sheet does. It goes out over the normal
      // channel, so the GM's relay() sees it as any other event and applies the same
      // GM-only check — a popout gets no more say than the window it came from.
      await OBR.broadcast.sendMessage(CHANNEL, msg.event, { destination: "ALL" });
      return { ok: true };
    default:
      return { error: `unknown op: ${msg.op}` };
  }
}

// -------------------------------------------------------------
// Is anyone the GM? (0.9.10)
// -------------------------------------------------------------
// Reported from play: in a room with no GM, a player can press + on Momentum, the sheet
// moves, and the pool never does. That is this file working as designed — persist() only
// runs on the GM's client, so with no GM nobody writes room metadata and every pool
// change is dropped on the floor.
//
// It is not worth changing that. The single-writer rule is what stops two clients
// clobbering each other, and a table with no GM is not a table playing. What was wrong
// is that it happened SILENTLY, so the sheet looked broken rather than unattended.
//
// getPlayers() lists everyone EXCEPT this client, which is why the caller's own role has
// to be passed in — without it a lone GM would be told there is no GM.
async function roomHasGM(ownRole) {
  if (ownRole === "GM") return true;
  try {
    const players = await OBR.party.getPlayers();
    return players.some((p) => p.role === "GM");
  } catch (err) {
    // Failing OPEN. A transient party read should not put a warning on every sheet at
    // the table saying the GM has vanished.
    return true;
  }
}

let popoutSubscribed = false;

// Subscribed only once a popout has actually said hello. Every client in the room runs
// this page, and most will never open one.
function subscribePopoutFeeds() {
  if (popoutSubscribed) return;
  popoutSubscribed = true;
  OBR.room.onMetadataChange((metadata) => { toPopouts({ event: "room", metadata }); });
  OBR.player.onChange(async (player) => {
    toPopouts({
      event: "player", role: player.role, name: player.name, id: player.id,
      hasGM: await roomHasGM(player.role),
    });
  });
  // 0.9.10. A room with no GM writes no metadata at all — see the note on roomHasGM —
  // so a popout has to hear about someone's role changing, not only its own.
  OBR.party.onChange(async () => {
    try {
      toPopouts({ event: "party", hasGM: await roomHasGM(await OBR.player.getRole()) });
    } catch (err) { /* the party read raced a disconnect */ }
  });
  let itemsTimer = null;
  OBR.scene.items.onChange(() => {
    // Debounced: this fires on every frame of a drag, and all the popout does with it
    // is re-read a list of names.
    clearTimeout(itemsTimer);
    itemsTimer = setTimeout(() => toPopouts({ event: "items" }), 400);
  });
}

function startPopoutHost() {
  if (typeof BroadcastChannel !== "function") return;   // very old browser
  popoutChannel = new BroadcastChannel(POPOUT_CHANNEL);
  popoutChannel.onmessage = async (ev) => {
    const msg = ev.data;
    if (!msg || msg.dir !== "req") return;
    // Two rooms open in one browser means two hosts on one channel, and without a scope
    // both would answer. But "hello" is answered REGARDLESS (0.9.10): a silent drop here
    // is indistinguishable from an extension that has no relay at all, and that
    // ambiguity cost a QA round. Answering lets the window say which room replied and
    // what version it is running, so a mismatch reports itself.
    if (msg.op !== "hello" && msg.room && msg.room !== OBR.room.id) return;
    if (msg.v !== POPOUT_PROTOCOL) {
      popoutChannel.postMessage({ dir: "res", id: msg.id, v: POPOUT_PROTOCOL, error: "protocol" });
      return;
    }
    popouts.set(msg.from, Date.now());
    if (msg.op === "hello") subscribePopoutFeeds();
    if (msg.op === "bye") { popouts.delete(msg.from); return; }
    let payload;
    try {
      payload = msg.op === "hello" || msg.op === "ping"
        ? { ok: true, room: OBR.room.id, ext: EXT_VERSION }
        : await handlePopoutRequest(msg);
    } catch (err) {
      console.warn("[dnm] popout request failed:", msg.op, err);
      payload = null;
      popoutChannel.postMessage({
        dir: "res", id: msg.id, v: POPOUT_PROTOCOL,
        error: String((err && err.message) || err),
      });
      return;
    }
    // The answer is NESTED rather than spread into the envelope. Spreading it looked
    // tidier and was wrong: the reply to "self" carries the player's `id`, which
    // overwrote the envelope's correlation `id` — so the popout could never match the
    // response to its request and hung on every read. Caught by popout.test.mjs before
    // it ever reached a room, and the reason the envelope's fields are now reserved.
    popoutChannel.postMessage({ dir: "res", id: msg.id, v: POPOUT_PROTOCOL, data: payload });
  };
}

OBR.onReady(async () => {
  setupContextMenu();
  startPopoutHost();
  await setRelay(await OBR.player.getRole());
  // The role can change mid-session if the room owner promotes someone.
  OBR.player.onChange((player) => { setRelay(player.role); });
  // And the set of GMs changes when anyone joins, leaves, or is promoted.
  OBR.party.onChange(() => { refreshGmConnections(); });
});
