// api.js — use ONLY the Hugging Face backend
const BASE = "https://andersjohansenn-maaltidspreik.hf.space"; // no trailing slash

export async function fetchMeals({ category, area, query, tag } = {}) {
  const p = new URLSearchParams();
  if (category) p.set("category", category);
  if (area) p.set("area", area);
  if (query) p.set("q", query);
  if (tag) p.set("tag", tag);

  const r = await fetch(`${BASE}/meals?${p.toString()}`);
  if (!r.ok) throw new Error(`Backend error: ${r.status}`);
  const data = await r.json();
  return data.meals || [];
}

export async function fetchCategories() {
  const r = await fetch(`${BASE}/categories`);
  if (!r.ok) throw new Error(`Backend error: ${r.status}`);
  const data = await r.json();
  return data.categories || [];
}

export async function fetchAreas() {
  const r = await fetch(`${BASE}/areas`);
  if (!r.ok) throw new Error(`Backend error: ${r.status}`);
  const data = await r.json();
  return data.areas || [];
}

// Optional: if you want tags from backend instead of deriving in the client
export async function fetchTags({ category, area, query } = {}) {
  const p = new URLSearchParams();
  if (category) p.set("category", category);
  if (area) p.set("area", area);
  if (query) p.set("q", query);

  const r = await fetch(`${BASE}/tags?${p.toString()}`);
  if (!r.ok) throw new Error(`Backend error: ${r.status}`);
  const data = await r.json();
  return data.tags || [];
}
