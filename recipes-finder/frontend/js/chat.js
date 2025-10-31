// Browser-native ESM build
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.15.1?module";
import { loadEmbeddings, topK, buildPrompt } from "./rag.js";

// Force remote loading from the Hugging Face Hub and never probe /models on your domain
env.allowLocalModels = false;
env.remoteModels = true;
// Optional: you can pin ORT WASM location if needed
// env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";

const stream = document.getElementById("stream");
const form = document.getElementById("ask");
const qInput = document.getElementById("q");
const luckyBtn = document.getElementById("lucky");
const statusEl = document.getElementById("status");

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

  // Load RAG data
  ({ meta, embs, dim } = await loadEmbeddings());

  // --- Embedder: use NON-quantized + explicit truncation to avoid wasm offset issues ---
  // (Quantized sometimes triggers RangeError: offset is out of bounds on some browsers)
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: false,          // <-- key change
  });

  // Generator: keep quantized (faster); use a public, ungated model
  generator = await pipeline("text-generation", "Xenova/TinyLlama-1.1B-Chat-v1.0", {
    quantized: true,
  });

  if (typeof embedder !== "function") throw new Error("Embedder failed to initialize");
  if (typeof generator !== "function") throw new Error("Generator failed to initialize");

  statusEl.textContent = "Ready.";
}

async function embedQuery(text) {
  // Defensive: short-circuit absurdly long user input
  const safe = (text || "").slice(0, 1000);

  // Try with conservative token limits (helps ORT stability)
  const opts = { pooling: "mean", normalize: true, truncation: true, max_length: 128 };

  try {
    const out = await embedder(safe, opts);
    return new Float32Array(out.data); // 384-d vector
  } catch (err) {
    console.warn("Embedder failed (first attempt). Retrying with smaller max_length…", err);
    // Retry with even smaller context and non-quantized already set
    const out = await embedder(safe.slice(0, 300), { ...opts, max_length: 64 });
    return new Float32Array(out.data);
  }
}

function selectChunks(top) {
  return top.map(([i, score]) => ({ ...meta[i], score }));
}

async function answer(question, lucky=false) {
  addMsg(question, "user");
  statusEl.textContent = "Thinking…";

  let qvec;
  try {
    qvec = await embedQuery(question);
  } catch (e) {
    console.error("Embedding crashed:", e);
    addMsg("Sorry, I had trouble understanding that question. Try a shorter phrasing.", "bot");
    statusEl.textContent = "Ready.";
    return;
  }

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
