// Splice Planner: plain JS, no build step.
// The whole plan lives in `plan` so later steps (cables, closures,
// fiber colors, print sheet) can add to it and save/load it as JSON.

const STORAGE_KEY = "splicePlanner.plan";

// The app always opens clean on the splash screen. The last plan worked
// on stays in the browser only as a draft the user can choose to resume.
let plan = null;
let draft = migratePlan(loadPlan());

// A new plan starts empty: the first location placed is the start.
function newPlan() {
  return {
    createdAt: new Date().toISOString(),
    // Every location on the route; the first is the start.
    points: [],
    // Paths join each location to the one feeding it: the lines on the
    // route. A path can hold conduit details.
    paths: [],
    // Cable spans riding the paths, at most one per path.
    cables: [],
    // Imported homes not yet fed from a location.
    unassigned: [],
    // Patches between equipment ports and fibers at a location.
    xconnects: [],
    // Count scheme (counts.js); empty means the defaults.
    counts: {},
    createdBy: currentUser(),
  };
}

// Plans saved before paths existed: each cable span was its own path.
function migratePlan(p) {
  if (!p) return p;
  if (!Array.isArray(p.paths)) p.paths = (p.cables || []).map((c) => ({ id: makeId(), from: c.from, to: c.to }));
  p.unassigned = p.unassigned || [];
  p.xconnects = p.xconnects || [];
  // Through spans name the span they continue (a path can carry several
  // cables now). Before, it was the one cable arriving at their start.
  for (const c of p.cables || []) {
    if (!c.through || c.prev) continue;
    const up = p.cables.find((x) => x.to === c.from);
    if (up) c.prev = up.id;
  }
  if (typeof migrateCounts === "function") migrateCounts(p);
  // Round 8 kept estimate prices in the plan; the estimate tool is gone.
  delete p.estimate;
  return p;
}

// Unit prices the estimate tool remembered on this device.
try {
  localStorage.removeItem("splicePlanner.prices");
} catch {
  // Nothing to clear.
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePlan() {
  if (plan) {
    tagPhases();
    autoCounts();
    stampEdit();
  }
  try {
    if (plan) localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private window, etc.); the app still works in memory.
  }
  // The plan file too, when Autosave is on (files.js).
  if (plan && typeof scheduleAutosave === "function") scheduleAutosave();
}

// --- Screens ---

const screens = {
  splash: document.getElementById("screen-splash"),
  route: document.getElementById("screen-route"),
};

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  // Once a plan is open it replaces the saved draft.
  if (name === "route") draft = null;
  if (name === "splash") renderResume();
  if (name === "route") {
    if (typeof syncAutosave === "function") syncAutosave();
    renderRoute();
    // A fresh view: the whole route if it fits readably, else the start.
    requestAnimationFrame(() => startView());
  }
}

// --- Splash ---

// New plan opens an empty route; the first thing placed (a cabinet, a
// handhole or anything else) becomes the start.
document.querySelector('[data-start="new"]').addEventListener("click", () => {
  if (guestBlocked()) return;
  plan = newPlan();
  resetEditBaseline();
  savePlan();
  show("route");
});

function planEmpty() {
  return !!plan && !plan.points.length;
}

// Header actions that need a route say so on an empty plan.
function emptyBlocked() {
  if (!planEmpty()) return false;
  showNote("Place the first location to start the route.");
  return true;
}

// --- Fiber color code (TIA-598) ---
// Fibers come 12 to a buffer tube, in the standard color order. Tubes
// use the same order; tubes 13-24 repeat it with a black stripe, 25-36
// with a double stripe (written "Blue/2 Blk").

const TIA_COLORS = [
  { name: "Blue", hex: "#1f5fd6" },
  { name: "Orange", hex: "#f28a1a" },
  { name: "Green", hex: "#1e9b45" },
  { name: "Brown", hex: "#8a5a2b" },
  { name: "Slate", hex: "#7d8791" },
  { name: "White", hex: "#ffffff" },
  { name: "Red", hex: "#d62828" },
  { name: "Black", hex: "#1b1b1b" },
  { name: "Yellow", hex: "#f2d21b" },
  { name: "Violet", hex: "#8a3fc7" },
  { name: "Rose", hex: "#f2a7c3" },
  { name: "Aqua", hex: "#27c4d6" },
];

function colorAt(i) {
  const base = TIA_COLORS[i % 12];
  const stripes = Math.floor(i / 12);
  // A black tube or fiber gets a white stripe instead, so it can be seen.
  const stripe = base.name === "Black" ? "Wht" : "Blk";
  const suffix = stripes === 0 ? "" : stripes === 1 ? `/${stripe}` : `/${stripes} ${stripe}`;
  return { name: base.name + suffix, hex: base.hex, striped: stripes > 0, stripeHex: stripe === "Wht" ? "#ffffff" : "#1b1b1b" };
}

// Every fiber in a cable: [{ number, tube, tubeColor, fiberColor }].
function colorCode(fibers) {
  const out = [];
  for (let n = 0; n < fibers; n++) {
    const tube = Math.floor(n / 12);
    out.push({
      number: n + 1,
      tube: tube + 1,
      tubeColor: colorAt(tube),
      fiberColor: colorAt(n % 12),
    });
  }
  return out;
}

function tubeCount(fibers) {
  return Math.ceil(fibers / 12);
}

function swatch(color, small) {
  const el = document.createElement("span");
  el.className = "swatch" + (small ? " small" : "") + (color.striped ? " striped" : "");
  el.style.background = color.hex;
  if (color.striped) el.style.setProperty("--stripe", color.stripeHex);
  el.title = color.name;
  return el;
}

// A faint wash of a buffer tube's color behind its fibers' rows, with a
// stronger edge. White and black tubes get a neutral light or dark wash.
function tintTube(e, tubeColor) {
  if (!tubeColor) return e;
  const base = tubeColor.name.split("/")[0];
  e.classList.add("tube-tint");
  if (base === "White") e.classList.add("tube-white");
  else if (base === "Black") e.classList.add("tube-black");
  else e.style.setProperty("--tube", tubeColor.hex);
  return e;
}

// --- Route ---
// The route is point to point: every location is fed from one other
// location along a path, and any location can feed more than one
// (branching). Customer NIDs are end points.
//
// A path may carry a cable span (plan.cables, matched to the path by
// from/to). A span with `through` set ("pass" or "storage") is the same
// physical cable as the span arriving at its `from` location, so one
// cable can run from Handhole A through Handhole B to Handhole C.

const STOP_TYPES = {
  headend: "Head end",
  fdh: "FDH",
  splice: "Splice",
  handhole: "Handhole",
  pedestal: "Pedestal",
  vault: "Vault",
  manhole: "Manhole",
  cabinet: "Cabinet",
  nid: "Customer NID",
  other: "Other",
};

// Locations offered by the + button, in menu order.
// "Splice" isn't offered: splicing happens at a handhole, pedestal and so
// on. Old plans with splice locations still show them.
const PASS_TYPES = ["handhole", "pedestal", "vault", "manhole", "other"];
const ADD_TYPES = ["handhole", "pedestal", "vault", "manhole", "fdh", "headend"];

// Standard loose-tube cable counts, and smaller counts for drops to a NID.
const FIBER_COUNTS = [12, 24, 48, 72, 96, 144, 216, 288, 432];
const DROP_COUNTS = [1, 2, 4, 6, 12];
const CABLE_SIZES = [1, 2, 4, 6, 12, 24, 48, 72, 96, 144, 216, 288, 432];
const SPLITTER_RATIOS = ["1x2", "1x4", "1x8", "1x16", "1x32", "1x64"];

// Tails come pre-attached to a splitter or terminal; otherwise they are
// entered like any other cable.
const CABLE_KINDS = { cable: "Cable", "splitter-tail": "Splitter tail", "terminal-tail": "Terminal tail" };

const tree = document.getElementById("route-tree");
const menu = document.getElementById("context-menu");

// The location the menu or a dialog is working on.
let selectedId = null;

// Start over clears the plan, so it takes a second tap: the button turns
// red and asks again for a few seconds.
const backBtn = document.getElementById("back-to-splash");
const backLabel = backBtn.innerHTML;
let backArmed = null;
backBtn.addEventListener("click", () => {
  if (!backArmed) {
    backBtn.classList.add("armed");
    backBtn.textContent = "Tap again to clear the plan";
    backArmed = setTimeout(disarmBack, 4000);
    return;
  }
  disarmBack();
  plan = null;
  savePlan();
  closeMenu();
  closePanels();
  show("splash");
});

function disarmBack() {
  clearTimeout(backArmed);
  backArmed = null;
  backBtn.classList.remove("armed");
  backBtn.innerHTML = backLabel;
}

function point(id) {
  return plan.points.find((p) => p.id === id);
}

function childPaths(id) {
  return plan.paths.filter((x) => x.from === id);
}

function incomingPath(id) {
  return plan.paths.find((x) => x.to === id);
}

// A path can carry several cables. Each span with `through` set names
// the span it continues in `prev`, so two cables can arrive at a
// location and each carry on along its own path. At most one cable
// should end at a location: that one feeds it (its splices and
// equipment); cables passing through aren't spliced there.

// A span runs along its path, from where the path comes from to where it
// goes, or (a tail laid back up the route) the other way. Paths form a
// tree, so a span against its path is one ending where its path starts.
function againstPath(c) {
  const p = incomingPath(c.from);
  return !!p && p.from === c.to;
}

// Every cable span on a path, either way along it.
function pathCables(path) {
  return plan.cables.filter((c) => c.to === path.to ? !againstPath(c) : c.from === path.to && c.to === path.from);
}

// The path a span lies on, known by where it goes.
function spanPathTo(c) {
  return againstPath(c) ? c.from : c.to;
}

// The locations on the way from a to b along the route, both included,
// going up towards the start and back down as needed.
function routeBetween(a, b) {
  const up = (id) => {
    const out = [];
    for (let x = id; x && !out.includes(x); x = (incomingPath(x) || {}).from) out.push(x);
    return out;
  };
  const ua = up(a);
  const ub = up(b);
  const meet = ua.find((x) => ub.includes(x));
  if (!meet) return null;
  return [...ua.slice(0, ua.indexOf(meet) + 1), ...ub.slice(0, ub.indexOf(meet)).reverse()];
}

// The cable span on a path that feeds where it goes (see incomingCable).
function pathCable(path) {
  return incomingCable(path.to);
}

function childCables(id) {
  return plan.cables.filter((c) => c.from === id);
}

// The span a through span continues. Spans saved before `prev` existed
// continue the (only) cable arriving at their start.
function prevSpan(c) {
  return c.prev ? plan.cables.find((x) => x.id === c.prev) : plan.cables.find((x) => x.to === c.from);
}

// The span continuing this one past its end, if the cable goes on.
function nextSpan(c) {
  return plan.cables.find((x) => x.through && x.from === c.to && prevSpan(x) === c);
}

// The cable feeding a location: the one ending there, or else the first
// to arrive (one passing through with a mid-span splice).
function incomingCable(id) {
  const arriving = [];
  const going = [];
  for (const c of plan.cables) {
    // A tail laid back up the route only passes through.
    if (c.to === id && !(againstPath(c) && nextSpan(c))) arriving.push(c);
    else if (c.from === id && c.through) going.push(c);
  }
  if (arriving.length < 2) return arriving[0];
  return arriving.find((a) => !going.some((x) => prevSpan(x) === a)) || arriving[0];
}

// The span feeding a splitter or terminal: the end of its own tail, or
// else the cable feeding its location.
function feederAt(locId, eq) {
  const t = eq && eq.tail && plan.cables.find((x) => x.id === eq.tail);
  const end = t && cableSpans(t).at(-1);
  return end && end.to === locId ? end : incomingCable(locId);
}

const THROUGH_LABELS = { pass: "passes through", storage: "slack stored" };

// The first span of the physical cable this span belongs to.
function cableStart(c) {
  const seen = new Set();
  while (c.through && !seen.has(c.id)) {
    seen.add(c.id);
    const up = prevSpan(c);
    if (!up) break;
    c = up;
  }
  return c;
}

// All spans of one physical cable, start to end.
function cableSpans(c) {
  const spans = [cableStart(c)];
  for (;;) {
    const next = nextSpan(spans[spans.length - 1]);
    if (!next || spans.includes(next)) return spans;
    spans.push(next);
  }
}

// Lay a cable from startId to toId along the route: down it, back up it,
// or up and down another branch (a tail can start anywhere, even below
// where it ends). Later spans continue the first one.
function layRun(startId, toId, fields) {
  const into = incomingPath(toId);
  const route = routeBetween(startId, toId);
  const ids = route && route.length > 1 ? route : into ? [into.from, toId] : null;
  if (!ids) return;
  let first = null;
  let prev = null;
  for (let i = 1; i < ids.length; i++) {
    const span = { id: makeId(), from: ids[i - 1], to: ids[i] };
    if (prev) Object.assign(span, { name: fields.name, fibers: fields.fibers, through: "pass", prev: prev.id });
    else Object.assign(span, fields);
    plan.cables.push(span);
    if (!first) first = span;
    prev = span;
  }
  return first;
}

function cableKind(c) {
  return cableStart(c).kind || "cable";
}

// "Splitter tail · 150 ft": the kind, with a tail's length.
function cableKindText(c) {
  const ft = cableStart(c).tailFt;
  return CABLE_KINDS[cableKind(c)] + (ft && cableKind(c) !== "cable" ? ` · ${ft} ft` : "");
}

// Line colors on the route: cables red, splitter tails blue, terminal
// tails green. A path with no cable yet is dashed grey.
const WIRE_COLORS = { cable: "#e5484d", "splitter-tail": "#3e8ef7", "terminal-tail": "#35b27c" };
const NO_WIRE = "#4a5866";

function wireColor(c) {
  return c ? WIRE_COLORS[cableKind(c)] || WIRE_COLORS.cable : NO_WIRE;
}

// Drops to homes are listed with the homes, not with the cables.
function isDrop(c) {
  const to = point(c.to);
  return to && to.type === "nid" && !c.through;
}

// Next free "Cable n", "Drop n", "Splitter tail n" ... name.
function nextCableName(kind, toHome) {
  const prefix = toHome && kind === "cable" ? "Drop" : CABLE_KINDS[kind];
  const re = new RegExp(`^${prefix} (\\d+)$`);
  let n = 0;
  for (const c of plan.cables) {
    const m = re.exec(c.name || "");
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${prefix} ${n + 1}`;
}

// A new cable's name: the location it runs to (cable A09613 goes to
// handhole A09613). A drop to a home is still "Drop n".
function cableNameFor(kind, toId) {
  const to = point(toId);
  return to && to.type !== "nid" ? to.name : nextCableName(kind, true);
}

function typeLabel(type) {
  return STOP_TYPES[type] || "Other";
}

// Auto-name stops "Splice 1", "Handhole 2", ... so nobody has to type.
function autoName(type) {
  const short = type === "nid" ? "NID" : typeLabel(type);
  const n = plan.points.filter((p) => p.type === type).length + 1;
  return `${short} ${n}`;
}

// The splice model for the current render, so cable labels are worked
// out once per draw.
let routeModel = null;

function renderRoute() {
  if (planEmpty()) return renderEmptyRoute();
  routeModel = buildSpliceModel();
  // The Table layout (table.js) stands in for the drawing.
  const table = layoutNow() === "table";
  routeView.hidden = table;
  routeTable.hidden = !table;
  if (table) {
    tree.innerHTML = "";
    renderTable();
  } else {
    // Keep the card being worked on where it was on screen.
    const anchor = rememberAnchor();
    tree.innerHTML = "";
    // The Grid layout (grid.js) places each location in a cell of its own.
    tree.append(layoutNow() === "grid" ? gridBoard() : branchEl(plan.points[0]));
    restoreAnchor(anchor);
    drawFans();
    scheduleMinimap();
  }
  renderLayoutPick();
  renderGridButtons();
  updateUnassignedButton();
  renderHeader();
  if (typeof refreshFeatures === "function") refreshFeatures();
}

// An empty plan: one card to place the start.
const START_TYPES = ["headend", "fdh", "handhole", "pedestal", "vault", "manhole"];

function renderEmptyRoute() {
  routeModel = null;
  routeView.hidden = false;
  routeTable.hidden = true;
  tree.innerHTML = "";
  const card = el("button", "stop start empty-start");
  card.type = "button";
  card.append(el("span", "badge", "+"), el("span", "type", "Start"), el("span", "name", "Place the first location"),
    el("span", "lot", "A cabinet, handhole or anything else"));
  card.addEventListener("click", (e) => openStartMenu(e));
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openStartMenu(e);
  });
  tree.append(card);
  minimap.hidden = true;
  renderLayoutPick();
  renderGridButtons();
  updateUnassignedButton();
  renderHeader();
  if (typeof refreshFeatures === "function") refreshFeatures();
}

function openStartMenu(e) {
  e.stopPropagation();
  if (guestBlocked()) return;
  closePanels();
  const items = START_TYPES.map((t) => ({ icon: LOC_META[t].icon, label: typeLabel(t), run: () => {
    if (EQUIP_FIRST[t]) return equipFirstForm(t, null);
    placeStart(t, typeLabel(t));
  } }));
  items.push({ icon: "pin", label: "Other…", run: () => addOtherForm(null) });
  openPopup("Where does the route begin?", items, e, "Place the first location");
}

function placeStart(type, name, extra) {
  const stop = { id: makeId(), type, label: typeLabel(type), name, equipment: [], ...extra };
  plan.points.push(stop);
  finish();
  requestAnimationFrame(() => startView());
  return stop;
}

function branchEl(p) {
  const branch = el("div", "branch");
  const wrap = el("div", "stop-wrap");
  wrap.append(stopEl(p));
  if (p.type !== "nid") wrap.append(plusEl(p));
  branch.append(wrap);
  const all = shownPaths(p.id);
  // Homes at the end of the line fan out together; anything that carries
  // on gets its own row. Folded (fold.js): homes and tail terminals wait
  // in the tray under the card, and a folded branch shows nothing past it.
  const drops = all.filter((x) => isEndHome(x));
  const tucked = all.filter((x) => !drops.includes(x) && isTucked(x));
  const onward = all.filter((x) => !drops.includes(x) && !tucked.includes(x));
  const tray = p.type === "nid" ? null : foldTray(p, drops, tucked, onward.length > 0);
  if (tray) {
    wrap.classList.add("has-tray");
    wrap.insertBefore(tray, wrap.lastChild);
  }
  const paths = branchFolded(p.id) ? [] : [...onward, ...(homesShown(p.id) ? drops : [])];
  if (paths.length) {
    const kids = el("div", "children");
    for (const path of paths.filter((x) => !drops.includes(x))) {
      const child = el("div", "child");
      child.append(routePathEl(path, routeModel), branchEl(point(path.to)));
      kids.append(child);
    }
    const fanned = paths.filter((x) => drops.includes(x));
    if (fanned.length) {
      const child = el("div", "child fan-child");
      child.append(fanEl(fanned));
      kids.append(child);
    }
    branch.append(kids);
  }
  return branch;
}

// Each cable opens its own form; guests keep the read-only line menu.
function cableRows(path) {
  const rows = el("div", "cable-rows");
  const cables = pathCables(path);
  for (const c of cables.length ? cables : [null]) {
    const row = btnEl("", (e) => {
      e.stopPropagation();
      if (!c || isGuest()) openLineMenu(path.to, e);
      else openPath(path.to, c.id);
    }, "cable-row");
    row.append(el("span", "cable-name" + (c ? "" : " muted"), c ? c.name || "Cable" : point(path.to).type === "nid" ? "No drop" : "No cable"));
    if (c) row.append(el("span", "cable-size", `${c.fibers}F` + (c.jumper ? " jumper" : "") + (c.through ? " · continued" : "") + (!c.through && c.tailFt && c.kind ? ` · ${c.tailFt} ft` : "") + (hasPhases() ? ` · P${phaseIdx(c) + 1}` : "")));
    rows.append(row);
  }
  // Right-click: the line's menu (edit, add a cable or tail, remove).
  rows.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openLineMenu(path.to, e);
  });
  return rows;
}

function routePathEl(path, model) {
  const old = pathEl(path, model);
  const wrap = el("div", old.className);
  wrap.style.cssText = old.style.cssText;
  wrap.append(cableRows(path));
  for (const child of [...old.children]) {
    if (!child.matches(".cable-name, .cable-size")) wrap.append(child);
  }
  wrap.addEventListener("click", (e) => openLineMenu(path.to, e));
  wrap.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    openLineMenu(path.to, e);
  });
  return wrap;
}

function isEndHome(path) {
  const c = pathCable(path);
  return point(path.to).type === "nid" && !childPaths(path.to).length && !(c && c.through);
}

// Drops to homes: curves fanning out from the location, one per home,
// with the drop's name where it reaches the home. The curves are drawn
// once the cards are laid out (drawFans).
const FAN_W = 170;
const SVG_NS = "http://www.w3.org/2000/svg";

function fanEl(paths) {
  const fan = el("div", "fan");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "fan-lines");
  svg.setAttribute("aria-hidden", "true");
  const rows = el("div", "fan-rows");
  for (const path of paths) {
    const c = pathCable(path);
    const row = el("div", "fan-row" + (c ? "" : " empty") + (c && phasePast(c) ? " past" : "") +
      (path.to === openPathId ? " selected" : ""));
    if (c) row.dataset.wire = wireColor(c);
    const label = el("div", "fan-drop");
    label.title = `Drop to ${point(path.to).name}`;
    label.append(cableRows(path));
    row.append(label, branchEl(point(path.to)));
    rows.append(row);
  }
  fan.append(svg, rows);
  // The line coming in from the location takes the first drop's color.
  const first = paths.map(pathCable).find(Boolean);
  fan.dataset.wire = wireColor(first);
  if (!first) fan.dataset.empty = "1";
  return fan;
}

function drawFans() {
  if (layoutNow() === "grid") return drawGridLines();
  // Screen sizes are zoomed; the drawing is in the route's own units.
  const z = typeof routeZoom === "function" ? routeZoom() : 1;
  for (const fan of document.querySelectorAll("#route-tree .fan")) {
    const svg = fan.querySelector(".fan-lines");
    const rect = fan.getBoundingClientRect();
    if (!rect.height) continue;
    const box = { top: rect.top, height: rect.height / z };
    // Start where the location's line meets this group: its middle.
    const y0 = box.height / 2;
    const mid = FAN_W * 0.55;
    svg.setAttribute("width", FAN_W);
    svg.setAttribute("height", box.height);
    svg.setAttribute("viewBox", `0 0 ${FAN_W} ${box.height}`);
    svg.innerHTML = "";
    for (const row of fan.querySelectorAll(".fan-row")) {
      const stop = row.querySelector(".stop");
      const r = stop.getBoundingClientRect();
      const y = (r.top + r.height / 2 - box.top) / z;
      // The name goes on the side of the line away from the curve.
      row.classList.toggle("below", y > y0 + 4);
      const line = document.createElementNS(SVG_NS, "path");
      line.setAttribute("d", `M${WIRE_IN},${y0} C${mid},${y0} ${mid},${y} ${FAN_W},${y}`);
      line.setAttribute("class", "fan-line" + [...row.classList].filter((x) => x !== "fan-row").map((x) => " " + x).join(""));
      if (row.dataset.wire && !row.classList.contains("selected")) line.style.stroke = row.dataset.wire;
      svg.append(line);
    }
  }
  drawWires(tree, z);
}

// The lines joining a location to the paths leaving it, drawn as one
// piece each: out of the card, along the trunk, and into the cable's line
// with square, joined corners. Sizes are measured once the cards are laid
// out; z is the zoom the route is shown at.
const WIRE_IN = 23; // where the trunk runs: the start of the cable lines

function drawWires(root, z = 1) {
  const old = root.querySelector(":scope > svg.wires");
  if (old) old.remove();
  const base = root.getBoundingClientRect();
  if (!base.width) return;
  const X = (v) => Math.round(((v - base.left) / z) * 10) / 10;
  const Y = (v) => Math.round(((v - base.top) / z) * 10) / 10;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "wires");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", root.scrollWidth);
  svg.setAttribute("height", root.scrollHeight);
  for (const kids of root.querySelectorAll(".children")) {
    // From the card's right edge, halfway down the card and its tray.
    const stop = kids.parentElement.querySelector(":scope > .stop-wrap, :scope > .stop");
    if (!stop) continue;
    const s = stop.getBoundingClientRect();
    const x0 = X(s.right) - 1;
    const y0 = Y(s.top + s.height / 2);
    const xm = X(kids.getBoundingClientRect().left) + WIRE_IN;
    const wires = [];
    for (const child of kids.children) {
      const cable = child.querySelector(":scope > .cable");
      const fan = child.querySelector(":scope > .fan");
      let x1, y1, color, cls = "wire";
      if (cable) {
        const r = cable.querySelector(".line").getBoundingClientRect();
        x1 = X(r.right);
        y1 = Y(r.top + r.height / 2);
        color = cable.style.getPropertyValue("--wire") || WIRE_COLORS.cable;
        for (const c of ["empty", "drop", "past"]) if (cable.classList.contains(c)) cls += " " + c;
      } else if (fan) {
        const r = fan.getBoundingClientRect();
        x1 = xm;
        y1 = Y(r.top + r.height / 2);
        color = fan.dataset.wire;
        if (fan.dataset.empty) cls += " empty";
      } else continue;
      wires.push({ x1, y1, color, cls });
    }
    // Farthest first, so the nearest path's color is on top where they share the trunk.
    wires.sort((a, b) => Math.abs(b.y1 - y0) - Math.abs(a.y1 - y0));
    for (const w of wires) {
      const line = document.createElementNS(SVG_NS, "path");
      const d = Math.abs(w.y1 - y0) < 1 ? `M${x0},${y0} H${w.x1}` : `M${x0},${y0} H${xm} V${w.y1} H${w.x1}`;
      line.setAttribute("d", d);
      line.setAttribute("class", w.cls);
      line.style.stroke = w.color;
      svg.append(line);
    }
  }
  root.prepend(svg);
}

window.addEventListener("resize", () => drawFans());
// Waits for the page too: cached fonts can be ready before fold.js loads.
if (document.fonts) Promise.all([document.fonts.ready, new Promise((r) => window.addEventListener("load", r))]).then(() => drawFans());

// A location card: colored icon tile, type, name, then chips for its
// equipment and counts.
function stopEl(p) {
  const isStart = p.id === plan.points[0].id;
  const meta = locMeta(p);
  const card = el("button", "stop" + (isStart ? " start" : "") + (p.type === "nid" ? " nid" : "") +
    (p.id === selectedId ? " selected" : "") + (phasePast(p) ? " past" : ""));
  card.type = "button";
  card.dataset.id = p.id;
  card.style.setProperty("--c", meta.color);
  const badge = el("span", "badge");
  badge.append(iconEl(meta.icon));
  const label = typeLabel(p.type);
  // "Start · Cabinet" over "Cabinet" says it twice.
  const kind = el("span", "type", isStart ? (p.name === label ? "Start" : `Start · ${label}`) : label);
  card.append(badge, kind, el("span", "name", p.name));
  if (p.type === "nid" && p.lot && hasAddress(p)) card.append(el("span", "lot", lotName(p.lot)));
  const chips = el("span", "chips");
  for (const eq of p.equipment || []) {
    // A tail spliced right here wears its tail color.
    const chip = el("span", "chip" + (eq.tailIn && tailFeet(eq) ? " tail-in" : ""), equipmentChip(eq));
    if (eq.tailIn && tailFeet(eq)) {
      chip.style.setProperty("--wire", WIRE_COLORS[tailKind(p, eq)] || WIRE_COLORS["splitter-tail"]);
      chip.title = `${eq.name}: ${tailText(eq, p)}, spliced here`;
    }
    chips.append(chip);
  }
  if (p.type === "nid") {
    const f2 = homeF2(p);
    if (f2) chips.append(countChip(f2Label(f2)));
    if (homeDs(p)) chips.append(countChip(homeDs(p)));
  }
  const through = childCables(p.id).filter((x) => x.through);
  // Several cables passing make one chip, named in its tooltip.
  if (through.length === 1) chips.append(el("span", "chip through", `${through[0].name} ${THROUGH_LABELS[through[0].through]}`));
  else if (through.length) {
    const chip = el("span", "chip through", `${through.length} cables pass through`);
    chip.title = through.map((c) => `${c.name} ${THROUGH_LABELS[c.through]}`).join(", ");
    chips.append(chip);
  }
  // A handhole, pedestal and so on with nothing in it: the cable just passes.
  const holds = (p.equipment || []).some((e) => ["closure", "splitter", "terminal"].includes(e.type));
  if (PASS_TYPES.includes(p.type) && !holds && !through.length) chips.append(el("span", "chip through", "Pass through"));
  chips.append(...fieldChips(p));
  const pc = phaseChip(p);
  if (pc) chips.prepend(pc);
  if (chips.childNodes.length) card.append(chips);
  card.addEventListener("click", (e) => openMenu(p.id, e));
  // Right-click: this card's menu, or with several cards selected (and
  // this one among them), what can be done to all of them.
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (typeof gridPicked !== "undefined" && gridPicked.size > 1 && gridPicked.has(p.id) && !isGuest()) return openPickedMenu(e);
    openMenu(p.id, e);
  });
  return card;
}

function plusEl(p) {
  const b = btnEl("+", (e) => openAddMenu(p.id, e), "add-next");
  b.title = `Add a location after ${p.name}`;
  b.setAttribute("aria-label", b.title);
  return b;
}

// --- Popup menus ---

// The app's one popup menu: a location's menu on a tap, and the
// right-click menu everywhere. Items are { icon, label, run, danger };
// `sep: true` draws a line above an item. It sits over dialogs too,
// works from the keyboard (arrows, Home/End, Enter, Esc) and stays on
// screen.
document.body.append(menu);
menu.setAttribute("role", "menu");
let menuBack = null; // what had focus before the menu opened

function openPopup(title, items, e, caption) {
  menu.innerHTML = "";
  const head = el("div", "menu-head");
  const titles = el("div");
  if (caption) titles.append(el("div", "menu-cap", caption));
  titles.append(el("div", "menu-title", title));
  head.append(titles, xButton(() => {
    closeMenu();
    if (formPanel.hidden) selectedId = null;
    renderRoute();
  }));
  menu.append(head);
  menu.setAttribute("aria-label", title);
  for (const item of items) {
    if (item.sep) menu.append(el("div", "menu-sep"));
    const b = btnEl("", (ev) => {
      ev.stopPropagation();
      closeMenu();
      item.run();
    });
    b.className = "mi" + (item.danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.append(iconEl(item.icon || "info"), document.createTextNode(item.label));
    menu.append(b);
  }
  if (menu.hidden) menuBack = document.activeElement;
  menu.hidden = false;
  // At the tap or click, kept inside the window. From the keyboard (the
  // menu key, or Shift+F10) there is no spot: under what has focus.
  let { clientX: cx = 0, clientY: cy = 0 } = e || {};
  if (!cx && !cy && e && e.target && e.target.getBoundingClientRect) {
    const r = e.target.getBoundingClientRect();
    cx = r.left + 12;
    cy = r.bottom - 4;
  }
  const x = Math.min(cx, window.innerWidth - menu.offsetWidth - 8);
  const y = Math.min(cy, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = Math.max(8, x) + "px";
  menu.style.top = Math.max(8, y) + "px";
  const first = menu.querySelector(".mi");
  if (first) first.focus({ preventScroll: true });
}

function closeMenu() {
  if (menu.hidden) return;
  menu.hidden = true;
  if (menuBack && menuBack.isConnected && menuBack !== document.body) menuBack.focus({ preventScroll: true });
  menuBack = null;
}

// Arrows move between the items; Esc closes just the menu (not the
// dialog under it); Tab leaves it.
menu.addEventListener("keydown", (e) => {
  const items = [...menu.querySelectorAll(".mi")];
  const i = items.indexOf(document.activeElement);
  const go = (n) => {
    e.preventDefault();
    items[(n + items.length) % items.length].focus();
  };
  if (e.key === "ArrowDown") go(i + 1);
  else if (e.key === "ArrowUp") go(i < 0 ? items.length - 1 : i - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(items.length - 1);
  else if (e.key === "Tab") closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || menu.hidden) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  closeMenu();
}, true);
addEventListener("resize", () => closeMenu());

// Right-click anywhere opens the app's own menu, never the browser's.
// Boxes you type in keep the browser's menu, for copy and paste. Where
// nothing more specific is on offer, the menu offers to copy the text
// you selected, if any.
document.addEventListener("contextmenu", (e) => {
  if (e.defaultPrevented) return;
  if (typingIn(e.target)) return;
  e.preventDefault();
  const text = String(window.getSelection() || "").trim();
  if (!text) return closeMenu();
  openPopup(text.length > 40 ? text.slice(0, 40) + "…" : text, [
    { icon: "copy", label: "Copy", run: () => navigator.clipboard && navigator.clipboard.writeText(text) },
  ], e, "Selected text");
});

// The menu on a location: everything but adding the next location,
// which is on its + button. What's offered depends on the type.
function openMenu(id, e) {
  e.stopPropagation();
  closePanels();
  selectedId = id;
  const p = point(id);
  const isStart = id === plan.points[0].id;
  const items = [];
  const homesHere = () => feedsHomes(p);
  const by = p.addedBy ? ` · added by ${p.addedBy}` : "";
  // The splice sheet comes first: a crew at the stop taps it and has it.
  const sheetItem = { icon: "sheet", label: "Splice sheet (view / print)", run: () => openSpliceSheet(id) };
  if (isGuest()) {
    // Guests (crews in the field) go straight to the location's sheet.
    if (p.type !== "nid") return openSpliceSheet(id);
    // At a home: a pointer to the name picker.
    items.push({ icon: "edit", label: "Field notes and as-built", run: () => openSpliceSheet(id) });
    items.push({ icon: "pin", label: "Trace fiber to the start", run: () => openTrace(id) });
    items.push({ icon: "user", label: "View only: pick your name at the top to change things", run: () => {
      const pick = document.querySelector(".route-header [data-user-pick]");
      if (pick) pick.focus();
    } });
    openPopup(p.name, items, e, typeLabel(p.type) + by);
    return renderRoute();
  }
  if (p.type === "nid") {
    items.push({ icon: "counts", label: "Counts (F2 / DS)", run: () => openCounts(id) });
    items.push({ icon: "pin", label: "Trace fiber to the start", run: () => openTrace(id) });
    items.push({ icon: "edit", label: "Address / lot", run: () => renameStop(id) });
  } else if (isCabinet(p)) {
    items.push(sheetItem);
    const eqLabel = p.type === "headend" ? "OLT shelves and panels" : p.type === "fdh" ? "Splitter modules and panels" : "Equipment";
    items.push({ icon: p.type === "fdh" ? "splitter" : "shelf", label: eqLabel, run: () => openEquipment(id) });
    items.push({ icon: "xconnect", label: "Connections and patching", run: () => openConnections(id) });
    if (homesHere()) items.push({ icon: "homes", label: "Home counts (F2 / DS)", run: () => openHomeCounts(id) });
    items.push({ icon: "info", label: "Cabinet details", run: () => openDetails(id) });
    items.push({ icon: "edit", label: "Rename", run: () => renameStop(id) });
  } else {
    items.push(sheetItem);
    // Locations start empty: a splice case is only there once it's added.
    if (closureAt(p)) items.push({ icon: "closure", label: "Open splice case", run: () => openConnections(id) });
    else {
      items.push({ icon: "closure", label: "Add a splice case", run: () => openEquipment(id, "closure") });
      items.push({ icon: "xconnect", label: "Splices and connections", run: () => openConnections(id) });
    }
    items.push({ icon: "splitter", label: "Equipment (case, splitters, terminals)", run: () => openEquipment(id) });
    if (homesHere()) items.push({ icon: "homes", label: "Home counts (F2 / DS)", run: () => openHomeCounts(id) });
    items.push({ icon: "info", label: "Details", run: () => openDetails(id) });
    items.push({ icon: "edit", label: "Rename", run: () => renameStop(id) });
    items.push({ icon: LOC_META[p.type] ? LOC_META[p.type].icon : "pin", label: "Change location type", run: () => changeTypeForm(id) });
  }
  if (hasPhases()) items.push({ icon: "info", label: `Phase (${phaseName(phaseIdx(p))})`, run: () => openPhaseForm(id) });
  // What the + buttons do, and picking it along with others.
  if (p.type !== "nid") {
    items.push({ icon: "plus", label: "Add the next location…", sep: true, run: () => {
      if (typeof gridAdd !== "undefined") gridAdd = null;
      openAddMenu(id, e);
    } });
  }
  if (!isStart && layoutNow() === "grid") {
    const on = gridPicked.has(id);
    items.push({ icon: "select", label: on ? "Take out of the selection" : "Select (add to the selection)", sep: p.type === "nid", run: () => togglePick(id) });
  }
  if (!isStart) {
    items.push({ icon: "move", label: "Move (feed from somewhere else)", sep: true, run: () => openMove(id) });
    items.push({ icon: "remove", label: "Remove", danger: true, run: () => removeStop(id) });
  }
  openPopup(p.name, items, e, typeLabel(p.type) + by);
  renderRoute();
}

// The + menu: add the next location after this one.
function openAddMenu(fromId, e) {
  e.stopPropagation();
  if (guestBlocked()) return;
  closePanels();
  selectedId = fromId;
  const items = ADD_TYPES.map((t) => ({ icon: LOC_META[t].icon, label: typeLabel(t), run: () => {
    if (EQUIP_FIRST[t]) return equipFirstForm(t, fromId);
    addLocation(fromId, t, autoName(t));
    finish();
  } }));
  items.push({ icon: "home", label: "Home (Customer NID)…", run: () => addHomeForm(fromId) });
  if (plan.unassigned.length) {
    items.push({ icon: "homes", label: `Homes from the unassigned list (${plan.unassigned.length})…`, run: () => openAssign(fromId) });
  }
  items.push({ icon: "pin", label: "Other…", run: () => addOtherForm(fromId) });
  openPopup(point(fromId).name, items, e, "Add the next location");
  renderRoute();
}

document.addEventListener("click", (e) => {
  if (!menu.hidden && !menu.contains(e.target)) {
    closeMenu();
    if (formPanel.hidden) {
      selectedId = null;
      if (plan) renderRoute();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMenu();
    closePanels();
    selectedId = null;
    if (plan) renderRoute();
  }
});

function finish() {
  closePanels();
  closeMenu();
  selectedId = null;
  savePlan();
  renderRoute();
}

// --- Adding locations ---
// A new location gets a path from the one before it. A cable can be
// placed on that path later, or not at all.

function addLocation(fromId, type, name, extra) {
  const stop = { id: makeId(), type, label: typeLabel(type), name, equipment: [], ...extra };
  plan.points.push(stop);
  plan.paths.push({ id: makeId(), from: fromId, to: stop.id });
  gridPlace(stop, fromId);
  // Something just added shouldn't vanish into a fold.
  unfoldTo(stop.id);
  return stop;
}

// fromId null places the start of an empty plan.
function addOtherForm(fromId) {
  openForm(fromId ? `Add a location after ${point(fromId).name}` : "Place the first location", (body, foot) => {
    const name = inputEl("text", "", { placeholder: "e.g. Building MPOE" });
    body.append(fieldEl("What is it?", name));
    formButtons(foot, () => {
      if (!name.value.trim()) return "Type what the location is.";
      if (!fromId) return void placeStart("other", name.value.trim());
      addLocation(fromId, "other", name.value.trim());
      finish();
    }, "Add");
  });
}

// A handhole or pedestal usually holds something, so placing one offers
// it right away: a splice case (trays drawn as the case will look), a
// splitter or a terminal, each with its own list of models.
const EQUIP_FIRST = { handhole: "closure", pedestal: "splitter" };

function equipFirstForm(type, fromId) {
  const what = typeLabel(type).toLowerCase();
  openForm(fromId ? `Add a ${what} after ${point(fromId).name}` : `Place the first location: a ${what}`, (body, foot) => {
    const name = inputEl("text", fromId ? autoName(type) : typeLabel(type));
    const kind = selectEl([
      { value: "", label: "Nothing (pass through)" },
      { value: "closure", label: "Splice case" },
      { value: "splitter", label: "Splitter" },
      { value: "terminal", label: "Terminal" },
    ], EQUIP_FIRST[type]);

    // Splice case: model, then trays and tray size.
    const closures = templatesFor("closure");
    const template = selectEl(closures.map((t) => ({ value: t.id, label: t.label, group: t.group })));
    const trays = inputEl("number", "", { min: 1, max: 48 });
    const size = selectEl(TRAY_SIZES.map((n) => ({ value: n, label: `${n} splices` })));
    const trayRow = el("div", "inline-fields");
    const a = el("label", "inline-field");
    a.append(el("span", "", "Trays"), trays);
    const b = el("label", "inline-field");
    b.append(el("span", "", "Tray size"), size);
    trayRow.append(a, b);
    const note = el("p", "field-hint");
    const pic = el("div");
    const draw = () => {
      const t = closures.find((x) => x.id === template.value);
      const total = (Number(trays.value) || 0) * Number(size.value);
      note.className = "field-hint" + (t && t.max && total > t.max ? " warn" : "");
      note.textContent = t && t.max && total > t.max ? `${total} splices is over the ${t.max} this case holds.` : `${total} splices.`;
      pic.replaceChildren(trayPicture(Math.max(1, Number(trays.value) || 1), Number(size.value)));
    };
    const fromCase = () => {
      const t = closures.find((x) => x.id === template.value);
      if (t) {
        trays.value = t.trays;
        if (!TRAY_SIZES.includes(t.slots)) size.append(new Option(`${t.slots} splices`, t.slots));
        size.value = t.slots;
      }
      draw();
    };
    template.addEventListener("change", fromCase);
    trays.addEventListener("input", draw);
    size.addEventListener("change", draw);
    const caseBits = el("div");
    caseBits.append(fieldEl("Splice case", template), trayRow, note, pic);
    fromCase();

    // Splitter: style and size. Its F2 count fills in by itself.
    // In a pedestal that's a CommScope clamshell with a FieldShield tail.
    const style = selectEl(templatesFor("splitter").map((t) => ({ value: t.id, label: t.label })), type === "pedestal" ? "sp-clamshell" : "sp-bare");
    const ratio = selectEl(SPLITTER_RATIOS.map((r) => ({ value: r, label: r })), "1x8");
    const tail = tailLengthField();
    const tailFrom = tailStartField(fromId, null, null, "here");
    const splitTail = el("div");
    splitTail.append(tail.el, tailFrom.el);
    const splitGrid = el("div", "form-grid");
    splitGrid.append(fieldEl("Style", style), fieldEl("Size", ratio));
    const splitBits = el("div");
    splitBits.append(splitGrid, splitTail);
    const syncTail = () => {
      splitTail.hidden = !templateById(style.value).tails;
      fillRatios(ratio, templateById(style.value), "1x8");
    };
    style.addEventListener("change", syncTail);
    syncTail();

    // Terminal: the model, and in a pedestal its tail.
    const terminal = selectEl(templatesFor("terminal").map((t) => ({ value: t.id, label: t.label, group: t.group })), "mst-8");
    const termTail = tailLengthField();
    const termFrom = tailStartField(fromId, null, null, "here");
    const termBits = el("div");
    termBits.append(fieldEl("Terminal", terminal));
    if (type === "pedestal") termBits.append(termTail.el, termFrom.el);

    const sync = () => {
      caseBits.hidden = kind.value !== "closure";
      splitBits.hidden = kind.value !== "splitter";
      termBits.hidden = kind.value !== "terminal";
    };
    kind.addEventListener("change", sync);
    sync();
    body.append(fieldEl("Name", name), fieldEl("Put in it", kind), caseBits, splitBits, termBits);
    formButtons(foot, () => {
      if (!name.value.trim()) return "Enter a name.";
      let eq = null;
      let tailFt = null;
      let tailStart = null;
      if (kind.value === "closure") {
        const t = templateById(template.value);
        eq = fromTemplate(t, name.value.trim());
        eq.trays = Math.max(1, Number(trays.value) || 1);
        eq.slots = Number(size.value);
      } else if (kind.value === "splitter") {
        const t = templateById(style.value);
        if (t.tails && !tail.value()) return "Enter the custom tail length in feet.";
        eq = { id: makeId(), type: "splitter", ratio: ratio.value, style: t.style,
          name: name.value.trim(), f2: null, f2Manual: false };
        if (t.tails) {
          tailFt = tail.value();
          tailStart = tailFrom.value();
        }
      } else if (kind.value === "terminal") {
        const t = templateById(terminal.value);
        eq = fromTemplate(t, name.value.trim());
        if (type === "pedestal") {
          if (!termTail.value()) return "Enter the custom tail length in feet.";
          tailFt = termTail.value();
          tailStart = termFrom.value();
        }
      }
      const extra = eq ? { equipment: [eq] } : {};
      if (!fromId) {
        if (tailFt) eq.tailFt = tailFt;
        return void placeStart(type, name.value.trim(), extra);
      }
      // The tail runs back to where it's spliced.
      const stop = addLocation(fromId, type, name.value.trim(), extra);
      if (tailFt) setTail(stop, eq, tailFt, tailStart);
      finish();
    }, "Add");
    name.select();
  });
}

// Drop sizes for a home, with "none" for when the drop isn't known yet.
function dropSelect(value) {
  return selectEl([...DROP_COUNTS.map((n) => ({ value: n, label: `${n}F drop` })),
    { value: 0, label: "No drop cable yet" }], value);
}

function addHomeForm(fromId) {
  openForm(`Add a home after ${point(fromId).name}`, (body, foot) => {
    const address = inputEl("text", "", { placeholder: "e.g. 123 Main St" });
    const lot = inputEl("text", "", { placeholder: "e.g. 12" });
    const drop = dropSelect(1);
    body.append(fieldEl("Address", address, "Leave blank if it doesn't have one yet."),
      fieldEl("Lot number", lot), fieldEl("Drop cable", drop));
    formButtons(foot, () => {
      const a = address.value.trim();
      const l = cleanLot(lot.value);
      if (!a && !l) return "Enter an address, a lot number, or both.";
      const stop = addLocation(fromId, "nid", a || lotName(l), l ? { lot: l } : {});
      const fibers = Number(drop.value);
      if (fibers) plan.cables.push({ id: makeId(), name: nextCableName("cable", true), from: fromId, to: stop.id, fibers });
      finish();
    }, "Add");
  });
}

// --- Homes: address or lot ---
// Homes are often placed on lots before they have an address. A home
// then goes by "Lot 12" until the address is known; the lot is kept.

function lotName(lot) {
  return /^lot\b/i.test(lot) ? lot : `Lot ${lot}`;
}

function cleanLot(lot) {
  return lot.trim().replace(/^lot\s*#?\s*/i, "");
}

function hasAddress(p) {
  return !p.lot || p.name !== lotName(p.lot);
}

function renameStop(id) {
  const p = point(id);
  if (p.type === "nid") {
    return openForm(`Address / lot for ${p.name}`, (body, foot) => {
      const address = inputEl("text", hasAddress(p) ? p.name : "");
      const lot = inputEl("text", p.lot || "");
      body.append(fieldEl("Address", address), fieldEl("Lot number", lot));
      formButtons(foot, () => {
        const a = address.value.trim();
        const l = cleanLot(lot.value);
        if (!a && !l) return "Enter an address, a lot number, or both.";
        p.name = a || lotName(l);
        if (l) p.lot = l;
        else delete p.lot;
        finish();
      });
    });
  }
  openForm(`Rename ${p.name}`, (body, foot) => {
    const name = inputEl("text", p.name);
    body.append(fieldEl("Name", name));
    formButtons(foot, () => {
      if (!name.value.trim()) return "Enter a name.";
      const was = p.name;
      p.name = name.value.trim();
      renameWithLocation(p, was);
      finish();
    });
    name.select();
  });
}

// A field location can be switched to another kind, e.g. an old "Splice"
// location to the handhole it really is.
function changeTypeForm(id) {
  const p = point(id);
  openForm(`Change ${p.name}`, (body, foot) => {
    const types = ["handhole", "pedestal", "vault", "manhole", "other"];
    const kind = selectEl(types.map((t) => ({ value: t, label: typeLabel(t) })), types.includes(p.type) ? p.type : "handhole");
    body.append(fieldEl("Location type", kind));
    formButtons(foot, () => {
      p.type = kind.value;
      p.label = typeLabel(kind.value);
      finish();
    });
  });
}

function removeStop(id) {
  const p = point(id);
  // Everything fed from this location goes with it.
  const doomed = new Set();
  (function collect(pid) {
    doomed.add(pid);
    childPaths(pid).forEach((x) => collect(x.to));
  })(id);
  const extra = doomed.size - 1;
  closeMenu();
  openForm(`Remove ${p.name}?`, (body, foot) => {
    if (extra) body.append(el("p", "warn", `${plural(extra, "more location")} fed from it will go too.`));
    else body.append(el("p", "", `${typeLabel(p.type)} ${p.name} will be removed.`));
    formButtons(foot, () => {
      finish();
      withUndo(extra ? `Removed ${p.name} and the ${plural(extra, "location")} fed from it.` : `Removed ${p.name}.`, () => {
        plan.points = plan.points.filter((x) => !doomed.has(x.id));
        plan.paths = plan.paths.filter((x) => !doomed.has(x.to));
        plan.cables = plan.cables.filter((c) => !doomed.has(c.to));
        plan.xconnects = plan.xconnects.filter((x) => !doomed.has(x.at));
      });
    }, "Remove");
  });
}

// Offer the last plan as a button on the splash, never open it on its own.
const resumeBtn = document.getElementById("resume-plan");
function renderResume() {
  resumeBtn.hidden = !draft;
  if (draft) resumeBtn.querySelector("span").textContent = draft.title || draft.points[0]?.name || "last plan";
}
resumeBtn.addEventListener("click", () => {
  if (!draft) return;
  plan = draft;
  draft = null;
  migrateCounts(plan);
  autoCounts();
  stampEdit();
  resetEditBaseline();
  show("route");
});

// Always start on the splash. Waits for the other scripts, which the
// route drawing uses.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
document.addEventListener("DOMContentLoaded", () => {
  applyUser();
  renderResume();
  show("splash");
});
