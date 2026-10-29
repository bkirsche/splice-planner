// The Table layout: every location in route order, each with the homes
// it feeds as rows (lot, splitter, port, F2, DS, drop). Suits a big job
// read like a spreadsheet. Each home's splitter and port can be picked
// right in its row, and ticked homes filled onto a splitter in order.
// Tap a location or a home's name for its menu.

const routeTable = document.getElementById("route-table");
const tableFilter = { loc: "", splitter: "", issues: false };
const tableTicked = new Set(); // ticked home ids

// How deep a location sits on the route, for the indent.
function routeDepth(id) {
  let d = 0;
  for (let x = incomingPath(id); x; x = incomingPath(x.from)) d++;
  return d;
}

function allSplitters() {
  const out = [];
  for (const p of routeOrder()) if (p.type !== "nid") for (const s of splittersAt(p)) out.push({ s, loc: p });
  return out;
}

// A home that needs a look: no splitter, no DS, or put off its route.
function homeNeedsLook(h) {
  return !homeSplitter(h) || !homeDs(h) || !!(h.ds && h.ds.offRoute);
}

function tableHomeShown(h, L) {
  if (tableFilter.loc && L.id !== tableFilter.loc) return false;
  if (tableFilter.splitter) {
    const s = homeSplitter(h);
    if (!s || s.id !== tableFilter.splitter) return false;
  }
  return !tableFilter.issues || homeNeedsLook(h);
}

// Splitter dropdown for a home: the ones along its route first, then
// every other splitter as an override.
function tableSplitterSelect(h, s) {
  const route = routeSplitters(h);
  const full = (x) => nextFreePort(x, h.id) === null && (!s || x.id !== s.id);
  const opts = [{ value: "", label: "No splitter" }];
  for (const x of route) opts.push({ value: x.id, label: `${eqLabel(x)} · ${f2Label(x)}${full(x) ? " (full)" : ""}`, group: "Along the route" });
  for (const { s: x, loc } of allSplitters()) {
    if (route.includes(x) || isCascade(x)) continue;
    opts.push({ value: x.id, label: `${eqLabel(x)} at ${loc.name}${full(x) ? " (full)" : ""}`, group: "Other splitters (override)" });
  }
  const sel = selectEl(opts, s ? s.id : "");
  sel.className = "rt-select";
  sel.title = "Splitter";
  sel.setAttribute("aria-label", `Splitter for ${h.name}`);
  sel.addEventListener("change", () => {
    if (!sel.value) {
      return withUndo(`Took ${h.name} off its splitter.`, () => {
        delete h.ds;
        h.dsManual = true;
      });
    }
    const next = splitterById(sel.value);
    const port = nextFreePort(next, h.id);
    if (port === null) {
      showNote(`${eqLabel(next)} has no free port. Pick a port on it to swap with a home there.`);
      return renderRoute();
    }
    const off = !route.includes(next);
    withUndo(`Put ${h.name} on ${eqLabel(next)} port ${port}${off ? `, off its route at ${equipmentLocation(next.id).name}` : ""}.`, () => putHomeOnPort(h, next, port));
  });
  return sel;
}

function tablePortSelect(h, s) {
  const used = usedPorts(s, h.id);
  const opts = [{ value: "", label: "No port" }];
  for (let n = 1; n <= splitterPorts(s); n++) {
    const other = used.get(n);
    opts.push({ value: n, label: `Port ${n}${other ? ` · swap with ${other.name}` : ""}` });
  }
  const sel = selectEl(opts, h.ds && h.ds.splitterId === s.id ? h.ds.port : "");
  sel.className = "rt-select";
  sel.title = "DS port";
  sel.setAttribute("aria-label", `Port for ${h.name}`);
  sel.addEventListener("change", () => {
    if (!sel.value) {
      return withUndo(`Took ${h.name} off its port.`, () => {
        delete h.ds;
        h.dsManual = true;
      });
    }
    withUndo(`Put ${h.name} on ${eqLabel(s)} port ${sel.value}.`, () => putHomeOnPort(h, s, Number(sel.value)));
  });
  return sel;
}

// Filters, and the tools for the ticked homes.
function tableTools(shownHomes) {
  const bar = el("div", "rt-tools");
  const locs = routeOrder().filter((p) => p.type !== "nid" && shownPaths(p.id).some((x) => point(x.to).type === "nid"));
  const lSel = selectEl([{ value: "", label: "All locations" }, ...locs.map((p) => ({ value: p.id, label: p.name }))], tableFilter.loc);
  const sSel = selectEl([{ value: "", label: "All splitters" }, ...allSplitters().map(({ s, loc }) => ({ value: s.id, label: `${eqLabel(s)} at ${loc.name}` }))], tableFilter.splitter);
  lSel.className = sSel.className = "rt-select";
  lSel.setAttribute("aria-label", "Show homes at");
  sSel.setAttribute("aria-label", "Show homes on");
  lSel.addEventListener("change", () => ((tableFilter.loc = lSel.value), renderTable()));
  sSel.addEventListener("change", () => ((tableFilter.splitter = sSel.value), renderTable()));
  const issues = el("label", "toggle");
  const box = inputEl("checkbox");
  box.checked = tableFilter.issues;
  box.addEventListener("change", () => ((tableFilter.issues = box.checked), renderTable()));
  issues.append(box, document.createTextNode("Only homes that need a look"));
  bar.append(el("span", "rt-tools-label", "Show"), lSel, sSel, issues);

  const ticked = shownHomes.filter((h) => tableTicked.has(h.id));
  if (!ticked.length) return bar;
  const fillBar = el("div", "rt-tools rt-fill");
  const target = selectEl(allSplitters().filter(({ s }) => !isCascade(s)).map(({ s, loc }) => ({ value: s.id, label: `${eqLabel(s)} at ${loc.name}` })),
    tableFilter.splitter || (homeSplitter(ticked[0]) || {}).id);
  target.className = "rt-select";
  target.setAttribute("aria-label", "Splitter to fill");
  const from = inputEl("number", 1, { min: 1, class: "rt-port", "aria-label": "Starting port" });
  const msg = el("span", "rt-msg");
  const fill = () => {
    const s = splitterById(target.value);
    if (!s) return;
    const max = splitterPorts(s);
    let n = Number(from.value);
    if (!Number.isInteger(n) || n < 1 || n > max) return (msg.textContent = `${eqLabel(s)} has ports 1 to ${max}.`);
    const ids = new Set(ticked.map((h) => h.id));
    const taken = new Set([...usedPorts(s)].filter(([, h]) => !ids.has(h.id) && h.dsManual).map(([p]) => p));
    const out = [];
    for (const h of ticked) {
      while (n <= max && taken.has(n)) n++;
      if (n > max) return (msg.textContent = `${eqLabel(s)} runs out of ports after ${plural(out.length, "home")}. Start lower, tick fewer homes, or pick another splitter.`);
      out.push([h, n++]);
    }
    const off = out.filter(([h]) => !routeSplitters(h).includes(s)).length;
    withUndo(`Put ${plural(out.length, "home")} on ${eqLabel(s)} from port ${from.value}${off ? ` (${off} off their route)` : ""}.`, () => {
      for (const [h] of out) {
        delete h.ds;
        h.dsManual = true;
      }
      for (const [h, port] of out) {
        h.ds = { splitterId: s.id, port };
        if (!routeSplitters(h).includes(s)) h.ds.offRoute = true;
      }
    });
    tableTicked.clear();
    renderTable();
  };
  const auto = () => {
    withUndo(`Handed ${plural(ticked.length, "home")} back to automatic counts.`, () => {
      for (const h of ticked) {
        delete h.ds;
        h.dsManual = false;
      }
    });
    tableTicked.clear();
    renderTable();
  };
  fillBar.append(el("span", "rt-tools-label strong", `${plural(ticked.length, "home")} ticked:`), document.createTextNode("put on"), target,
    document.createTextNode("from port"), from, btnEl("Fill in order", fill, "btn"), btnEl("Back to automatic", auto, "btn ghost"),
    btnEl("Untick all", () => (tableTicked.clear(), renderTable()), "btn ghost"), msg);
  const wrap = el("div");
  wrap.append(bar, fillBar);
  return wrap;
}

function renderTable() {
  const homesAll = plan.points.filter((p) => p.type === "nid");
  const terms = homesAll.some((h) => homeTerminalPort(h));
  const table = el("table", "rt-table");
  const head = el("tr");
  for (const h of ["", "Home", "Lot", "Splitter", "Port", "F2", "DS", "Drop", ...(terms ? ["Terminal port"] : [])]) head.append(el("th", "", h));
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const body = el("tbody");
  const cols = terms ? 9 : 8;
  const filtering = tableFilter.loc || tableFilter.splitter || tableFilter.issues;
  const shown = [];
  for (const L of routeOrder()) {
    if (L.type === "nid" || !phaseShown(L)) continue;
    const homes = shownPaths(L.id).map((x) => point(x.to)).filter((m) => m.type === "nid" && tableHomeShown(m, L));
    if (filtering && !homes.length) continue;
    const port = (h) => (h.ds ? h.ds.port : 999);
    homes.sort((a, b) => port(a) - port(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));

    // The location's own row: name, what feeds it, its splitters.
    const tr = el("tr", "rt-loc" + (L.id === selectedId ? " selected" : "") + (phasePast(L) ? " past" : ""));
    tr.dataset.id = L.id;
    const td = el("td");
    td.colSpan = cols;
    td.style.paddingLeft = `${12 + Math.min(routeDepth(L.id), 12) * 14}px`;
    const name = btnEl("", (e) => openMenu(L.id, e), "rt-name");
    name.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMenu(L.id, e);
    });
    name.append(iconEl((LOC_META[L.type] || {}).icon || "pin"), document.createTextNode(L.name));
    const bits = [typeLabel(L.type)];
    const c = incomingCable(L.id);
    if (c) bits.push(`${c.name} · ${c.fibers}F${cableKind(c) !== "cable" ? ` ${cableKindText(c).toLowerCase()}` : ""} from ${point(c.from).name}`);
    else if (L.id !== plan.points[0].id) bits.push(`from ${point(incomingPath(L.id).from).name}, no cable`);
    for (const s of splittersAt(L)) bits.push(`${eqLabel(s)} ${s.ratio} · ${f2Label(s)} · ${usedPorts(s).size}/${splitterPorts(s)} ports used`);
    if (homes.length) bits.push(plural(homes.length, "home"));
    td.append(name, el("span", "rt-sub", bits.join(" · ")));
    tr.append(td);
    body.append(tr);

    for (const h of homes) {
      shown.push(h);
      const row = el("tr", "rt-home" + (h.id === selectedId ? " selected" : "") + (phasePast(h) ? " past" : "") + (tableTicked.has(h.id) ? " ticked" : ""));
      row.dataset.id = h.id;
      const tick = inputEl("checkbox", "", { "aria-label": `Tick ${h.name}` });
      tick.checked = tableTicked.has(h.id);
      tick.addEventListener("change", () => {
        if (tick.checked) tableTicked.add(h.id);
        else tableTicked.delete(h.id);
        renderTable();
      });
      const tickCell = el("td", "rt-tick");
      tickCell.append(tick);
      const cell = el("td");
      cell.style.paddingLeft = `${12 + Math.min(routeDepth(L.id), 12) * 14}px`;
      const home = btnEl(h.name, (e) => openMenu(h.id, e), "rt-home-btn");
      home.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openMenu(h.id, e);
      });
      cell.append(home);
      const s = homeSplitter(h);
      const drop = incomingCable(h.id);
      const tp = homeTerminalPort(h);

      // Splitter: the lock (automatic or by hand), then the dropdown.
      const sCell = el("td", "rt-edit");
      sCell.append(lockEl(!h.dsManual, (lock) => withUndo(lock ? `${h.name} is back on automatic counts.` : `${h.name} is set by hand now.`, () => {
        if (lock) delete h.ds;
        h.dsManual = !lock;
      }), "the splitter and port"), tableSplitterSelect(h, s));
      if (h.ds && h.ds.offRoute && s) sCell.append(el("span", "rt-off", "off route"));
      const pCell = el("td", "rt-edit");
      pCell.append(s ? tablePortSelect(h, s) : el("span", "muted", "—"));
      row.append(tickCell, cell, el("td", "mono", h.lot || "—"), sCell, pCell,
        el("td", "mono strong", s && s.f2 ? f2CellFor(s) : "—"), el("td", "mono strong", homeDs(h) ? dsCell(h) : "—"),
        el("td", "", drop ? `${drop.name} · ${drop.fibers}F` : "—"), ...(terms ? [el("td", "", tp ? tp.text : "—")] : []));
      body.append(row);
    }
  }
  for (const id of [...tableTicked]) if (!point(id)) tableTicked.delete(id);
  table.append(body);
  const scroll = routeTable.scrollTop;
  routeTable.replaceChildren(tableTools(shown), table);
  if (filtering && !shown.length) routeTable.append(el("p", "hint rt-empty", "No homes match. Change the filters above."));
  routeTable.scrollTop = scroll;
}

// Scroll a location's or home's row into view and flash it.
function showTableRow(id) {
  const row = routeTable.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  // Scroll the table only, not the page around it.
  routeTable.scrollTop = row.offsetTop - routeTable.clientHeight / 2;
  row.classList.add("flash");
  setTimeout(() => row.classList.remove("flash"), 1600);
}
