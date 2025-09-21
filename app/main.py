from flask import Flask, render_template, request
from app.api_client import search_meals
from app.logic import count_ingredients, scale_ingredients, vegetarian_filter

app = Flask(__name__)

@app.route("/")
def index():

    return render_template("index.html")

@app.route("/search")


def search():
    meal_type = request.args.get("meal_type", "Dinner")

    vegetarian = request.args.get("vegetarian") == "true"
    try:

        servings = int(request.args.get("servings", 2))
    except ValueError:

        servings = 2

    meals = search_meals(meal_type)
    if vegetarian:
        meals = [m for m in meals if vegetarian_filter(m)]
    for m in meals:
        m["ingredient_count"] = count_ingredients(m)


        m["ingredients_scaled"] = scale_ingredients(
            m.get("servings", 2), servings, m.get("ingredients", [])
        )

# det blir vist bare opp til  10 ingrediens 
    meals = sorted(meals, key=lambda x: x["ingredient_count"])[:10]



    return render_template(
        "results.html",

        meals=meals,
        servings=servings,
        meal_type=meal_type,
        vegetarian=vegetarian,
    )


if __name__ == "__main__":
    app.run(debug=True)




from flask import jsonify

@app.get("/api/search")
def api_search():

    q = request.args.get("q", "Veg")
    meals = search_meals("Dinner")


    meals = [m for m in meals if q.lower() in (m["title"] or "").lower()]

    return jsonify({"meals": meals})
