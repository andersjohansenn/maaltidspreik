// js/app-recipe.js
import { loadEmbeddings, findSimilar } from "./rag.js";

function getId() {
  const u = new URL(location.href);
  return u.searchParams.get("id");
}

function buildIngredients(meal) {
  const text = meal.text || '';
  const ingredientsMatch = text.match(/INGREDIENTS:(.*?)(STEPS:|$)/);
  if (!ingredientsMatch) {
    return [];
  }
  const ingredientsString = ingredientsMatch[1];
  return ingredientsString.split(';')
    .map(part => part.trim())
    .filter(part => part)
    .map(part => {
      const parts = part.split(/:(.+)/);
      if (parts.length === 2) {
        return { ingredient: parts[1].trim(), measure: parts[0].trim() };
      }
      return { ingredient: part, measure: '' };
    });
}

function render(meal) {
  if (!meal) {
    document.querySelector("#content").innerHTML = `<p>Recipe not found.</p>`;
    return;
  }
    const name = meal.strMeal || meal.name;
    const id = meal.idMeal || meal.recipe_id;
    const img = meal.strMealThumb || `https://www.themealdb.com/images/media/meals/${encodeURIComponent(name)}-${id}.jpg`;
    const cat = meal.strCategory || meal.category || "-";
    const area = meal.strArea || meal.area || "-";
    const tags = (meal.strTags || meal.tags || "").split(",").filter(Boolean).join(", ") || "-";
    const instr = (meal.strInstructions || "").split("\n").map(p => p.trim()).filter(Boolean);
  
    const ing = buildIngredients(meal);
    const ingRows = ing.map(r => `<tr><td>${r.ingredient}</td><td>${r.measure}</td></tr>`).join("");
  
    document.querySelector("#content").innerHTML = `
      <div class="hero">
        <img src="${img}" alt="${name}" loading="eager" fetchpriority="high">
        <div>
          <h1>${name}</h1>
          <div><strong>Category:</strong> ${cat}</div>
          <div><strong>Area:</strong> ${area}</div>
          <div><strong>Tags:</strong> ${tags}</div>
        </div>
      </div>
  
      <h2>Ingredients</h2>
      <table>
        <thead><tr><th>Ingredient</th><th>Measure</th></tr></thead>
        <tbody>${ingRows || `<tr><td colspan="2">No ingredients listed.</td></tr>`}</tbody>
      </table>
  
      <h2>Instructions</h2>
      ${instr.map(p => `<p>${p}</p>`).join("")}
  
      <div id="related-recipes"></div>
    `;
  }
  
  (async function boot() {
    const id = getId();
    if (!id) {
      document.querySelector("#content").innerHTML = `<p>Missing recipe id.</p>`;
      return;
    }
    try {
      const { meta, embs, dim } = await loadEmbeddings();
      const mealChunks = meta.filter(m => m.recipe_id === id);
      if (mealChunks.length === 0) {
        document.querySelector("#content").innerHTML = `<p>Recipe not found.</p>`;
        return;
      }
  
      const meal = {
        ...mealChunks[0],
        text: mealChunks.map(c => c.text).join('\n'),
        strInstructions: mealChunks.map(c => (c.text.split('STEPS:')[1] || '').trim()).join('\n'),
        strMeal: mealChunks[0].title,
        strMealThumb: mealChunks[0].thumb,
        strCategory: mealChunks[0].category,
        strArea: mealChunks[0].area,
        strTags: mealChunks[0].tags,
      };
      render(meal);
  
      const mealIndex = meta.findIndex(m => m.chunk_id === mealChunks[0].chunk_id);
      const start = mealIndex * dim;
      const queryEmbedding = embs.subarray(start, start + dim);
      const similar = await findSimilar(queryEmbedding, 10, meta, embs, dim);
  
      const relatedContainer = document.getElementById('related-recipes');
      if (similar && similar.length > 0) {
        const uniqueRecipes = similar
          .filter(s => s.chunk.recipe_id !== id)
          .reduce((acc, s) => {
            if (!acc.some(item => item.chunk.recipe_id === s.chunk.recipe_id)) {
              acc.push(s);
            }
            return acc;
          }, [])
          .slice(0, 3);
  
        const cards = uniqueRecipes
          .map(s => {
            const mealId = s.chunk.recipe_id;
            const mealName = s.chunk.title;
            const thumb = `https://www.themealdb.com/images/media/meals/${encodeURIComponent(mealName)}-${mealId}.jpg`;
            return `
          <div class="card">
            <a href="recipe.html?id=${mealId}">
              <img src="${thumb}" alt="${mealName}" loading="lazy">
              <div class="card-content">
                <h3>${mealName}</h3>
              </div>
            </a>
          </div>
        `}).join('');      relatedContainer.innerHTML = `<h2>Related Recipes</h2><div class="card-container">${cards}</div>`;
    }
  } catch (e) {
    document.querySelector("#content").innerHTML = `<p>Failed to load recipe. ${e.message}</p>`;
  }
})();

const htmlRoot = document.documentElement;
const lightBtn = document.getElementById("lightBtn");
const darkBtn = document.getElementById("darkBtn");

window.switchLight = function () {
  htmlRoot.removeAttribute("data-theme");
  localStorage.setItem("theme", "light");
  lightBtn.classList.add("active");
  darkBtn.classList.remove("active");
};

window.switchDark = function () {
  htmlRoot.setAttribute("data-theme", "dark");
  localStorage.setItem("theme", "dark");
  darkBtn.classList.add("active");
  lightBtn.classList.remove("active");
};

// Load saved theme on page load
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
  htmlRoot.setAttribute("data-theme", "dark");
  darkBtn.classList.add("active");
} else {
  lightBtn.classList.add("active");
};
