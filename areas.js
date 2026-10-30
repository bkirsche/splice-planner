// Splice areas, for big plans (Daily note 21). Every location with a
// closure starts an area that holds everything after it, up to the next
// closure; the start of the route starts the first. Areas are worked out
// from the plan each time, never stored.
//
// A big plan opens on the area map: one box per closure, fanned out as a
// tree across the screen. A box opens its area page: just that area's
// real cards (menus and editing work as on the route), homes folded into
// the card that feeds them by street, one line per path, and links to
// the area it is fed from and the closures after it. "Full route" and
// "Area map" switch between this and the whole route.
//
// Whether the map is open is a view setting for this visit, not saved.

// A plan is big past this many homes, or with this many closures.
const AREA_HOMES = 40;
const AREA_CLOSURES = 3;

const areaView = { on: false, at: null }; // at: an area's start id; null is the map
const areaBar = document.getElementById("area-bar");
const areaBtn = document.getElementById("area-map");
// Boxes or street rows to flash on the next draw.
let areaFlash = null;

function isAreaStart(p) {
  return !!p && p.type !== "nid" && (p.id === plan.points[0].id || (p.equipment || []).some((e) => e.type === "closure"));
}

function areaOf(id) {
  for (let p = point(id); p; ) {
    if (isAreaStart(p)) return p;
    const x = incomingPath(p.id);
    p = x && point(x.from);
  }
  return plan.points[0];
}

function areaStarts() {
  return plan.points.filter((p) => isAreaStart(p) && phaseShown(p));
}

// What an area holds: its locations, the homes fed in it and the
// closures after it.
function areaWalk(a) {
  const members = [a];
  const homes = [];
  const exits = [];
  const go = (id) => {
    for (const x of shownPaths(id)) {
      const m = point(x.to);
      if (m.type === "nid") homes.push(m);
      else if (isAreaStart(m)) {
        exits.push(m);
        continue;
      } else members.push(m);
      go(m.id);
    }
  };
  go(a.id);
  return { members, homes, exits };
}

function closureCount() {
  return plan.points.filter((p) => p.type !== "nid" && phaseShown(p) && (p.equipment || []).some((e) => e.type === "closure")).length;
}

// Worth a map: two areas at least, and many homes or several closures.
function areasUseful() {
  return !!plan && !planEmpty() && areaStarts().length >= 2;
}

function bigPlan() {
  return areasUseful() && (homeCount() > AREA_HOMES || closureCount() >= AREA_CLOSURES);
}

function areaOn() {
  return areaView.on && areasUseful();
}

// A plan just opened: big ones start on the map.
function areaOpenPlan() {
  areaView.on = !!plan && bigPlan();
  areaView.at = null;
}

// The map leaves out a start that only passes the cable on (a vault
// with no homes and one closure after it); its page is still there as
// "Fed from" on the closure after it.
function mapTop() {
  const start = plan.points[0];
  const w = areaWalk(start);
  return !w.homes.length && w.exits.length === 1 ? w.exits[0] : start;
}

// --- Homes by street ---

// "Lot 178 Garden Gate" or "123 Main St": the street, and the lot or
// house number.
function homeStreet(h) {
  const m = /^\s*(lot\s*)?(\d+)\s+(.+?)\s*$/i.exec(h.name || "");
  const lot = parseInt(h.lot, 10) || (m && m[1] ? +m[2] : null);
  return { street: m ? m[3] : h.name || "Home", lot, house: m && !m[1] ? +m[2] : null };
}

// 178, 179, 180, 182 → "178–180, 182"
function numberRanges(nums) {
  nums = [...new Set(nums.filter((n) => n != null))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join(", ");
}

// [[street, homes], ...], most homes first.
function byStreet(homes) {
  const m = new Map();
  for (const h of homes) {
    const s = homeStreet(h).street;
    if (!m.has(s)) m.set(s, []);
    m.get(s).push(h);
  }
  return [...m].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], undefined, { numeric: true }));
}

function streetLine(street, homes) {
  const info = homes.map(homeStreet);
  const lots = numberRanges(info.map((x) => x.lot));
  if (lots) return `${street} · lot${lots.includes(",") || lots.includes("–") ? "s" : ""} ${lots}`;
  const nos = numberRanges(info.map((x) => x.house));
  return nos ? `${street} · no. ${nos}` : `${street} · ${plural(homes.length, "home")}`;
}

function allStreets() {
  return byStreet(plan.points.filter((p) => p.type === "nid" && phaseShown(p)));
}

// Under a card in an area: its homes by street. A row opens the homes,
// as the homes button does elsewhere.
function areaHomesEl(p, drops) {
  const homes = drops.map((x) => point(x.to));
  const box = el("div", "area-homes");
  const open = () => {
    fold.homes.add(p.id);
    saveFold();
    renderRoute();
  };
  const head = btnEl(`${plural(homes.length, "home")} fed here ▸`, (e) => {
    e.stopPropagation();
    open();
  }, "tray-btn homes");
  head.title = "Show these homes as cards";
  box.append(head);
  for (const [street, list] of byStreet(homes)) {
    const row = btnEl(streetLine(street, list), (e) => {
      e.stopPropagation();
      open();
    }, "area-street");
    row.dataset.street = street;
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isGuest() || !unassignable(list).length) return;
      openPopup(streetLine(street, list), [
        { icon: "homes", label: unassignLabel(unassignable(list).length), run: () => unassignHomes(list) },
      ], e, `Homes fed from ${p.name}`);
    });
    if (areaFlash && areaFlash.has("street:" + street)) row.classList.add("hit");
    box.append(row);
  }
  return box;
}

// --- One line per path ---

// Red when a feeder or distribution cable is on it, thicker for more
// fibers; blue (or green) for tails only. Several tails ride as one row.
function areaLine(path, wrap) {
  const cables = pathCables(path);
  const big = cables.filter((c) => cableKind(c) === "cable");
  const fibers = Math.max(0, ...big.map((c) => c.fibers || 0));
  wrap.style.setProperty("--wire", big.length ? WIRE_COLORS.cable : wireColor(cables[0]));
  wrap.dataset.w = !cables.length ? 3 : !big.length ? 2.5 : fibers >= 144 ? 8 : fibers >= 96 ? 6.5 : fibers >= 48 ? 5 : 4;
  // The tube colors once, for the biggest cable.
  wrap.querySelectorAll(".tubes").forEach((t, i) => i && t.remove());
}

// The cables to list on a path in an area, with tails folded into one
// row when there are several.
function areaRows(cables) {
  const tails = cables.filter((c) => cableKind(c) !== "cable");
  if (tails.length < 2) return { list: cables, tails: [] };
  return { list: cables.filter((c) => !tails.includes(c)), tails };
}

// --- Drawing ---

function areaEl() {
  if (areaView.at) {
    const a = point(areaView.at);
    if (!a || !phaseShown(a)) areaView.at = null;
    else if (!isAreaStart(a)) areaView.at = areaOf(a.id).id;
  }
  return areaView.at ? areaPageEl(point(areaView.at)) : areaMapEl();
}

// Cut the route at the next closure when an area page is drawn.
function areaCut(p) {
  return areaOn() && !!areaView.at && p.id !== areaView.at && isAreaStart(p);
}

function stubEl(kind, name, note, go, onClick) {
  const b = btnEl("", (e) => {
    e.stopPropagation();
    onClick();
  }, "area-stub");
  b.append(el("span", "k", kind), el("span", "nm", name));
  if (note) b.append(el("span", "note", note));
  b.append(el("span", "go", go));
  return b;
}

// A closure after this area: a link to its page.
function areaExitEl(p) {
  const branch = el("div", "branch");
  const wrap = el("div", "stop-wrap");
  const homes = countBeyond(p.id).homes;
  const b = stubEl("Next closure", p.name, `${typeLabel(p.type)} · ${plural(homes, "home")} after`, "Open ›", () => areaGo(p.id));
  b.dataset.id = p.id;
  wrap.append(b);
  branch.append(wrap);
  return branch;
}

function areaPageEl(a) {
  const page = el("div", "area-page");
  const up = incomingPath(a.id);
  if (!up) {
    page.append(branchEl(a));
    return page;
  }
  // Where it is fed from, ahead of the area's first card, with the path
  // that brings the cable in.
  const from = areaOf(up.from);
  const branch = el("div", "branch");
  const wrap = el("div", "stop-wrap");
  const via = point(up.from);
  wrap.append(stubEl("Fed from", from.name, via.id !== from.id ? `by way of ${via.name}` : `${typeLabel(from.type)} area`, "‹ Back up", () => areaGo(from.id)));
  const kids = el("div", "children");
  const child = el("div", "child");
  child.append(routePathEl(up, routeModel), branchEl(a));
  kids.append(child);
  branch.append(wrap, kids);
  page.append(branch);
  return page;
}

// "Fed by A14413 · 144F", or the tails when that's all there is.
function fedBy(a) {
  const path = incomingPath(a.id);
  if (!path) return "Start of the route";
  const cables = pathCables(path);
  const big = cables.filter((c) => cableKind(c) === "cable");
  if (big.length) return "Fed by " + big.map((c) => `${c.name} · ${c.fibers}F`).join(", ");
  if (cables.length) return `Fed by ${plural(cables.length, "tail")}`;
  return "No cable in yet";
}

function areaTileEl(a) {
  const w = areaWalk(a);
  const after = countBeyond(a.id).homes;
  const t = btnEl("", () => areaGo(a.id), "area-tile");
  t.dataset.area = a.id;
  t.style.setProperty("--c", locMeta(a).color);
  if (areaFlash && areaFlash.has(a.id)) t.classList.add("hit");
  const closure = (a.equipment || []).some((e) => e.type === "closure");
  t.append(el("span", "k", `${closure ? "Closure · " : a.id === plan.points[0].id ? "Start · " : ""}${typeLabel(a.type)}`));
  const hm = el("span", "hm");
  hm.append(el("span", "nm", a.name), el("b", "", String(w.homes.length)), el("span", "u", w.homes.length === 1 ? "home" : "homes"));
  t.append(hm);
  const streets = byStreet(w.homes);
  const st = el("span", "st");
  for (const [s, list] of streets.slice(0, 3)) {
    const row = el("span", "srow", s);
    row.append(el("span", "n", ` (${list.length})`));
    st.append(row);
  }
  if (streets.length > 3) st.append(el("span", "srow more", `+${streets.length - 3} more streets`));
  if (!streets.length) st.append(el("span", "srow more", "No homes fed here"));
  t.append(st, el("span", "lc", fedBy(a)));
  if (after > w.homes.length) t.append(el("span", "lc", `${after} homes including after`));
  t.title = `Open the ${a.name} area`;
  return t;
}

// Tidy tree, left to right: each box sits in the middle of the boxes
// after it.
function tidyTree(root, gapB, gapD) {
  const span = (n) => {
    const sum = n.kids.reduce((s, k) => s + span(k), 0) + gapB * Math.max(0, n.kids.length - 1);
    return (n.span = Math.max(n.h, sum));
  };
  const place = (n, b0, d0) => {
    n.y = b0 + (n.span - n.h) / 2;
    n.x = d0;
    const sum = n.kids.reduce((s, k) => s + k.span, 0) + gapB * Math.max(0, n.kids.length - 1);
    let b = b0 + (n.span - sum) / 2;
    for (const k of n.kids) {
      place(k, b, d0 + n.w + gapD);
      b += k.span + gapB;
    }
  };
  span(root);
  place(root, 0, 0);
}

function areaMapEl() {
  const map = el("div", "area-map");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "area-wires");
  svg.setAttribute("aria-hidden", "true");
  map.append(svg);
  const nodes = [];
  const build = (a) => {
    const n = { a, el: areaTileEl(a), kids: [] };
    nodes.push(n);
    map.append(n.el);
    n.kids = areaWalk(a).exits.map(build);
    return n;
  };
  const root = build(mapTop());
  // Measure once the boxes are on the page (renderRoute adds the map
  // before drawing lines).
  map.layout = () => {
    for (const n of nodes) {
      n.w = n.el.offsetWidth;
      n.h = n.el.offsetHeight;
    }
    tidyTree(root, 22, 70);
    let W = 0;
    let H = 0;
    for (const n of nodes) {
      n.el.style.left = n.x + "px";
      n.el.style.top = n.y + "px";
      W = Math.max(W, n.x + n.w);
      H = Math.max(H, n.y + n.h);
    }
    map.style.width = W + "px";
    map.style.height = H + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.innerHTML = "";
    for (const n of nodes) {
      for (const k of n.kids) {
        const path = incomingPath(k.a.id);
        const probe = el("div");
        areaLine(path, probe);
        const x1 = n.x + n.w;
        const y1 = n.y + n.h / 2;
        const x2 = k.x;
        const y2 = k.y + k.h / 2;
        const mx = x1 + 26;
        const line = document.createElementNS(SVG_NS, "path");
        line.setAttribute("d", Math.abs(y1 - y2) < 1 ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${mx} V${y2} H${x2}`);
        line.setAttribute("class", "wire");
        line.style.stroke = probe.style.getPropertyValue("--wire");
        line.style.strokeWidth = probe.dataset.w;
        svg.append(line);
      }
    }
  };
  return map;
}

// After renderRoute has put the map or page on screen.
function areaAfterDraw() {
  const map = tree.querySelector(".area-map");
  if (map) map.layout();
  if (areaFlash) {
    const hits = [...tree.querySelectorAll(".area-tile.hit, .area-street.hit, .stop.hit")];
    for (const h of hits) flashEl(h);
    areaFlash = null;
  }
}

function flashEl(e) {
  e.classList.remove("flash");
  void e.offsetWidth;
  e.classList.add("flash");
  setTimeout(() => e.classList.remove("flash", "hit"), 3300);
}

// --- The bar over the canvas: where you are ---

function areaChain(a) {
  const chain = [];
  for (let p = a; p; ) {
    chain.unshift(p);
    const x = incomingPath(p.id);
    p = x && areaOf(x.from);
  }
  // The start the map leaves out shows only when it's the page open.
  const top = mapTop();
  const i = chain.indexOf(top);
  return i > 0 && chain[chain.length - 1] !== chain[0] ? chain.slice(i) : chain;
}

function renderAreaBar() {
  const useful = areasUseful();
  areaBtn.hidden = !useful || areaOn();
  const on = areaOn();
  areaBar.hidden = !on;
  document.querySelector(".route-hint").hidden = on;
  // The Layout menu stays put: picking one leaves the areas for the full
  // route in that layout (fold.js).
  if (!on) return;
  areaBar.innerHTML = "";
  const crumbs = el("nav", "area-crumbs");
  crumbs.setAttribute("aria-label", "Where you are");
  const link = (text, go) => {
    const b = btnEl(text, (e) => {
      e.stopPropagation();
      go();
    }, "crumb-link");
    return b;
  };
  const a = areaView.at && point(areaView.at);
  if (!a) crumbs.append(el("b", "", "Area map"));
  else {
    crumbs.append(link("Area map", () => areaGo(null)));
    for (const p of areaChain(a)) {
      crumbs.append(el("span", "sep", "›"));
      crumbs.append(p === a ? el("b", "", p.name) : link(p.name, () => areaGo(p.id)));
    }
  }
  const note = el("span", "area-note");
  if (!a) {
    note.textContent = `${plural(homeCount(), "home")} · ${plural(closureCount(), "closure")}. Each box is a splice closure and the homes it feeds: click one to open it.`;
  } else {
    const w = areaWalk(a);
    const streets = byStreet(w.homes).map((s) => s[0]);
    note.textContent = `${a.name} area: ${plural(w.homes.length, "home")}${streets.length ? " on " + streets.slice(0, 4).join(", ") + (streets.length > 4 ? ` and ${streets.length - 4} more` : "") : ""}. Tap a card for its options.`;
  }
  const legend = el("span", "area-legend");
  legend.innerHTML = '<i class="fd"></i>Cable (thicker = more fibers) <i class="tl"></i>Tails only';
  const full = btnEl("Full route", (e) => {
    e.stopPropagation();
    areaView.on = false;
    selectedId = null;
    renderRoute();
    startView();
  }, "btn ghost");
  full.title = "Show the whole route, every location at once";
  // Field pages for this area, or (on the map) a pick of areas.
  const pr = btnEl("", (e) => {
    e.stopPropagation();
    openAreaPrint(a ? a.id : null);
  }, "btn ghost");
  pr.append(iconEl("sheet"), document.createTextNode(a ? " Print this area" : " Print areas"));
  pr.title = a ? `Print the field pages for the ${a.name} area` : "Pick splice areas and print their field pages";
  areaBar.append(crumbs, note, legend, pr, full);
}

areaBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  // From a card in hand, open the area it is in.
  const at = selectedId && point(selectedId);
  areaGo(at ? areaOf(at.type === "nid" ? (incomingPath(at.id) || {}).from || at.id : at.id).id : null);
});

// --- Moving around ---

function areaGo(id) {
  areaView.on = true;
  areaView.at = id;
  closeMenu();
  closePanels();
  selectedId = null;
  renderRoute();
  sizeView();
  fitAll();
}

// Find on a big plan: the area page with the card on it, flashed and
// its menu open.
function areaReveal(id) {
  const p = point(id);
  if (!p) return;
  unfoldTo(id);
  closeMenu();
  closePanels();
  areaView.at = areaOf(p.type === "nid" ? (incomingPath(id) || {}).from || id : id).id;
  selectedId = id;
  renderRoute();
  sizeView();
  fitAll();
  const find = () => tree.querySelector(`.stop[data-id="${CSS.escape(id)}"]`);
  if (!find()) return;
  if (routeZoom() < 0.55) centerOn(find());
  openMenu(id, { stopPropagation() {}, target: find() });
  // The menu may draw the route again: flash the card that's there now.
  flashEl(find());
}

// A street: every card that feeds it lights up. On a big plan, the area
// that feeds it opens (or the map, with its areas lit, when several do).
function showStreet(street) {
  const homes = plan.points.filter((h) => h.type === "nid" && phaseShown(h) && homeStreet(h).street === street);
  const feeders = [...new Set(homes.map((h) => (incomingPath(h.id) || {}).from).filter(Boolean))];
  if (!feeders.length) return;
  closeMenu();
  closePanels();
  selectedId = null;
  areaFlash = new Set(["street:" + street]);
  if (areaOn()) {
    const areas = [...new Set(feeders.map((f) => areaOf(f).id))];
    areaView.at = areas.length === 1 ? areas[0] : null;
    if (areas.length > 1) areas.forEach((a) => areaFlash.add(a));
  } else feeders.forEach(unfoldTo);
  renderRoute();
  sizeView();
  fitAll();
  const cards = feeders.map((f) => tree.querySelector(`.stop[data-id="${CSS.escape(f)}"]`)).filter(Boolean);
  cards.forEach(flashEl);
  if (cards.length && routeZoom() < 0.55) centerOn(cards[0]);
  showNote(`${street}: ${plural(homes.length, "home")}, fed from ${feeders.map((f) => point(f).name).join(", ")}.`);
}
