// Splice sheets: which fiber is spliced to which at every location,
// worked out from the route, splitters and counts.
//
// Everything a fiber carries is an "item": a home's own fiber
// (home:<id>), a splitter input (split-in:<id>) or a splitter output
// port (port:<splitter>:<n>). Starting at the far ends, each cable
// collects the items it must carry. A splitter output is made where the
// splitter is; anything else runs back to the start. Then each cable's
// fibers are numbered: splitter F2 fibers stay at their F2 number and
// everything else fills the free fibers in order.

function homeItem(h) {
  const s = homeSplitter(h);
  if (s && h.ds) return `port:${s.id}:${h.ds.port}`;
  if (s) return `port:${s.id}:auto-${h.id}`;
  return `home:${h.id}`;
}

function buildSpliceModel() {
  const needsCache = new Map();
  const needsBusy = new Set();
  const assignCache = new Map();
  const exitsCache = new Map();

  // Splitter outputs come from the splitter, not the cable feeding it.
  const madeHere = (here, it) => here.some((s) => it.startsWith(`port:${s.id}:`));

  // A child cable's fibers that carry something, with picks applied:
  // [{ out, item, in }] where `in` is the picked incoming fiber, if any.
  function childFibers(d) {
    const amap = assign(d).map;
    const rows = new Map();
    for (const [n, it] of amap) rows.set(n, { out: n, item: it, in: null });
    for (const p of expandPicks(d.picks)) {
      const row = rows.get(p.out) || { out: p.out, item: `dark:${d.id}:${p.out}`, in: null };
      row.in = p.in;
      rows.set(p.out, row);
    }
    return [...rows.values()].sort((a, b) => a.out - b.out);
  }

  // What one physical cable must carry: { fixed: Map(fiber -> item), items: [] }.
  // Picked fibers and F2 counts are fixed; the rest go wherever is free.
  function needs(start) {
    if (needsCache.has(start.id)) return needsCache.get(start.id);
    // Cables feeding each other in a loop (a tail run back to what feeds
    // it): carry nothing more round the loop. Check plan names it.
    if (needsBusy.has(start.id)) return { fixed: new Map(), items: [] };
    needsBusy.add(start.id);
    const fixed = new Map();
    const items = [];
    const fix = (n, it) => {
      if (n <= start.fibers && !fixed.has(n)) fixed.set(n, it);
      else items.push(it);
    };
    for (const span of cableSpans(start)) {
      const m = point(span.to);
      if (m.type === "nid") items.push(homeItem(m));
      const here = splittersAt(m);
      // Only the cable feeding a location carries what's made there.
      for (const s of here) {
        if (feederAt(m.id, s) !== span) continue;
        if (s.f2) fix(s.f2, `split-in:${s.id}`);
        else if (!s.handOnly) items.push(`split-in:${s.id}`);
      }
      if (incomingCable(m.id) !== span) continue;
      for (const d of childCables(m.id).filter((c) => !c.through)) {
        if (d.picks) {
          // Fibers the user picked; anything else on d isn't spliced.
          for (const f of childFibers(d)) if (f.in && !madeHere(here, f.item)) fix(f.in, f.item);
          continue;
        }
        const sub = needs(d);
        for (const it of [...sub.fixed.values(), ...sub.items]) if (!madeHere(here, it)) items.push(it);
      }
    }
    const result = { fixed, items };
    needsBusy.delete(start.id);
    needsCache.set(start.id, result);
    return result;
  }

  // Fiber number -> item for a physical cable, plus anything that didn't fit.
  function assign(start) {
    if (assignCache.has(start.id)) return assignCache.get(start.id);
    const { fixed, items } = needs(start);
    const map = new Map(fixed);
    const overflow = [];
    // With picks, only the picked fibers connect back to the incoming
    // cable: fibers from upstream go on those, and splitter outputs made
    // where this cable starts go on the others.
    const picked = new Set(expandPicks(start.picks).map((p) => p.out));
    const here = start.picks ? splittersAt(point(start.from)) : [];
    const place = (it, onPicked) => {
      for (const pass of [true, false]) {
        for (let n = 1; n <= start.fibers; n++) {
          if (!map.has(n) && (!pass || picked.has(n) === onPicked)) return map.set(n, it);
        }
      }
      overflow.push(it);
    };
    // Splitter outputs the user pinned to a fiber go there first.
    let rest = items;
    for (const [n, it] of Object.entries(start.pins || {})) {
      const k = Number(n);
      if (k > start.fibers || map.has(k)) continue;
      map.set(k, it);
      const i = rest.indexOf(it);
      if (i >= 0) rest = [...rest.slice(0, i), ...rest.slice(i + 1)];
    }
    for (const it of rest) place(it, !madeHere(here, it));
    const result = { map, overflow };
    assignCache.set(start.id, result);
    return result;
  }

  // Where each item leaves a physical cable: item -> location name.
  function exits(start) {
    if (exitsCache.has(start.id)) return exitsCache.get(start.id);
    const out = new Map();
    for (const span of cableSpans(start)) {
      const m = point(span.to);
      if (m.type === "nid") out.set(homeItem(m), m.name);
      for (const s of splittersAt(m)) if (feederAt(m.id, s) === span) out.set(`split-in:${s.id}`, m.name);
      if (incomingCable(m.id) !== span) continue;
      for (const d of childCables(m.id).filter((c) => !c.through)) {
        const its = d.picks ? childFibers(d).filter((f) => f.in).map((f) => f.item)
          : [...needs(d).fixed.values(), ...needs(d).items];
        for (const it of its) if (!out.has(it)) out.set(it, m.name);
      }
    }
    exitsCache.set(start.id, out);
    return out;
  }

  function fiberLabel(cable, n) {
    const f = colorCode(cable.fibers)[n - 1];
    // A fiber the cable doesn't have (a plan saved before resizes were
    // checked): a broken connection, not a crash.
    if (!f) return { text: `${cableLabel(cable)} #${n}`, colors: `not on this ${cable.fibers}F cable`, missing: true };
    const tube = tubeCount(cable.fibers) > 1 ? `${f.tubeColor.name} tube, ` : "";
    return { text: `${cableLabel(cable)} #${n}`, colors: `${tube}${f.fiberColor.name}`, fiber: f.fiberColor, tube: f.tubeColor };
  }

  function splitterById(id) {
    for (const p of plan.points) for (const s of splittersAt(p)) if (s.id === id) return { s, p };
    return null;
  }

  // Who or what an item is for, in words.
  function describe(item) {
    const [kind, id, n] = item.split(":");
    if (kind === "home") return point(id) ? point(id).name : "home";
    if (kind === "split-in") {
      const hit = splitterById(id);
      return hit ? `Feeds ${eqLabel(hit.s)} at ${hit.p.name}` : "splitter";
    }
    if (kind === "dark") {
      const d = plan.cables.find((c) => c.id === id);
      return d ? `Spare, spliced to ${d.name} #${n}` : "Spare";
    }
    const home = plan.points.find((h) => h.type === "nid" && homeItem(h) === item);
    return home ? home.name : "spare port";
  }

  // Where an item comes from at location L.
  function source(L, item) {
    if (item.startsWith("port:")) {
      const [, sid, port] = item.split(":");
      const s = splittersAt(L).find((x) => x.id === sid);
      if (s) return { text: `${eqLabel(s)} output ${port.startsWith("auto") ? "(no DS set)" : port}`, colors: "" };
    }
    const c = incomingCable(L.id);
    if (!c) {
      if (L.id === plan.points[0].id) return { text: `${L.name} (start)`, colors: "" };
      return { text: `No cable reaches ${L.name}`, colors: "", missing: true };
    }
    const start = cableStart(c);
    for (const [n, it] of assign(start).map) if (it === item) return fiberLabel(start, n);
    return { text: "Not on the incoming cable", colors: "", missing: true };
  }

  // Incoming -> outgoing fiber pairs the app chose for an automatic cable.
  function autoPairs(d) {
    const L = point(d.from);
    const c = incomingCable(L.id);
    if (!c) return [];
    const inMap = assign(cableStart(c)).map;
    const byItem = new Map([...inMap].map(([n, it]) => [it, n]));
    const pairs = [];
    for (const [n, it] of assign(d).map) if (byItem.has(it)) pairs.push({ in: byItem.get(it), out: n });
    return pairs;
  }

  // Splice rows at one location. Each row also says what it joins, for
  // drawings: src and dst are { kind: "fiber", n } (incoming fiber n),
  // { kind: "split", id } or { kind: "cable", id, n } (outgoing fiber).
  function rowsAt(locId) {
    const L = point(locId);
    const rows = [];
    const c = incomingCable(locId);
    const here = splittersAt(L);
    const inMap = c ? assign(cableStart(c)).map : new Map();
    const byItem = new Map([...inMap].map(([n, it]) => [it, n]));
    for (const s of here) {
      const sc = feederAt(locId, s);
      // An input taken apart by hand, or never spliced, feeds from nothing.
      const from = s.f2 && sc && s.f2 <= sc.fibers ? fiberLabel(cableStart(sc), s.f2)
        : !s.f2 && (s.handOnly || s.f2Manual) ? { text: "Not spliced", colors: "", missing: true }
        : source(L, `split-in:${s.id}`);
      const via = s.tailIn && tailFeet(s) ? ` (${tailFeet(s)} ft tail)` : "";
      rows.push({ from, to: { text: `${eqLabel(s)} input${via}`, colors: "" }, note: f2Label(s), key: `split:${s.id}:in`,
        phase: Math.max(phaseIdx(s), sc ? phaseIdx(sc) : 0),
        src: s.f2 && sc && s.f2 <= sc.fibers ? { kind: "fiber", n: s.f2 } : null, dst: { kind: "split", id: s.id } });
    }
    for (const d of childCables(locId).filter((x) => !x.through)) {
      for (const f of childFibers(d)) {
        let from;
        // On a cable spliced by hand only, a splitter output feeds a fiber
        // only where the user joined them (a pin).
        const unjoined = d.handOnly && madeHere(here, f.item) && (d.pins || {})[f.out] !== f.item;
        if (unjoined) from = { text: "Not spliced", colors: "", missing: true };
        else if (madeHere(here, f.item)) from = source(L, f.item);
        else if (d.picks) {
          from = f.in && c ? fiberLabel(cableStart(c), f.in)
            : { text: f.in ? `No cable reaches ${L.name}` : "Not spliced (not in the fibers picked)", colors: "", missing: true };
        } else from = source(L, f.item);
        // At the start, show what a fiber is patched to, if anything.
        if (!c && !from.missing) {
          const x = crossConnectFor(`fiber:${d.id}:${f.out}`);
          if (x) from = { text: `Patched: ${endpointLabel(x.other)}`, colors: "" };
        }
        // A splice belongs to the later phase of the two things it joins.
        const sp = here.find((s) => f.item.startsWith(`port:${s.id}:`));
        const phase = Math.max(phaseIdx(d), sp ? phaseIdx(sp) : c ? phaseIdx(c) : 0);
        let src = null;
        if (unjoined) src = null;
        else if (sp) src = { kind: "split", id: sp.id };
        else if (c && d.picks) src = f.in ? { kind: "fiber", n: f.in } : null;
        else if (c && byItem.has(f.item)) src = { kind: "fiber", n: byItem.get(f.item) };
        rows.push({ from, to: fiberLabel(d, f.out), note: describe(f.item), key: `fiber:${d.id}:${f.out}`, phase,
          src, dst: { kind: "cable", id: d.id, n: f.out } });
      }
    }
    const through = childCables(locId).filter((x) => x.through)
      .map((x) => `${x.name} ${THROUGH_LABELS[x.through]} here.`);
    return { rows, through };
  }

  return { needs, assign, exits, rowsAt, describe, autoPairs, childFibers };
}

// Locations that get a splice sheet: anything but a home with work on it.
function spliceLocations(model) {
  return plan.points.filter((p) => {
    if (p.type === "nid" || !phaseShown(p)) return false;
    const { rows, through } = model.rowsAt(p.id);
    return rows.some(rowPhaseShown) || through.length || crossConnectsAt(p.id).some(phaseShown);
  });
}

// With one phase on screen, splices from later phases are left off and
// those from earlier ones are marked existing.
function rowPhaseShown(r) {
  const v = viewIdx();
  return v === null || r.phase <= v;
}

// One location's splice table, for the screen or the printed sheet.
function spliceTable(model, locId) {
  const all = model.rowsAt(locId);
  const rows = all.rows.filter(rowPhaseShown);
  const through = all.through;
  const v = viewIdx();
  const wrap = document.createElement("div");
  const xc = crossConnectTable(locId);
  for (const t of through) {
    const p = document.createElement("p");
    p.className = "through-note";
    p.textContent = t;
    wrap.append(p);
  }
  if (!rows.length) {
    if (xc) wrap.append(xc);
    return wrap;
  }
  // Tray and slot, when there's a splice case here or the user set them.
  const L = point(locId);
  const trays = spliceSlots(model, L);
  const table = document.createElement("table");
  table.className = "sheet-table splice-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>${hasPhases() ? "<th>Phase</th>" : ""}${trays ? "<th>Tray</th><th>Slot</th>" : ""}<th>From</th><th>Color</th><th></th><th>To</th><th>Color</th><th>For</th><th>Done</th></tr>`;
  table.append(thead);
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.from.missing) tr.className = "problem";
    else if (r.to.tube && r.to.colors.includes("tube")) tintTube(tr, r.to.tube);
    const existing = v !== null && r.phase < v;
    if (existing) tr.classList.add("existing");
    const cell = (text, cls) => {
      const td = document.createElement("td");
      if (cls) td.className = cls;
      td.textContent = text;
      return td;
    };
    const colorCell = (f) => {
      const td = cell("");
      if (f.tube && f.colors.includes("tube")) td.append(swatch(f.tube, true), document.createTextNode(" "));
      if (f.fiber) td.append(swatch(f.fiber, true), document.createTextNode(" "));
      td.append(document.createTextNode(f.colors));
      return td;
    };
    if (hasPhases()) tr.append(cell(existing ? `Existing · ${phaseName(r.phase)}` : phaseName(r.phase), existing ? "phase-cell old" : "phase-cell"));
    if (trays) {
      const ts = trays.get(r.key);
      tr.append(cell(ts ? String(ts.tray) : "", "mono"), cell(ts ? String(ts.slot) : "", "mono"));
    }
    tr.append(cell(r.from.text, "strong"), colorCell(r.from), cell("→"), cell(r.to.text, "strong"),
      colorCell(r.to), cell(r.note), cell("☐", "checkbox-cell"));
    table.append(tr);
  }
  wrap.append(table);
  if (xc) wrap.append(xc);
  return wrap;
}

// --- On screen ---

const splicePanel = document.getElementById("splice-panel");

// The sheet for one location, for a crew standing at it: the splice list
// (tick off as you go) or the same drawing as its printed page, and a
// button to print just this location's page.
const SPLICE_VIEW_KEY = "splicePlanner.spliceView";
let spliceLocId = null;

function spliceView() {
  try {
    return localStorage.getItem(SPLICE_VIEW_KEY) === "list" ? "list" : "drawing";
  } catch {
    return "drawing";
  }
}

function openSpliceSheet(locId) {
  closePanels();
  closeMenu();
  selectedId = locId;
  spliceLocId = locId;
  const L = point(locId);
  document.getElementById("splice-title").textContent = `Splice sheet: ${L.name}`;
  document.getElementById("splice-print-blocked").hidden = true;
  renderSpliceBody();
  renderFieldBox(locId);
  splicePanel.hidden = false;
  splicePanel.scrollTop = 0;
  renderRoute();
}

function renderSpliceBody() {
  const model = buildSpliceModel();
  const view = spliceView();
  for (const b of document.querySelectorAll("[data-splice-view]")) {
    b.setAttribute("aria-selected", String(b.dataset.spliceView === view));
  }
  const body = document.getElementById("splice-body");
  body.innerHTML = "";
  const all = model.rowsAt(spliceLocId);
  const empty = !all.rows.some(rowPhaseShown) && !all.through.length && !crossConnectsAt(spliceLocId).some(phaseShown);
  if (empty) {
    body.textContent = "Nothing is spliced here yet.";
    return;
  }
  if (view === "drawing") {
    // The printed page's drawing, black on white, scaled to the screen.
    const L = point(spliceLocId);
    const rows = all.rows.filter(rowPhaseShown);
    rows.forEach((r, i) => (r.num = i + 1));
    const wrap = el("div", "print-sheet sheet-preview");
    const pic = el("div", "loc-pic");
    pic.append(bigPicture(L, rows));
    wrap.append(pic, checklist(model, L, rows));
    body.append(wrap);
    return;
  }
  body.append(spliceTable(model, spliceLocId));
}

for (const b of document.querySelectorAll("[data-splice-view]")) {
  b.addEventListener("click", () => {
    try {
      localStorage.setItem(SPLICE_VIEW_KEY, b.dataset.spliceView);
    } catch {
      // Not remembered; the view still switches.
    }
    renderSpliceBody();
  });
}

document.getElementById("splice-print").addEventListener("click", () => {
  if (printBlocked()) {
    document.getElementById("splice-print-blocked").hidden = false;
    return;
  }
  printLocation(spliceLocId);
});

function closeSplice() {
  splicePanel.hidden = true;
}

registerPanel(splicePanel, closeSplice);

document.getElementById("splice-close").addEventListener("click", () => {
  closeSplice();
  selectedId = null;
  renderRoute();
});
