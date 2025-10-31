import logging
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock, Thread
from typing import Dict, List, Optional

import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware


BASE = "https://www.themealdb.com/api/json/v1/1/"
DEFAULT_TIMEOUT = 10

RANDOM_POOL_TARGET = 40          # grow pool until we have at least this many meals cached
RANDOM_POOL_TTL = 60 * 30        # seconds
LOOKUP_TTL = 60 * 60             # cache full meal details for an hour
LIST_TTL = 60 * 15               # cache category/area lists for 15 minutes
SEARCH_TTL = 60 * 5              # cache text searches briefly


class SimpleCache:
    """Very small in-memory cache with TTL support."""

    def __init__(self) -> None:
        self._store: Dict[str, tuple[float, object]] = {}
        self._lock = Lock()

    def get(self, key: str):
        now = time.time()
        with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            expires, value = entry
            if expires and expires < now:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, value, ttl: int) -> None:
        expires = time.time() + ttl if ttl else 0
        with self._lock:
            self._store[key] = (expires, value)


session = requests.Session()
session.headers.update({"User-Agent": "Maaltidspreik/1.0"})


# Logging -------------------------------------------------------------------
def resolve_log_dir() -> Path:
    # Allow override via environment variable so deployments can pick a safe path
    override = os.getenv("MAAL_LOG_DIR") or os.getenv("LOG_DIR")
    if override:
        return Path(override)

    # Prefer /tmp which is writable on HuggingFace spaces
    default_tmp = Path("/tmp/maaltidspreik")
    if default_tmp.exists() or os.access(default_tmp.parent, os.W_OK):
        return default_tmp

    # Fall back to app directory
    return Path(__file__).resolve().parent / "logs"


LOG_DIR = resolve_log_dir()
try:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    # Absolute fallback to /tmp if even custom path fails
    LOG_DIR = Path("/tmp/maaltidspreik")
    LOG_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = LOG_DIR / "app.log"

logger = logging.getLogger("maaltidspreik")
logger.setLevel(logging.INFO)
formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

if not logger.handlers:
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(formatter)
    logger.addHandler(fh)

    sh = logging.StreamHandler()
    sh.setFormatter(formatter)
    logger.addHandler(sh)

logger.propagate = False


# FastAPI setup --------------------------------------------------------------
app = FastAPI(title="Maaltidspreik API")

allowed_origins = [
    "https://andersjohansenn.github.io",
    "https://andersjohansenn.github.io/maaltidspreik",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    try:
        response = await call_next(request)
    except Exception:  # pragma: no cover - defensive logging
        duration = (time.time() - start) * 1000
        logger.exception("Unhandled exception for %s %s (%.1f ms)", request.method, request.url.path, duration)
        raise

    if response.status_code >= 500:
        duration = (time.time() - start) * 1000
        logger.error("Server error %s %s -> %s (%.1f ms)", request.method, request.url.path, response.status_code, duration)
    return response


# Caches ---------------------------------------------------------------------
random_pool_cache = SimpleCache()
lookup_cache = SimpleCache()
list_cache = SimpleCache()
search_cache = SimpleCache()
random_pool_lock = Lock()
random_pool_warm_lock = Lock()
random_pool_warming = False


def clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def safe_get_json(url: str) -> dict:
    try:
        resp = session.get(url, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:  # pragma: no cover - network guard
        logger.exception("Upstream request failed: %s", url)
        raise HTTPException(status_code=502, detail="Upstream API error") from exc


def ensure_random_pool(target_size: int, *, quick: bool = False) -> List[dict]:
    if target_size <= 0:
        return []

    cached = random_pool_cache.get("pool")
    if cached and len(cached) >= target_size:
        return cached

    def add_many(seen: Dict[str, dict], payload) -> None:
        if not payload:
            return
        if isinstance(payload, str):
            logger.warning("randomselection returned %r", payload)
            return
        if isinstance(payload, dict):
            payload = payload.values()
        for meal in payload:
            if isinstance(meal, dict):
                meal_id = meal.get("idMeal")
                if meal_id:
                    seen[meal_id] = meal
            else:
                logger.debug("Skipping unexpected meal payload: %r", meal)

    with random_pool_lock:
        cached = random_pool_cache.get("pool") or []
        seen = {m.get("idMeal"): m for m in cached if isinstance(m, dict) and m.get("idMeal")}
        if len(seen) >= target_size:
            return list(seen.values())

        max_rounds = 1 if quick else 3
        max_batches = 1 if quick else 6
        max_workers_cap = 1 if quick else 4

        rounds = 0
        while len(seen) < target_size and rounds < max_rounds:
            remaining = target_size - len(seen)
            batches = min(max_batches, max(1, (remaining + 9) // 10))
            max_workers = min(max_workers_cap, batches)
            if max_workers <= 1:
                data = safe_get_json(f"{BASE}randomselection.php")
                if not data:
                    break
                add_many(seen, data.get("meals"))
            else:
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    futures = [executor.submit(safe_get_json, f"{BASE}randomselection.php") for _ in range(batches)]
                    for future in as_completed(futures):
                        data = future.result()
                        add_many(seen, data.get("meals"))
            rounds += 1

        retry_cap = target_size if quick else target_size * 2
        retries = 0
        while len(seen) < target_size and retries < retry_cap:
            retries += 1
            data = safe_get_json(f"{BASE}random.php")
            meal = (data.get("meals") or [None])[0]
            add_many(seen, [meal])

        if len(seen) < target_size:
            logger.warning("Random pool shortfall (%d/%d); falling back to Beef category", len(seen), target_size)
            fallback = hydrate_minimal_list(list_by_category("Beef")[:target_size])
            add_many(seen, fallback)

        pool = list(seen.values())
        random_pool_cache.set("pool", pool, RANDOM_POOL_TTL)
        logger.info("Random pool refreshed with %d meals", len(pool))
        return pool


def schedule_random_pool_warm(target_size: int) -> None:
    if target_size <= 0:
        return
    global random_pool_warming
    with random_pool_warm_lock:
        if random_pool_warming:
            return
        random_pool_warming = True

    def worker() -> None:
        try:
            ensure_random_pool(target_size)
        finally:
            global random_pool_warming
            with random_pool_warm_lock:
                random_pool_warming = False

    Thread(target=worker, daemon=True).start()


def random_meals(limit: int, *, tag: Optional[str] = None) -> List[dict]:
    target = max(RANDOM_POOL_TARGET, limit * 3)
    pool = random_pool_cache.get("pool")
    if not pool:
        pool = ensure_random_pool(max(limit * 2, 12), quick=True)
        if len(pool) < target:
            schedule_random_pool_warm(target)
    else:
        if len(pool) < target:
            schedule_random_pool_warm(target)
        pool = ensure_random_pool(limit, quick=True)

    if tag:
        filtered = [m for m in pool if tag_matches(m, tag)]
        if len(filtered) < limit:
            pool = ensure_random_pool(max(len(pool) + limit, RANDOM_POOL_TARGET * 2))
            if len(pool) < target:
                schedule_random_pool_warm(target)
            filtered = [m for m in pool if tag_matches(m, tag)]
        pool = filtered

    if not pool:
        return []

    if len(pool) <= limit:
        return pool

    return random.sample(pool, limit)


def list_categories() -> List[str]:
    cache_key = "categories"
    cached = list_cache.get(cache_key)
    if cached:
        return cached
    data = safe_get_json(f"{BASE}list.php?c=list")
    categories = [m["strCategory"] for m in (data.get("meals") or [])]
    list_cache.set(cache_key, categories, LIST_TTL)
    return categories


def list_areas() -> List[str]:
    cache_key = "areas"
    cached = list_cache.get(cache_key)
    if cached:
        return cached
    data = safe_get_json(f"{BASE}list.php?a=list")
    areas = [m["strArea"] for m in (data.get("meals") or [])]
    list_cache.set(cache_key, areas, LIST_TTL)
    return areas


def list_by_category(category: str) -> List[dict]:
    cache_key = f"cat:{category.lower()}"
    cached = list_cache.get(cache_key)
    if cached is not None:
        return cached
    data = safe_get_json(f"{BASE}filter.php?c={category}")
    meals = data.get("meals") or []
    list_cache.set(cache_key, meals, LIST_TTL)
    return meals


def list_by_area(area: str) -> List[dict]:
    cache_key = f"area:{area.lower()}"
    cached = list_cache.get(cache_key)
    if cached is not None:
        return cached
    data = safe_get_json(f"{BASE}filter.php?a={area}")
    meals = data.get("meals") or []
    list_cache.set(cache_key, meals, LIST_TTL)
    return meals


def search_by_text(q: str) -> List[dict]:
    cache_key = f"search:{q.lower()}"
    cached = search_cache.get(cache_key)
    if cached is not None:
        return cached
    data = safe_get_json(f"{BASE}search.php?s={q}")
    meals = data.get("meals") or []
    search_cache.set(cache_key, meals, SEARCH_TTL)
    return meals


def lookup(meal_id: str) -> Optional[dict]:
    cached = lookup_cache.get(meal_id)
    if cached is not None:
        return cached
    data = safe_get_json(f"{BASE}lookup.php?i={meal_id}")
    meals = data.get("meals") or []
    detail = meals[0] if meals else None
    if detail:
        lookup_cache.set(meal_id, detail, LOOKUP_TTL)
    return detail


def hydrate_minimal_list(min_list: List[dict]) -> List[dict]:
    ids = [m.get("idMeal") for m in (min_list or []) if m.get("idMeal")]
    if not ids:
        return []

    detail_map: Dict[str, dict] = {}
    missing: List[str] = []
    for meal_id in ids:
        cached = lookup_cache.get(meal_id)
        if cached is not None:
            detail_map[meal_id] = cached
        else:
            missing.append(meal_id)

    if missing:
        max_workers = min(8, len(missing))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_id = {executor.submit(lookup, meal_id): meal_id for meal_id in missing}
            for future in as_completed(future_to_id):
                meal_id = future_to_id[future]
                try:
                    detail = future.result()
                except HTTPException as exc:  # pragma: no cover - defensive logging
                    logger.warning("Lookup failed for %s: %s", meal_id, exc.detail)
                    continue
                except Exception:  # pragma: no cover - defensive logging
                    logger.exception("Lookup crashed for %s", meal_id)
                    continue
                if detail:
                    detail_map[meal_id] = detail

    return [detail_map[mid] for mid in ids if mid in detail_map]


def split_tags(s: Optional[str]) -> List[str]:
    return [t.strip() for t in (s or "").split(",") if t.strip()]


def tag_matches(meal: dict, tag: str) -> bool:
    wanted = tag.lower().strip()
    return any(t.lower() == wanted for t in split_tags(meal.get("strTags")))


def filter_meals(meals: List[dict], *, category: Optional[str], area: Optional[str], tag: Optional[str], q: Optional[str]) -> List[dict]:
    q_norm = (q or "").lower()
    wanted_tag = (tag or "").lower()
    out: List[dict] = []
    for m in meals:
        if category and m.get("strCategory") != category:
            continue
        if area and m.get("strArea") != area:
            continue
        tags = [t.lower() for t in split_tags(m.get("strTags"))]
        if wanted_tag and wanted_tag not in tags:
            continue
        if q_norm:
            hay = " ".join([
                m.get("strMeal") or "",
                m.get("strCategory") or "",
                m.get("strArea") or "",
                m.get("strTags") or "",
            ]).lower()
            if q_norm not in hay:
                continue
        out.append(m)
    return out


def unique_tags(meals: List[dict]) -> List[str]:
    tags = set()
    for m in meals:
        for t in split_tags(m.get("strTags")):
            tags.add(t)
    return sorted(tags)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/")
def root():
    return {
        "service": "Maaltidspreik API",
        "docs": "See /docs for interactive schema",
        "endpoints": {
            "GET /": "This descriptor",
            "GET /health": "Simple readiness check",
            "GET /categories": "List available categories",
            "GET /areas": "List available areas",
            "GET /tags": "List tags filtered by optional category/area/q",
            "GET /meals": "Retrieve meals with optional filters",
            "GET /meal": "Retrieve a single meal by id",
        },
    }


@app.get("/meal")
def get_meal(id: str = Query(...)):
    detail = lookup(id)
    if not detail:
        raise HTTPException(status_code=404, detail="Not found")
    return {"meal": detail}


@app.get("/categories")
def get_categories():
    return {"categories": list_categories()}


@app.get("/areas")
def get_areas():
    return {"areas": list_areas()}


@app.get("/tags")
def get_tags(
    category: Optional[str] = Query(None),
    area: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
):
    if category:
        base = hydrate_minimal_list(list_by_category(category)[:60])
    elif area:
        base = hydrate_minimal_list(list_by_area(area)[:60])
    elif q:
        base = search_by_text(q)
    else:
        base = ensure_random_pool(max(20, RANDOM_POOL_TARGET // 2), quick=True)
        schedule_random_pool_warm(RANDOM_POOL_TARGET)
    return {"tags": unique_tags(base)}


@app.get("/meals")
def get_meals(
    category: Optional[str] = Query(None),
    area: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
):
    limit = clamp(limit, 1, 50)
    page = max(1, page)
    start = (page - 1) * limit
    end = start + limit

    if category:
        minimal = list_by_category(category)
        total = len(minimal)
        slice_minimal = minimal[start:end]
        base = hydrate_minimal_list(slice_minimal)
        has_next = end < total
    elif area:
        minimal = list_by_area(area)
        total = len(minimal)
        slice_minimal = minimal[start:end]
        base = hydrate_minimal_list(slice_minimal)
        has_next = end < total
    elif q:
        full = search_by_text(q)
        total = len(full)
        base = full[start:end]
        has_next = end < total
    else:
        base = random_meals(limit, tag=tag)
        total = len(base)
        has_next = False
        page = 1
        start = 0
        end = total

    meals = filter_meals(base, category=category, area=area, tag=tag, q=q)

    return {
        "meals": meals,
        "page": page,
        "limit": limit,
        "total": total,
        "has_prev": page > 1,
        "has_next": has_next,
    }
