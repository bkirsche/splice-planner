// Connections at a location, one fiber or port at a time, and the editor
// for them: a splice case (fibers, splitter legs, trays and slots) or a
// cabinet's patching (shelf, panel and terminal ports too).
//
// Endpoints:
//   fiber:<cable>:<n>     fiber n of a cable (incoming or leaving here)
//   split:<splitter>:in   a splitter input; split:<splitter>:<n> an output
//   port:<equipment>:<p>  a port on a shelf, panel or terminal
//
// Signal runs left to right: a connection goes from a source (incoming
// fiber, splitter output, port) to a target (outgoing fiber, splitter
// input, port). Fiber and splitter connections are stored in the splice
// model itself (cable picks and pins, splitter F2), so splice sheets
// follow them; anything with a port is stored as a patch in
// plan.xconnects. Splice tray and slot numbers sit on the location.

// --- Endpoints ---

function findEquipment(eqId) {
  for (const p of plan.points) for (const e of p.equipment || []) if (e.id === eqId) return e;
  return null;
}

function crossConnectsAt(locId) {
  return plan.xconnects.filter((x) => x.at === locId);
}

function crossConnectFor(key) {
  const x = plan.xconnects.find((y) => y.a === key || y.b === key);
  return x ? { x, other: x.a === key ? x.b : x.a } : null;
}

function endpointOn(key, eqId) {
  return key.startsWith(`port:${eqId}:`) || key.startsWith(`split:${eqId}:`);
}

// Patches and tray numbers on equipment that's going away go with it.
function dropEquipmentLinks(eqId) {
  plan.xconnects = plan.xconnects.filter((x) => !endpointOn(x.a, eqId) && !endpointOn(x.b, eqId));
  for (const c of plan.cables) {
    for (const [n, it] of Object.entries(c.pins || {})) if (it.startsWith(`port:${eqId}:`)) delete c.pins[n];
  }
}

function dropPortPatches(eqId, portIds) {
  const gone = (k) => k.startsWith(`port:${eqId}:`) && portIds.has(k.split(":")[2]);
  plan.xconnects = plan.xconnects.filter((x) => !gone(x.a) && !gone(x.b));
}

function fiberText(c, n) {
  const f = colorCode(c.fibers)[n - 1];
  if (!f) return `#${n}`;
  return `#${n} ${tubeCount(c.fibers) > 1 ? f.tubeColor.name + " tube, " : ""}${f.fiberColor.name}`;
}

function endpointLabel(key) {
  const [kind, id, sub] = key.split(":");
  if (kind === "fiber") {
    const c = plan.cables.find((x) => x.id === id);
    if (!c || Number(sub) > c.fibers) return "(removed fiber)";
    return `${c.name} ${fiberText(c, Number(sub))}`;
  }
  const eq = findEquipment(id);
  if (!eq) return "(removed equipment)";
  if (kind === "split") {
    if (sub === "in") return `${eqLabel(eq)} input`;
    if (sub === "auto") return `${eqLabel(eq)} output (no DS set)`;
    return `${eqLabel(eq)} output ${sub}`;
  }
  for (const card of eq.cards || []) {
    const port = card.ports.find((x) => x.id === sub);
    if (port) return `${eqLabel(eq)}, ${card.name}, port ${port.name}`;
  }
  return "(removed port)";
}

function endpointMissing(key) {
  return endpointLabel(key).startsWith("(removed");
}

// --- Connections at a location ---

// [{ from, to, kind: "splice" | "split-in" | "split-out" | "patch", cable, out, x }]
function connectionsAt(model, locId) {
  const L = point(locId);
  const list = [];
  const arriving = incomingCable(locId);
  const inCable = arriving && cableStart(arriving);
  const here = splittersAt(L);
  for (const s of here) {
    const sc = feederAt(locId, s);
    const sIn = sc && cableStart(sc);
    if (s.f2 && sIn && s.f2 <= sIn.fibers) list.push({ from: `fiber:${sIn.id}:${s.f2}`, to: `split:${s.id}:in`, kind: "split-in", s });
  }
  const inMap = inCable ? model.assign(inCable).map : new Map();
  const byItem = new Map([...inMap].map(([n, it]) => [it, n]));
  for (const d of childCables(locId).filter((x) => !x.through)) {
    for (const f of model.childFibers(d)) {
      const to = `fiber:${d.id}:${f.out}`;
      const sp = here.find((s) => f.item.startsWith(`port:${s.id}:`));
      if (sp) {
        const port = f.item.split(":")[2];
        list.push({ from: `split:${sp.id}:${port.startsWith("auto") ? "auto" : port}`, to, kind: "split-out", cable: d, out: f.out });
      } else if (inCable && d.picks) {
        if (f.in) list.push({ from: `fiber:${inCable.id}:${f.in}`, to, kind: "splice", cable: d, out: f.out });
      } else if (inCable && byItem.has(f.item)) {
        list.push({ from: `fiber:${inCable.id}:${byItem.get(f.item)}`, to, kind: "splice", cable: d, out: f.out });
      }
    }
  }
  for (const x of crossConnectsAt(locId)) list.push({ from: x.a, to: x.b, kind: "patch", x });
  return list;
}

// Sources (left) and targets (right) at a location, in groups.
function endpointGroups(locId) {
  const L = point(locId);
  const left = [];
  const right = [];
  const fiberGroup = (c, where) => {
    const g = { title: `${c.name} · ${c.fibers}F ${where}`, items: [] };
    for (const f of colorCode(c.fibers)) {
      g.items.push({ key: `fiber:${c.id}:${f.number}`, label: `#${f.number}`, sub: fiberText(c, f.number).replace(/^#\d+ /, ""),
        color: f.fiberColor, tube: tubeCount(c.fibers) > 1 ? f.tubeColor : null, tubeNo: f.tube });
    }
    return g;
  };
  for (const eq of L.equipment || []) {
    if (eq.type === "splitter") {
      const outs = { title: `${eqLabel(eq)} outputs`, items: [] };
      for (let n = 1; n <= splitterPorts(eq); n++) outs.items.push({ key: `split:${eq.id}:${n}`, label: `Out ${n}` });
      left.push(outs);
      right.push({ title: `${eqLabel(eq)}`, items: [{ key: `split:${eq.id}:in`, label: "Input" }] });
    }
    if (hasCards(eq)) {
      const g = { title: eqLabel(eq), items: [] };
      for (const card of eq.cards) for (const port of card.ports) g.items.push({ key: `port:${eq.id}:${port.id}`, label: port.name, sub: card.name });
      left.push(g);
      // An OLT only sends; panels and terminals pass light through.
      if (eq.type !== "shelf") right.push({ ...g, items: g.items.map((x) => ({ ...x })) });
    }
  }
  // The incoming cable goes after the splitters and ports: it can be long.
  const arriving = incomingCable(locId);
  if (arriving) left.push(fiberGroup(cableStart(arriving), "in"));
  for (const d of childCables(locId).filter((x) => !x.through)) right.push(fiberGroup(d, "out"));
  return { left, right };
}

// --- Changing connections ---

// Before the first hand edit at a location, write down what the app
// picked so other cables don't shift under the user.
function freezeAt(model, locId) {
  const here = splittersAt(point(locId));
  for (const d of childCables(locId).filter((x) => !x.through)) {
    if (!d.picks) d.picks = toRanges(model.autoPairs(d));
    d.pins = d.pins || {};
    for (const [n, it] of model.assign(d).map) {
      if (here.some((s) => it.startsWith(`port:${s.id}:`)) && !it.includes(":auto-")) d.pins[n] = it;
    }
  }
}

function removePick(d, out) {
  d.picks = toRanges(expandPicks(d.picks).filter((p) => p.out !== out));
}

function removePicksFrom(locId, inN) {
  for (const d of childCables(locId).filter((x) => !x.through && x.picks)) {
    d.picks = toRanges(expandPicks(d.picks).filter((p) => p.in !== inN));
  }
}

function cableOf(key) {
  const [kind, id] = key.split(":");
  return kind === "fiber" ? plan.cables.find((c) => c.id === id) : null;
}

// Clear whatever feeds a target, so it can take a new connection.
function clearTarget(locId, to) {
  plan.xconnects = plan.xconnects.filter((x) => !(x.at === locId && x.b === to));
  const [kind, id, sub] = to.split(":");
  if (kind === "fiber") {
    const d = cableOf(to);
    if (d && d.from === locId) {
      if (d.picks) removePick(d, Number(sub));
      if (d.pins) delete d.pins[sub];
    }
  }
  if (kind === "split" && sub === "in") {
    const s = findEquipment(id);
    if (s) {
      s.f2 = null;
      s.f2Manual = true;
    }
  }
}

// Clear whatever a source feeds.
function clearSource(locId, from) {
  plan.xconnects = plan.xconnects.filter((x) => !(x.at === locId && x.a === from));
  const [kind, id, sub] = from.split(":");
  if (kind === "fiber") {
    const n = Number(sub);
    removePicksFrom(locId, n);
    for (const s of splittersAt(point(locId))) {
      if (s.f2 === n) {
        s.f2 = null;
        s.f2Manual = true;
      }
    }
  }
  if (kind === "split") {
    const item = `port:${id}:${sub}`;
    for (const d of childCables(locId)) {
      for (const [n, it] of Object.entries(d.pins || {})) if (it === item) delete d.pins[n];
    }
  }
}

function connect(locId, from, to) {
  const model = buildSpliceModel();
  freezeAt(model, locId);
  clearSource(locId, from);
  clearTarget(locId, to);
  const [fk, , fsub] = from.split(":");
  const [tk, tid, tsub] = to.split(":");
  const d = tk === "fiber" ? cableOf(to) : null;
  const outgoing = d && d.from === locId;
  if (fk === "fiber" && outgoing) {
    d.picks = toRanges([...expandPicks(d.picks), { in: Number(fsub), out: Number(tsub) }]);
  } else if (fk === "fiber" && tk === "split" && tsub === "in") {
    const s = findEquipment(tid);
    s.f2 = Number(fsub);
    s.f2Manual = true;
  } else if (fk === "split" && fsub !== "in" && fsub !== "auto" && outgoing) {
    d.pins[tsub] = `port:${from.split(":")[1]}:${fsub}`;
  } else {
    plan.xconnects.push({ id: makeId(), at: locId, a: from, b: to });
  }
  savePlan();
}

function disconnect(locId, conn) {
  disconnectAll(locId, [conn]);
}

// Take several connections apart in one go.
function disconnectAll(locId, conns) {
  const model = buildSpliceModel();
  freezeAt(model, locId);
  for (const c of conns) clearTarget(locId, c.to);
  savePlan();
}

// Back to the app's own choices for the cables leaving here.
function resetConnections(locId) {
  for (const d of childCables(locId)) {
    delete d.picks;
    delete d.pins;
  }
  savePlan();
}

// Splice anything left unspliced on hand-picked cables to the next free
// incoming fibers.
function fillGaps(locId) {
  const model = buildSpliceModel();
  const arriving = incomingCable(locId);
  if (!arriving) return 0;
  const inCable = cableStart(arriving);
  const used = new Set([...fixedInUse(inCable.id).keys()]);
  let filled = 0;
  for (const d of childCables(locId).filter((x) => !x.through && x.picks)) {
    for (const f of model.childFibers(d)) {
      if (f.in || splittersAt(point(locId)).some((s) => f.item.startsWith(`port:${s.id}:`))) continue;
      let n = 1;
      while (used.has(n) && n <= inCable.fibers) n++;
      if (n > inCable.fibers) return filled;
      used.add(n);
      d.picks = toRanges([...expandPicks(d.picks), { in: n, out: f.out }]);
      filled++;
    }
  }
  savePlan();
  return filled;
}

// --- Trays and slots ---
// With a splice case at the location, every splice gets a tray and slot:
// in order by default, or as the user set it.

function closureAt(L) {
  return (L.equipment || []).find((e) => e.type === "closure");
}

// Splices per tray the user can pick for a case.
const TRAY_SIZES = [24, 36, 48, 72, 96, 144];

// The cable tube a splice key belongs to, so a tube can stay in one tray.
function tubeGroup(key) {
  const [kind, id, sub] = key.split(":");
  if (kind !== "fiber") return null;
  const c = plan.cables.find((x) => x.id === id);
  const f = c && colorCode(c.fibers)[Number(sub) - 1];
  return f ? `${id}:${f.tube}` : null;
}

function traySlots(L, keys) {
  const out = new Map();
  const set = L.trays || {};
  const closure = closureAt(L);
  const taken = new Set(Object.values(set).map((t) => `${t.tray}/${t.slot}`));
  // Splices left to place in each tube, so a tube that fits in a tray
  // starts a fresh tray rather than jumping across two.
  const left = new Map();
  for (const key of keys) {
    const g = !set[key] && tubeGroup(key);
    if (g) left.set(g, (left.get(g) || 0) + 1);
  }
  let i = 0;
  let last = null;
  for (const key of keys) {
    if (set[key]) {
      out.set(key, set[key]);
      continue;
    }
    if (!closure) continue;
    const g = tubeGroup(key);
    if (g && g !== last) {
      const room = closure.slots - (i % closure.slots);
      const need = left.get(g);
      if (need > room && need <= closure.slots) i += room;
    }
    last = g;
    if (g) left.set(g, left.get(g) - 1);
    let pos;
    do {
      pos = { tray: Math.floor(i / closure.slots) + 1, slot: (i % closure.slots) + 1 };
      i++;
    } while (taken.has(`${pos.tray}/${pos.slot}`));
    out.set(key, pos);
  }
  return out;
}

// A splice case's trays as cards of slot circles. `at` maps "tray/slot"
// to the splice key in it; onSlot makes the slots tappable.
function trayPicture(trays, size, at = new Map(), onSlot = null, selected = null) {
  const grid = el("div", "cx-trays");
  for (let t = 1; t <= trays; t++) {
    const tray = el("div", "cx-tray-card");
    const cells = el("div", "cx-tray-slots");
    let n = 0;
    for (let sl = 1; sl <= size; sl++) {
      const key = at.get(`${t}/${sl}`);
      const cell = el(onSlot ? "button" : "span", "cx-slot" + (key ? " full" : "") + (key && key === selected ? " sel" : ""));
      if (onSlot) {
        cell.type = "button";
        cell.addEventListener("click", () => onSlot(t, sl, key));
      }
      if (key) {
        n++;
        const [kind, id, sub] = key.split(":");
        const c = kind === "fiber" && plan.cables.find((x) => x.id === id);
        const f = c && colorCode(c.fibers)[Number(sub) - 1];
        if (f) {
          cell.style.background = f.fiberColor.hex;
          if (f.fiberColor.striped) cell.classList.add("striped");
        }
        cell.title = `Tray ${t} slot ${sl}: ${endpointLabel(key)}`;
      } else cell.title = `Tray ${t} slot ${sl}: empty`;
      cells.append(cell);
    }
    tray.append(el("div", "cx-tray-head mono", `Tray ${t} · ${n}/${size}`), cells);
    grid.append(tray);
  }
  return grid;
}

// --- Editor ---

// How far the case opens: "cables" (names and counts only), "tubes"
// (cables and their tubes) or "strands" (every fiber). On top of that,
// cables and tubes the user opened or folded one by one, per location,
// so they stay that way when the editor comes back (after an Undo, say).
let foldLevel = "tubes";
const caseFolds = new Map();
const FOLD_LEVELS = [
  ["cables", "Cables", "Only the cables, with how much is connected"],
  ["tubes", "Tubes", "Cables and their tubes"],
  ["strands", "Strands", "Every fiber"],
];

// Tap or Enter/Space folds or opens a header. Its own buttons and
// checkboxes keep their clicks.
function foldToggle(elm, open, toggle) {
  elm.tabIndex = 0;
  elm.setAttribute("role", "button");
  elm.setAttribute("aria-expanded", String(open));
  elm.addEventListener("pointerdown", (e) => e.stopPropagation());
  elm.addEventListener("click", (e) => {
    if (!e.target.closest("button, input")) toggle();
  });
  elm.addEventListener("keydown", (e) => {
    if (e.target === elm && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggle();
    }
  });
}

function openConnections(locId) {
  const L = point(locId);
  let picked = null; // a source or target waiting for its other end
  if (!caseFolds.has(locId)) caseFolds.set(locId, { cables: new Map(), tubes: new Map() });
  const folds = caseFolds.get(locId); // cable key -> open, tube key -> folded
  let moving = null; // a splice being moved to another tray slot
  let selecting = false; // tapping a row selects it instead of connecting
  const sel = new Set(); // selected connections, by their target key
  let anchor = null; // the last row selected, for Shift ranges
  let now = null; // this render's connections, for selecting
  let hidden = null; // side -> key -> tube header, for rows folded away
  const title = isCabinet(L) ? `Connections at ${L.name}` : closureAt(L) ? `Splice case at ${L.name}` : `Splices at ${L.name}`;
  openForm(title, (body, foot) => {
    const info = el("div", "cx-info");
    const tools = el("div", "cx-tools");
    const selbar = el("div", "cx-selbar");
    const wrap = el("div", "cx-wrap");
    body.append(info, tools, selbar, wrap);
    const reopen = () => openConnections(locId);

    // Take connections apart, with an Undo note that brings it all back
    // (trays and slots too) and reopens the editor.
    function removeConns(list, where) {
      if (!list.length) return;
      const n = list.length;
      const text = n === 1 ? `Took apart ${endpointLabel(list[0].from)} → ${endpointLabel(list[0].to)}.`
        : `Took apart ${n} connections ${where}.`;
      withUndo(text, () => disconnectAll(locId, list), reopen);
      for (const c of list) sel.delete(c.to);
      render();
    }

    function render() {
      const model = buildSpliceModel();
      const conns = connectionsAt(model, locId);
      const bySource = new Map(conns.map((c) => [c.from, c]));
      const byTarget = new Map(conns.map((c) => [c.to, c]));
      now = { bySource, byTarget };
      hidden = { L: new Map(), R: new Map() };
      for (const k of [...sel]) if (!byTarget.has(k)) sel.delete(k);
      const connOf = (side, key) => (side === "L" ? bySource : byTarget).get(key);
      const allSel = (list) => list.length > 0 && list.every((c) => sel.has(c.to));
      const toggleAll = (list) => {
        const on = !allSel(list);
        for (const c of list) on ? sel.add(c.to) : sel.delete(c.to);
        render();
      };
      const checkbox = (list) => {
        const box = el("input", "cx-check");
        box.type = "checkbox";
        box.checked = allSel(list);
        box.indeterminate = !box.checked && list.some((c) => sel.has(c.to));
        box.tabIndex = -1;
        return box;
      };
      const { left, right } = endpointGroups(locId);
      const closure = closureAt(L);
      const slots = traySlots(L, conns.filter((c) => c.kind !== "patch").map((c) => c.to));

      info.innerHTML = "";
      const through = childCables(locId).filter((x) => x.through);
      const lines = [];
      if (closure) lines.push(`${eqLabel(closure)}: ${closure.trays} trays x ${closure.slots} splices.`);
      for (const t of through) lines.push(`${t.name} ${THROUGH_LABELS[t.through]} here (not spliced).`);
      lines.push("Drag from the left to the right to connect, or tap one end and then the other. Tap a line or × to take it apart.");
      for (const l of lines) info.append(el("p", "hint", l));
      if (!incomingCable(locId) && L.id !== plan.points[0].id) {
        info.append(el("p", "hint warn", `No cable reaches ${L.name} yet. You can still look around and set things up here.`));
      }
      // The case drawn as it sits. Tap a spliced slot, then another
      // slot, to move it there (or swap with what's there).
      if (closure) {
        const at = new Map();
        for (const [key, ts] of slots) at.set(`${ts.tray}/${ts.slot}`, key);
        if (moving) info.append(el("p", "hint", `Moving ${endpointLabel(moving)}: tap the slot to put it in, or tap it again to cancel.`));
        info.append(trayPicture(closure.trays, closure.slots, at, (tray, slot, key) => {
          if (!moving) {
            if (key) moving = key;
          } else if (key === moving) moving = null;
          else {
            L.trays = L.trays || {};
            const from = slots.get(moving);
            if (key && from) L.trays[key] = { tray: from.tray, slot: from.slot };
            L.trays[moving] = { tray, slot };
            moving = null;
            savePlan();
            renderRoute();
          }
          render();
        }, moving));
      }

      tools.innerHTML = "";
      // One switch for the whole case; headers still open one branch.
      const levels = el("div", "cx-levels");
      levels.setAttribute("role", "group");
      levels.setAttribute("aria-label", "Show");
      levels.append(el("span", "cx-levels-label", "Show"));
      for (const [v, name, tip] of FOLD_LEVELS) {
        const b = btnEl(name, () => {
          foldLevel = v;
          folds.cables.clear();
          folds.tubes.clear();
          render();
        }, "cx-level" + (foldLevel === v ? " on" : ""));
        b.title = tip;
        b.setAttribute("aria-pressed", String(foldLevel === v));
        levels.append(b);
      }
      tools.append(levels);
      tools.append(btnEl("Fill gaps from free fibers", () => {
        const n = fillGaps(locId);
        render();
        renderRoute();
        flash(n ? `Spliced ${n} fiber${n === 1 ? "" : "s"}.` : "Nothing left to fill.");
      }, "btn ghost"), btnEl("Reset to automatic", () => {
        withUndo("Back to the app's own choices for the cables leaving here. Patches and F2 counts stayed.", () => resetConnections(locId));
        render();
      }, "btn ghost"));
      if (!closure && !isCabinet(L)) tools.append(btnEl("Add a splice case", () => openEquipment(locId), "btn ghost"));
      if (conns.length) {
        tools.append(btnEl(selecting ? "Stop selecting" : "Select…", () => {
          selecting = !selecting;
          if (!selecting) sel.clear();
          picked = null;
          render();
        }, "btn ghost" + (selecting ? " on" : "")), btnEl(`Remove all ${conns.length}`, () => removeConns(conns, `at ${L.name}`), "btn ghost cx-danger"));
      }

      // While selecting: what's picked, and what to do with it. Stays in
      // view while the list scrolls.
      selbar.innerHTML = "";
      selbar.hidden = !selecting;
      if (selecting) {
        const list = conns.filter((c) => sel.has(c.to));
        selbar.append(el("span", "cx-selcount", list.length ? `${list.length} selected` : "Tap connections or tube headers to select them. Shift-tap selects a range."));
        if (list.length) selbar.append(btnEl(`Remove ${list.length} selected`, () => removeConns(list, "you selected"), "btn cx-danger-solid"));
        selbar.append(btnEl(allSel(conns) ? "Select none" : "Select all", () => toggleAll(conns), "btn ghost"),
          btnEl("Done", () => {
            selecting = false;
            sel.clear();
            render();
          }, "btn ghost"));
      }

      wrap.innerHTML = "";
      const colL = el("div", "cx-col cx-left");
      const colR = el("div", "cx-col cx-right");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cx-lines");
      wrap.append(colL, el("div", "cx-gap"), colR, svg);

      const endRow = (item, side) => {
        const conn = connOf(side, item.key);
        const row = el("div", "cx-end" + (conn ? " on" : "") + (picked && picked.key === item.key && picked.side === side ? " picked" : "")
          + (conn && sel.has(conn.to) ? " sel" : ""));
        row.dataset.key = item.key;
        row.dataset.side = side;
        if (selecting) row.classList.add("selecting");
        const dot = el("span", "cx-dot");
        if (item.color) {
          dot.style.background = item.color.hex;
          if (item.color.striped) dot.classList.add("striped");
        }
        const label = el("span", "cx-label mono", item.label);
        const sub = el("span", "cx-sub", conn ? `${side === "L" ? "→" : "←"} ${endpointLabel(side === "L" ? conn.to : conn.from)}` : item.sub || "");
        if (side === "L") row.append(label, sub, dot);
        else row.append(dot, label, sub);
        if (side === "R" && conn && conn.kind !== "patch" && (closure || (L.trays || {})[item.key])) {
          const ts = slots.get(item.key) || {};
          const tray = inputEl("number", ts.tray || "", { min: 1, title: "Tray" });
          const slot = inputEl("number", ts.slot || "", { min: 1, title: "Slot" });
          const save = () => {
            L.trays = L.trays || {};
            if (tray.value && slot.value) L.trays[item.key] = { tray: Number(tray.value), slot: Number(slot.value) };
            else delete L.trays[item.key];
            savePlan();
          };
          tray.addEventListener("change", save);
          slot.addEventListener("change", save);
          [tray, slot].forEach((x) => x.addEventListener("pointerdown", (e) => e.stopPropagation()));
          const ts2 = el("span", "cx-tray mono");
          ts2.append(el("span", "", "T"), tray, el("span", "", "S"), slot);
          row.append(ts2);
        }
        if (conn) {
          const x = btnEl("×", (e) => {
            e.stopPropagation();
            removeConns([conn]);
          }, "cx-x");
          x.title = "Take this connection apart";
          x.addEventListener("pointerdown", (e) => e.stopPropagation());
          row.append(x);
        }
        if (selecting) {
          const box = checkbox(conn ? [conn] : []);
          box.disabled = !conn;
          row.append(box);
        }
        if (item.key.endsWith(":auto")) row.classList.add("fixed");
        if (item.tube) tintTube(row, item.tube);
        return row;
      };

      // Cables and tubes open as far as the level says; a tap on any
      // cable or tube header folds or opens just that one.
      const fill = (col, groups, side) => {
        for (const g of groups) {
          const box = el("div", "cx-group");
          box.dataset.title = g.title;
          const head = el("div", "cx-head");
          const cableKey = `${side}:${g.title}`;
          const open = folds.cables.has(cableKey) ? folds.cables.get(cableKey) : foldLevel !== "cables";
          head.append(el("span", "cx-chev", open ? "▾" : "▸"), el("span", "cx-title", g.title));
          head.title = open ? "Fold this cable up" : "Show this cable's tubes";
          foldToggle(head, open, () => {
            folds.cables.set(cableKey, !open);
            render();
          });
          box.append(head);
          const tubes = new Map(); // tube number -> its items
          for (const item of g.items) if (item.tube) {
            if (!tubes.has(item.tubeNo)) tubes.set(item.tubeNo, []);
            tubes.get(item.tubeNo).push(item);
          }
          const connsIn = (items) => items.map((x) => connOf(side, x.key)).filter(Boolean);
          const tubeKey = (t) => `${side}:${g.title}:${t}`;
          // A cable with one tube shows its fibers from the Tubes level.
          const isFolded = (t) => (folds.tubes.has(tubeKey(t)) ? folds.tubes.get(tubeKey(t))
            : !(foldLevel === "strands" || tubes.size === 1));

          // Cable header: how much is connected, fold or open every tube,
          // take the whole cable apart.
          const groupConns = connsIn(g.items);
          if (selecting && groupConns.length) {
            const cb = checkbox(groupConns);
            cb.title = "Select every connection on this cable";
            cb.tabIndex = 0;
            cb.addEventListener("click", (e) => {
              e.preventDefault();
              toggleAll(groupConns);
            });
            head.prepend(cb);
          }
          if (g.items.length > 1) head.append(el("span", "cx-count mono", `${groupConns.length} of ${g.items.length}`));
          const acts = el("span", "cx-acts");
          if (open && tubes.size > 1) {
            const anyOpen = [...tubes.keys()].some((t) => !isFolded(t));
            acts.append(btnEl(anyOpen ? "Fold tubes" : "Open tubes", () => {
              for (const t of tubes.keys()) folds.tubes.set(tubeKey(t), anyOpen);
              render();
            }, "cx-link"));
          }
          if (groupConns.length) {
            const rm = btnEl("Remove all", () => removeConns(groupConns, `on ${g.title}`), "cx-link danger");
            rm.title = `Take apart all ${groupConns.length} connections on ${g.title}`;
            acts.append(rm);
          }
          head.append(acts);

          // A folded cable is just its header; lines to it end there.
          if (!open) {
            box.classList.add("folded");
            for (const x of g.items) hidden[side].set(x.key, head);
            col.append(box);
            continue;
          }
          let tube = null;
          for (const item of g.items) {
            const folded = item.tube && isFolded(item.tubeNo);
            if (item.tube && item.tubeNo !== tube) {
              tube = item.tubeNo;
              const t = tube;
              const items = tubes.get(t);
              const list = connsIn(items);
              const th = el("div", "cx-tube" + (folded ? " folded" : "") + (list.length ? " has" : ""));
              th.title = folded ? "Show this tube's fibers" : "Fold this tube up";
              if (selecting && list.length) {
                const cb = checkbox(list);
                cb.title = "Select every connection in this tube";
                cb.addEventListener("click", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleAll(list);
                });
                th.append(cb);
              }
              const sw = swatch(item.tube, true);
              th.append(el("span", "cx-chev", folded ? "▸" : "▾"), sw, el("span", "cx-tname", `Tube ${t} · ${item.tube.name}`),
                el("span", "cx-count mono", list.length ? `${list.length} of ${items.length} connected` : "nothing connected"));
              if (list.length) {
                const rm = btnEl("Remove all", (e) => {
                  e.stopPropagation();
                  removeConns(list, `in tube ${t} of ${g.title}`);
                }, "cx-link danger");
                rm.title = `Take apart all ${list.length} connections in tube ${t}`;
                th.append(rm);
              }
              foldToggle(th, !folded, () => {
                folds.tubes.set(tubeKey(t), !folded);
                render();
              });
              box.append(th);
              // Lines to a folded tube end at its header.
              if (folded) for (const x of items) hidden[side].set(x.key, sw);
            }
            if (!folded) box.append(endRow(item, side));
          }
          col.append(box);
        }
        if (!groups.length) col.append(el("p", "hint", side === "L" ? "Nothing feeds in here yet." : "Nothing leaves here yet."));
      };
      fill(colL, left, "L");
      fill(colR, right, "R");
      // Auto outputs (homes on a splitter with no DS) can't be dragged, but show.
      for (const c of conns.filter((x) => x.from.endsWith(":auto"))) {
        if (!colL.querySelector(`[data-key="${CSS.escape(c.from)}"]`)) {
          const s = findEquipment(c.from.split(":")[1]);
          const g = [...colL.querySelectorAll(".cx-group")].find((x) => x.dataset.title === `${eqLabel(s)} outputs`);
          if (g && g.classList.contains("folded")) hidden.L.set(c.from, g.querySelector(".cx-head"));
          else (g || colL).append(endRow({ key: c.from, label: "No DS" }, "L"));
        }
      }
      shown = conns;
      stickLeft();
      requestAnimationFrame(() => drawLines(conns));
    }

    // The incoming side stays in view while the long right side scrolls
    // (below the select bar, when it shows). Taller than the dialog, it
    // scrolls on its own. Lines follow either scroll.
    let shown = null;
    let queued = false;
    function stickLeft() {
      const colL = wrap.querySelector(".cx-left");
      const top = selbar.hidden ? 0 : selbar.offsetHeight + 8;
      const cs = getComputedStyle(formPanel);
      colL.style.top = `${top}px`;
      colL.style.maxHeight = `${formPanel.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - top}px`;
      colL.addEventListener("scroll", redraw);
    }
    function redraw() {
      if (!wrap.isConnected) {
        formPanel.removeEventListener("scroll", redraw);
        removeEventListener("resize", restick);
        return;
      }
      if (queued || !shown) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (wrap.isConnected) drawLines(shown);
      });
    }
    function restick() {
      if (wrap.isConnected) stickLeft();
      redraw();
    }
    formPanel.addEventListener("scroll", redraw);
    addEventListener("resize", restick);

    // The fiber color of a key, for lines whose row is folded away.
    function keyColor(key) {
      const c = cableOf(key);
      const f = c && colorCode(c.fibers)[Number(key.split(":")[2]) - 1];
      return f ? f.fiberColor.hex : "";
    }

    // Lines between the two columns, colored by the source fiber.
    function drawLines(conns) {
      const box = wrap.getBoundingClientRect();
      const svg = wrap.querySelector(".cx-lines");
      svg.setAttribute("width", box.width);
      svg.setAttribute("height", wrap.scrollHeight);
      svg.innerHTML = "";
      // Rows scrolled out of the left column draw from its edge.
      const cl = wrap.querySelector(".cx-left").getBoundingClientRect();
      for (const c of conns) {
        const rowA = wrap.querySelector(`.cx-left [data-key="${CSS.escape(c.from)}"] .cx-dot`);
        const rowB = wrap.querySelector(`.cx-right [data-key="${CSS.escape(c.to)}"] .cx-dot`);
        const a = rowA || hidden.L.get(c.from);
        const b = rowB || hidden.R.get(c.to);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const ya = ra.top + ra.height / 2;
        const out = ya < cl.top || ya > cl.bottom;
        const x1 = (rowA ? ra.right : cl.right) - box.left;
        const y1 = Math.min(Math.max(ya, cl.top), cl.bottom) - box.top;
        const x2 = rb.left - box.left;
        const y2 = rb.top + rb.height / 2 - box.top;
        const mid = (x1 + x2) / 2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
        // A line into a folded tube only points at it: open the tube to
        // work on that fiber.
        const folded = !rowA || !rowB || out;
        path.setAttribute("class", "cx-line " + c.kind + (folded ? " folded" : "") + (sel.has(c.to) ? " sel" : ""));
        const color = rowA ? rowA.style.background : keyColor(c.from);
        if (color) path.style.stroke = color;
        if (!folded) path.addEventListener("click", () => removeConns([c]));
        const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
        t.textContent = `${endpointLabel(c.from)} → ${endpointLabel(c.to)}`;
        path.append(t);
        svg.append(path);
      }
    }

    function flash(text) {
      const note = el("p", "cx-flash", text);
      tools.append(note);
      setTimeout(() => note.remove(), 2500);
    }

    function join(a, b) {
      const from = a.side === "L" ? a : b;
      const to = a.side === "L" ? b : a;
      if (from.side === to.side || from.key.endsWith(":auto")) return;
      if (from.key === to.key) return;
      connect(locId, from.key, to.key);
      render();
      renderRoute();
    }

    // Select a row's connection, or with Shift every connection from the
    // last one picked to this one, down the same column.
    function choose(d) {
      const conn = (d.side === "L" ? now.bySource : now.byTarget).get(d.key);
      if (!conn) return;
      selecting = true;
      picked = null;
      if (d.shift && anchor && anchor.side === d.side) {
        const rows = [...wrap.querySelectorAll(`.cx-${d.side === "L" ? "left" : "right"} .cx-end`)].map((r) => r.dataset.key);
        const i = rows.indexOf(anchor.key);
        const j = rows.indexOf(d.key);
        if (i >= 0 && j >= 0) {
          for (const k of rows.slice(Math.min(i, j), Math.max(i, j) + 1)) {
            const c = (d.side === "L" ? now.bySource : now.byTarget).get(k);
            if (c) sel.add(c.to);
          }
        } else sel.add(conn.to);
      } else if (sel.has(conn.to)) sel.delete(conn.to);
      else sel.add(conn.to);
      anchor = d;
      render();
    }

    // Drag from one end to the other, or tap one then the other.
    let drag = null;
    wrap.addEventListener("pointerdown", (e) => {
      const end = e.target.closest(".cx-end");
      if (!end) return;
      // Ctrl or Shift, or Select mode: tapping selects instead.
      const choose = selecting || e.ctrlKey || e.metaKey || e.shiftKey;
      if (end.classList.contains("fixed") && !choose) return;
      e.preventDefault();
      if (choose) {
        drag = { key: end.dataset.key, side: end.dataset.side, choose: true, shift: e.shiftKey };
        return;
      }
      drag = { key: end.dataset.key, side: end.dataset.side, x: e.clientX, y: e.clientY, moved: false, dot: end.querySelector(".cx-dot") };
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!drag || drag.choose) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      const box = wrap.getBoundingClientRect();
      const svg = wrap.querySelector(".cx-lines");
      let temp = svg.querySelector(".cx-temp");
      if (!temp) {
        temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
        temp.setAttribute("class", "cx-temp");
        svg.append(temp);
      }
      // From where the row is now: one side may stay put while the other scrolls.
      const dot = drag.dot.getBoundingClientRect();
      const x0 = (drag.side === "L" ? dot.right : dot.left) - box.left;
      const y0 = dot.top + dot.height / 2 - box.top;
      temp.setAttribute("d", `M${x0},${y0} L${e.clientX - box.left},${e.clientY - box.top}`);
      // Keep the list moving when dragging near the top or bottom.
      const pr = formPanel.getBoundingClientRect();
      if (e.clientY > pr.bottom - 40) formPanel.scrollTop += 12;
      if (e.clientY < pr.top + 40) formPanel.scrollTop -= 12;
    });
    wrap.addEventListener("pointerup", (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      const temp = wrap.querySelector(".cx-temp");
      if (temp) temp.remove();
      if (d.choose) return choose(d);
      if (!d.moved) {
        if (picked && picked.side !== d.side) {
          const p = picked;
          picked = null;
          return join(p, d);
        }
        picked = picked && picked.key === d.key && picked.side === d.side ? null : { key: d.key, side: d.side };
        return render();
      }
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const end = target && target.closest(".cx-end");
      if (end) join(d, { key: end.dataset.key, side: end.dataset.side });
    });

    render();
    foot.append(btnEl("Splice sheet", () => openSpliceSheet(locId), "btn ghost push-left"), btnEl("Done", finish, "btn big"));
  }, true);
  formPanel.classList.add("cx-panel");
  if (document.activeElement) document.activeElement.blur();
  formPanel.scrollTop = 0;
  selectedId = locId;
  renderRoute();
}

// The patches at a location as a table, for splice sheets.
function crossConnectTable(locId) {
  const list = crossConnectsAt(locId).filter(phaseShown);
  if (!list.length) return null;
  const wrap = el("div", "xc-block");
  wrap.append(el("h4", "", "Patches and cross-connects"));
  const table = el("table", "sheet-table splice-table");
  const head = el("tr");
  for (const h of ["From", "", "To", "Note", "Done"]) head.append(el("th", "", h));
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  for (const x of list) {
    const tr = el("tr");
    if (endpointMissing(x.a) || endpointMissing(x.b)) tr.className = "problem";
    if (phasePast(x)) tr.classList.add("existing");
    tr.append(el("td", "strong", endpointLabel(x.a)), el("td", "", "→"), el("td", "strong", endpointLabel(x.b)),
      el("td", "", [phasePast(x) ? `Existing · ${phaseName(phaseIdx(x))}` : "", x.note || ""].filter(Boolean).join(" · ")), el("td", "checkbox-cell", "☐"));
    table.append(tr);
  }
  wrap.append(table);
  return wrap;
}
