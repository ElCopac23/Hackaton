# Field Assistant: farm home (hackathon prototype)

EU Agri Hackathon 2026, Challenge 2. One farm (FARM-00455, synthetic, Loiret FRB06, 86.2 ha, 14 fields).
The farm home shows the farm today, lets the farmer log an activity by text or voice, and turns the
records into advice: timing first, then stock, then nitrogen.

## Run it

No install needed (Python 3 and Chrome).

```bash
python3 scripts/build_data.py      # dataset CSVs -> web/data/farm.json, weather.json (about 40 s)
python3 scripts/serve.py           # then open http://127.0.0.1:8765/
```

`build_data.py --refresh-forecast` fetches a new Open-Meteo forecast. Without it, the saved snapshot is reused
so the demo stays the same. "Reset demo" in the top bar removes logged activities.

## Demo path

1. Farm home: assistant shows the maize harvest window and the autumn workload; NPK stock is low.
2. Click a wheat field (P-5182): soil, 10 seasons of yield and nitrogen, timeline.
3. Log activity → "Applied 100 kg of complex fertiliser before wheat sowing for all fields".
   The assistant asks "all 14 fields or the 3 wheat fields?", then shows the record to confirm.
4. After saving: wheat moves up to "sow 21.6 ha", NPK stock turns critical (837 kg left), both marked "Updated".
5. Log "Sprayed Nuvexa, 1 litre per hectare on the wheat": it asks which Nuvexa, then updates the herbicide stock.

## Where the data comes from

| Screen | Data | Type |
|---|---|---|
| Map, field card | `synthetic_parcel`, `synthetic_soil`, `synthetic_field_weather`, `synthetic_irrigation` | Dataset (synthetic) |
| Activities, timeline, history | `synthetic_planting`, `_fertilisation`, `_plant_protection`, `_harvest` 2017-2026 | Dataset (synthetic) |
| Nitrogen reference | `combined_region_crop_availability` (NPKGRIDS, 2020) | Dataset (regional) |
| Weather history and normals | `weather_daily` 2015-2024 (AgERA5), `synthetic_weather_monthly`, `combined_region_climate_normals` | Dataset (regional) |
| Forecast | Open-Meteo API, CC BY 4.0, snapshot | Open data |
| Stock, autumn plan, thresholds, field notes | `web/data/stock.json`, `web/data/assumptions.json` | Simulated, set by the team |
| NDVI | Derived from field status | Simulated (the dataset has no satellite data) |

63 operations dated after the same season's harvest are left out as implausible; growth stages (BBCH) are not
shown because they often contradict the dates.

## How the advice works

Rules only, no AI service (`web/js/rules.js`). Thresholds and work rates live in `web/data/assumptions.json`
and are rules of thumb to be confirmed by an adviser. A language model is on the roadmap.

- Timing: forecast days are checked per operation (rain, rain probability, wind, rain in the previous 2 days).
  The window closes at the first two unsuitable days in a row. Jobs are ranked by how soon their window closes,
  whether the sequence is already started, and the farm's own sowing dates since 2017.
- Stock: product needed for the remaining autumn jobs vs stock; low if it covers the next job only,
  critical if it does not.
- Nitrogen: 10-season average per crop vs the regional reference, with the latest yield against the farm's history.

## Declarations

Tools: Python 3 standard library, plain HTML/CSS/JavaScript (no libraries), Chrome Web Speech API for voice
(audio is processed by Google's speech service), Open-Meteo forecast API. Code written with an AI coding
assistant (Claude Code) during the hackathon.

Do not publish `web/data/farm.json`, `weather.json` or `forecast_snapshot.json`: they are derived from the
hackathon dataset (see `.gitignore`).
