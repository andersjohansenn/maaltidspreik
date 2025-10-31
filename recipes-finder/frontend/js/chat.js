// js/chat.js
import { loadEmbeddings, topK, buildPrompt } from "./rag.js";

const stream = document.getElementById("stream");
const form = document.getElementById("ask");
const qInput = document.getElementById("q");
const luckyBtn = document.getElementById("lucky");
const statusEl = document.getElementById("status");

// Models
let embedder, generator, meta, embs, dim;

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
  const { pipeline } = window.transformers;

  // Load RAG data
  ({ meta, embs, dim } = await loadEmbeddings());

  // Embedding model (fast)
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });

  // Small instruct model for answers (keep answers concise; rely on retrieval)
  generator = await pipeline("text-generation", "Xenova/Qwen2.5-0.5B-Instruct", { quantized: true });

  statusEl.textContent = "Ready.";
}

async function embedQuery(text) {
  const out = await embedder(text, { pooling: "mean", normalize: true });
  return new Float32Array(out.data); // 384-d vector
}

function selectChunks(top) {
  return top.map(([i, score]) => ({ ...meta[i], score }));
}

async function answer(question, lucky=false) {
  addMsg(question, "user");
  statusEl.textContent = "Thinking…";

  const qvec = await embedQuery(question);
  const top = topK(embs, dim, qvec, lucky ? 3 : 5);
  const picked = selectChunks(top);

  if (!top.length || top[0][1] < 0.35) {
    addMsg("I’m not confident this is in our recipes. Try rephrasing or asking for a different dish.");
    statusEl.textContent = "Ready.";
    return;
  }

  const messages = buildPrompt(question, picked);
  const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

  const out = await generator(prompt, {
    max_new_tokens: 200,
    temperature: 0.4,
    top_p: 0.9,
    repetition_penalty: 1.1,
  });
  const text = (Array.isArray(out) ? out[0].generated_text : out.generated_text) || "";
  const reply = text.includes("ASSISTANT:") ? text.split("ASSISTANT:").pop().trim() : text.trim();

  // unique sources (first 3)
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
