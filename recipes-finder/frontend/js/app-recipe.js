// js/app-recipe.js
import { fetchMealById } from "./api.js";

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
  const img = meal.strMealThumb || meal.thumb;
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
  `;
}

(async function boot() {
  const id = getId();
  if (!id) {
    document.querySelector("#content").innerHTML = `<p>Missing recipe id.</p>`;
    return;
  }
  try {
    // Browser will cache the image automatically once loaded.
    const meal = await fetchMealById(id);
    render(meal);
  } catch (e) {
    document.querySelector("#content").innerHTML = `<p>Failed to load recipe. ${e.message}</p>`;
  }
})();
