import { fetchCategories, fetchAreas, fetchTags, fetchMeals } from "./api.js";

const els = {
  list: document.querySelector("#meal-list"),
  category: document.querySelector("#filter-category"),
  area: document.querySelector("#filter-area"),
  tags: document.querySelector("#filter-tags"),
  query: document.querySelector("#filter-query"),
  form: document.querySelector("#filters-form"),
  clear: document.querySelector("#clear-filters"),
  loadMore: document.querySelector("#load-more"),
};

const state = {
  page: 1,
  limit: 10,        // tweak here if you want a different default
  hasNext: false,
  accum: [],        // accumulated meals across pages
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

function renderAll() {
  if (!state.accum.length) {
    els.list.innerHTML = `<li>No meals found. Try adjusting filters.</li>`;
  } else {
    els.list.innerHTML = state.accum.map(mealCard).join("");
  }
  els.loadMore.style.display = state.hasNext ? "block" : "none";
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
  const queryString = p.toString();
  const newUrl = queryString ? `${location.pathname}?${queryString}` : location.pathname;
  history.replaceState(null, "", newUrl);
}

// Load one page and append
async function loadPage(page) {
  const params = {
    category: els.category.value || undefined,
    area: els.area.value || undefined,
    query: els.query.value || undefined,
    tag: els.tags.value || undefined,
    page,
    limit: state.limit,
  };

  // Tiny loading hint
  if (page === 1) {
    els.list.innerHTML = `<li>Loading…</li>`;
  } else {
    els.loadMore.disabled = true;
    els.loadMore.textContent = "Loading…";
  }

  try {
    const { meals, has_next } = await fetchMeals(params);
    state.page = page;
    state.hasNext = !!has_next;
    state.accum = page === 1 ? meals : state.accum.concat(meals);
    renderAll();
  } catch (e) {
    if (page === 1) els.list.innerHTML = `<li>Could not load recipes. ${e.message}</li>`;
  } finally {
    if (page > 1) {
      els.loadMore.disabled = false;
      els.loadMore.textContent = "Load more";
    }
  }
}

async function refreshFirstPage() {
  // Reset pagination & results
  state.page = 1;
  state.accum = [];
  state.hasNext = false;
  els.list.innerHTML = `<li>Loading…</li>`;

  const selectedTag = els.tags.value;

  // Rebuild tags for the current filter context
  try {
    const t = await fetchTags({
      category: els.category.value || undefined,
      area: els.area.value || undefined,
      query: els.query.value || undefined,
    });
    const options = `<option value="">All</option>` + t.map(x => `<option>${x}</option>`).join("");
    els.tags.innerHTML = options;
    if (selectedTag && t.includes(selectedTag)) {
      els.tags.value = selectedTag;
    }
  } catch {
    // If /tags fails, we’ll just leave current tags (or you can clear it)
  }

  syncUrl();
  await loadPage(1);
}

// Events
els.form.addEventListener("submit", (e) => { e.preventDefault(); refreshFirstPage(); });
els.clear.addEventListener("click", () => {
  els.category.value = "";
  els.area.value = "";
  els.tags.value = "";
  els.query.value = "";
  refreshFirstPage();
});
els.loadMore.addEventListener("click", () => {
  if (state.hasNext) loadPage(state.page + 1);
});

// Boot
(async function boot() {
  readUrl();
  els.list.innerHTML = `<li>Loading…</li>`;
  // init categories/areas once
  try {
    const [cats, areas] = await Promise.all([fetchCategories(), fetchAreas()]);
    const categorySelect = document.querySelector("#filter-category");
    const areaSelect = document.querySelector("#filter-area");
    const prevCategory = els.category.value;
    const prevArea = els.area.value;
    categorySelect.innerHTML = `<option value="">All</option>` + cats.map(c => `<option>${c}</option>`).join("");
    areaSelect.innerHTML = `<option value="">All</option>` + areas.map(a => `<option>${a}</option>`).join("");
    if (prevCategory) categorySelect.value = prevCategory;
    if (prevArea) areaSelect.value = prevArea;
  } catch {}
  await refreshFirstPage();
})();
