// js/api.js
const BASE = "https://andersjohansenn-maaltidspreik.hf.space"; // no trailing slash

export async function fetchCategories() {
  const r = await fetch(`${BASE}/categories`);
  if (!r.ok) throw new Error("categories failed");
  return (await r.json()).categories || [];
}

export async function fetchAreas() {
  const r = await fetch(`${BASE}/areas`);
  if (!r.ok) throw new Error("areas failed");
  return (await r.json()).areas || [];
}

export async function fetchTags({ category, area, query } = {}) {
  const p = new URLSearchParams();
  if (category) p.set("category", category);
  if (area) p.set("area", area);
  if (query) p.set("q", query);
  const r = await fetch(`${BASE}/tags?${p.toString()}`);
  if (!r.ok) throw new Error("tags failed");
  return (await r.json()).tags || [];
}

export async function fetchMeals({ category, area, query, tag, page = 1, limit = 10 } = {}) {
  const p = new URLSearchParams();
  if (category) p.set("category", category);
  if (area) p.set("area", area);
  if (query) p.set("q", query);
  if (tag) p.set("tag", tag);
  p.set("page", String(page));
  p.set("limit", String(limit));

  const r = await fetch(`${BASE}/meals?${p.toString()}`);
  if (!r.ok) throw new Error(`meals failed: ${r.status}`);
  return await r.json(); // { meals, page, limit, total, has_prev, has_next }
}


export async function fetchMealById(id) {
  const r = await fetch(`${BASE}/meal?id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error("meal failed");
  return (await r.json()).meal || null;
}
