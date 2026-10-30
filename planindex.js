// Fast lookups for big plans.
// point(), incomingPath(), incomingCable() and the like each search the
// whole plan, and drawing or checking a plan calls them for every
// location, cable and fiber: on a plan of 500 locations that is seconds.
// While the plan is only being read (drawn, checked, counted, printed),
// they look things up in an index built once instead.
//
// The index lives only while one of the reading functions listed at the
// bottom runs (and anything it calls), then it's dropped, so a change
// made after it never meets an old index. It's built again if the plan
// is swapped (Undo, open) or something is added or removed meanwhile.
// Outside those functions every lookup searches the plan as before.

let planIdx = null;

function buildPlanIndex() {
  const ix = {
    plan, points: plan.points, paths: plan.paths, cables: plan.cables, xconnects: plan.xconnects,
    nPoints: plan.points.length, nPaths: plan.paths.length, nCables: plan.cables.length, nXconnects: (plan.xconnects || []).length,
    point: new Map(),
    // Equipment id -> the location it sits at.
    eqAt: new Map(),
    pathTo: new Map(),
    pathsFrom: new Map(),
    cable: new Map(),
    cablesTo: new Map(),
    cablesFrom: new Map(),
    // Worked out the first time they're asked for.
    incoming: new Map(),
    next: new Map(),
    onward: new Map(),
    colors: new Map(),
    // fixedInUse (paths.js): physical cable id -> what takes its fibers.
    fiberUsers: null,
    // Splitter id -> the homes with a DS on it, home -> the splitter
    // feeding it (homeSplitter) and splitter -> its first free port
    // (nextFreePort). DS counts change while counts are worked
    // out, so these are dropped whenever they do.
    ds: null,
    homeSplitter: new Map(),
    freePort: new Map(),
    routeOrder: null,
  };
  const add = (map, key, item) => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };
  // The first match wins, as with find().
  for (const p of plan.points) {
    if (!ix.point.has(p.id)) ix.point.set(p.id, p);
    for (const e of p.equipment || []) if (!ix.eqAt.has(e.id)) ix.eqAt.set(e.id, p);
  }
  for (const x of plan.paths) {
    if (!ix.pathTo.has(x.to)) ix.pathTo.set(x.to, x);
    add(ix.pathsFrom, x.from, x);
  }
  for (const c of plan.cables) {
    if (!ix.cable.has(c.id)) ix.cable.set(c.id, c);
    add(ix.cablesTo, c.to, c);
    add(ix.cablesFrom, c.from, c);
  }
  return ix;
}

// The index while one is in use, rebuilt if the plan changed under it;
// null outside the reading functions.
function planIndex() {
  const ix = planIdx;
  if (!ix || !plan) return null;
  if (ix.plan !== plan || ix.points !== plan.points || ix.paths !== plan.paths || ix.cables !== plan.cables ||
    ix.xconnects !== plan.xconnects || ix.nPoints !== plan.points.length || ix.nPaths !== plan.paths.length ||
    ix.nCables !== plan.cables.length || ix.nXconnects !== (plan.xconnects || []).length) {
    planIdx = buildPlanIndex();
  }
  return planIdx;
}

// DS counts were changed (autoCounts).
function planIndexDsChanged() {
  if (planIdx) {
    planIdx.ds = null;
    planIdx.homeSplitter = new Map();
    planIdx.freePort = new Map();
  }
}

// Splitter id -> homes with a DS on it, in plan order.
function indexedDsHomes(ix) {
  if (!ix.ds) {
    ix.ds = new Map();
    for (const h of plan.points) {
      if (h.type !== "nid" || !h.ds) continue;
      const list = ix.ds.get(h.ds.splitterId);
      if (list) list.push(h);
      else ix.ds.set(h.ds.splitterId, [h]);
    }
  }
  return ix.ds;
}

// Runs fn with the index in use (one already in use is kept).
function withPlanIndex(fn) {
  const wrapped = function (...args) {
    if (planIdx || !plan) return fn.apply(this, args);
    planIdx = buildPlanIndex();
    try {
      return fn.apply(this, args);
    } finally {
      planIdx = null;
    }
  };
  wrapped.unindexed = fn;
  return wrapped;
}

// The functions that only read the plan (they may set F2 and DS counts,
// which the index allows for, but never add, remove or move anything).
// Wrapped once every script has loaded.
const INDEXED_READERS = [
  "renderRoute", "autoCounts", "checkPlan", "buildSpliceModel", "updateCheckBadge", "refreshFeatures", "renderFeatures",
  // The Fed from list in Unassigned homes.
  "feederOptions",
  // Print and Excel (only up to its first await: the rows are made by then).
  "buildSheet", "saveAssignmentXlsx",
];

document.addEventListener("DOMContentLoaded", () => {
  for (const name of INDEXED_READERS) {
    if (typeof window[name] === "function" && !window[name].unindexed) window[name] = withPlanIndex(window[name]);
  }
});
