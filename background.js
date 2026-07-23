// =============================================================
// Background page
// -------------------------------------------------------------
// The action popover only runs while it is open, so context menu items
// cannot be registered from it. Owlbear loads this page for the lifetime of
// the room instead, which is where the menu registration belongs.
// =============================================================

import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";
import { ID, CHAR_KEY } from "./dnm.js";

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
      OBR.modal.open({
        id: `${ID}/sheet-modal`,
        url: `${BASE}sheet.html?item=${encodeURIComponent(item.id)}`,
        fullScreen: true,
      });
    },
  });
}

OBR.onReady(setupContextMenu);
