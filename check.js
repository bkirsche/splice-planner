// Troubleshooter: looks over the whole plan for invalid paths and
// mistakes. Problems must be fixed; warnings are worth a second look.

function checkPlan() {
  const found = [];
  const problem = (where, text) => found.push({ level: "problem", where, text });
  const warn = (where, text) => found.push({ level: "warning", where, text });
  const model = buildSpliceModel();
  const start = plan.points[0];
  if (!start) return found;
  if (!plan.paths.length) warn(start.id, `Nothing leaves ${start.name} yet.`);
  if (plan.unassigned.length) {
    warn(start.id, `${plan.unassigned.length} imported home(s) are still on the unassigned list.`);
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
      problem(p.id, `${ends.length} cables end at ${p.name}; only ${arriving.name} feeds its splices.`);
    }

    // Dead ends: a cable runs to a location and stops with nothing there.
    if (p.type !== "nid" && p.id !== start.id && arriving && !childPaths(p.id).length && !splittersAt(p).length &&
      !(p.equipment || []).length) {
      warn(p.id, `${p.name} is a dead end: ${arriving.name} goes nowhere from here.`);
    }

    // Phases: something can't be built before what feeds it.
    if (hasPhases() && p.id !== start.id) {
      const path = incomingPath(p.id);
      const from = path && point(path.from);
      const c = path && pathCable(path);
      if (from && phaseIdx(p) < phaseIdx(from)) {
        warn(p.id, `${p.name} is in ${phaseName(phaseIdx(p))}, but ${from.name} feeding it is in ${phaseName(phaseIdx(from))}.`);
      } else if (c && phaseIdx(p) < phaseIdx(c)) {
        warn(p.id, `${p.name} is in ${phaseName(phaseIdx(p))}, but ${c.name} feeding it is in ${phaseName(phaseIdx(c))}.`);
      }
    }

    // Cables leave, but none arrives to feed them.
    if (p.id !== start.id && !arriving && out.length) {
      problem(p.id, `${out.map((c) => c.name).join(", ")} leave${out.length === 1 ? "s" : ""} ${p.name}, but no cable reaches ${p.name}.`);
    }

    // Fibers picked by hand for cables leaving here.
    for (const d of out.filter((x) => !x.through && x.picks)) {
      const inCable = arriving && cableStart(arriving);
      for (const r of d.picks) {
        if (!inCable) break;
        if (r.inTo > inCable.fibers) problem(p.id, `${d.name} is spliced to ${inCable.name} #${r.inTo}, but ${inCable.name} only has ${inCable.fibers} fibers.`);
        if (r.outFrom + r.inTo - r.inFrom > d.fibers) problem(p.id, `Fibers picked for ${d.name} run past its ${d.fibers} fibers.`);
      }
      for (const f of model.childFibers(d)) {
        const local = splittersAt(p).find((s) => f.item.startsWith(`port:${s.id}:`));
        if (!f.in && !local) {
          problem(p.id, `${d.name} #${f.out} (${model.describe(f.item)}) isn't spliced to anything at ${p.name}. Add it to the fibers picked.`);
        }
        if (f.in && local) {
          warn(p.id, `${d.name} #${f.out} carries ${local.name}'s output to ${model.describe(f.item)}, so the pick from ` +
            `${inCable ? inCable.name : "the incoming cable"} #${f.in} is skipped there.`);
        }
      }
    }

    // Cross-connects to ports or fibers that are gone.
    for (const x of crossConnectsAt(p.id)) {
      if (endpointMissing(x.a) || endpointMissing(x.b)) {
        problem(p.id, `A cross-connect at ${p.name} (${endpointLabel(x.a)} to ${endpointLabel(x.b)}) points at something that was removed.`);
      }
    }

    // Splitter outputs pinned to fibers that no longer exist.
    for (const d of out.filter((x) => !x.through && x.pins)) {
      for (const [n, it] of Object.entries(d.pins)) {
        const [, sid, port] = it.split(":");
        const s = splittersAt(p).find((x) => x.id === sid);
        if (Number(n) > d.fibers) problem(p.id, `A splitter output at ${p.name} is spliced to ${d.name} #${n}, but ${d.name} only has ${d.fibers} fibers.`);
        else if (!s || Number(port) > splitterPorts(s)) problem(p.id, `${d.name} #${n} at ${p.name} is spliced to a splitter output that was removed.`);
      }
    }

    // Two splices in one tray slot, or more slots than the case has.
    const closure = closureAt(p);
    if (closure || Object.keys(p.trays || {}).length) {
      const keys = connectionsAt(model, p.id).filter((c) => c.kind !== "patch").map((c) => c.to);
      const seen = new Map();
      const tubeTrays = new Map();
      for (const [key, ts] of traySlots(p, keys)) {
        const g = tubeGroup(key);
        if (g) {
          if (!tubeTrays.has(g)) tubeTrays.set(g, { key, trays: new Set() });
          tubeTrays.get(g).trays.add(ts.tray);
        }
        const at = `${ts.tray}/${ts.slot}`;
        if (seen.has(at)) problem(p.id, `Tray ${ts.tray} slot ${ts.slot} at ${p.name} holds two splices: ${endpointLabel(seen.get(at))} and ${endpointLabel(key)}.`);
        seen.set(at, key);
        if (closure && (ts.tray > closure.trays || ts.slot > closure.slots)) {
          problem(p.id, `${closure.name} at ${p.name} has ${closure.trays} trays of ${closure.slots}, but a splice is in tray ${ts.tray} slot ${ts.slot}.`);
        }
      }
      // Don't jump trays: one tube's splices belong in one tray.
      for (const { key, trays } of tubeTrays.values()) {
        if (trays.size > 1) {
          problem(p.id, `Tray jump at ${p.name}: the tube holding ${endpointLabel(key)} is spliced across trays ${[...trays].sort((x, y) => x - y).join(", ")}. Keep a tube in one tray.`);
        }
      }
      if (closure && closure.max && keys.length > closure.max) {
        problem(p.id, `${closure.name} at ${p.name} holds at most ${closure.max} splices, but ${keys.length} are planned.`);
      }
    }

    for (const s of splittersAt(p)) {
      if (!s.f2) problem(p.id, `${s.name} at ${p.name} has no F2 count.`);
      else if (arriving && s.f2 > arriving.fibers) {
        problem(p.id, `${s.name} at ${p.name} is on F2 ${s.f2}, but ${arriving.name} only has ${arriving.fibers} fibers.`);
      } else if (arriving && f2Problem(p, s, s.f2)) {
        problem(p.id, `${s.name} at ${p.name}: ${f2Problem(p, s, s.f2)}`);
      }
      const homes = plan.points.filter((h) => h.type === "nid" && homeSplitter(h) === s);
      if (homes.length > splitterPorts(s)) {
        problem(p.id, `${s.name} at ${p.name} feeds ${homes.length} homes but only has ${splitterPorts(s)} ports.`);
      }
      // A cascade splitter feeds other splitters instead.
      if (!homes.length && !isCascade(s)) warn(p.id, `${s.name} at ${p.name} doesn't feed any homes.`);
    }

    // Bigger cable than the one feeding it: allowed, but often a mistake.
    for (const c of out.filter((x) => !x.through)) {
      if (arriving && c.fibers > arriving.fibers && point(c.to).type !== "nid") {
        warn(p.id, `${c.name} (${c.fibers}F) is bigger than ${arriving.name} (${arriving.fibers}F) feeding ${p.name}.`);
      }
    }

    if (p.type === "nid") {
      if (!arriving) warn(p.id, `${p.name} has no drop cable yet.`);
      const s = homeSplitter(p);
      if (!s) warn(p.id, `${p.name} has no splitter feeding it, so it has no F2 count.`);
      else if (!s.f2) problem(p.id, `${p.name} has no F2 count because ${s.name} has none.`);
      if (p.ds) {
        if (!s || p.ds.splitterId !== s.id) problem(p.id, `${p.name} has a DS count on a splitter that no longer feeds it.`);
        else if (p.ds.port > splitterPorts(s)) problem(p.id, `${p.name} is on DS ${p.ds.port}, but ${s.name} only has ${splitterPorts(s)} ports.`);
        else {
          const key = s.id + ":" + p.ds.port;
          const sharing = plan.points.filter((h) => h.type === "nid" && h.ds && h.ds.splitterId === s.id && h.ds.port === p.ds.port);
          if (sharing.length > 1 && !clashed.has(key)) {
            clashed.add(key);
            const names = sharing.slice(0, 3).map((h) => h.name).join(", ") + (sharing.length > 3 ? ` and ${sharing.length - 3} more` : "");
            problem(p.id, `${sharing.length} homes are on DS ${p.ds.port} of ${s.name}: ${names}.`);
          }
        }
      }
    }
  }

  // Duplicate home addresses.
  const seen = new Map();
  for (const h of plan.points.filter((x) => x.type === "nid")) {
    const key = h.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) warn(h.id, `${h.name} is on the route twice.`);
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
            problem(span.to, `${start.name} #${pr.in} is spliced to both ${owner.get(pr.in)} and ${d.name}.`);
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
        `Not enough for: ${overflow.map((it) => model.describe(it)).join(", ")}.`);
    }
  }

  return found;
}

// --- On screen ---

const checkPanel = document.getElementById("check-panel");

function closeCheck() {
  checkPanel.hidden = true;
}

registerPanel(checkPanel, closeCheck);

function openCheck() {
  closeMenu();
  closePanels();
  const found = checkPlan();
  const problems = found.filter((f) => f.level === "problem").length;
  const warnings = found.length - problems;
  document.getElementById("check-title").textContent = found.length
    ? `${problems} problem${problems === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
    : "No problems found.";
  const list = document.getElementById("check-list");
  list.innerHTML = "";
  for (const f of found.sort((a, b) => (a.level === b.level ? 0 : a.level === "problem" ? -1 : 1))) {
    const li = document.createElement("li");
    li.className = f.level;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${f.level === "problem" ? "Problem" : "Warning"}: ${f.text}`;
    b.title = "Show it on the route";
    b.addEventListener("click", () => {
      closeCheck();
      selectedId = f.where;
      renderRoute();
      const el = document.querySelector(".stop.selected");
      if (el) centerOn(el);
    });
    li.append(b);
    list.append(li);
  }
  checkPanel.hidden = false;
}

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

