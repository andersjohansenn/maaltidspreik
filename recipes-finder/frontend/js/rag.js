export async function loadEmbeddings() {
  const [metaRes, embRes] = await Promise.all([
    fetch("./data/chunks.json"),
    fetch("./data/embeddings.bin"),
  ]);
  const meta = await metaRes.json();
  const buf = await embRes.arrayBuffer();
  const embs = new Float32Array(buf);  // row-major [N,384], normalized
  const dim = 384;
  const n = embs.length / dim;
  return { meta, embs, dim, n };
}

export function cosineSim(a, b) {
  let s = 0.0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function topK(embs, dim, query, k = 5) {
  const N = embs.length / dim;
  const scores = new Array(N);
  for (let i = 0; i < N; i++) {
    const start = i * dim;
    const v = embs.subarray(start, start + dim);
    scores[i] = [i, cosineSim(v, query)];
  }
  scores.sort((a,b) => b[1]-a[1]);
  return scores.slice(0, k);
}

export function buildPrompt(question, selectedChunks) {
  const ctx = selectedChunks.map((c, i) =>
    `[${i+1}] "${c.text}" — ${c.title} (${c.url})`
  ).join("\n\n");
  return [
    { role: "system", content:
      "You are a helpful cooking assistant. Answer ONLY from the provided recipe context. " +
      "If not in context, say you don't know. When suggesting meals, cite 2–3 recipes with titles and links."
    },
    { role: "user", content: `Question: ${question}\n\nContext:\n${ctx}` }
  ];
}

export async function findSimilar(queryEmbedding, k, meta, embs, dim) {
  const top = topK(embs, dim, queryEmbedding, k);
  return top.map(([i, score]) => ({ chunk: meta[i], score }));
}
