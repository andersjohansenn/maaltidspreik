import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.15.1?module";
import { loadEmbeddings, topK, buildPrompt } from "./rag.js";

const BACKEND = "https://andersjohansenn-maaltidspreik.hf.space";

env.allowLocalModels = false;   // never probe /models on Pages
env.remoteModels = true;        // always fetch models from HF Hub

const stream = document.getElementById("stream");
const form = document.getElementById("ask");
const qInput = document.getElementById("q");
const luckyBtn = document.getElementById("lucky");
const statusEl = document.getElementById("status");

let generator, meta, embs, dim;

// 03) Server-side embedding via HF Space
async function embedOnServer(text) {
  const safe = (text || "").slice(0, 1000); // match backend cleaner
  const r = await fetch(`${BACKEND}/embed`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ text: safe })
  });
  if (!r.ok) throw new Error(`embed failed: ${r.status}`);
  const j = await r.json();
  const arr = new Float32Array(j.embedding.length);
  for (let i = 0; i < j.embedding.length; i++) arr[i] = j.embedding[i];
  return arr; // Float32Array length 384
}

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

async function init() {
  addMsg("👋 Hi! Ask me for meal ideas, ingredients, or cooking tips from our recipe set.");

  // Load RAG data (your prebuilt chunk vectors)
  ({ meta, embs, dim } = await loadEmbeddings());

  // Generator stays in-browser (public, quantized)
  generator = await pipeline("text-generation", "Xenova/TinyLlama-1.1B-Chat-v1.0", { quantized: true });

  if (typeof generator !== "function") throw new Error("Generator failed to initialize");
  statusEl.textContent = "Ready.";
}

function selectChunks(top) {
  return top.map(([i, score]) => ({ ...meta[i], score }));
}

async function answer(question, lucky=false) {
  addMsg(question, "user");
  statusEl.textContent = "Thinking…";

  let qvec;
  try {
    // 🔁 Embed on the server (MiniLM-L6-v2, normalized, 384-dim)
    qvec = await embedOnServer(question);
  } catch (e) {
    console.error("Embedding crashed:", e);
    addMsg("Sorry, I had trouble understanding that question. Try a shorter phrasing.", "bot");
    statusEl.textContent = "Ready.";
    return;
  }

  // client-side retrieval
  const top = topK(embs, dim, qvec, lucky ? 3 : 5);
  const picked = selectChunks(top);

  if (!top.length || top[0][1] < 0.35) {
    addMsg("I’m not confident this is in our recipes. Try rephrasing or asking for a different dish.", "bot");
    statusEl.textContent = "Ready.";
    return;
  }

  const messages = buildPrompt(question, picked);
  const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

  let out;
  try {
    out = await generator(prompt, {
      max_new_tokens: 200,
      temperature: 0.4,
      top_p: 0.9,
      repetition_penalty: 1.1,
    });
  } catch (e) {
    console.error("Generation crashed:", e);
    addMsg("I ran into an issue while generating a response. Please try again.", "bot");
    statusEl.textContent = "Ready.";
    return;
  }

  const text = (Array.isArray(out) ? out[0].generated_text : out.generated_text) || "";
  const reply = text.includes("ASSISTANT:") ? text.split("ASSISTANT:").pop().trim() : text.trim();

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
