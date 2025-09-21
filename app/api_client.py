import requests

BASE = "https://www.themealdb.com/api/json/v1/1/"

def search_meals(meal_type: str):
    # Velg en kategori – her gjør vi det enkelt: Dinner → Vegetarian, ellers Beef
    category = "Vegetarian" if meal_type.lower() == "dinner" else "Beef"
    url = f"{BASE}filter.php?c={category}"

    # Hent liste over måltider i kategorien
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    data = r.json() or {}
    meals = data.get("meals") or []

    mapped = []
    # Ta maks 8 måltider, ellers blir det for mye
    for m in meals[:10]:
        meal_id = m.get("idMeal")
        detail_url = f"{BASE}lookup.php?i={meal_id}"

        # Hent detaljer for hver rett (her ligger ingredienser)
        dr = requests.get(detail_url, timeout=10)
        dr.raise_for_status()
        ddata = dr.json() or {}
        dmeal = (ddata.get("meals") or [])[0]

        # Bygg ingrediensliste fra strIngredient1…20 og strMeasure1…20
        ingredients = []
        for i in range(1, 21):
            ing = dmeal.get(f"strIngredient{i}")
            qty = dmeal.get(f"strMeasure{i}")
            if ing and ing.strip():
                ingredients.append({"name": ing.strip(), "qty": (qty or "").strip()})

        mapped.append({
            "id": meal_id,
            "title": m.get("strMeal"),
            "thumb": m.get("strMealThumb"),
            "ingredients": ingredients,
            "servings": 2
        })

    return mapped

 
