// Fixing mistakes without starting over: move a location so it's fed
// from somewhere else. (Cable size, type and name are changed from the
// path; equipment from the Equipment dialog.)

// Everything downstream of a location, including itself.
function downstream(id) {
  const ids = new Set([id]);
  for (const x of childPaths(id)) for (const d of downstream(x.to)) ids.add(d);
  return ids;
}

// The location keeps everything fed from it; only where it's fed from
// changes. The path and any cable on it move with it.
function openMove(id) {
  const p = point(id);
  const path = incomingPath(id);
  const c = pathCable(path);
  const below = downstream(id);
  const options = plan.points
    .filter((x) => x.type !== "nid" && !below.has(x.id))
    .map((x) => ({ value: x.id, label: `${x.name} (${typeLabel(x.type)})` }));
  openForm(`Move ${p.name}`, (body, foot) => {
    const target = selectEl(options, path.from);
    body.append(fieldEl("Feed it from", target));
    if (c && (c.through || c.picks)) {
      body.append(el("p", "hint", c.through
        ? `${c.name} will start at the new location as a new cable.`
        : `The fibers picked for ${c.name} go back to automatic.`));
    }
    formButtons(foot, () => {
      if (target.value === path.from) return finish();
      const cables = pathCables(path);
      path.from = target.value;
      for (const x of cables) {
        if (x.to !== path.to) {
          // A cable laid back up the route now leaves by the new spot;
          // the rest of it, on from the old spot, is a cable of its own.
          const next = nextSpan(x);
          x.to = target.value;
          if (next) {
            delete next.through;
            delete next.prev;
            const name = nextCableName("cable", false);
            for (const s of cableSpans(next)) s.name = name;
          }
          continue;
        }
        x.from = target.value;
        delete x.picks;
        // A cable that passed through its old spot now starts at the new one.
        if (x.through) {
          delete x.through;
          delete x.prev;
          const name = nextCableName("cable", p.type === "nid");
          for (const s of cableSpans(x)) s.name = name;
        }
      }
      finish();
    }, "Move");
  });
  selectedId = id;
  renderRoute();
}
