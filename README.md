# DemetrAg: farm home (hackathon prototype)

EU Agri Hackathon 2026, Challenge 2. Two synthetic farms in Loiret (FRB06):

- **FARM-00455** (86.2 ha, 14 fields): full records, accounts, CAP payments and stock.
- **FARM-00268** (40.9 ha, 7 fields): a farmer onboarded through the questionnaire, so only fields and 2026 crops.

The farm home (office) and the phone app (field) show the farm today, let the farmer log work by text or voice,
add notes and photos, and turn it all into advice with its euro value: timing first, then stock, then nitrogen.

## Run it

No install needed (Python 3; Chrome or Safari).

```bash
python3 scripts/build_data.py          # dataset CSVs -> web/data/farms/*.json, weather.json (about 40 s)
python3 scripts/server.py --lan        # farm home + phone app + live sync
```

- Farm home on the Mac: http://127.0.0.1:8765/
- Phone app: the link printed in the terminal, also under **📱 Phone app** on the farm home
  (`http://<mac-ip>:8765/app/?k=<key>`).

`build_data.py --refresh-forecast` fetches a new Open-Meteo forecast. Without it, the saved snapshot is reused
so the demo stays the same. "Reset demo" in the top bar clears logged activities and notes on every device.
Without `--lan`, only this Mac can connect.

## Install the phone app on an iPhone

The app is an installable web app (no App Store, no Xcode, no Apple ID needed):

1. Mac and iPhone on the **same Wi-Fi**; start `python3 scripts/server.py --lan` on the Mac.
2. On the farm home, click **📱 Phone app** and send the link to the iPhone (AirDrop, Messages or Notes).
3. Open the link in **Safari**, tap **Share → Add to Home Screen → Add**.
4. Open **DemetrAg** from the home screen: it runs full screen like an app.
5. Record something (Record tab, or a note/photo in Notes): the farm home on the Mac updates within a second.

Voice on the iPhone: tap the text box, then the microphone key on the keyboard (iOS dictation; no length limit).
The in-app microphone button and "long recording" need a secure page (https), so over plain Wi-Fi they are
replaced by the dictation hint. On the Mac (localhost) Chrome's microphone button works.

## Real-time link between the phone and the farm home

`scripts/server.py` (Python standard library only) serves both pages and a small API:

| Endpoint | What it does |
|---|---|
| `GET /api/state` | Shared state: logged records, stock changes, notes |
| `POST /api/records` | Add records (from the Record dialog) and stock changes |
| `POST /api/notes` | Add a note for a field or the farm, with an optional photo (resized to ~1280 px on the phone) |
| `POST /api/reset` | Clear the demo |
| `GET /api/events` | Server-Sent Events: every change pushes a new version, open pages refresh at once |

State is saved in `server-data/state.json`, photos in `server-data/photos/` (both git-ignored). Devices other
than the Mac need the access key that is part of the phone link (stored as a cookie after the first visit).

**Why not Vercel (yet).** Vercel could host the pages and the API with HTTPS, so the phone would work over
mobile data and the in-app microphone would work too. But it needs an account and a hosted database
(serverless functions do not keep state or WebSocket connections; live updates would use polling or a
realtime service), and the farm data derived from the hackathon dataset would sit on a public server, which
the Terms forbid. For the demo the Mac server keeps the data on your own network. The cloud version is a
roadmap step: same API, Vercel functions plus a managed store, farm data behind sign-in.

## Demo path

**New in v3** (branch `dev_v3`):

1. Top bar: switch between the two farms (the ring shows how complete each profile is).
2. **Economics** (sidebar; Farm → Money on the phone): 2026 accounts against the 10-season average, where the
   money goes, CAP payments by scheme, sales against the market price, the euro value of each piece of advice,
   the 2027 scenario ("business as usual" vs "follow the advice", price and yield sliders) and the return on
   DemetrAg (€3/ha up to 100 ha, €4/ha up to 250 ha, €5/ha up to 500 ha).
3. **Onboarding** (top right; sparkle button on the phone): upload any files and watch the simulated agent sort
   them, or answer the questions (fields and crops required, the rest optional). "Use demo answers" fills in
   FARM-00268; finishing opens it.
4. **FARM-00268**: map, sowing window for its winter crops, notes, logging (no stock tracked), and an economics
   estimate from similar Loiret farms with "add data" prompts.
5. **Notes** (sidebar, with the latest three pinned below the menu; Notes tab on the phone): a gallery of notes
   and photos, filterable by field and topic.

**v2 path:**

1. Farm home: assistant shows the maize harvest window and the autumn workload; NPK stock is low.
2. Click a wheat field (P-5182): soil, 10 seasons of yield and nitrogen, timeline.
3. Log activity → "Applied 100 kg of complex fertiliser before wheat sowing for all fields".
   The assistant asks "all 14 fields or the 3 wheat fields?", then "per hectare or in total?", then shows
   the exact record to check: fields, date, rate and total (100 kg/ha × 21.63 ha = 2,163 kg).
4. After saving: wheat moves up to "sow 21.6 ha", NPK stock turns critical (837 kg left), both marked "Updated".
5. Log "Sprayed Nuvexa, 1 litre per hectare on the wheat": it asks which Nuvexa, then updates the herbicide stock.
6. On the iPhone app, add a note to P-5182 ("Found slugs along the headland", tag Pests, photo): the farm home
   shows "New note from phone" and a new advice card, "P-5182: pests reported", within a second.

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
| Accounts, CAP payments, sales | `synthetic_farm_economics`, `_subsidy`, `_transaction_sale`, `_farm_indicator` | Dataset (synthetic) |
| Crop prices | `synthetic_market_price` (latest month up to 17 Oct 2026) | Dataset (synthetic) |
| Unit costs (seed €/kg, nutrients €/kg, crop protection €/L) | Accounts 2022-2026 ÷ quantities in the farm's own records | Derived from the dataset |
| Similar farms (FARM-00268 estimate) | Median yields and €/ha of 273 synthetic arable farms in FRB06 | Dataset (synthetic) |
| Euro loss rates (late sowing, standing maize, untreated pests), DemetrAg price | `web/data/assumptions.json` → `economics` | Rules of thumb, set by the team |
| FARM-00268 profile | Fields and 2026 crops only, as if answered in onboarding | Dataset (synthetic), rest ignored |
| Onboarding agent | Scripted result from the file types | Simulated (files stay in the browser) |

63 operations dated after the same season's harvest are left out as implausible; growth stages (BBCH) are not
shown because they often contradict the dates.

## Logging rules (text or voice)

- Only completed work is recorded: negated notes ("do not spray", "didn't spray", "spraying was cancelled")
  and plans ("will", "tomorrow", "need to") are rejected with an explanation.
- "Per hectare" and "in total" must be explicit; when the note says neither (or both), the assistant asks.
- Units must match the product: litres for liquid crop protection, kilograms or tonnes for fertiliser and seed,
  tonnes for harvests. A wrong unit is rejected and the amount is asked again.
- Every field number or crop that cannot be matched to this farm is flagged; fields of a different crop than
  the one named are flagged too (keep or remove).
- Before saving, the dialog shows the exact fields, date, rate per hectare and total. Saving is blocked until
  nothing is missing.
- Voice: short mode stops when you pause and sends the note; "Long recording" keeps listening through pauses
  until you press stop (up to 3 minutes), then lets you edit the text before sending.

## Notes and photos: what the assistant learns

Notes (text or dictated) and photos can be added per field or for the whole farm, on the phone (Notes tab, or
"Add a note or photo" on a field) or on the farm home (field panel). The assistant reads each note for topics,
from the tags picked and from words in the text: pests, disease, weeds, waterlogging, dry soil, emergence,
machinery. Each topic becomes advice for that field, combined with the forecast and the open jobs
(`web/js/notes.js`), shown on Today, the field panel, Advice (filterable), the Notes gallery and the activity
timeline. Repeated reports on the same field raise the priority. Photos are stored and shown with the note;
they are not analysed by AI (image recognition is on the roadmap).

## Screens

- Farm home fills the screen: the map can be zoomed (+ / − / fit buttons, mouse wheel) and dragged.
  Clicking a field opens a panel that covers the "Today" column.
- Sidebar: Home, Weather, Activities (log and timeline), NDVI, Advice, Stock, Economics, Notes, and the latest notes.
- Advice can be filtered by kind (timing, warnings, alerts), crop, type of work, season, stock product and field.
- Sources are small icons on each card (hover or tap for details); the full list is under "⋯ → Data sources".
- Phone app tabs: Today (next job and its euro value), Fields, Record, Notes (gallery), Farm (Money, Stock, Profile).

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
on the Mac (audio is processed by Google's speech service), iOS keyboard dictation on the iPhone (Apple's
speech service), Open-Meteo forecast API. App icons drawn by `scripts/make_icons.py`. Code written with an AI coding
assistant (Claude Code) during the hackathon.

Do not publish `web/data/farms/`, `weather.json` or `forecast_snapshot.json`: they are derived from the
hackathon dataset (see `.gitignore`).
