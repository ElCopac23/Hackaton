// Derived views of the farm data: field status, autumn jobs, stock and activity lists.
import { CROPS, sum, fmtDate, fmtMonthDay } from './util.js';

export const today = (s) => s.farm.meta.today;
export const year = (s) => Number(today(s).slice(0, 4));
export const autumnStart = (s) => `${year(s)}-08-01`;
export const allEvents = (s) => [...s.farm.events, ...s.captured];
export const parcel = (s, id) => s.farm.parcels.find((p) => p.id === id);
export const parcelsOfCrop = (s, crop) => s.farm.parcels.filter((p) => p.crop === crop);
export const areaOf = (s, ids) => sum(ids.map((id) => parcel(s, id).area_ha));
export const product = (s, id) => s.stock.products.find((p) => p.id === id);
export const stockLevel = (s, id) => product(s, id).stock + (s.stockAdjust[id] || 0);

export function cropsOnFarm(s) {
  const crops = [...new Set(s.farm.parcels.map((p) => p.crop))];
  return crops.sort((a, b) => areaOf(s, parcelsOfCrop(s, b).map((p) => p.id)) - areaOf(s, parcelsOfCrop(s, a).map((p) => p.id)));
}

// Season a newly logged operation belongs to: harvests close the current season,
// autumn work prepares the next one.
export function campaignFor(s, type, date) {
  if (type === 'harvest') return year(s);
  return date >= autumnStart(s) ? s.assumptions.autumn_plan.season : year(s);
}

export function parcelStatus(s, p) {
  const evs = allEvents(s).filter((e) => e.parcel === p.id);
  const next = s.assumptions.autumn_plan.season;
  const harvest = evs.filter((e) => e.type === 'harvest' && e.campaign === year(s));
  const capturedHarvest = harvest.find((e) => e.source === 'captured');
  const plannedHarvest = harvest.find((e) => e.status === 'planned');
  const doneHarvest = capturedHarvest || harvest.find((e) => e.status === 'done');
  if (plannedHarvest && !capturedHarvest) {
    return { code: 'standing', label: 'Standing crop', detail: `Harvest planned ${fmtDate(plannedHarvest.date)} in your records` };
  }
  const autumn = evs.filter((e) => e.campaign === next);
  const sown = autumn.find((e) => e.type === 'sowing');
  if (sown) return { code: 'sown', label: `Sown ${fmtDate(sown.date)}`, detail: `${CROPS[p.crop].name} for ${next}` };
  const fert = autumn.find((e) => e.type === 'fertilisation');
  if (fert) return { code: 'prepared', label: 'Fertilised, to sow', detail: `Base fertiliser ${fmtDate(fert.date)}` };
  const harvested = doneHarvest ? `Harvested ${fmtDate(doneHarvest.date)}` : 'Harvested';
  if (CROPS[p.crop].season === 'winter') return { code: 'to-sow', label: 'To sow', detail: harvested };
  const h = s.farm.history[p.crop]?.sowing;
  return {
    code: 'fallow', label: harvested,
    detail: h ? `Spring crop, usually sown ${fmtMonthDay(h.earliest)}–${fmtMonthDay(h.latest)}` : 'Spring crop',
  };
}

function finishJob(s, job) {
  const remaining = job.parcels.filter((id) => !job.done.includes(id));
  return {
    ...job,
    remaining,
    readyRemaining: remaining.filter((id) => job.ready.includes(id)),
    area: areaOf(s, job.parcels),
    doneArea: areaOf(s, job.done),
    remainingArea: areaOf(s, remaining),
  };
}

// Autumn work: harvest of standing crops (planned in the records) and the
// fertilise -> sow -> herbicide sequence for winter crops (plan in assumptions.json).
export function autumnJobs(s) {
  const evs = allEvents(s);
  const plan = s.assumptions.autumn_plan;
  const jobs = [];

  const planned = s.farm.events.filter((e) => e.type === 'harvest' && e.status === 'planned');
  for (const crop of [...new Set(planned.map((e) => e.crop))]) {
    const ids = planned.filter((e) => e.crop === crop).map((e) => e.parcel);
    const done = ids.filter((id) => s.captured.some((e) => e.parcel === id && e.type === 'harvest'));
    jobs.push(finishJob(s, {
      key: `harvest-${crop}`, type: 'harvest', op: 'harvest', crop, label: 'Harvest', stepIndex: 0,
      parcels: ids, done, ready: ids,
      plannedDate: planned.filter((e) => e.crop === crop).map((e) => e.date).sort()[0],
    }));
  }

  for (const crop of plan.crops) {
    const ids = parcelsOfCrop(s, crop).map((p) => p.id);
    let previousDone = ids;
    plan.steps.forEach((step, i) => {
      const done = ids.filter((id) => evs.some((e) => e.parcel === id && e.type === step.type && e.campaign === plan.season));
      const productId = step.product || step.product_by_crop?.[crop];
      const median = s.farm.history[crop].seed_rate_median;
      const rate = step.rate === 'history_median' ? (median >= 20 ? Math.round(median) : Math.round(median * 10) / 10) : step.rate;
      jobs.push(finishJob(s, {
        key: `${step.key}-${crop}`, type: step.type, op: step.op, crop, label: step.label, stepKey: step.key,
        stepIndex: i, parcels: ids, done, ready: i === 0 ? ids : previousDone, productId, rate, unit: step.unit,
      }));
      previousDone = done;
    });
  }
  return jobs;
}

export function workLeft(s) {
  const totals = { harvest: 0, fertilisation: 0, sowing: 0, spraying: 0 };
  const all = { harvest: 0, fertilisation: 0, sowing: 0, spraying: 0 };
  for (const j of autumnJobs(s)) {
    totals[j.type] += j.remainingArea;
    all[j.type] += j.area;
  }
  return { left: totals, total: all };
}

export function seasonSummary(s, campaign) {
  const evs = allEvents(s).filter((e) => e.campaign === campaign && e.status === 'done');
  const area = (list) => sum([...new Set(list.map((e) => e.parcel))].map((id) => parcel(s, id).area_ha));
  const of = (type) => evs.filter((e) => e.type === type);
  return {
    sowing: { count: of('sowing').length, area: area(of('sowing')) },
    fertilisation: {
      count: of('fertilisation').length, area: area(of('fertilisation')),
      nKg: sum(of('fertilisation').map((e) => (e.n || 0) * parcel(s, e.parcel).area_ha)),
    },
    spraying: { count: of('spraying').length, area: area(of('spraying')) },
    harvest: {
      count: of('harvest').length, area: area(of('harvest')),
      tonnes: sum(of('harvest').map((e) => (e.yield_t_ha || 0) * parcel(s, e.parcel).area_ha)),
    },
  };
}

// Quantity of a product used by one event (rate x field area).
export const eventQty = (s, e) => (e.total != null ? e.total : (e.rate || 0) * parcel(s, e.parcel).area_ha);

export function productUsage(s, prod) {
  const evs = allEvents(s);
  let matches;
  if (prod.type === 'SEED') matches = evs.filter((e) => e.type === 'sowing' && (e.productId === prod.id || (!e.productId && e.crop === prod.crop)));
  else if (prod.type === 'FERTILISER') matches = evs.filter((e) => e.productId === prod.id);
  else matches = evs.filter((e) => e.type === 'spraying' && (e.productId === prod.id || e.product === prod.name));
  matches = matches.filter((e) => e.status === 'done').sort((a, b) => b.date.localeCompare(a.date));
  const season = matches.filter((e) => e.campaign === year(s) && e.source === 'records');
  const captured = matches.filter((e) => e.source === 'captured');
  return {
    usedSeason: season.length ? sum(season.map((e) => eventQty(s, e))) : null,
    usedCaptured: sum(captured.map((e) => eventQty(s, e))),
    last: matches[0] || null,
    recordsHaveNoProduct: prod.type === 'FERTILISER',
  };
}

export function lastProductsUsed(s, limit = 4) {
  const seen = new Set();
  const out = [];
  const evs = allEvents(s).filter((e) => e.status === 'done' && (e.product || e.productId))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.source === 'captured') - (a.source === 'captured'));
  for (const e of evs) {
    const name = e.productId ? product(s, e.productId).name : e.product;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, date: e.date, parcel: e.parcel, source: e.source });
    if (out.length === limit) break;
  }
  return out;
}

export function lastActivities(s, limit = 18) {
  const t = today(s);
  const evs = allEvents(s).filter((e) => e.status === 'done' && e.date <= t).map((e) => ({ ...e, kind: 'event' }));
  const notes = s.assumptions.simulated_notes.map((n, i) => ({ ...n, noteKind: n.kind, id: `note-${i}`, kind: 'note', source: 'simulated' }));
  return [...evs, ...notes]
    .sort((a, b) => b.date.localeCompare(a.date) || (b.source === 'captured') - (a.source === 'captured'))
    .slice(0, limit);
}

// Simulated vegetation index: the dataset has no satellite signal (parcel_signal is empty).
// Values follow the field status so the design screen tells a plausible story.
export function ndviFor(s, p) {
  const base = { standing: 0.46, 'to-sow': 0.19, prepared: 0.17, sown: 0.15, fallow: 0.24 }[parcelStatus(s, p).code] ?? 0.2;
  const noise = ((Number(p.short) * 37) % 9 - 4) * 0.012;
  const value = Math.round((base + noise) * 100) / 100;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const red = clamp((0.45 - value) / 0.3);
  const green = clamp((value - 0.35) / 0.4) * 0.6;
  return { value, red, green, yellow: Math.max(0, 1 - red - green) };
}

export function farmNdvi(s) {
  const total = sum(s.farm.parcels.map((p) => p.area_ha));
  return sum(s.farm.parcels.map((p) => ndviFor(s, p).value * p.area_ha)) / total;
}
