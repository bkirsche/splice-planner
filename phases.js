// Project title and phases.
//
// A job can be built and spliced in phases: Phase 1 now, Phase 2 months
// later. plan.phases lists them in order ([{ id, name }]) and every
// location, cable, piece of equipment and patch carries the id of the
// phase it belongs to (anything untagged is Phase 1). plan.phase is the
// phase on screen: the route hides later phases and greys earlier ones,
// splice sheets mark what came from an earlier phase as existing, and new
// work is tagged with it. "all" (or nothing) shows every phase, and new
// work goes in the last one.

function hasPhases() {
  return !!plan && Array.isArray(plan.phases) && plan.phases.length > 1;
}

function phaseIdx(obj) {
  if (!hasPhases() || !obj || !obj.phase) return 0;
  const i = plan.phases.findIndex((x) => x.id === obj.phase);
  return i < 0 ? 0 : i;
}

// Index of the phase on screen, or null for all of them.
function viewIdx() {
  if (!hasPhases() || !plan.phase || plan.phase === "all") return null;
  const i = plan.phases.findIndex((x) => x.id === plan.phase);
  return i < 0 ? null : i;
}

function phaseName(i) {
  return hasPhases() && plan.phases[i] ? plan.phases[i].name : "";
}

function phaseShown(obj) {
  const v = viewIdx();
  return v === null || phaseIdx(obj) <= v;
}

function phasePast(obj) {
  const v = viewIdx();
  return v !== null && phaseIdx(obj) < v;
}

// Child paths whose location is in a phase on screen.
function shownPaths(id) {
  return childPaths(id).filter((x) => phaseShown(point(x.to)));
}

function everyTaggable(fn) {
  for (const p of plan.points) {
    fn(p);
    for (const e of p.equipment || []) fn(e);
  }
  for (const c of plan.cables) fn(c);
  for (const x of plan.xconnects) fn(x);
}

// New work goes in the phase on screen (or the last one).
function tagPhases() {
  if (!hasPhases()) return;
  const v = viewIdx();
  const id = plan.phases[v === null ? plan.phases.length - 1 : v].id;
  everyTaggable((o) => {
    if (!o.phase) o.phase = id;
  });
}

function addPhase() {
  if (!Array.isArray(plan.phases) || !plan.phases.length) {
    plan.phases = [{ id: makeId(), name: "Phase 1" }];
    // Everything already drawn is Phase 1.
    everyTaggable((o) => (o.phase = plan.phases[0].id));
  }
  const ph = { id: makeId(), name: `Phase ${plan.phases.length + 1}` };
  plan.phases.push(ph);
  plan.phase = ph.id;
  return ph;
}

// A phase select for a form, or null without phases.
// Something new starts in the phase on screen (or the last one).
function phaseSelect(obj) {
  if (!hasPhases()) return null;
  const v = viewIdx();
  const i = obj ? phaseIdx(obj) : v === null ? plan.phases.length - 1 : v;
  return selectEl(plan.phases.map((x) => ({ value: x.id, label: x.name })), plan.phases[i].id);
}

// --- Header: project title and phase ---

const titleBtn = document.getElementById("project-title");
const phasePick = document.getElementById("phase-pick");
const fromChip = document.getElementById("from-chip");

function renderHeader() {
  if (!plan) return;
  titleBtn.textContent = plan.title || "Untitled project";
  titleBtn.classList.toggle("untitled", !plan.title);
  document.title = plan.title ? `${plan.title} · Splice Planner` : "Splice Planner";
  const opts = [];
  if (hasPhases()) {
    opts.push({ value: "all", label: "All phases" });
    for (const x of plan.phases) opts.push({ value: x.id, label: x.name });
  } else {
    opts.push({ value: "all", label: "One phase" });
  }
  if (!isGuest()) opts.push({ value: "+", label: "+ Add a phase" });
  phasePick.replaceChildren(...selectEl(opts).childNodes);
  phasePick.value = viewIdx() === null ? "all" : plan.phase;
  phasePick.hidden = isGuest() && !hasPhases();
  const from = plan.receivedFrom;
  fromChip.hidden = !from;
  if (from) fromChip.textContent = `From ${from.by}${from.at ? `, ${shortDate(from.at)}` : ""}`;
  fromChip.title = authorLine();
}

phasePick.addEventListener("change", () => {
  if (phasePick.value === "+") {
    const before = JSON.stringify(plan);
    const ph = addPhase();
    savePlan();
    renderRoute();
    offerUndo(`Added ${ph.name}. New work now goes in ${ph.name}; earlier work shows as existing.`, before);
    return;
  }
  plan.phase = phasePick.value;
  savePlan();
  closePanels();
  renderRoute();
});

titleBtn.addEventListener("click", openProject);

// Title and phase names.
function openProject() {
  if (isGuest()) {
    return openForm("Project", (body, foot) => {
      body.append(el("p", "cable-annotation", plan.title || "Untitled project"), el("p", "hint", authorLine() || "No names on this plan yet."));
      foot.append(btnEl("Close", finish, "btn big"));
    });
  }
  openForm("Project", (body, foot) => {
    const who = authorLine();
    if (who) body.append(el("p", "hint", who + (plan.receivedFrom ? `. Received from ${plan.receivedFrom.by}.` : ".")));
    const title = inputEl("text", plan.title || "", { placeholder: "e.g. Pine Ridge FTTH" });
    body.append(fieldEl("Project title", title, "Shown at the top and on every printed sheet."));
    const names = [];
    if (hasPhases()) {
      body.append(el("h4", "form-section", "Phases"));
      for (const ph of plan.phases) {
        const n = inputEl("text", ph.name);
        names.push([ph, n]);
        body.append(fieldEl(`Phase ${plan.phases.indexOf(ph) + 1} name`, n));
      }
    } else {
      body.append(el("p", "hint", "Building in phases? Pick “+ Add a phase” at the top. What's drawn now becomes Phase 1."));
    }
    formButtons(foot, () => {
      const t = title.value.trim();
      if (t) plan.title = t;
      else delete plan.title;
      for (const [ph, n] of names) if (n.value.trim()) ph.name = n.value.trim();
      finish();
    });
  });
}

// Move one location to another phase.
function openPhaseForm(id) {
  const p = point(id);
  openForm(`Phase for ${p.name}`, (body, foot) => {
    const sel = phaseSelect(p);
    sel.dataset.field = "phase";
    body.append(fieldEl("Phase", sel, "Only this location moves. Its cables and equipment keep their own phase."));
    formButtons(foot, () => {
      p.phase = sel.value;
      finish();
    });
  });
}

// One small tag for cards and lines.
function phaseChip(obj) {
  if (!hasPhases()) return null;
  const i = phaseIdx(obj);
  const chip = el("span", "chip phase", `P${i + 1}`);
  chip.title = phaseName(i);
  return chip;
}
