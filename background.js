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

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { ID, CHAR_KEY, CHANNEL, ROOM_KEY, EMPTY_STATE, applyEvent, trimState } from "./dnm.js";

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

// player.onChange fires on any player change, including selection, so the
// subscription is guarded rather than re-registered each time.
let unsubscribeRelay = null;

function setRelay(role) {
  const shouldRelay = role === "GM";
  if (shouldRelay && !unsubscribeRelay) {
    unsubscribeRelay = OBR.broadcast.onMessage(CHANNEL, (event) => persist(event.data));
  } else if (!shouldRelay && unsubscribeRelay) {
    unsubscribeRelay();
    unsubscribeRelay = null;
  }
}

OBR.onReady(async () => {
  setupContextMenu();
  setRelay(await OBR.player.getRole());
  // The role can change mid-session if the room owner promotes someone.
  OBR.player.onChange((player) => setRelay(player.role));
});
