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

// Take locations and/or cable spans out of the plan, with everything
// that pointed at them: spans starting or ending at a removed location,
// the rest of a removed span's run, patches on their fibers and on the
// removed locations' equipment, pins on that equipment, tails, tray
// numbers, and homes on those splitters and terminals. Picks go with
// their spans. Call it inside the caller's withUndo, so Undo puts it all
// back.
function purgeRemoved(pointIds = [], cableIds = []) {
  const points = new Set(pointIds);
  const cables = new Set(cableIds);
  const eqs = new Set();
  for (const p of plan.points) if (points.has(p.id)) for (const eq of p.equipment || []) eqs.add(eq.id);
  for (const c of plan.cables) if (points.has(c.from) || points.has(c.to)) cables.add(c.id);
  // A cable's run past a removed span goes too. Worked out before any
  // span is gone, since prevSpan falls back to whatever arrives there.
  for (let more = true; more;) {
    more = false;
    for (const c of plan.cables) {
      if (!c.through || cables.has(c.id)) continue;
      const up = prevSpan(c);
      if (up && cables.has(up.id)) {
        cables.add(c.id);
        more = true;
      }
    }
  }
  const gone = (key) => {
    const [kind, id] = key.split(":");
    return kind === "fiber" ? cables.has(id) : eqs.has(id);
  };
  plan.points = plan.points.filter((p) => !points.has(p.id));
  plan.paths = plan.paths.filter((x) => !points.has(x.from) && !points.has(x.to));
  plan.cables = plan.cables.filter((c) => !cables.has(c.id));
  plan.xconnects = plan.xconnects.filter((x) => !points.has(x.at) && !gone(x.a) && !gone(x.b));
  for (const c of plan.cables) {
    for (const [n, it] of Object.entries(c.pins || {})) if (gone(it)) delete c.pins[n];
  }
  for (const p of plan.points) {
    for (const key of Object.keys(p.trays || {})) if (gone(key)) delete p.trays[key];
    for (const eq of p.equipment || []) if (eq.tail && cables.has(eq.tail)) delete eq.tail;
    if (p.ds && eqs.has(p.ds.splitterId)) {
      delete p.ds;
      p.dsManual = false;
    }
    if (p.tport && eqs.has(p.tport.eqId)) delete p.tport;
  }
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
      if (sp && d.handOnly && (d.pins || {})[f.out] !== f.item) continue;
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
    const g = { id: `cable:${c.id}:${where}`, title: `${c.name} · ${c.fibers}F ${where}`, items: [] };
    for (const f of colorCode(c.fibers)) {
      g.items.push({ key: `fiber:${c.id}:${f.number}`, label: `#${f.number}`, sub: fiberText(c, f.number).replace(/^#\d+ /, ""),
        color: f.fiberColor, tube: tubeCount(c.fibers) > 1 ? f.tubeColor : null, tubeNo: f.tube });
    }
    return g;
  };
  for (const eq of L.equipment || []) {
    if (eq.type === "splitter") {
      const outs = { id: `split:${eq.id}:out`, title: `${eqLabel(eq)} outputs`, items: [] };
      for (let n = 1; n <= splitterPorts(eq); n++) outs.items.push({ key: `split:${eq.id}:${n}`, label: `Out ${n}` });
      left.push(outs);
      right.push({ id: `split:${eq.id}:in`, title: `${eqLabel(eq)}`, items: [{ key: `split:${eq.id}:in`, label: "Input" }] });
    }
    if (hasCards(eq)) {
      const g = { id: `eq:${eq.id}`, title: eqLabel(eq), items: [] };
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

// --- Block order ---

// The order the editor shows its blocks in, per side, as Arrange saved
// it on the location. Only the display: splices and sheets don't see it.
// Blocks it doesn't know yet keep their own order after the known ones.
function orderedGroups(groups, ids) {
  if (!ids || !ids.length) return groups;
  const at = (g, i) => (ids.includes(g.id) ? ids.indexOf(g.id) : ids.length + i);
  return groups.map((g, i) => [at(g, i), g]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

// Each block moves to the average row of what it connects to on the
// other side (barycenter), a few sweeps back and forth; the try with
// the fewest crossing lines wins. Fibers keep their color order.
function arrangeBlocks(left, right, conns) {
  const rows = (groups) => {
    const pos = new Map();
    let n = 0;
    for (const g of groups) for (const x of g.items) pos.set(x.key, n++);
    return pos;
  };
  const crossings = (l, r) => {
    const pl = rows(l), pr = rows(r);
    const ends = conns.map((c) => [pl.get(c.from), pr.get(c.to)]).filter(([a, b]) => a != null && b != null);
    let n = 0;
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      if ((ends[i][0] - ends[j][0]) * (ends[i][1] - ends[j][1]) < 0) n++;
    }
    return n;
  };
  // Blocks with nothing connected keep their order, after the rest.
  const sweep = (groups, other, mine, theirs) => {
    const pos = rows(other);
    const bary = (g) => {
      const keys = new Set(g.items.map((x) => x.key));
      const ys = conns.filter((c) => keys.has(c[mine]) && pos.has(c[theirs])).map((c) => pos.get(c[theirs]));
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
    };
    return groups.map((g, i) => [bary(g), i, g]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  };
  let best = { l: left, r: right, n: crossings(left, right) };
  let l = left, r = right;
  for (let i = 0; i < 3; i++) {
    r = sweep(r, l, "to", "from");
    l = sweep(l, r, "from", "to");
    const n = crossings(l, r);
    if (n < best.n) best = { l, r, n };
  }
  const r2 = sweep(best.r, best.l, "to", "from");
  const n2 = crossings(best.l, r2);
  if (n2 < best.n) best = { l: best.l, r: r2, n: n2 };
  return best;
}

// --- Changing connections ---

// Before the first hand edit at a location, write down what the app
// picked so other cables don't shift under the user.
function freezeAt(model, locId) {
  const here = splittersAt(point(locId));
  for (const d of childCables(locId).filter((x) => !x.through)) {
    if (!d.picks) d.picks = toRanges(model.autoPairs(d));
    d.pins = d.pins || {};
    // Spliced by hand only: nothing the app placed counts as joined.
    if (d.handOnly) continue;
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
    // A home's drop joined to a splitter output puts the home on that port.
    const end = point(cableSpans(d).at(-1).to);
    const s = findEquipment(from.split(":")[1]);
    if (end && end.type === "nid" && s) putHomeOnPort(end, s, Number(fsub));
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
    delete d.handOnly;
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

// The one tray/slot map for a location, used by the splice editor, the
// list, the drawing, the printed checklist and Check plan: slots go to
// the location's real splices (not patches), all phases, before any
// filtering for display, so a splice has the same slot everywhere and an
// unspliced row has none. Null without a splice case or slots set by hand.
function spliceSlots(model, L) {
  if (!closureAt(L) && !Object.keys(L.trays || {}).length) return null;
  return traySlots(L, connectionsAt(model, L.id).filter((c) => c.kind !== "patch").map((c) => c.to));
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

// Tap or Enter/Space folds or opens a header; Ctrl or Shift-click
// selects what's in it instead. Its own buttons keep their clicks.
function foldToggle(elm, open, toggle, pick) {
  elm.tabIndex = 0;
  elm.setAttribute("role", "button");
  elm.setAttribute("aria-expanded", String(open));
  elm.addEventListener("pointerdown", (e) => e.stopPropagation());
  elm.addEventListener("click", (e) => {
    if (e.target.closest("button, input")) return;
    if (pick && (e.ctrlKey || e.metaKey || e.shiftKey)) pick(e);
    else toggle();
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
  const sel = new Set(); // selected connections, by their target key
  const anchor = { key: null }; // the last one selected, for Shift ranges
  let now = null; // this render's connections, for selecting
  let hidden = null; // side -> key -> tube header, for rows folded away
  let menus = null; // row or header -> its right-click menu
  const title = isCabinet(L) ? `Connections at ${L.name}` : closureAt(L) ? `Splice case at ${L.name}` : `Splices at ${L.name}`;
  openForm(title, (body, foot) => {
    const info = el("div", "cx-info");
    const tools = el("div", "cx-tools");
    const wrap = el("div", "cx-wrap");
    body.append(info, tools, wrap);
    const reopen = () => openConnections(locId);

    // Take connections apart. It asks first (Brian's one exception to
    // "no are-you-sure pop-ups"), then leaves an Undo note that brings it
    // all back (trays and slots too) and reopens the editor.
    function removeConns(list, where) {
      if (!list.length) return;
      const n = list.length;
      const one = n === 1 ? `${endpointLabel(list[0].from)} → ${endpointLabel(list[0].to)}` : "";
      const text = n === 1 ? `Took apart ${one}.` : `Took apart ${n} connections ${where}.`;
      confirmBox(n === 1 ? "Remove this connection?" : `Remove ${n} connections?`,
        `${n === 1 ? `${one} will be taken apart.` : `All ${n} connections ${where} will be taken apart.`} You can Undo it right after.`,
        n === 1 ? "Remove 1 connection" : `Remove ${n} connections`, () => {
          withUndo(text, () => disconnectAll(locId, list), reopen);
          for (const c of list) sel.delete(c.to);
          render();
        });
    }

    function fillGapsNow() {
      const n = fillGaps(locId);
      render();
      renderRoute();
      flash(n ? `Spliced ${n} fiber${n === 1 ? "" : "s"}.` : "Nothing left to fill.");
    }

    // Only the display order changes; Undo puts the old one back.
    function arrangeNow(left, right, conns) {
      const was = arrangeBlocks(left, right, conns);
      const ids = (gs) => gs.map((g) => g.id);
      const same = ids(was.l).join() === ids(left).join() && ids(was.r).join() === ids(right).join();
      if (same) {
        flash("Already as untangled as it gets.");
        return;
      }
      withUndo(`Arranged the blocks at ${L.name}: ${was.n} crossing line${was.n === 1 ? "" : "s"} left.`, () => {
        L.blockOrder = { L: ids(was.l), R: ids(was.r) };
      }, reopen);
      render();
    }

    function render() {
      const model = buildSpliceModel();
      const conns = connectionsAt(model, locId);
      const bySource = new Map(conns.map((c) => [c.from, c]));
      const byTarget = new Map(conns.map((c) => [c.to, c]));
      now = { bySource, byTarget };
      hidden = { L: new Map(), R: new Map() };
      menus = new WeakMap();
      for (const k of [...sel]) if (!byTarget.has(k)) sel.delete(k);
      const connOf = (side, key) => (side === "L" ? bySource : byTarget).get(key);
      const allSel = (list) => list.length > 0 && list.every((c) => sel.has(c.to));
      const groups = endpointGroups(locId);
      const order = L.blockOrder || {};
      const left = orderedGroups(groups.left, order.L);
      const right = orderedGroups(groups.right, order.R);
      const closure = closureAt(L);
      const slots = traySlots(L, conns.filter((c) => c.kind !== "patch").map((c) => c.to));

      info.innerHTML = "";
      const through = childCables(locId).filter((x) => x.through);
      const lines = [];
      if (closure) lines.push(`${eqLabel(closure)}: ${closure.trays} trays x ${closure.slots} splices.`);
      for (const t of through) lines.push(`${t.name} ${THROUGH_LABELS[t.through]} here (not spliced).`);
      lines.push("Drag from the left to the right to connect, or tap one end and then the other. Drag a folded tube onto a folded tube to splice it all at once. Tap a line or × to take it apart.");
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
      tools.append(btnEl("Fill gaps from free fibers", fillGapsNow, "btn ghost"), btnEl("Reset to automatic", () => {
        withUndo("Back to the app's own choices for the cables leaving here. Patches and F2 counts stayed.", () => resetConnections(locId));
        render();
      }, "btn ghost"));
      if (conns.length) {
        const arr = btnEl("Arrange", () => arrangeNow(left, right, conns), "btn ghost");
        arr.title = "Reorder the cables and splitters so the lines cross as little as possible. Splices stay as they are.";
        tools.append(arr);
      }
      if (!closure && !isCabinet(L)) tools.append(btnEl("Add a splice case", () => openEquipment(locId), "btn ghost"));
      if (conns.length) tools.append(btnEl(`Remove all ${conns.length}`, () => removeConns(conns, `at ${L.name}`), "btn ghost cx-danger"));
      // What's selected (Ctrl or Shift-click), and how to act on it.
      if (sel.size) tools.append(el("span", "cx-selcount", `${sel.size} selected · Delete or right-click to remove · Esc clears`));

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
          }, (e) => selectGroup(connsIn(g.items), e));
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
          if (allSel(groupConns)) head.classList.add("sel");
          head.dataset.side = side;
          head.dataset.cable = g.title;
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
          const foldCable = { icon: open ? "fold" : "unfold", label: open ? "Fold this cable up" : "Open this cable", run: () => {
            folds.cables.set(cableKey, !open);
            render();
          } };
          menus.set(head, () => ({ title: g.title, caption: "Cable", conns: groupConns, items: [
            ...groupItems(groupConns, `on ${g.title}`, "on this cable"),
            { ...foldCable, sep: groupConns.length > 0 },
            ...(open && tubes.size > 1 ? [{ icon: "fold", label: "Fold every tube", run: () => {
              for (const t of tubes.keys()) folds.tubes.set(tubeKey(t), true);
              render();
            } }, { icon: "unfold", label: "Open every tube", run: () => {
              for (const t of tubes.keys()) folds.tubes.set(tubeKey(t), false);
              render();
            } }] : []),
          ] }));

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
              const th = el("div", "cx-tube" + (folded ? " folded" : "") + (list.length ? " has" : "") + (allSel(list) ? " sel" : ""));
              th.title = folded ? "Show this tube's fibers" : "Fold this tube up";
              th.dataset.side = side;
              th.dataset.cable = g.title;
              th.dataset.tube = t;
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
              // A folded tube drags onto a folded tube across: the whole tube.
              if (folded) {
                th.tubeDrop = { side, items, label: `tube ${t} · ${item.tube.name} of ${g.title}` };
                th.addEventListener("pointerdown", (e) => startTubeDrag(e, th));
                th.addEventListener("click", (e) => {
                  if (tubeDragged) e.stopImmediatePropagation();
                  tubeDragged = false;
                });
              }
              foldToggle(th, !folded, () => {
                folds.tubes.set(tubeKey(t), !folded);
                render();
              }, (e) => selectGroup(list, e));
              const tubeMenu = () => [
                ...groupItems(list, `in tube ${t} of ${g.title}`, "in this tube"),
                { icon: folded ? "unfold" : "fold", label: folded ? "Open this tube" : "Fold this tube up", sep: list.length > 0, run: () => {
                  folds.tubes.set(tubeKey(t), !folded);
                  render();
                } },
              ];
              menus.set(th, () => ({ title: `Tube ${t} · ${item.tube.name}`, caption: g.title, conns: list, items: tubeMenu() }));
              box.append(th);
              // Lines to a folded tube end at its header.
              if (folded) for (const x of items) hidden[side].set(x.key, sw);
            }
            if (folded) continue;
            const row = endRow(item, side);
            // The tube header just above it, for the tube's items.
            const tubeAt = item.tube ? [...box.querySelectorAll(".cx-tube")].pop() : null;
            menus.set(row, () => fiberMenu(item, side, tubeAt && menus.get(tubeAt)));
            box.append(row);
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

    // The incoming side stays in view while the long right side scrolls.
    // Taller than the dialog, it scrolls on its own. Lines follow either
    // scroll.
    let shown = null;
    let queued = false;
    function stickLeft() {
      const colL = wrap.querySelector(".cx-left");
      const cs = getComputedStyle(formPanel);
      colL.style.top = "0px";
      colL.style.maxHeight = `${formPanel.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px`;
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

    const connAt = (side, key) => (side === "L" ? now.bySource : now.byTarget).get(key);

    // Ctrl-click adds or drops a row's connection, Shift-click every
    // connection from the last one to this one, down the same column.
    // (A plain click still starts or ends a connection.)
    function choose(d) {
      const conn = connAt(d.side, d.key);
      if (!conn) return;
      picked = null;
      const order = [...wrap.querySelectorAll(`.cx-${d.side === "L" ? "left" : "right"} .cx-end`)]
        .map((r) => connAt(d.side, r.dataset.key)).filter(Boolean).map((c) => c.to);
      // Ctrl-click and Shift-click both add to what's there.
      selectClick(sel, order, conn.to, { ctrlKey: true, shiftKey: d.shift }, anchor);
      render();
    }

    // Ctrl or Shift-click on a tube or cable header: all of its
    // connections, or none when they're all selected already.
    function selectGroup(list, e) {
      if (!list.length) return;
      const on = !list.every((c) => sel.has(c.to));
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) sel.clear();
      for (const c of list) on ? sel.add(c.to) : sel.delete(c.to);
      picked = null;
      render();
    }

    // --- Right-click menus ---
    // On a fiber, a tube or a cable: connect, remove, select, fold. With
    // several connections selected (and the click on one of them), the
    // menu is about all of them.
    const plural = (n) => `${n} connection${n === 1 ? "" : "s"}`;
    function groupItems(list, where, inWhat) {
      if (!list.length) return [];
      return [
        { icon: "select", label: `Select the ${plural(list.length)} ${inWhat}`, run: () => {
          for (const c of list) sel.add(c.to);
          picked = null;
          render();
        } },
        { icon: "remove", label: `Remove the ${plural(list.length)} ${inWhat}`, danger: true, run: () => removeConns(list, where) },
      ];
    }

    function fiberMenu(item, side, tubeMenu) {
      const conn = connAt(side, item.key);
      const other = picked && picked.side !== side ? picked : null;
      const items = [];
      if (other && !item.key.endsWith(":auto") && !other.key.endsWith(":auto")) {
        items.push({ icon: "xconnect", label: `Connect to ${endpointLabel(other.key)}`, run: () => {
          picked = null;
          join(other, { key: item.key, side });
        } });
      } else if (!item.key.endsWith(":auto")) {
        items.push({ icon: "xconnect", label: conn ? "Connect it somewhere else…" : "Connect from here…", run: () => {
          picked = { key: item.key, side };
          sel.clear();
          render();
          flash("Now click the fiber to connect it to.");
        } });
      }
      if (conn) items.push({ icon: "remove", label: "Remove this connection", danger: true, run: () => removeConns([conn]) });
      const tube = tubeMenu && tubeMenu();
      if (tube) items.push(...tube.items.map((x, i) => (i ? x : { ...x, sep: true })));
      return { title: endpointLabel(item.key), caption: tube ? tube.title : side === "L" ? "Coming in" : "Going out", items, conns: conn ? [conn] : [] };
    }

    wrap.addEventListener("contextmenu", (e) => {
      if (typingIn(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest(".cx-end, .cx-tube, .cx-head");
      const make = target && menus.get(target);
      let m = make ? make() : null;
      const list = m ? m.conns : [];
      // Right-click on one of several selected: act on all of them.
      if (sel.size > 1 && list.length && list.every((c) => sel.has(c.to))) {
        const all = shown.filter((c) => sel.has(c.to));
        return openPopup(`${plural(all.length)} selected`, [
          { icon: "remove", label: `Remove the ${plural(all.length)}`, danger: true, run: () => removeConns(all, "you selected") },
          { icon: "select", label: "Clear the selection", run: () => clearSel() },
        ], e, "Selection");
      }
      // A right-click on something else selects it instead, as usual.
      if (target && target.classList.contains("cx-end") && list.length && !sel.has(list[0].to)) {
        sel.clear();
        sel.add(list[0].to);
        render();
        m = menus.get(wrap.querySelector(`.cx-${target.dataset.side === "L" ? "left" : "right"} [data-key="${CSS.escape(target.dataset.key)}"]`))();
      }
      if (!m) {
        m = { title: L.name, caption: "Splice case", items: [
          ...(shown.length ? [{ icon: "select", label: `Select all ${plural(shown.length)}`, run: () => {
            for (const c of shown) sel.add(c.to);
            render();
          } }] : []),
          ...(sel.size ? [{ icon: "select", label: "Clear the selection", run: () => clearSel() }] : []),
          { icon: "xconnect", label: "Fill gaps from free fibers", run: fillGapsNow },
          ...(shown.length ? [{ icon: "remove", label: `Remove all ${plural(shown.length)}`, danger: true, sep: true, run: () => removeConns(shown, `at ${L.name}`) }] : []),
        ] };
      }
      openPopup(m.title, m.items, e, m.caption);
    });

    function clearSel() {
      if (!sel.size && !picked) return false;
      sel.clear();
      picked = null;
      render();
      return true;
    }

    // Esc clears the selection (a second Esc closes the editor); Delete
    // removes what's selected.
    function onKey(e) {
      if (!wrap.isConnected) return document.removeEventListener("keydown", onKey, true);
      if (formPanel.hidden || !menu.hidden || confirmBack || typingIn(e.target)) return;
      if (e.key === "Escape" && clearSel()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.size) {
        e.preventDefault();
        removeConns(shown.filter((c) => sel.has(c.to)), "you selected");
      }
    }
    document.addEventListener("keydown", onKey, true);

    // Drag from one end to the other, or tap one then the other.
    let drag = null;
    wrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const end = e.target.closest(".cx-end");
      // A click on empty space clears the selection.
      if (!end) {
        if (!e.target.closest(".cx-head, .cx-tube, button, input, .cx-line")) clearSel();
        return;
      }
      // Ctrl or Shift: clicking selects instead.
      const choose = e.ctrlKey || e.metaKey || e.shiftKey;
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
      // A plain click or drag is about this one row: the selection goes.
      sel.clear();
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
      else render();
    });

    // Drag a folded tube onto a folded tube on the other side to splice
    // the whole tube: fiber 1 to 1, 2 to 2, up to the smaller tube.
    // Fibers already spliced on either end are left alone. Open tubes
    // keep the fiber-by-fiber drag above.
    let tubeDragged = false;
    function startTubeDrag(e, th) {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest("button, input")) return;
      e.preventDefault();
      const src = th.tubeDrop;
      const x = e.clientX;
      const y = e.clientY;
      let moved = false;
      let over = null;
      const targets = [...wrap.querySelectorAll(`.cx-${src.side === "L" ? "right" : "left"} .cx-tube.folded`)].filter((x) => x.tubeDrop);
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - x, ev.clientY - y) <= 6) return;
        if (!moved) {
          moved = true;
          th.classList.add("cx-dragging");
          for (const t of targets) t.classList.add("cx-drop");
        }
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const t = hit && hit.closest(".cx-tube.cx-drop");
        if (t !== over) {
          if (over) over.classList.remove("on");
          over = t;
          if (over) over.classList.add("on");
        }
        const box = wrap.getBoundingClientRect();
        const svg = wrap.querySelector(".cx-lines");
        let temp = svg.querySelector(".cx-temp");
        if (!temp) {
          temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
          temp.setAttribute("class", "cx-temp");
          svg.append(temp);
        }
        const r = th.getBoundingClientRect();
        const x0 = (src.side === "L" ? r.right : r.left) - box.left;
        temp.setAttribute("d", `M${x0},${r.top + r.height / 2 - box.top} L${ev.clientX - box.left},${ev.clientY - box.top}`);
        const pr = formPanel.getBoundingClientRect();
        if (ev.clientY > pr.bottom - 40) formPanel.scrollTop += 12;
        if (ev.clientY < pr.top + 40) formPanel.scrollTop -= 12;
      };
      const up = () => {
        removeEventListener("pointermove", move, true);
        removeEventListener("pointerup", up, true);
        removeEventListener("pointercancel", up, true);
        if (!moved) return;
        tubeDragged = true;
        setTimeout(() => (tubeDragged = false), 0);
        th.classList.remove("cx-dragging");
        for (const t of targets) t.classList.remove("cx-drop", "on");
        const temp = wrap.querySelector(".cx-temp");
        if (temp) temp.remove();
        if (over) spliceTubes(src, over.tubeDrop);
      };
      addEventListener("pointermove", move, true);
      addEventListener("pointerup", up, true);
      addEventListener("pointercancel", up, true);
    }

    function spliceTubes(a, b) {
      const from = a.side === "L" ? a : b;
      const to = a.side === "L" ? b : a;
      const n = Math.min(from.items.length, to.items.length);
      const pairs = [];
      let skipped = 0;
      for (let i = 0; i < n; i++) {
        const f = from.items[i].key;
        const t = to.items[i].key;
        if (f.endsWith(":auto") || connAt("L", f) || connAt("R", t)) skipped++;
        else pairs.push([f, t]);
      }
      const skip = skipped ? ` ${skipped} skipped, already spliced.` : "";
      if (!pairs.length) return flash(`Nothing to splice: all ${n} fibers are already spliced.`);
      withUndo(`Spliced ${from.label} to ${to.label}: ${pairs.length} fiber${pairs.length === 1 ? "" : "s"}.${skip}`, () => {
        for (const [f, t] of pairs) connect(locId, f, t);
      }, reopen);
      sel.clear();
      picked = null;
      render();
    }

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
