// The farms this demo can show, and loading one of them into the app state.
// Each farm has its own data file (web/data/farms/<id>.json); stock and assumptions
// hold a section per farm, merged here so the rest of the code reads s.stock and
// s.assumptions as before.
const KEY = 'demetrag-farm';
export const DEFAULT_FARM = 'FARM-00455';

async function loadJson(base, name) {
  const res = await fetch(`${base}data/${name}.json`, { cache: 'no-store' });
  if (res.status === 403) throw new Error('Open the app with the link from the farm home (it contains the access key).');
  if (!res.ok) throw new Error(`data/${name}.json: ${res.status}. Run scripts/build_data.py first.`);
  return res.json();
}

export const listFarms = (base = '') => loadJson(base, 'farms/index');

export function savedFarm(index) {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  return index.farms.some((f) => f.id === id) ? id : index.default;
}

export function rememberFarm(id) {
  try { localStorage.setItem(KEY, id); } catch { /* storage unavailable: this session only */ }
}

export async function loadFarm(id, base = '') {
  const [farm, weather, stock, assumptions] = await Promise.all(
    [`farms/${id}`, 'weather', 'stock', 'assumptions'].map((name) => loadJson(base, name)),
  );
  const { farms: perFarm, ...global } = assumptions;
  return {
    farm,
    weather,
    stock: stock.farms[id] || { tracked: false, products: [] },
    assumptions: { ...global, ...perFarm[id] },
    captured: [], stockAdjust: {}, notes: [],
  };
}

// The shared records and notes of one farm. Entries saved before farms existed belong to FARM-00455.
export function sharedFor(next, id) {
  const mine = (x) => (x.farm || DEFAULT_FARM) === id;
  return {
    captured: (next.captured || []).filter(mine),
    notes: (next.notes || []).filter(mine),
    stockAdjust: next.stockAdjust || {},
  };
}

export const isBasic = (s) => s.farm.meta.level === 'basic';

// Share of the profile filled in (fields, crops, records, soil, CAP, accounts, stock).
export function completeness(s) {
  const items = s.farm.meta.onboarding?.items || [];
  return items.length ? items.filter((i) => i.done).length / items.length : 1;
}
