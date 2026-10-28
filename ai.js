/* ai.js — all AI model calls, fallback logic, streaming.
   Free forever: text.pollinations.ai (keyless, OpenAI-compatible).
   No keys, no cards, no paid tier — ever. */

const MODELS = ["openai", "openai-fast", "mistral"];
const ENDPOINT_POST = "https://text.pollinations.ai/openai";
const ENDPOINT_GET = "https://text.pollinations.ai/";

const SYSTEM_PROMPT =
`You are Hark Lite — a warm, sharp personal assistant that lives fully on the user's device.
Style: helpful, concrete, no corporate filler. Keep answers tight unless the user asks for depth.

TOOL MARKERS — emit a marker on its OWN line when you want an action performed,
one marker per line, exactly this format (no code fences around it):
[TOOL:calc:2^10-1]
[TOOL:note:Groceries|eggs, rice, blue tea]
[TOOL:remember:favourite food|jollof rice]
[TOOL:recall:favourite food]
[TOOL:remind:1800|drink water]
[TOOL:dice:6]
Rules: only use markers when the action is clearly requested or clearly helpful.
Do not write new marker formats. After a marker line you may continue prose on the next line.`;

function buildMessages(history, memory) {
  const memString = Object.keys(memory).length
    ? "Known facts about the user:\n" +
      Object.entries(memory).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "Known facts about the user: (none saved yet)";
  return [
    { role: "system", content: SYSTEM_PROMPT + "\n\n" + memString },
    ...history.map(m => ({ role: m.role, content: m.content }))
  ];
}

/* Primary path: streaming POST (SSE) */
async function streamOnce(model, messages, onDelta, signal) {
  const res = await fetch(ENDPOINT_POST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ model, messages, stream: true, private: true })
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  if (!res.body || !res.body.getReader) {          // no streaming body — fall through to text()
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content ?? "";
    onDelta(txt);
    return txt;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const delta = j?.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onDelta(delta); }
      } catch { /* keep-alive or partial line */ }
    }
  }
  return full;
}

/* Secondary path: simple keyless completion, non-streaming */
async function simpleOnce(model, messages, onDelta, signal) {
  const sys = messages.find(m => m.role === "system")?.content ?? "";
  const last = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const prompt = sys + "\n\nUser:\n" + last + "\n\nAssistant:";
  const url = ENDPOINT_GET + encodeURIComponent(prompt) + "?model=" + encodeURIComponent(model);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const txt = await res.text();
  if (!txt) throw new Error("empty response");
  await typeOut(txt, onDelta, 12);
  return txt;
}

async function typeOut(text, onDelta, chunk) {
  for (let i = 0; i < text.length; i += chunk) {
    onDelta(text.slice(i, i + chunk));
    await new Promise(r => setTimeout(r, 10));
  }
}

/* Public: try models in order, streaming first, then simple; returns full text */
async function askAI(history, memory, { onDelta = () => {}, model = "auto", signal } = {}) {
  const messages = buildMessages(history, memory);
  const chain = model === "auto" ? MODELS : [model];
  const errors = [];
  for (const m of chain) {
    try {
      try { return await streamOnce(m, messages, onDelta, signal); }
      catch (err) {
        if (signal?.aborted) throw err;
        errors.push(m + "-stream: " + err.message);
        return await simpleOnce(m, messages, onDelta, signal);
      }
    } catch (err) {
      if (signal?.aborted) { onDelta(""); return ""; }
      errors.push(m + ": " + err.message);
    }
  }
  throw new Error("All free models unreachable. " + errors.join(" | "));
}

export { askAI, MODELS, SYSTEM_PROMPT };
