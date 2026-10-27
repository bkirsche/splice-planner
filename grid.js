// The Grid layout, for people who want to arrange the route themselves.
// Every location sits in a cell of a grid. Hovering a location shows a +
// on each side, so the route can grow up, down, left or right, not just
// to the right. "Unlock" lets you drag locations to other cells; they
// snap into place, can't sit on top of each other, and can't be dragged
// far from the locations they connect to.
//
// Where each location sits is part of the plan (point.cell), so the
// arrangement is saved with the plan file and everyone sees the same one.
// Locations added in the other layouts get a cell next to the location
// that feeds them the first time the grid is drawn.

const CELL_W = 340;
const CELL_H = 170;
// How far (in cells) a location can be from what it connects to.
const GRID_REACH = 4;
const DIRS = {
  right: { dc: 1, dr: 0, label: "to the right of" },
  down: { dc: 0, dr: 1, label: "below" },
  left: { dc: -1, dr: 0, label: "to the left of" },
  up: { dc: 0, dr: -1, label: "above" },
};

let gridUnlocked = false;
// The side of the location whose + was pressed, for where the new one goes.
let gridAdd = null;

const cellKey = (c, r) => `${c},${r}`;

function hasCell(p) {
  return p && p.cell && Number.isFinite(p.cell.c) && Number.isFinite(p.cell.r);
}

function takenCells(exceptId) {
  const taken = new Set();
  for (const p of plan.points) if (p.id !== exceptId && hasCell(p)) taken.add(cellKey(p.cell.c, p.cell.r));
  return taken;
}

// The first free cell going one way from a cell: straight out first, then
// a little to either side, then further out.
function freeToward(cell, dir, taken = takenCells()) {
  const d = DIRS[dir] || DIRS.right;
  for (let k = 1; k <= GRID_REACH; k++) {
    for (const s of [0, 1, -1, 2, -2, 3, -3]) {
      const c = cell.c + d.dc * k + (d.dc ? 0 : s);
      const r = cell.r + d.dr * k + (d.dr ? 0 : s);
      if (!taken.has(cellKey(c, r))) return { c, r };
    }
  }
  return null;
}

// Any free cell, nearest first, leaning right.
function freeNear(cell, taken = takenCells()) {
  for (const dir of ["right", "down", "up", "left"]) {
    const hit = freeToward(cell, dir, taken);
    if (hit) return hit;
  }
  for (let k = GRID_REACH + 1; ; k++) {
    for (let r = -k; r <= k; r++) if (!taken.has(cellKey(cell.c + k, cell.r + r))) return { c: cell.c + k, r: cell.r + r };
  }
}

// The left-to-right route laid on the grid: a column per step, a row per
// branch, each location in line with its middle branch.
function tidyCells() {
  let row = 0;
  const walk = (id, col) => {
    const p = point(id);
    const kids = childPaths(id);
    if (!kids.length) {
      p.cell = { c: col, r: row++ };
      return p.cell.r;
    }
    const rows = kids.map((x) => walk(x.to, col + 1));
    p.cell = { c: col, r: rows[Math.floor((rows.length - 1) / 2)] };
    return p.cell.r;
  };
  walk(plan.points[0].id, 0);
}

// Give a cell to every location that doesn't have one yet.
function placeMissing() {
  if (!plan.points.some(hasCell)) return tidyCells();
  const taken = takenCells();
  for (const p of routeOrder()) {
    if (hasCell(p)) continue;
    const from = incomingPath(p.id);
    const parent = from && point(from.from);
    p.cell = freeNear(hasCell(parent) ? parent.cell : { c: -1, r: 0 }, taken);
    taken.add(cellKey(p.cell.c, p.cell.r));
  }
}

// A location just added (app.js addLocation) goes on the side whose + was
// pressed, or to the right.
function gridPlace(stop, fromId) {
  const parent = point(fromId);
  if (!hasCell(parent)) return;
  const dir = layoutNow() === "grid" && gridAdd && gridAdd.from === fromId ? gridAdd.dir : "right";
  stop.cell = freeToward(parent.cell, dir) || freeNear(parent.cell);
}

// Where a location may go: a free cell, close to what feeds it and to
// what it feeds.
function moveProblem(p, cell) {
  if (takenCells(p.id).has(cellKey(cell.c, cell.r))) return "That spot is taken.";
  const from = incomingPath(p.id);
  const near = [...(from ? [point(from.from)] : []), ...childPaths(p.id).map((x) => point(x.to))];
  for (const m of near) {
    if (!hasCell(m)) continue;
    if (Math.max(Math.abs(m.cell.c - cell.c), Math.abs(m.cell.r - cell.r)) > GRID_REACH) return `Too far from ${m.name}.`;
  }
  return null;
}

// --- Drawing ---

let gridBox = null; // the shown area: first column and row, size

function gridBoard() {
  placeMissing();
  const shown = plan.points.filter((p) => phaseShown(p));
  const cs = shown.map((p) => p.cell.c);
  const rs = shown.map((p) => p.cell.r);
  gridBox = { c0: Math.min(...cs), r0: Math.min(...rs) };
  gridBox.cols = Math.max(...cs) - gridBox.c0 + 1;
  gridBox.rows = Math.max(...rs) - gridBox.r0 + 1;
  const board = el("div", "grid-board" + (gridUnlocked ? " unlocked" : ""));
  board.style.width = gridBox.cols * CELL_W + "px";
  board.style.height = gridBox.rows * CELL_H + "px";
  board.style.setProperty("--cell-w", CELL_W + "px");
  board.style.setProperty("--cell-h", CELL_H + "px");
  const taken = takenCells();
  for (const p of shown) {
    const cell = el("div", "grid-cell");
    cell.dataset.id = p.id;
    cell.style.left = (p.cell.c - gridBox.c0) * CELL_W + "px";
    cell.style.top = (p.cell.r - gridBox.r0) * CELL_H + "px";
    const card = el("div", "grid-card");
    card.append(stopEl(p));
    if (p.type !== "nid" && !gridUnlocked) {
      for (const dir of Object.keys(DIRS)) {
        if (!freeToward(p.cell, dir, taken)) continue;
        const b = btnEl("+", (e) => {
          gridAdd = { from: p.id, dir };
          openAddMenu(p.id, e);
          const cap = menu.querySelector(".menu-cap");
          if (cap) cap.textContent = `Add a location ${DIRS[dir].label} ${p.name}`;
        }, `add-dir add-${dir}`);
        b.title = `Add a location ${DIRS[dir].label} ${p.name}`;
        b.setAttribute("aria-label", b.title);
        card.append(b);
      }
    }
    cell.append(card);
    board.append(cell);
  }
  return board;
}

// The lines between locations. Each one finds its own way through the
// gaps between cards (routeLines), with an arrow into the location it
// feeds and the cable's name beside it, clear of the cards. Measured once
// the cards are laid out.
function drawGridLines() {
  const board = tree.querySelector(".grid-board");
  if (!board) return;
  for (const old of board.querySelectorAll(":scope > .grid-lines, :scope > .grid-label")) old.remove();
  const z = routeZoom();
  const base = board.getBoundingClientRect();
  if (!base.width) return;
  const boxes = new Map();
  for (const s of board.querySelectorAll(".grid-cell .stop")) {
    const r = s.getBoundingClientRect();
    const x = Math.round((r.left - base.left) / z);
    const y = Math.round((r.top - base.top) / z);
    const w = Math.round(r.width / z);
    const h = Math.round(r.height / z);
    boxes.set(s.dataset.id, { l: x, r: x + w, t: y, b: y + h, cx: x + w / 2, cy: y + h / 2 });
  }
  const links = [];
  for (const path of plan.paths) {
    const a = point(path.from);
    const b = point(path.to);
    if (!a || !b || !phaseShown(b) || !boxes.has(a.id) || !boxes.has(b.id)) continue;
    links.push({ id: path.to, path, a, b, A: boxes.get(a.id), B: boxes.get(b.id) });
  }
  const routes = routeLines(boxes, links);
  const wires = [];
  const wireRoutes = new Map();
  for (const k of links) {
    const cables = pathCables(k.path);
    for (const [i, c] of (cables.length ? cables : [null]).entries()) {
      const id = wires.length;
      const pts = offsetRoute(routes.get(k.id), c ? (i - (cables.length - 1) / 2) * 6 : 0);
      wires.push({ k, c, id, pts });
      wireRoutes.set(id, pts);
    }
  }
  const hops = crossings(wireRoutes);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "grid-lines");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", board.offsetWidth);
  svg.setAttribute("height", board.offsetHeight);
  const labels = [];
  for (const { k, c, id, pts } of wires) {
    const { path } = k;
    const color = wireColor(c);
    const cls = "grid-wire" + (c ? "" : " empty") + (c && phasePast(c) ? " past" : "") + (path.to === openPathId ? " selected" : "");
    const line = document.createElementNS(SVG_NS, "path");
    line.setAttribute("d", wirePath(pts, hops.get(id)));
    line.setAttribute("class", cls);
    line.style.stroke = color;
    const head = document.createElementNS(SVG_NS, "path");
    head.setAttribute("d", arrowHead(pts));
    head.setAttribute("class", "grid-arrow" + (c ? "" : " empty"));
    head.style.fill = color;
    svg.append(line, head);
  }
  for (const k of links) {
    const { path, a, b } = k;
    const label = el("div", "grid-label" + (pathCables(path).length ? "" : " empty") + (path.to === openPathId ? " selected" : ""));
    label.title = `${a.name} → ${b.name}`;
    label.append(cableRows(path));
    labels.push({ label, pts: routes.get(k.id) });
  }
  board.prepend(svg);
  board.append(...labels.map((x) => x.label));
  // Sizes first (one layout), then the spots.
  const sized = labels.map((x) => ({ ...x, w: x.label.offsetWidth, h: x.label.offsetHeight }));
  placeLabels(sized, [...boxes.values()]);
}

// Shift each stretch sideways; corners meet where the shifted stretches meet.
function offsetRoute(pts, offset) {
  if (!offset) return pts;
  const normals = pts.slice(1).map((b, i) => {
    const a = pts[i];
    return { x: -Math.sign(b.y - a.y), y: Math.sign(b.x - a.x) };
  });
  return pts.map((p, i) => {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(i, normals.length - 1)];
    return { x: p.x + offset * (before.x || after.x), y: p.y + offset * (before.y || after.y) };
  });
}

// --- Routing the lines ---
// A line runs only through the gaps between cards, never through or
// behind a card it doesn't join. Lines never share a stretch: each takes
// its own lane in a gap and its own spot on a card's side. Within that,
// a line takes as few turns as it can (a turn costs as much as a good
// length of line) and never doubles back. It never turns where another
// line runs, so a corner can't be mistaken for a join; where two lines
// cross, the one running across hops over the other.

const ROUTE_GAP = 9; // clear space kept around each card; the arrow fills it
const ROUTE_LANE = 10; // lines side by side in a gap sit this far apart
const ROUTE_TURN = 160; // a turn costs as much as this much more line
const ROUTE_CROSS = 40; // crossing another line
const ROUTE_CLASH = 6000; // sharing a stretch or a corner: only if there's no other way
const ROUTE_SIDE = 300; // leaving by the side a line arrives on, or the other way round
const ROUTE_HUG = 0.5; // extra per unit of line run right along a card's edge
const HOP_R = 5;
const DIR_STEP = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up

let routeCache = { key: "", routes: null };

function routeLines(boxes, links) {
  const key = JSON.stringify([[...boxes], links.map((k) => [k.id, k.a.id, k.b.id])]);
  if (routeCache.key === key) return routeCache.routes;
  const routes = new Map();
  if (links.length) {
    const lat = routeLattice([...boxes.values()]);
    // From the start outwards, so a location's feed is in place before
    // the lines leaving it; short hops first at each step.
    const depth = (id) => {
      let n = 0;
      for (let x = incomingPath(id); x && n < 999; x = incomingPath(x.from)) n++;
      return n;
    };
    const order = [...links].map((k) => ({ k, d: depth(k.b.id) })).sort((p, q) => p.d - q.d || linkSpan(p.k) - linkSpan(q.k)).map((x) => x.k);
    for (const k of order) routes.set(k.id, routeOne(lat, k) || plainRoute(k));
  }
  routeCache = { key, routes };
  return routes;
}

function linkSpan(k) {
  return Math.abs(k.A.cx - k.B.cx) + Math.abs(k.A.cy - k.B.cy);
}

// The places a line may run: lines along every card's clear edge, through
// its side spots, and lanes spread across each gap between cards.
function routeLattice(cards) {
  const g = ROUTE_GAP;
  const inflated = cards.map((c) => ({ l: c.l - g, r: c.r + g, t: c.t - g, b: c.b + g }));
  const lo = { x: Math.min(...inflated.map((c) => c.l)) - 3 * ROUTE_LANE, y: Math.min(...inflated.map((c) => c.t)) - 3 * ROUTE_LANE };
  const hi = { x: Math.max(...inflated.map((c) => c.r)) + 3 * ROUTE_LANE, y: Math.max(...inflated.map((c) => c.b)) + 3 * ROUTE_LANE };
  const axis = (lo, hi, spans, spots) => {
    const out = new Set([lo, hi, ...spots]);
    for (const [a, b] of spans) out.add(a).add(b);
    // Lanes across every free gap between the cards' spans.
    const merged = [];
    for (const [a, b] of [...spans].sort((p, q) => p[0] - q[0])) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    let prev = lo;
    for (const [a, b] of [...merged, [hi, hi]]) {
      const w = a - prev;
      const n = Math.max(1, Math.floor(w / ROUTE_LANE));
      if (w > 0) for (let i = 0; i < n; i++) out.add(prev + ((i + 0.5) * w) / n);
      prev = Math.max(prev, b);
    }
    return [...out].map((v) => Math.round(v * 10) / 10).sort((p, q) => p - q).filter((v, i, s) => i === 0 || v !== s[i - 1]);
  };
  const spots = (c, along) => (along === "x" ? sideSpots(c.l, c.r) : sideSpots(c.t, c.b)).map((s) => s.v);
  const xs = axis(lo.x, hi.x, inflated.map((c) => [c.l, c.r]), cards.flatMap((c) => spots(c, "x")));
  const ys = axis(lo.y, hi.y, inflated.map((c) => [c.t, c.b]), cards.flatMap((c) => spots(c, "y")));
  const nx = xs.length;
  const ny = ys.length;
  // Closed: inside a card's clear space. A stretch between two lattice
  // points is closed if its middle is.
  const closed = new Uint8Array(nx * ny);
  const hClosed = new Uint8Array(nx * ny);
  const vClosed = new Uint8Array(nx * ny);
  // Stretches right along a card's clear edge: allowed, but a lane out in
  // the gap is better, so crossings stay clear of the arrows.
  const hHug = new Uint8Array(nx * ny);
  const vHug = new Uint8Array(nx * ny);
  const range = (vals, a, b) => {
    let i = 0;
    while (i < vals.length && vals[i] <= a) i++;
    const out = [];
    for (; i < vals.length && vals[i] < b; i++) out.push(i);
    return out;
  };
  for (const c of inflated) {
    const ix = range(xs, c.l, c.r);
    const iy = range(ys, c.t, c.b);
    for (const j of iy) for (const i of ix) closed[j * nx + i] = 1;
    // Stretches from the edge into the card or across it.
    const ixe = range(xs, c.l - 0.01, c.r).filter((i) => i < nx - 1 && xs[i + 1] <= c.r + 0.01);
    for (const j of iy) for (const i of ixe) hClosed[j * nx + i] = 1;
    const iye = range(ys, c.t - 0.01, c.b).filter((j) => j < ny - 1 && ys[j + 1] <= c.b + 0.01);
    for (const i of ix) for (const j of iye) vClosed[j * nx + i] = 1;
    const at = (vals, v) => vals.indexOf(Math.round(v * 10) / 10);
    for (const j of [at(ys, c.t), at(ys, c.b)]) if (j >= 0) for (const i of ixe) hHug[j * nx + i] = 1;
    for (const i of [at(xs, c.l), at(xs, c.r)]) if (i >= 0) for (const j of iye) vHug[j * nx + i] = 1;
  }
  const idx = (vals, v) => {
    const r = Math.round(v * 10) / 10;
    let a = 0;
    let b = vals.length - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      if (vals[m] === r) return m;
      if (vals[m] < r) a = m + 1;
      else b = m - 1;
    }
    return -1;
  };
  // How far each lane is from the nearest card edge: lanes in the middle
  // of a gap are a little cheaper, so crossings stay out in the open.
  const near = (vals, edges) => vals.map((v) => {
    const d = Math.min(...edges.map((e) => Math.abs(v - e)));
    return Math.max(0, 1 - d / (5 * ROUTE_LANE)) * 0.8;
  });
  const nearX = near(xs, inflated.flatMap((c) => [c.l, c.r]));
  const nearY = near(ys, inflated.flatMap((c) => [c.t, c.b]));
  return { xs, ys, nx, ny, closed, hClosed, vClosed, hHug, vHug, nearX, nearY, idx, edgeUse: new Map(), nodeUse: new Map(), sideUse: new Set(), portUse: new Set() };
}

// The spots on each side of a card where a line can leave or arrive:
// [{ x, y, dir (pointing out of the card), edge: the point on the card }].
function sidePorts(lat, c) {
  const g = ROUTE_GAP;
  const out = [];
  const add = (x, y, dir, ex, ey, k) => {
    const i = lat.idx(lat.xs, x);
    const j = lat.idx(lat.ys, y);
    if (i >= 0 && j >= 0 && !lat.closed[j * lat.nx + i]) out.push({ n: j * lat.nx + i, dir, edge: { x: ex, y: ey }, off: Math.abs(k) });
  };
  for (const { v: y, off } of sideSpots(c.t, c.b)) {
    add(c.r + g, y, 0, c.r, y, off);
    add(c.l - g, y, 2, c.l, y, off);
  }
  for (const { v: x, off } of sideSpots(c.l, c.r)) {
    add(x, c.b + g, 1, x, c.b, off);
    add(x, c.t - g, 3, x, c.t, off);
  }
  return out;
}

// The spots along one side of a card (from lo to hi) where lines meet it,
// nearest the middle first: up to seven, on lanes shared by every card
// (whole multiples of ROUTE_LANE), so cards side by side line up and a
// line between them runs dead straight instead of jogging a few pixels.
function sideSpots(lo, hi) {
  const mid = (lo + hi) / 2;
  const out = [];
  for (let v = Math.ceil((lo + 6) / ROUTE_LANE) * ROUTE_LANE; v <= hi - 6; v += ROUTE_LANE) out.push({ v, off: Math.round(Math.abs(v - mid) / ROUTE_LANE) });
  return out.sort((p, q) => Math.abs(p.v - mid) - Math.abs(q.v - mid)).slice(0, 7);
}

// A* over (lattice point, heading).
function routeOne(lat, k) {
  const { xs, ys, nx, ny, closed, hClosed, vClosed, hHug, vHug, nearX, nearY, edgeUse, nodeUse, sideUse, portUse } = lat;
  const starts = sidePorts(lat, k.A);
  const goals = new Map();
  for (const p of sidePorts(lat, k.B)) goals.set(p.n, p);
  if (!starts.length || !goals.size) return null;
  const B = { l: k.B.l - ROUTE_GAP, r: k.B.r + ROUTE_GAP, t: k.B.t - ROUTE_GAP, b: k.B.b + ROUTE_GAP };
  const h = (n) => {
    const x = xs[n % nx];
    const y = ys[(n / nx) | 0];
    return Math.max(0, B.l - x, x - B.r) + Math.max(0, B.t - y, y - B.b);
  };
  const best = new Float64Array(nx * ny * 4).fill(Infinity);
  const from = new Int32Array(nx * ny * 4).fill(-1);
  const heap = [];
  const push = (s, f) => {
    heap.push([f, s]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const startOf = new Map();
  for (const p of starts) {
    const s = p.n * 4 + p.dir;
    const cost = p.off * 3 + (portUse.has(p.n) ? ROUTE_CLASH : 0) + (sideUse.has(`${k.a.id}:${p.dir}:in`) ? ROUTE_SIDE : 0);
    if (cost < best[s]) {
      best[s] = cost;
      startOf.set(s, p);
      push(s, cost + h(p.n));
    }
  }
  let end = -1;
  while (heap.length) {
    const [f, s] = pop();
    const n = (s / 4) | 0;
    const d = s & 3;
    const g = best[s];
    if (f - h(n) > g + 1e-6) continue;
    const goal = goals.get(n);
    // Arrive heading into the card, straight on.
    if (goal && d === (goal.dir + 2) % 4 && !startOf.has(s)) {
      end = s;
      break;
    }
    const i = n % nx;
    const j = (n / nx) | 0;
    const use = nodeUse.get(n);
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue; // never double back
      const [di, dj] = DIR_STEP[nd];
      const i2 = i + di;
      const j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
      const n2 = j2 * nx + i2;
      if (closed[n2] && !goals.has(n2)) continue;
      // The stretch between the two points.
      const en = dj === 0 ? j * nx + Math.min(i, i2) : Math.min(j, j2) * nx + i;
      if ((dj === 0 ? hClosed : vClosed)[en]) continue;
      const len = dj === 0 ? Math.abs(xs[i2] - xs[i]) : Math.abs(ys[j2] - ys[j]);
      let cost = len;
      if ((dj === 0 ? hHug : vHug)[en]) cost += len * ROUTE_HUG;
      cost += len * (dj === 0 ? nearY[j] : nearX[i]);
      const goal2 = goals.get(n2);
      if (goal2 && nd === (goal2.dir + 2) % 4 && sideUse.has(`${k.b.id}:${goal2.dir}:out`)) cost += ROUTE_SIDE;
      const turn = nd !== d;
      if (turn) cost += ROUTE_TURN;
      if (edgeUse.has((dj === 0 ? "h" : "v") + en)) cost += ROUTE_CLASH;
      if (use) {
        // Turning where another line runs, or running through its corner,
        // would read as a join.
        if (turn || use.corner) cost += ROUTE_CLASH;
        else if ((nd & 1 ? use.h : use.v)) cost += ROUTE_CROSS;
      }
      const s2 = n2 * 4 + nd;
      if (g + cost < best[s2]) {
        best[s2] = g + cost;
        from[s2] = s;
        push(s2, g + cost + h(n2));
      }
    }
  }
  if (end < 0) return null;
  // Walk back, then claim the stretches, corners and spots used.
  const states = [];
  for (let s = end; s >= 0; s = from[s]) states.unshift(s);
  const first = startOf.get(states[0]);
  const goal = goals.get((end / 4) | 0);
  const pts = [first.edge];
  for (let q = 0; q < states.length; q++) {
    const n = (states[q] / 4) | 0;
    const p = { x: xs[n % nx], y: ys[(n / nx) | 0] };
    const dIn = q === 0 ? first.dir : states[q] & 3;
    const dOut = q === states.length - 1 ? dIn : states[q + 1] & 3;
    const use = nodeUse.get(n) || {};
    if (dIn !== dOut) use.corner = true;
    else if (dIn & 1) use.v = true;
    else use.h = true;
    nodeUse.set(n, use);
    if (q > 0) {
      const m = (states[q - 1] / 4) | 0;
      const horiz = (m / nx | 0) === (n / nx | 0);
      edgeUse.set((horiz ? "h" : "v") + Math.min(m, n), true);
    }
    pts.push(p);
  }
  portUse.add(first.n);
  portUse.add(goal.n);
  sideUse.add(`${k.a.id}:${first.dir}:out`);
  sideUse.add(`${k.b.id}:${goal.dir}:in`);
  return simplify(pts);
}

// Drop the points in the middle of straight runs.
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) out.pop();
    }
    out.push(p);
  }
  return out;
}

// No way through (shouldn't happen): the plain line across and in.
function plainRoute(k) {
  const { A, B } = k;
  const s = Math.sign(B.cx - A.cx) || 1;
  const x0 = s > 0 ? A.r : A.l;
  const x1 = s > 0 ? B.l - ROUTE_GAP : B.r + ROUTE_GAP;
  const xm = x0 + s * WIRE_IN;
  return simplify([{ x: x0, y: A.cy }, { x: xm, y: A.cy }, { x: xm, y: B.cy }, { x: x1, y: B.cy }]);
}

// Where lines cross: for each line, the spots on its across-running
// stretches where an up-and-down stretch of another line passes.
function crossings(routes) {
  const segs = [];
  for (const [id, pts] of routes) {
    for (let i = 1; i < pts.length; i++) segs.push({ id, a: pts[i - 1], b: pts[i], i });
  }
  const hs = segs.filter((s) => s.a.y === s.b.y && s.a.x !== s.b.x);
  const vs = segs.filter((s) => s.a.x === s.b.x && s.a.y !== s.b.y);
  const hops = new Map();
  for (const h of hs) {
    const x0 = Math.min(h.a.x, h.b.x);
    const x1 = Math.max(h.a.x, h.b.x);
    const y = h.a.y;
    for (const v of vs) {
      if (v.id === h.id) continue;
      const y0 = Math.min(v.a.y, v.b.y);
      const y1 = Math.max(v.a.y, v.b.y);
      const x = v.a.x;
      if (x > x0 + HOP_R && x < x1 - HOP_R && y > y0 && y < y1) {
        if (!hops.has(h.id)) hops.set(h.id, new Map());
        const per = hops.get(h.id);
        if (!per.has(h.i)) per.set(h.i, []);
        per.get(h.i).push(x);
      }
    }
  }
  return hops;
}

const R1 = (v) => Math.round(v * 10) / 10;

// The line as an SVG path, hopping over the lines it crosses.
function wirePath(pts, hops) {
  let d = `M${R1(pts[0].x)},${R1(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const xs = hops && hops.get(i);
    if (xs && a.y === b.y) {
      const s = Math.sign(b.x - a.x);
      for (const x of [...xs].sort((p, q) => s * (p - q))) {
        d += ` H${R1(x - s * HOP_R)} A${HOP_R},${HOP_R} 0 0 ${s > 0 ? 1 : 0} ${R1(x + s * HOP_R)},${R1(b.y)}`;
      }
    }
    d += a.y === b.y ? ` H${R1(b.x)}` : ` V${R1(b.y)}`;
  }
  return d;
}

// The arrow on the last stretch, its tip on the card.
function arrowHead(pts) {
  const b = pts[pts.length - 1];
  const a = pts[pts.length - 2] || b;
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  const tip = { x: b.x + dx * ROUTE_GAP, y: b.y + dy * ROUTE_GAP };
  const w = 7;
  return dx
    ? `M${R1(b.x)},${R1(b.y - w)} L${R1(tip.x)},${R1(tip.y)} L${R1(b.x)},${R1(b.y + w)} Z`
    : `M${R1(b.x - w)},${R1(b.y)} L${R1(tip.x)},${R1(tip.y)} L${R1(b.x + w)},${R1(b.y)} Z`;
}

// Each cable's name goes beside its own line, nearest the location it
// feeds, on a spot clear of every card and every name placed before.
function placeLabels(items, cards) {
  const placed = [];
  const pad = 3;
  const hits = (r) => cards.some((c) => r.l < c.r + pad && r.r > c.l - pad && r.t < c.b + pad && r.b > c.t - pad) ||
    placed.some((c) => r.l < c.r + pad && r.r > c.l - pad && r.t < c.b + pad && r.b > c.t - pad);
  for (const { label, pts, w, h } of items) {
    const tries = [];
    // The stretches from the card it feeds backwards.
    for (let i = pts.length - 1, rank = 0; i >= 1; i--, rank++) {
      const a = pts[i - 1];
      const b = pts[i];
      const horiz = a.y === b.y;
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const sides = horiz ? [[0, -(h / 2 + 5)], [0, h / 2 + 5]] : [[w / 2 + 7, 0], [-(w / 2 + 7), 0]];
        for (const [ox, oy] of sides) {
          const cx = x + ox;
          const cy = y + oy;
          // A short stretch can't hold its name alongside.
          const fits = horiz ? len >= w * 0.6 : len >= h + 6;
          tries.push({ cx, cy, score: rank * 40 + Math.abs(t - 0.5) * 30 + (fits ? 0 : 200) + (oy > 0 || ox < 0 ? 5 : 0) });
        }
      }
    }
    tries.sort((p, q) => p.score - q.score);
    const rect = (p) => ({ l: p.cx - w / 2, r: p.cx + w / 2, t: p.cy - h / 2, b: p.cy + h / 2 });
    const spot = tries.find((p) => !hits(rect(p))) || tries[0];
    if (!spot) continue;
    placed.push(rect(spot));
    label.style.left = R1(spot.cx) + "px";
    label.style.top = R1(spot.cy) + "px";
  }
}

// --- Lock, unlock and tidy (zoom bar) ---

const gridLockBtn = document.getElementById("grid-lock");
const gridTidyBtn = document.getElementById("grid-tidy");
const routeHint = document.querySelector(".route-hint");
const HINT_ROUTE = routeHint.innerHTML;

function renderGridButtons() {
  const on = layoutNow() === "grid" && !isGuest() && !planEmpty();
  if (!on) gridUnlocked = false;
  gridLockBtn.hidden = !on;
  gridTidyBtn.hidden = !on;
  gridLockBtn.classList.toggle("on", gridUnlocked);
  gridLockBtn.replaceChildren(iconEl(gridUnlocked ? "unlock" : "lock"), document.createTextNode(gridUnlocked ? " Lock" : " Unlock"));
  gridLockBtn.title = gridUnlocked ? "Lock the locations in place" : "Unlock to drag locations around the grid";
  routeHint.innerHTML = planEmpty() ? "Tap the <b>Start</b> card to place the first location: a cabinet, a handhole or anything else."
    : layoutNow() !== "grid" ? HINT_ROUTE : gridUnlocked
    ? "Unlocked: drag a location to another spot on the grid. It snaps into place. Tap <b>Lock</b> when you're done."
    : "Point at a location for a <b>+</b> on each side: the next location goes that way. Tap a location for its options, or a line for its cable. <b>Unlock</b> to move locations around. Shift-click homes or Shift-drag a box (or tap <b>Select</b>) to pick several.";
  renderPicks();
}

gridLockBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (guestBlocked()) return;
  gridUnlocked = !gridUnlocked;
  closeMenu();
  selectedId = null;
  renderRoute();
  if (gridUnlocked) showNote("Drag a location to move it. It snaps to the grid. Tap Lock when you're done.");
});

gridTidyBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (guestBlocked() || emptyBlocked()) return;
  withUndo("Laid the route out left to right again.", () => {
    for (const p of plan.points) delete p.cell;
    tidyCells();
  });
  fitAll();
});

// --- Dragging a location (unlocked) ---
// Starts before the canvas sees the press, so the canvas doesn't pan.

let gridDrag = null;

routeView.addEventListener("pointerdown", (e) => {
  if (layoutNow() !== "grid" || !gridUnlocked || e.button !== 0) return;
  const cellEl = e.target.closest(".grid-cell");
  if (!cellEl || !e.target.closest(".stop")) return;
  e.stopImmediatePropagation();
  const p = point(cellEl.dataset.id);
  // A picked home brings the other picked homes along.
  const group = gridPicked.has(p.id) && gridPicked.size > 1 ? pickedLocs() : [p];
  const groupEls = group.map((m) => tree.querySelector(`.grid-cell[data-id="${CSS.escape(m.id)}"]`)).filter(Boolean);
  gridDrag = { p, cellEl, group, groupEls, x0: e.clientX, y0: e.clientY, moved: false, target: null, ghost: null };
  routeView.setPointerCapture(e.pointerId);
}, true);

routeView.addEventListener("pointermove", (e) => {
  if (!gridDrag) return;
  e.stopImmediatePropagation();
  const z = routeZoom();
  const dx = (e.clientX - gridDrag.x0) / z;
  const dy = (e.clientY - gridDrag.y0) / z;
  if (!gridDrag.moved && Math.hypot(dx * z, dy * z) < 6) return;
  if (!gridDrag.moved) {
    gridDrag.moved = true;
    for (const c of gridDrag.groupEls) c.classList.add("dragging");
    gridDrag.ghost = el("div", "grid-ghost");
    gridDrag.cellEl.parentElement.append(gridDrag.ghost);
  }
  for (const c of gridDrag.groupEls) c.style.transform = `translate(${dx}px, ${dy}px)`;
  const p = gridDrag.p;
  const target = { c: p.cell.c + Math.round(dx / CELL_W), r: p.cell.r + Math.round(dy / CELL_H) };
  const same = target.c === p.cell.c && target.r === p.cell.r;
  gridDrag.target = target;
  gridDrag.problem = same ? null : groupProblem(gridDrag.group, target.c - p.cell.c, target.r - p.cell.r);
  const g = gridDrag.ghost;
  g.style.left = (target.c - gridBox.c0) * CELL_W + "px";
  g.style.top = (target.r - gridBox.r0) * CELL_H + "px";
  g.classList.toggle("bad", !!gridDrag.problem);
  g.textContent = gridDrag.problem || "";
}, true);

function endGridDrag(e) {
  if (!gridDrag) return;
  e.stopImmediatePropagation();
  const { p, moved, target, problem, group } = gridDrag;
  gridDrag = null;
  if (!moved) return;
  // The press was a drag, not a tap on the card (pan.js).
  swallowClick = true;
  const same = !target || (target.c === p.cell.c && target.r === p.cell.r);
  if (same || problem || e.type === "pointercancel") {
    renderRoute();
    if (problem) showNote(problem);
    return;
  }
  const dc = target.c - p.cell.c;
  const dr = target.r - p.cell.r;
  withUndo(group.length > 1 ? `Moved ${group.length} homes.` : `Moved ${p.name}.`, () => {
    for (const m of group) m.cell = { c: m.cell.c + dc, r: m.cell.r + dr };
  });
}

// Moving several locations by the same step: each needs a free cell
// (the group's own cells free up) close to what it connects to.
function groupProblem(group, dc, dr) {
  if (group.length === 1) return moveProblem(group[0], { c: group[0].cell.c + dc, r: group[0].cell.r + dr });
  const ids = new Set(group.map((m) => m.id));
  const taken = new Set(plan.points.filter((x) => !ids.has(x.id) && hasCell(x)).map((x) => cellKey(x.cell.c, x.cell.r)));
  const at = (m) => (ids.has(m.id) ? { c: m.cell.c + dc, r: m.cell.r + dr } : m.cell);
  for (const m of group) {
    const cell = at(m);
    if (taken.has(cellKey(cell.c, cell.r))) return `No room for ${m.name} there.`;
    const from = incomingPath(m.id);
    const near = [...(from ? [point(from.from)] : []), ...childPaths(m.id).map((x) => point(x.to))];
    for (const n of near) {
      if (!hasCell(n)) continue;
      const nc = at(n);
      if (Math.max(Math.abs(nc.c - cell.c), Math.abs(nc.r - cell.r)) > GRID_REACH) return `${m.name} would be too far from ${n.name}.`;
    }
  }
  return null;
}

routeView.addEventListener("pointerup", endGridDrag, true);
routeView.addEventListener("pointercancel", endGridDrag, true);

// --- Picking several homes (grid) ---
// Shift- or Ctrl-click homes, or Shift-drag a box around them, to pick
// several at once; on a touch screen, turn on Select and tap or drag.
// Picked homes can be moved together (Unlock, then drag any one of
// them), fed from one location and put on one splitter or terminal, or
// removed, in one go.

const gridPicked = new Set();
let gridSelecting = false;
const gridSelectBtn = document.getElementById("grid-select");
const pickBar = el("div", "pick-bar");
pickBar.hidden = true;
pickBar.setAttribute("role", "status");
routeView.append(pickBar);
pickBar.addEventListener("click", (e) => e.stopPropagation());

function pickedHomes() {
  return pickedLocs().filter((p) => p.type === "nid");
}

// Anything but the start can be picked.
function pickedLocs() {
  return plan ? plan.points.filter((p) => gridPicked.has(p.id) && p.id !== plan.points[0].id) : [];
}

function renderPicks() {
  const on = !!plan && layoutNow() === "grid" && !isGuest() && !planEmpty();
  gridSelectBtn.hidden = !on;
  if (!on) {
    gridSelecting = false;
    gridPicked.clear();
  }
  gridSelectBtn.classList.toggle("on", gridSelecting);
  gridSelectBtn.textContent = gridSelecting ? "Done" : "Select";
  gridSelectBtn.title = gridSelecting ? "Stop picking" : "Pick several locations: tap them or drag a box around them";
  routeView.classList.toggle("selecting", gridSelecting);
  const picked = pickedLocs();
  const homes = pickedHomes();
  for (const id of [...gridPicked]) if (!picked.some((h) => h.id === id)) gridPicked.delete(id);
  for (const cell of tree.querySelectorAll(".grid-cell")) cell.classList.toggle("picked", gridPicked.has(cell.dataset.id));
  pickBar.hidden = !picked.length && !gridSelecting;
  pickBar.innerHTML = "";
  if (pickBar.hidden) return;
  if (!picked.length) {
    pickBar.append(el("span", "pick-text", "Tap locations or drag a box around them."));
    return;
  }
  const allHomes = homes.length === picked.length;
  pickBar.append(el("span", "pick-text", allHomes ? `${plural(homes.length, "home")} picked` : `${plural(picked.length, "location")} picked`),
    btnEl("Move", () => {
      if (!gridUnlocked) {
        gridUnlocked = true;
        renderRoute();
      }
      showNote("Drag any picked location: the others move with it. Tap Lock when you're done.");
    }, "btn ghost small"),
    ...(allHomes ? [btnEl("Feed from…", () => openFeedPicked(), "btn ghost small")] : []),
    btnEl("Remove", () => removePicked(), "btn ghost small danger"),
    btnEl("Clear", () => {
      gridPicked.clear();
      renderPicks();
    }, "btn ghost small"));
}

gridSelectBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (guestBlocked()) return;
  gridSelecting = !gridSelecting;
  if (!gridSelecting) gridPicked.clear();
  closeMenu();
  renderPicks();
});

function togglePick(id) {
  const p = point(id);
  if (!p) return;
  if (id === plan.points[0].id) return showNote("The start can't be picked.");
  if (gridPicked.has(id)) gridPicked.delete(id);
  else gridPicked.add(id);
  closeMenu();
  renderPicks();
}

// Shift / Ctrl / Cmd-click, or any tap while Select is on, picks a home
// instead of opening its menu.
routeView.addEventListener("click", (e) => {
  if (layoutNow() !== "grid" || isGuest()) return;
  if (!gridSelecting && !e.shiftKey && !e.ctrlKey && !e.metaKey) return;
  const card = e.target.closest(".grid-cell .stop");
  if (!card) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  togglePick(card.dataset.id);
}, true);

// Shift-drag (or drag while Select is on) on the background draws a box;
// the homes it touches are picked.
let lasso = null;

routeView.addEventListener("pointerdown", (e) => {
  if (layoutNow() !== "grid" || isGuest() || e.button !== 0 || (!gridSelecting && !e.shiftKey)) return;
  if (e.target.closest(".stop, .grid-label, .add-dir, .zoom-bar, .minimap, .pick-bar")) return;
  e.stopImmediatePropagation();
  const box = el("div", "grid-lasso");
  routeView.append(box);
  lasso = { x0: e.clientX, y0: e.clientY, box, add: e.shiftKey || gridSelecting };
  routeView.setPointerCapture(e.pointerId);
  moveLasso(e);
}, true);

function lassoRect(e) {
  return { l: Math.min(lasso.x0, e.clientX), r: Math.max(lasso.x0, e.clientX), t: Math.min(lasso.y0, e.clientY), b: Math.max(lasso.y0, e.clientY) };
}

function moveLasso(e) {
  const v = routeView.getBoundingClientRect();
  const r = lassoRect(e);
  Object.assign(lasso.box.style, { left: r.l - v.left + "px", top: r.t - v.top + "px", width: r.r - r.l + "px", height: r.b - r.t + "px" });
}

routeView.addEventListener("pointermove", (e) => {
  if (!lasso) return;
  e.stopImmediatePropagation();
  moveLasso(e);
}, true);

function endLasso(e) {
  if (!lasso) return;
  e.stopImmediatePropagation();
  const r = lassoRect(e);
  lasso.box.remove();
  lasso = null;
  if (r.r - r.l < 4 && r.b - r.t < 4) return;
  swallowClick = true;
  if (e.type === "pointercancel") return;
  for (const card of tree.querySelectorAll(".grid-cell .stop:not(.start)")) {
    const c = card.getBoundingClientRect();
    if (c.right > r.l && c.left < r.r && c.bottom > r.t && c.top < r.b) gridPicked.add(card.dataset.id);
  }
  renderPicks();
}

routeView.addEventListener("pointerup", endLasso, true);
routeView.addEventListener("pointercancel", endLasso, true);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || (!gridPicked.size && !gridSelecting)) return;
  gridPicked.clear();
  gridSelecting = false;
  if (plan) renderPicks();
});

// Feed the picked homes from one location, and put them on one splitter
// (DS ports) or terminal (its ports), in address order.
function openFeedPicked() {
  const homes = sortHomes(pickedHomes());
  if (!homes.length) return;
  const feeders = plan.points.filter((p) => p.type !== "nid");
  const first = homeLocation(homes[0]);
  openForm(`Feed ${homes.length} home${homes.length === 1 ? "" : "s"}`, (body, foot) => {
    const from = selectEl(feeders.map((p) => ({ value: p.id, label: `${p.name} (${typeLabel(p.type)})` })), first ? first.id : feeders[0].id);
    const device = selectEl([]);
    const deviceRow = fieldEl("Put them on", device);
    body.append(el("p", "hint", homes.map((h) => h.name).join(", ")), fieldEl("Fed from", from), deviceRow);
    const free = (d) => d.type === "splitter"
      ? splitterPorts(d) - usedPorts(d).size + homes.filter((h) => h.ds && h.ds.splitterId === d.id).length
      : terminalPorts(d).filter((x) => !plan.points.some((h) => !homes.includes(h) && h.tport && h.tport.eqId === d.id && h.tport.portId === x.id)).length;
    function devices() {
      const devs = countDevices(point(from.value));
      device.replaceChildren(...selectEl([{ value: "", label: "Ports as they are (automatic)" },
        ...devs.map((d) => ({ value: d.id, label: `${d.name}${d.type === "splitter" ? "" : " (terminal)"} · ${free(d)} free` }))]).childNodes);
      deviceRow.hidden = !devs.length;
    }
    from.addEventListener("change", devices);
    devices();
    formButtons(foot, () => {
      const loc = point(from.value);
      const d = device.value ? countDevices(loc).find((x) => x.id === device.value) : null;
      if (d && free(d) < homes.length) return `Only ${free(d)} ports are free on ${d.name}, but ${homes.length} homes are picked.`;
      const before = JSON.stringify(plan);
      for (const h of homes) {
        const path = incomingPath(h.id);
        if (path.from !== loc.id) {
          path.from = loc.id;
          for (const x of pathCables(path)) {
            x.from = loc.id;
            delete x.picks;
            if (x.through) {
              delete x.through;
              delete x.prev;
              const name = nextCableName("cable", true);
              for (const s of cableSpans(x)) s.name = name;
            }
          }
        }
      }
      for (const h of homes) {
        if (d && d.type === "splitter") {
          if (!(h.ds && h.ds.splitterId === d.id)) delete h.ds;
        } else if (d) {
          if (h.tport && h.tport.eqId !== d.id) delete h.tport;
        }
      }
      for (const h of homes) {
        if (d && d.type === "splitter") {
          if (h.ds && h.ds.splitterId === d.id) continue;
          h.ds = { splitterId: d.id, port: nextFreePort(d, h.id) };
          h.dsManual = true;
        } else if (d) {
          if (h.tport && h.tport.eqId === d.id) continue;
          const taken = new Set(plan.points.filter((x) => x.tport && x.tport.eqId === d.id).map((x) => x.tport.portId));
          const port = terminalPorts(d).find((x) => !taken.has(x.id));
          if (port) h.tport = { eqId: d.id, portId: port.id };
        } else {
          // Automatic: the app picks splitter ports again; a terminal
          // port only stays where it still makes sense.
          delete h.ds;
          h.dsManual = false;
          if (h.tport && !terminalsAt(loc).some((t) => t.id === h.tport.eqId)) delete h.tport;
        }
      }
      finish();
      offerUndo(`Fed ${homes.length} home${homes.length === 1 ? "" : "s"} from ${loc.name}${d ? ` on ${d.name}` : ""}.`, before);
    }, "Feed");
  });
}

// Remove the picked locations, and everything fed from them, once the
// list has been checked.
function removePicked() {
  const picked = pickedLocs();
  const doomed = new Set();
  (function collect(ids) {
    for (const id of ids) {
      doomed.add(id);
      collect(childPaths(id).map((x) => x.to));
    }
  })(picked.map((h) => h.id));
  const extra = doomed.size - picked.length;
  const what = picked.every((p) => p.type === "nid") ? plural(picked.length, "home") : plural(picked.length, "location");
  openForm(`Remove ${what}?`, (body, foot) => {
    body.append(el("p", "", picked.map((p) => p.name).join(", ")));
    if (extra) body.append(el("p", "warn", `${plural(extra, "more location")} fed from them will go too.`));
    formButtons(foot, () => {
      gridPicked.clear();
      finish();
      withUndo(`Removed ${what}${extra ? ` and ${plural(extra, "location")} fed from them` : ""}.`, () => {
        plan.points = plan.points.filter((x) => !doomed.has(x.id));
        plan.paths = plan.paths.filter((x) => !doomed.has(x.to));
        plan.cables = plan.cables.filter((c) => !doomed.has(c.to));
        plan.xconnects = plan.xconnects.filter((x) => !doomed.has(x.at));
      });
    }, "Remove");
  });
}
