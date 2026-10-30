// Fiber trace: follow a home's fiber back to the start, splice by
// splice, so anyone can check the path is right (on top of Check plan).
// Each hop is a cable fiber (with its tube and color), the splice that
// feeds it and any splitter on the way. A break says where it stops.

// "Blue tube, Slate" (no tube on a one-tube cable).
function traceColors(c, n) {
  const f = colorCode(c.fibers)[n - 1];
  return tubeCount(c.fibers) > 1 ? `${f.tubeColor.name} tube, ${f.fiberColor.name}` : f.fiberColor.name;
}

// --- Walking a strand ---
// A strand is an endpoint at a location (connect.js keys: a cable fiber,
// a splitter input or output, a port). Its own side says which way it
// faces: "in" for what arrives (the editor's left column), "out" for
// what leaves (the right). The connections at each location (splices,
// splitter legs, patches) say what feeds what; a splitter feeds all its
// outputs, a cable carries a fiber to its far end, and a panel or
// terminal port passes light through. The start of the route, or an OLT
// port, is where light comes from.
//
// up() follows a strand back to the start; down() follows it out to
// every home or port it reaches (fanning out through splitters). Every
// hop is { kind, text, colors, at, loc, phase }. Where a walk stops
// short it says so, with stop: { locId, key, side } to take the user
// there and, when it's safe, fix: { text, run } to splice it.
function strandWalker(model) {
  const start = plan.points[0] && plan.points[0].id;
  const connCache = new Map();
  const slotCache = new Map();
  const walked = []; // { locId, c } every connection on the way, to light up
  const conns = (locId) => {
    if (!connCache.has(locId)) connCache.set(locId, connectionsAt(model, locId));
    return connCache.get(locId);
  };
  const slotText = (L, key) => {
    if (!slotCache.has(L.id)) slotCache.set(L.id, spliceSlots(model, L) || new Map());
    const ts = slotCache.get(L.id).get(key);
    return ts ? `tray ${ts.tray}, slot ${ts.slot}` : "";
  };
  const phaseText = (i) => (!hasPhases() ? "" : /^phase/i.test(phaseName(i)) ? phaseName(i) : `Phase ${phaseName(i)}`);

  function fiberHop(c, n) {
    const spans = cableSpans(c);
    const via = spans.slice(0, -1).map((s) => point(s.to).name);
    return { kind: "fiber", text: `${c.name} #${n}`, colors: n <= c.fibers ? traceColors(c, n) : `not on this ${c.fibers}F cable`,
      at: `${point(c.from).name} → ${point(spans.at(-1).to).name}${via.length ? ` (through ${via.join(", ")})` : ""}`,
      loc: c.from, phase: phaseText(phaseIdx(c)) };
  }
  function connHop(L, c) {
    walked.push({ locId: L.id, c });
    return { kind: c.kind === "patch" ? "patch" : "splice", text: `${c.kind === "patch" ? "Patched" : "Spliced"} at ${L.name}`,
      colors: slotText(L, c.to), at: L.name, loc: L.id, phase: phaseText(connPhase(L.id, c)) };
  }
  function splitHop(L, s, port) {
    return { kind: "split", text: `${s ? eqLabel(s) : "Splitter"} at ${L.name}`,
      colors: port === "in" ? "input" : port === "auto" ? "output (no DS set)" : `output ${port}`, at: L.name, loc: L.id, phase: phaseText(phaseIdx(s)) };
  }
  function portHop(L, key) {
    return { kind: "port", text: endpointLabel(key), colors: "", at: L.name, loc: L.id, phase: phaseText(phaseIdx(findEquipment(key.split(":")[1]))) };
  }

  // A target nothing feeds: splice it to the next free incoming fiber
  // (or a splitter output to its own port, as Check plan does), or a
  // splitter input to the next free feeder fiber.
  function feedFix(L, key) {
    const [kind, id, sub] = key.split(":");
    if (kind === "split" && sub === "in") {
      const s = findEquipment(id);
      return s ? feederFix(L, s) : null;
    }
    const d = kind === "fiber" && cableById(id);
    if (!d || d.from !== L.id) return null;
    const f = model.childFibers(d).find((x) => x.out === Number(sub));
    return f ? spliceOpenFix(model, L, d, [f]) : null;
  }

  // Back to the start. Hops come start first.
  function up(locId, key, side) {
    const hops = [];
    const seen = new Set();
    for (;;) {
      const L = point(locId);
      const tag = `${locId}|${key}|${side}`;
      if (seen.has(tag)) return { hops, end: "The path loops back on itself.", ok: false };
      seen.add(tag);
      const [kind, id, sub] = key.split(":");
      if (side === "out") {
        const c = conns(locId).find((x) => x.to === key);
        if (!c) {
          if (locId === start) return { hops, end: `${L.name} (start)`, ok: true };
          return { hops, end: `Ends here: ${endpointLabel(key)} isn't spliced to anything at ${L.name}.`, ok: false,
            stop: { locId, key, side: "R" }, fix: feedFix(L, key) };
        }
        hops.unshift(connHop(L, c));
        key = c.from;
        side = "in";
      } else if (kind === "fiber") {
        const c = cableById(id);
        if (!c) return { hops, end: "The cable is gone.", ok: false };
        hops.unshift(fiberHop(c, Number(sub)));
        locId = c.from;
        side = "out";
      } else if (kind === "split") {
        hops.unshift(splitHop(L, findEquipment(id), sub));
        key = `split:${id}:in`;
        side = "out";
      } else {
        // An OLT port is where light starts; a panel or terminal passes it on.
        hops.unshift(portHop(L, key));
        const eq = findEquipment(id);
        if (!eq || eq.type === "shelf") return { hops, end: `${endpointLabel(key)} (start)`, ok: !!eq };
        side = "out";
      }
    }
  }

  // Out to everything it reaches: [{ hop, kids }] down to leaves
  // { end, ok, spare, home, stop, fix }.
  function down(locId, key, side, seen = new Set()) {
    const L = point(locId);
    const tag = `${locId}|${key}|${side}`;
    if (seen.has(tag)) return [{ end: "The path loops back on itself.", ok: false }];
    seen.add(tag);
    const [kind, id, sub] = key.split(":");
    if (side === "out") {
      if (kind === "fiber") {
        const c = cableById(id);
        if (!c) return [{ end: "The cable is gone.", ok: false }];
        const endId = cableSpans(c).at(-1).to;
        const E = point(endId);
        const kids = E.type === "nid" ? [{ end: `Home: ${E.name}`, ok: true, home: E.id }] : down(endId, key, "in", seen);
        return [{ hop: fiberHop(c, Number(sub)), kids }];
      }
      if (kind === "split") {
        const s = findEquipment(id);
        const outs = [...new Set(conns(locId).filter((c) => c.from.startsWith(`split:${id}:`)).map((c) => c.from))];
        const kids = outs.flatMap((k) => down(locId, k, "in", seen));
        return [{ hop: splitHop(L, s, "in"), kids: kids.length ? kids : [{ end: `No outputs of ${s ? eqLabel(s) : "the splitter"} used yet: nothing beyond.`, spare: true }] }];
      }
      // A home plugged into this port, or on through the panel.
      const homes = plan.points.filter((h) => h.type === "nid" && h.tport && `port:${h.tport.eqId}:${h.tport.portId}` === key);
      const kids = homes.map((h) => ({ end: `Home: ${h.name} (plugged in here)`, ok: true, home: h.id }));
      if (conns(locId).some((c) => c.from === key)) kids.push(...down(locId, key, "in", seen));
      return [{ hop: portHop(L, key), kids: kids.length ? kids : [{ end: "Port not used: nothing beyond.", spare: true }] }];
    }
    const tos = conns(locId).filter((c) => c.from === key);
    if (tos.length) return tos.map((c) => ({ hop: connHop(L, c), kids: down(locId, c.to, "out", seen) }));
    return [loose(L, key)];
  }

  // Nothing at L takes this strand on. A fiber the plan means for
  // something (a home, a splitter) is a break; anything else is spare.
  function loose(L, key) {
    const [kind, id, sub] = key.split(":");
    const c = kind === "fiber" && cableById(id);
    const n = Number(sub);
    const item = c && model.assign(c).map.get(n);
    if (!item || item.startsWith("dark:")) {
      return { end: `${kind === "fiber" ? "Spare" : kind === "split" ? "Output not used" : "Port not used"}: nothing beyond ${L.name}.`, spare: true };
    }
    // Where it's meant to go here, if that's still open: splice it there.
    let fix = null;
    for (const d of childCables(L.id).filter((x) => !x.through)) {
      const f = model.childFibers(d).find((x) => x.item === item);
      const to = f && `fiber:${d.id}:${f.out}`;
      if (to && !conns(L.id).some((x) => x.to === to)) {
        fix = { text: `Splice ${cabName(c)} #${n} to ${cabName(d)} #${f.out} at ${L.name}`, run: () => connect(L.id, key, to) };
        break;
      }
    }
    return { end: `Ends here: ${c.name} #${n} isn't spliced at ${L.name} (it's meant for ${model.describe(item)}).`, ok: false,
      stop: { locId: L.id, key, side: "L" }, fix };
  }

  return { up, down, fiberHop, walked };
}

// Hops from the start down to the home: [{ kind, text, colors, at }].
function traceHome(model, home, w = strandWalker(model)) {
  const drop = plan.cables.find((c) => c.to === home.id);
  if (!drop) return { hops: [], end: `No cable reaches ${home.name}.`, ok: false };
  const cable = cableStart(drop);
  let n = null;
  const item = homeItem(home);
  for (const [k, it] of model.assign(cable).map) if (it === item) n = k;
  if (n === null) return { hops: [], end: `${home.name} has no fiber on ${cable.name}.`, ok: false };
  const t = w.up(cable.from, `fiber:${cable.id}:${n}`, "out");
  t.hops.push(w.fiberHop(cable, n));
  return t;
}

// One hop as a list item.
function traceHopItem(hop) {
  const li = el("li", `trace-${hop.kind}`);
  li.append(el("b", "", hop.text));
  if (hop.colors) li.append(document.createTextNode(` · ${hop.colors}`));
  if (hop.phase) li.append(el("span", "trace-phase", hop.phase));
  if (hop.kind === "fiber") li.append(el("div", "hint", hop.at));
  return li;
}

// --- Trace this strand (from the splice case editor) ---
// Both ways from one strand: the hops back to the start, and the tree out
// to every home or port it reaches. Where it stops short: "Take me there"
// (go(stop)) and, when it's safe, an opt-in fix that says what it splices
// (fix(f), which leaves an Undo note). Gives { box, walked }.
function strandTraceBox(locId, key, side, { go, fix, close }) {
  const model = buildSpliceModel();
  const w = strandWalker(model);
  const L = point(locId);
  const face = side === "L" ? "in" : "out";
  const upT = w.up(locId, key, face);
  const tree = w.down(locId, key, face);
  const box = el("div", "trace-box");
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", "Strand trace");
  const x = btnEl("×", close, "check-hint-x");
  x.setAttribute("aria-label", "Close the trace");
  box.append(x, el("h4", "", `Trace: ${endpointLabel(key)} at ${L.name}`));

  const stopRow = (t) => {
    const row = el("div", "trace-stop");
    if (t.stop) row.append(btnEl("Take me there", () => go(t.stop, t.end), "btn ghost"));
    if (t.fix) {
      const b = btnEl(`Fix: ${t.fix.text}`, () => fix(t.fix), "btn ghost");
      b.title = "Makes this splice, and leaves an Undo note.";
      row.append(b);
    }
    return row.childNodes.length ? row : null;
  };

  // Up: the start at the top, the strand at the bottom.
  box.append(el("h5", "", "Back toward the start"));
  const upList = el("ol", "trace-list");
  if (upT.ok) upList.append(el("li", "trace-start", `Start: ${upT.end}`));
  for (const hop of upT.hops) upList.append(traceHopItem(hop));
  upList.append(el("li", "trace-here", `This strand: ${endpointLabel(key)} at ${L.name}`));
  box.append(el("p", upT.ok ? "trace-ok" : "warn", upT.ok ? "✓ Reaches the start." : `✗ ${upT.end}`), upList);
  const upStop = !upT.ok && stopRow(upT);
  if (upStop) box.append(upStop);

  // Down: a tree, fanning out at splitters.
  let homes = 0;
  let breaks = 0;
  const branch = (nodes) => {
    const ol = el("ol", "trace-list");
    for (const n of nodes) {
      if (n.hop) {
        const li = traceHopItem(n.hop);
        if (n.kids.length) li.append(branch(n.kids));
        ol.append(li);
        continue;
      }
      if (n.home) homes++;
      if (!n.ok && !n.spare) breaks++;
      const li = el("li", n.ok ? "trace-end ok" : n.spare ? "trace-end spare" : "trace-end bad", `${n.ok ? "✓ " : n.spare ? "" : "✗ "}${n.end}`);
      const s = !n.ok && !n.spare && stopRow(n);
      if (s) li.append(s);
      ol.append(li);
    }
    return ol;
  };
  box.append(el("h5", "", "Out from here"));
  const downList = branch(tree);
  box.append(el("p", breaks ? "warn" : "trace-ok",
    [homes ? `Reaches ${plural(homes, "home")}` : "Reaches no homes", breaks ? `${breaks} break${breaks === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") + "."), downList);
  return { box, walked: w.walked };
}

// The trace panel: pick a home, see its path; or trace every home and
// list the ones that don't make it back to the start.
function openTrace(homeId) {
  const model = buildSpliceModel();
  const walker = strandWalker(model);
  const homes = sortHomes(plan.points.filter((p) => p.type === "nid"));
  if (!homes.length) return showNote("Add homes first: a trace runs from a home back to the start.");
  closeMenu();
  openForm("Trace a fiber", (body, foot) => {
    const pick = selectEl(homes.map((h) => ({ value: h.id, label: h.name })), homeId || homes[0].id);
    const out = el("div", "trace-out");
    const show = () => {
      const h = point(pick.value);
      const t = traceHome(model, h, walker);
      const list = el("ol", "trace-list");
      if (t.ok) list.append(el("li", "trace-start", `Start: ${plan.points[0].name}`));
      for (const hop of t.hops) list.append(traceHopItem(hop));
      list.append(el("li", "trace-end", `Home: ${h.name}`));
      out.replaceChildren(el("p", t.ok ? "trace-ok" : "warn", t.ok ? `✓ Connected: ${t.end}` : `✗ Break: ${t.end}`), list);
    };
    pick.addEventListener("change", show);
    body.append(fieldEl("Home", pick), out);
    show();

    const all = el("div");
    foot.append(btnEl("Trace every home", () => {
      const bad = homes.map((h) => ({ h, t: traceHome(model, h, walker) })).filter((x) => !x.t.ok);
      all.replaceChildren(el("p", bad.length ? "warn" : "trace-ok",
        bad.length ? `${plural(bad.length, "home")} of ${homes.length} don't trace back to the start:` : `All ${plural(homes.length, "home")} trace back to the start.`));
      const ul = el("ul", "trace-bad");
      for (const { h, t } of bad) {
        const li = el("li");
        li.append(btnEl(h.name, () => {
          pick.value = h.id;
          show();
        }, "linklike"), document.createTextNode(`: ${t.end}`));
        ul.append(li);
      }
      if (bad.length) all.append(ul);
    }, "btn ghost push-left"), btnEl("Close", () => {
      closeForm();
      renderRoute();
    }, "btn big"));
    body.append(all);
  });
}

document.getElementById("trace-open").addEventListener("click", (e) => {
  e.stopPropagation();
  if (plan && !planEmpty()) openTrace(null);
});
