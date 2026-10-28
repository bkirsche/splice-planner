// F2 and DS counts.
// A splitter gets an F2 count: the fiber on the cable arriving at its
// location that feeds it. Each home shows the F2 of the splitter that
// feeds it and a DS count: the splitter port it is on.
//
// The app fills both in by itself, in route order (autoCounts). Each
// value has a lock: locked means the app keeps it up to date; unlocking
// it (f2Manual on a splitter, dsManual on a home) keeps what the user
// picked. Bad counts are blocked as they are entered.

function splittersAt(p) {
  return (p.equipment || []).filter((e) => e.type === "splitter");
}

function splitterPorts(eq) {
  return parseInt(eq.ratio.split("x")[1], 10);
}

function countChip(text) {
  const chip = document.createElement("div");
  chip.className = "chip count";
  chip.textContent = text;
  return chip;
}

// Where an equipment item sits.
function equipmentLocation(eqId) {
  return plan.points.find((p) => (p.equipment || []).some((e) => e.id === eqId));
}

// Nearest location at or upstream of `locId` that has a splitter.
function feedingLocation(locId) {
  let id = locId;
  while (id) {
    const p = point(id);
    if (p && splittersAt(p).length) return p;
    const path = incomingPath(id);
    id = path ? path.from : null;
  }
  return null;
}

// The splitter feeding a home: the one its DS is on, else the first
// splitter at the nearest upstream location that has one. A splitter
// placed to be spliced by hand (handOnly) only takes homes put on it by
// hand; the app looks further up for one that feeds them by itself.
function homeSplitter(home) {
  const path = incomingPath(home.id);
  let loc = path && feedingLocation(path.from);
  while (loc) {
    const list = splittersAt(loc);
    const hit = (home.ds && list.find((s) => s.id === home.ds.splitterId)) || list.find((s) => !s.handOnly);
    if (hit) return hit;
    const up = incomingPath(loc.id);
    loc = up && feedingLocation(up.from);
  }
  return null;
}

function homeF2(home) {
  const s = homeSplitter(home);
  return s && s.f2 ? s : null;
}

// The fiber that really feeds a splitter: { cable, n, traced }. A
// terminal at its own spot is fed by a terminal tail spliced in the
// location before it, so its F2 is the fiber the tail is spliced to
// there (F09610 #3), not the tail's own fiber 1. Tails are followed back
// through their fiber picks, or the app's own picks when there are none.
function f2Source(eq) {
  if (!eq.f2) return null;
  const loc = equipmentLocation(eq.id);
  const arriving = loc && feederAt(loc.id, eq);
  if (!arriving) return null;
  let cable = cableStart(arriving);
  let n = eq.f2;
  const seen = new Set();
  while (cableKind(cable) !== "cable" && !seen.has(cable.id)) {
    seen.add(cable.id);
    const up = incomingCable(cable.from);
    if (!up) break;
    const pairs = cable.picks ? expandPicks(cable.picks) : (routeModel || buildSpliceModel()).autoPairs(cable);
    const pair = pairs.find((x) => x.out === n);
    if (!pair) break;
    cable = cableStart(up);
    n = pair.in;
  }
  return { cable, n, traced: seen.size > 0 && cable !== cableStart(arriving) };
}

// A splitter's F2 as it reads on cards and sheets: "F2 61", or
// "F2 F09610 #3" for a terminal fed by a tail.
function f2Label(eq) {
  if (!eq.f2) return "F2 not set";
  const src = f2Source(eq);
  return src && src.traced ? `${countScheme().f2Prefix}${src.cable.name} #${padNum(src.n, countScheme().pad)}` : f2Text(eq.f2);
}

// The same, under an "F2" table heading.
function f2CellFor(eq) {
  if (!eq.f2) return "";
  const src = f2Source(eq);
  return src && src.traced ? `${src.cable.name} #${padNum(src.n, countScheme().pad)}` : f2Cell(eq.f2);
}

// The F2 fiber's tube and color, when the location has a cable arriving.
function f2Colors(eq) {
  const src = f2Source(eq);
  if (!src || src.n > src.cable.fibers) return "";
  const f = colorCode(src.cable.fibers)[src.n - 1];
  return `${f.tubeColor.name} tube, ${f.fiberColor.name} fiber, on ${src.cable.name}`;
}

// Ports on a splitter already taken: port -> home.
function usedPorts(eq, exceptHomeId) {
  const used = new Map();
  for (const h of plan.points) {
    if (h.type === "nid" && h.id !== exceptHomeId && h.ds && h.ds.splitterId === eq.id) used.set(h.ds.port, h);
  }
  return used;
}

// A cascade splitter (like the 1x8s in an LCP) feeds other splitters,
// not homes: its outputs are patched or spliced onward and no home is on
// its ports.
function isCascade(eq) {
  const out = `split:${eq.id}:`;
  const onward = plan.xconnects.some((x) => [x.a, x.b].some((e) => e && e.startsWith(out) && e !== `${out}in`)) ||
    plan.cables.some((c) => Object.values(c.pins || {}).some((it) => it.startsWith(`port:${eq.id}:`)));
  return onward && !plan.points.some((h) => h.type === "nid" && h.ds && h.ds.splitterId === eq.id);
}

function nextFreePort(eq, exceptHomeId) {
  const used = usedPorts(eq, exceptHomeId);
  for (let n = 1; n <= splitterPorts(eq); n++) if (!used.has(n)) return n;
  return null;
}

// --- F2 for a splitter ---

// Splitters fed from the same physical cable share its fiber numbers,
// and can't take a fiber that's picked for another cable.
function f2Problem(loc, eq, n) {
  if (!Number.isInteger(n) || n < 1) return "Enter a fiber number.";
  const c = feederAt(loc.id, eq);
  if (!c) {
    const clash = splittersAt(loc).find((s) => s.id !== eq.id && s.f2 === n);
    return clash ? `F2 ${n} already feeds ${clash.name}.` : "";
  }
  if (n > c.fibers) return `${c.name} only has ${c.fibers} fibers.`;
  const used = fixedInUse(cableStart(c).id, eq.id).get(n);
  return used ? `${c.name} #${n} already ${used}.` : "";
}

function nextFreeF2(loc, eq, from = 1) {
  const c = feederAt(loc.id, eq);
  const max = c ? c.fibers : 999;
  for (let n = from; n <= max; n++) if (!f2Problem(loc, eq, n)) return n;
  return null;
}


// --- Count scheme ---
// Project-wide: where automatic F2 counts start, how F2 and DS read on
// cards and sheets, and whether DS is the splitter port or a running
// count across the job.

const COUNT_DEFAULTS = { f2Start: 1, f2Prefix: "F2 ", dsPrefix: "DS ", dsMode: "port", dsStart: 1, pad: 0, autoDs: true };

function countScheme() {
  return { ...COUNT_DEFAULTS, ...((plan && plan.counts) || {}) };
}

function padNum(n, width) {
  return width ? String(n).padStart(width, "0") : String(n);
}

// Every location, start first, each branch followed to its end.
function routeOrder() {
  const out = [];
  const walk = (id) => {
    const p = point(id);
    if (!p) return;
    out.push(p);
    for (const x of childPaths(id)) walk(x.to);
  };
  walk(plan.points[0].id);
  return out;
}

function f2Text(n) {
  const s = countScheme();
  return `${s.f2Prefix}${padNum(n, s.pad)}`;
}

// The DS number a home reads: its port, or a running count where each
// splitter (in route order) follows on from the one before. Cascade
// splitters feed no homes, so they don't take up numbers.
function dsNumber(home) {
  if (!home.ds) return null;
  const s = countScheme();
  if (s.dsMode !== "running") return home.ds.port;
  let off = 0;
  for (const p of routeOrder()) {
    for (const sp of splittersAt(p)) {
      if (sp.id === home.ds.splitterId) return s.dsStart - 1 + off + home.ds.port;
      if (!isCascade(sp)) off += splitterPorts(sp);
    }
  }
  return home.ds.port;
}

function dsText(home) {
  const s = countScheme();
  return `${s.dsPrefix}${padNum(dsNumber(home), s.pad)}`;
}

// For table cells under an "F2" or "DS" heading: just the number,
// unless the scheme names it differently.
function f2Cell(n) {
  const s = countScheme();
  return s.f2Prefix.trim().toUpperCase() === "F2" ? padNum(n, s.pad) : f2Text(n);
}

function dsCell(home) {
  const s = countScheme();
  return s.dsPrefix.trim().toUpperCase() === "DS" ? padNum(dsNumber(home), s.pad) : dsText(home);
}

// A home's DS, or "" when it has none (or its splitter is gone).
function homeDs(h) {
  return h.ds && homeSplitter(h) && homeSplitter(h).id === h.ds.splitterId ? dsText(h) : "";
}

// --- Automatic counts ---
// Runs on every save. Locked (automatic) values are worked out again in
// route order around the ones set by hand.
function autoCounts() {
  if (!plan || !plan.points.length) return;
  const s = countScheme();
  const order = routeOrder();
  for (const p of order) for (const sp of splittersAt(p)) if (!sp.f2Manual) sp.f2 = null;
  for (const p of order) {
    for (const sp of splittersAt(p)) if (!sp.f2Manual) sp.f2 = nextFreeF2(p, sp, Math.max(1, s.f2Start || 1));
  }
  const homes = order.filter((h) => h.type === "nid");
  for (const h of homes) if (!h.dsManual) delete h.ds;
  if (!s.autoDs) return;
  for (const h of homes) {
    if (h.dsManual) continue;
    const path = incomingPath(h.id);
    const sp0 = homeSplitter(h);
    const loc = sp0 && equipmentLocation(sp0.id);
    if (!loc) continue;
    for (const sp of splittersAt(loc).filter((x) => !x.handOnly)) {
      const port = nextFreePort(sp, h.id);
      if (port !== null) {
        h.ds = { splitterId: sp.id, port };
        break;
      }
    }
  }
}

// Plans from before automatic counts keep every count they had, set by hand.
function migrateCounts(p) {
  if (p.counts) return;
  p.counts = {};
  for (const loc of p.points) {
    for (const e of loc.equipment || []) if (e.type === "splitter" && e.f2) e.f2Manual = true;
    if (loc.ds) loc.dsManual = true;
  }
}

// Put a home on a splitter port by hand. A home already there swaps to
// this one's old port if it was set by hand too, or goes back to the
// next free port if it was automatic.
function putHomeOnPort(home, s, port) {
  const other = usedPorts(s, home.id).get(port);
  const old = home.ds ? { ...home.ds } : null;
  home.ds = { splitterId: s.id, port };
  home.dsManual = true;
  if (other) {
    if (other.dsManual && old && old.splitterId === s.id) other.ds = old;
    else {
      delete other.ds;
      other.dsManual = false;
    }
  }
}

// --- Terminal ports ---
// A home's drop can plug into a port on a terminal at the location it
// hangs off: home.tport = { eqId, portId }.

function terminalsAt(p) {
  return (p.equipment || []).filter((e) => e.type === "terminal" && hasCards(e));
}

function terminalPorts(eq) {
  const out = [];
  for (const card of eq.cards) for (const port of card.ports) out.push({ id: port.id, name: eq.cards.length > 1 ? `${card.name} ${port.name}` : port.name });
  return out;
}

function homeTerminalPort(home) {
  if (!home.tport) return null;
  const eq = findEquipment(home.tport.eqId);
  const port = eq && hasCards(eq) && terminalPorts(eq).find((x) => x.id === home.tport.portId);
  return port ? { eq, port, text: `${eqLabel(eq)} port ${port.name}` } : null;
}

function putHomeOnTerminal(home, eq, portId) {
  const other = plan.points.find((h) => h !== home && h.tport && h.tport.eqId === eq.id && h.tport.portId === portId);
  if (other) {
    if (home.tport) other.tport = { ...home.tport };
    else delete other.tport;
  }
  home.tport = { eqId: eq.id, portId };
}

// --- Editing one home's counts ---
// The lock covers F2 and DS together: locked, the app picks the
// splitter and port; unlocked, two dropdowns.

function homeLocation(home) {
  const path = incomingPath(home.id);
  return path ? point(path.from) : null;
}

function homeCountEditor(home, changed) {
  const path = incomingPath(home.id);
  const loc = path && feedingLocation(path.from);
  const list = loc ? splittersAt(loc) : [];
  const wrap = el("span", "count-editor");
  if (!list.length) {
    wrap.append(el("span", "muted", "No splitter feeds this home"));
    return wrap;
  }
  const locked = !home.dsManual;
  const s = homeSplitter(home);
  const view = el("span", "auto-val mono", [f2Label(s), homeDs(home) || "no DS"].join(" · "));
  const editor = el("span", "count-selects");
  const sSel = selectEl(list.map((x) => {
    const full = nextFreePort(x, home.id) === null;
    return { value: x.id, label: `${f2Label(x)} · ${eqLabel(x)}${full ? " (full)" : ""}`, disabled: full && x.id !== s.id };
  }), s.id);
  sSel.title = "Splitter (F2)";
  const ports = [{ value: "", label: "No DS" }];
  const used = usedPorts(s, home.id);
  for (let n = 1; n <= splitterPorts(s); n++) {
    const other = used.get(n);
    ports.push({ value: n, label: `DS port ${n}${other ? ` (swap with ${other.name})` : ""}` });
  }
  const pSel = selectEl(ports, home.ds && home.ds.splitterId === s.id ? home.ds.port : "");
  pSel.title = "DS port";
  sSel.addEventListener("change", () => {
    const next = list.find((x) => x.id === sSel.value);
    const port = nextFreePort(next, home.id);
    if (port !== null) putHomeOnPort(home, next, port);
    changed();
  });
  pSel.addEventListener("change", () => {
    if (pSel.value === "") {
      delete home.ds;
      home.dsManual = true;
    } else putHomeOnPort(home, s, Number(pSel.value));
    changed();
  });
  if (list.length > 1) editor.append(sSel);
  else editor.append(el("span", "mono fixed-val", f2Label(s)));
  editor.append(pSel);
  wrap.append(lockField(locked, view, editor, (lock) => {
    if (lock) {
      home.dsManual = false;
      delete home.ds;
    } else home.dsManual = true;
    changed();
  }, "F2 and DS"));
  return wrap;
}

function terminalSelect(home, terms, changed) {
  const opts = [{ value: "", label: "No terminal port" }];
  for (const eq of terms) {
    for (const port of terminalPorts(eq)) {
      const other = plan.points.find((h) => h !== home && h.tport && h.tport.eqId === eq.id && h.tport.portId === port.id);
      opts.push({ value: `${eq.id}|${port.id}`, label: `${eqLabel(eq)} port ${port.name}${other ? ` (swap with ${other.name})` : ""}`, group: terms.length > 1 ? eqLabel(eq) : undefined });
    }
  }
  const sel = selectEl(opts, home.tport && homeTerminalPort(home) ? `${home.tport.eqId}|${home.tport.portId}` : "");
  sel.title = "Terminal port";
  sel.addEventListener("change", () => {
    if (!sel.value) delete home.tport;
    else {
      const [eqId, portId] = sel.value.split("|");
      putHomeOnTerminal(home, findEquipment(eqId), portId);
    }
    changed();
  });
  return sel;
}

// --- One home ---

function openCounts(id) {
  const home = point(id);
  openForm(`Counts for ${home.name}`, (body, foot) => {
    const render = () => {
      body.innerHTML = "";
      const path = incomingPath(home.id);
      const loc = path && feedingLocation(path.from);
      const s = homeSplitter(home);
      const box = el("div", "f2-info");
      if (!s) {
        box.textContent = "No splitter feeds this home yet. Add a splitter upstream to give it F2 and DS counts.";
        body.append(box);
        return;
      }
      box.append(el("div", "f2-big", [f2Label(s), homeDs(home)].filter(Boolean).join(" · ")),
        el("div", "", `From ${eqLabel(s)} at ${loc.name}` + (s.f2 && f2Colors(s) ? ` · ${f2Colors(s)}` : "")));
      body.append(box, el("p", "hint", "Locked counts are filled in by the app. Tap the lock to pick them yourself."));
      const changed = () => {
        savePlan();
        renderRoute();
        render();
      };
      body.append(fieldEl("F2 and DS", homeCountEditor(home, changed)));
      const at = homeLocation(home);
      const terms = at ? terminalsAt(at) : [];
      if (terms.length) body.append(fieldEl("Terminal port", terminalSelect(home, terms, changed)));
    };
    render();
    const at = homeLocation(home);
    if (at && homesForCounts(at).length > 1) {
      foot.append(btnEl(`All homes at ${at.name}`, () => openHomeCounts(at.id), "btn ghost push-left"));
    }
    foot.append(btnEl("Done", finish, "btn big"));
  });
  selectedId = id;
  renderRoute();
}

// --- Many homes at once ---

// Homes fed by the splitters at a location, in route order.
function homesFedBy(p) {
  const order = [];
  const walk = (id) => {
    for (const path of plan.paths.filter((x) => x.from === id)) {
      const m = point(path.to);
      if (!m) continue;
      if (m.type === "nid") {
        if (feedingLocation(id) === p) order.push(m);
      } else if (!splittersAt(m).length) walk(m.id);
    }
  };
  walk(p.id);
  return order;
}

// The homes a location's count dialog covers: the ones its splitters
// feed, plus the ones that hang off it directly (a pedestal or terminal
// fed from a splitter further up).
function homesForCounts(p) {
  const list = splittersAt(p).length ? homesFedBy(p) : [];
  for (const x of childPaths(p.id)) {
    const m = point(x.to);
    if (m && m.type === "nid" && !list.includes(m)) list.push(m);
  }
  return list;
}

function feedsHomes(p) {
  return homesForCounts(p).length > 0;
}

// Splitters and terminals the homes at a location can be put on.
function countDevices(p) {
  const loc = splittersAt(p).length ? p : feedingLocation(p.id);
  return [...(loc ? splittersAt(loc) : []), ...terminalsAt(p)];
}

// Homes on the left, the ports of a splitter or terminal on the right:
// drag a home onto a port (or tap the home, then the port). Selected homes
// can also be filled in order or put back to automatic.
function openHomeCounts(locId, eqId) {
  const L = point(locId);
  const ticked = new Set(); // the selected homes
  const tickAt = { key: null }; // the last one selected, for Shift ranges
  let deviceId = eqId || null;
  let picked = null; // a home waiting for a port
  openForm(`Home counts at ${L.name}`, (body, foot) => {
    const homes = () => homesForCounts(L);
    const msg = el("p", "hc-msg");
    const top = el("div", "hc-top");
    const wrap = el("div", "hc-wrap");
    const tools = el("div", "batch-tools");
    body.append(el("p", "hint", "F2 and DS fill in by themselves. Unlock a home to pick its counts, or drag a home onto a port."),
      top, wrap, tools, msg);

    const say = (text, bad) => {
      msg.textContent = text;
      msg.className = "hc-msg" + (bad ? " error" : "");
    };
    const changed = () => {
      savePlan();
      renderRoute();
      render();
    };

    function render() {
      const devices = countDevices(L);
      if (!devices.find((d) => d.id === deviceId)) deviceId = devices.length ? devices[0].id : null;
      const device = devices.find((d) => d.id === deviceId);
      top.innerHTML = "";
      if (devices.length) {
        const dSel = selectEl(devices.map((d) => ({ value: d.id, label: d.type === "splitter" ? `${eqLabel(d)}${d.f2 ? ` · ${f2Label(d)}` : ""}` : `${eqLabel(d)} (terminal)` })), deviceId);
        dSel.addEventListener("change", () => {
          deviceId = dSel.value;
          render();
        });
        top.append(fieldEl("Ports on", dSel));
      }
      top.append(btnEl("Count scheme…", () => openCountScheme(() => openHomeCounts(locId)), "btn ghost"));

      // Homes
      wrap.innerHTML = "";
      const list = el("div", "hc-homes batch-list");
      const head = el("div", "hc-row head");
      // Homes are selected the classic way: click a home's number,
      // Ctrl-click to add or drop one, Shift-click for a run.
      const order = homes().map((h) => h.id);
      const every = order.length > 0 && order.every((id) => ticked.has(id));
      const all = btnEl(every ? "None" : "All", () => {
        for (const id of order) every ? ticked.delete(id) : ticked.add(id);
        render();
      }, "fe-rowsel all");
      all.title = every ? "Clear the selection" : "Select every home";
      head.append(all, el("span", "", "Home"), el("span", "", "F2 · DS"));
      list.append(head);
      const terms = terminalsAt(L);
      homes().forEach((h, i) => {
        const row = el("div", "hc-row" + (ticked.has(h.id) ? " on" : "") + (picked === h.id ? " picked" : ""));
        const box = btnEl(String(i + 1), (e) => {
          selectClick(ticked, order, h.id, e, tickAt);
          render();
        }, "fe-rowsel");
        box.title = "Select this home (Ctrl-click adds, Shift-click selects a range)";
        box.setAttribute("aria-pressed", String(ticked.has(h.id)));
        // Ctrl or Shift-click anywhere on the row selects too.
        row.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || !(e.ctrlKey || e.metaKey || e.shiftKey) || e.target.closest(".fe-rowsel")) return;
          e.preventDefault();
          e.stopPropagation();
          selectClick(ticked, order, h.id, e, tickAt);
          render();
        }, true);
        row.addEventListener("contextmenu", (e) => {
          if (typingIn(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          if (!ticked.has(h.id)) {
            selectClick(ticked, order, h.id, {}, tickAt);
            render();
          }
          openPopup(ticked.size > 1 ? `${ticked.size} selected` : h.name, [
            { icon: "move", label: "Put on a port…", run: () => pickHome(h.id) },
            { icon: "counts", label: "Counts back to automatic", run: backToAutomatic },
            { icon: "remove", label: "Clear DS count", run: () => clearDs() },
            { icon: "select", label: "Select all homes", run: () => {
              for (const home of homes()) ticked.add(home.id);
              render();
            } },
            { icon: "select", label: "Clear the selection", run: () => {
              ticked.clear();
              render();
            } },
          ], e);
        });
        const handle = el("span", "hc-handle");
        handle.dataset.home = h.id;
        handle.title = "Drag onto a port, or tap and then tap a port";
        handle.append(el("span", "grip", "⋮⋮"), el("span", "hc-name", h.name));
        if (h.lot && hasAddress(h)) handle.append(el("span", "hc-lot mono", `Lot ${h.lot}`));
        const tp = homeTerminalPort(h);
        if (tp) handle.append(el("span", "hc-lot", tp.text));
        const counts = el("span", "hc-counts");
        counts.append(homeCountEditor(h, changed));
        if (terms.length) counts.append(terminalSelect(h, terms, changed));
        row.append(box, handle, counts);
        list.append(row);
      });
      if (!homes().length) list.append(el("p", "hint", "No homes here yet."));

      // Ports
      const portsBox = el("div", "hc-ports");
      if (device) {
        const grid = el("div", "port-tiles");
        if (device.type === "splitter") {
          const used = usedPorts(device);
          for (let n = 1; n <= splitterPorts(device); n++) {
            const h = used.get(n);
            grid.append(portTile(`${n}`, h, { port: n }));
          }
          portsBox.append(el("div", "hc-ports-head", `${device.name} · ${used.size} of ${splitterPorts(device)} ports used`));
        } else {
          for (const port of terminalPorts(device)) {
            const h = plan.points.find((x) => x.tport && x.tport.eqId === device.id && x.tport.portId === port.id);
            grid.append(portTile(port.name, h, { portId: port.id }));
          }
          portsBox.append(el("div", "hc-ports-head", `${device.name} · terminal ports`));
        }
        portsBox.append(grid);
      } else {
        portsBox.append(el("p", "hint", "Add a splitter (or a terminal here) to put homes on ports."));
      }
      wrap.append(list, portsBox);

      // Tools for the selected homes
      tools.innerHTML = "";
      const start = inputEl("number", 1, { min: 1 });
      start.className = "small-num";
      const startRow = el("label", "inline-field");
      startRow.append(el("span", "", "From port"), start);
      if (device) tools.append(startRow, btnEl("Fill DS in order", () => fill(device, Number(start.value)), "btn"));
      tools.append(btnEl("Back to automatic", backToAutomatic, "btn ghost"),
        btnEl("No DS", () => clearDs(), "btn ghost danger"));
    }

    function backToAutomatic() {
      const chosen = chosenHomes();
      withUndo(`${chosen.length} home${chosen.length === 1 ? "" : "s"} back to automatic counts.`, () => {
        for (const h of chosen) {
          h.dsManual = false;
          delete h.ds;
        }
      });
      render();
    }

    function clearDs(chosen = chosenHomes()) {
      withUndo(`Cleared the DS count on ${chosen.length} home${chosen.length === 1 ? "" : "s"}.`, () => {
        for (const h of chosen) {
          delete h.ds;
          h.dsManual = true;
        }
      });
      render();
    }

    function pickHome(id, moving = false) {
      picked = id;
      say(picked ? (moving ? `Moving ${point(picked).name}: tap the port to put it on.` : `Tap a port for ${point(picked).name}.`) : "");
      render();
    }

    // The selected homes, or every home when none are selected.
    function chosenHomes() {
      const chosen = homes().filter((h) => ticked.has(h.id));
      return chosen.length ? chosen : homes();
    }

    function portTile(label, home, where) {
      const tile = el("button", "port-tile" + (home ? " taken" : "") + (home && home.id === picked ? " picked" : ""));
      tile.type = "button";
      tile.dataset.port = where.port || "";
      tile.dataset.portId = where.portId || "";
      tile.append(el("span", "pt-num mono", label), el("span", "pt-home", home ? home.name : "free"));
      tile.addEventListener("click", () => {
        if (picked) {
          dropOn(picked, tile);
          return;
        }
        if (home) pickHome(home.id, true);
      });
      tile.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const items = [];
        if (picked) {
          const homeId = picked;
          items.push({ icon: "move", label: `Put ${point(homeId).name} here`, run: () => dropOn(homeId, tile) });
        }
        if (home) items.push({ icon: "remove", label: `Take ${home.name} off this port`, run: () => takeOffPort(home) });
        if (!items.length) return closeMenu();
        openPopup(`Port ${label}`, items, e);
      });
      return tile;
    }

    function takeOffPort(home) {
      const device = findEquipment(deviceId);
      if (picked === home.id) picked = null;
      if (device.type === "splitter") return clearDs([home]);
      withUndo(`Took ${home.name} off ${device.name}.`, () => {
        delete home.tport;
      });
      render();
    }

    function dropOn(homeId, tile) {
      const h = point(homeId);
      const device = findEquipment(deviceId);
      picked = null;
      if (!h || !device) return render();
      if (device.type === "splitter") {
        const path = incomingPath(h.id);
        const loc = path && feedingLocation(path.from);
        if (!loc || !splittersAt(loc).includes(device)) {
          say(`${device.name} doesn't feed ${h.name}.`, true);
          return render();
        }
        putHomeOnPort(h, device, Number(tile.dataset.port));
        say(`${h.name} is on ${device.name} port ${tile.dataset.port}.`);
      } else {
        putHomeOnTerminal(h, device, tile.dataset.portId);
        say(`${h.name} is on ${device.name} port ${tile.querySelector(".pt-num").textContent}.`);
      }
      changed();
    }

    function fill(device, from) {
      const chosen = chosenHomes();
      const none = !homes().some((h) => ticked.has(h.id));
      if (!chosen.length) return say("No homes here to fill.", true);
      if (device.type === "splitter") {
        const max = splitterPorts(device);
        let n = from;
        if (!Number.isInteger(n) || n < 1 || n > max) return say(`${device.name} has ports 1 to ${max}.`, true);
        const ids = new Set(chosen.map((h) => h.id));
        const taken = new Set([...usedPorts(device)].filter(([, h]) => !ids.has(h.id) && h.dsManual).map(([p]) => p));
        const out = [];
        for (const h of chosen) {
          while (n <= max && taken.has(n)) n++;
          if (n > max) return say(`${device.name} runs out of ports after ${out.length} home${out.length === 1 ? "" : "s"}. Start lower, select fewer homes, or pick another splitter.`, true);
          out.push([h, n++]);
        }
        withUndo(`Filled DS on ${out.length} home${out.length === 1 ? "" : "s"} from port ${from}.`, () => {
          for (const [h] of out) {
            delete h.ds;
            h.dsManual = true;
          }
          for (const [h, port] of out) h.ds = { splitterId: device.id, port };
        });
      } else {
        const ports = terminalPorts(device);
        const i0 = Math.max(0, from - 1);
        if (chosen.length > ports.length - i0) return say(`${device.name} has ${ports.length} ports: not enough from port ${from}.`, true);
        withUndo(`Put ${chosen.length} home${chosen.length === 1 ? "" : "s"} on ${device.name} in order.`, () => {
          chosen.forEach((h, i) => putHomeOnTerminal(h, device, ports[i0 + i].id));
        });
      }
      say((none ? "No homes were selected, so every home here was filled. " : "") + "Done. Those homes are now set by hand (unlocked).");
      render();
    }

    // Drag a home's handle onto a port tile.
    let drag = null;
    wrap.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".hc-handle");
      if (e.button !== 0 || !handle) return;
      e.preventDefault();
      drag = { home: handle.dataset.home, x: e.clientX, y: e.clientY, moved: false, ghost: null };
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.ghost = el("div", "drag-ghost", point(drag.home).name);
        document.body.append(drag.ghost);
      }
      drag.ghost.style.left = e.clientX + 12 + "px";
      drag.ghost.style.top = e.clientY + 12 + "px";
      for (const t of wrap.querySelectorAll(".port-tile.over")) t.classList.remove("over");
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const tile = under && under.closest(".port-tile");
      if (tile) tile.classList.add("over");
      const pr = formPanel.getBoundingClientRect();
      if (e.clientY > pr.bottom - 40) formPanel.scrollTop += 12;
      if (e.clientY < pr.top + 40) formPanel.scrollTop -= 12;
    });
    wrap.addEventListener("pointerup", (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.ghost) d.ghost.remove();
      if (!d.moved) {
        return pickHome(picked === d.home ? null : d.home);
      }
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const tile = under && under.closest(".port-tile");
      if (tile) dropOn(d.home, tile);
      else render();
    });
    wrap.addEventListener("pointercancel", () => {
      if (drag && drag.ghost) drag.ghost.remove();
      drag = null;
    });

    render();
    foot.append(btnEl("Done", finish, "btn big"));
  }, true);
  selectedId = locId;
  renderRoute();
}

// --- Count scheme dialog ---

function openCountScheme(back) {
  openForm("Count scheme for the whole job", (body, foot) => {
    const s = countScheme();
    const f2Start = inputEl("number", s.f2Start, { min: 1 });
    const f2Prefix = inputEl("text", s.f2Prefix);
    const dsPrefix = inputEl("text", s.dsPrefix);
    const pad = selectEl([{ value: 0, label: "No (5)" }, { value: 2, label: "2 digits (05)" }, { value: 3, label: "3 digits (005)" }], s.pad);
    const dsMode = selectEl([{ value: "port", label: "The splitter port (1 to 32 on each splitter)" },
      { value: "running", label: "A running count across the job (splitter 2 carries on from splitter 1)" }], s.dsMode);
    const dsStart = inputEl("number", s.dsStart, { min: 1 });
    const autoDs = inputEl("checkbox");
    autoDs.checked = s.autoDs;
    const grid = el("div", "form-grid");
    grid.append(fieldEl("F2 label", f2Prefix, "Shown before the number, e.g. F2 or FDH1-"),
      fieldEl("Automatic F2 starts at fiber", f2Start),
      fieldEl("DS label", dsPrefix), fieldEl("Leading zeros", pad));
    const dsRow = fieldEl("DS count is", dsMode);
    const startRow = fieldEl("Running DS count starts at", dsStart);
    const auto = el("label", "check-row");
    auto.append(autoDs, el("span", "", "Give every home a DS count automatically"));
    const sample = el("p", "hint");
    body.append(grid, dsRow, startRow, auto, sample);
    const read = () => ({
      f2Start: Math.max(1, Number(f2Start.value) || 1), f2Prefix: f2Prefix.value, dsPrefix: dsPrefix.value,
      pad: Number(pad.value), dsMode: dsMode.value, dsStart: Math.max(1, Number(dsStart.value) || 1), autoDs: autoDs.checked,
    });
    const update = () => {
      const n = read();
      startRow.hidden = n.dsMode !== "running";
      sample.textContent = `Reads like: ${n.f2Prefix}${padNum(n.f2Start, n.pad)} · ${n.dsPrefix}${padNum(n.dsMode === "running" ? n.dsStart : 1, n.pad)}`;
    };
    [f2Start, f2Prefix, dsPrefix, pad, dsMode, dsStart, autoDs].forEach((x) => x.addEventListener("input", update));
    update();
    formButtons(foot, () => {
      const next = read();
      const before = JSON.stringify(plan);
      plan.counts = next;
      if (back) {
        savePlan();
        back();
      } else finish();
      offerUndo("Count scheme saved. Automatic counts were worked out again.", before);
    });
  });
}
