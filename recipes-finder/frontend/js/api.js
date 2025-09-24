// api.js — call your Hugging Face Space backend
const BASE = "https://andersjohansenn-maaltidspreik.hf.space/";

export async function fetchMeals({ category, area, query, tag } = {}) {
  const p = new URLSearchParams();
  if (category) p.set("category", category);
  if (area) p.set("area", area);
  if (query) p.set("q", query);
  if (tag) p.set("tag", tag);

  const url = `${BASE}/meals?${p.toString()}`;
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`Backend error: ${r.status}`);
  const data = await r.json();
  return data.meals || [];
}
