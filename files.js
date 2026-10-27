// Plan files (.ffhspl, JSON inside), so a plan can be backed up, sent
// to someone else or handed to a crew. Sharing is by file only: "Save"
// writes a file named with the job, who saved it and the date, and
// the file remembers who made the plan and who last changed it. Old
// .json plan files still open.

const PLAN_FILE_VERSION = 3;
const PLAN_EXT = ".ffhspl";

function planFileName() {
  const date = new Date().toISOString().slice(0, 10);
  const job = (plan.title || plan.points[0].name).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  const who = currentUser().replace(/[^\w-]+/g, "-");
  return `${job}_${who}_${date}${PLAN_EXT}`;
}

function planFileText() {
  return JSON.stringify({ app: "splice-planner", version: PLAN_FILE_VERSION, savedBy: currentUser(), savedAt: new Date().toISOString(), plan }, null, 2);
}

function downloadFile(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Saves a file the way this device can. On a phone this opens the share
// sheet (Messages, Mail, Files ...). Chrome and Edge open a "Save as"
// window to pick the folder and name. Elsewhere (Firefox) the file
// downloads, and the first time a tip says how to get Firefox to ask.
// Resolves to the saved file's name, or null if the user cancelled.
// `type`: { description, mime, ext }.
async function saveFileAs(name, blob, type) {
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: type.mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: plan.title || type.description });
        return name;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return null;
    }
  }
  if ("showSaveFilePicker" in window) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: type.description, accept: { [type.mime]: [type.ext] } }],
      });
    } catch (err) {
      if (err && err.name === "AbortError") return null;
      handle = null;
    }
    if (handle) {
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return handle.name;
    }
  }
  downloadFile(name, blob);
  return name;
}

const SAVE_TIP_KEY = "splicePlanner.saveAsTipShown";

// Firefox has no "Save as" window for web apps, but it can be told to
// ask where every download goes. Said once per device.
function saveAsTip() {
  if ("showSaveFilePicker" in window || matchMedia("(pointer: coarse)").matches) return "";
  try {
    if (localStorage.getItem(SAVE_TIP_KEY)) return "";
    localStorage.setItem(SAVE_TIP_KEY, "1");
  } catch {
    return "";
  }
  const where = /Firefox\//.test(navigator.userAgent)
    ? "In Firefox: Settings, General, Downloads: turn on \"Always ask you where to save files\""
    : "Turn on \"Ask where to save each file\" in this browser's download settings";
  return ` It went to your Downloads folder. To pick the folder and name each time: ${where}.`;
}

// Field crews save too: their notes and as-builts go back in the file.
document.getElementById("share-plan").addEventListener("click", async () => {
  if (emptyBlocked()) return;
  savePlan();
  const blob = new Blob([planFileText()], { type: "application/json" });
  let name;
  try {
    name = await saveFileAs(planFileName(), blob, { description: "Splice plan", mime: "application/json", ext: PLAN_EXT });
  } catch {
    return showNote("Couldn't save the file. Try again, or pick another folder.");
  }
  if (!name) return;
  const tip = saveAsTip();
  showNote(`Saved ${name}. Send that file to share the plan.${tip}`, null, tip ? 20000 : 0);
});

// --- Opening ---

const openInput = document.getElementById("open-plan-file");
// iPhones grey out file types they don't know (like .ffhspl) when the
// picker is limited to them, so there it accepts anything and the file
// is checked once it's read.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if (isIOS) openInput.removeAttribute("accept");

document.querySelectorAll("[data-open-plan]").forEach((b) =>
  b.addEventListener("click", () => {
    openInput.value = "";
    openInput.click();
  }));

openInput.addEventListener("change", () => {
  const file = openInput.files[0];
  if (file) openPlanFile(file);
});

function openPlanFile(file) {
  const reader = new FileReader();
  reader.onload = () => loadPlanText(String(reader.result), file.name);
  reader.readAsText(file);
}

function loadPlanText(text, fileName) {
  const notPlan = `${fileName} isn't a splice plan. Pick a ${PLAN_EXT} (or older .json) file saved from this app.`;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return showNote(notPlan);
  }
  const loaded = data && (data.plan || data);
  if (!loaded || !Array.isArray(loaded.points) || !loaded.points.length || !Array.isArray(loaded.cables)) return showNote(notPlan);
  const before = plan && JSON.stringify(plan);
  plan = migratePlan(loaded);
  resetEditBaseline();
  savePlan();
  closeMenu();
  closePanels();
  selectedId = null;
  show("route");
  // A plan just opened is shown whole, whatever its size.
  requestAnimationFrame(() => requestAnimationFrame(() => fitAll()));
  // "From Dave, Oct 20"
  const who = data.savedBy && data.savedBy !== GUEST ? data.savedBy : plan.editedBy || plan.createdBy;
  const when = data.savedAt || plan.editedAt;
  const from = who ? `From ${who}${when ? `, ${shortDate(when)}` : ""}. ` : "";
  plan.receivedFrom = who ? { by: who, at: when || null } : undefined;
  if (before) offerUndo(`${from}Opened ${fileName}. The plan that was on screen is replaced.`, before);
  else showNote(`${from}Opened ${fileName}.`);
  renderHeader();
}

// --- Autosave ---
// Chrome and Edge (and the installed app) can keep writing the plan file
// itself: turn Autosave on, pick where the file goes once, and every
// change is saved there a moment later. The spot is remembered for that
// plan on this device; after the app reopens, the browser asks once
// before writing to it again. Other browsers keep the Save button only.

const AUTOSAVE_DELAY = 1500;
const autosaveBox = document.getElementById("autosave");
const autosaveOn = document.getElementById("autosave-on");
const autosaveNote = document.getElementById("autosave-note");
const canAutosave = "showSaveFilePicker" in window;
// { key: the plan it's for, handle, paused, saving, savedAt, error }
let autosave = null;
let autosaveTimer = null;

// The plan's own key: when it was made, which stays with the file.
function planKey() {
  return plan && plan.createdAt;
}

function handleStore(mode, act) {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open("splicePlanner", 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.result.createObjectStore("autosave");
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const tx = req.result.transaction("autosave", mode);
      const r = act(tx.objectStore("autosave"));
      tx.oncomplete = () => resolve(r && r.result);
      tx.onerror = () => resolve(null);
    };
  });
}

// After a plan opens: pick up its autosave spot, if it had one here.
async function syncAutosave() {
  if (!canAutosave) return;
  if (autosave && autosave.key !== planKey()) autosave = null;
  if (!autosave && planKey()) {
    const key = planKey();
    const handle = await handleStore("readonly", (s) => s.get(key));
    if (handle && planKey() === key && !autosave) autosave = { key, handle, paused: true };
  }
  renderAutosave();
}

function renderAutosave() {
  autosaveBox.hidden = !canAutosave || !plan;
  if (autosaveBox.hidden) return;
  autosaveOn.checked = !!autosave && !autosave.paused;
  let note = "";
  let tip = "Save the plan file by itself as you work";
  if (autosave && autosave.paused) {
    note = "Paused: tap to resume";
    tip = `Tap to keep saving to ${autosave.handle.name}`;
  } else if (autosave && autosave.error) {
    note = "Couldn't save: tap to retry";
    tip = autosave.error;
  } else if (autosave && autosave.saving) note = "Saving…";
  else if (autosave && autosave.savedAt) {
    note = `Saved ${ago(autosave.savedAt)}`;
    tip = `Saving to ${autosave.handle.name}`;
  }
  autosaveNote.textContent = note;
  autosaveBox.title = tip;
}

function ago(t) {
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} hr ago`;
}

setInterval(() => autosave && autosave.savedAt && renderAutosave(), 30000);

autosaveBox.addEventListener("click", (e) => {
  // The note under a paused or failed autosave resumes it.
  if (e.target === autosaveOn || !autosave || !(autosave.paused || autosave.error)) return;
  e.preventDefault();
  resumeAutosave();
});

autosaveOn.addEventListener("change", async () => {
  if (!autosaveOn.checked) {
    const key = autosave && autosave.key;
    autosave = null;
    clearTimeout(autosaveTimer);
    if (key) handleStore("readwrite", (s) => s.delete(key));
    showNote("Autosave is off. Use Save to keep a copy.");
    return renderAutosave();
  }
  if (guestBlocked() || emptyBlocked()) return renderAutosave();
  if (autosave && autosave.paused) return resumeAutosave();
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: planFileName(),
      types: [{ description: "Splice plan", accept: { "application/json": [PLAN_EXT] } }],
    });
  } catch {
    // Cancelled: stays off.
    return renderAutosave();
  }
  // Older plans may not say when they were made; the key needs it.
  if (!plan.createdAt) plan.createdAt = new Date().toISOString();
  autosave = { key: planKey(), handle };
  handleStore("readwrite", (s) => s.put(handle, autosave.key));
  await writeAutosave();
  if (!autosave.error) showNote(`Autosave is on: changes go to ${handle.name}.`);
});

async function resumeAutosave() {
  try {
    const ok = (await autosave.handle.requestPermission({ mode: "readwrite" })) === "granted";
    if (!ok) return renderAutosave();
  } catch {
    return renderAutosave();
  }
  autosave.paused = false;
  await writeAutosave();
}

// app.js savePlan calls this after every change.
function scheduleAutosave() {
  if (!autosave || autosave.paused || autosave.key !== planKey()) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(writeAutosave, AUTOSAVE_DELAY);
}

async function writeAutosave() {
  const a = autosave;
  if (!a || a.paused || !plan || planEmpty()) return;
  a.saving = true;
  renderAutosave();
  try {
    const out = await a.handle.createWritable();
    await out.write(planFileText());
    await out.close();
    a.savedAt = Date.now();
    a.error = null;
  } catch (err) {
    a.error = (err && err.message) || "The file couldn't be written.";
    // Permission lapsed (the app was closed): ask again on the next tap.
    if (err && err.name === "NotAllowedError") {
      a.paused = true;
      a.error = null;
    }
  }
  a.saving = false;
  renderAutosave();
}

// Installed on a computer (Chrome or Edge), the app can be the program
// that opens .ffhspl files: a double-click lands here.
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    for (const handle of params.files || []) {
      const file = await handle.getFile();
      return openPlanFile(file);
    }
  });
}
