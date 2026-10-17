// Farm economics: accounts, margins per crop, the euro value of each recommendation and
// the season scenario. Crop prices, yields and unit costs come from the dataset; how much a
// delay or an untreated problem costs comes from assumptions.json (rules of thumb).
import { sum, mean, cropName, fmt, fmtEur } from './util.js';
import { parcelsOfCrop, areaOf, cropsOnFarm } from './model.js';
import { timingRecs, stockStatus, stockRecs, nitrogenRecs, nitrogenSummary } from './rules.js';
import { noteInsights } from './notes.js';

export const hasAccounts = (s) => Boolean(s.farm.economics);
const E = (s) => s.assumptions.economics;
const cropArea = (s, crop) => areaOf(s, parcelsOfCrop(s, crop).map((p) => p.id));

// ---------- accounts ----------

export function pnl(s) {
  const years = s.farm.economics.years;
  const avg = (f) => mean(years.map(f));
  return {
    years,
    last: years[years.length - 1],
    avg: {
      output: avg((y) => y.output), inputs: avg((y) => y.total_inputs),
      subsidies: avg((y) => y.subsidies_total), fnva: avg((y) => y.fnva),
    },
  };
}

export const INPUT_LABELS = {
  seeds: 'Seeds', fertiliser: 'Fertiliser', crop_protection: 'Crop protection', energy: 'Energy',
  feed: 'Feed', contract_work: 'Contract work', wages: 'Wages', depreciation: 'Depreciation',
};

export const SCHEME_LABELS = {
  BISS: 'Basic income support', CRISS: 'Redistributive support', ECO_SCHEME: 'Eco-schemes',
  ANC: 'Areas with natural constraints', COUPLED: 'Coupled support', RURAL_DEV: 'Rural development',
};

// ---------- prices, yields and costs ----------

// Latest monthly price in the dataset up to today, and the price a year before.
export function cropPrice(s, crop) {
  const list = s.farm.market_prices?.[crop];
  if (!list?.length) return null;
  const [month, eur] = list[list.length - 1];
  return { month, eur_t: eur, yearAgo: list.length > 12 ? list[list.length - 13][1] : null };
}

// The farm's own 10-season average, or the regional benchmark when the farm has no records.
export function expectedYield(s, crop) {
  const own = mean(Object.values(s.farm.history[crop]?.yield_by_year || {}));
  if (own != null) return { t_ha: own, source: 'records' };
  return { t_ha: s.farm.regional_benchmark.yield_t_ha[crop] ?? null, source: 'benchmark' };
}

// Cost per hectare: the crop's own seed, nutrient and spray use x unit costs implied by the
// accounts, plus the farm's other costs per hectare. Benchmark farms when there are no records.
export function costPerHa(s, crop) {
  const u = s.farm.economics?.unit_costs;
  const use = s.farm.history[crop]?.inputs_per_ha;
  if (!u || !use) {
    const b = s.farm.regional_benchmark.eur_per_ha;
    return {
      seed: b.seeds, fertiliser: b.fertiliser, protection: b.crop_protection,
      other: b.energy + b.contract_work + b.wages + b.depreciation, source: 'benchmark',
    };
  }
  return {
    seed: use.seed * u.seed_eur_kg, fertiliser: use.nutrients * u.nutrient_eur_kg,
    protection: use.spray * u.protection_eur_l, other: u.other_eur_ha, source: 'records',
  };
}

export const capPerHa = (s) => (hasAccounts(s)
  ? pnl(s).last.subsidies_total / s.farm.meta.area_ha
  : s.farm.regional_benchmark.eur_per_ha.subsidies);

export function cropMargins(s, { priceAdj = 0, yieldAdj = 0 } = {}) {
  return cropsOnFarm(s).map((crop) => {
    const area = cropArea(s, crop);
    const price = (cropPrice(s, crop)?.eur_t ?? 0) * (1 + priceAdj);
    const y = (expectedYield(s, crop).t_ha ?? 0) * (1 + yieldAdj);
    const costs = costPerHa(s, crop);
    const costHa = costs.seed + costs.fertiliser + costs.protection + costs.other;
    const revenueHa = y * price;
    return {
      crop, area, price, yield: y, costs, costHa, revenueHa, marginHa: revenueHa - costHa,
      revenue: revenueHa * area, cost: costHa * area, margin: (revenueHa - costHa) * area,
    };
  });
}

// Value of one hectare of a crop's harvest at today's price.
const haValue = (s, crop, adj) => (expectedYield(s, crop).t_ha ?? 0) * (1 + adj.yieldAdj)
  * (cropPrice(s, crop)?.eur_t ?? 0) * (1 + adj.priceAdj);

// Cost of one kilogram or litre of a product, from the implied unit costs.
function unitPrice(s, prod) {
  const u = s.farm.economics?.unit_costs;
  if (!u) return null;
  if (prod.type === 'SEED') return u.seed_eur_kg;
  if (prod.type === 'FERTILISER') {
    const c = prod.composition || { n: 0, p2o5: 0, k2o: 0 };
    return ((c.n + c.p2o5 + c.k2o) / 100) * u.nutrient_eur_kg;
  }
  return u.protection_eur_l;
}

// ---------- the euro value of a recommendation ----------
// Returns { cost, atStake, net, roi, how } or null when the advice has no clear euro value.
// cost: extra money spent to follow the advice. atStake: money lost if it is not followed.

export function actionValue(s, rec, adj = { priceAdj: 0, yieldAdj: 0 }) {
  const e = E(s);
  const crops = rec.crop ? [rec.crop] : (rec.crops || []);
  const area = (crop) => areaOf(s, (rec.parcels || []).filter((id) => s.farm.parcels.find((p) => p.id === id)?.crop === crop));
  const result = (cost, atStake, how) => ({
    cost, atStake, net: atStake - cost, roi: cost > 0 ? atStake / cost : null, how,
  });

  if (rec.kind === 'timing' && rec.op === 'harvest') {
    const crop = rec.crop;
    const a = area(crop);
    const tonnes = a * (expectedYield(s, crop).t_ha ?? 0) * (1 + adj.yieldAdj);
    const weeks = e.missed_window_delay_days / 7;
    const loss = a * haValue(s, crop, adj) * (e.standing_maize_loss_pct_per_week / 100) * weeks;
    const drying = tonnes * e.maize_extra_drying_eur_t;
    return result(0, loss + drying, [
      `If the window is missed, harvest slips about ${e.missed_window_delay_days} days.`,
      `${fmt(a)} ha × ${fmt(tonnes / a, 1)} t/ha: ${fmt(e.standing_maize_loss_pct_per_week, 1)}% field loss per week (${fmtEur(loss)}) and ${fmtEur(e.maize_extra_drying_eur_t)}/t extra drying (${fmtEur(drying)}).`,
    ]);
  }
  if (rec.kind === 'timing') {
    const pct = e.late_sowing_loss_pct_per_day * e.missed_window_delay_days;
    const loss = sum(crops.map((c) => area(c) * haValue(s, c, adj))) * (pct / 100);
    const ha = sum(crops.map(area));
    return result(0, loss, [
      `If the window is missed, sowing slips about ${e.missed_window_delay_days} days: ${fmt(e.late_sowing_loss_pct_per_day, 1)}% yield per day late, ${fmt(pct, 1)}% on ${fmt(ha)} ha.`,
    ]);
  }
  if (rec.kind === 'stock') {
    const x = stockStatus(s).find((st) => st.prod.id === rec.products[0]);
    const price = x ? unitPrice(s, x.prod) : null;
    if (!x || price == null) return null;
    const cost = x.shortfall * price;
    const blocked = x.runsOutAt ? x.needs.slice(x.needs.indexOf(x.runsOutAt)) : [];
    const pct = e.late_sowing_loss_pct_per_day * e.stock_delivery_days;
    const loss = sum(blocked.map((n) => n.job.remainingArea * haValue(s, n.job.crop, adj))) * (pct / 100);
    return result(cost, loss, [
      `Order ${fmt(x.shortfall, 0)} ${x.prod.unit} at ${fmtEur(price * (x.prod.unit === 'kg' ? 1000 : 1))}/${x.prod.unit === 'kg' ? 't' : x.prod.unit} (your implied cost) = ${fmtEur(cost)}.`,
      `Ordering late stops ${fmt(sum(blocked.map((n) => n.job.remainingArea)))} ha for ${e.stock_delivery_days} days of delivery: ${fmt(pct, 1)}% yield.`,
    ]);
  }
  if (rec.kind === 'nitrogen' && rec.dir === 'above') {
    const n = nitrogenSummary(s, rec.crop);
    const u = s.farm.economics?.unit_costs;
    if (!n || !u) return null;
    const a = cropArea(s, rec.crop);
    const kg = (n.avg - n.ref) * a;
    return result(0, kg * u.nutrient_eur_kg, [
      `${fmt(n.avg - n.ref, 0)} kg N/ha above the regional reference on ${fmt(a)} ha = ${fmt(kg, 0)} kg a season, at ${fmtEur(u.nutrient_eur_kg * 1000)}/t of nutrients.`,
      'A saving only if yields hold: check with your adviser.',
    ]);
  }
  if (rec.kind === 'note' && ['pests', 'disease', 'weeds'].includes(rec.topic)) {
    const crop = rec.crop;
    if (!crop) return null;
    const a = rec.parcels.length === 1 ? areaOf(s, rec.parcels) : cropArea(s, crop);
    const u = s.farm.economics?.unit_costs;
    const productHa = u ? u.protection_eur_l : s.farm.regional_benchmark.eur_per_ha.crop_protection;
    const costHa = productHa + e.pass_cost_eur_ha.spraying;
    const loss = a * haValue(s, crop, adj) * (e.problem_loss_pct / 100);
    return result(costHa * a, loss, [
      `One treatment on ${fmt(a)} ha: ${fmtEur(productHa)}/ha product + ${fmtEur(e.pass_cost_eur_ha.spraying)}/ha pass.`,
      `Untreated, about ${fmt(e.problem_loss_pct, 0)}% of the ${cropName(crop).toLowerCase()} harvest is at risk.`,
    ]);
  }
  return null;
}

// Every recommendation with a euro value, largest first.
export function valuedActions(s, adj) {
  const recs = [...timingRecs(s), ...stockRecs(s), ...nitrogenRecs(s), ...noteInsights(s)];
  return recs.map((rec) => ({ rec, value: actionValue(s, rec, adj) }))
    .filter((x) => x.value && (x.value.atStake > 0 || x.value.cost > 0))
    .sort((a, b) => b.value.net - a.value.net);
}

// ---------- season scenario ----------
// Business as usual: the advice is not followed. Jobs slip to the next window, problems stay
// untreated, nitrogen stays at the 10-season average. Follow the advice: those losses are avoided,
// treatments are paid for, nitrogen comes down to the reference.

export function scenario(s, adj = { priceAdj: 0, yieldAdj: 0 }) {
  const margins = cropMargins(s, adj);
  const area = s.farm.meta.area_ha;
  const cap = capPerHa(s) * area;
  const base = sum(margins.map((m) => m.margin)) + cap;
  const actions = valuedActions(s, adj);
  const losses = sum(actions.filter((a) => a.rec.kind !== 'nitrogen').map((a) => a.value.atStake));
  const costs = sum(actions.map((a) => a.value.cost)) - sum(actions.filter((a) => a.rec.kind === 'stock').map((a) => a.value.cost));
  const savings = sum(actions.filter((a) => a.rec.kind === 'nitrogen').map((a) => a.value.atStake));
  const bau = base - losses;
  const advice = base - costs + savings;
  const sub = subscription(s, area);
  return {
    margins, cap, base, actions, losses, costs, savings, bau, advice, gain: advice - bau, sub,
    roi: sub.total ? (advice - bau) / sub.total : null,
  };
}

// ---------- DemetrAg price ----------

export function subscription(s, areaHa) {
  const p = E(s).pricing;
  const tier = p.tiers.find((t) => areaHa <= t.max_ha);
  if (!tier) return { total: null, quote: true, text: `Over ${p.tiers[p.tiers.length - 1].max_ha} ha: ${p.above}` };
  return { total: areaHa * tier.eur_ha, rate: tier.eur_ha, text: `${fmt(areaHa)} ha × €${tier.eur_ha}/ha (farms up to ${tier.max_ha} ha)` };
}

// ---------- farms with fields and crops only ----------

export function farmEstimate(s) {
  const margins = cropMargins(s);
  const cap = capPerHa(s) * s.farm.meta.area_ha;
  return {
    margins, cap,
    revenue: sum(margins.map((m) => m.revenue)), cost: sum(margins.map((m) => m.cost)),
    margin: sum(margins.map((m) => m.margin)) + cap,
  };
}
