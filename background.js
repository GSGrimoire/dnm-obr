// =============================================================
// Background page
// -------------------------------------------------------------
// The action popover only runs while it is open, so context menu items
// cannot be registered from it. Owlbear loads this page for the lifetime of
// the room instead, which is where the menu registration belongs.
// =============================================================

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { ID, CHAR_KEY, CHANNEL, ROOM_KEY, EMPTY_STATE, applyEvent, trimState } from "./dnm.js";

const BASE = new URL(".", import.meta.url).href;

function setupContextMenu() {
  OBR.contextMenu.create({
    id: `${ID}/sheet`,
    icons: [
      {
        // No character yet: the sheet page opens on its import screen.
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
        url: `${BASE}sheet.html?item=${encodeURIComponent(item.id)}`,
        width: 1200,
        height: 900,
      });
    },
  });
}

// -------------------------------------------------------------
// Shared state writer
// -------------------------------------------------------------
// Only the GM writes room metadata. This page runs for as long as the GM is in
// the room, panel open or not, so a player's roll is still persisted even when
// the GM has the roller closed.
//
// Writes are serialised through a promise chain rather than fired in parallel,
// because two rolls landing in the same instant would otherwise both read the
// same state and one would overwrite the other.
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
