// js/app-index.js
import { fetchCategories, fetchAreas, fetchTags, fetchMeals } from "./api.js";

const els = {
  list: document.querySelector("#meal-list"),
  category: document.querySelector("#filter-category"),
  area: document.querySelector("#filter-area"),
  tags: document.querySelector("#filter-tags"),
  query: document.querySelector("#filter-query"),
  form: document.querySelector("#filters-form"),
  clear: document.querySelector("#clear-filters"),
};

function mealCard(m) {
  const id = m.idMeal || m.id;
  const name = m.strMeal || m.name;
  const thumb = m.strMealThumb || m.thumb;
  const cat = m.strCategory || m.category || "-";
  const area = m.strArea || m.area || "-";
  const tags = (m.strTags || m.tags || "").split(",").filter(Boolean).join(", ") || "-";
  return `
    <li class="card">
      <a href="recipe.html?id=${encodeURIComponent(id)}" aria-label="${name}">
        <img src="${thumb}" alt="${name}" loading="lazy">
      </a>
      <div class="meta">
        <h3 style="margin:.4rem 0 .2rem">${name}</h3>
        <div><strong>Category:</strong> ${cat}</div>
        <div><strong>Area:</strong> ${area}</div>
        <div><strong>Tags:</strong> ${tags}</div>
        <div style="margin-top:.35rem">
          <a href="recipe.html?id=${encodeURIComponent(id)}">View recipe →</a>
        </div>
      </div>
    </li>
  `;
}

function renderMeals(meals) {
  if (!meals.length) {
    els.list.innerHTML = `<li>No meals found. Try adjusting filters.</li>`;
    return;
  }
  els.list.innerHTML = meals.map(mealCard).join("");
}

function uniqueTagsClient(meals) {
  const set = new Set();
  meals.forEach(m => (m.strTags || m.tags || "")
    .split(",").forEach(t => { t = t.trim(); if (t) set.add(t); }));
  return [...set].sort();
}

async function initFilters() {
  const [cats, areas] = await Promise.all([fetchCategories(), fetchAreas()]);
  els.category.innerHTML = `<option value="">All</option>` + cats.map(c => `<option>${c}</option>`).join("");
  els.area.innerHTML = `<option value="">All</option>` + areas.map(a => `<option>${a}</option>`).join("");
}

function readUrl() {
  const u = new URL(location.href);
  els.category.value = u.searchParams.get("category") || "";
  els.area.value = u.searchParams.get("area") || "";
  els.tags.value = u.searchParams.get("tag") || "";
  els.query.value = u.searchParams.get("q") || "";
}

function syncUrl() {
  const p = new URLSearchParams();
  if (els.category.value) p.set("category", els.category.value);
  if (els.area.value) p.set("area", els.area.value);
  if (els.tags.value) p.set("tag", els.tags.value);
  if (els.query.value) p.set("q", els.query.value);
  history.replaceState(null, "", "?" + p.toString());
}

let currentMeals = [];

async function refresh() {
  els.list.innerHTML = `<li>Loading…</li>`;
  try {
    const raw = await fetchMeals({
      category: els.category.value || undefined,
      area: els.area.value || undefined,
      query: els.query.value || undefined,
      tag: els.tags.value || undefined,
    });
    currentMeals = raw;

    // Build tags from backend (preferred) or fallback to client derivation
    try {
      const t = await fetchTags({
        category: els.category.value || undefined,
        area: els.area.value || undefined,
        query: els.query.value || undefined,
      });
      els.tags.innerHTML = `<option value="">All</option>` + t.map(x => `<option>${x}</option>`).join("");
    } catch {
      const t = uniqueTagsClient(raw);
      els.tags.innerHTML = `<option value="">All</option>` + t.map(x => `<option>${x}</option>`).join("");
    }

    renderMeals(raw);
    syncUrl();
  } catch (e) {
    els.list.innerHTML = `<li>Could not load recipes. ${e.message}</li>`;
  }
}

// events
els.form.addEventListener("submit", (e) => { e.preventDefault(); refresh(); });
els.form.addEventListener("input", () => { /* live filter by tag only? keep simple: */ });
els.clear.addEventListener("click", () => {
  els.category.value = "";
  els.area.value = "";
  els.tags.value = "";
  els.query.value = "";
  refresh();
});

// Debounce search
let t;
els.query.addEventListener("input", () => { clearTimeout(t); t = setTimeout(refresh, 300); });

// boot
(async function boot() {
  readUrl();
  await initFilters();
  await refresh();
})();
