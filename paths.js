// Paths, conduit and cables. Tapping the line between two locations
// opens one form for the path: its conduit, the cable placed on it (if
// any), and which incoming fibers that cable is spliced to.

const CONDUIT_SIZES = ["0.75in", "1in", "1.25in", "1.5in", "2in", "3in", "4in"];
const CONDUIT_COLORS = ["Orange", "Black", "Blue", "Green", "Red", "White", "Yellow", "Purple", "Gray", "Brown"];

// "2x 1.25in · Orange · 350 ft"
function conduitLabel(cd) {
  if (!cd) return "";
  const parts = [];
  if (cd.size) parts.push(`${cd.ducts || 1}x ${cd.size}`);
  if (cd.color) parts.push(cd.color);
  if (cd.footage) parts.push(`${cd.footage} ft`);
  return parts.join(" · ");
}

// --- Fiber picks ---
// A cable's `picks` say which fibers of the cable arriving at its start
// are spliced onto it: [{ inFrom, inTo, outFrom }]. No picks means the
// app chooses (automatic).

function expandPicks(picks) {
  const pairs = [];
  for (const r of picks || []) {
    for (let n = r.inFrom; n <= r.inTo; n++) pairs.push({ in: n, out: r.outFrom + (n - r.inFrom) });
  }
  return pairs;
}

// Pairs back into ranges, joining runs that go up together.
function toRanges(pairs) {
  const sorted = [...pairs].sort((a, b) => a.out - b.out);
  const ranges = [];
  for (const p of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && p.in === last.inTo + 1 && p.out === last.outFrom + (last.inTo - last.inFrom) + 1) last.inTo = p.in;
    else ranges.push({ inFrom: p.in, inTo: p.in, outFrom: p.out });
  }
  return ranges;
}

// --- Splicing what's placed ---
// Placing a cable, tail, drop or splitter never splices anything by
// itself. It starts spliced by hand only (handOnly): a cable with no
// fibers picked and no splitter outputs joined, a splitter with no F2.
// "Splice fibers automatically", unticked by default, lets the app
// choose instead, as plans did before.

function autoSpliceBox() {
  const box = inputEl("checkbox");
  const row = el("label", "check-row");
  row.append(box, el("span", "", "Splice fibers automatically"));
  row.title = "Off: nothing is spliced until you join fibers in the splice case. " +
    "On: the app picks the splices as homes and splitters are added further on.";
  return { row, box };
}

function spliceByHand(c) {
  c.picks = [];
  c.pins = {};
  c.handOnly = true;
  return c;
}

function splitterByHand(s) {
  s.f2Manual = true;
  s.handOnly = true;
  return s;
}

// Fibers of a physical cable that are spoken for no matter what the app
// picks: splitter F2 counts and fiber picks. n -> what uses it.
function fixedInUse(cableId, exceptId) {
  const used = new Map();
  for (const { p, s, d } of fiberUsers(cableId)) {
    if (s) {
      if (s.id !== exceptId && s.f2) used.set(s.f2, `feeds ${s.name} at ${p.name}`);
    } else if (d.id !== exceptId && !d.through && d.picks) {
      for (const pr of expandPicks(d.picks)) used.set(pr.in, `is spliced to ${d.name} #${pr.out} at ${p.name}`);
    }
  }
  return used;
}

// What can take fibers of a physical cable, in plan order: the splitters
// it feeds ({ p, s }) and the cables leaving where it arrives ({ p, d }).
// The plan index keeps these for every cable at once.
function fiberUsers(cableId) {
  const ix = planIndex();
  if (ix && ix.fiberUsers) return ix.fiberUsers.get(cableId) || [];
  const all = new Map();
  const add = (id, item) => {
    if (!ix && id !== cableId) return;
    if (!all.has(id)) all.set(id, []);
    all.get(id).push(item);
  };
  for (const p of plan.points) {
    for (const s of splittersAt(p)) {
      const sc = feederAt(p.id, s);
      if (sc) add(cableStart(sc).id, { p, s });
    }
    const pc = incomingCable(p.id);
    if (!pc) continue;
    const id = cableStart(pc).id;
    for (const d of childCables(p.id)) add(id, { p, d });
  }
  if (ix) ix.fiberUsers = all;
  return all.get(cableId) || [];
}

// "Orange tube, Blue-Aqua" for fibers a..b of a cable.
function rangeColors(fibers, a, b) {
  const code = colorCode(fibers);
  const fa = code[a - 1];
  const fb = code[b - 1];
  if (!fa || !fb) return "";
  const many = tubeCount(fibers) > 1;
  const one = (f) => (many ? `${f.tubeColor.name} tube ` : "") + f.fiberColor.name;
  if (a === b) return one(fa);
  if (fa.tube === fb.tube) return (many ? `${fa.tubeColor.name} tube, ` : "") + `${fa.fiberColor.name}-${fb.fiberColor.name}`;
  return `${one(fa)} to ${one(fb)}`;
}

function rangeText(a, b) {
  return a === b ? `${a}` : `${a}-${b}`;
}

// --- Cable labels ---
// "1-12 to Handhole 2, 13-48 spare": which fibers are used and where
// they leave the cable. The route shows only the used ranges
// ("1-12 → Handhole 2"); spares are in the cable's own dialog.
function cableNote(model, c, spares = true) {
  const start = cableStart(c);
  const { map } = model.assign(start);
  const exits = model.exits(start);
  const runs = [];
  for (let n = 1; n <= start.fibers; n++) {
    const it = map.get(n);
    const where = it ? exits.get(it) || "?" : null;
    const last = runs[runs.length - 1];
    if (last && last.where === where) last.to = n;
    else runs.push({ from: n, to: n, where });
  }
  if (runs.length === 1 && !runs[0].where) return "";
  if (!spares) return runs.filter((r) => r.where).map((r) => `${rangeText(r.from, r.to)} → ${r.where}`).join("\n");
  return runs.map((r) => `${rangeText(r.from, r.to)} ${r.where ? `to ${r.where}` : "spare"}`).join(", ");
}

// Every run of fibers on a cable, spares too, for its dialog.
function fiberUseList(model, c) {
  const start = cableStart(c);
  const { map } = model.assign(start);
  const exits = model.exits(start);
  const list = el("ul", "fiber-use");
  let run = null;
  const flush = () => {
    if (!run) return;
    const li = el("li", run.where ? "" : "spare");
    li.append(el("span", "mono", `#${rangeText(run.from, run.to)}`), el("span", "", rangeColors(start.fibers, run.from, run.to)),
      el("b", "", run.where ? `to ${run.where}` : "spare"));
    list.append(li);
  };
  for (let n = 1; n <= start.fibers; n++) {
    const it = map.get(n);
    const where = it ? exits.get(it) || "?" : null;
    if (run && run.where === where) run.to = n;
    else {
      flush();
      run = { from: n, to: n, where };
    }
  }
  flush();
  return list;
}

// "Dist 1 · 48F · 1-12 to HH2, 13-48 spare"
function cableAnnotation(model, c) {
  const note = isDrop(c) ? "" : cableNote(model, c);
  return [c.name, `${c.fibers}F`, note].filter(Boolean).join(" · ");
}

// --- The path on the route ---

let openPathId = null;

function pathEl(path, model) {
  const c = pathCable(path);
  const cables = pathCables(path);
  const cd = conduitLabel(path.conduit);
  const b = el("button", "cable" + (c ? "" : " empty") + (c && c.through ? " through" : "") +
    (path.conduit && path.conduit.size ? " conduit" : "") + (path.to === openPathId ? " selected" : "") +
    (point(path.to).type === "nid" ? " drop" : "") + (c && phasePast(c) ? " past" : ""));
  b.type = "button";
  b.style.setProperty("--wire", wireColor(c));
  for (const c of cables) {
    const kind = cableKind(c);
    const size = `${c.fibers}F` + (c.through ? " · continued" : "") +
      (kind !== "cable" ? ` · ${CABLE_KINDS[kind]}` : "") + (hasPhases() ? ` · P${phaseIdx(c) + 1}` : "");
    if (cables.length > 1) b.append(el("div", "cable-name", `${c.name || "Cable"} · ${size}`));
    else b.append(el("div", "cable-name", c.name || "Cable"), el("div", "cable-size", size));
    if (cables.length === 1 && !c.through && !isDrop(c) && model) {
      const note = cableNote(model, c, false);
      if (note) {
        const n = el("div", "cable-note", note);
        n.title = `${note}\nTap for spares and the color code.`;
        b.append(n);
      }
    }
  }
  if (!c) {
    b.append(el("div", "cable-name muted", "No cable"));
  }
  b.append(el("div", "line"));
  if (cd) b.append(el("div", "conduit-label", cd));
  for (const c of cables) {
    const tubes = el("div", "tubes");
    for (let t = 0; t < tubeCount(c.fibers); t++) tubes.append(swatch(colorAt(t), true));
    b.append(tubes);
  }
  b.addEventListener("click", (e) => openLineMenu(path.to, e));
  return b;
}

// --- Path form ---

// What a guest sees on tapping a line: the cable, where its fibers go,
// and its color code. Nothing to change.
function openPathView(toId) {
  const path = incomingPath(toId);
  const cables = pathCables(path);
  const model = buildSpliceModel();
  openForm(`${point(path.from).name} → ${point(path.to).name}`, (body, foot) => {
    const cd = conduitLabel(path.conduit);
    if (cd) body.append(el("p", "", `Conduit: ${cd}`));
    if (!cables.length) body.append(el("p", "hint", "No cable on this path."));
    for (const c of cables) {
      body.append(el("p", "cable-annotation", [c.name, `${c.fibers}F`, cableKindText(c), c.through ? THROUGH_LABELS[c.through] : ""].filter(Boolean).join(" · ")));
      body.append(el("h4", "form-section", "Fiber use"), fiberUseList(model, cableStart(c)));
      body.append(el("h4", "form-section", "Color code"), colorCodeList(c.fibers));
    }
    foot.append(btnEl("Close", finish, "btn big"));
  });
  openPathId = toId;
  renderRoute();
}

function openPath(toId, cableId) {
  if (isGuest()) return openPathView(toId);
  const path = incomingPath(toId);
  const from = point(path.from);
  const to = point(path.to);
  const cables = pathCables(path);
  const c = cableId === "new" ? null : cableId ? cables.find((x) => x.id === cableId) : pathCable(path);
  if (c && againstPath(c)) return openBackRun(path, c);
  // A tail laid back up this path ends here too, but can't carry on down it.
  const arriving = plan.cables.filter((x) => x.to === from.id && x.from !== to.id && (!nextSpan(x) || nextSpan(x) === c));
  let inCable = incomingCable(from.id);
  inCable = inCable && cableStart(inCable);
  const toHome = to.type === "nid";
  const model = buildSpliceModel();

  openForm(`${from.name} → ${to.name}`, (body, foot) => {
    // Conduit
    body.append(el("h4", "form-section", "Path / conduit"));
    const cd = path.conduit || {};
    const size = selectEl([{ value: "", label: "No conduit" }, ...CONDUIT_SIZES.map((s) => ({ value: s, label: s }))], cd.size || "");
    const ducts = inputEl("number", cd.ducts || 1, { min: 1, max: 24 });
    const color = selectEl([{ value: "", label: "-" }, ...CONDUIT_COLORS.map((s) => ({ value: s, label: s }))], cd.color || "");
    const footage = inputEl("number", cd.footage || "", { min: 0, placeholder: "ft" });
    const grid = el("div", "form-grid");
    grid.append(fieldEl("Conduit size", size), fieldEl("Ducts", ducts), fieldEl("Color", color), fieldEl("Footage (ft)", footage));
    body.append(grid);

    // Cable
    body.append(el("h4", "form-section", "Cable"));
    if (cables.length) body.append(cableChoices(toId, cables, c));
    const modes = [{ value: "none", label: "No cable" }, { value: "new", label: "New cable" }];
    for (const x of arriving) {
      modes.push({ value: `pass:${x.id}`, label: `${x.name} passes through ${from.name}` },
        { value: `storage:${x.id}`, label: `${x.name}, slack stored at ${from.name}` });
    }
    const mode = selectEl(modes, c && c.through ? `${c.through}:${prevSpan(c).id}` : c || cableId === "new" ? "new" : "none");
    if (c && c.through) {
      const start = cableStart(c);
      body.append(el("p", "hint", `Part of ${start.name}, from ${point(start.from).name}, passes through here`),
        btnEl(`Edit ${start.name}`, () => openPath(spanPathTo(start), start.id), "btn ghost"));
    }
    body.append(fieldEl("On this path", mode));

    const newBox = el("div", "form-grid");
    // A new cable here arrives at the end of this path, or (a tail run
    // back up it) starts at the end and arrives at its start.
    const starts = tailStartField(from.id, null, to.id, null, true);
    starts.el.querySelector(".field-label").textContent = "Starts at";
    if (!toHome) {
      starts.el.querySelector("select").append(new Option(`${to.name}, back to ${from.name}`, to.id));
      starts.el.hidden = false;
    }
    const goingBack = () => !c && starts.value() === to.id;
    if (!c) newBox.append(starts.el);
    const startKind = c && !c.through ? c.kind || "cable" : "cable";
    const kind = selectEl(Object.entries(CABLE_KINDS).map(([value, label]) => ({ value, label })), startKind);
    // The name: the app's next "Cable n" (locked), or typed by hand.
    const own = c && !c.through ? c : null;
    // A tail is named after the location of its splitter or terminal.
    const ownerLoc = own && tailOwner(own) && equipmentLocation(tailOwner(own).id);
    // Otherwise it's named after where it ends (cable A09613 ends in A09613).
    const endId = own ? cableSpans(own).at(-1).to : to.id;
    const defaultName = () => (ownerLoc && (own.kind || "cable") === kind.value ? ownerLoc.name
      : own && (own.kind || "cable") === kind.value && AUTO_CABLE_NAME.test(own.name) ? own.name
        : cableNameFor(kind.value, goingBack() ? from.id : endId));
    const name = inputEl("text", own ? own.name : defaultName());
    let nameManual = !!own && !AUTO_CABLE_NAME.test(own.name) && !(ownerLoc && own.name === ownerLoc.name) &&
      own.name !== cableNameFor(own.kind || "cable", endId);
    const nameBox = el("div");
    const renderName = () => {
      if (!nameManual) name.value = defaultName();
      nameBox.replaceChildren(lockField(!nameManual, el("span", "auto-val", name.value), name, (lock) => {
        nameManual = !lock;
        renderName();
        if (!lock) name.focus();
      }, "the name"));
    };
    kind.addEventListener("change", renderName);
    renderName();
    // Sizes from older or imported plans stay on the list.
    const sizes = c && !CABLE_SIZES.includes(c.fibers) ? [...CABLE_SIZES, c.fibers].sort((a, b) => a - b) : CABLE_SIZES;
    // A 1F jumper is offered on paths to or from an FDH or head end.
    const jumperOk = [from, to].some((x) => x.type === "fdh" || x.type === "headend");
    const sizeOpts = sizes.map((n) => ({ value: n, label: `${n}F` }));
    if (jumperOk || (c && c.jumper)) sizeOpts.splice(1, 0, { value: "1j", label: "1F Jumper" });
    const fibers = selectEl(sizeOpts,
      c && !c.through ? (c.jumper ? "1j" : c.fibers) : toHome ? 1 : 12);
    fibers.dataset.field = "size";
    // A tail's length: stock, or custom when no stock tail reaches.
    const tail = tailLengthField(own && own.tailFt, "Not set");
    const syncTail = () => (tail.el.hidden = kind.value === "cable");
    kind.addEventListener("change", syncTail);
    syncTail();
    newBox.append(fieldEl("Type", kind), fieldEl("Name", nameBox), fieldEl("Size", fibers), tail.el);
    const phaseSel = phaseSelect(c);
    if (phaseSel) newBox.append(fieldEl("Phase", phaseSel));
    body.append(newBox);

    const contNote = el("p", "hint");
    body.append(contNote);

    // Fiber picker: which incoming fibers go onto this cable.
    const pickBox = el("div", "pick-box");
    pickBox.dataset.field = "picks";
    body.append(pickBox);
    // Locked: the app picks the fibers. Unlocked: ranges and the grid.
    // A cable starting here for the first time starts unlocked with
    // nothing spliced: placing it never splices by itself.
    const fresh = !c || !!c.through;
    const pickMode = { value: fresh || c.picks ? "pick" : "auto" };
    let ranges = fresh ? [] : c.picks ? c.picks.map((r) => ({ ...r })) : null;
    const rangesEl = el("div", "ranges");
    const pickLock = el("div");
    const renderPickLock = () => pickLock.replaceChildren(lockField(pickMode.value !== "pick",
      el("span", "auto-val", "Automatic: the app picks them as homes and splitters are added further on"), el("span", "auto-val", "Chosen by hand, below"),
      (lock) => {
        pickMode.value = lock ? "auto" : "pick";
        renderPickLock();
        renderRanges();
      }, "the fibers"));
    function renderPicker() {
      pickBox.replaceChildren();
      if (!inCable) return;
      renderPickLock();
      const start = c ? from.id : starts.value();
      pickBox.append(el("h4", "form-section", `Fibers spliced from ${inCable.name} at ${point(start).name}`),
        fieldEl("Fibers", pickLock), rangesEl);
    }
    renderPicker();
    fibers.addEventListener("change", () => {
      if (inCable && pickMode.value === "pick" && !rangesTouched) {
        ranges = suggestPicks(model, c, inCable, parseInt(fibers.value, 10));
        renderRanges();
      }
    });
    let rangesTouched = !!ranges;

    function renderRanges() {
      rangesEl.innerHTML = "";
      if (pickMode.value !== "pick") {
        rangesEl.append(el("p", "hint", "The splice sheet shows what it picked. Unlock to choose fibers yourself."));
        return;
      }
      if (!ranges) ranges = suggestPicks(model, c, inCable, parseInt(fibers.value, 10));
      const outName = name.value.trim() || "this cable";
      ranges.forEach((r, i) => {
        const row = el("div", "range-row");
        const a = inputEl("number", r.inFrom, { min: 1, max: inCable.fibers });
        const b = inputEl("number", r.inTo, { min: 1, max: inCable.fibers });
        const o = inputEl("number", r.outFrom, { min: 1 });
        const info = el("span", "range-info");
        const update = () => {
          r.inFrom = Number(a.value);
          r.inTo = Number(b.value);
          r.outFrom = Number(o.value);
          const len = r.inTo - r.inFrom;
          const outTo = r.outFrom + len;
          info.textContent = len < 0 ? "" :
            `${rangeColors(inCable.fibers, r.inFrom, r.inTo)} → ${outName} #${rangeText(r.outFrom, outTo)}` +
            ` (${rangeColors(parseInt(fibers.value, 10), r.outFrom, outTo)})`;
        };
        [a, b, o].forEach((x) => x.addEventListener("input", () => {
          rangesTouched = true;
          update();
        }));
        row.append(el("span", "", `${inCable.name} #`), a, el("span", "", "to"), b,
          el("span", "", `→ ${outName} from #`), o,
          btnEl("×", () => {
            ranges.splice(i, 1);
            rangesTouched = true;
            renderRanges();
          }, "btn ghost small"), info);
        rangesEl.append(row);
        update();
      });
      // Splitter outputs made here win over a pick on the same fiber.
      if (c && !c.through) {
        const here = splittersAt(from);
        const skipped = model.childFibers(c).filter((f) => f.in && here.some((sp) => f.item.startsWith(`port:${sp.id}:`)));
        if (skipped.length) {
          rangesEl.append(el("p", "hint", `Skipped: ${skipped.map((f) => `#${f.out}`).join(", ")} on ${c.name} ` +
            `carry splitter outputs from ${from.name}, so those picks aren't spliced.`));
        }
      }
      rangesEl.append(btnEl("+ Add a range", () => {
        const pairs = expandPicks(ranges);
        const lastIn = Math.max(0, ...pairs.map((p) => p.in));
        const lastOut = Math.max(0, ...pairs.map((p) => p.out));
        ranges.push({ inFrom: lastIn + 1, inTo: lastIn + 1, outFrom: lastOut + 1 });
        renderRanges();
      }, "btn ghost"));
      rangesEl.append(fiberGrid({
        inCable, outName, outFibers: parseInt(fibers.value, 10), taken: fixedInUse(inCable.id, c && c.id),
        getPairs: () => expandPicks(ranges),
        setPairs: (pairs) => {
          ranges = toRanges(pairs);
          rangesTouched = true;
          renderRanges();
        },
      }));
    }

    function refresh() {
      const m = mode.value;
      newBox.hidden = m !== "new";
      pickBox.hidden = m !== "new" || !inCable;
      const continued = arriving.find((x) => x.id === m.split(":")[1]);
      contNote.hidden = !continued;
      if (!contNote.hidden) contNote.textContent = `Same cable as ${continued.name}: ${continued.fibers}F, no splicing at ${from.name}.`;
      if (m === "new" && inCable) renderRanges();
    }
    starts.el.addEventListener("change", () => {
      if (c) return;
      renderName();
      const incoming = incomingCable(starts.value());
      inCable = incoming && cableStart(incoming);
      ranges = [];
      rangesTouched = true;
      renderPicker();
      refresh();
    });
    mode.addEventListener("change", refresh);
    name.addEventListener("change", () => pickMode.value === "pick" && renderRanges());

    // Everything on this cable, spares too, and its color code.
    if (c && !c.through && !isDrop(c)) {
      body.append(el("h4", "form-section", `Fiber use on ${c.name}`), fiberUseList(model, c));
    }
    refresh();

    // Color code and label for a cable that's already placed.
    if (c) {
      const info = el("details", "color-details");
      info.append(el("summary", "", `Color code and label for ${c.name}`),
        el("p", "cable-annotation", cableAnnotation(model, cableStart(c))), colorCodeList(c.fibers));
      body.append(info);
    }

    foot.append(btnEl("+ Add a stop on this path", () => insertStopForm(path), "btn ghost push-left"));
    if (c) foot.append(btnEl("Remove cable", () => {
      const text = removeCableText(c);
      finish();
      withUndo(text, () => removeCableFrom(c));
    }, "btn ghost danger"));
    formButtons(foot, () => {
      // Taking the cable off is the one change here worth an Undo.
      const before = JSON.stringify(plan);
      const removing = c && mode.value === "none" ? removeCableText(c) : null;
      const problem = saveCable();
      if (problem) return problem;
      saveConduit();
      finish();
      if (removing) offerUndo(removing, before);
    });

    function saveConduit() {
      const next = {};
      if (size.value) {
        next.size = size.value;
        next.ducts = Math.max(1, Number(ducts.value) || 1);
      }
      if (color.value) next.color = color.value;
      if (Number(footage.value) > 0) next.footage = Number(footage.value);
      if (Object.keys(next).length) path.conduit = next;
      else delete path.conduit;
    }

    function saveCable() {
      const m = mode.value;
      if (m === "none") {
        if (c) removeCableFrom(c);
        return "";
      }
      if (m.startsWith("pass:") || m.startsWith("storage:")) {
        const arriving = cableById(m.split(":")[1]);
        const span = c || { id: makeId(), from: from.id, to: to.id };
        // Everything this cable ran on to now belongs to the arriving cable.
        const spans = c ? cableRunFrom(c) : [span];
        const stuck = resizeStuck(spans, arriving.fibers);
        if (stuck) return stuck;
        span.through = m.split(":")[0];
        span.prev = arriving.id;
        delete span.picks;
        delete span.pins;
        delete span.handOnly;
        delete span.kind;
        delete span.tailFt;
        if (!c) plan.cables.push(span);
        for (const s of spans) {
          s.name = arriving.name;
          s.fibers = arriving.fibers;
        }
        return "";
      }
      // A cable starting here.
      const cableName = nameManual ? name.value.trim() : defaultName();
      if (!cableName) return "Name the cable.";
      const tailFt = kind.value === "cable" ? 0 : tail.value();
      if (tailFt === null) return "Enter the custom tail length in feet.";
      const n = parseInt(fibers.value, 10);
      let picks = null;
      if (inCable && pickMode.value === "pick") {
        const problem = checkPicks(ranges || [], inCable, n, cableName, c);
        if (problem) return problem;
        picks = ranges.map((r) => ({ ...r }));
      }
      // A span that passed through now starts a cable of its own here.
      const spans = c ? (c.through ? cableRunFrom(c) : cableSpans(c)) : [];
      const stuck = resizeStuck(c ? spans : [{ to: goingBack() ? from.id : to.id }], n);
      if (stuck) return stuck;
      if (c) {
        delete c.through;
        delete c.prev;
      }
      const span = c || (goingBack() ? layRun(to.id, from.id, { name: cableName, fibers: n })
        : layRun(starts.value(), to.id, { name: cableName, fibers: n }));
      if (!c) spans.push(...cableSpans(span));
      for (const s of spans) {
        s.name = cableName;
        s.fibers = n;
        if (fibers.value === "1j") s.jumper = true;
        else delete s.jumper;
      }
      if (kind.value === "cable") delete span.kind;
      else span.kind = kind.value;
      if (tailFt) span.tailFt = tailFt;
      else delete span.tailFt;
      if (phaseSel) span.phase = phaseSel.value;
      if (picks) span.picks = picks;
      else delete span.picks;
      // New here and not set to automatic: spliced by hand only.
      if (fresh && (picks || !inCable)) Object.assign(span, { picks: picks || [], pins: span.pins || {}, handOnly: true });
      else if (!picks) delete span.handOnly;
      return "";
    }
  });
  openPathId = toId;
  selectedId = null;
  renderRoute();
}

// The cables on a path, one button each, and one to lay another beside
// them (a cable along a path a tail already uses, say).
function cableChoices(toId, cables, current) {
  const choices = el("div", "form-grid");
  const pick = (label, run, on) => {
    const button = btnEl(label, run, on ? "btn selected" : "btn ghost");
    button.setAttribute("aria-pressed", String(on));
    choices.append(button);
  };
  for (const x of cables) pick(`${x.name} · ${x.fibers}F`, () => openPath(toId, x.id), x === current);
  pick("+ Another cable", () => openPath(toId, "new"), !current);
  return choices;
}

// A cable laid back up the route (a tail starting further on): its name,
// size and tail length. Where it starts is set again by removing it and
// laying it anew, or from its splitter or terminal.
function openBackRun(path, c) {
  const spans = cableSpans(c);
  const start = spans[0];
  const end = spans.at(-1);
  const kind = cableKind(start);
  openForm(`${point(path.to).name} → ${point(path.from).name}`, (body, foot) => {
    body.append(el("p", "hint", `${start.name} runs from ${point(start.from).name} back up the route` +
      (spans.length > 1 ? `, through ${spans.slice(1).map((s) => point(s.from).name).join(", ")},` : "") + ` to ${point(end.to).name}.`));
    const name = inputEl("text", start.name);
    const sizes = CABLE_SIZES.includes(start.fibers) ? CABLE_SIZES : [...CABLE_SIZES, start.fibers].sort((a, b) => a - b);
    const fibers = selectEl(sizes.map((n) => ({ value: String(n), label: `${n}F` })), String(start.fibers));
    const tail = tailLengthField(start.tailFt, "Not set");
    tail.el.hidden = kind === "cable";
    const grid = el("div", "form-grid");
    grid.append(fieldEl("Name", name), fieldEl("Size", fibers), tail.el);
    // Another cable can still be laid along this path, beside the tail.
    body.append(cableChoices(path.to, pathCables(path), c));
    body.append(el("p", "cable-annotation", CABLE_KINDS[kind]), grid);
    foot.append(btnEl("Remove cable", () => {
      const text = removeCableText(start);
      finish();
      withUndo(text, () => removeCableFrom(start));
    }, "btn ghost danger"));
    formButtons(foot, () => {
      if (!name.value.trim()) return "Name the cable.";
      const n = parseInt(fibers.value, 10);
      const tailFt = kind === "cable" ? 0 : tail.value();
      if (tailFt === null) return "Enter the custom tail length in feet.";
      const stuck = resizeStuck(spans, n);
      if (stuck) return stuck;
      for (const s of spans) {
        s.name = name.value.trim();
        s.fibers = n;
      }
      if (tailFt) start.tailFt = tailFt;
      else delete start.tailFt;
      finish();
    });
  });
  openPathId = path.to;
  selectedId = null;
  renderRoute();
}

// A cable can't shrink below a fiber still in use on these spans:
// splitters fed from them on a hand-set F2, cables picking fibers from
// them, their own picks and joins, and patches to their fibers.
function resizeStuck(spans, fibers) {
  const stuck = [];
  const over = (n) => Number(n) > fibers;
  const ids = new Set(spans.map((s) => s.id).filter(Boolean));
  for (const s of spans) {
    const at = point(s.to);
    for (const sp of splittersAt(at)) {
      if (sp.f2Manual && over(sp.f2)) stuck.push(`${sp.name} at ${at.name} is on F2 ${sp.f2}`);
    }
    if (!s.id || incomingCable(at.id) !== s) continue;
    for (const d of childCables(at.id).filter((x) => !x.through && x.picks)) {
      const n = expandPicks(d.picks).map((p) => p.in).filter(over);
      if (n.length) stuck.push(`${d.name} at ${at.name} picks #${Math.max(...n)}`);
    }
  }
  const start = spans[0];
  if (start && start.id && !start.through) {
    const out = [...expandPicks(start.picks || []).map((p) => p.out), ...Object.keys(start.pins || {})].filter(over);
    if (out.length) stuck.push(`#${Math.max(...out)} is spliced at ${point(start.from).name}`);
  }
  for (const x of plan.xconnects) {
    for (const key of [x.a, x.b]) {
      const [kind, id, n] = key.split(":");
      if (kind === "fiber" && ids.has(id) && over(n)) stuck.push(`#${n} is patched at ${point(x.at).name}`);
    }
  }
  return stuck.length ? `The cable can't be ${fibers}F: ${[...new Set(stuck)].join("; ")}. Free those fibers first.` : "";
}

function checkPicks(ranges, inCable, outFibers, outName, c) {
  // No ranges: nothing spliced yet.
  if (!ranges.length) return "";
  const ins = new Set();
  const outs = new Set();
  const others = fixedInUse(inCable.id, c && c.id);
  for (const r of ranges) {
    if (![r.inFrom, r.inTo, r.outFrom].every((x) => Number.isInteger(x) && x >= 1)) return "Every range needs fiber numbers.";
    if (r.inTo < r.inFrom) return `${inCable.name} #${r.inFrom} to #${r.inTo} runs backwards.`;
    if (r.inTo > inCable.fibers) return `${inCable.name} only has ${inCable.fibers} fibers.`;
    if (r.outFrom + (r.inTo - r.inFrom) > outFibers) return `${outName} only has ${outFibers} fibers.`;
  }
  for (const p of expandPicks(ranges)) {
    if (ins.has(p.in)) return `${inCable.name} #${p.in} is picked twice.`;
    if (outs.has(p.out)) return `${outName} #${p.out} is picked twice.`;
    if (others.has(p.in)) return `${inCable.name} #${p.in} already ${others.get(p.in)}.`;
    ins.add(p.in);
    outs.add(p.out);
  }
  return "";
}

// A starting point for the picker: what the app picked for this cable,
// or else the next free fibers on the incoming cable, in order.
function suggestPicks(model, c, inCable, outFibers) {
  if (c && !c.through) {
    const pairs = model.autoPairs(c);
    if (pairs.length) return toRanges(pairs);
  }
  // Leave the fibers already carrying splitter outputs made here.
  const local = new Set();
  if (c && !c.through) {
    const here = splittersAt(point(c.from));
    for (const [n, it] of model.assign(c).map) if (here.some((sp) => it.startsWith(`port:${sp.id}:`))) local.add(n);
  }
  const used = new Set([...model.assign(inCable).map.keys(), ...fixedInUse(inCable.id, c && c.id).keys()]);
  if (c && !c.through) for (const p of model.autoPairs(c)) used.delete(p.in);
  const free = [];
  for (let n = 1; n <= inCable.fibers && free.length < outFibers; n++) if (!used.has(n)) free.push(n);
  const outs = [];
  for (let n = 1; n <= outFibers; n++) if (!local.has(n)) outs.push(n);
  return toRanges(free.slice(0, outs.length).map((n, i) => ({ in: n, out: outs[i] })));
}

// Take a cable off its path, along with the rest of its run past here.
function cableRunFrom(c) {
  const spans = cableSpans(c);
  return spans.slice(spans.indexOf(c));
}

function removeCableText(c) {
  const further = cableRunFrom(c).slice(1).map((s) => point(s.to).name);
  return further.length ? `Removed ${c.name} here and on to ${further.join(", ")}.` : `Removed ${c.name}.`;
}

function removeCableFrom(c) {
  purgeRemoved([], cableRunFrom(c).map((x) => x.id));
}

// Every fiber of a cable with its tube and color.
function colorCodeList(n) {
  const list = el("div", "tube-list");
  const fibers = colorCode(n);
  for (let t = 1; t <= tubeCount(n); t++) {
    const row = tintTube(el("div", "tube-row"), colorAt(t - 1));
    const head = el("div", "tube-head");
    const tc = colorAt(t - 1);
    head.append(swatch(tc), document.createTextNode(` Tube ${t} · ${tc.name}`));
    const wrap = el("div", "fibers");
    for (const f of fibers.filter((x) => x.tube === t)) {
      const cell = el("div", "fiber");
      cell.append(el("span", "num", String(f.number)), swatch(f.fiberColor), document.createTextNode(f.fiberColor.name));
      wrap.append(cell);
    }
    row.append(head, wrap);
    list.append(row);
  }
  return list;
}

// Tapping a line: the cable, or a handhole someone forgot, dropped in
// the middle of the run (the cable passes through it).
function openLineMenu(toId, e) {
  if (isGuest()) return openPath(toId);
  e.stopPropagation();
  const path = incomingPath(toId);
  const cables = pathCables(path);
  openPopup(`${point(path.from).name} → ${point(path.to).name}`, [
    ...cables.map((c) => ({ icon: "edit", label: `Edit cable ${c.name}`, run: () => openPath(toId, c.id) })),
    { icon: "plus", label: "Add a cable or tail", run: () => openPath(toId, "new") },
    { icon: "handhole", label: "Insert a pass-through handhole", run: () => insertStopForm(path) },
    ...cables.map((c, i) => ({ icon: "remove", label: `Remove cable ${c.name}`, danger: true, sep: i === 0, run: () => {
      const text = removeCableText(c);
      finish();
      withUndo(text, () => removeCableFrom(c));
    } })),
  ], e, "Line");
}

// --- Add a stop on a path: A -> C becomes A -> B -> C ---

function insertStopForm(path) {
  const c = pathCable(path);
  openForm(`Add a stop between ${point(path.from).name} and ${point(path.to).name}`, (body, foot) => {
    const types = [...ADD_TYPES, "other"];
    const type = selectEl(types.map((t) => ({ value: t, label: typeLabel(t) })), "handhole");
    const name = inputEl("text", autoName("handhole"));
    let touched = false;
    name.addEventListener("input", () => (touched = true));
    type.addEventListener("change", () => {
      if (!touched) name.value = type.value === "other" ? "" : autoName(type.value);
    });
    body.append(fieldEl("Type", type), fieldEl("Name", name));
    let what = null;
    let cableName = null;
    const autoSplice = autoSpliceBox();
    if (c) {
      what = selectEl([
        { value: "pass", label: `${c.name} passes through` },
        { value: "storage", label: `${c.name}, slack stored` },
        { value: "splice", label: `${c.name} is spliced (a new cable starts)` },
      ], "pass");
      cableName = inputEl("text", cableNameFor("cable", cableSpans(c).at(-1).to));
      const nameRow = fieldEl("Name of the cable leaving the splice", cableName);
      const sync = () => (nameRow.hidden = autoSplice.row.hidden = what.value !== "splice");
      what.addEventListener("change", sync);
      body.append(fieldEl("At the new stop", what), nameRow, autoSplice.row);
      sync();
    }
    formButtons(foot, () => {
      if (!name.value.trim()) return "Name the new stop.";
      if (c && what.value === "splice" && !cableName.value.trim()) return "Name the cable leaving the splice.";
      const stop = { id: makeId(), type: type.value, label: typeLabel(type.value), name: name.value.trim(), equipment: [] };
      plan.points.push(stop);
      // Both halves keep the conduit; the footage stays with the first.
      const after = { id: makeId(), from: stop.id, to: path.to };
      if (path.conduit) {
        after.conduit = { ...path.conduit };
        delete after.conduit.footage;
      }
      plan.paths.push(after);
      // Every cable on the path is cut at the new stop. The one picked
      // here may be spliced; any others pass through.
      for (const x of pathCables(path)) {
        const next = nextSpan(x);
        const span = { id: makeId(), name: x.name, from: stop.id, to: x.to, fibers: x.fibers };
        if (x === c && what.value === "splice") {
          span.name = cableName.value.trim();
          if (!autoSplice.box.checked) spliceByHand(span);
        } else {
          span.through = x === c ? what.value : "pass";
          span.prev = x.id;
        }
        plan.cables.push(span);
        if (next) next.prev = span.id;
        x.to = stop.id;
        if (x !== c) continue;
        // A splice starts a new cable, so the rest of the old run takes its name.
        for (const s of cableSpans(span)) s.name = span.name;
      }
      path.to = stop.id;
      finish();
    }, "Add stop");
  });
}

// Names the app gives cables: "Cable 3", "Drop 12", "Splitter tail 1".
const AUTO_CABLE_NAME = /^(Cable|Drop|Splitter tail|Terminal tail) \d+$/;

// --- Fiber grid ---
// The incoming cable's fibers on the left, the new cable's on the
// right, each tube on a wash of its color. Click fibers on the left
// (Ctrl-click adds one, Shift-click a run, the tube name a whole tube),
// then click where they start on the right, or drag them across. Click
// a fiber on the right to take it off.
function fiberGrid({ inCable, outName, outFibers, taken, getPairs, setPairs }) {
  const sel = new Set();
  const last = { key: null }; // the last fiber clicked, for Shift runs
  const wrap = el("div", "fgrid");
  const msg = el("p", "hint fgrid-msg");

  function freeTube(tube) {
    return colorCode(inCable.fibers).filter((f) => f.tube === tube && !taken.has(f.number)).map((f) => f.number);
  }

  function clearSelection() {
    sel.clear();
    render();
  }

  function takeOff(n) {
    const pairs = getPairs();
    if (pairs.some((p) => p.out === n)) setPairs(pairs.filter((p) => p.out !== n));
  }

  function render() {
    const pairs = getPairs();
    const outOf = new Map(pairs.map((p) => [p.in, p.out]));
    const inOf = new Map(pairs.map((p) => [p.out, p.in]));
    wrap.innerHTML = "";
    wrap.append(el("h5", "fgrid-title", "Or pick on the grid"),
      el("p", "hint", "Click fibers on the left (Ctrl-click adds one, Shift-click a run, a tube name the whole tube), then click where they start on the right, or drag them across. Click a fiber on the right to take it off."));
    const cols = el("div", "fgrid-cols");
    const side = (title, cable, fibersN, cls, cellFor) => {
      const col = el("div", "fgrid-col " + cls);
      col.append(el("div", "fgrid-head", title));
      const code = colorCode(fibersN);
      for (let t = 1; t <= tubeCount(fibersN); t++) {
        const tc = colorAt(t - 1);
        const block = tintTube(el("div", "fgrid-tube"), tubeCount(fibersN) > 1 ? tc : null);
        const th = el(cls === "in" ? "button" : "div", "fgrid-tube-head");
        th.append(swatch(tc, true), document.createTextNode(` Tube ${t} · ${tc.name}`));
        if (cls === "in") {
          th.type = "button";
          th.title = "Select the free fibers in this tube";
          th.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nums = freeTube(t);
            const all = nums.length > 0 && nums.every((n) => sel.has(n));
            openPopup(`Tube ${t} · ${tc.name}`, [
              { icon: "select", label: all ? "Clear this tube" : "Select this tube", run: () => {
                for (const n of nums) all ? sel.delete(n) : sel.add(n);
                render();
              } },
            ], e);
          });
          th.addEventListener("click", (e) => {
            const nums = freeTube(t);
            const all = nums.every((n) => sel.has(n));
            // A plain click: just this tube. Ctrl or Shift: add it or drop it.
            if (!isAddClick(e) && !e.shiftKey) sel.clear();
            for (const n of nums) all && (isAddClick(e) || e.shiftKey) ? sel.delete(n) : sel.add(n);
            render();
          });
        }
        const cells = el("div", "fgrid-cells");
        for (const f of code.filter((x) => x.tube === t)) cells.append(cellFor(f));
        block.append(th, cells);
        col.append(block);
      }
      return col;
    };
    const cell = (f, side, state, sub) => {
      const b = el("button", `fcell ${side}` + (state ? " " + state : ""));
      b.type = "button";
      b.dataset.n = f.number;
      b.dataset.side = side;
      const dot = swatch(f.fiberColor, true);
      b.append(el("span", "fnum mono", String(f.number)), dot);
      if (sub) b.append(el("span", "fsub mono", sub));
      b.title = `${f.tubeColor.name} tube, ${f.fiberColor.name}` + (sub ? ` (${sub})` : "");
      return b;
    };
    cols.append(
      side(`${inCable.name} · in`, inCable, inCable.fibers, "in", (f) => {
        const t = taken.get(f.number);
        const b = cell(f, "in", t ? "used" : [outOf.has(f.number) ? "on" : "", sel.has(f.number) ? "sel" : ""].filter(Boolean).join(" "),
          outOf.has(f.number) ? `→${outOf.get(f.number)}` : "");
        if (t) {
          b.disabled = true;
          b.title += ` · already ${t}`;
        }
        return b;
      }),
      side(`${outName} · out`, null, outFibers, "out", (f) => cell(f, "out", inOf.has(f.number) ? "on" : "", inOf.has(f.number) ? `←${inOf.get(f.number)}` : "")),
    );
    const tools = el("div", "fgrid-tools");
    tools.append(el("span", "fgrid-count", sel.size ? `${sel.size} selected` : "Nothing selected"),
      btnEl("Put on the next free fibers", () => place(null), "btn ghost small"),
      btnEl("Clear selection", clearSelection, "btn ghost small"));
    wrap.append(cols, tools, msg);
  }

  // Selected incoming fibers onto the new cable from `start` (or the
  // first free fiber), in order, skipping fibers already in use.
  function place(start) {
    if (!sel.size) {
      msg.textContent = "Select fibers on the left first.";
      return;
    }
    const keep = getPairs().filter((p) => !sel.has(p.in));
    const used = new Set(keep.map((p) => p.out));
    let n = start || 1;
    const add = [];
    for (const i of [...sel].sort((a, b) => a - b)) {
      while (n <= outFibers && used.has(n)) n++;
      if (n > outFibers) {
        msg.textContent = `${outName} only has ${outFibers} fibers: ${sel.size - add.length} didn't fit.`;
        return;
      }
      add.push({ in: i, out: n++ });
    }
    sel.clear();
    setPairs([...keep, ...add]);
  }

  // Fibers on the left are selected the classic way (ui.js selectClick).
  function tap(b, e) {
    const n = Number(b.dataset.n);
    if (b.dataset.side === "in") {
      const order = [];
      for (let i = 1; i <= inCable.fibers; i++) if (!taken.has(i)) order.push(i);
      selectClick(sel, order, n, e, last);
      render();
      return;
    }
    if (sel.size) return place(n);
    // Take this fiber off the new cable.
    takeOff(n);
  }

  wrap.addEventListener("contextmenu", (e) => {
    if (typingIn(e.target) || e.defaultPrevented) return;
    const b = e.target.closest(".fcell");
    if (!b || b.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const n = Number(b.dataset.n);
    if (b.dataset.side === "out") {
      if (getPairs().some((p) => p.out === n)) {
        openPopup(`Fiber #${n}`, [
          { icon: "remove", label: `Take #${n} off`, run: () => takeOff(n) },
        ], e);
      } else closeMenu();
      return;
    }
    if (!sel.has(n)) tap(b, {});
    const tube = colorCode(inCable.fibers).find((f) => f.number === n).tube;
    openPopup(sel.size > 1 ? `${sel.size} selected` : `Fiber #${n}`, [
      { icon: "move", label: "Put on the next free fibers", run: () => place(null) },
      { icon: "select", label: "Select this tube's free fibers", run: () => {
        for (const num of freeTube(tube)) sel.add(num);
        render();
      } },
      { icon: "select", label: "Clear the selection", run: clearSelection },
    ], e);
  });

  // Drag from the left onto the right.
  let drag = null;
  let dragged = false;
  wrap.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".fcell.in");
    if (e.button !== 0 || !b || b.disabled) return;
    drag = { b, x: e.clientX, y: e.clientY, moved: false, ghost: null, shift: e.shiftKey };
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      wrap.setPointerCapture(e.pointerId);
      const n = Number(drag.b.dataset.n);
      if (!sel.has(n)) {
        sel.clear();
        sel.add(n);
      }
      drag.ghost = el("div", "drag-ghost", `${sel.size} fiber${sel.size === 1 ? "" : "s"}`);
      document.body.append(drag.ghost);
    }
    drag.ghost.style.left = e.clientX + 12 + "px";
    drag.ghost.style.top = e.clientY + 12 + "px";
    const pr = formPanel.getBoundingClientRect();
    if (e.clientY > pr.bottom - 40) formPanel.scrollTop += 12;
    if (e.clientY < pr.top + 40) formPanel.scrollTop -= 12;
  });
  wrap.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.ghost) d.ghost.remove();
    if (!d.moved) return;
    dragged = true;
    setTimeout(() => (dragged = false), 0);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest(".fcell.out");
    if (target) place(Number(target.dataset.n));
    else render();
  });
  wrap.addEventListener("pointercancel", () => {
    if (drag && drag.ghost) drag.ghost.remove();
    drag = null;
  });
  // A drag ends in a click on the cell it started from; skip that one.
  wrap.addEventListener("click", (e) => {
    if (dragged) return;
    const b = e.target.closest(".fcell");
    if (!b || b.disabled) return;
    tap(b, e);
  });

  render();
  return wrap;
}
