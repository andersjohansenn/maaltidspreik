// js/app-recipe.js
import { fetchMealById } from "./api.js";
import { loadEmbeddings, findSimilar } from "./rag.js";

function getId() {
  const u = new URL(location.href);
  return u.searchParams.get("id");
}

function buildIngredients(meal) {
  // TheMealDB uses strIngredient1..20 and strMeasure1..20
  const rows = [];
  for (let i = 1; i <= 20; i++) {
    const ing = meal[`strIngredient${i}`];
    const mea = meal[`strMeasure${i}`];
    if (ing && ing.trim()) {
      rows.push({ ingredient: ing.trim(), measure: (mea || "").trim() });
    }
  }
  return rows;
}

function render(meal) {
  if (!meal) {
    document.querySelector("#content").innerHTML = `<p>Recipe not found.</p>`;
    return;
  }
  const name = meal.strMeal || meal.name;
  const id = meal.idMeal || meal.recipe_id;
  const img = meal.strMealThumb;
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
    const meal = await fetchMealById(id);
    render(meal);

    const { meta, embs, dim } = await loadEmbeddings();
    const mealIndex = meta.findIndex(m => m.recipe_id === id);
    if (mealIndex === -1) {
      // Recipe not in our chunks, so we can't find related.
      return;
    }
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

      const recipeCards = await Promise.all(uniqueRecipes.map(async s => {
        const relatedMeal = await fetchMealById(s.chunk.recipe_id);
        const mealId = relatedMeal.idMeal;
        const mealName = relatedMeal.strMeal;
        const thumb = relatedMeal.strMealThumb;
        return `
        <div class="card">
          <a href="recipe.html?id=${mealId}">
            <img src="${thumb}" alt="${mealName}" loading="lazy">
            <div class="card-content">
              <h3>${mealName}</h3>
            </div>
          </a>
        </div>
      `}));
      
      relatedContainer.innerHTML = `<h2>Related Recipes</h2><div class="card-container">${recipeCards.join('')}</div>`;
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

