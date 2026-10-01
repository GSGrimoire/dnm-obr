// =============================================================
// GM Tools, popped out (1.5)
// -------------------------------------------------------------
// The same panel the roller draws, in its own popover. This file is only the frame: it
// builds a host for gmpanel.js out of the SDK, and the dock controls the character sheet
// has — the position pad, zoom and edge resize — for the GM panel's own popover.
//
// The dock code follows the creator's buildDockControls() and its resize handlers. It
// could not be imported from there: the creator is a separate page with its SDK inlined.
// The geometry it drives is not copied — it is dnm.js's sheetPopover(), reused through
// gmPopover() — so what could drift is only the wiring, and the wiring is short.
// =============================================================

import OBR from "./sdk.js";
import {
  ROOM_KEY, CHANNEL, EMPTY_STATE, ID, DOCK_ANCHORS, GM_POPOVER_ID,
  readGmDock, writeGmDock, gmPopover, gmPanelUrl, resizeEdges, withDockSize, dockSizeFor,
} from "./dnm.js";
import { mountGmPanel, markPopped, safeStorage } from "./gmpanel.js";

let state = structuredClone(EMPTY_STATE);
let role = "PLAYER";
let playerName = "GM";
let panel = null;

const el = (id) => document.getElementById(id);
const setStatus = (msg) => { const s = el("status"); if (s) s.textContent = msg || ""; };

const host = {
  state: () => state,
  room: () => { try { return OBR.room.id; } catch (err) { return "unknown"; } },
  playerName: () => playerName,
  announce: async (ev) => {
    try {
      await OBR.broadcast.sendMessage(CHANNEL, ev, { destination: "ALL" });
    } catch (err) {
      setStatus("Could not reach the room. The others may not have seen that.");
      console.error("[dnm] broadcast failed", err);
    }
  },
  items: () => OBR.scene.items.getItems(),
  itemsById: (ids) => OBR.scene.items.getItems(ids),
  selection: () => OBR.player.getSelection(),
  updateItems: (ids, fn) => OBR.scene.items.updateItems(ids, fn),
  status: setStatus,
  changed: () => { if (panel) panel.refresh(); },
};

// -------------------------------------------------------------
// The dock
// -------------------------------------------------------------
const storage = safeStorage();

function applyZoom(zoom) {
  const app = el("app");
  if (app) app.style.zoom = String(zoom);
  const readout = el("gm-zoom-readout");
  if (readout) readout.textContent = `${Math.round(zoom * 100)}%`;
}

async function viewport() {
  try {
    const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    return { width, height };
  } catch (err) {
    return null;
  }
}

// Moving costs a close and a reopen, which reloads this page. Nothing here is unsaved —
// every control writes to storage as it changes — so there is nothing to flush first.
async function redock(anchor) {
  const next = writeGmDock(storage, { ...readGmDock(storage), anchor });
  try {
    const v = await viewport();
    await OBR.popover.close(GM_POPOVER_ID);
    await OBR.popover.open(gmPopover({ url: gmPanelUrl(), dock: next, viewport: v }));
  } catch (err) {
    console.error("[dnm] could not move the GM panel", err);
  }
}

function buildDock() {
  const wrap = el("gm-dock");
  wrap.textContent = "";
  const dock = readGmDock(storage);
  const pad = document.createElement("div");
  pad.className = "obr-pad";
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", "Where the GM panel sits");
  for (const anchor of DOCK_ANCHORS) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "obr-pad-cell";
    cell.title = `Move the GM panel to ${anchor.replace("-", " ")}`;
    cell.setAttribute("aria-label", cell.title);
    const here = anchor === dock.anchor;
    cell.setAttribute("aria-pressed", here ? "true" : "false");
    if (here) cell.disabled = true;
    else cell.addEventListener("click", () => redock(anchor));
    pad.append(cell);
  }
  const zoomBtn = (label, title, delta) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "obr-dock-btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", () => {
      const cur = readGmDock(storage);
      applyZoom(writeGmDock(storage, { ...cur, zoom: cur.zoom + delta }).zoom);
    });
    return b;
  };
  const readout = document.createElement("span");
  readout.className = "obr-zoom-readout";
  readout.id = "gm-zoom-readout";
  const zoom = document.createElement("div");
  zoom.className = "obr-zoomgroup";
  zoom.append(zoomBtn("−", "Zoom out", -0.1), readout, zoomBtn("+", "Zoom in", 0.1));
  wrap.append(pad, zoom);
  applyZoom(dock.zoom);
  buildResizeHandles(dock.anchor);
}

let drag = null;

function buildResizeHandles(anchor) {
  for (const old of document.querySelectorAll(".obr-resize")) old.remove();
  const edges = resizeEdges(anchor);
  const corners = [];
  for (const v of ["n", "s"]) for (const hh of ["w", "e"]) if (edges.includes(v) && edges.includes(hh)) corners.push(v + hh);
  for (const dir of edges.concat(corners)) {
    const handle = document.createElement("div");
    handle.className = `obr-resize obr-resize-${dir}`;
    handle.dataset.dir = dir;
    handle.addEventListener("pointerdown", startResize);
    document.body.append(handle);
  }
}

function startResize(ev) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  // The real size, not the stored one: a stored 4000 means "fill this axis".
  drag = { dir: ev.currentTarget.dataset.dir || "", x: ev.clientX, y: ev.clientY,
    startWidth: window.innerWidth, startHeight: window.innerHeight, pending: null, frame: 0 };
  try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (err) { /* older browser */ }
  document.body.classList.add("obr-resizing");
  window.addEventListener("pointermove", moveResize);
  window.addEventListener("pointerup", endResize);
  window.addEventListener("pointercancel", endResize);
}

function moveResize(ev) {
  if (!drag) return;
  let width = drag.startWidth;
  let height = drag.startHeight;
  if (drag.dir.includes("w")) width = drag.startWidth - (ev.clientX - drag.x);
  if (drag.dir.includes("e")) width = drag.startWidth + (ev.clientX - drag.x);
  if (drag.dir.includes("n")) height = drag.startHeight - (ev.clientY - drag.y);
  if (drag.dir.includes("s")) height = drag.startHeight + (ev.clientY - drag.y);
  drag.pending = { width, height };
  if (drag.frame) return;
  drag.frame = requestAnimationFrame(() => {
    if (!drag) return;
    drag.frame = 0;
    if (drag.pending) flushResize(drag.pending);
  });
}

function flushResize({ width, height }) {
  const cur = readGmDock(storage);
  const next = writeGmDock(storage, withDockSize(cur, cur.anchor, { width, height }));
  const size = dockSizeFor(next, next.anchor);
  Promise.all([
    OBR.popover.setWidth(GM_POPOVER_ID, size.width),
    OBR.popover.setHeight(GM_POPOVER_ID, size.height),
  ]).catch((err) => console.error("[dnm] could not resize the GM panel", err));
}

function endResize() {
  if (!drag) return;
  if (drag.frame) cancelAnimationFrame(drag.frame);
  const pending = drag.pending;
  drag = null;
  document.body.classList.remove("obr-resizing");
  window.removeEventListener("pointermove", moveResize);
  window.removeEventListener("pointerup", endResize);
  window.removeEventListener("pointercancel", endResize);
  if (pending) flushResize(pending);
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
let heartbeat = null;

function applyRole() {
  const gm = role === "GM";
  el("gm-only").hidden = gm;
  el("gm-tools").hidden = !gm;
  if (gm && !panel) panel = mountGmPanel(el("gm-tools"), host, { mode: "popover" });
}

async function start() {
  role = await OBR.player.getRole();
  playerName = (await OBR.player.getName()) || "GM";
  const meta = await OBR.room.getMetadata();
  state = meta[ROOM_KEY] ? { ...structuredClone(EMPTY_STATE), ...meta[ROOM_KEY] } : structuredClone(EMPTY_STATE);
  buildDock();
  applyRole();

  // The roller reads this to know the panel is out here rather than in it. A heartbeat,
  // not a flag, so a room reload — which closes every popover — cannot leave the roller
  // pointing at a panel that is gone.
  markPopped(true);
  heartbeat = setInterval(() => markPopped(true), 2000);

  el("gm-close").addEventListener("click", async () => {
    clearInterval(heartbeat);
    markPopped(false);
    try { await OBR.popover.close(GM_POPOVER_ID); } catch (err) { /* already closed */ }
  });

  OBR.room.onMetadataChange((m) => {
    state = m[ROOM_KEY] ? { ...structuredClone(EMPTY_STATE), ...m[ROOM_KEY] } : structuredClone(EMPTY_STATE);
    if (panel) panel.refresh();
  });
  OBR.player.onChange((p) => { role = p.role; playerName = p.name || playerName; applyRole(); });
  OBR.scene.items.onChange(() => { if (panel) panel.sceneChanged(); });

  // The roller and this page share an origin and therefore localStorage. A change made
  // in the roller — a ticker, a roster entry, a fight row — arrives here as a storage
  // event, which is what keeps the two views level.
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith(ID) && panel) panel.refresh();
  });
}

if (OBR.isAvailable) {
  OBR.onReady(start);
} else {
  // Opened directly: nothing to drive. Said plainly rather than drawing a dead panel.
  el("gm-only").hidden = false;
  el("gm-only").textContent = "Open this from the GM tools in the D&M roller inside Owlbear.";
  el("gm-bar").hidden = true;
}
