// Equipment rows follow the locations along the route.
function feEquipmentRows(types) {
  return plan.points.flatMap((p) => (p.equipment || []).filter((eq) => types.includes(eq.type)));
}

function feEquipmentName() {
  return { key: "name", label: "Name", edit: "text", get: (eq) => eq.name,
    check: (eq, v) => (v ? "" : "Give it a name."),
    set: (eq, v) => (eq.name = v) };
}

function feEquipmentLocation() {
  return { key: "location", label: "Location", get: (eq) => equipmentLocation(eq.id).name };
}

function feEquipmentModel() {
  return { key: "model", label: "Model", edit: "text", get: (eq) => eq.model || "",
    set: (eq, v) => (eq.model = v) };
}

function feTailFeet() {
  return { key: "tailFt", label: "Tail ft", edit: "number", get: (eq) => tailFeet(eq),
    editable: (eq) => !!tailKind(equipmentLocation(eq.id), eq),
    check: (eq, v) => (v !== null && !(v >= 1 && v <= 5000) ? "Tail length is 1 to 5000 ft." : ""),
    set: (eq, v) => {
      const loc = equipmentLocation(eq.id);
      if (!tailKind(loc, eq)) return;
      if (v === null) {
        const c = tailCable(eq);
        if (c) removeCableFrom(c);
        delete eq.tail;
        delete eq.tailFt;
        delete eq.tailIn;
      } else {
        setTail(loc, eq, v, eq.tailIn ? loc.id : tailCable(eq) ? tailCable(eq).from : undefined);
      }
    } };
}

function feTailText() {
  return { key: "tail", label: "Tail", get: (eq) => tailText(eq, equipmentLocation(eq.id)) || "—" };
}

function feSplitterRatios(eq) {
  const t = eq && (templateById(eq.template) || TEMPLATES.find((t) => t.kind === "splitter" && t.style === eq.style));
  return ((t && t.ratios) || SPLITTER_RATIOS).map((r) => ({ value: r, label: r }));
}

addFeatureType({
  key: "cases", label: "Splice cases",
  rows: () => feEquipmentRows(["closure"]),
  locOf: (eq) => equipmentLocation(eq.id).id,
  cols: [
    feEquipmentName(),
    feEquipmentLocation(),
    feEquipmentModel(),
    { key: "trays", label: "Trays", edit: "number", get: (eq) => eq.trays,
      check: (eq, v) => (Number.isFinite(v) && v >= 1 ? "" : "Enter at least 1 tray."),
      set: (eq, v) => (eq.trays = v) },
    { key: "slots", label: "Tray size", edit: "select", get: (eq) => eq.slots,
      // Sizes from templates or older plans stay on the list.
      options: (eq) => [...new Set([12, 24, 36, 48, 72, 96, 144, ...(eq ? [eq.slots] : feEquipmentRows(["closure"]).map((x) => x.slots))])]
        .sort((a, b) => a - b).map((n) => ({ value: n, label: String(n) })),
      set: (eq, v) => (eq.slots = v) },
    { key: "splices", label: "Splices", get: (eq) => eq.trays * eq.slots,
      text: (eq) => `${eq.trays * eq.slots}${eq.max && eq.trays * eq.slots > eq.max ? ` (over the ${eq.max} max)` : ""}` },
  ],
});

addFeatureType({
  key: "splitters", label: "Splitters",
  rows: () => feEquipmentRows(["splitter"]),
  locOf: (eq) => equipmentLocation(eq.id).id,
  cols: [
    feEquipmentName(),
    feEquipmentLocation(),
    { key: "ratio", label: "Size", edit: "select", get: (eq) => eq.ratio,
      options: feSplitterRatios,
      check: (eq, v) => {
        if (!feSplitterRatios(eq).some((r) => r.value === v)) return "Choose a size available for this style.";
        const n = usedPorts(eq).size;
        const m = splitterPorts({ ratio: v });
        return n > m ? `${eqLabel(eq)} has ${n} homes on it; a ${v} only has ${m} ports.` : "";
      },
      set: (eq, v) => (eq.ratio = v) },
    { key: "style", label: "Style", get: (eq) => eq.style },
    { key: "f2", label: "F2", edit: "number", get: (eq) => eq.f2 ?? null,
      check: (eq, v) => (v === null ? "" : !Number.isInteger(v) || v < 1 ? "F2 is a whole number from 1 up." : f2Problem(equipmentLocation(eq.id), eq, v)),
      set: (eq, v) => {
        eq.f2 = v;
        eq.f2Manual = v !== null || !!eq.handOnly;
      } },
    { key: "used", label: "DS used", get: (eq) => `${usedPorts(eq).size} of ${splitterPorts(eq)}` },
    feTailFeet(),
    feTailText(),
    phaseCol(),
  ],
});

addFeatureType({
  key: "terminals", label: "Terminals",
  rows: () => feEquipmentRows(["terminal"]),
  locOf: (eq) => equipmentLocation(eq.id).id,
  cols: [
    feEquipmentName(),
    feEquipmentLocation(),
    feEquipmentModel(),
    { key: "ports", label: "Ports", get: (eq) => cardPorts(eq) },
    feTailFeet(),
    feTailText(),
    phaseCol(),
  ],
});

addFeatureType({
  key: "gear", label: "Shelves, panels and other",
  rows: () => feEquipmentRows(["shelf", "panel", "other"]),
  locOf: (eq) => equipmentLocation(eq.id).id,
  cols: [
    feEquipmentName(),
    feEquipmentLocation(),
    { key: "kind", label: "Kind", get: (eq) => EQ_KINDS[eq.type].label },
    { ...feEquipmentModel(), editable: (eq) => eq.type !== "other",
      text: (eq) => (eq.type === "other" ? "—" : eq.model || ""),
      set: (eq, v) => {
        if (eq.type !== "other") eq.model = v;
      } },
    { key: "ports", label: "Ports", get: (eq) => (hasCards(eq) ? cardPorts(eq) : "—") },
    phaseCol(),
  ],
});

addFeatureType({
  key: "homes", label: "Homes",
  rows: () => plan.points.filter((p) => p.type === "nid"),
  locOf: (h) => h.id,
  cols: [
    feEquipmentName(),
    { key: "lot", label: "Lot", edit: "text", get: (h) => h.lot || "",
      set: (h, v) => {
        // A home known by its lot ("Lot 20") takes the new lot's name.
        if (h.lot && h.name === lotName(h.lot) && v) h.name = lotName(v);
        if (v) h.lot = v;
        else delete h.lot;
      } },
    { key: "from", label: "Fed from", get: (h) => {
      const into = incomingPath(h.id);
      return into ? point(into.from).name : "—";
    } },
    { key: "splitter", label: "Splitter", get: (h) => {
      const eq = homeSplitter(h);
      return eq ? eqLabel(eq) : "—";
    } },
    { key: "f2", label: "F2", get: (h) => (homeF2(h) ? f2Label(homeF2(h)) : "—") },
    { key: "status", label: "Field status", edit: "select", get: (h) => (h.field && h.field.status) || "",
      options: () => Object.entries(FIELD_STATUS).map(([value, label]) => ({ value, label })),
      set: (h, v) => {
        h.field = { ...(h.field || {}) };
        if (v) h.field.status = v;
        else delete h.field.status;
      } },
    phaseCol(),
  ],
});
