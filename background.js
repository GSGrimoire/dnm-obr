// =============================================================
// Background page
// -------------------------------------------------------------
// The action popover only runs while it is open, so context menu items cannot
// be registered from it. Owlbear loads this page for the lifetime of the room
// instead, which is where the menu registration belongs.
//
// v0.7.0: this file is the former background-beta.js, promoted. The beta
// approach — the sheet opens the published character creator rather than a
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
  openSheetPopover } from "./dnm.js";

const BASE = new URL(".", import.meta.url).href;

// localStorage throws outright in a frame whose cookies are blocked, rather than
// returning null, so every read of it goes through this. No dock preference simply
// means the default one.
function safeStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

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
      // 1.0: a docked popover rather than a centred modal, so the map and the log stay
      // visible and clickable beside the sheet instead of behind it. The side and size
      // come from localStorage, which the sheet writes when you press a dock button, so
      // this opens where you left the last one. See the note in dnm.js.
      openSheetPopover(OBR, item.id, safeStorage()).catch((err) => {
        console.error("[dnm] could not open the sheet", err);
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

OBR.onReady(async () => {
  setupContextMenu();
  await setRelay(await OBR.player.getRole());
  // The role can change mid-session if the room owner promotes someone.
  OBR.player.onChange((player) => { setRelay(player.role); });
  // And the set of GMs changes when anyone joins, leaves, or is promoted.
  OBR.party.onChange(() => { refreshGmConnections(); });
});
