// RAG utils (unchanged)
import { loadEmbeddings, topK, buildPrompt } from "./rag.js";

// Your HF Space base URL
const BACKEND = "https://andersjohansenn-maaltidspreik.hf.space";

const stream = document.getElementById("stream");
const form = document.getElementById("ask");
const qInput = document.getElementById("q");
const luckyBtn = document.getElementById("lucky");
const statusEl = document.getElementById("status");

let meta, embs, dim;

function addMsg(text, who="bot", sources=[]) {
  const div = document.createElement("div");
  div.className = `msg ${who==="user" ? "msg-user" : "msg-bot"}`;
  div.innerHTML = `<div>${text}</div>` +
    (sources.length ? `<div class="sources mt-2">${
      sources.map(s => `<small>• <a href="${s.url}" target="_blank">${s.title}</a></small>`).join("")
    }</div>` : "");
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
}

// ---- server helpers ----
async function embedOnServer(text) {
  const safe = (text || "").slice(0, 1000);
  const r = await fetch(`${BACKEND}/embed`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ text: safe })
  });
  if (!r.ok) throw new Error(`embed failed: ${r.status}`);
  const j = await r.json();
  const arr = new Float32Array(j.embedding.length);
  for (let i = 0; i < j.embedding.length; i++) arr[i] = j.embedding[i];
  return arr; // 384-dim vector
}

async function generateOnServer(prompt) {
  const r = await fetch(`${BACKEND}/generate`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      prompt,
      max_new_tokens: 160,
      temperature: 0.4,
      top_p: 0.9,
      repetition_penalty: 1.1
    })
  });
  if (!r.ok) throw new Error(`generate failed: ${r.status}`);
  const j = await r.json();
  return j.text || "";
}

// ---- init ----
async function init() {
  addMsg("👋 Hi! Ask me for meal ideas, ingredients, or cooking tips from our recipe set.");

  // Load RAG data (vectors built offline)
  ({ meta, embs, dim } = await loadEmbeddings());
  statusEl.textContent = "Ready.";
}

function selectChunks(top) {
  return top.map(([i, score]) => ({ ...meta[i], score }));
}

async function answer(question, lucky=false) {
  addMsg(question, "user");
  statusEl.textContent = "Thinking…";

  // 1) Embed on server
  let qvec;
  try {
    qvec = await embedOnServer(question);
  } catch (e) {
    console.error("Embedding crashed:", e);
    addMsg("Sorry, I had trouble understanding that question. Try a shorter phrasing.", "bot");
    statusEl.textContent = "Ready.";
    return;
  }

  // 2) Retrieve locally
  const top = topK(embs, dim, qvec, lucky ? 3 : 5);
  const picked = selectChunks(top);

  if (!top.length || top[0][1] < 0.35) {
    addMsg("I’m not confident this is in our recipes. Try rephrasing or asking for a different dish.", "bot");
    statusEl.textContent = "Ready.";
    return;
  }

  // 3) Build prompt with citations
  const messages = buildPrompt(question, picked);
  const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

  // 4) Generate on server (robust CPU pipeline)
  let generated;
  try {
    generated = await generateOnServer(prompt);
  } catch (e) {
    console.error("Generation crashed:", e);
    addMsg("I ran into an issue while generating a response. Please try again.", "bot");
    statusEl.textContent = "Ready.";
    return;
  }

  // 5) Post-process + show sources
  const reply = generated.includes("ASSISTANT:") ? generated.split("ASSISTANT:").pop().trim() : generated.trim();
  const uniq = [];
  for (const p of picked) if (!uniq.find(u => u.url === p.url)) uniq.push({ title: p.title, url: p.url });
  addMsg(reply, "bot", uniq.slice(0, 3));

  statusEl.textContent = "Ready.";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = qInput.value.trim();
  if (!q) return;
  qInput.value = "";
  await answer(q, false);
});

luckyBtn.addEventListener("click", async () => {
  await answer("Suggest one or two meals I might like, with short reasons.", true);
});

init();
