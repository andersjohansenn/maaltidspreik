import re

# Teller hvor mange ingredienser en rett har
def count_ingredients(meal):
    return len(meal.get("ingredients", []))

# ser om en rett er veganisk basert på navnet 
def vegetarian_filter(meal):
    title = (meal.get("title") or "").lower()
    meat_words = ["chicken", "beef", "pork", "lamb", "fish", "shrimp", "bacon", "turkey", "ham"]
    return not any(w in title for w in meat_words)

# Regex som finner tall i tekst (f.eks. "2", "2.5")
_num = re.compile(r"(\d+(\.\d+)?)")

# Skalerer ingredienser når antall på posjoner endres 
def scale_ingredients(base_servings, target_servings, items):
    if not items or base_servings <= 0 or target_servings <= 0:
        return items or []

    factor = target_servings / base_servings
    out = []

    for it in items:
        qty = it.get("qty") or ""
        m = _num.search(qty)

        if not m:
            # slik at hvis det står en klype salt , blir den beholdt som den er 
            out.append({**it})
            continue

        # Gang opp tallet og sett inn i teksten
        old = float(m.group(1))
        new_qty = qty.replace(m.group(1), str(old * factor), 1)
        out.append({**it, "qty": new_qty})

    return out

