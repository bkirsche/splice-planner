// Troubleshooter: looks over the whole plan for invalid paths and
// mistakes. Problems must be fixed; warnings are worth a second look.
//
// Each finding: { level, where, text, code, key, ...what it's about,
// fix? }. `code` says what kind of finding it is; `key` tells one finding
// from another across reruns. A fix is { text, run, ask? }: text says
// exactly what it changes, run makes the change (only from the Fix
// button, never on its own), and ask is the question asked first when
// it takes connections apart.

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
    warn(start.id, `${plan.unassigned.length} imported home(s) are still on the unassigned list.`, "unassigned");
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
      problem(p.id, `${ends.length} cables end at ${p.name}; only ${arriving.name} feeds its splices.`, "ends-shared");
    }

    // Dead ends: a cable runs to a location and stops with nothing there.
    if (p.type !== "nid" && p.id !== start.id && arriving && !childPaths(p.id).length && !splittersAt(p).length &&
      !(p.equipment || []).length) {
      warn(p.id, `${p.name} is a dead end: ${arriving.name} goes nowhere from here.`, "dead-end");
    }

    // Phases: something can't be built before what feeds it.
    if (hasPhases() && p.id !== start.id) {
      const path = incomingPath(p.id);
      const from = path && point(path.from);
      const c = path && pathCable(path);
      if (from && phaseIdx(p) < phaseIdx(from)) {
        warn(p.id, `${p.name} is in ${phaseName(phaseIdx(p))}, but ${from.name} feeding it is in ${phaseName(phaseIdx(from))}.`, "phase");
      } else if (c && phaseIdx(p) < phaseIdx(c)) {
        warn(p.id, `${p.name} is in ${phaseName(phaseIdx(p))}, but ${c.name} feeding it is in ${phaseName(phaseIdx(c))}.`, "phase");
      }
    }

    // Cables leave, but none arrives to feed them.
    if (p.id !== start.id && !arriving && out.length) {
      problem(p.id, `${out.map((c) => c.name).join(", ")} leave${out.length === 1 ? "s" : ""} ${p.name}, but no cable reaches ${p.name}.`, "no-feed");
    }

    // Fibers picked by hand for cables leaving here.
    for (const d of out.filter((x) => !x.through && x.picks)) {
      const inCable = arriving && cableStart(arriving);
      for (const r of d.picks) {
        if (!inCable) break;
        if (r.inTo > inCable.fibers) problem(p.id, `${d.name} is spliced to ${inCable.name} #${r.inTo}, but ${inCable.name} only has ${inCable.fibers} fibers.`, "pick-past", { cable: d.id });
        if (r.outFrom + r.inTo - r.inFrom > d.fibers) problem(p.id, `Fibers picked for ${d.name} run past its ${d.fibers} fibers.`, "pick-past", { cable: d.id });
      }
      // Placed to be spliced by hand: fibers not joined yet are work to
      // do, not a mistake. One note per cable.
      if (d.handOnly) {
        const open = model.childFibers(d).filter((f) => {
          const local = splittersAt(p).some((s) => f.item.startsWith(`port:${s.id}:`));
          return local ? (d.pins || {})[f.out] !== f.item : !f.in;
        });
        if (open.length) {
          warn(p.id, `${d.name} has ${open.length} fiber${open.length === 1 ? "" : "s"} not spliced yet at ${p.name} ` +
            `(${open.slice(0, 4).map((f) => `#${f.out} ${model.describe(f.item)}`).join(", ")}${open.length > 4 ? ", …" : ""}).`,
          "open-fibers", { cable: d.id, fibers: open.map((f) => f.out), fix: spliceOpenFix(model, p, d, open) });
        }
        continue;
      }
      for (const f of model.childFibers(d)) {
        const local = splittersAt(p).find((s) => f.item.startsWith(`port:${s.id}:`));
        if (!f.in && !local) {
          problem(p.id, `${d.name} #${f.out} (${model.describe(f.item)}) isn't spliced to anything at ${p.name}. Add it to the fibers picked.`,
            "drop-unspliced", { cable: d.id, fiber: f.out, fix: spliceOpenFix(model, p, d, [f]) });
        }
        if (f.in && local) {
          warn(p.id, `${d.name} #${f.out} carries ${local.name}'s output to ${model.describe(f.item)}, so the pick from ` +
            `${inCable ? inCable.name : "the incoming cable"} #${f.in} is skipped there.`, "pick-skipped", { cable: d.id, fiber: f.out });
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
          text: `Take the splice to ${d.name} #${n} off at ${p.name}`,
          ask: `The splice from ${s ? `${eqLabel(s)} output ${port}` : "the removed splitter output"} to ${d.name} #${n} at ${p.name} will be taken apart. You can Undo it right after.`,
          run: () => delete d.pins[n],
        };
        if (Number(n) > d.fibers) {
          problem(p.id, `A splitter output at ${p.name} is spliced to ${d.name} #${n}, but ${d.name} only has ${d.fibers} fibers.`, "pin-past", { cable: d.id, fiber: Number(n), fix: unpin });
        } else if (!s || Number(port) > splitterPorts(s)) {
          problem(p.id, `${d.name} #${n} at ${p.name} is spliced to a splitter output that was removed.`, "pin-removed", { cable: d.id, fiber: Number(n), fix: unpin });
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
            "slot-double", { splice: key, tray: ts.tray, slot: ts.slot, fix: reslotFix(p, closure, slots, key, ts.tray) });
        }
        seen.set(at, key);
        if (closure && (ts.tray > closure.trays || ts.slot > closure.slots)) {
          // Only a slot set by hand can move; the app's own slots run
          // past the end only when the case is full.
          problem(p.id, `${eqLabel(closure)} at ${p.name} has ${closure.trays} trays of ${closure.slots}, but a splice is in tray ${ts.tray} slot ${ts.slot}.`,
            "slot-past", { splice: key, tray: ts.tray, slot: ts.slot, fix: (p.trays || {})[key] ? reslotFix(p, closure, slots, key) : null });
        }
      }
      // Don't jump trays: one tube's splices belong in one tray.
      for (const { key, trays } of tubeTrays.values()) {
        if (trays.size > 1) {
          problem(p.id, `Tray jump at ${p.name}: the tube holding ${endpointLabel(key)} is spliced across trays ${[...trays].sort((x, y) => x - y).join(", ")}. Keep a tube in one tray.`, "tray-jump", { splice: key });
        }
      }
      if (closure && closure.max && keys.length > closure.max) {
        problem(p.id, `${eqLabel(closure)} at ${p.name} holds at most ${closure.max} splices, but ${keys.length} are planned.`, "case-full", { equipment: closure.id });
      }
    }

    for (const s of splittersAt(p)) {
      const sp = { equipment: s.id };
      if (!s.f2 && s.handOnly) warn(p.id, `${eqLabel(s)} at ${p.name} isn't spliced to a feeder fiber yet.`, "splitter-no-feeder", { ...sp, fix: feederFix(p, s) });
      else if (!s.f2) problem(p.id, `${eqLabel(s)} at ${p.name} has no F2 count.`, "splitter-no-f2", { ...sp, fix: feederFix(p, s) });
      else if (arriving && s.f2 > arriving.fibers) {
        problem(p.id, `${eqLabel(s)} at ${p.name} is on F2 ${s.f2}, but ${arriving.name} only has ${arriving.fibers} fibers.`, "f2-past", sp);
      } else if (arriving && f2Problem(p, s, s.f2)) {
        problem(p.id, `${eqLabel(s)} at ${p.name}: ${f2Problem(p, s, s.f2)}`, "f2-taken", sp);
      }
      const homes = plan.points.filter((h) => h.type === "nid" && homeSplitter(h) === s);
      if (homes.length > splitterPorts(s)) {
        problem(p.id, `${eqLabel(s)} at ${p.name} feeds ${homes.length} homes but only has ${splitterPorts(s)} ports.`, "splitter-over", { equipment: s.id });
      }
      // A cascade splitter feeds other splitters instead.
      if (!homes.length && !isCascade(s)) warn(p.id, `${eqLabel(s)} at ${p.name} doesn't feed any homes.`, "splitter-idle", { equipment: s.id });
    }

    // Bigger cable than the one feeding it: allowed, but often a mistake.
    for (const c of out.filter((x) => !x.through)) {
      if (arriving && c.fibers > arriving.fibers && point(c.to).type !== "nid") {
        warn(p.id, `${c.name} (${c.fibers}F) is bigger than ${arriving.name} (${arriving.fibers}F) feeding ${p.name}.`, "cable-bigger", { cable: c.id });
      }
    }

    if (p.type === "nid") {
      if (!arriving) warn(p.id, `${p.name} has no drop cable yet.`, "home-no-drop");
      const s = homeSplitter(p);
      const sLoc = s && equipmentLocation(s.id);
      if (!s) warn(p.id, `${p.name} has no splitter feeding it, so it has no F2 count.`, "home-no-splitter", { fix: homeSplitterFix(p) });
      else if (!s.f2 && s.handOnly) warn(p.id, `${p.name} has no F2 count yet: ${eqLabel(s)} isn't spliced to a feeder fiber.`, "home-no-f2", { equipment: s.id, fix: feederFix(sLoc, s) });
      else if (!s.f2) problem(p.id, `${p.name} has no F2 count because ${eqLabel(s)} has none.`, "home-no-f2", { equipment: s.id, fix: feederFix(sLoc, s) });
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
          problem(p.id, `${p.name} is on DS ${p.ds.port}, but ${eqLabel(s)} only has ${splitterPorts(s)} ports.`, "ds-past",
            { equipment: s.id, port: p.ds.port, fix: freePortFix(s, [p]) });
        }
        else {
          const key = s.id + ":" + p.ds.port;
          const sharing = plan.points.filter((h) => h.type === "nid" && h.ds && h.ds.splitterId === s.id && h.ds.port === p.ds.port);
          if (sharing.length > 1 && !clashed.has(key)) {
            clashed.add(key);
            const names = sharing.slice(0, 3).map((h) => h.name).join(", ") + (sharing.length > 3 ? ` and ${sharing.length - 3} more` : "");
            problem(p.id, `${sharing.length} homes are on DS ${p.ds.port} of ${eqLabel(s)}: ${names}.`, "ds-shared",
              { equipment: s.id, port: p.ds.port, homes: sharing.map((h) => h.id), fix: freePortFix(s, sharing.slice(1)) });
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
      for (const d of childCables(span.to).filter((x) => !x.through && x.picks)) {
        for (const pr of expandPicks(d.picks)) {
          if (owner.has(pr.in) && owner.get(pr.in) !== d.name) {
            problem(span.to, `${start.name} #${pr.in} is spliced to both ${owner.get(pr.in)} and ${d.name}.`, "fiber-twice", { cable: start.id, fiber: pr.in });
          }
          owner.set(pr.in, d.name);
        }
      }
    }
  }

  // Cables asked to carry more fibers than they have.
  for (const c of plan.cables.filter((x) => !x.through)) {
    const { overflow } = model.assign(c);
    if (overflow.length) {
      problem(c.from, `${c.name} needs ${c.fibers + overflow.length} fibers but only has ${c.fibers}. ` +
        `Not enough for: ${overflow.map((it) => model.describe(it)).join(", ")}.`, "overflow", { cable: c.id });
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
  const used = new Set([...model.assign(inCable).map.keys(), ...fixedInUse(inCable.id).keys()]);
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
    else if (/^\d+$/.test(port)) steps.push({ from: `split:${sid}:${port}`, to: `fiber:${d.id}:${f.out}`, text: `${eqLabel(s)} output ${port} to ${d.name} #${f.out}` });
  }
  const free = plain.length && freeIncoming(model, p, plain.map((f) => f.out));
  if (free) {
    free.take.forEach((n, i) => steps.push({ from: `fiber:${free.inCable.id}:${n}`, to: `fiber:${d.id}:${plain[i].out}`, text: `${d.name} #${plain[i].out} to ${free.inCable.name} #${n}` }));
  }
  if (!steps.length) return null;
  const list = steps.slice(0, 4).map((x) => x.text).join(", ") + (steps.length > 4 ? ` and ${steps.length - 4} more` : "");
  return { text: `Splice ${list} at ${p.name}`, run: () => { for (const x of steps) connect(p.id, x.from, x.to); } };
}

// Splice a splitter's input to the next free feeder fiber.
function feederFix(loc, s) {
  const c = loc && feederAt(loc.id, s);
  const n = c && nextFreeF2(loc, s);
  if (!n) return null;
  const cable = cableStart(c);
  return {
    text: `Splice ${cable.name} #${n} to the ${eqLabel(s)} input at ${loc.name}, so it's on F2 ${n}`,
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
    text: `Move ${moves.map((m) => `${m.h.name} to DS ${m.port}`).join(", ")} of ${eqLabel(s)}`,
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
      if (port) return { text: `Put ${h.name} on ${eqLabel(s)} at ${loc.name}, DS ${port}`, run: () => putHomeOnPort(h, s, port) };
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
// A step-through wizard: one finding at a time, problems first. It sits
// to the side without dimming the route, so Show me leaves it open.

const checkPanel = document.getElementById("check-panel");
let checkFound = [];
let checkAt = 0;

function closeCheck() {
  checkPanel.hidden = true;
}

registerPanel(checkPanel, closeCheck);

function sortedFindings() {
  return checkPlan().sort((a, b) => (a.level === b.level ? 0 : a.level === "problem" ? -1 : 1));
}

// Open on the finding with this key if it's still there.
function openCheck(key) {
  closeMenu();
  closePanels();
  refreshCheck(key);
  checkPanel.hidden = false;
}

// Look again; stay on the same finding, or the one now in its place.
function refreshCheck(key, at = 0) {
  checkFound = sortedFindings();
  const i = key ? checkFound.findIndex((f) => f.key === key) : -1;
  checkAt = i >= 0 ? i : Math.max(0, Math.min(at, checkFound.length - 1));
  renderCheck();
}

function stepCheck(by) {
  checkAt = Math.max(0, Math.min(checkAt + by, checkFound.length - 1));
  renderCheck();
}

function renderCheck() {
  const found = checkFound;
  const problems = found.filter((f) => f.level === "problem").length;
  const warnings = found.length - problems;
  document.getElementById("check-title").textContent = found.length
    ? `${problems} problem${problems === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
    : "No problems found.";
  document.getElementById("check-pos").textContent = found.length ? `${checkAt + 1} of ${found.length}` : "";
  document.getElementById("check-back").disabled = checkAt <= 0;
  document.getElementById("check-next").disabled = checkAt >= found.length - 1;
  const step = document.getElementById("check-step");
  step.innerHTML = "";
  const f = found[checkAt];
  if (!f) return step.append(el("p", "hint", "Nothing left to fix or look at."));
  const card = el("div", `check-card ${f.level}`);
  const where = point(f.where);
  card.append(el("div", "check-tag", `${f.level === "problem" ? "Problem" : "Warning"}${where ? ` at ${where.name}` : ""}`), el("p", "check-text", f.text));
  if (f.fix) card.append(el("p", "check-fix", `Fix will: ${f.fix.text}.`));
  else if (CHECK_HELP[f.code]) card.append(el("p", "check-help", CHECK_HELP[f.code]));
  const row = el("div", "row check-actions");
  if (f.fix) row.append(btnEl("Fix", () => runCheckFix(f), "btn big"));
  if (f.code === "unassigned") row.append(btnEl("Open the list", () => openAssign(plan.points[0].id), "btn big"));
  row.append(btnEl("Show me", () => revealPoint(f.where), "btn ghost"));
  if (checkAt < found.length - 1) row.append(btnEl("Skip", () => stepCheck(1), "btn ghost"));
  step.append(card, row);
}

// Fix runs on the plan as it is now: if it changed since this step was
// shown, the step is shown again with what the fix would do now.
// Taking connections apart asks first (note 12); nothing else does.
function runCheckFix(f) {
  const at = checkAt;
  const go = () => {
    const now = sortedFindings().find((x) => x.key === f.key);
    if (now && now.fix && now.fix.text === f.fix.text) {
      withUndo(`${now.fix.text}.`, now.fix.run, () => openCheck(f.key));
    }
    refreshCheck(null, at);
    checkPanel.hidden = false;
  };
  if (f.fix.ask) confirmBox("Take it apart?", f.fix.ask, "Remove", go);
  else go();
}

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

