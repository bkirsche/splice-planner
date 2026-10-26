// Equipment at a location, from the stock templates in catalog.js:
// OLT shelves, patch panels, splice cases, terminals and splitters
// (several at a time, each on its own F2), plus anything else. Which
// kinds are offered depends on the location type. Also each location's
// details.

// Ports on a card-based item (shelf, panel, terminal).
function cardPorts(eq) {
  return (eq.cards || []).reduce((n, c) => n + c.ports.length, 0);
}

function hasCards(eq) {
  return Array.isArray(eq.cards);
}

// --- Tails ---
// A clamshell splitter, or a terminal in a pedestal, comes with its tail
// pre-attached, run back to where it's spliced: the location feeding it,
// or one further back, passing through the ones between. The tail is a
// cable of its own (kind "splitter-tail" or "terminal-tail") with its
// length in tailFt on its first span; eq.tail points at that span. At
// the first location (no path in) the length waits in eq.tailFt.

function tailKind(loc, eq) {
  if (eq.type === "splitter" && TEMPLATES.some((t) => t.tails && t.style === eq.style)) return "splitter-tail";
  if (eq.type === "terminal" && loc.type === "pedestal") return "terminal-tail";
  return null;
}

function tailCable(eq) {
  const c = eq.tail && plan.cables.find((x) => x.id === eq.tail);
  return c && cableKind(c) !== "cable" ? c : null;
}

function tailFeet(eq) {
  const c = tailCable(eq);
  return c ? c.tailFt || null : eq.tailFt || null;
}

// Where a tail fed from fromId can start: there, then on back up the route.
function tailStarts(fromId) {
  const out = [];
  for (let id = fromId; id && !out.includes(id); id = (incomingPath(id) || {}).from) out.push(id);
  return out;
}

// "Tail starts at": shown when there's more than one place to start.
// Returns { el, value() } with the location id.
function tailStartField(fromId, current) {
  const ids = fromId ? tailStarts(fromId) : [];
  const pick = selectEl(ids.map((id, i) => ({ value: id,
    label: i ? `${point(id).name}, through ${ids.slice(0, i).reverse().map((x) => point(x).name).join(", ")}` : point(id).name })),
    ids.includes(current) ? current : ids[0]);
  const box = fieldEl("Tail starts at", pick);
  box.hidden = ids.length < 2;
  return { el: box, value: () => pick.value || null };
}

// Sets the tail's length and where it starts (where it starts now, or
// the location feeding loc), drawing it along the paths between: the
// first span starts the tail, the rest pass through.
function setTail(loc, eq, feet, startId) {
  const old = tailCable(eq);
  const into = incomingPath(loc.id);
  if (!into) {
    eq.tailFt = feet;
    delete eq.tail;
    return;
  }
  const start = startId || (old ? old.from : into.from);
  if (old && old.from === start && cableSpans(old).at(-1).to === loc.id) {
    old.tailFt = feet;
    return;
  }
  const kind = tailKind(loc, eq);
  const name = old ? old.name : nextCableName(kind, false);
  const fibers = old ? old.fibers : eq.type === "terminal" ? cardPorts(eq) || 1 : 1;
  if (old) removeCableFrom(old);
  // The paths from start down to loc (just the last one if start isn't
  // up the route from loc).
  const chain = [];
  for (let p = into; p; p = incomingPath(p.from)) {
    chain.unshift(p);
    if (p.from === start) break;
  }
  if (chain[0].from !== start) chain.splice(0, chain.length - 1);
  let prev = null;
  for (const p of chain) {
    const span = { id: makeId(), name, from: p.from, to: p.to, fibers };
    if (prev) Object.assign(span, { through: "pass", prev: prev.id });
    else Object.assign(span, { kind, tailFt: feet });
    plan.cables.push(span);
    if (!prev) eq.tail = span.id;
    prev = span;
  }
  delete eq.tailFt;
}

function equipmentLabel(eq) {
  if (eq.type === "splitter") return eq.f2 ? `${eq.name} · ${f2Label(eq)}` : eq.name;
  if (hasCards(eq)) {
    return `${eq.name} · ${eq.cards.length} ${eq.cards.length === 1 ? "card" : "cards"}, ${cardPorts(eq)} ports`;
  }
  if (eq.type === "closure") return `${eq.name} · ${eq.trays} trays x ${eq.slots}`;
  return eq.name;
}

// Short form for the chips on a location card.
function equipmentChip(eq) {
  const tail = tailFeet(eq) ? ` · ${tailFeet(eq)}ft tail` : "";
  if (eq.type === "splitter") return `${eq.ratio}${tail}${eq.f2 ? ` · ${f2Label(eq)}` : ""}`;
  if (hasCards(eq)) return `${eq.name} · ${cardPorts(eq)}p${tail}`;
  if (eq.type === "closure") return `${eq.name} · ${eq.trays * eq.slots}sp`;
  return eq.name;
}

// --- Equipment dialog ---

function openEquipment(locId, startKind) {
  const p = point(locId);
  p.equipment = p.equipment || [];
  openForm(`Equipment at ${p.name}`, (body, foot) => {
    const list = el("div", "eq-list");
    body.append(list);
    renderList();

    function renderList() {
      list.innerHTML = "";
      if (!p.equipment.length) list.append(el("p", "hint", "Nothing here yet. Add equipment below."));
      for (const eq of p.equipment) list.append(eqRow(eq));
    }

    function eqRow(eq) {
      const row = el("div", "eq-row");
      const pic = el("span", "eq-icon");
      pic.append(iconEl((EQ_KINDS[eq.type] || EQ_KINDS.other).icon));
      const title = el("div", "eq-name", eq.name);
      const sub = el("div", "eq-meta", [eq.model, eq.style, eq.type === "splitter" ? eq.ratio : "", tailFeet(eq) ? `${tailFeet(eq)} ft tail` : ""].filter(Boolean).join(" · "));
      const text = el("div", "eq-text");
      text.append(title, sub);
      row.append(pic, text);
      const ph = phaseSelect(eq);
      if (ph) {
        ph.addEventListener("change", () => {
          eq.phase = ph.value;
          savePlan();
          renderRoute();
        });
        const phRow = el("label", "inline-field");
        phRow.append(el("span", "", "Phase"), ph);
        row.append(phRow);
      }
      if (eq.type === "splitter") {
        // F2: the app's next free fiber (locked), or a fiber picked by hand.
        const c = feederAt(p.id, eq);
        const max = c ? c.fibers : 432;
        const opts = [{ value: "", label: "Not set" }];
        for (let n = 1; n <= max; n++) {
          const problem = n === eq.f2 ? "" : f2Problem(p, eq, n);
          opts.push({ value: n, label: f2Text(n) + (problem ? " (in use)" : ""), disabled: !!problem });
        }
        const sel = selectEl(opts, eq.f2 || "");
        sel.addEventListener("change", () => {
          eq.f2 = sel.value ? Number(sel.value) : null;
          eq.f2Manual = true;
          savePlan();
          renderRoute();
          renderList();
        });
        const view = el("span", "auto-val mono", eq.f2 ? f2Label(eq) : "no free fiber");
        const f2Row = el("span", "inline-field");
        f2Row.append(el("span", "", "F2"), lockField(!eq.f2Manual, view, sel, (lock) => {
          eq.f2Manual = !lock;
          savePlan();
          renderRoute();
          renderList();
        }, "the F2 count"));
        const note = el("span", "field-hint", eq.f2 ? f2Hint(p, eq) : "F2 not set");
        row.append(f2Row, el("span", "eq-meta mono", `DS ${usedPorts(eq).size}/${splitterPorts(eq)}`), note);
      }
      if (eq.type === "closure") {
        const trays = inputEl("number", eq.trays, { min: 1, max: 48 });
        const slots = el("select");
        for (const n of new Set([...TRAY_SIZES, eq.slots].sort((x, y) => x - y))) {
          const o = el("option", "", String(n));
          o.value = n;
          if (n === eq.slots) o.selected = true;
          slots.append(o);
        }
        const save = () => {
          eq.trays = Math.max(1, Number(trays.value) || 1);
          eq.slots = Math.max(1, Number(slots.value) || 1);
          savePlan();
          renderRoute();
          renderList();
        };
        trays.addEventListener("change", save);
        slots.addEventListener("change", save);
        const a = el("label", "inline-field");
        a.append(el("span", "", "Trays"), trays);
        const b = el("label", "inline-field");
        b.append(el("span", "", "Tray size"), slots);
        row.append(a, b);
        if (eq.max && eq.trays * eq.slots > eq.max) {
          row.append(el("span", "field-hint warn", `${eq.trays * eq.slots} splices is over the ${eq.max} this case holds.`));
        }
      }
      if (tailKind(p, eq)) {
        // The tail's length and where it starts, changed here at any
        // time; "No tail" takes it off.
        const tail = tailLengthField(tailFeet(eq), "No tail");
        const into = incomingPath(p.id);
        const from = tailStartField(into && into.from, tailCable(eq) && tailCable(eq).from);
        const save = () => {
          const ft = tail.value();
          if (ft === null) return;
          if (ft) setTail(p, eq, ft, from.value());
          else {
            const c = tailCable(eq);
            if (c) removeCableFrom(c);
            delete eq.tail;
            delete eq.tailFt;
          }
          savePlan();
          renderRoute();
          renderList();
        };
        tail.el.addEventListener("change", save);
        from.el.addEventListener("change", save);
        row.append(tail.el, from.el);
      }
      const actions = el("div", "eq-actions");
      if (hasCards(eq)) actions.append(btnEl("Edit cards and ports", () => openCards(locId, eq.id), "btn ghost"));
      if (eq.type === "closure") actions.append(btnEl("Open splice case", () => openConnections(locId), "btn ghost"));
      actions.append(btnEl("Remove", () => {
        const onIt = plan.points.filter((h) => h.ds && h.ds.splitterId === eq.id);
        withUndo(`Removed ${eq.name}` + (onIt.length ? `. ${onIt.length} home${onIt.length === 1 ? " is" : "s are"} back on automatic counts.` : "."), () => {
          p.equipment = p.equipment.filter((x) => x.id !== eq.id);
          // Its tail comes out with it.
          const tail = tailCable(eq);
          if (tail) removeCableFrom(tail);
          for (const h of onIt) {
            delete h.ds;
            h.dsManual = false;
          }
          for (const h of plan.points) if (h.tport && h.tport.eqId === eq.id) delete h.tport;
          dropEquipmentLinks(eq.id);
        });
        renderList();
      }, "btn ghost danger"));
      row.append(actions);
      return row;
    }

    // Add form: the kind, then a template (with a picture) or splitter size.
    body.append(el("h4", "form-section", "Add equipment"));
    const kinds = kindsFor(p);
    const kind = selectEl(kinds.map((k) => ({ value: k, label: EQ_KINDS[k].label })), kinds.includes(startKind) ? startKind : kinds[0]);
    const addGrid = el("div", "add-grid");
    const fields = el("div");
    const picBox = el("div", "pic-box");
    addGrid.append(fields, picBox);
    body.append(fieldEl("Equipment type", kind), addGrid);

    const template = selectEl([]);
    const name = inputEl("text", "");
    let nameTouched = false;
    name.addEventListener("input", () => (nameTouched = true));
    const ratio = selectEl(SPLITTER_RATIOS.map((r) => ({ value: r, label: r })), "1x32");
    const tail = tailLengthField();
    const into = incomingPath(p.id);
    const tailFrom = tailStartField(into && into.from);
    const tailBox = el("div");
    tailBox.append(tail.el, tailFrom.el);
    const qty = inputEl("number", 1, { min: 1, max: 48 });
    const first = inputEl("number", nextFreeF2(p, { id: null }) || "", { min: 1 });
    // New splitters take the next free F2 fibers unless unlocked.
    let firstManual = false;
    const firstBox = el("div");
    const note = el("p", "hint");
    const addError = el("p", "error");
    addError.hidden = true;
    const add = btnEl("Add", addEquipment, "btn");
    // Enter in the add boxes adds the equipment, not the dialog's Done.
    fields.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
      e.preventDefault();
      add.click();
    });

    function tmpl() {
      return templateById(template.value);
    }

    function renderFields() {
      fields.innerHTML = "";
      const k = kind.value;
      const list = templatesFor(k);
      if (list.length) {
        template.replaceChildren(...selectEl(list.map((t) => ({ value: t.id, label: t.label, group: t.group }))).childNodes);
        template.value = list[0].id;
        fields.append(fieldEl(k === "splitter" ? "Style" : "Template", template));
      }
      if (k === "splitter") {
        const g = el("div", "form-grid");
        g.append(fieldEl("Size", ratio), fieldEl("How many", qty), fieldEl("First F2", firstBox));
        fields.append(g, tailBox);
        renderFirst();
      } else {
        fields.append(fieldEl("Name", name));
        if (k === "terminal") fields.append(tailBox);
        nameTouched = false;
      }
      fields.append(note, addError, add);
      refresh();
    }

    function renderFirst() {
      firstBox.replaceChildren(lockField(!firstManual, el("span", "auto-val", "Next free fibers"), first, (lock) => {
        firstManual = !lock;
        renderFirst();
        refresh();
      }, "the first F2"));
    }

    function plannedF2() {
      const n = Math.max(1, Math.min(48, Number(qty.value) || 1));
      if (!firstManual || first.value === "") return { list: [], n };
      const c = incomingCable(p.id);
      const max = c ? cableStart(c).fibers : Infinity;
      const list = [];
      for (let f = Number(first.value); list.length < n; f++) {
        if (f > max) return { error: `${c.name} only has ${max} fibers: room for ${list.length} from F2 ${first.value}.` };
        if (!f2Problem(p, { id: null }, f)) list.push(f);
      }
      return { list, n };
    }

    function refresh() {
      addError.hidden = true;
      const k = kind.value;
      const t = tmpl();
      tailBox.hidden = !(k === "splitter" ? t && t.tails : k === "terminal" && p.type === "pedestal");
      if (k === "splitter") fillRatios(ratio, t, t && t.ratios ? "1x8" : "1x32");
      picBox.replaceChildren(hardwarePicture(k, t));
      if (t && t.kind === k && !nameTouched && k !== "splitter") name.value = t.model || EQ_KINDS[k].label;
      if (k === "other" && !nameTouched) name.value = "";
      if (k === "splitter") {
        const planned = plannedF2();
        note.className = planned.error ? "error" : "hint";
        note.textContent = planned.error ? planned.error : planned.list.length
          ? `Adds ${planned.n} x ${ratio.value} on ${planned.list.map(f2Text).join(", ")}.`
          : firstManual ? `Adds ${planned.n} x ${ratio.value} with no F2 yet.`
            : `Adds ${planned.n} x ${ratio.value}. Their F2 counts fill in by themselves.`;
      } else if (k === "other") {
        note.textContent = "";
      } else {
        note.className = "hint";
        note.textContent = "Templates are a starting point. Check them against your gear, then edit.";
      }
    }
    kind.addEventListener("change", renderFields);
    [template, ratio, qty, first].forEach((x) => x.addEventListener("input", refresh));
    renderFields();

    function addEquipment() {
      const k = kind.value;
      if (k === "splitter") {
        const planned = plannedF2();
        if (planned.error) return;
        const t = tmpl();
        if (t.tails && !tail.value()) {
          addError.textContent = "Enter the custom tail length in feet.";
          addError.hidden = false;
          return;
        }
        let n = splittersAt(p).length;
        for (let i = 0; i < planned.n; i++) {
          const sp = { id: makeId(), type: "splitter", ratio: ratio.value, style: t.style,
            name: `Splitter ${++n} (${ratio.value})`, f2: planned.list[i] || null, f2Manual: firstManual };
          p.equipment.push(sp);
          if (t.tails) setTail(p, sp, tail.value(), tailFrom.value());
        }
        first.value = nextFreeF2(p, { id: null }) || "";
      } else if (k === "other") {
        if (!name.value.trim()) {
          addError.textContent = "Name the equipment.";
          addError.hidden = false;
          return;
        }
        p.equipment.push({ id: makeId(), type: "other", name: name.value.trim() });
      } else {
        const t = tmpl();
        if (!tailBox.hidden && !tail.value()) {
          addError.textContent = "Enter the custom tail length in feet.";
          addError.hidden = false;
          return;
        }
        const item = fromTemplate(t, name.value.trim() || t.model || EQ_KINDS[k].label);
        p.equipment.push(item);
        if (!tailBox.hidden) setTail(p, item, tail.value(), tailFrom.value());
        if (hasCards(item)) {
          savePlan();
          return openCards(locId, item.id);
        }
      }
      nameTouched = false;
      savePlan();
      renderList();
      refresh();
      renderRoute();
    }

    foot.append(btnEl("Done", finish, "btn big"));
  }, true);
  selectedId = locId;
  renderRoute();
}

// "Fiber 5 on Cable 1: Blue tube, Slate fiber."
function f2Hint(loc, eq) {
  const c = feederAt(loc.id, eq);
  if (!c) return `No cable arrives at ${loc.name}, so F2 is just a number here.`;
  const f = colorCode(c.fibers)[eq.f2 - 1];
  if (!f) return "";
  const here = `${c.name} #${eq.f2}: ${f.tubeColor.name} tube, ${f.fiberColor.name} fiber.`;
  // A terminal tail: say where it's spliced on the way back.
  const src = f2Source(eq);
  return src && src.traced ? `${here} Spliced to ${src.cable.name} #${src.n} upstream.` : here;
}

// --- Card and port editor (shelves, panels, terminals) ---

function openCards(locId, eqId) {
  const p = point(locId);
  const eq = p.equipment.find((x) => x.id === eqId);
  const changed = () => {
    savePlan();
    renderRoute();
  };
  openForm(`${eq.name} at ${p.name}`, (body, foot) => {
    const name = inputEl("text", eq.name);
    const model = inputEl("text", eq.model || "");
    name.addEventListener("change", () => {
      eq.name = name.value.trim() || eq.name;
      changed();
    });
    model.addEventListener("change", () => {
      eq.model = model.value.trim();
      changed();
    });
    const grid = el("div", "form-grid");
    grid.append(fieldEl("Name", name), fieldEl("Model", model));
    body.append(grid);
    const cardsEl = el("div", "cards");
    body.append(cardsEl);
    renderCards();

    function renderCards() {
      cardsEl.innerHTML = "";
      eq.cards.forEach((card, ci) => {
        const box = el("details", "card-box");
        box.open = eq.cards.length <= 4;
        const sum = el("summary", "", `${card.name} · ${card.ports.length} port${card.ports.length === 1 ? "" : "s"}`);
        box.append(sum);
        const cardName = inputEl("text", card.name);
        cardName.addEventListener("change", () => {
          card.name = cardName.value.trim() || card.name;
          sum.textContent = `${card.name} · ${card.ports.length} ports`;
          changed();
        });
        const top = el("div", "card-top");
        top.append(fieldEl("Card name", cardName), btnEl("Remove card", () => {
          const ids = new Set(card.ports.map((x) => x.id));
          withUndo(`Removed ${card.name} and its ${card.ports.length} port${card.ports.length === 1 ? "" : "s"}.`, () => {
            dropPortPatches(eq.id, ids);
            eq.cards.splice(eq.cards.indexOf(card), 1);
          });
          changed();
          renderCards();
        }, "btn ghost danger"));
        const ports = el("div", "port-grid");
        card.ports.forEach((port, pi) => {
          const cell = el("div", "port-cell");
          const pn = inputEl("text", port.name);
          pn.title = "Port name";
          pn.addEventListener("change", () => {
            port.name = pn.value.trim() || port.name;
            changed();
          });
          cell.append(pn, btnEl("×", () => {
            dropPortPatches(eq.id, new Set([port.id]));
            card.ports.splice(pi, 1);
            changed();
            renderCards();
          }, "btn ghost small"));
          ports.append(cell);
        });
        ports.append(btnEl("+ Port", () => {
          card.ports.push({ id: makeId(), name: String(card.ports.length + 1) });
          changed();
          renderCards();
          cardsEl.children[ci].open = true;
        }, "btn ghost small"));
        box.append(top, ports);
        cardsEl.append(box);
      });
      cardsEl.append(btnEl("+ Add card", () => {
        const n = eq.cards.length + 1;
        eq.cards.push({ id: makeId(), name: `Card ${n}`, ports: Array.from({ length: 8 }, (_, i) => ({ id: makeId(), name: String(i + 1) })) });
        changed();
        renderCards();
        cardsEl.children[eq.cards.length - 1].open = true;
      }, "btn ghost"));
    }

    foot.append(btnEl("Back to equipment", () => openEquipment(locId), "btn ghost"), btnEl("Done", finish, "btn big"));
  }, true);
}

// Patches on ports that are going away go with them.
function dropPortPatches(eqId, portIds) {
  const gone = (k) => k.startsWith(`port:${eqId}:`) && portIds.has(k.split(":")[2]);
  plan.xconnects = plan.xconnects.filter((x) => !gone(x.a) && !gone(x.b));
}

// --- Location details ---
// Address or GPS, incoming (feeder) counts, model and notes, plus any
// other fields the user wants. Printed on the field sheet.

const DETAIL_FIELDS = [
  { key: "address", label: "Address" },
  { key: "gps", label: "GPS", placeholder: "e.g. 35.1234, -97.5678" },
  { key: "model", label: "Model" },
  { key: "incoming", label: "Incoming counts", placeholder: "e.g. F1 1-144 from CO" },
];

function detailLines(p) {
  const d = p.details;
  if (!d) return [];
  const lines = DETAIL_FIELDS.filter((f) => d[f.key]).map((f) => `${f.label}: ${d[f.key]}`);
  for (const x of d.extra || []) lines.push(`${x.label}: ${x.value}`);
  if (d.notes) lines.push(`Notes: ${d.notes}`);
  return lines;
}

function openDetails(locId) {
  const p = point(locId);
  const d = p.details || {};
  openForm(`${p.type === "cabinet" ? "Cabinet" : "Location"} details: ${p.name}`, (body, foot) => {
    const inputs = {};
    const grid = el("div", "form-grid");
    for (const f of DETAIL_FIELDS) {
      inputs[f.key] = inputEl("text", d[f.key] || "", f.placeholder ? { placeholder: f.placeholder } : {});
      grid.append(fieldEl(f.label, inputs[f.key]));
    }
    body.append(grid);
    const notes = inputEl("textarea", d.notes || "", { rows: 3 });
    body.append(fieldEl("Notes", notes));

    body.append(el("h4", "form-section", "More fields"));
    const extra = (d.extra || []).map((x) => ({ ...x }));
    const extraEl = el("div", "extra-list");
    body.append(extraEl);
    renderExtra();
    function renderExtra() {
      extraEl.innerHTML = "";
      extra.forEach((x, i) => {
        const row = el("div", "extra-row");
        const label = inputEl("text", x.label, { placeholder: "Field name" });
        const value = inputEl("text", x.value, { placeholder: "Value" });
        label.addEventListener("input", () => (x.label = label.value));
        value.addEventListener("input", () => (x.value = value.value));
        row.append(label, value, btnEl("×", () => {
          extra.splice(i, 1);
          renderExtra();
        }, "btn ghost small"));
        extraEl.append(row);
      });
      extraEl.append(btnEl("+ Add a field", () => {
        extra.push({ label: "", value: "" });
        renderExtra();
        extraEl.querySelector(".extra-row:last-of-type input").focus();
      }, "btn ghost"));
    }

    formButtons(foot, () => {
      const next = {};
      for (const f of DETAIL_FIELDS) if (inputs[f.key].value.trim()) next[f.key] = inputs[f.key].value.trim();
      if (notes.value.trim()) next.notes = notes.value.trim();
      const kept = extra.map((x) => ({ label: x.label.trim(), value: x.value.trim() })).filter((x) => x.label || x.value);
      if (kept.some((x) => !x.label)) return "Give every extra field a name.";
      if (kept.length) next.extra = kept;
      if (Object.keys(next).length) p.details = next;
      else delete p.details;
      finish();
    });
  }, true);
  selectedId = locId;
  renderRoute();
}
