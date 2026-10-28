/* tools.js — the actions the assistant can perform (all local, all free) */
import { state, save } from "./storage.js";

const remindersTimers = [];

function sanitizeCalc(raw) {
  let s = String(raw).trim().replace(/\^/g, "**");
  if (!/^[\d+\-*/%(). \t\s\p{L}]*$/u.test(s.replace(/Math\.\w+/g, "")) && !/^[\d+\-*/%().\s*]+$/.test(s)) {
    if (!/^[\d+\-*/%().\s*]+$/.test(s)) throw new Error("bad chars");
  }
  if (!/^[\d+\-*/%().\s]+$/.test(s)) {
    // allow plain words -> numbers from context (e.g. pi) kept out; strict numeric only
    throw new Error("unsupported expression");
  }
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict";return (${s})`)();
  if (typeof v !== "number" || !isFinite(v)) throw new Error("not a finite number");
  return v;
}

/* Parse all [TOOL:name:arg] markers out of assistant text */
export function extractTools(text) {
  const out = [];
  const re = /\[TOOL:([a-z]+):([^\]]*)\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ name: m[1].toLowerCase(), arg: m[2].trim() });
  return out;
}

/* Execute one tool; returns a display string */
export async function runTool(name, arg) {
  switch (name) {
    case "calc": {
      try {
        const result = sanitizeCalc(arg);
        return `🧮 ${arg} = ${result}`;
      } catch (e) { return `🧮 couldn't compute “${arg}” (${e.message})`; }
    }
    case "note": {
      const [title, ...rest] = arg.split("|");
      state.notes.push({ text: rest.join("|") || title, at: Date.now() });
      save();
      return `📝 note saved${title && rest.length ? `: “${title.trim()}”` : ""}`;
    }
    case "remember": {
      const sep = arg.indexOf("|");
      const k = (sep === -1 ? arg : arg.slice(0, sep)).trim();
      const v = sep === -1 ? "" : arg.slice(sep + 1).trim();
      if (k && v) { state.memory[k] = v; save(); return `🧠 remembered “${k}”`; }
      return "🧠 usage: remember key | value";
    }
    case "recall": {
      const v = state.memory[String(arg).trim()];
      return v !== undefined ? `🧠 ${arg}: ${v}` : `🧠 I don't have “${arg}” stored.`;
    }
    case "remind": {
      const sep = arg.indexOf("|");
      const secs = Math.max(5, parseInt(sep === -1 ? arg : arg.slice(0, sep), 10) || 0);
      const text = sep === -1 ? "reminder" : arg.slice(sep + 1).trim();
      const at = Date.now() + secs * 1000;
      const id = Date.now();
      state.reminders.push({ id, at, text, fired: false });
      scheduleReminder(id, secs * 1000, text);
      save();
      return `⏰ reminder set (${secs}s from now): ${text}`;
    }
    case "dice": {
      const sides = Math.min(120, Math.max(2, parseInt(arg, 10) || 6));
      return `🎲 d${sides} → ${1 + Math.floor(Math.random() * sides)}`;
    }
    default:
      return `unknown tool “${name}”`;
  }
}

function scheduleReminder(id, ms, text) {
  const t = setTimeout(() => { fireReminder(id); remindersTimers.pop(); }, ms);
  remindersTimers.push(t);
}

async function fireReminder(id) {
  const r = state.reminders.find(x => x.id === id);
  if (!r) return;
  r.fired = true;
  save();
  try {
    if (Notification.permission === "granted") {
      new Notification("⏰ Hark Lite reminder", { body: r.text, icon: "icon.svg" });
    }
  } catch { /* page hidden on some browsers */ }
  alert(`⏰ ${r.text}`);
}

/* Slash commands typed directly by the user: interpret as tools */
export const SLASH = {
  note: arg => runTool("note", arg),
  calc: arg => runTool("calc", arg),
  remember: arg => runTool("remember", arg),
  recall: arg => runTool("recall", arg),
  remind: arg => runTool("remind", arg),
  dice: arg => runTool("dice", arg)
};

export function isSlash(line) {
  return /^\/(\w+)\b/.test(line);
}

export function getSlash(line) {
  const m = /^\/(\w+)(?:\s+(.*))?$/s.exec(line);
  if (!m || !SLASH[m[1]]) return null;
  return { name: m[1], arg: (m[2] ?? "").trim(), run: SLASH[m[1]] };
}

/* On app start: re-arm any reminders that were saved but not fired */
export function rearmReminders() {
  state.reminders.forEach(r => {
    const delay = r.at - Date.now();
    if (delay > 4000) scheduleReminder(r.id, delay, r.text);
  });
}
