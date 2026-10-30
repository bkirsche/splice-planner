// Speed and sameness check for big plans. Not part of the app: paste it
// into the console of a running copy (or inject it), then
//   await perfCheck(planText)
// It opens the plan, times the everyday actions (opening, areas, the
// layouts, assign, rename, splice, Feature editor, Check plan, Fix all,
// print, Excel, Undo) and hashes what each one produces: the saved plan,
// Check plan findings, F2/DS counts, tray slots, the drawn views, the
// print sheet and the Excel rows. Run it on two copies of the app (say
// main and a branch) and compare: the hashes must match exactly.
// Ids and times are made repeatable while it runs.

(() => {
  // A hidden page gets no frames and slowed timers, so short timers run
  // as soon as the page is free while the check runs.
  const realTimeout = window.setTimeout;
  const chan = new MessageChannel();
  const queue = [];
  chan.port1.onmessage = () => queue.shift()();
  const soon = (fn) => {
    queue.push(fn);
    chan.port2.postMessage(0);
  };
  const fastTimeout = (fn, ms = 0, ...args) => {
    if (ms > 50 || typeof fn !== "function") return realTimeout(fn, ms, ...args);
    soon(() => fn(...args));
    return 0;
  };
  // Until the change is laid out and the page is free again. (Frames
  // don't come at all while the preview pane is hidden.)
  const paint = () => new Promise((r) => {
    void document.body.offsetHeight;
    soon(r);
  });
  const wait = () => new Promise((r) => soon(r));

  // FNV-1a, enough to tell two outputs apart.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0") + ":" + s.length;
  }

  // JSON of anything: no functions, Maps and Sets as lists, repeats cut.
  function plain(v) {
    const seen = new WeakSet();
    return JSON.stringify(v, (k, x) => {
      if (typeof x === "function") return undefined;
      if (x instanceof Map) return [...x];
      if (x instanceof Set) return [...x];
      if (x && typeof x === "object") {
        if (x instanceof Node) return "[node]";
        if (seen.has(x)) return "[seen]";
        seen.add(x);
      }
      return x;
    });
  }

  function saved() {
    return (localStorage.getItem(STORAGE_KEY) || "").replace(/"editedAt":"[^"]*"/g, '"editedAt":""');
  }

  function findings() {
    return plain(checkPlan().map((f) => ({ level: f.level, code: f.code, text: f.text, key: f.key, about: f.about, loc: f.loc && f.loc.id })));
  }

  function counts() {
    const out = [];
    for (const p of routeOrder()) {
      for (const s of splittersAt(p)) out.push(["s", s.id, s.f2, f2Label(s), usedPorts(s).size, isCascade(s)]);
      if (p.type === "nid") out.push(["h", p.id, homeDs(p), (homeF2(p) || {}).id || null, (homeSplitter(p) || {}).id || null]);
      const feed = dsFeed(p.id);
      out.push(["d", p.id, feed ? feed.free : null]);
    }
    return plain(out);
  }

  function slots() {
    const model = buildSpliceModel();
    return plain(plan.points.map((L) => [L.id, spliceSlots(model, L), connectionsAt(model, L.id)]));
  }

  function views() {
    return hash(document.getElementById("route-tree").innerHTML + document.getElementById("route-table").innerHTML);
  }

  function setLayout(name) {
    fold.layout = name;
    areaView.on = false;
    renderRoute();
  }

  // Repeatable ids and times.
  function seed() {
    let s = 12345;
    const rand = Math.random;
    const now = Date.now;
    let t = 1767000000000;
    Math.random = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
    Date.now = () => (t += 7);
    return () => {
      Math.random = rand;
      Date.now = now;
    };
  }

  async function time(fn) {
    const t = performance.now();
    await fn();
    await paint();
    return Math.round(performance.now() - t);
  }

  window.perfCheck = async function (text, { only = null } = {}) {
    const unseed = seed();
    window.setTimeout = fastTimeout;
    // The same named user every time (a guest can't edit).
    const keepUser = userNow;
    userNow = "Perf check";
    applyUser();
    const ms = {};
    const out = {};
    const keepLayout = fold.layout;
    const keepSave = window.saveFileAs;
    const keepXlsx = window.makeXlsx;
    try {
      const step = async (name, fn, check) => {
        if (only && !only.includes(name)) return;
        window.perfStep = name;
        ms[name] = await time(fn);
        if (check) out[name] = check();
      };
      // The same view every time: Auto layout, nothing unfolded.
      fold.layout = "auto";
      for (const k of ["homes", "spots", "branches"]) fold[k].clear();
      await step("open plan", () => loadPlanText(text, "plan.ffhspl"), () => hash(saved()) + " " + views());
      out.findings = hash(findings());
      out.counts = hash(counts());
      out.slots = hash(slots());

      const firstArea = areaStarts()[1] || areaStarts()[0];
      await step("open area page", () => areaGo(firstArea.id), views);
      await step("full route", () => setLayout("full"), views);
      await step("compact route", () => setLayout("compact"), views);
      await step("grid layout", () => setLayout("grid"), views);
      await step("table layout", () => setLayout("table"), views);
      setLayout("compact");

      // Unassign the first six homes, then Assign them back from the dialog.
      // (Homes with no splices made by hand, so no question is asked.)
      const homes = routeOrder().filter((p) => p.type === "nid" && !handSplicesOn([p])).slice(0, 6);
      const fedFrom = incomingPath(homes[0].id).from;
      await step("unassign 6 homes", () => unassignHomes(homes), () => hash(saved()));
      await step("assign 6 homes", () => {
        openAssign(fedFrom);
        const form = document.getElementById("form-panel") || formPanel;
        const all = form.querySelector("label.toggle input[type=checkbox]");
        all.checked = false;
        all.dispatchEvent(new Event("change"));
        const names = new Set(homes.map((h) => h.name));
        for (const tr of form.querySelectorAll("table.preview tr")) {
          const box = tr.querySelector("input[type=checkbox]");
          if (box && [...names].some((n) => tr.textContent.includes(n))) {
            box.checked = true;
            box.dispatchEvent(new Event("change"));
          }
        }
        [...form.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Assign")).click();
        closePanels();
      }, () => hash(saved()) + " " + hash(findings()) + " " + hash(counts()));

      const loc = plan.points.find((p) => p.type !== "nid" && p !== plan.points[0]);
      await step("rename location", () => {
        loc.name = loc.name + " X";
        savePlan();
        renderRoute();
      }, () => hash(saved()) + " " + views());

      // A splice: the first free fiber of the cable feeding a closure to
      // the first free fiber of a cable leaving it.
      const model0 = buildSpliceModel();
      const L = plan.points.find((p) => closureAt(p) && incomingCable(p.id) && childCables(p.id).some((c) => !c.through));
      await step("splice in editor", () => {
        openConnections(L.id);
        const inC = incomingCable(L.id);
        const outC = childCables(L.id).find((c) => !c.through);
        const conns = connectionsAt(model0, L.id);
        const usedIn = new Set(conns.map((c) => c.from));
        const usedOut = new Set(conns.map((c) => c.to));
        let a = null;
        let b = null;
        for (let n = inC.fibers; n >= 1 && !a; n--) if (!usedIn.has(`fiber:${inC.id}:${n}`)) a = `fiber:${inC.id}:${n}`;
        for (let n = outC.fibers; n >= 1 && !b; n--) if (!usedOut.has(`fiber:${outC.id}:${n}`)) b = `fiber:${outC.id}:${n}`;
        if (a && b) connect(L.id, a, b);
      }, () => hash(saved()) + " " + hash(slots()));
      closePanels();

      // The Feature editor on cables (the longest list): one cell typed
      // in, then a bulk Set of the same column on 40 rows.
      await step("feature editor open", () => openFeatures("cables"));
      const feT = feType();
      const feCol = feCols(feT).find((c) => c.edit === "text" && c.set && c.key !== "name") || feCols(feT).find((c) => c.edit === "text" && c.set);
      // As when typing: the cell has the focus.
      const feCell = () => fePanel.querySelector("[data-cell]").focus();
      await step("feature editor edit", () => {
        feCell();
        feApply(feT, feCol, feRows(feT).slice(0, 1), "Perf 1");
      }, () => hash(saved()));
      await step("feature editor bulk set", () => {
        feCell();
        feApply(feT, feCol, feRows(feT).slice(1, 41), "Perf 40");
      }, () => hash(saved()));
      closeFeatures && closeFeatures();

      await step("check plan", () => openCheck(null), () => hash(findings()));
      const groups = checkGroups(checkPlan()).filter((g) => g.items.some((f) => f.fix) && !g.items.some((f) => f.fix && f.fix.ask));
      if (groups[0]) {
        await step("fix all", async () => {
          const n = undoStack.length;
          runFixAll(groups[0]);
          for (let i = 0; i < 200000 && undoStack.length === n && !document.querySelector(".undo-text")?.textContent.startsWith("Nothing"); i++) await wait(20);
        }, () => hash(saved()) + " " + hash(findings()));
      }
      closePanels();

      let sheets = null;
      window.makeXlsx = (s) => {
        sheets = s;
        return new Blob([]);
      };
      window.saveFileAs = async () => null;
      await step("excel export", () => saveAssignmentXlsx(), () => hash(plain(sheets)));
      await step("print preview", () => {
        plan.print = { overview: true, locations: true, summary: true, assign: true, tiles: false };
        renderPrintParts();
      }, () => hash(document.getElementById("print-sheet").innerHTML));
      closePrint();

      await step("undo", () => undoStep(undoStack[undoStack.length - 1]), () => hash(saved()) + " " + hash(findings()));
      out.findingsEnd = hash(findings());
      out.countsEnd = hash(counts());
      out.slotsEnd = hash(slots());
    } finally {
      unseed();
      window.setTimeout = realTimeout;
      userNow = keepUser;
      applyUser();
      window.saveFileAs = keepSave;
      window.makeXlsx = keepXlsx;
      fold.layout = keepLayout;
    }
    window.perfStep = "done";
    return { ms, out };
  };
})();
