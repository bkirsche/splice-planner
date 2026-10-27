// Fiber trace: follow a home's fiber back to the start, splice by
// splice, so anyone can check the path is right (on top of Check plan).
// Each hop is a cable fiber (with its tube and color), the splice that
// feeds it and any splitter on the way. A break says where it stops.

// "Blue tube, Slate" (no tube on a one-tube cable).
function traceColors(c, n) {
  const f = colorCode(c.fibers)[n - 1];
  return tubeCount(c.fibers) > 1 ? `${f.tubeColor.name} tube, ${f.fiberColor.name}` : f.fiberColor.name;
}

// Hops from the start down to the home: [{ kind, text, colors, at }].
function traceHome(model, home) {
  const drop = plan.cables.find((c) => c.to === home.id);
  if (!drop) return { hops: [], end: `No cable reaches ${home.name}.`, ok: false };
  let cable = cableStart(drop);
  let n = null;
  const item = homeItem(home);
  for (const [k, it] of model.assign(cable).map) if (it === item) n = k;
  if (n === null) return { hops: [], end: `${home.name} has no fiber on ${cable.name}.`, ok: false };
  const hops = [];
  const seen = new Set();
  for (;;) {
    if (seen.has(`${cable.id}:${n}`)) return { hops, end: "The path loops back on itself.", ok: false };
    seen.add(`${cable.id}:${n}`);
    const via = cableSpans(cable).slice(0, -1).map((s) => point(s.to).name);
    hops.unshift({ kind: "fiber", text: `${cable.name} #${n}`, colors: traceColors(cable, n),
      at: `${point(cable.from).name} → ${point(cableSpans(cable).at(-1).to).name}${via.length ? ` (through ${via.join(", ")})` : ""}` });
    const L = point(cable.from);
    const rows = model.rowsAt(L.id).rows;
    const row = rows.find((r) => r.dst && r.dst.kind === "cable" && r.dst.id === cable.id && r.dst.n === n);
    if (!row) return { hops, end: `${cable.name} #${n} isn't spliced to anything at ${L.name}.`, ok: L.id === plan.points[0].id };
    let src = row.src;
    if (src && src.kind === "split") {
      const s = splittersAt(L).find((x) => x.id === src.id);
      hops.unshift({ kind: "split", text: `${s ? eqLabel(s) : "Splitter"} at ${L.name}`, colors: row.from.text.replace(/^.* output/, "output"), at: L.name });
      const inRow = rows.find((r) => r.dst && r.dst.kind === "split" && r.dst.id === src.id);
      if (!inRow || !inRow.src) {
        const top = L.id === plan.points[0].id;
        return { hops, end: top ? `Splitter input at the start (${L.name}).` : `Nothing feeds ${s ? eqLabel(s) : "the splitter"} at ${L.name}.`, ok: top };
      }
      src = inRow.src;
    } else if (src) {
      hops.unshift({ kind: "splice", text: `Spliced at ${L.name}`, colors: "", at: L.name });
    }
    if (!src) {
      // At the start a fiber may be patched to the OLT; elsewhere it's a break.
      const top = L.id === plan.points[0].id;
      return { hops, end: top ? row.from.text : `${row.from.text} at ${L.name}.`, ok: top && !row.from.missing };
    }
    const up = incomingCable(L.id);
    if (!up) return { hops, end: `No cable reaches ${L.name}.`, ok: false };
    cable = cableStart(up);
    n = src.n;
  }
}

// The trace panel: pick a home, see its path; or trace every home and
// list the ones that don't make it back to the start.
function openTrace(homeId) {
  const model = buildSpliceModel();
  const homes = sortHomes(plan.points.filter((p) => p.type === "nid"));
  if (!homes.length) return showNote("Add homes first: a trace runs from a home back to the start.");
  closeMenu();
  openForm("Trace a fiber", (body, foot) => {
    const pick = selectEl(homes.map((h) => ({ value: h.id, label: h.name })), homeId || homes[0].id);
    const out = el("div", "trace-out");
    const show = () => {
      const h = point(pick.value);
      const t = traceHome(model, h);
      const list = el("ol", "trace-list");
      if (t.ok) list.append(el("li", "trace-start", `Start: ${plan.points[0].name}`));
      for (const hop of t.hops) {
        const li = el("li", `trace-${hop.kind}`);
        li.append(el("b", "", hop.text));
        if (hop.colors) li.append(document.createTextNode(` · ${hop.colors}`));
        if (hop.kind === "fiber") li.append(el("div", "hint", hop.at));
        list.append(li);
      }
      list.append(el("li", "trace-end", `Home: ${h.name}`));
      out.replaceChildren(el("p", t.ok ? "trace-ok" : "warn", t.ok ? `✓ Connected: ${t.end}` : `✗ Break: ${t.end}`), list);
    };
    pick.addEventListener("change", show);
    body.append(fieldEl("Home", pick), out);
    show();

    const all = el("div");
    foot.append(btnEl("Trace every home", () => {
      const bad = homes.map((h) => ({ h, t: traceHome(model, h) })).filter((x) => !x.t.ok);
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
