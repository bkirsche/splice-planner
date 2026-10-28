// Troubleshooter: looks over the whole plan for invalid paths and
// mistakes. Problems must be fixed; warnings are worth a second look.
//
// Each finding: { level, where, text, code, key, ...what it's about,
// fix?, go? }. `code` says what kind of finding it is; `key` tells one
// finding from another across reruns. A fix is { text, run, ask?, uses? }:
// text says exactly what it changes, run makes the change (only from the
// Fix button, never on its own), ask is the question asked first when it
// takes connections apart, and uses names what it takes (a cable's free
// fibers, a splitter's free ports) so Fix all never hands one out twice.
// A go is { open, target?, hint, alt? }: the dialog where it's fixed by
// hand, the field to change there and what to do with it (Take me there).

// Names in findings say what they are ("splitter A14411"), and where only
// when that isn't already its name (equipment is named after its location).
// A name that already says what it is ("Drop 117") is left as it is.
function eqName(eq, loc) {
  const label = eqLabel(eq);
  const kind = eq.type === "other" ? "item" : (EQ_KINDS[eq.type] || EQ_KINDS.other).label.toLowerCase();
  const what = label !== eq.name || saysKind(label, kind) ? label : `${kind} ${label}`;
  return loc && loc.name !== eq.name ? `${what} at ${loc.name}` : what;
}

function cabName(c) {
  const kind = (CABLE_KINDS[c.kind || "cable"] || "Cable").toLowerCase();
  return saysKind(c.name, kind) ? c.name : `${kind} ${c.name}`;
}

const saysKind = (name, kind) => /\b(cable|drop|tail|feeder|splitter|case|closure|terminal)\b/i.test(name) || name.toLowerCase().includes(kind);

const cap = (t) => t[0].toUpperCase() + t.slice(1);

// Take me there: a location's Equipment dialog, at one item's field.
function eqGo(loc, eq, field, hint, alt) {
  return { open: () => openEquipment(loc.id), target: `[data-eq="${eq.id}"]${field ? ` [data-field="${field}"]` : ""}`, hint, alt };
}

function caseGo(loc, hint) {
  return { open: () => openConnections(loc.id), hint };
}

function pathGo(c, field, hint) {
  return { open: () => openPath(c.to, c.id), target: field && `[data-field="${field}"]`, hint };
}

function checkPlan() {
  const found = [];
  const add = (level, where, text, code, more) => found.push({ level, where, text, code, key: `${code}|${text}`, ...more });
  const problem = (where, text, code, more) => add("problem", where, text, code, more);
  const warn = (where, text, code, more) => add("warning", where, text, code, more);
  const model = buildSpliceModel();
  const start = plan.points[0];
  if (!start) return found;
  if (!plan.paths.length) warn(start.id, `Nothing leaves ${start.name} yet.`, "nothing-leaves");
  if (plan.unassigned.length) {
    warn(start.id, `${plan.unassigned.length} imported home(s) are still on the unassigned list.`, "unassigned",
      { go: { label: "Open the list", open: () => openAssign(start.id), hint: `Put the ${plan.unassigned.length} homes on the route, or remove the ones you don't need.` } });
  }

  // Feeds that loop: following what feeds each location back up comes
  // round to it again (e.g. a tail run back to the location feeding it).
  const looped = new Set();
  for (const p of plan.points) {
    const seen = [];
    for (let id = p.id; id && !looped.has(id); ) {
      if (seen.includes(id)) {
        const loop = seen.slice(seen.indexOf(id));
        for (const x of loop) looped.add(x);
        problem(id, `Cables feed each other in a loop: ${loop.map((x) => point(x).name).join(" → ")} → ${point(id).name}. One of them needs another feed.`, "loop");
        break;
      }
      seen.push(id);
      const c = incomingCable(id);
      id = c && cableStart(c).from;
    }
  }

  // Each shared DS port is reported once, not once per home on it.
  const clashed = new Set();
  const tails = new Set(plan.points.flatMap((loc) => (loc.equipment || []).map((eq) => eq.tail)).filter(Boolean));
  for (const p of plan.points) {
    const out = childCables(p.id);
    const arriving = incomingCable(p.id);

    // Equipment tails feed their own equipment; other ends share one feeder.
    const ends = plan.cables.filter((c) => c.to === p.id && !nextSpan(c));
    if (ends.length > 1 && ends.some((c) => !tails.has(cableStart(c).id))) {
      problem(p.id, `${ends.length} cables end at ${p.name}; only ${cabName(arriving)} feeds its splices.`, "ends-shared");
    }

    // Dead ends: a cable runs to a location and stops with nothing there.
    if (p.type !== "nid" && p.id !== start.id && arriving && !childPaths(p.id).length && !splittersAt(p).length &&
      !(p.equipment || []).length) {
      warn(p.id, `${p.name} is a dead end: ${cabName(arriving)} goes nowhere from here.`, "dead-end");
    }

    // Phases: something can't be built before what feeds it.
    if (hasPhases() && p.id !== start.id) {
      const path = incomingPath(p.id);
      const from = path && point(path.from);
      const c = path && pathCable(path);
      const by = from && phaseIdx(p) < phaseIdx(from) ? from : c && phaseIdx(p) < phaseIdx(c) ? c : null;
      if (by) {
        const byName = by === from ? from.name : cabName(c);
        const go = { open: () => openPhaseForm(p.id), target: '[data-field="phase"]',
          hint: `${p.name} is in ${phaseName(phaseIdx(p))}, but ${byName} feeding it is in ${phaseName(phaseIdx(by))}: pick ${phaseName(phaseIdx(by))} or a later phase.` };
        warn(p.id, `${p.name} is in ${phaseName(phaseIdx(p))}, but ${byName} feeding it is in ${phaseName(phaseIdx(by))}.`, "phase", { go });
      }
    }

    // Cables leave, but none arrives to feed them.
    if (p.id !== start.id && !arriving && out.length) {
      const into = incomingPath(p.id);
      problem(p.id, `${out.length === 1 ? cap(cabName(out[0])) : `Cables ${out.map((c) => c.name).join(", ")}`} leave${out.length === 1 ? "s" : ""} ${p.name}, but no cable reaches ${p.name}.`, "no-feed",
        { go: into && { open: () => openPath(p.id), target: '[data-field="size"]', hint: `Lay a cable on the path from ${point(into.from).name} into ${p.name}: under Cable, pick New cable and Save.` } });
    }

    // Fibers picked by hand for cables leaving here.
    for (const d of out.filter((x) => !x.through && x.picks)) {
      const inCable = arriving && cableStart(arriving);
      for (const r of d.picks) {
        if (!inCable) break;
        const go = pathGo(d, "picks", `Pick fibers for ${cabName(d)} (1 to ${d.fibers}) that ${cabName(inCable)} has (1 to ${inCable.fibers}).`);
        if (r.inTo > inCable.fibers) problem(p.id, `${cap(cabName(d))} is spliced to ${cabName(inCable)} #${r.inTo}, but ${inCable.name} only has ${inCable.fibers} fibers.`, "pick-past", { cable: d.id, go });
        if (r.outFrom + r.inTo - r.inFrom > d.fibers) problem(p.id, `Fibers picked for ${cabName(d)} run past its ${d.fibers} fibers.`, "pick-past", { cable: d.id, go });
      }
      // Placed to be spliced by hand: fibers not joined yet are work to
      // do, not a mistake. One note per cable.
      if (d.handOnly) {
        const open = model.childFibers(d).filter((f) => {
          const local = splittersAt(p).some((s) => f.item.startsWith(`port:${s.id}:`));
          return local ? (d.pins || {})[f.out] !== f.item : !f.in;
        });
        if (open.length) {
          warn(p.id, `${cap(cabName(d))} has ${open.length} fiber${open.length === 1 ? "" : "s"} not spliced yet at ${p.name} ` +
            `(${open.slice(0, 4).map((f) => `#${f.out} ${model.describe(f.item)}`).join(", ")}${open.length > 4 ? ", …" : ""}).`,
          "open-fibers", { cable: d.id, fibers: open.map((f) => f.out), fix: spliceOpenFix(model, p, d, open),
            go: caseGo(p, `Splice ${cabName(d)} #${open.slice(0, 6).map((f) => f.out).join(", #")}${open.length > 6 ? " and the rest" : ""} to free fibers here.`) });
        }
        continue;
      }
      for (const f of model.childFibers(d)) {
        const local = splittersAt(p).find((s) => f.item.startsWith(`port:${s.id}:`));
        if (!f.in && !local) {
          problem(p.id, `${cap(cabName(d))} #${f.out} (${model.describe(f.item)}) isn't spliced to anything at ${p.name}. Add it to the fibers picked.`,
            "drop-unspliced", { cable: d.id, fiber: f.out, fix: spliceOpenFix(model, p, d, [f]), go: caseGo(p, `Splice ${cabName(d)} #${f.out} to a free fiber here.`) });
        }
        if (f.in && local) {
          warn(p.id, `${cap(cabName(d))} #${f.out} carries ${eqName(local)}'s output to ${model.describe(f.item)}, so the pick from ` +
            `${inCable ? cabName(inCable) : "the incoming cable"} #${f.in} is skipped there.`, "pick-skipped",
          { cable: d.id, fiber: f.out, go: pathGo(d, "picks", `Take #${f.in} off the fibers picked for ${cabName(d)}, if the splitter output is what you meant.`) });
        }
      }
    }

    // Cross-connects to ports or fibers that are gone.
    for (const x of crossConnectsAt(p.id)) {
      if (endpointMissing(x.a) || endpointMissing(x.b)) {
        problem(p.id, `A cross-connect at ${p.name} (${endpointLabel(x.a)} to ${endpointLabel(x.b)}) points at something that was removed.`, "xc-removed", {
          xconnect: x.id,
          fix: {
            text: `Remove the cross-connect from ${endpointLabel(x.a)} to ${endpointLabel(x.b)} at ${p.name}`,
            ask: `The cross-connect at ${p.name} from ${endpointLabel(x.a)} to ${endpointLabel(x.b)} will be taken off. You can Undo it right after.`,
            run: () => (plan.xconnects = plan.xconnects.filter((y) => y.id !== x.id)),
          },
        });
      }
    }

    // Splitter outputs pinned to fibers that no longer exist.
    for (const d of out.filter((x) => !x.through && x.pins)) {
      for (const [n, it] of Object.entries(d.pins)) {
        const [, sid, port] = it.split(":");
        const s = splittersAt(p).find((x) => x.id === sid);
        const unpin = {
          text: `Take the splice to ${cabName(d)} #${n} off at ${p.name}`,
          ask: `The splice from ${s ? `${eqName(s)} output ${port}` : "the removed splitter output"} to ${cabName(d)} #${n} at ${p.name} will be taken apart. You can Undo it right after.`,
          run: () => delete d.pins[n],
        };
        if (Number(n) > d.fibers) {
          problem(p.id, `A splitter output at ${p.name} is spliced to ${cabName(d)} #${n}, but ${d.name} only has ${d.fibers} fibers.`, "pin-past", { cable: d.id, fiber: Number(n), fix: unpin });
        } else if (!s || Number(port) > splitterPorts(s)) {
          problem(p.id, `${cap(cabName(d))} #${n} at ${p.name} is spliced to a splitter output that was removed.`, "pin-removed", { cable: d.id, fiber: Number(n), fix: unpin });
        }
      }
    }

    // Two splices in one tray slot, or more slots than the case has.
    const closure = closureAt(p);
    if (closure || Object.keys(p.trays || {}).length) {
      const keys = connectionsAt(model, p.id).filter((c) => c.kind !== "patch").map((c) => c.to);
      const seen = new Map();
      const tubeTrays = new Map();
      const slots = traySlots(p, keys);
      for (const [key, ts] of slots) {
        const g = tubeGroup(key);
        if (g) {
          if (!tubeTrays.has(g)) tubeTrays.set(g, { key, trays: new Set() });
          tubeTrays.get(g).trays.add(ts.tray);
        }
        const at = `${ts.tray}/${ts.slot}`;
        if (seen.has(at)) {
          problem(p.id, `Tray ${ts.tray} slot ${ts.slot} at ${p.name} holds two splices: ${endpointLabel(seen.get(at))} and ${endpointLabel(key)}.`,
            "slot-double", { splice: key, tray: ts.tray, slot: ts.slot, fix: reslotFix(p, closure, slots, key, ts.tray),
              go: closure ? eqGo(p, closure, "trays", `${cap(eqName(closure, p))} has no empty slot left: set Trays to ${closure.trays + 1} or more, then move one splice.`)
                : caseGo(p, `Move ${endpointLabel(key)} to an empty slot.`) });
        }
        seen.set(at, key);
        if (closure && (ts.tray > closure.trays || ts.slot > closure.slots)) {
          // Only a slot set by hand can move; the app's own slots run
          // past the end only when the case is full.
          const need = ts.tray > closure.trays ? `set Trays to ${ts.tray} or more` : `pick a tray size of ${ts.slot} or more`;
          problem(p.id, `${cap(eqName(closure, p))} has ${closure.trays} trays of ${closure.slots}, but a splice is in tray ${ts.tray} slot ${ts.slot}.`,
            "slot-past", { splice: key, tray: ts.tray, slot: ts.slot, fix: (p.trays || {})[key] ? reslotFix(p, closure, slots, key) : null,
              go: eqGo(p, closure, "trays", `${cap(eqName(closure, p))} has ${closure.trays} trays of ${closure.slots}, but a splice is in tray ${ts.tray} slot ${ts.slot}: ${need}.`) });
        }
      }
      // Don't jump trays: one tube's splices belong in one tray.
      for (const { key, trays } of tubeTrays.values()) {
        if (trays.size > 1) {
          problem(p.id, `Tray jump at ${p.name}: the tube holding ${endpointLabel(key)} is spliced across trays ${[...trays].sort((x, y) => x - y).join(", ")}. Keep a tube in one tray.`, "tray-jump", { splice: key, go: caseGo(p, `Move the splices of the tube holding ${endpointLabel(key)} into tray ${Math.min(...trays)}.`) });
        }
      }
      if (closure && closure.max && keys.length > closure.max) {
        problem(p.id, `${cap(eqName(closure, p))} holds at most ${closure.max} splices, but ${keys.length} are planned.`, "case-full", { equipment: closure.id,
          go: eqGo(p, closure, null, `${cap(eqName(closure, p))} holds ${closure.max} splices but ${keys.length} are planned: add a bigger case below and move the splices to it, or splice ${keys.length - closure.max} fibers at another location.`) });
      }
    }

    for (const s of splittersAt(p)) {
      const S = cap(eqName(s, p));
      const noFeeder = caseGo(p, `Splice a free feeder fiber to the input of ${eqName(s, p)} here.`);
      const sp = { equipment: s.id };
      if (!s.f2 && s.handOnly) warn(p.id, `${S} isn't spliced to a feeder fiber yet.`, "splitter-no-feeder", { ...sp, fix: feederFix(p, s), go: noFeeder });
      else if (!s.f2) problem(p.id, `${S} has no F2 count.`, "splitter-no-f2", { ...sp, fix: feederFix(p, s), go: noFeeder });
      else if (arriving && s.f2 > arriving.fibers) {
        problem(p.id, `${S} is on F2 ${s.f2}, but ${cabName(arriving)} only has ${arriving.fibers} fibers.`, "f2-past",
          { ...sp, go: eqGo(p, s, "f2", `${S} is on F2 ${s.f2}, but ${cabName(arriving)} only has ${arriving.fibers}: unlock F2 and pick a free fiber from 1 to ${arriving.fibers}.`) });
      } else if (arriving && f2Problem(p, s, s.f2)) {
        problem(p.id, `${S}: ${f2Problem(p, s, s.f2)}`, "f2-taken",
          { ...sp, go: eqGo(p, s, "f2", `${S}: ${f2Problem(p, s, s.f2)} Unlock F2 and pick a fiber that isn't in use.`) });
      }
      const homes = plan.points.filter((h) => h.type === "nid" && homeSplitter(h) === s);
      const ports = splitterPorts(s);
      if (homes.length > ports) {
        const bigger = SPLITTER_RATIOS.map((r) => splitterPorts({ ratio: r })).find((n) => n >= homes.length);
        const extra = homes.length - ports;
        const move = `move ${extra} home${extra === 1 ? "" : "s"} to another splitter`;
        problem(p.id, `${S} feeds ${homes.length} homes but only has ${ports} ports.`, "splitter-over", {
          equipment: s.id,
          go: eqGo(p, s, "ratio", `${S} feeds ${homes.length} homes but has ${ports} ports: ${bigger ? `pick a splitter with ${bigger} ports, or ${move}` : cap(move)}.`,
            { label: "Move homes instead", open: () => openHomeCounts(p.id, s.id), hint: `Drag ${extra} of the homes on ${eqName(s, p)} onto another splitter's ports.` }),
        });
      }
      // A cascade splitter feeds other splitters instead.
      if (!homes.length && !isCascade(s)) {
        warn(p.id, `${S} doesn't feed any homes.`, "splitter-idle", { equipment: s.id, go: eqGo(p, s, null, `${S} feeds no homes: feed homes from it in Home counts, or Remove it here if it isn't needed.`) });
      }
    }

    // Bigger cable than the one feeding it: allowed, but often a mistake.
    for (const c of out.filter((x) => !x.through)) {
      if (arriving && c.fibers > arriving.fibers && point(c.to).type !== "nid") {
        warn(p.id, `${cap(cabName(c))} (${c.fibers}F) is bigger than ${cabName(arriving)} (${arriving.fibers}F) feeding ${p.name}.`, "cable-bigger", {
          cable: c.id, go: pathGo(c, "size", `${cap(cabName(c))} is ${c.fibers}F, but ${cabName(arriving)} feeding it is ${arriving.fibers}F: pick ${arriving.fibers}F or smaller, unless the extra fibers are on purpose.`),
        });
      }
    }

    if (p.type === "nid") {
      const into = incomingPath(p.id);
      if (!arriving) warn(p.id, `${p.name} has no drop cable yet.`, "home-no-drop",
        { go: into && { open: () => openPath(p.id), target: '[data-field="size"]', hint: `Lay a drop cable to ${p.name}: under Cable, pick New cable and Save.` } });
      const s = homeSplitter(p);
      const sLoc = s && equipmentLocation(s.id);
      const up = into && feedingLocation(into.from);
      const noFeeder = sLoc && caseGo(sLoc, `Splice a free feeder fiber to the input of ${eqName(s, sLoc)} here.`);
      if (!s) {
        warn(p.id, `${p.name} has no splitter feeding it, so it has no F2 count.`, "home-no-splitter", { fix: homeSplitterFix(p),
          go: up && { open: () => openEquipment(up.id, "splitter"), hint: `Add a splitter for ${p.name} at ${up.name} below, or give it a port on a splitter with one free.` } });
      } else if (!s.f2 && s.handOnly) warn(p.id, `${p.name} has no F2 count yet: ${eqName(s, sLoc)} isn't spliced to a feeder fiber.`, "home-no-f2", { equipment: s.id, fix: feederFix(sLoc, s), go: noFeeder });
      else if (!s.f2) problem(p.id, `${p.name} has no F2 count because ${eqName(s, sLoc)} has none.`, "home-no-f2", { equipment: s.id, fix: feederFix(sLoc, s), go: noFeeder });
      // Every port taken: move homes off the splitter, or make it bigger.
      const full = s && sLoc && eqGo(sLoc, s, "ratio", `Every port on ${eqName(s, sLoc)} is taken: move a home to another splitter, or pick a bigger size.`,
        { label: "Move homes instead", open: () => openHomeCounts(sLoc.id, s.id), hint: `Drag a home on ${eqName(s, sLoc)} onto another splitter's ports.` });
      if (p.ds) {
        if (!s || p.ds.splitterId !== s.id) {
          problem(p.id, `${p.name} has a DS count on a splitter that no longer feeds it.`, "ds-stale", {
            fix: {
              text: `Clear the DS count on ${p.name} and hand it back to automatic counts`,
              run: () => {
                delete p.ds;
                p.dsManual = false;
              },
            },
          });
        } else if (p.ds.port > splitterPorts(s)) {
          problem(p.id, `${p.name} is on DS ${p.ds.port}, but ${eqName(s, sLoc)} only has ${splitterPorts(s)} ports.`, "ds-past",
            { equipment: s.id, port: p.ds.port, fix: freePortFix(s, [p]), go: full });
        }
        else {
          const key = s.id + ":" + p.ds.port;
          const sharing = plan.points.filter((h) => h.type === "nid" && h.ds && h.ds.splitterId === s.id && h.ds.port === p.ds.port);
          if (sharing.length > 1 && !clashed.has(key)) {
            clashed.add(key);
            const names = sharing.slice(0, 3).map((h) => h.name).join(", ") + (sharing.length > 3 ? ` and ${sharing.length - 3} more` : "");
            problem(p.id, `${sharing.length} homes are on DS ${p.ds.port} of ${eqName(s, sLoc)}: ${names}.`, "ds-shared",
              { equipment: s.id, port: p.ds.port, homes: sharing.map((h) => h.id), fix: freePortFix(s, sharing.slice(1)), go: full });
          }
        }
      }
    }
  }

  // Duplicate home addresses.
  const seen = new Map();
  for (const h of plan.points.filter((x) => x.type === "nid")) {
    const key = h.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) warn(h.id, `${h.name} is on the route twice.`, "home-twice");
    seen.set(key, h);
  }

  // A fiber picked for two cables. (A pick against an F2 count is
  // reported with the splitter.)
  for (const start of plan.cables.filter((x) => !x.through)) {
    const owner = new Map();
    for (const span of cableSpans(start)) {
      // Picks there are on the cable that feeds it (a tail can end there too).
      const feeds = incomingCable(span.to);
      if (!feeds || cableStart(feeds) !== start) continue;
      for (const d of childCables(span.to).filter((x) => !x.through && x.picks)) {
        for (const pr of expandPicks(d.picks)) {
          if (owner.has(pr.in) && owner.get(pr.in) !== cabName(d)) {
            problem(span.to, `${cap(cabName(start))} #${pr.in} is spliced to both ${owner.get(pr.in)} and ${cabName(d)}.`, "fiber-twice",
              { cable: start.id, fiber: pr.in, go: pathGo(d, "picks", `${cap(cabName(start))} #${pr.in} is also picked for ${owner.get(pr.in)}: pick another fiber for ${cabName(d)}.`) });
          }
          owner.set(pr.in, cabName(d));
        }
      }
    }
  }

  // Cables asked to carry more fibers than they have.
  for (const c of plan.cables.filter((x) => !x.through)) {
    const { overflow } = model.assign(c);
    if (overflow.length) {
      const need = c.fibers + overflow.length;
      const size = CABLE_SIZES.find((n) => n >= need);
      problem(c.from, `${cap(cabName(c))} needs ${need} fibers but only has ${c.fibers}. ` +
        `Not enough for: ${overflow.map((it) => model.describe(it)).join(", ")}.`, "overflow", {
        cable: c.id, go: pathGo(c, "size", `${cap(cabName(c))} needs ${need} fibers but has ${c.fibers}: ${size ? `pick ${size}F` : "feed some of these from another cable"}.`),
      });
    }
  }

  return found;
}

// --- Fixes ---
// Each one is built from what Check found and runs only from the Fix
// button, through the same helpers the editors use (connect,
// putHomeOnPort, the tray slots), so it leaves the plan as if the user
// had made the change by hand.

// Free fibers on the cable arriving at a location: not carrying
// anything and not picked or an F2 anywhere. Each wanted number is taken
// if free, else the lowest free one. Returns as many as there are.
function freeIncoming(model, loc, wanted) {
  const arriving = incomingCable(loc.id);
  if (!arriving) return null;
  const inCable = cableStart(arriving);
  // Every fix in one Check is worked out from the same plan, so each
  // cable's hand-picked fibers are looked up once (a big plan has hundreds),
  // and a fiber one fix takes isn't offered to the next: Fix all can run
  // them together.
  model.fixedIn = model.fixedIn || new Map();
  if (!model.fixedIn.has(inCable.id)) model.fixedIn.set(inCable.id, new Set([...model.assign(inCable).map.keys(), ...fixedInUse(inCable.id).keys()]));
  const used = model.fixedIn.get(inCable.id);
  const take = [];
  for (const w of wanted) {
    let n = w <= inCable.fibers && !used.has(w) ? w : null;
    for (let k = 1; !n && k <= inCable.fibers; k++) if (!used.has(k)) n = k;
    if (!n) break;
    used.add(n);
    take.push(n);
  }
  return { inCable, take };
}

// Splice fibers of cable d leaving p that aren't joined yet: a splitter
// output to its own port, anything else to the next free incoming fiber.
function spliceOpenFix(model, p, d, fibers) {
  const steps = [];
  const plain = [];
  for (const f of fibers) {
    const [kind, sid, port] = f.item.split(":");
    const s = kind === "port" && splittersAt(p).find((x) => x.id === sid);
    if (!s) plain.push(f);
    else if (/^\d+$/.test(port)) steps.push({ from: `split:${sid}:${port}`, to: `fiber:${d.id}:${f.out}`, text: `${eqName(s)} output ${port} to ${cabName(d)} #${f.out}` });
  }
  const free = plain.length && freeIncoming(model, p, plain.map((f) => f.out));
  if (free) {
    free.take.forEach((n, i) => steps.push({ from: `fiber:${free.inCable.id}:${n}`, to: `fiber:${d.id}:${plain[i].out}`, text: `${cabName(d)} #${plain[i].out} to ${cabName(free.inCable)} #${n}` }));
  }
  if (!steps.length) return null;
  const list = steps.slice(0, 4).map((x) => x.text).join(", ") + (steps.length > 4 ? ` and ${steps.length - 4} more` : "");
  return { text: `Splice ${list} at ${p.name}`, uses: free ? free.take.map((n) => `fiber:${free.inCable.id}:${n}`) : [], run: () => { for (const x of steps) connect(p.id, x.from, x.to); } };
}

// Splice a splitter's input to the next free feeder fiber.
function feederFix(loc, s) {
  const c = loc && feederAt(loc.id, s);
  const n = c && nextFreeF2(loc, s);
  if (!n) return null;
  const cable = cableStart(c);
  return {
    text: `Splice ${cabName(cable)} #${n} to the input of ${eqName(s, loc)}, so it's on F2 ${n}`,
    uses: [`cable:${cable.id}`],
    run: () => connect(loc.id, `fiber:${cable.id}:${n}`, `split:${s.id}:in`),
  };
}

// Move homes to the next free ports of a splitter, one after another.
function freePortFix(s, homes) {
  const moves = [];
  const taken = new Set();
  for (const h of homes) {
    const used = usedPorts(s, h.id);
    let port = null;
    for (let n = 1; !port && n <= splitterPorts(s); n++) if (!used.has(n) && !taken.has(n)) port = n;
    if (!port) break;
    taken.add(port);
    moves.push({ h, port });
  }
  if (!moves.length) return null;
  return {
    text: `Move ${moves.map((m) => `${m.h.name} to DS ${m.port}`).join(", ")} of ${eqName(s, equipmentLocation(s.id))}`,
    uses: [`eq:${s.id}`],
    run: () => { for (const m of moves) putHomeOnPort(m.h, s, m.port); },
  };
}

// A home no splitter feeds by itself: put it on the nearest splitter
// upstream that has a free port (one spliced by hand takes homes put on
// it by hand). With none upstream there's nothing to put it on.
function homeSplitterFix(h) {
  const path = incomingPath(h.id);
  let loc = path && feedingLocation(path.from);
  while (loc) {
    for (const s of splittersAt(loc)) {
      const port = nextFreePort(s, h.id);
      if (port) return { text: `Put ${h.name} on ${eqName(s, loc)}, DS ${port}`, uses: [`eq:${s.id}`], run: () => putHomeOnPort(h, s, port) };
    }
    const up = incomingPath(loc.id);
    loc = up && feedingLocation(up.from);
  }
  return null;
}

// Move a splice to the first empty slot in the case, its own tray first.
function reslotFix(L, closure, slots, key, tray) {
  if (!closure) return null;
  const taken = new Set([...slots.values()].map((t) => `${t.tray}/${t.slot}`));
  const order = [tray, ...Array.from({ length: closure.trays }, (_, i) => i + 1)].filter((t) => t && t <= closure.trays);
  for (const t of order) {
    for (let n = 1; n <= closure.slots; n++) {
      if (taken.has(`${t}/${n}`)) continue;
      return {
        text: `Move ${endpointLabel(key)} to tray ${t} slot ${n} at ${L.name}`,
        uses: [`loc:${L.id}`],
        run: () => {
          L.trays = L.trays || {};
          L.trays[key] = { tray: t, slot: n };
        },
      };
    }
  }
  return null;
}

// What to do about findings with no one-click fix (or when the fix
// can't be worked out, e.g. no free fiber left).
const CHECK_HELP = {
  "nothing-leaves": "Tap + on the start card to add the first location and its cable.",
  unassigned: "Open the list to put them on the route.",
  loop: "Open the menu on one of these locations and use Move to feed it from somewhere outside the loop.",
  "ends-shared": "Only one cable can feed a location's splices. End the extra cable somewhere else, or take it off.",
  "dead-end": "Add what's at the end of the cable (a home, splitter or terminal), or take the cable back to where it's needed.",
  phase: "Put the location in the same phase as what feeds it, or a later one.",
  "no-feed": "Lay a cable on the path into this location.",
  "pick-past": "Open the cable from its path and pick fibers that both cables have.",
  "drop-unspliced": "There's no free fiber left on the incoming cable. Use a bigger cable, or free one up in the splice case editor.",
  "open-fibers": "There's no free fiber left on the incoming cable for these. Splice them in the splice case editor.",
  "pick-skipped": "Fine if that's what you meant. Otherwise take the pick off in the splice case editor.",
  "slot-double": "The case has no empty slot left. Add trays or use a bigger case.",
  "slot-past": "The case has more splices than slots. Add trays, use a bigger case, or splice some fibers at another location.",
  "tray-jump": "In the splice case editor, tap a slot and then the slot to move it to, until the whole tube sits in one tray.",
  "case-full": "Use a bigger case or more trays, or splice some fibers at another location.",
  "splitter-no-feeder": "There's no free feeder fiber left. Free one up, or use a bigger cable.",
  "splitter-no-f2": "There's no free feeder fiber left. Free one up, or use a bigger cable.",
  "home-no-f2": "There's no free feeder fiber left for its splitter. Free one up, or use a bigger cable.",
  "f2-past": "Pick another F2 fiber for the splitter in its Equipment dialog.",
  "f2-taken": "Pick another F2 fiber for the splitter in its Equipment dialog.",
  "splitter-over": "Move some homes to another splitter, or use a splitter with more ports.",
  "splitter-idle": "Feed homes from it, or take it out if it isn't needed.",
  "cable-bigger": "Fine if it's on purpose, e.g. room to grow. Otherwise make it smaller from the path.",
  "home-no-drop": "Lay a drop cable on the path to the home.",
  "home-no-splitter": "No splitter upstream has a free port. Add a splitter at a location that feeds this home.",
  "ds-past": "Every port on the splitter is taken. Move a home to another splitter or use a bigger one.",
  "ds-shared": "Every port on the splitter is taken. Move a home to another splitter or use a bigger one.",
  "home-twice": "Remove one, or fix the address if they're two different homes.",
  "fiber-twice": "Open the splice case editor at one of the spots and splice one of them to another fiber.",
  overflow: "Use a bigger cable, or feed some of these from another cable.",
};

// --- On screen ---
// A big plan has hundreds of findings, so the wizard first lists them by
// kind with a count, problems first. Open a kind to step through it one
// at a time. It sits to the side without dimming the route, so Show me
// leaves it open.

// What each kind is called in the list ("212 × fibers not spliced yet").
const CHECK_KINDS = {
  "nothing-leaves": "nothing leaves the start yet",
  unassigned: "homes not on the route yet",
  loop: "cables feeding each other in a loop",
  "ends-shared": "locations where two cables end",
  "dead-end": "dead ends",
  phase: "phases out of order",
  "no-feed": "cables with no feed",
  "pick-past": "fiber picks past the end of a cable",
  "drop-unspliced": "drop fibers not spliced",
  "open-fibers": "fibers not spliced yet",
  "pick-skipped": "fiber picks skipped for a splitter output",
  "xc-removed": "cross-connects to something removed",
  "pin-past": "splitter outputs past the end of a cable",
  "pin-removed": "splices to a removed splitter output",
  "slot-double": "tray slots with two splices",
  "slot-past": "splices past the last tray",
  "tray-jump": "tubes spliced across trays",
  "case-full": "splice cases over capacity",
  "splitter-no-feeder": "splitters not spliced to a feeder yet",
  "splitter-no-f2": "splitters with no F2 count",
  "f2-past": "F2 counts past the end of the cable",
  "f2-taken": "F2 counts already in use",
  "splitter-over": "splitters with more homes than ports",
  "splitter-idle": "splitters that feed no homes",
  "cable-bigger": "cables bigger than their feed",
  "home-no-drop": "homes with no drop cable",
  "home-no-splitter": "homes with no splitter",
  "home-no-f2": "homes with no F2 count",
  "ds-stale": "DS counts on a splitter that doesn't feed the home",
  "ds-past": "DS ports past the end of the splitter",
  "ds-shared": "DS ports shared by two homes",
  "home-twice": "homes on the route twice",
  "fiber-twice": "fibers spliced to two cables",
  overflow: "cables short of fibers",
};

const checkPanel = document.getElementById("check-panel");
let checkFound = [];
let checkGroup = null; // the kind open now, or null for the list of kinds
let checkAt = 0;
let checkFixAll = false; // the Fix all preview is showing
// Where Take me there left the wizard, to come back to when its dialog closes.
let checkBack = null;

function closeCheck() {
  checkPanel.hidden = true;
  checkFixAll = false;
}

registerPanel(checkPanel, closeCheck);

const groupKey = (f) => `${f.level}|${f.code}`;

function sortedFindings() {
  return checkPlan().sort((a, b) => (a.level === b.level ? 0 : a.level === "problem" ? -1 : 1));
}

// Kinds, problems first, then the biggest.
function checkGroups(found) {
  const groups = new Map();
  for (const f of found) {
    const k = groupKey(f);
    if (!groups.has(k)) groups.set(k, { key: k, level: f.level, code: f.code, items: [] });
    groups.get(k).items.push(f);
  }
  return [...groups.values()].sort((a, b) => (a.level !== b.level ? (a.level === "problem" ? -1 : 1) : b.items.length - a.items.length));
}

const findingAbout = (f) => [f.level, f.code, f.where, f.cable, f.fiber, f.equipment, f.port, f.splice, f.xconnect].join("|");

const kindName = (g) => `${g.items.length} × ${CHECK_KINDS[g.code] || g.code}`;

// Open on the finding with this key if it's still there, else in the
// given kind (at about the same place), else on the list of kinds.
function openCheck(key, group = null, at = 0) {
  closeMenu();
  closePanels();
  checkGroup = group;
  refreshCheck(key, at);
  checkPanel.hidden = false;
}

// Look again; stay on the same finding, or the one now in its place.
function refreshCheck(key, at = 0) {
  checkFound = sortedFindings();
  checkFixAll = false;
  const hit = key && checkFound.find((f) => f.key === key);
  if (hit) checkGroup = groupKey(hit);
  const items = groupItems();
  if (!items.length) checkGroup = null;
  const i = hit ? items.indexOf(hit) : -1;
  checkAt = i >= 0 ? i : Math.max(0, Math.min(at, items.length - 1));
  renderCheck();
}

function groupItems() {
  return checkGroup ? checkFound.filter((f) => groupKey(f) === checkGroup) : [];
}

function stepCheck(by) {
  checkAt = Math.max(0, Math.min(checkAt + by, groupItems().length - 1));
  checkFixAll = false;
  renderCheck();
}

function openGroup(key) {
  checkGroup = key;
  checkAt = 0;
  checkFixAll = false;
  renderCheck();
}

function renderCheck() {
  const found = checkFound;
  const problems = found.filter((f) => f.level === "problem").length;
  const warnings = found.length - problems;
  document.getElementById("check-title").textContent = found.length
    ? `${problems} problem${problems === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
    : "No problems found.";
  const items = groupItems();
  const nav = !!checkGroup;
  document.getElementById("check-pos").textContent = nav ? `${checkAt + 1} of ${items.length}` : "";
  document.getElementById("check-back").hidden = !nav;
  document.getElementById("check-next").hidden = !nav;
  document.getElementById("check-back").disabled = checkAt <= 0;
  document.getElementById("check-next").disabled = checkAt >= items.length - 1;
  const step = document.getElementById("check-step");
  step.innerHTML = "";
  if (!found.length) return step.append(el("p", "hint", "Nothing left to fix or look at."));
  if (!checkGroup) return step.append(groupList(checkGroups(found)));

  const g = checkGroups(found).find((x) => x.key === checkGroup);
  const head = el("div", "row check-kind");
  head.append(btnEl("‹ All kinds", () => openGroup(null), "btn ghost"), el("span", `check-kind-name ${g.level}`, kindName(g)));
  step.append(head);
  // The field crew's view-only copy shows what's wrong but changes nothing.
  const edit = !isGuest();
  const fixAll = edit && fixAllBox(g);
  if (fixAll) step.append(fixAll);

  const f = items[checkAt];
  const card = el("div", `check-card ${f.level}`);
  const where = point(f.where);
  card.append(el("div", "check-tag", `${f.level === "problem" ? "Problem" : "Warning"}${where ? ` at ${where.name}` : ""}`), el("p", "check-text", f.text));
  if (f.fix && edit) card.append(el("p", "check-fix", `Fix will: ${f.fix.text}.`));
  else if (CHECK_HELP[f.code]) card.append(el("p", "check-help", CHECK_HELP[f.code]));
  const row = el("div", "row check-actions");
  if (f.fix && edit) row.append(btnEl("Fix", () => runCheckFix(f), "btn big"));
  if (f.go && edit) row.append(btnEl(f.go.label || "Take me there", () => takeMeThere(f, f.go), f.fix ? "btn ghost" : "btn big"));
  row.append(btnEl("Show me", () => revealPoint(f.where), "btn ghost"));
  if (checkAt < items.length - 1) row.append(btnEl("Skip", () => stepCheck(1), "btn ghost"));
  step.append(card, row);
}

// The list of kinds: a count, what it is, Open, and Fix all where it can.
function groupList(groups) {
  const list = el("div", "check-groups");
  for (const g of groups) {
    const row = el("div", `check-group ${g.level}`);
    const fixable = g.items.filter((f) => f.fix).length;
    const text = el("div", "check-group-text");
    text.append(el("span", "check-group-tag", g.level === "problem" ? "Problem" : "Warning"), el("span", "check-group-name", kindName(g)));
    if (fixable && !isGuest()) text.append(el("span", "check-group-sub", fixable === g.items.length ? "One-click fix for each" : `One-click fix for ${fixable}`));
    const open = btnEl("Open", () => openGroup(g.key), "btn ghost");
    row.append(text, open);
    list.append(row);
  }
  return list;
}

// Fix all of this kind: first a preview of how many changes it makes, then
// it runs on the button only (note 15), and one Undo takes them all back.
function fixAllBox(g) {
  const fixable = g.items.filter((f) => f.fix);
  if (fixable.length < 2) return null;
  const box = el("div", "check-fixall");
  if (!checkFixAll) {
    box.append(btnEl(`Fix all of this kind (${fixable.length})`, () => {
      checkFixAll = true;
      renderCheck();
    }, "btn ghost"));
    return box;
  }
  const asks = fixable.some((f) => f.fix.ask);
  box.classList.add("open");
  box.append(el("p", "check-fix", `Fix all makes ${fixable.length} changes. The first: ${fixable[0].fix.text}.`), el("p", "check-help", `${asks ? "This takes connections apart. " : ""}One Undo takes all of them back.` +
    (fixable.length < g.items.length ? ` ${g.items.length - fixable.length} have no one-click fix and stay on the list.` : "")));
  const row = el("div", "row");
  row.append(btnEl(`Fix all ${fixable.length}`, () => runFixAll(g), "btn big"), btnEl("Cancel", () => {
    checkFixAll = false;
    renderCheck();
  }, "btn ghost"));
  box.append(row);
  return box;
}

// Fix runs on the plan as it is now: if it changed since this step was
// shown, the step is shown again with what the fix would do now.
// Taking connections apart asks first (note 12); nothing else does.
function runCheckFix(f) {
  const at = checkAt;
  const group = checkGroup;
  const go = () => {
    const now = sortedFindings().find((x) => x.key === f.key);
    if (now && now.fix && now.fix.text === f.fix.text) {
      withUndo(`${now.fix.text}.`, now.fix.run, () => openCheck(f.key));
    }
    checkGroup = group;
    refreshCheck(null, at);
    checkPanel.hidden = false;
  };
  if (f.fix.ask) confirmBox("Take it apart?", f.fix.ask, "Remove", go);
  else go();
}

// Fixes are worked out again after each round, since one fix can use up
// the free fiber or port another one counted on. In a round, each fix
// takes only what no other fix in that round takes (its `uses`). Fibers
// also reach back through tails to the cable feeding them, so a round
// that turns up a new problem is put back and tried again half as big,
// down to one fix at a time. A single fix that still turns up a new
// problem is put back and left on the list, so Fix all never adds one.
async function runFixAll(g) {
  const go = async () => {
    const before = JSON.stringify(plan);
    const step = document.getElementById("check-step");
    const say = (n) => step.replaceChildren(el("p", "check-fix", `Fixing ${CHECK_KINDS[g.code] || g.code}… ${n} done.`));
    for (const id of ["check-back", "check-next"]) document.getElementById(id).hidden = true;
    say(0);
    await new Promise((r) => setTimeout(r, 30));
    let done = 0;
    let size = Infinity;
    const skip = new Set();
    let all = checkPlan();
    for (let round = 0; round < 500; round++) {
      const now = all.filter((f) => groupKey(f) === g.key && f.fix && !skip.has(f.key));
      if (!now.length) break;
      const taken = new Set();
      const batch = [];
      for (const f of now) {
        const uses = f.fix.uses || [];
        if (batch.length >= size || uses.some((u) => taken.has(u))) continue;
        for (const u of uses) taken.add(u);
        batch.push(f);
      }
      const snap = JSON.stringify(plan);
      // connect() saves after each splice; saved once at the end instead.
      const save = savePlan;
      savePlan = () => {};
      try {
        for (const f of batch) f.fix.run();
      } finally {
        savePlan = save;
      }
      const next = checkPlan();
      // New means a problem about something that had none of that kind,
      // not a count that went up ("123 splices are planned" → 124). New
      // warnings are the next step (a home put on a splitter still needs
      // its drop spliced).
      const had = new Set(all.map(findingAbout));
      const added = next.some((f) => f.level === "problem" && groupKey(f) !== g.key && !had.has(findingAbout(f)));
      if (added) {
        plan = migratePlan(JSON.parse(snap));
        if (batch.length > 1) size = Math.ceil(batch.length / 2);
        else skip.add(batch[0].key);
        all = checkPlan();
        continue;
      }
      const left = next.filter((f) => groupKey(f) === g.key && f.fix && !skip.has(f.key)).length;
      all = next;
      done += batch.length;
      size = batch.length * 2;
      if (left >= now.length) break;
      say(done);
      await new Promise((r) => setTimeout(r));
    }
    if (done) {
      savePlan();
      renderRoute();
      offerUndo(`Fixed ${done} × ${CHECK_KINDS[g.code] || g.code}.${skip.size ? ` ${skip.size} left: fixing ${skip.size === 1 ? "it" : "them"} would cause another problem.` : ""}`, before, () => openCheck(null, g.key));
    }
    else if (skip.size) showNote(`Nothing fixed: fixing ${skip.size === 1 ? "it" : "these"} would cause another problem.`);
    refreshCheck(null, 0);
    checkPanel.hidden = false;
  };
  if (g.items.some((f) => f.fix && f.fix.ask)) {
    const n = g.items.filter((f) => f.fix).length;
    confirmBox("Take them apart?", `${n} connections will be taken apart. One Undo puts them all back.`, "Remove all", go);
  } else go();
}

// --- Take me there ---
// Opens the dialog where the finding is fixed by hand, scrolls to the
// field to change and lights it up, with a banner saying what to do.
// When that dialog closes, the wizard comes back where it was and looks
// again.

function takeMeThere(f, go) {
  checkBack = { key: f.key, group: checkGroup, at: checkAt };
  go.open();
  if (formPanel.hidden) return (checkBack = null);
  const banner = el("div", "check-hint");
  banner.setAttribute("role", "status");
  banner.append(el("span", "check-hint-text", go.hint));
  const btns = el("div", "check-hint-btns");
  if (go.alt) btns.append(btnEl(go.alt.label, () => takeMeThere(f, go.alt), "btn ghost"));
  btns.append(btnEl("Back to Check plan", () => {
    closeForm();
    selectedId = null;
    renderRoute();
  }, "btn ghost"));
  const x = btnEl("×", () => banner.remove(), "check-hint-x");
  x.setAttribute("aria-label", "Close the hint");
  banner.append(btns, x);
  formBody.prepend(banner);
  const target = go.target && formBody.querySelector(go.target);
  if (target) {
    target.classList.add("check-target");
    target.scrollIntoView({ block: "center" });
    if (target.matches("select, input")) target.focus({ preventScroll: true });
  }
}

// The dialog closed (and no other one opened in its place): back to the
// wizard, which looks again.
new MutationObserver(() => {
  if (!checkBack || !formPanel.hidden) return;
  const back = checkBack;
  checkBack = null;
  openCheck(back.key, back.group, back.at);
}).observe(formPanel, { attributes: true, attributeFilter: ["hidden"] });

document.getElementById("check-back").addEventListener("click", () => stepCheck(-1));
document.getElementById("check-next").addEventListener("click", () => stepCheck(1));
document.getElementById("check-plan").addEventListener("click", (e) => {
  e.stopPropagation();
  if (emptyBlocked()) return;
  openCheck();
});
document.getElementById("check-close").addEventListener("click", () => {
  closeCheck();
  selectedId = null;
  renderRoute();
});

// Keep the count on the Check button current as the plan changes.
function updateCheckBadge() {
  const badge = document.getElementById("check-badge");
  const found = checkPlan();
  const problems = found.filter((f) => f.level === "problem").length;
  badge.hidden = !found.length;
  badge.textContent = problems || found.length;
  badge.className = "badge" + (problems ? "" : " warn");
}

const renderRouteOnly = renderRoute;
renderRoute = function () {
  renderRouteOnly();
  updateCheckBadge();
};
