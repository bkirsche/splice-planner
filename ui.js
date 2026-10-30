// Small helpers for building forms and dialogs, shared by every screen.

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// options: [{ value, label, disabled, group, className }]. Options with
// the same group sit together under a heading in the dropdown.
function selectEl(options, value) {
  const s = document.createElement("select");
  let group = null;
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = String(o.value);
    opt.textContent = o.label;
    if (o.disabled) opt.disabled = true;
    if (o.className) opt.className = o.className;
    if (o.group) {
      if (!group || group.label !== o.group) {
        group = document.createElement("optgroup");
        group.label = o.group;
        s.append(group);
      }
      group.append(opt);
    } else {
      group = null;
      s.append(opt);
    }
  }
  if (value !== undefined && value !== null) s.value = String(value);
  return s;
}

function inputEl(type, value, attrs = {}) {
  const i = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") i.type = type;
  if (value !== undefined && value !== null) i.value = value;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  if (type === "text") i.autocomplete = "off";
  return i;
}

// A labeled row in a form.
function fieldEl(label, control, hint) {
  const row = el("label", "field-row");
  row.append(el("span", "field-label", label), control);
  if (hint) row.append(el("span", "field-hint", hint));
  return row;
}

function btnEl(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function xButton(onClick) {
  const x = btnEl("×", (e) => {
    e.stopPropagation();
    onClick();
  }, "dialog-x");
  x.title = "Close";
  x.setAttribute("aria-label", "Close");
  return x;
}

// --- Dialogs ---
// Only one dialog is open at a time. Each one is registered with the
// function that hides it and clears its state; the X in its corner also
// clears the selected location.

const panels = [];

function registerPanel(panel, reset) {
  panel.prepend(xButton(() => {
    reset();
    selectedId = null;
    renderRoute();
  }));
  dragByTitle(panel);
  panels.push({ panel, reset });
}

// A dialog moves when you drag its title bar (the strip down to the
// bottom of its title), so you can see the cards behind it. It stays on
// screen, and opens centred again next time.
function dragByTitle(panel) {
  const title = () => panel.querySelector(":scope > h3");
  const onBar = (e) => {
    const h = title();
    if (!h || e.button !== 0 || e.target.closest("button, input, select, textarea, a, label")) return false;
    return e.clientY <= h.getBoundingClientRect().bottom;
  };
  let drag = null;
  panel.addEventListener("pointermove", (e) => {
    if (!drag) panel.classList.toggle("on-title", onBar(e));
  });
  panel.addEventListener("pointerleave", () => drag || panel.classList.remove("on-title"));
  panel.addEventListener("pointerdown", (e) => {
    if (!onBar(e)) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const [ox, oy] = (panel.style.translate || "0px 0px").split(" ").map((v) => parseFloat(v) || 0);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox, oy, r };
    panel.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
  });
  panel.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { r } = drag;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const dx = clamp(e.clientX - drag.x, -r.left, innerWidth - r.right);
    const dy = clamp(e.clientY - drag.y, -r.top, innerHeight - r.bottom);
    panel.style.translate = `${drag.ox + dx}px ${drag.oy + dy}px`;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    panel.classList.remove("dragging");
  };
  panel.addEventListener("pointerup", end);
  panel.addEventListener("pointercancel", end);
  // Closed, or the window resized: back to the middle.
  new MutationObserver(() => panel.hidden && (panel.style.translate = "")).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  addEventListener("resize", () => (panel.style.translate = ""));
}

function closePanels() {
  for (const p of panels) if (!p.panel.hidden) p.reset();
}

// The general-purpose form dialog: a title, a body built by the caller
// and a row of buttons.
const formPanel = document.getElementById("form-panel");
const formTitle = document.getElementById("form-title");
const formBody = document.getElementById("form-body");
const formFoot = document.getElementById("form-foot");
const formError = document.getElementById("form-error");

function openForm(title, build, wide) {
  closePanels();
  closeMenu();
  formPanel.classList.toggle("wide", !!wide);
  formPanel.classList.remove("cx-panel");
  formTitle.textContent = title;
  formBody.innerHTML = "";
  formFoot.innerHTML = "";
  formError.hidden = true;
  build(formBody, formFoot);
  formPanel.hidden = false;
  formPanel.scrollTop = 0;
  // Only jump to a box you type in; lists of equipment or ports stay put.
  const first = formBody.querySelector(".field-row input[type=text], .field-row textarea");
  if (first) first.focus();
}

function closeForm() {
  formPanel.hidden = true;
  openPathId = null;
  formBody.innerHTML = "";
  formFoot.innerHTML = "";
}

registerPanel(formPanel, closeForm);

// Enter in a box you type in presses the dialog's main button (Save, Add,
// Done). Not in a textarea, where Enter starts a new line, and not where
// a box has its own action for Enter (it calls preventDefault first).
formPanel.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.defaultPrevented || e.isComposing) return;
  const t = e.target;
  // A search box only filters a list; Enter there shouldn't save.
  if (t.tagName !== "INPUT" || ["checkbox", "radio", "button", "submit", "file", "color", "range", "search"].includes(t.type)) return;
  const main = [...formFoot.querySelectorAll(".btn.big")].filter((b) => !b.disabled && b.offsetParent).pop();
  if (!main) return;
  e.preventDefault();
  main.click();
});

// Cancel and Save buttons for the bottom of a form. onSave returns an
// error message to keep the form open, or nothing when it's done.
function formButtons(foot, onSave, saveLabel = "Save") {
  const save = btnEl(saveLabel, () => {
    const problem = onSave();
    formError.hidden = !problem;
    if (problem) formError.textContent = problem;
  }, "btn big");
  foot.append(btnEl("Cancel", () => {
    closeForm();
    selectedId = null;
    renderRoute();
  }, "btn ghost"), save);
  return save;
}

// --- Selecting several ---
// The classic way, everywhere: a click picks just that one, Ctrl (Cmd on
// a Mac) adds or drops one, Shift picks the run from the last one
// clicked. A touch screen has no Ctrl, so a tap adds or drops one there.
// `order` is every key in the order shown; `at` remembers the last one.

function isAddClick(e) {
  return !!(e && (e.ctrlKey || e.metaKey || e.pointerType === "touch"));
}

function selectClick(set, order, key, e, at) {
  if (e && e.shiftKey && at.key != null && order.includes(at.key) && order.includes(key)) {
    const i = order.indexOf(at.key);
    const j = order.indexOf(key);
    if (!isAddClick(e)) set.clear();
    for (const k of order.slice(Math.min(i, j), Math.max(i, j) + 1)) set.add(k);
    return;
  }
  if (isAddClick(e)) set.has(key) ? set.delete(key) : set.add(key);
  else {
    set.clear();
    set.add(key);
  }
  at.key = key;
}

// A key that types, rather than one that acts on a list.
function typingIn(target) {
  return !!(target && target.closest && target.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]"));
}

// --- Asking first ---
// The app doesn't ask "are you sure?"; it offers Undo. Taking splices
// apart is the one exception: it asks, then still offers Undo.

const confirmPanel = el("div", "wizard confirm-panel");
confirmPanel.hidden = true;
confirmPanel.setAttribute("role", "alertdialog");
confirmPanel.setAttribute("aria-modal", "true");
const confirmShade = el("div", "confirm-shade");
confirmShade.hidden = true;
document.body.append(confirmShade, confirmPanel);
let confirmBack = null;

function confirmBox(title, text, okLabel, onOk) {
  const back = document.activeElement;
  confirmPanel.innerHTML = "";
  const close = () => {
    confirmPanel.hidden = true;
    confirmShade.hidden = true;
    confirmBack = null;
    if (back && back.isConnected) back.focus();
  };
  confirmBack = close;
  const h = el("h3", "", title);
  h.id = "confirm-title";
  confirmPanel.setAttribute("aria-labelledby", h.id);
  const foot = el("div", "row confirm-foot");
  const ok = btnEl(okLabel, () => {
    close();
    onOk();
  }, "btn big danger-solid");
  foot.append(btnEl("Cancel", close, "btn ghost"), ok);
  confirmPanel.append(xButton(close), h, el("p", "", text), foot);
  confirmPanel.hidden = false;
  confirmShade.hidden = false;
  ok.focus();
}
dragByTitle(confirmPanel);
confirmShade.addEventListener("click", () => confirmBack && confirmBack());

// Esc closes the question, and only the question.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !confirmBack) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  confirmBack();
}, true);

// --- Undo bar ---
// No Yes/No popups: things happen right away, and a bar at the bottom
// offers to take them back for a few seconds.

const undoBar = el("div", "undo-bar");
undoBar.hidden = true;
undoBar.setAttribute("role", "status");
document.body.append(undoBar);
let undoTimer = null;

function showNote(text, undo, ms = 0) {
  clearTimeout(undoTimer);
  undoBar.innerHTML = "";
  undoBar.append(el("span", "undo-text", text));
  if (undo) {
    undoBar.append(btnEl("Undo", () => {
      undoBar.hidden = true;
      undo();
    }, "undo-btn"));
  }
  const x = btnEl("×", () => (undoBar.hidden = true), "undo-x");
  x.setAttribute("aria-label", "Dismiss");
  undoBar.append(x);
  undoBar.hidden = false;
  undoTimer = setTimeout(() => (undoBar.hidden = true), ms || (undo ? 10000 : 6000));
}

// Snapshot the plan, do `act`, and offer Undo. Undo puts the whole plan
// back and closes any open dialog, since it showed the old state.
// `reopen` puts back the screen the user was on after an Undo.
function withUndo(text, act, reopen = null) {
  const before = JSON.stringify(plan);
  const result = act();
  savePlan();
  renderRoute();
  offerUndo(text, before, reopen);
  return result;
}

// Every change that offers Undo is kept (the last 30), so Ctrl+Z can
// take them back one at a time, newest first, after the bar has gone.
const undoStack = [];

function offerUndo(text, before, reopen = null) {
  const step = { text, before, reopen };
  undoStack.push(step);
  if (undoStack.length > 30) undoStack.shift();
  showNote(text, () => undoStep(step));
}

// A plan of its own (new, opened, resumed or cleared) starts with no
// history, so Ctrl+Z can't bring back a plan from before it.
function clearUndo() {
  undoStack.length = 0;
  clearTimeout(undoTimer);
  undoBar.hidden = true;
}

// Put the plan back to before `step` (and drop it and anything after).
function undoStep(step) {
  const i = undoStack.indexOf(step);
  if (i >= 0) undoStack.length = i;
  plan = migratePlan(JSON.parse(step.before));
  savePlan();
  closePanels();
  closeMenu();
  selectedId = null;
  if (typeof show === "function") show("route");
  if (step.reopen) step.reopen();
  showNote(`Undone: ${step.text}`);
}

// Ctrl+Z (Cmd+Z on a Mac) undoes the last change. In a box you're typing
// in it undoes the typing instead, as it always does.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z" || typingIn(e.target)) return;
  if (!undoStack.length) return showNote("Nothing to undo.");
  e.preventDefault();
  undoStep(undoStack[undoStack.length - 1]);
});

// Enter in a grid of boxes moves down to the same box on the next row
// (Shift+Enter: the row above), like a spreadsheet. Boxes carry
// data-cell="<row id>|<column>". Gives the box to go to, if any.
function cellBelow(box, up) {
  const tr = box.closest("tr");
  const col = (box.dataset.cell || "").split("|")[1];
  for (let r = up ? tr.previousElementSibling : tr.nextElementSibling; r; r = up ? r.previousElementSibling : r.nextElementSibling) {
    const next = col && r.querySelector(`[data-cell$="|${CSS.escape(col)}"]`);
    if (next) return next;
  }
  return null;
}

// Focus a box and select what's in it, so typing replaces it.
function focusCell(box) {
  if (!box) return;
  box.focus();
  if (box.select && box.tagName === "INPUT") box.select();
}

// --- Locks ---
// Values the app fills in (F2, DS, fiber picks, names) carry a small
// lock. Locked: the app keeps the value up to date and shows it. Tap to
// unlock and set it by hand; tap again to hand it back to the app.

function lockEl(locked, onToggle, what = "this") {
  const b = el("button", "lock-btn" + (locked ? "" : " open"));
  b.type = "button";
  b.append(iconEl(locked ? "lock" : "unlock"));
  b.title = locked ? `Automatic. Tap to unlock and set ${what} by hand.` : `Set by hand. Tap to lock ${what} back to automatic.`;
  b.setAttribute("aria-label", b.title);
  b.setAttribute("aria-pressed", String(!locked));
  b.addEventListener("pointerdown", (e) => e.stopPropagation());
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle(!locked);
  });
  return b;
}

// The lock, then the app's value (locked) or the controls to change it.
function lockField(locked, autoView, editor, onToggle, what) {
  const wrap = el("span", "lock-field" + (locked ? " locked" : " unlocked"));
  wrap.append(lockEl(locked, onToggle, what), locked ? autoView : editor);
  return wrap;
}
