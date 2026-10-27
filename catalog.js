// What the app knows about hardware: each location type's icon, color
// and menu, the kinds of equipment, and the stock templates users start
// from and then cut down. Port and splice counts are generic starting
// points, not any one crew's gear; every template can be edited.

// --- Location types ---

const LOC_META = {
  headend: { label: "Head end", icon: "headend", color: "#3f7fd9", cabinet: true },
  fdh: { label: "FDH", icon: "fdh", color: "#2a9bb5", cabinet: true },
  cabinet: { label: "Cabinet", icon: "fdh", color: "#3f7fd9", cabinet: true },
  handhole: { label: "Handhole", icon: "handhole", color: "#b08550" },
  pedestal: { label: "Pedestal", icon: "pedestal", color: "#3fa36b" },
  vault: { label: "Vault", icon: "vault", color: "#a69a3c" },
  manhole: { label: "Manhole", icon: "manhole", color: "#8090a3" },
  splice: { label: "Splice", icon: "closure", color: "#8b74d6" },
  nid: { label: "Customer NID", icon: "home", color: "#e08a3c" },
  other: { label: "Other", icon: "pin", color: "#8796a6" },
};

function locMeta(p) {
  return LOC_META[p.type] || LOC_META.other;
}

function isCabinet(p) {
  return !!locMeta(p).cabinet;
}

// <svg> using a symbol from the sprite in index.html.
function iconEl(id, className = "ic") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#i-${id}`);
  svg.append(use);
  return svg;
}

// --- Equipment kinds ---
// Which kinds each location type offers. Cabinets of the old kind (from
// plans saved before head ends and FDHs) offer everything.

const EQ_KINDS = {
  shelf: { label: "OLT / shelf", icon: "shelf" },
  panel: { label: "Patch panel", icon: "panel" },
  splitter: { label: "Splitter", icon: "splitter" },
  closure: { label: "Splice case", icon: "closure" },
  terminal: { label: "Terminal", icon: "terminal" },
  other: { label: "Other", icon: "info" },
};

function kindsFor(p) {
  if (p.type === "headend") return ["shelf", "panel", "splitter", "other"];
  if (p.type === "fdh") return ["splitter", "panel", "closure", "other"];
  if (p.type === "cabinet" || p.type === "other") return Object.keys(EQ_KINDS);
  return ["closure", "splitter", "terminal", "other"];
}

// --- Templates ---
// Card-based kinds (shelf, panel, terminal) list cards x ports. Closures
// list trays x splices per tray. Splitters list a style; the ratio is
// picked separately.

const TEMPLATES = [
  // OLTs and shelves. Our standard shelves come first.
  { id: "std-e7-xg801", kind: "shelf", group: "Standard", label: "Calix E7-2, XG801 (standard)", model: "Calix E7-2", cards: 2, card: "XG801", ports: 8, port: "PON" },
  { id: "std-e7-xg402", kind: "shelf", group: "Standard", label: "Calix E7-2, XG402 (standard)", model: "Calix E7-2", cards: 2, card: "XG402", ports: 4, port: "PON" },
  { id: "e7-gpon8", kind: "shelf", group: "Calix", label: "Calix E7-2, GPON-8 cards", model: "Calix E7-2", cards: 2, card: "GPON-8", ports: 8, port: "PON" },
  { id: "e7-gpon8r2", kind: "shelf", group: "Calix", label: "Calix E7-2, GPON-8 r2 cards", model: "Calix E7-2", cards: 2, card: "GPON-8 r2", ports: 8, port: "PON" },
  { id: "e7-xg801", kind: "shelf", group: "Calix", label: "Calix E7-2, XG801 cards", model: "Calix E7-2", cards: 2, card: "XG801", ports: 8, port: "PON" },
  { id: "e9-ng1601", kind: "shelf", group: "Calix", label: "Calix E9-2, NG1601 cards", model: "Calix E9-2", cards: 2, card: "NG1601", ports: 16, port: "PON" },
  { id: "e9-gp1611", kind: "shelf", group: "Calix", label: "Calix E9-2, GP1611 cards", model: "Calix E9-2", cards: 2, card: "GP1611", ports: 16, port: "PON" },
  { id: "adtran-sdx6320", kind: "shelf", group: "Adtran", label: "Adtran SDX 6320-16 (1RU, 16 PON)", model: "Adtran SDX 6320-16", cards: 1, card: "Ports", ports: 16, port: "PON" },
  { id: "adtran-ta5000", kind: "shelf", group: "Adtran", label: "Adtran TA5000 23in, 4 GPON cards", model: "Adtran TA5000", cards: 4, card: "GPON OLT", ports: 4, port: "PON" },
  { id: "nokia-fx4", kind: "shelf", group: "Nokia", label: "Nokia 7360 ISAM FX-4, 16-port LT cards", model: "Nokia 7360 FX-4", cards: 4, card: "LT", ports: 16, port: "PON" },
  { id: "nokia-fx8", kind: "shelf", group: "Nokia", label: "Nokia 7360 ISAM FX-8, 16-port LT cards", model: "Nokia 7360 FX-8", cards: 8, card: "LT", ports: 16, port: "PON" },
  { id: "nokia-mf2", kind: "shelf", group: "Nokia", label: "Nokia Lightspan MF-2, 2 LT cards", model: "Nokia Lightspan MF-2", cards: 2, card: "LT", ports: 16, port: "PON" },
  { id: "shelf-generic", kind: "shelf", group: "Generic", label: "Generic OLT, 1 card x 8 PON", model: "", cards: 1, card: "Card", ports: 8, port: "PON" },

  // Patch panels (head end and FDH)
  { id: "pp-12", kind: "panel", group: "Rack panels", label: "1RU panel, 12 ports", model: "Patch panel 12", cards: 1, card: "Panel", ports: 12 },
  { id: "pp-24", kind: "panel", group: "Rack panels", label: "1RU panel, 24 ports", model: "Patch panel 24", cards: 2, card: "Row", ports: 12 },
  { id: "pp-48", kind: "panel", group: "Rack panels", label: "1RU panel, 48 ports (4 cassettes)", model: "Patch panel 48", cards: 4, card: "Cassette", ports: 12 },
  { id: "pp-96", kind: "panel", group: "Rack panels", label: "2RU panel, 96 ports (8 cassettes)", model: "Patch panel 96", cards: 8, card: "Cassette", ports: 12 },
  { id: "pp-144", kind: "panel", group: "Rack panels", label: "4RU panel, 144 ports (12 cassettes)", model: "Patch panel 144", cards: 12, card: "Cassette", ports: 12 },
  { id: "pp-288", kind: "panel", group: "Rack panels", label: "4RU panel, 288 ports (24 cassettes)", model: "Patch panel 288", cards: 24, card: "Cassette", ports: 12 },
  { id: "fdh-feeder-24", kind: "panel", group: "FDH panels", label: "FDH feeder panel, 24 ports", model: "Feeder panel", cards: 2, card: "Feeder", ports: 12 },
  { id: "fdh-feeder-48", kind: "panel", group: "FDH panels", label: "FDH feeder panel, 48 ports", model: "Feeder panel", cards: 4, card: "Feeder", ports: 12 },
  { id: "fdh-dist-144", kind: "panel", group: "FDH panels", label: "FDH distribution panel, 144 ports", model: "Distribution panel", cards: 12, card: "Dist", ports: 12 },
  { id: "fdh-dist-288", kind: "panel", group: "FDH panels", label: "FDH distribution panel, 288 ports", model: "Distribution panel", cards: 24, card: "Dist", ports: 12 },
  { id: "fdh-dist-432", kind: "panel", group: "FDH panels", label: "FDH distribution panel, 432 ports", model: "Distribution panel", cards: 36, card: "Dist", ports: 12 },
  { id: "clearfield-144", kind: "panel", group: "FDH by maker", label: "Clearfield FieldSmart FDH, 144 ports", model: "Clearfield FieldSmart FDH", cards: 12, card: "Cassette", ports: 12 },
  { id: "clearfield-288", kind: "panel", group: "FDH by maker", label: "Clearfield FieldSmart FDH, 288 ports", model: "Clearfield FieldSmart FDH", cards: 24, card: "Cassette", ports: 12 },
  { id: "commscope-288", kind: "panel", group: "FDH by maker", label: "CommScope FDH 3000, 288F", model: "CommScope FDH 3000", cards: 24, card: "Panel", ports: 12 },
  { id: "commscope-432", kind: "panel", group: "FDH by maker", label: "CommScope FDH 3000, 432F", model: "CommScope FDH 3000", cards: 36, card: "Panel", ports: 12 },
  { id: "optitect-288", kind: "panel", group: "FDH by maker", label: "Corning OptiTect, 288F", model: "Corning OptiTect", cards: 24, card: "Panel", ports: 12 },

  // Splice cases / closures: trays x splices per tray
  // FOSC first: the cases used most, and the default for a new splice case.
  { id: "fosc-450b", kind: "closure", group: "CommScope", label: "FOSC 450 B (max 96 splices)", model: "CommScope FOSC 450 B", trays: 4, slots: 24, max: 96 },
  { id: "fosc-450c", kind: "closure", group: "CommScope", label: "FOSC 450 C (max 144 splices)", model: "CommScope FOSC 450 C", trays: 6, slots: 24, max: 144 },
  { id: "fosc-450d", kind: "closure", group: "CommScope", label: "FOSC 450 D (max 432 splices)", model: "CommScope FOSC 450 D", trays: 18, slots: 24, max: 432 },
  { id: "tenio-b6", kind: "closure", group: "CommScope", label: "TENIO B6 (approx. 144 splices)", model: "CommScope TENIO B6", trays: 6, slots: 24 },
  { id: "dome-24", kind: "closure", group: "Generic dome", label: "Dome closure, 24 splices (2 trays)", model: "Dome closure 24", trays: 2, slots: 12 },
  { id: "dome-48", kind: "closure", group: "Generic dome", label: "Dome closure, 48 splices (4 trays)", model: "Dome closure 48", trays: 4, slots: 12 },
  { id: "dome-96", kind: "closure", group: "Generic dome", label: "Dome closure, 96 splices (4 trays)", model: "Dome closure 96", trays: 4, slots: 24 },
  { id: "dome-144", kind: "closure", group: "Generic dome", label: "Dome closure, 144 splices (6 trays)", model: "Dome closure 144", trays: 6, slots: 24 },
  { id: "dome-288", kind: "closure", group: "Generic dome", label: "Dome closure, 288 splices (12 trays)", model: "Dome closure 288", trays: 12, slots: 24 },
  { id: "dome-576", kind: "closure", group: "Generic dome", label: "Dome closure, 576 splices (24 trays)", model: "Dome closure 576", trays: 24, slots: 24 },
  { id: "inline-48", kind: "closure", group: "Generic inline", label: "Inline closure, 48 splices (4 trays)", model: "Inline closure 48", trays: 4, slots: 12, shape: "inline" },
  { id: "inline-96", kind: "closure", group: "Generic inline", label: "Inline closure, 96 splices (4 trays)", model: "Inline closure 96", trays: 4, slots: 24, shape: "inline" },
  { id: "inline-144", kind: "closure", group: "Generic inline", label: "Inline closure, 144 splices (6 trays)", model: "Inline closure 144", trays: 6, slots: 24, shape: "inline" },
  { id: "coyote-dome", kind: "closure", group: "PLP Coyote", label: "Coyote dome (approx. 144 splices)", model: "PLP Coyote dome", trays: 6, slots: 24 },
  { id: "coyote-inline", kind: "closure", group: "PLP Coyote", label: "Coyote inline (approx. 96 splices)", model: "PLP Coyote inline", trays: 4, slots: 24, shape: "inline" },

  // Terminals (MSTs)
  { id: "mst-4", kind: "terminal", group: "Generic", label: "Terminal, 4 ports", model: "4-port terminal", cards: 1, card: "Ports", ports: 4 },
  { id: "mst-6", kind: "terminal", group: "Generic", label: "Terminal, 6 ports", model: "6-port terminal", cards: 1, card: "Ports", ports: 6 },
  { id: "mst-8", kind: "terminal", group: "Generic", label: "Terminal, 8 ports", model: "8-port terminal", cards: 1, card: "Ports", ports: 8 },
  { id: "mst-12", kind: "terminal", group: "Generic", label: "Terminal, 12 ports", model: "12-port terminal", cards: 1, card: "Ports", ports: 12 },
  { id: "optitap-4", kind: "terminal", group: "Corning OptiTap MST", label: "OptiTap MST, 4 ports", model: "Corning OptiTap MST 4", cards: 1, card: "Ports", ports: 4 },
  { id: "optitap-8", kind: "terminal", group: "Corning OptiTap MST", label: "OptiTap MST, 8 ports", model: "Corning OptiTap MST 8", cards: 1, card: "Ports", ports: 8 },
  { id: "optitap-12", kind: "terminal", group: "Corning OptiTap MST", label: "OptiTap MST, 12 ports", model: "Corning OptiTap MST 12", cards: 1, card: "Ports", ports: 12 },
  { id: "flexnap-4", kind: "terminal", group: "CommScope FlexNAP", label: "FlexNAP terminal, 4 ports", model: "CommScope FlexNAP 4", cards: 1, card: "Ports", ports: 4 },
  { id: "flexnap-8", kind: "terminal", group: "CommScope FlexNAP", label: "FlexNAP terminal, 8 ports", model: "CommScope FlexNAP 8", cards: 1, card: "Ports", ports: 8 },
  { id: "flexnap-12", kind: "terminal", group: "CommScope FlexNAP", label: "FlexNAP terminal, 12 ports", model: "CommScope FlexNAP 12", cards: 1, card: "Ports", ports: 12 },

  // Splitter styles (ratio picked separately, 1x2 to 1x64). The
  // clamshell is the usual one in a pedestal: its FieldShield drop tail
  // comes in set lengths (TAIL_LENGTHS), or a custom one.
  { id: "sp-clamshell", kind: "splitter", group: "CommScope", label: "CommScope clamshell, FieldShield drop tail", style: "CommScope clamshell", tails: true, ratios: ["1x4", "1x8", "1x12"] },
  { id: "sp-cassette", kind: "splitter", group: "Splitter style", label: "LGX cassette", style: "LGX cassette" },
  { id: "sp-pnp", kind: "splitter", group: "Splitter style", label: "Plug-and-play module (FDH)", style: "Plug-and-play module" },
  { id: "sp-rack", kind: "splitter", group: "Splitter style", label: "Rack mount", style: "Rack mount" },
  { id: "sp-bare", kind: "splitter", group: "Splitter style", label: "Bare / blockless (in a splice case)", style: "Bare" },
];

// The sizes a splitter style comes in, keeping the one picked if it's
// still on the list.
function fillRatios(select, t, fallback) {
  const list = (t && t.ratios) || SPLITTER_RATIOS;
  const keep = list.includes(select.value) ? select.value : list.includes(fallback) ? fallback : list[0];
  select.replaceChildren(...list.map((r) => new Option(r, r)));
  select.value = keep;
}

const TAIL_LENGTHS = [75, 100, 150, 250, 300, 400, 500, 700, 1000];

// Tail length: a stock length, or "Custom" for a number of your own
// (when no stock tail reaches). `none` labels an extra choice for no
// length ("No tail"). Returns { el, value() } where value() is feet, 0
// for that choice, or null if not valid.
function tailLengthField(feet, none) {
  const stock = !feet || TAIL_LENGTHS.includes(feet);
  const opts = [...TAIL_LENGTHS.map((n) => ({ value: n, label: `${n} ft` })), { value: "custom", label: "Custom…" }];
  if (none) opts.unshift({ value: "none", label: none });
  const pick = selectEl(opts, stock ? (feet ? String(feet) : none ? "none" : "150") : "custom");
  const custom = inputEl("number", stock ? "" : feet, { min: 1, max: 5000, placeholder: "ft" });
  const box = el("div", "inline-fields");
  box.append(pick, custom);
  const sync = () => (custom.hidden = pick.value !== "custom");
  pick.addEventListener("change", sync);
  sync();
  return {
    el: fieldEl("Tail length", box),
    value: () => {
      if (pick.value === "none") return 0;
      const n = pick.value === "custom" ? Math.round(Number(custom.value)) : Number(pick.value);
      return n > 0 ? n : null;
    },
  };
}

function templatesFor(kind) {
  return TEMPLATES.filter((t) => t.kind === kind);
}

function templateById(id) {
  return TEMPLATES.find((t) => t.id === id);
}

// A card-based item (shelf, panel, terminal) or a closure from a template.
function fromTemplate(t, name) {
  if (t.kind === "closure") {
    return { id: makeId(), type: "closure", name, model: t.model, template: t.id, trays: t.trays, slots: t.slots, ...(t.max ? { max: t.max } : {}) };
  }
  const cards = [];
  for (let i = 1; i <= t.cards; i++) {
    const ports = [];
    for (let n = 1; n <= t.ports; n++) ports.push({ id: makeId(), name: t.port ? `${t.port} ${n}` : String(n) });
    cards.push({ id: makeId(), name: t.cards > 1 ? `${t.card} ${i}` : t.card, ports });
  }
  return { id: makeId(), type: t.kind, name, model: t.model, template: t.id, cards };
}

// --- Generic pictures ---
// Plain line drawings of each kind of hardware, shown when picking a
// template and on the equipment list. Not any maker's product.

function hardwarePicture(kind, t) {
  const shape = t && t.shape;
  const draw = {
    shelf: `<rect x="8" y="22" width="104" height="36" rx="3"/><path d="M8 32h104M8 48h104" opacity=".5"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${16 + i * 10}" y="36" width="6" height="8" rx="1"/>`).join("")}
      <circle cx="102" cy="40" r="3" fill="currentColor"/><path d="M14 26h20" opacity=".6"/>`,
    panel: `<rect x="6" y="28" width="108" height="24" rx="2"/>
      ${Array.from({ length: 12 }, (_, i) => `<rect x="${12 + i * 8}" y="34" width="5" height="5" rx="1"/><rect x="${12 + i * 8}" y="42" width="5" height="5" rx="1"/>`).join("")}
      <circle cx="9" cy="40" r="1.5" fill="currentColor"/><circle cx="111" cy="40" r="1.5" fill="currentColor"/>`,
    closure: shape === "inline"
      ? `<rect x="22" y="26" width="76" height="28" rx="14"/><path d="M6 36h16M6 44h16M98 36h16M98 44h16"/><path d="M40 26v28M80 26v28" opacity=".5"/>`
      : `<path d="M40 58V22a20 20 0 0 1 40 0v36"/><rect x="34" y="58" width="52" height="8" rx="2"/><path d="M46 66v10M60 66v10M74 66v10"/><path d="M48 30h24M48 38h24M48 46h24" opacity=".5"/>`,
    terminal: `<rect x="30" y="14" width="60" height="54" rx="6"/><path d="M60 68v10"/>
      ${[0, 1, 2, 3].map((i) => `<circle cx="${42 + (i % 2) * 36}" cy="${30 + Math.floor(i / 2) * 22}" r="6"/>`).join("")}`,
    splitter: t && t.style === "Bare"
      ? `<path d="M6 40h30"/><rect x="36" y="32" width="28" height="16" rx="3"/><path d="M64 36l40-20M64 38l40-8M64 40h40M64 42l40 8M64 44l40 20"/>`
      : t && t.style === "Plug-and-play module"
        ? `<rect x="22" y="14" width="40" height="56" rx="3"/><path d="M62 24h30M62 34h30M62 44h30M62 54h30" /><circle cx="42" cy="22" r="3"/><path d="M30 34h24M30 44h24M30 54h24" opacity=".5"/>`
        : `<rect x="14" y="24" width="92" height="32" rx="3"/><path d="M24 40h10"/><path d="M34 34v12l10-6z"/><path d="M44 40l20-10M44 40h20M44 40l20 10"/>
          ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${70 + (i % 3) * 10}" y="${30 + Math.floor(i / 3) * 12}" width="6" height="6" rx="1"/>`).join("")}`,
    other: `<rect x="30" y="20" width="60" height="44" rx="6"/><path d="M60 36v14"/><circle cx="60" cy="30" r="2" fill="currentColor"/>`,
  }[kind] || "";
  const wrap = document.createElement("div");
  wrap.className = "hw-pic";
  wrap.innerHTML = `<svg viewBox="0 0 120 80" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${draw}</g></svg>`;
  return wrap;
}
