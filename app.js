/* app.js — startup, screens, navigation */
import { state, save, newChat, wipe, exportData, importData } from "./storage.js";
import { askAI } from "./ai.js";
import { extractTools, runTool, rearmReminders, isSlash, getSlash } from "./tools.js";

const $ = id => document.getElementById(id);
const chat = $("chat"), input = $("input"), statusEl = $("status");

/* ---------- boot ---------- */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

function boot() {
  if (!state.chats.length) newChat(false);
  rearmReminders();
  renderChat();
  renderViews();
  $("modelSel").value = state.settings.model;
  $("ToolsOn").checked = state.settings.toolsOn;
  if (!state.settings.notifAsked && "Notification" in window) {
    // ask lazily only when they click the reminder bell (no nagging)
  }
}
addEventListener("DOMContentLoaded", boot);

/* ---------- navigation ---------- */
$("menuBtn")?.addEventListener("click", toggleDrawer);
$("drawerClose").addEventListener("click", toggleDrawer);
$("backdrop").addEventListener("click", toggleDrawer);
function toggleDrawer() {
  $("drawer").classList.toggle("open");
  $("backdrop").classList.toggle("show");
}
document.querySelectorAll(".d-btn").forEach(b =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".d-btn").forEach(x => x.classList.toggle("on", x === b));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    $("view-" + b.dataset.view).classList.add("active");
    toggleDrawer();
  }));

/* ---------- chat ---------- */
function bubble(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "you" : "bot");
  const who = role === "user" ? "🫵" : "✦";
  div.innerHTML = `<span class="who"></span><div class="body"></div>`;
  div.querySelector(".who").textContent = who;
  const body = div.querySelector(".body");
  body.textContent = text || "";
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return body;
}

function renderChat() {
  chat.innerHTML = "";
  const c = state.chats[state.activeChat];
  if (!c.messages.length) {
    bubble("assistant", "Hi — I'm hark. Whatever you need, let me handle it.\n\nTry: `\/remind 3600 stretch` · `\/calc 2^12` · `\/remember birthday | June 3`");
  }
  c.messages.forEach(m => bubble(m.role, m.content));
}

let controller = null;

$("composer").addEventListener("submit", async e => {
  e.preventDefault();
  if (controller) return;                       // busy
  const raw = input.value.trim();
  if (!raw) return;
  input.value = "";
  input.style.height = "auto";

  const active = state.chats[state.activeChat];

  /* slash commands short-circuit the model */
  if (isSlash(raw)) {
    const cmd = getSlash(raw);
    if (cmd) {
      bubble("user", raw);
      active.messages.push({ role: "user", content: raw });
      const result = await cmd.run(cmd.arg);
      bubble("assistant", result);
      active.messages.push({ role: "assistant", content: result });
      save(); renderViews(); return;
    }
  }

  if (!state.settings.toolsOn) raw = raw.replace(/\[TOOL:[^\]]*\]/gi, "");

  bubble("user", raw);
  active.messages.push({ role: "user", content: raw });

  /* stream the answer */
  const body = bubble("assistant", "");
  body.insertAdjacentHTML("beforeend", '<span class="cursor"></span>');
  let acc = "";
  const cursor = body.querySelector(".cursor");
  const onDelta = d => { acc += d; body.textContent = acc; body.appendChild(cursor); chat.scrollTop = chat.scrollHeight; };
  $("stopGen").hidden = false;
  statusEl.textContent = "thinking…";
  controller = new AbortController();

  try {
    const full = await askAI(active.messages.slice(0, -1).concat([{ role: "user", content: raw }]),
                             state.memory,
                             { onDelta, model: state.settings.model, signal: controller.signal });
    acc = full || acc;
  } catch (err) {
    acc = acc || `⚠️ ${err.message}`;
  }

  controller = null;
  $("stopGen").hidden = true;
  statusEl.textContent = "";
  cursor.remove();
  body.textContent = acc;

  /* run any tool markers */
  const tools = extractTools(acc);
  if (tools.length) {
    for (const t of tools) {
      const result = await runTool(t.name, t.arg);
      const card = document.createElement("div");
      card.className = "tcard";
      card.textContent = result;
      $("toolcards").appendChild(card);
    }
    $("toolcards").lastChild.scrollIntoView({ block: "nearest" });
  }

  if (!active.title) { active.title = raw.slice(0, 40); }
  active.messages.push({ role: "assistant", content: acc + (tools.length ? "" : "") });
  save();
  renderViews();
});

$("stopGen").addEventListener("click", () => { try { controller?.abort(); } catch {} });

input.addEventListener("keydown", e => {           // Enter sends, Shift+Enter is newline
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("send").click(); }
});
input.addEventListener("input", () => {            // autosize
  input.style.height = "auto";
  input.style.height = Math.min(180, input.scrollHeight) + "px";
});

/* model chip cycles auto → openai → openai-fast → mistral */
$("modelBtn").addEventListener("click", () => {
  const order = ["auto", ...(["openai", "openai-fast", "mistral"])];
  const i = (order.indexOf(state.settings.model) + 1) % order.length;
  state.settings.model = order[i];
  save();
  $("modelSel").value = order[i];
  $("modelBtn").textContent = order[i] + (order[i] === "auto" ? " ▾" : "");
});

/* ---------- storage UI ---------- */
$("btnNew").addEventListener("click", () => { newChat(true); renderChat(); toggleDrawer(); });
$("btnClear").addEventListener("click", () => {
  if (confirm("Delete ALL chats, memory, notes and reminders?")) { wipe(); location.reload(); }
});
$("btnExport").addEventListener("click", () => {
  const blob = new Blob([exportData()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hark-lite-export-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
});
$("btnImport").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(t => { importData(t); renderChat(); renderViews(); });
});

$("modelSel").addEventListener("change", () => {
  state.settings.model = $("modelSel").value;
  save();
});
$("ToolsOn").addEventListener("change", () => {
  state.settings.toolsOn = $("ToolsOn").checked;
  save();
});

$("memAdd").addEventListener("submit", e => {
  e.preventDefault();
  const k = $("memKey").value.trim(), v = $("memVal").value.trim();
  if (!k || !v) return;
  state.memory[k] = v;
  save();
  $("memKey").value = ""; $("memVal").value = "";
  renderViews();
});

/* notifications opt-in */
$("askNotif").addEventListener("click", async () => {
  if (!("Notification" in window)) return alert("Notifications unsupported here");
  const perm = await Notification.requestPermission();
  state.settings.notifAsked = true; save();
  $("askNotif").textContent = perm === "granted"
      ? "🔔 Notifications on" : "🔔 Notifications blocked by browser";
});

/* ---------- panel renderers ---------- */
function renderViews() {
  /* memory */
  const mem = $("memList"); mem.innerHTML = "";
  const entries = Object.entries(state.memory);
  if (!entries.length) mem.innerHTML = '<div class="empty">nothing remembered yet</div>';
  entries.forEach(([k, v]) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `<div><b>${esc(k)}</b><br><small>${esc(v)}</small></div>`;
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "✕";
    del.onclick = () => { delete state.memory[k]; save(); renderViews(); };
    el.appendChild(del);
    mem.appendChild(el);
  });

  /* notes */
  const nl = $("noteList"); nl.innerHTML = "";
  if (!state.notes.length) nl.innerHTML = '<div class="empty">no notes yet — say: /note buy rice | check market close</div>';
  [...state.notes].reverse().forEach((n) => {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `<div>${esc(n.text)}<br><small>${new Date(n.at).toLocaleString()}</small></div>`;
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "✕";
    del.onclick = () => { state.notes = state.notes.filter(x => x !== n); save(); renderViews(); };
    el.appendChild(del);
    nl.appendChild(el);
  });

  /* reminders */
  const rl = $("remList"); rl.innerHTML = "";
  if (!state.reminders.length) rl.innerHTML = '<div class="empty">no reminders — say: /remind 600 tea break</div>';
  [...state.reminders].reverse().forEach(r => {
    const el = document.createElement("div");
    el.className = "item";
    const when = r.fired ? "fired" : formatIn(r.at - Date.now());
    el.innerHTML = `<div>${esc(r.text)}<br><small>${when}</small></div>`;
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "✕";
    del.onclick = () => { state.reminders = state.reminders.filter(x => x !== r); save(); renderViews(); };
    el.appendChild(del);
    rl.appendChild(el);
  });
}

function formatIn(ms) {
  if (ms <= 0) return "any moment…";
  const m = Math.floor(ms / 60000), s = Math.ceil((ms % 60000) / 1000);
  return m ? `in ${m}m ${s}s` : `in ${s}s`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
