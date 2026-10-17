#!/usr/bin/env python3
"""Build the demo data files for one farm from the EU Agri Hackathon dataset.

Usage (from the farm-assistant folder):
    python3 scripts/build_data.py
    python3 scripts/build_data.py --refresh-forecast   # fetch a new Open-Meteo snapshot

Reads the hackathon CSVs and writes:
    web/data/farm.json      parcels, soil, 2017-2026 operations, personal history, regional reference
    web/data/weather.json   forecast snapshot, autumn history and normals for the farm's region

web/data/stock.json is hand-written (simulated opening stock, set by the PM).

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

HOLDING = "FARM-00455"
TODAY = "2026-10-17"
YEARS = range(2017, 2027)
# Autumn sowing window used for the regional history and daily normals.
WINDOW_START, WINDOW_END = "10-17", "11-15"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_DATASET = os.path.join(os.path.dirname(ROOT), "dg-agri-hackathon-datasets")
OUT = os.path.join(ROOT, "web", "data")

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


def build_farm(ds):
    holding = next(r for r in rows(f"{ds}/synthetic/synthetic_holding.csv") if r["holding_id"] == HOLDING)
    region = holding["nuts3"]

    parcels = {}
    for r in rows(f"{ds}/synthetic/synthetic_parcel.csv"):
        if r["holding_id"] != HOLDING:
            continue
        area = float(r["area_ha"])
        parcels[r["parcel_id"]] = {
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

    for r in rows(f"{ds}/synthetic/synthetic_soil.csv"):
        if r["parcel_id"] in parcels:
            parcels[r["parcel_id"]]["soil"] = {k: num(v) for k, v in r.items() if k != "parcel_id"}

    events = []
    field_weather = collections.defaultdict(dict)
    irrigation = collections.defaultdict(dict)
    for y in YEARS:
        for r in rows(f"{ds}/synthetic/synthetic_planting_{y}.csv"):
            if r["parcel_id"] in parcels:
                events.append({"id": f"sow-{r['planting_id']}", "type": "sowing", "parcel": r["parcel_id"],
                               "campaign": int(r["year"]), "date": r["plant_date"],
                               "crop": r["crop"], "variety": r["variety"], "seed_origin": r["seed_origin"],
                               "rate": num(r["seed_rate_kg_ha"]), "unit": "kg/ha"})
        for r in rows(f"{ds}/synthetic/synthetic_fertilisation_{y}.csv"):
            if r["parcel_id"] in parcels:
                events.append({"id": f"fert-{r['fertilisation_id']}", "type": "fertilisation", "parcel": r["parcel_id"],
                               "campaign": int(r["year"]), "date": r["app_date"],
                               "product_type": r["product_type"], "method": r["method"],
                               "n": num(r["n_kg_ha"]), "p2o5": num(r["p2o5_kg_ha"]), "k2o": num(r["k2o_kg_ha"])})
        for r in rows(f"{ds}/synthetic/synthetic_plant_protection_{y}.csv"):
            if r["parcel_id"] in parcels:
                # crop_stage_bbch is left out: it often contradicts the application date.
                events.append({"id": f"pp-{r['pp_id']}", "type": "spraying", "parcel": r["parcel_id"],
                               "campaign": int(r["year"]), "date": r["app_date"],
                               "product_type": r["product_type"], "product": r["product_name"],
                               "active_substance": r["active_substance"],
                               "rate": num(r["dose_l_or_kg_ha"]), "unit": "L or kg/ha"})
        for r in rows(f"{ds}/synthetic/synthetic_harvest_{y}.csv"):
            if r["parcel_id"] in parcels:
                events.append({"id": f"harv-{r['harvest_id']}", "type": "harvest", "parcel": r["parcel_id"],
                               "campaign": int(r["year"]), "date": r["harvest_date"], "crop": r["crop"],
                               "yield_t_ha": num(r["yield_t_ha"]), "moisture_pct": num(r["moisture_pct"]),
                               "protein_pct": num(r["protein_pct"])})
        for r in rows(f"{ds}/synthetic/synthetic_field_weather_{y}.csv"):
            if r["parcel_id"] in parcels:
                field_weather[r["parcel_id"]][y] = {k: num(r[k]) for k in
                                                    ("tmean_c", "precip_mm", "irrigation_mm", "water_total_mm", "et0_mm", "gdd_annual")}
        for r in rows(f"{ds}/synthetic/synthetic_irrigation_{y}.csv"):
            if r["parcel_id"] in parcels:
                irrigation[r["parcel_id"]][y] = {"irrigated": r["irrigated"] == "1", "water_mm": num(r["water_mm"])}

    # Drop operations dated after the same season's harvest on the same field:
    # the synthetic data contains some (for example fertiliser on maize weeks after harvest).
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

    for pid, p in parcels.items():
        p["field_weather"] = field_weather[pid]
        p["irrigation"] = irrigation[pid]

    # Personal history per crop: sowing window, seed rate, yield and nitrogen by season.
    crops = sorted({p["crop"] for p in parcels.values()})
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
        history[crop] = {
            "sowing": {"earliest": md[0], "median": md[len(md) // 2], "latest": md[-1], "n": len(md)} if md else None,
            "seed_rate_median": statistics.median([e["rate"] for e in sow if e["rate"]]) if sow else None,
            "yield_by_year": yield_by_year,
            "n_by_year": n_by_year,
        }

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

    return {
        "meta": {
            "holding_id": HOLDING, "today": TODAY, "region": region,
            "region_name": REGION_NAMES.get(region, region), "country": region[:2],
            "area_ha": round(sum(p["area_ha"] for p in parcels.values()), 2), "parcels": len(parcels),
            "organic": holding["organic"] == "1", "farm_type_tf8": holding["farm_type_tf8"],
            "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "dropped_events": dict(dropped),
            "note": "Synthetic farm records from the EU Agri Hackathon dataset. Not a real farm.",
        },
        "parcels": sorted(parcels.values(), key=lambda p: p["id"]),
        "events": kept,
        "history": history,
        "regional": regional,
    }


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
    os.makedirs(OUT, exist_ok=True)

    farm = build_farm(args.dataset)
    with open(os.path.join(OUT, "farm.json"), "w") as f:
        json.dump(farm, f, separators=(",", ":"))
    print(f"farm.json: {farm['meta']['parcels']} parcels, {len(farm['events'])} events, dropped {farm['meta']['dropped_events']}")

    weather = build_weather(args.dataset, farm["meta"]["region"], args.refresh_forecast)
    with open(os.path.join(OUT, "weather.json"), "w") as f:
        json.dump(weather, f, indent=1)
    print(f"weather.json: {len(weather['forecast']['days'])} forecast days, "
          f"{len(weather['autumn_history']['years'])} autumns, {len(weather['season_monthly']['months'])} months")


if __name__ == "__main__":
    main()
