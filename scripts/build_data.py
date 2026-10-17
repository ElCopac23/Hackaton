#!/usr/bin/env python3
"""Build the demo data files for one farm from the EU Agri Hackathon dataset.

Usage (from the farm-assistant folder):
    python3 scripts/build_data.py
    python3 scripts/build_data.py --refresh-forecast   # fetch a new Open-Meteo snapshot

Reads the hackathon CSVs and writes:
    web/data/farms/FARM-00455.json  full farm: parcels, soil, 2017-2026 operations, history, economics
    web/data/farms/FARM-00268.json  onboarded farm: fields and 2026 crops only (as answered in onboarding)
    web/data/farms/index.json       the farms the apps can switch between
    web/data/weather.json           forecast snapshot, autumn history and normals for the region

web/data/stock.json and assumptions.json are hand-written (simulated, set by the PM).

The output is derived from the hackathon dataset. Keep it private: the Terms
forbid publishing or redistributing the datasets.
"""
import argparse
import collections
import csv
import datetime
import json
import os
import statistics
import urllib.request

# "full": everything the dataset holds. "basic": only what the questionnaire asks for
# (fields and current crops); the rest of the dataset row is ignored on purpose.
HOLDINGS = {"FARM-00455": "full", "FARM-00268": "basic"}
TODAY = "2026-10-17"
YEARS = range(2017, 2027)
COST_YEARS = range(2022, 2027)  # seasons used for implied unit costs
CROP_CODES = ("COWT", "BARL", "RAPE", "MAIZ", "SUNF")
INPUTS = ("seeds", "fertiliser", "crop_protection", "energy", "feed", "contract_work", "wages", "depreciation")
# Autumn sowing window used for the regional history and daily normals.
WINDOW_START, WINDOW_END = "10-17", "11-15"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_DATASET = os.path.join(os.path.dirname(ROOT), "dg-agri-hackathon-datasets")
OUT = os.path.join(ROOT, "web", "data")
FARMS_OUT = os.path.join(OUT, "farms")

REGION_NAMES = {"FRB06": "Loiret"}


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def num(value):
    if value in (None, "", "\\N"):
        return None
    return float(value)


def wmean(pairs):
    """Area-weighted mean of (value, weight) pairs."""
    pairs = [(v, w) for v, w in pairs if v is not None]
    total = sum(w for _, w in pairs)
    return round(sum(v * w for v, w in pairs) / total, 2) if total else None


def median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 2) if values else None


def parcel_record(r):
    area = float(r["area_ha"])
    return {
        "id": r["parcel_id"],
        "short": r["parcel_id"][-4:],
        "crop": r["crop_current"],
        "crop_previous": r["crop_previous"],
        "use": r["crop_use"],
        "tenure": r["tenure"],
        "area_ha": area,
        # Local metre coordinates of the square's lower-left corner; schematic only.
        "x": float(r["x_local_m"]),
        "y": float(r["y_local_m"]),
        "side_m": round(area ** 0.5 * 100, 1),
    }


def read_dataset(ds):
    """One pass over the large tables: the demo farms' parcels and operations, plus
    yields of comparable farms in the same region (arable holdings) for benchmarks."""
    holdings = {r["holding_id"]: r for r in rows(f"{ds}/synthetic/synthetic_holding.csv")}
    region = holdings["FARM-00455"]["nuts3"]
    peers = {h for h, r in holdings.items()
             if r["nuts3"] == region and r["farm_type_tf8"] == "1" and h not in HOLDINGS}

    parcels = collections.defaultdict(dict)
    owner = {}
    peer_parcels = set()
    for r in rows(f"{ds}/synthetic/synthetic_parcel.csv"):
        if r["holding_id"] in HOLDINGS:
            parcels[r["holding_id"]][r["parcel_id"]] = parcel_record(r)
            owner[r["parcel_id"]] = r["holding_id"]
        elif r["holding_id"] in peers:
            peer_parcels.add(r["parcel_id"])

    # Operations are read only for "full" farms.
    full = {pid for pid, h in owner.items() if HOLDINGS[h] == "full"}
    events = collections.defaultdict(list)
    field_weather = collections.defaultdict(dict)
    irrigation = collections.defaultdict(dict)
    soil = {}
    peer_yields = collections.defaultdict(list)
    for r in rows(f"{ds}/synthetic/synthetic_soil.csv"):
        if r["parcel_id"] in full:
            soil[r["parcel_id"]] = {k: num(v) for k, v in r.items() if k != "parcel_id"}
    for y in YEARS:
        for r in rows(f"{ds}/synthetic/synthetic_planting_{y}.csv"):
            if r["parcel_id"] in full:
                events[owner[r["parcel_id"]]].append({
                    "id": f"sow-{r['planting_id']}", "type": "sowing", "parcel": r["parcel_id"],
                    "campaign": int(r["year"]), "date": r["plant_date"],
                    "crop": r["crop"], "variety": r["variety"], "seed_origin": r["seed_origin"],
                    "rate": num(r["seed_rate_kg_ha"]), "unit": "kg/ha"})
        for r in rows(f"{ds}/synthetic/synthetic_fertilisation_{y}.csv"):
            if r["parcel_id"] in full:
                events[owner[r["parcel_id"]]].append({
                    "id": f"fert-{r['fertilisation_id']}", "type": "fertilisation", "parcel": r["parcel_id"],
                    "campaign": int(r["year"]), "date": r["app_date"],
                    "product_type": r["product_type"], "method": r["method"],
                    "n": num(r["n_kg_ha"]), "p2o5": num(r["p2o5_kg_ha"]), "k2o": num(r["k2o_kg_ha"])})
        for r in rows(f"{ds}/synthetic/synthetic_plant_protection_{y}.csv"):
            if r["parcel_id"] in full:
                # crop_stage_bbch is left out: it often contradicts the application date.
                events[owner[r["parcel_id"]]].append({
                    "id": f"pp-{r['pp_id']}", "type": "spraying", "parcel": r["parcel_id"],
                    "campaign": int(r["year"]), "date": r["app_date"],
                    "product_type": r["product_type"], "product": r["product_name"],
                    "active_substance": r["active_substance"],
                    "rate": num(r["dose_l_or_kg_ha"]), "unit": "L or kg/ha"})
        for r in rows(f"{ds}/synthetic/synthetic_harvest_{y}.csv"):
            if r["parcel_id"] in full:
                events[owner[r["parcel_id"]]].append({
                    "id": f"harv-{r['harvest_id']}", "type": "harvest", "parcel": r["parcel_id"],
                    "campaign": int(r["year"]), "date": r["harvest_date"], "crop": r["crop"],
                    "yield_t_ha": num(r["yield_t_ha"]), "moisture_pct": num(r["moisture_pct"]),
                    "protein_pct": num(r["protein_pct"])})
            elif r["parcel_id"] in peer_parcels and r["harvest_date"] <= TODAY and r["crop"] in CROP_CODES:
                peer_yields[r["crop"]].append(num(r["yield_t_ha"]))
        for r in rows(f"{ds}/synthetic/synthetic_field_weather_{y}.csv"):
            if r["parcel_id"] in full:
                field_weather[r["parcel_id"]][y] = {k: num(r[k]) for k in
                                                    ("tmean_c", "precip_mm", "irrigation_mm", "water_total_mm", "et0_mm", "gdd_annual")}
        for r in rows(f"{ds}/synthetic/synthetic_irrigation_{y}.csv"):
            if r["parcel_id"] in full:
                irrigation[r["parcel_id"]][y] = {"irrigated": r["irrigated"] == "1", "water_mm": num(r["water_mm"])}

    return {"holdings": holdings, "region": region, "peers": peers, "parcels": parcels, "events": events,
            "soil": soil, "field_weather": field_weather, "irrigation": irrigation, "peer_yields": peer_yields}


def clean_events(events):
    """Drop operations dated after the same season's harvest on the same field:
    the synthetic data contains some (for example fertiliser on maize weeks after harvest)."""
    harvest_date = {(e["parcel"], e["campaign"]): e["date"] for e in events if e["type"] == "harvest"}
    kept, dropped = [], collections.Counter()
    for e in events:
        hd = harvest_date.get((e["parcel"], e["campaign"]))
        if e["type"] != "harvest" and hd and e["date"] > hd:
            dropped[e["type"]] += 1
            continue
        e["status"] = "planned" if e["date"] > TODAY else "done"
        e["source"] = "records"
        kept.append(e)
    kept.sort(key=lambda e: (e["date"], e["parcel"]))
    return kept, dropped


def build_history(parcels, kept):
    """Personal history per crop: sowing window, seed rate, yield, nitrogen and input use per hectare."""
    crops = sorted({p["crop"] for p in parcels.values()})
    per_season = collections.defaultdict(lambda: {"seed": 0.0, "nutrients": 0.0, "spray": 0.0})
    for e in kept:
        if e["status"] != "done" or e["campaign"] > int(TODAY[:4]):
            continue
        acc = per_season[(e["parcel"], e["campaign"])]
        if e["type"] == "sowing":
            acc["seed"] += e["rate"] or 0
        elif e["type"] == "fertilisation":
            acc["nutrients"] += (e["n"] or 0) + (e["p2o5"] or 0) + (e["k2o"] or 0)
        elif e["type"] == "spraying":
            acc["spray"] += e["rate"] or 0
    history = {}
    for crop in crops:
        sow = [e for e in kept if e["type"] == "sowing" and e["crop"] == crop]
        md = sorted(e["date"][5:] for e in sow)
        yield_by_year, n_by_year = {}, {}
        for y in YEARS:
            yield_by_year[y] = wmean([(e["yield_t_ha"], parcels[e["parcel"]]["area_ha"]) for e in kept
                                      if e["type"] == "harvest" and e["crop"] == crop and e["campaign"] == y])
            n_per_parcel = collections.defaultdict(float)
            for e in kept:
                if e["type"] == "fertilisation" and e["campaign"] == y and parcels[e["parcel"]]["crop"] == crop:
                    n_per_parcel[e["parcel"]] += e["n"] or 0
            n_by_year[y] = wmean([(v, parcels[pid]["area_ha"]) for pid, v in n_per_parcel.items()])
        seasons = [(acc, parcels[pid]["area_ha"]) for (pid, _), acc in per_season.items() if parcels[pid]["crop"] == crop]
        history[crop] = {
            "sowing": {"earliest": md[0], "median": md[len(md) // 2], "latest": md[-1], "n": len(md)} if md else None,
            "seed_rate_median": statistics.median([e["rate"] for e in sow if e["rate"]]) if sow else None,
            "yield_by_year": yield_by_year,
            "n_by_year": n_by_year,
            # Average use per hectare and season, from the farm's own operations.
            "inputs_per_ha": {k: wmean([(acc[k], w) for acc, w in seasons]) for k in ("seed", "nutrients", "spray")},
        }
    return history


def build_economics(ds, holding, parcels, kept):
    """Farm accounts from the synthetic economics, subsidy, sales and indicator tables, plus unit costs
    implied by the accounts and the farm's own operations (cost in euros / quantity applied)."""
    area = sum(p["area_ha"] for p in parcels.values())
    years = {}
    for r in rows(f"{ds}/synthetic/synthetic_farm_economics.csv"):
        if r["holding_id"] == holding:
            years[int(r["year"])] = {
                "year": int(r["year"]), "output": num(r["total_output_eur"]),
                "inputs": {k: num(r[f"{k}_eur"]) for k in INPUTS},
                "total_inputs": num(r["total_inputs_eur"]), "fnva": num(r["farm_net_value_added_eur"]),
                "subsidies": {},
            }
    for r in rows(f"{ds}/synthetic/synthetic_subsidy.csv"):
        if r["holding_id"] == holding and int(r["year"]) in years:
            subs = years[int(r["year"])]["subsidies"]
            subs[r["scheme"]] = round(subs.get(r["scheme"], 0) + float(r["amount_eur"]), 2)
    for r in rows(f"{ds}/synthetic/synthetic_farm_indicator.csv"):
        if r["holding_id"] == holding and int(r["year"]) in years:
            years[int(r["year"])].update({
                "cash_flow": num(r["cash_flow_eur"]), "awu": num(r["total_labour_awu"]),
                "fnva_per_awu": num(r["fnva_per_awu_eur"]), "total_assets": num(r["total_assets_eur"]),
            })
    for y in years.values():
        y["subsidies_total"] = round(sum(y["subsidies"].values()), 2)
    sales = [{"year": int(r["year"]), "date": r["txn_date"], "product": r["product"], "volume_t": num(r["volume_t"]),
              "price_eur_t": num(r["price_eur_t"]), "contract": r["contract_type"], "grade": r["quality_grade"]}
             for r in rows(f"{ds}/synthetic/synthetic_transaction_sale.csv") if r["holding_id"] == holding]
    sales.sort(key=lambda x: x["date"])

    qty = collections.Counter()
    for e in kept:
        if e["status"] != "done" or e["campaign"] not in COST_YEARS:
            continue
        a = parcels[e["parcel"]]["area_ha"]
        if e["type"] == "sowing":
            qty["seed"] += (e["rate"] or 0) * a
        elif e["type"] == "fertilisation":
            qty["nutrients"] += ((e["n"] or 0) + (e["p2o5"] or 0) + (e["k2o"] or 0)) * a
        elif e["type"] == "spraying":
            qty["spray"] += (e["rate"] or 0) * a
    cost = lambda k: sum(years[y]["inputs"][k] for y in COST_YEARS if y in years)
    other = ("energy", "contract_work", "wages", "depreciation")
    unit_costs = {
        "seasons": f"{COST_YEARS[0]}-{COST_YEARS[-1]}",
        "seed_eur_kg": round(cost("seeds") / qty["seed"], 3) if qty["seed"] else None,
        "nutrient_eur_kg": round(cost("fertiliser") / qty["nutrients"], 3) if qty["nutrients"] else None,
        "protection_eur_l": round(cost("crop_protection") / qty["spray"], 2) if qty["spray"] else None,
        "other_eur_ha": round(sum(cost(k) for k in other) / len(COST_YEARS) / area, 1),
        "other_items": list(other),
    }
    return {"years": [years[y] for y in sorted(years)], "sales": sales, "unit_costs": unit_costs,
            "source": "Synthetic farm economics, subsidy, sales and indicator tables (EU Agri Hackathon dataset)"}


def build_benchmark(ds, data):
    """Median yields and money per hectare on comparable farms (arable holdings in the same region)."""
    peers = data["peers"]
    holdings = data["holdings"]
    per_ha = collections.defaultdict(list)
    subs = collections.defaultdict(float)
    for r in rows(f"{ds}/synthetic/synthetic_subsidy.csv"):
        if r["holding_id"] in peers and r["year"] == TODAY[:4]:
            subs[r["holding_id"]] += float(r["amount_eur"])
    for r in rows(f"{ds}/synthetic/synthetic_farm_economics.csv"):
        if r["holding_id"] in peers and r["year"] == TODAY[:4]:
            uaa = float(holdings[r["holding_id"]]["uaa_ha"])
            if uaa <= 0:
                continue
            per_ha["output"].append(float(r["total_output_eur"]) / uaa)
            per_ha["total_inputs"].append(float(r["total_inputs_eur"]) / uaa)
            for k in INPUTS:
                per_ha[k].append(float(r[f"{k}_eur"]) / uaa)
            per_ha["subsidies"].append(subs.get(r["holding_id"], 0) / uaa)
    return {
        "region": data["region"], "farms": len(peers), "year": int(TODAY[:4]),
        "yield_t_ha": {c: median(v) for c, v in sorted(data["peer_yields"].items())},
        "yield_records": {c: len(v) for c, v in sorted(data["peer_yields"].items())},
        "eur_per_ha": {k: median(v) for k, v in per_ha.items()},
        "source": f"Median of {len(peers)} synthetic arable farms in {data['region']} (EU Agri Hackathon dataset)",
    }


def market_prices(ds):
    prices = collections.defaultdict(list)
    for r in rows(f"{ds}/synthetic/synthetic_market_price.csv"):
        ym = f"{r['year']}-{int(r['month']):02d}"
        if r["product"] in CROP_CODES and ym <= TODAY[:7]:
            prices[r["product"]].append([ym, num(r["price_eur_t"])])
    return {c: sorted(v) for c, v in prices.items()}


def regional_reference(ds, region, crops):
    regional = {}
    for r in rows(f"{ds}/combined/combined_region_crop_availability.csv"):
        if r["nuts3_id"] == region and r["native_crop_code"] in crops:
            regional[r["native_crop_code"]] = {
                "group": r["crop_group_code"], "n_kg_ha": num(r["regional_nitrogen_kg_ha"]),
                "p2o5_kg_ha": num(r["regional_phosphate_p2o5_kg_ha"]), "k2o_kg_ha": num(r["regional_potash_k2o_kg_ha"]),
                "yield_t_ha": num(r["regional_yield_t_ha"]),
                "yield_comparison_supported": r["yield_comparison_supported"] == "1",
                "reference_year": r["npk_reference_year"], "quality": r["npk_quality_flag"],
            }
    return regional


# What a complete profile holds; "basic" farms gave only the first two in the onboarding questionnaire.
PROFILE_ITEMS = [
    ("fields", "Fields", True), ("crops", "Crops 2026", True), ("records", "Past seasons' records", False),
    ("soil", "Soil analyses", False), ("cap", "CAP documents", False), ("accounts", "Farm accounts", False),
    ("stock", "Stock in the shed", False),
]


def build_farm(ds, data, holding, level, shared):
    region = data["holdings"][holding]["nuts3"]
    parcels = data["parcels"][holding]
    crops = sorted({p["crop"] for p in parcels.values()})
    meta = {
        "holding_id": holding, "today": TODAY, "region": region,
        "region_name": REGION_NAMES.get(region, region), "country": region[:2],
        "area_ha": round(sum(p["area_ha"] for p in parcels.values()), 2), "parcels": len(parcels),
        "level": level, "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "note": "Synthetic farm records from the EU Agri Hackathon dataset. Not a real farm.",
    }
    farm = {"meta": meta, "regional": regional_reference(ds, region, crops), **shared}
    if level == "basic":
        # Only what the farmer answered in the onboarding questionnaire: fields and 2026 crops.
        keep = ("id", "short", "crop", "tenure", "area_ha", "x", "y", "side_m")
        farm["parcels"] = sorted(({k: p[k] for k in keep} for p in parcels.values()), key=lambda p: p["id"])
        farm["events"] = []
        farm["history"] = {}
        meta["onboarding"] = {"method": "questionnaire", "date": "2026-10-16",
                              "items": [{"key": k, "label": l, "done": req} for k, l, req in PROFILE_ITEMS]}
        meta["dropped_events"] = {}
        return farm

    holding_row = data["holdings"][holding]
    kept, dropped = clean_events(data["events"][holding])
    for pid, p in parcels.items():
        p["soil"] = data["soil"].get(pid)
        p["field_weather"] = data["field_weather"][pid]
        p["irrigation"] = data["irrigation"][pid]
    meta.update({"organic": holding_row["organic"] == "1", "farm_type_tf8": holding_row["farm_type_tf8"],
                 "dropped_events": dict(dropped),
                 "onboarding": {"method": "records", "items": [{"key": k, "label": l, "done": True} for k, l, _ in PROFILE_ITEMS]}})
    farm.update({
        "parcels": sorted(parcels.values(), key=lambda p: p["id"]),
        "events": kept,
        "history": build_history(parcels, kept),
        "economics": build_economics(ds, holding, parcels, kept),
    })
    return farm


def build_weather(ds, region, refresh):
    daily = []
    header = None
    for y in range(2015, 2025):
        with open(f"{ds}/weather/weather_daily_{y}.csv", encoding="utf-8") as f:
            header = next(csv.reader([f.readline()]))
            tag = f",{region},"
            for line in f:
                if tag in line:
                    r = dict(zip(header, next(csv.reader([line]))))
                    if r["nuts3_id"] == region:
                        daily.append(r)
    lat = round(float(daily[0]["centroid_latitude"]), 3)
    lon = round(float(daily[0]["centroid_longitude"]), 3)

    in_window = [r for r in daily if WINDOW_START <= r["date"][5:] <= WINDOW_END]
    autumn = []
    for y in range(2015, 2025):
        rs = [r for r in in_window if r["date"].startswith(str(y))]
        precip = [float(r["precipitation_mm"]) for r in rs]
        autumn.append({
            "year": y, "days": len(rs),
            "dry_days": sum(p < 1 for p in precip),
            "rain5_days": sum(p >= 5 for p in precip),
            "total_mm": round(sum(precip), 1),
            "frost_days": sum(int(r["frost_day"]) for r in rs),
            "mean_wind_ms": round(statistics.mean(float(r["wind_speed_m_s"]) for r in rs), 2),
        })

    by_md = collections.defaultdict(list)
    for r in in_window:
        by_md[r["date"][5:]].append(r)
    normals = []
    for md in sorted(by_md):
        rs = by_md[md]
        normals.append({
            "md": md,
            "precip_mean": round(statistics.mean(float(r["precipitation_mm"]) for r in rs), 2),
            "rain_share": round(sum(float(r["precipitation_mm"]) >= 1 for r in rs) / len(rs), 2),
            "tmin_mean": round(statistics.mean(float(r["temperature_min_c"]) for r in rs), 1),
            "tmax_mean": round(statistics.mean(float(r["temperature_max_c"]) for r in rs), 1),
            "frost_share": round(sum(int(r["frost_day"]) for r in rs) / len(rs), 2),
            "wind_mean_ms": round(statistics.mean(float(r["wind_speed_m_s"]) for r in rs), 2),
        })

    season = [{"month": int(r["month"]), "tmean_c": num(r["tmean_c"]), "tmin_c": num(r["tmin_c"]),
               "tmax_c": num(r["tmax_c"]), "precip_mm": num(r["precip_mm"]), "et0_mm": num(r["et0_mm"])}
              for r in rows(f"{ds}/synthetic/synthetic_weather_monthly.csv")
              if r["nuts3"] == region and r["year"] == TODAY[:4] and int(r["month"]) < int(TODAY[5:7])]
    season.sort(key=lambda m: m["month"])

    normals_row = next(r for r in rows(f"{ds}/combined/combined_region_climate_normals.csv") if r["nuts3_id"] == region)
    climate = {k: num(v) for k, v in normals_row.items() if k.startswith("regional_")}

    forecast_path = os.path.join(OUT, "forecast_snapshot.json")
    if refresh or not os.path.exists(forecast_path):
        url = ("https://api.open-meteo.com/v1/forecast"
               f"?latitude={lat}&longitude={lon}&timezone=Europe%2FParis&forecast_days=10"
               "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
               "precipitation_probability_max,wind_speed_10m_max")
        with urllib.request.urlopen(url, timeout=30) as resp:
            raw = json.load(resp)
        d = raw["daily"]
        snapshot = {
            "source": "Open-Meteo forecast API (open-meteo.com), CC BY 4.0",
            "fetched_at": datetime.datetime.now().isoformat(timespec="minutes"),
            "location": {"lat": lat, "lon": lon, "note": f"{region} region centre"},
            "days": [{"date": d["time"][i], "weather_code": d["weather_code"][i],
                      "tmax": d["temperature_2m_max"][i], "tmin": d["temperature_2m_min"][i],
                      "precip_mm": d["precipitation_sum"][i], "precip_prob": d["precipitation_probability_max"][i],
                      "wind_max_kmh": d["wind_speed_10m_max"][i]} for i in range(len(d["time"]))],
        }
        with open(forecast_path, "w") as f:
            json.dump(snapshot, f, indent=1)
    with open(forecast_path) as f:
        forecast = json.load(f)

    return {
        "region": region,
        "forecast": forecast,
        "autumn_history": {"window": f"{WINDOW_START} to {WINDOW_END}", "source": "AgERA5 daily reanalysis, regional",
                           "years": autumn},
        "daily_normals": {"source": "AgERA5 daily reanalysis 2015-2024, regional", "days": normals},
        "season_monthly": {"year": int(TODAY[:4]), "source": "Synthetic monthly weather (dataset)", "months": season},
        "climate_normals": {"source": "Regional climate normals 2015-2024 (dataset)", **climate},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=DEFAULT_DATASET)
    ap.add_argument("--refresh-forecast", action="store_true")
    args = ap.parse_args()
    os.makedirs(FARMS_OUT, exist_ok=True)

    data = read_dataset(args.dataset)
    shared = {"regional_benchmark": build_benchmark(args.dataset, data), "market_prices": market_prices(args.dataset)}
    index = []
    for holding, level in HOLDINGS.items():
        farm = build_farm(args.dataset, data, holding, level, shared)
        with open(os.path.join(FARMS_OUT, f"{holding}.json"), "w") as f:
            json.dump(farm, f, separators=(",", ":"))
        meta = farm["meta"]
        items = meta["onboarding"]["items"]
        index.append({"id": holding, "region_name": meta["region_name"], "country": meta["country"],
                      "area_ha": meta["area_ha"], "parcels": meta["parcels"], "level": level,
                      "crops": sorted({p["crop"] for p in farm["parcels"]}),
                      "completeness": round(sum(i["done"] for i in items) / len(items), 2)})
        econ = farm.get("economics")
        print(f"{holding}.json ({level}): {meta['parcels']} parcels, {len(farm['events'])} events"
              + (f", economics {econ['years'][0]['year']}-{econ['years'][-1]['year']}, unit costs {econ['unit_costs']}" if econ else ""))
    with open(os.path.join(FARMS_OUT, "index.json"), "w") as f:
        json.dump({"default": next(iter(HOLDINGS)), "farms": index}, f, indent=1)
    b = shared["regional_benchmark"]
    print(f"benchmark: {b['farms']} farms, yields {b['yield_t_ha']}")

    weather = build_weather(args.dataset, data["region"], args.refresh_forecast)
    with open(os.path.join(OUT, "weather.json"), "w") as f:
        json.dump(weather, f, indent=1)
    print(f"weather.json: {len(weather['forecast']['days'])} forecast days, "
          f"{len(weather['autumn_history']['years'])} autumns, {len(weather['season_monthly']['months'])} months")


if __name__ == "__main__":
    main()
