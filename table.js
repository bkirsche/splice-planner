// The Table layout: every location in route order, each with the homes
// it feeds as rows (lot, splitter, F2, DS, drop). Suits a big job read
// like a spreadsheet. Tap a location or a home for its menu.

const routeTable = document.getElementById("route-table");

// How deep a location sits on the route, for the indent.
function routeDepth(id) {
  let d = 0;
  for (let x = incomingPath(id); x; x = incomingPath(x.from)) d++;
  return d;
}

function renderTable() {
  const homesAll = plan.points.filter((p) => p.type === "nid");
  const terms = homesAll.some((h) => homeTerminalPort(h));
  const table = el("table", "rt-table");
  const head = el("tr");
  for (const h of ["Home", "Lot", "Splitter", "F2", "DS", "Drop", ...(terms ? ["Terminal port"] : [])]) head.append(el("th", "", h));
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const body = el("tbody");
  const cols = terms ? 7 : 6;
  for (const L of routeOrder()) {
    if (L.type === "nid" || !phaseShown(L)) continue;
    const homes = shownPaths(L.id).map((x) => point(x.to)).filter((m) => m.type === "nid");
    const port = (h) => (h.ds ? h.ds.port : 999);
    homes.sort((a, b) => port(a) - port(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));

    // The location's own row: name, what feeds it, its splitters.
    const tr = el("tr", "rt-loc" + (L.id === selectedId ? " selected" : "") + (phasePast(L) ? " past" : ""));
    tr.dataset.id = L.id;
    const td = el("td");
    td.colSpan = cols;
    td.style.paddingLeft = `${12 + Math.min(routeDepth(L.id), 12) * 14}px`;
    const name = btnEl("", (e) => openMenu(L.id, e), "rt-name");
    name.append(iconEl((LOC_META[L.type] || {}).icon || "pin"), document.createTextNode(L.name));
    const bits = [typeLabel(L.type)];
    const c = incomingCable(L.id);
    if (c) bits.push(`${c.name} · ${c.fibers}F${cableKind(c) !== "cable" ? ` ${cableKindText(c).toLowerCase()}` : ""} from ${point(c.from).name}`);
    else if (L.id !== plan.points[0].id) bits.push(`from ${point(incomingPath(L.id).from).name}, no cable`);
    for (const s of splittersAt(L)) bits.push(`${s.name} ${s.ratio} · ${f2Label(s)}`);
    if (homes.length) bits.push(plural(homes.length, "home"));
    td.append(name, el("span", "rt-sub", bits.join(" · ")));
    tr.append(td);
    body.append(tr);

    for (const h of homes) {
      const row = el("tr", "rt-home" + (h.id === selectedId ? " selected" : "") + (phasePast(h) ? " past" : ""));
      row.dataset.id = h.id;
      const cell = el("td");
      cell.style.paddingLeft = `${30 + Math.min(routeDepth(L.id), 12) * 14}px`;
      cell.append(btnEl(h.name, (e) => openMenu(h.id, e), "rt-home-btn"));
      const s = homeSplitter(h);
      const drop = incomingCable(h.id);
      const tp = homeTerminalPort(h);
      row.append(cell, el("td", "mono", h.lot || "—"), el("td", "", s ? s.name : "—"),
        el("td", "mono strong", s && s.f2 ? f2CellFor(s) : "—"), el("td", "mono strong", homeDs(h) ? dsCell(h) : "—"),
        el("td", "", drop ? `${drop.name} · ${drop.fibers}F` : "—"), ...(terms ? [el("td", "", tp ? tp.text : "—")] : []));
      body.append(row);
    }
  }
  table.append(body);
  routeTable.replaceChildren(table);
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
