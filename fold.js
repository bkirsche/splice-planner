// Folding, so a big job opens small. Homes start tucked into a
// "6 homes" button on the location that feeds them, and a terminal at
// its own spot on a terminal tail (with nothing past it but homes) shows
// as a chip on the location it's spliced at. Any branch can be folded
// away. The search box finds anything tucked out of sight and unfolds
// the way to it.
//
// Folding is the Compact layout. Each person picks a layout from the
// Layout menu: Full (everything open, best for small jobs), Compact
// (folded, for big ones), Table (a row per home, grouped by location),
// Grid (grid.js: lay locations out yourself, in any direction), or Auto,
// which picks Full or Compact by the number of homes.
//
// The layout and what's open are view settings, kept on this device, not
// in the plan.

const VIEW_KEY = "splicePlanner.view";
const LAYOUTS = { auto: "Auto", full: "Full", compact: "Compact", table: "Table", grid: "Grid" };
// Auto turns Compact past this many homes.
const AUTO_COMPACT_HOMES = 40;

const fold = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
    return { layout: LAYOUTS[v.layout] ? v.layout : "auto", homes: new Set(v.homes || []), spots: new Set(v.spots || []), branches: new Set(v.branches || []) };
  } catch {
    return { layout: "auto", homes: new Set(), spots: new Set(), branches: new Set() };
  }
})();

function saveFold() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ layout: fold.layout, homes: [...fold.homes], spots: [...fold.spots], branches: [...fold.branches] }));
  } catch {
    // Storage unavailable; folding still works for this visit.
  }
}

function homeCount() {
  return plan ? plan.points.filter((p) => p.type === "nid" && phaseShown(p)).length : 0;
}

// The layout on screen: Auto resolved to Full or Compact.
function layoutNow() {
  // An area page (areas.js) is drawn folded, whatever the layout.
  if (typeof areaOn === "function" && areaOn()) return "compact";
  if (fold.layout !== "auto") return fold.layout;
  return homeCount() > AUTO_COMPACT_HOMES ? "compact" : "full";
}

function isFull() {
  return layoutNow() === "full";
}

// Homes at the end of the line from this location are on screen.
function homesShown(id) {
  return isFull() || fold.homes.has(id);
}

// A terminal at its own spot: fed by a terminal tail, with only homes
// past it.
function isSpot(path) {
  const m = point(path.to);
  const c = pathCable(path);
  if (!m || m.type === "nid" || !c || c.through || cableKind(c) !== "terminal-tail") return false;
  return shownPaths(m.id).every(isEndHome);
}

// A spot drawn as a chip on its parent instead of a card of its own.
function isTucked(path) {
  return !isFull() && isSpot(path) && !fold.spots.has(path.to);
}

function branchFolded(id) {
  return !isFull() && fold.branches.has(id);
}

// Everything past a location: stops (not homes) and homes.
function countBeyond(id) {
  let stops = 0;
  let homes = 0;
  const walk = (pid) => {
    for (const x of shownPaths(pid)) {
      if (point(x.to).type === "nid") homes++;
      else stops++;
      walk(x.to);
    }
  };
  walk(id);
  return { stops, homes };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Open the way to a location: unfold what's above it, open its homes or
// its spot.
function unfoldTo(id) {
  const p = point(id);
  if (!p) return;
  const path = incomingPath(id);
  if (path && p.type === "nid" && isEndHome(path)) fold.homes.add(path.from);
  if (path && p.type !== "nid" && isSpot(path)) fold.spots.add(id);
  // A home at a spot: the spot opens too.
  const up = path && incomingPath(path.from);
  if (p.type === "nid" && up && isSpot(up)) fold.spots.add(path.from);
  for (let x = path; x; x = incomingPath(x.from)) fold.branches.delete(x.from);
  saveFold();
}

// Unfold, pick it out and bring it to the middle of the screen (or its
// row, in the table).
function revealPoint(id) {
  unfoldTo(id);
  closeMenu();
  selectedId = id;
  renderRoute();
  if (layoutNow() === "table") return showTableRow(id);
  const card = tree.querySelector(`.stop[data-id="${CSS.escape(id)}"]`);
  if (card) centerOn(card);
}

// --- Under a location's card: tucked terminals, homes, fold ---

function foldTray(p, drops, tucked, hasKids) {
  // Full is the plain route: no tray.
  if (isFull()) return null;
  const tray = el("div", "stop-tray");
  for (const path of tucked) {
    const m = point(path.to);
    const sp = splittersAt(m);
    const homes = shownPaths(m.id).length;
    const b = btnEl("", (e) => openSpotPeek(m.id, e), "spot-chip");
    b.style.setProperty("--wire", wireColor(pathCable(path)));
    b.title = `${m.name}: a terminal on a tail from ${p.name}. Tap for its homes.`;
    b.append(el("span", "dot"), document.createTextNode(sp.length === 1 ? sp[0].name : m.name),
      el("span", "n", String(homes)));
    tray.append(b);
  }
  // In an area, folded homes are listed by street.
  if (drops.length && areaOn() && !homesShown(p.id)) tray.append(areaHomesEl(p, drops));
  else if (drops.length) {
    const open = homesShown(p.id);
    const b = btnEl(open ? "Hide homes" : `${plural(drops.length, "home")} ▸`, (e) => {
      e.stopPropagation();
      if (open) {
        fold.homes.delete(p.id);
        // A terminal on a tail tucks back into its parent too.
        fold.spots.delete(p.id);
      } else fold.homes.add(p.id);
      saveFold();
      renderRoute();
    }, "tray-btn homes");
    b.setAttribute("aria-expanded", String(open));
    tray.append(b);
  }
  if (hasKids) {
    const folded = branchFolded(p.id);
    const beyond = folded ? countBeyond(p.id) : null;
    const b = btnEl(folded ? `${plural(beyond.stops, "stop")} · ${plural(beyond.homes, "home")} ▸` : "▾", (e) => {
      e.stopPropagation();
      if (folded) fold.branches.delete(p.id);
      else fold.branches.add(p.id);
      saveFold();
      renderRoute();
    }, "tray-btn fold" + (folded ? " folded" : ""));
    b.title = folded ? `Show everything after ${p.name}` : `Fold everything after ${p.name}`;
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-expanded", String(!folded));
    tray.append(b);
  }
  return tray.childNodes.length ? tray : null;
}

// A tucked terminal's homes in a popup, by port.
function openSpotPeek(id, e) {
  e.stopPropagation();
  closePanels();
  const m = point(id);
  const sp = splittersAt(m);
  const homes = shownPaths(id).map((x) => point(x.to));
  const port = (h) => (h.ds && sp.some((s) => s.id === h.ds.splitterId) ? h.ds.port : null);
  homes.sort((a, b) => (port(a) || 99) - (port(b) || 99));
  const items = homes.map((h) => ({ icon: "home", label: `${port(h) ? `${port(h)} · ` : ""}${h.name}`, run: () => revealPoint(h.id) }));
  items.push({ icon: "move", label: "Show on the route", run: () => revealPoint(id) });
  if (!isGuest() && homes.length) items.push({ icon: "homes", label: "Home counts (F2 / DS)", run: () => openHomeCounts(id) });
  const caption = sp.length === 1 ? `${sp[0].ratio} · ${f2Label(sp[0])}` : typeLabel(m.type);
  openPopup(sp.length === 1 ? sp[0].name : m.name, items, e, caption);
}

// --- Layout menu, and "Fold all" in Compact ---

const layoutPick = document.getElementById("layout-pick");
const foldAllBtn = document.getElementById("fold-all");

function renderLayoutPick() {
  const auto = homeCount() > AUTO_COMPACT_HOMES ? "Compact" : "Full";
  layoutPick.replaceChildren(...selectEl([
    { value: "auto", label: `Auto (${auto} for ${plural(homeCount(), "home")})` },
    { value: "full", label: "Full: everything open" },
    { value: "compact", label: "Compact: homes folded" },
    { value: "table", label: "Table: a row per home" },
    { value: "grid", label: "Grid: build any direction (advanced)" },
  ]).childNodes);
  layoutPick.value = fold.layout;
  foldAllBtn.hidden = layoutNow() !== "compact" || areaOn();
}

layoutPick.addEventListener("change", () => {
  fold.layout = layoutPick.value;
  areaView.on = false;
  saveFold();
  selectedId = null;
  renderRoute();
  requestAnimationFrame(() => startView());
});

foldAllBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fold.homes.clear();
  fold.spots.clear();
  fold.branches.clear();
  saveFold();
  renderRoute();
  fitAll();
});

// --- Search ---
// Lots, addresses, locations, terminals, splitters and cables. Picking
// a result unfolds the way to it and brings it to the middle.

const searchBox = document.getElementById("route-search");
const searchList = document.getElementById("search-results");
let searchHits = [];
let searchAt = 0;

function searchKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function searchEntries() {
  const out = [];
  for (const p of plan.points) {
    if (!phaseShown(p)) continue;
    const at = incomingPath(p.id);
    const from = at ? point(at.from) : null;
    if (p.type === "nid") {
      const words = [p.name, p.lot ? lotName(p.lot) : "", p.lot || ""];
      out.push({ id: p.id, words, text: p.name + (p.lot && hasAddress(p) ? ` (Lot ${p.lot})` : ""), sub: from ? `Home off ${from.name}` : "Home", icon: "home" });
      continue;
    }
    out.push({ id: p.id, words: [p.name], text: p.name, sub: typeLabel(p.type), icon: (LOC_META[p.type] || {}).icon || "pin" });
    for (const eq of p.equipment || []) {
      if (!eq.name || eq.name === p.name) continue;
      const what = eq.type === "splitter" ? `${eq.ratio} splitter` : eq.type === "terminal" ? "Terminal" : "Equipment";
      out.push({ id: p.id, words: [eq.name], text: eq.name, sub: `${what} at ${p.name}`, icon: eq.type === "splitter" ? "splitter" : eq.type === "terminal" ? "terminal" : "closure" });
    }
  }
  for (const c of plan.cables) {
    if (c.through || isDrop(c) || !phaseShown(point(c.to))) continue;
    out.push({ id: c.to, words: [c.name], text: c.name, sub: `${c.fibers}F ${CABLE_KINDS[cableKind(c)].toLowerCase()} to ${point(c.to).name}`, icon: "slack" });
  }
  // Streets (areas.js): every card that feeds one lights up.
  for (const [street, homes] of allStreets()) {
    out.push({ street, words: [street], text: street, sub: `Street · ${plural(homes.length, "home")}`, icon: "homes" });
  }
  return out;
}

// Best first: the whole name, then the start of a word, then anywhere.
function runSearch(q) {
  const key = searchKey(q);
  if (!key) return [];
  const scored = [];
  for (const e of searchEntries()) {
    let best = 0;
    for (const w of e.words) {
      const k = searchKey(w);
      if (!k) continue;
      if (k === key) best = Math.max(best, 3);
      else if (k.startsWith(key) || k.replace(/^lot/, "") === key) best = Math.max(best, 2);
      else if (k.includes(key)) best = Math.max(best, 1);
    }
    if (best) scored.push({ ...e, score: best });
  }
  scored.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text, undefined, { numeric: true }));
  // One row per name and place.
  const seen = new Set();
  return scored.filter((e) => {
    const k = e.text + "|" + e.sub;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 12);
}

function renderSearch() {
  searchList.innerHTML = "";
  const q = searchBox.value.trim();
  searchList.hidden = !q;
  if (!q) return;
  if (!searchHits.length) {
    searchList.append(el("p", "search-none", `Nothing called "${q}".`));
    return;
  }
  searchHits.forEach((hit, i) => {
    const b = btnEl("", () => pickSearch(i), "search-hit" + (i === searchAt ? " on" : ""));
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(i === searchAt));
    const words = el("span", "search-words");
    words.append(el("span", "search-text", hit.text), el("span", "search-sub", hit.sub));
    b.append(iconEl(hit.icon), words);
    searchList.append(b);
  });
}

function pickSearch(i) {
  const hit = searchHits[i];
  if (!hit) return;
  searchList.hidden = true;
  searchBox.blur();
  if (hit.street) showStreet(hit.street);
  else if (areaOn()) areaReveal(hit.id);
  else revealPoint(hit.id);
}

// "/" goes to the find box from anywhere on the route.
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || screens.route.hidden || typingIn(e.target)) return;
  if (!menu.hidden || document.querySelector(".wizard:not([hidden]), dialog[open]")) return;
  e.preventDefault();
  searchBox.focus();
  searchBox.select();
});

searchBox.addEventListener("input", () => {
  searchHits = runSearch(searchBox.value);
  searchAt = 0;
  renderSearch();
});
searchBox.addEventListener("focus", () => {
  if (searchBox.value.trim()) {
    searchHits = runSearch(searchBox.value);
    renderSearch();
  }
});
searchBox.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!searchHits.length) return;
    searchAt = (searchAt + (e.key === "ArrowDown" ? 1 : searchHits.length - 1)) % searchHits.length;
    renderSearch();
  } else if (e.key === "Enter") {
    e.preventDefault();
    pickSearch(searchAt);
  } else if (e.key === "Escape") {
    e.stopPropagation();
    searchBox.value = "";
    searchList.hidden = true;
    searchBox.blur();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".route-search")) searchList.hidden = true;
});
