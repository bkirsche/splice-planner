// The route sits on a canvas: drag the background (one finger on a
// phone, or hold the middle mouse button) to move around; pinch, the
// scroll wheel or +/- to zoom; "Fit all" to see the whole job. No scrollbars. The small overview in the corner shows where
// you are; tap it to jump.

const routeView = document.getElementById("route-view");
const minimap = document.getElementById("minimap");
const zoomLabel = document.getElementById("zoom-reset");

const ZOOM_MIN = 0.03;
const ZOOM_MAX = 2;
const view = { z: 1, x: 24, y: 24 };

function routeZoom() {
  return view.z;
}

function applyView() {
  tree.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
  scheduleMinimap();
}

// The route's own size, before zooming.
function treeSize() {
  return { w: tree.scrollWidth, h: tree.scrollHeight };
}

// Keep at least a corner of the route on screen.
function clampView() {
  const { w, h } = treeSize();
  const vw = routeView.clientWidth;
  const vh = routeView.clientHeight;
  const keep = 80;
  view.x = Math.min(vw - keep, Math.max(keep - w * view.z, view.x));
  view.y = Math.min(vh - keep, Math.max(keep - h * view.z, view.y));
}

// Zoom keeping the point under (cx, cy) still (view coordinates).
function zoomAt(factor, cx, cy) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.z * factor));
  view.x = cx - ((cx - view.x) * z) / view.z;
  view.y = cy - ((cy - view.y) * z) / view.z;
  view.z = z;
  clampView();
  applyView();
}

function zoomCenter(factor) {
  zoomAt(factor, routeView.clientWidth / 2, routeView.clientHeight / 2);
}

// Adding or removing locations moves cards around inside the route;
// the canvas follows so the card in hand (or the start) stays put. The
// card in hand may be the one just removed, so every card's spot is
// kept and the first one still there lines the view back up.
function rememberAnchor() {
  if (screens.route.hidden) return null;
  const cards = [tree.querySelector(".stop.selected"), tree.querySelector(".stop.start"), ...tree.querySelectorAll(".stop[data-id]")];
  return cards.filter((c) => c && c.dataset.id).map((c) => {
    const r = c.getBoundingClientRect();
    return { id: c.dataset.id, x: r.left, y: r.top };
  });
}

function restoreAnchor(list) {
  for (const a of list || []) {
    const card = tree.querySelector(`.stop[data-id="${CSS.escape(a.id)}"]`);
    if (!card) continue;
    const r = card.getBoundingClientRect();
    view.x += a.x - r.left;
    view.y += a.y - r.top;
    return applyView();
  }
}

function fitAll() {
  const { w, h } = treeSize();
  const vw = routeView.clientWidth;
  const vh = routeView.clientHeight;
  if (!w || !h || !vw || !vh) return;
  view.z = Math.min(1, Math.max(ZOOM_MIN, Math.min((vw - 40) / w, (vh - 40) / h)));
  // A small route sits on the left, where it grows from.
  view.x = view.z === 1 ? 24 : (vw - w * view.z) / 2;
  view.y = (vh - h * view.z) / 2;
  applyView();
}

// Where a new screen opens: the whole route if it's still readable,
// otherwise the start at a comfortable size.
function startView() {
  sizeView();
  fitAll();
  // The area map and area pages are made to fit the screen.
  if (view.z >= 0.6 || areaOn()) return;
  const start = tree.querySelector(".stop.start");
  const pos = start && treePos(start);
  view.z = 0.8;
  if (!pos) return applyView();
  view.x = 24;
  view.y = routeView.clientHeight / 2 - (pos.y + pos.h / 2) * view.z;
  clampView();
  applyView();
}

// An element's box in the route's own units.
function treePos(e) {
  const t = tree.getBoundingClientRect();
  const r = e.getBoundingClientRect();
  return { x: (r.left - t.left) / view.z, y: (r.top - t.top) / view.z, w: r.width / view.z, h: r.height / view.z };
}

// Bring something on the route to the middle of the screen.
function centerOn(e) {
  const pos = treePos(e);
  if (view.z < 0.6) view.z = 0.8;
  view.x = routeView.clientWidth / 2 - (pos.x + pos.w / 2) * view.z;
  view.y = routeView.clientHeight / 2 - (pos.y + pos.h / 2) * view.z;
  clampView();
  applyView();
}

// The canvas fills the window below the top bar.
function sizeView() {
  if (screens.route.hidden) return;
  const top = (routeView.hidden ? routeTable : routeView).getBoundingClientRect().top + window.scrollY;
  const h = Math.max(260, window.innerHeight - top - 12) + "px";
  routeView.style.height = h;
  routeTable.style.maxHeight = h;
}

window.addEventListener("resize", () => {
  sizeView();
  scheduleMinimap();
});

document.getElementById("zoom-in").addEventListener("click", () => zoomCenter(1.25));
document.getElementById("zoom-out").addEventListener("click", () => zoomCenter(0.8));
document.getElementById("zoom-fit").addEventListener("click", fitAll);
zoomLabel.addEventListener("click", () => zoomCenter(1 / view.z));

// --- Dragging and pinching ---
// A drag that starts on a card still moves the canvas; it just doesn't
// count as a tap on the card.

const pointers = new Map();
let gesture = null;
let swallowClick = false;

function isControl(t) {
  return t.closest("input, select, textarea, .zoom-bar, .minimap, .pick-bar");
}

routeView.addEventListener("pointerdown", (e) => {
  if ((e.button !== 0 && e.button !== 1) || isControl(e.target)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  swallowClick = false;
  if (pointers.size === 1) gesture = { kind: "pan", x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y, moved: false, id: e.pointerId, middle: e.button === 1 };
  else if (pointers.size === 2) startPinch();
});

function startPinch() {
  const [a, b] = [...pointers.values()];
  const box = routeView.getBoundingClientRect();
  gesture = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.z, vx: view.x, vy: view.y,
    cx: (a.x + b.x) / 2 - box.left, cy: (a.y + b.y) / 2 - box.top, moved: true };
}

routeView.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.kind === "pan") {
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    if (!gesture.moved) {
      gesture.moved = true;
      routeView.setPointerCapture(e.pointerId);
      routeView.classList.add("panning");
    }
    view.x = gesture.vx + dx;
    view.y = gesture.vy + dy;
    clampView();
    applyView();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const box = routeView.getBoundingClientRect();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2 - box.left;
    const cy = (a.y + b.y) / 2 - box.top;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (gesture.z0 * d) / gesture.d0));
    // Zoom about the starting midpoint, then follow the fingers.
    view.x = gesture.cx - ((gesture.cx - gesture.vx) * z) / gesture.z0 + (cx - gesture.cx);
    view.y = gesture.cy - ((gesture.cy - gesture.vy) * z) / gesture.z0 + (cy - gesture.cy);
    view.z = z;
    clampView();
    applyView();
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  // A middle-button drag makes no click to swallow.
  if (gesture && gesture.moved && !gesture.middle) swallowClick = true;
  if (pointers.size === 1 && gesture && gesture.kind === "pinch") {
    // One finger left after a pinch: carry on panning with it.
    const [id, p] = [...pointers.entries()][0];
    gesture = { kind: "pan", x0: p.x, y0: p.y, vx: view.x, vy: view.y, moved: true, id };
  } else if (!pointers.size) {
    gesture = null;
    routeView.classList.remove("panning");
    if (swallowClick) drawFans();
  }
}

routeView.addEventListener("pointerup", endPointer);
routeView.addEventListener("pointercancel", endPointer);

// Holding the middle mouse button pans; don't let the browser start its
// own auto-scroll or open a link.
routeView.addEventListener("mousedown", (e) => {
  if (e.button === 1) e.preventDefault();
});
routeView.addEventListener("auxclick", (e) => {
  if (e.button === 1) e.preventDefault();
});

// A drag isn't a tap: keep it from opening a menu.
routeView.addEventListener("click", (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

// Mouse wheel: zoom in and out around the pointer. Shift + wheel moves
// sideways.
routeView.addEventListener("wheel", (e) => {
  if (isControl(e.target)) return;
  e.preventDefault();
  const box = routeView.getBoundingClientRect();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? routeView.clientHeight : 1;
  if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
    view.x -= (e.deltaY || e.deltaX) * unit;
    clampView();
    return applyView();
  }
  const dy = Math.max(-200, Math.min(200, e.deltaY * unit));
  // Trackpad pinches come as Ctrl + small steps: zoom a bit faster for them.
  zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - box.left, e.clientY - box.top);
}, { passive: false });

// --- Overview map ---

let minimapQueued = false;

function scheduleMinimap() {
  if (minimapQueued) return;
  minimapQueued = true;
  requestAnimationFrame(() => {
    minimapQueued = false;
    drawMinimap();
  });
}

let minimapScale = 1;

function drawMinimap() {
  const { w, h } = treeSize();
  const vw = routeView.clientWidth;
  const vh = routeView.clientHeight;
  // Nothing to find when the whole route is on screen.
  const fits = w * view.z <= vw && h * view.z <= vh && view.x >= 0 && view.y >= 0 &&
    view.x + w * view.z <= vw && view.y + h * view.z <= vh;
  minimap.hidden = !w || fits;
  if (minimap.hidden) return;
  const W = minimap.width;
  const H = minimap.height;
  minimapScale = Math.min((W - 8) / w, (H - 8) / h);
  const ctx = minimap.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  const ox = 4;
  const oy = 4;
  const t = tree.getBoundingClientRect();
  // The map's corner at full size; it shrinks out of the way while a
  // card or cable label sits under it (it grows back on hover).
  const vb = routeView.getBoundingClientRect();
  const small = matchMedia("(max-width: 640px)").matches;
  const zone = { r: vb.right - 12, b: vb.bottom - 12, l: vb.right - 12 - (small ? 120 : 180), t: vb.bottom - 12 - (small ? 74 : 110) };
  const under = (r) => r.right > zone.l && r.left < zone.r && r.bottom > zone.t && r.top < zone.b;
  let covered = false;
  for (const s of tree.querySelectorAll(".grid-label, .cable .line, .fan-drop")) if (!covered && under(s.getBoundingClientRect())) covered = true;
  ctx.fillStyle = "#3f8be0";
  for (const s of tree.querySelectorAll(".stop")) {
    const r = s.getBoundingClientRect();
    if (!covered && under(r)) covered = true;
    ctx.fillStyle = getComputedStyle(s).getPropertyValue("--c") || "#8796a6";
    ctx.fillRect(ox + ((r.left - t.left) / view.z) * minimapScale, oy + ((r.top - t.top) / view.z) * minimapScale,
      Math.max(2, (r.width / view.z) * minimapScale), Math.max(2, (r.height / view.z) * minimapScale));
  }
  // What's on screen now.
  ctx.strokeStyle = "#dfe6ee";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox + (-view.x / view.z) * minimapScale, oy + (-view.y / view.z) * minimapScale,
    (vw / view.z) * minimapScale, (vh / view.z) * minimapScale);
  minimap.classList.toggle("tucked", covered);
}

function minimapJump(e) {
  const box = minimap.getBoundingClientRect();
  const sx = minimap.width / box.width;
  const mx = ((e.clientX - box.left) * sx - 4) / minimapScale;
  const my = ((e.clientY - box.top) * sx - 4) / minimapScale;
  view.x = routeView.clientWidth / 2 - mx * view.z;
  view.y = routeView.clientHeight / 2 - my * view.z;
  clampView();
  applyView();
}

let minimapDrag = false;
minimap.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  minimapDrag = true;
  minimap.setPointerCapture(e.pointerId);
  minimapJump(e);
});
minimap.addEventListener("pointermove", (e) => minimapDrag && minimapJump(e));
minimap.addEventListener("pointerup", () => (minimapDrag = false));
minimap.addEventListener("click", (e) => e.stopPropagation());
