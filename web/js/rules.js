// The assistant's rules. Every number comes from the data; thresholds come from assumptions.json.
import {
  cropName, fmt, fmtDate, fmtDateRuns, fmtMonthDay, fmtQty, daysBetween, mean, sum, shortId, OP_LABELS,
} from './util.js';
import {
  today, autumnJobs, parcelsOfCrop, parcel, product, stockLevel, allEvents, cropsOnFarm, year,
} from './model.js';

export const forecastDays = (s) => s.weather.forecast.days.filter((d) => d.date >= today(s));

export function evaluateDay(s, op, idx) {
  const days = forecastDays(s);
  const d = days[idx];
  const t = s.assumptions.thresholds[op];
  const reasons = [];
  if (t.max_rain_mm != null && d.precip_mm > t.max_rain_mm) reasons.push(`${fmt(d.precip_mm)} mm rain`);
  if (t.max_rain_prob != null && d.precip_prob > t.max_rain_prob) reasons.push(`${d.precip_prob}% chance of rain`);
  if (t.max_wind_kmh != null && d.wind_max_kmh > t.max_wind_kmh) reasons.push(`wind up to ${Math.round(d.wind_max_kmh)} km/h`);
  if (t.max_rain_prev2_mm != null) {
    const prev = sum(days.slice(Math.max(0, idx - 2), idx).map((x) => x.precip_mm));
    if (prev > t.max_rain_prev2_mm) reasons.push(`${fmt(prev)} mm in the 2 days before (wet soil)`);
  }
  return { date: d.date, ok: reasons.length === 0, reasons };
}

// Good days for an operation, and when the window closes: the first run of
// two unsuitable days in a row.
export function opWindow(s, op) {
  const days = forecastDays(s);
  const evals = days.map((_, i) => evaluateDay(s, op, i));
  let closeIdx = null;
  for (let i = 0; i < evals.length - 1; i += 1) {
    if (!evals[i].ok && !evals[i + 1].ok) { closeIdx = i; break; }
  }
  const usable = closeIdx === null ? evals : evals.slice(0, closeIdx);
  let blocker = null;
  if (closeIdx !== null) {
    let end = closeIdx;
    while (end + 1 < evals.length && !evals[end + 1].ok) end += 1;
    const run = days.slice(closeIdx, end + 1);
    blocker = {
      from: run[0].date, to: run[run.length - 1].date,
      rainMm: run.map((d) => d.precip_mm),
      windMax: Math.max(...run.map((d) => d.wind_max_kmh)),
      reasons: [...new Set(evals.slice(closeIdx, end + 1).flatMap((e) => e.reasons))],
    };
  }
  return {
    evals,
    good: usable.filter((e) => e.ok).map((e) => e.date),
    closesAfter: closeIdx === null ? null : (closeIdx > 0 ? days[closeIdx - 1].date : today(s)),
    blocker,
    horizonEnd: days[days.length - 1].date,
  };
}

function blockerText(w, op) {
  const b = w.blocker;
  const span = b.from === b.to ? fmtDate(b.from) : `${fmtDate(b.from)}–${fmtDate(b.to)}`;
  const rain = b.rainMm.filter((x) => x >= 1);
  const parts = [];
  if (rain.length) parts.push(`rain ${rain.map((x) => `${fmt(x)} mm`).join(', ')}`);
  if (op === 'spraying' || op === 'spreading' || !rain.length) parts.push(`wind up to ${Math.round(b.windMax)} km/h`);
  return `${span}: ${parts.join(', ')}`;
}

export function sowingPosition(s, crop) {
  const h = s.farm.history[crop]?.sowing;
  if (!h) return null;
  const toIso = (md) => `${year(s)}-${md}`;
  return { ...h, daysToMedian: daysBetween(today(s), toIso(h.median)), daysToLatest: daysBetween(today(s), toIso(h.latest)) };
}

export function timingRecs(s) {
  const t = today(s);
  const jobs = autumnJobs(s);
  const recs = [];

  for (const job of jobs.filter((j) => j.type === 'harvest' && j.remaining.length)) {
    const w = opWindow(s, 'harvest');
    const daysLeft = w.closesAfter ? daysBetween(t, w.closesAfter) : 10;
    const lines = [];
    if (w.blocker) lines.push(`Window closes after ${fmtDate(w.closesAfter)}. ${blockerText(w, 'harvest')}.`);
    if (w.blocker && job.plannedDate >= w.blocker.from) {
      lines.push(`Your records plan this harvest for ${fmtDate(job.plannedDate)}, inside the wet spell: bring it forward.`);
    } else {
      lines.push(`Planned in your records for ${fmtDate(job.plannedDate)}.`);
    }
    recs.push({
      id: `timing-${job.key}`, kind: 'timing', op: 'harvest', crop: job.crop, parcels: job.remaining,
      priority: 100 - daysLeft,
      title: `Harvest ${cropName(job.crop).toLowerCase()} on ${job.remaining.map(shortId).join(' and ')} (${fmt(job.remainingArea)} ha)${w.closesAfter ? ` by ${fmtDate(w.closesAfter)}` : ''}`,
      lines, goodDays: w.good, sources: ['forecast', 'records', 'rule'],
    });
  }

  for (const crop of s.assumptions.autumn_plan.crops) {
    const cropJobs = jobs.filter((j) => j.crop === crop && j.stepKey);
    const next = cropJobs.find((j) => j.remaining.length);
    if (!next) continue;
    const started = cropJobs.some((j) => j.done.length);
    const pos = sowingPosition(s, crop);
    const w = opWindow(s, next.op);
    const sowW = opWindow(s, 'sowing');
    const daysLeft = w.closesAfter ? daysBetween(t, w.closesAfter) : 10;
    const fields = `${next.remaining.length} field${next.remaining.length > 1 ? 's' : ''}`;
    const lines = [];
    let title;
    if (next.stepKey === 'fertilise') {
      title = `${cropName(crop)}: spread base fertiliser, then sow (${fmt(next.remainingArea)} ha, ${fields})`;
      lines.push(`Spreading days: ${fmtDateRuns(w.good)}. Sowing days: ${fmtDateRuns(sowW.good)}.`);
    } else if (next.stepKey === 'sow') {
      const prev = cropJobs[next.stepIndex - 1];
      title = `${cropName(crop)}: sow ${fmt(next.remainingArea)} ha (${fields})`;
      lines.push(`Base fertiliser done on ${prev.done.length} of ${prev.parcels.length} fields ✓. Sowing days: ${fmtDateRuns(w.good)}.`);
    } else {
      title = `${cropName(crop)}: post-sowing herbicide on ${fmt(next.remainingArea)} ha`;
      lines.push(`Calm, dry days for spraying: ${fmtDateRuns(w.good)}.`);
    }
    if (w.blocker) lines.push(`Window closes after ${fmtDate(w.closesAfter)}. ${blockerText(w, next.op)}.`);
    if (pos) {
      const when = pos.daysToMedian > 0 ? `${pos.daysToMedian} days before your median` : pos.daysToMedian === 0 ? 'your median day' : `${-pos.daysToMedian} days after your median`;
      lines.push(`Your ${cropName(crop).toLowerCase()} sowings since 2017: ${fmtMonthDay(pos.earliest)}–${fmtMonthDay(pos.latest)}, median ${fmtMonthDay(pos.median)}. Today is ${when}.`);
    }
    const priority = 50 + (started ? 20 : 0) + (pos && pos.daysToMedian <= 0 ? 10 : 0)
      - daysLeft - (pos ? Math.max(0, pos.daysToMedian) / 10 : 0);
    recs.push({
      id: `timing-${crop}`, kind: 'timing', op: next.op, crop, parcels: next.remaining, step: next.stepKey,
      priority, title, lines, goodDays: w.good, sources: ['forecast', 'records', 'rule'],
    });
  }
  return recs.sort((a, b) => b.priority - a.priority);
}

export function workload(s) {
  const cap = s.assumptions.capacity_ha_per_day;
  const byOp = {};
  for (const j of autumnJobs(s)) byOp[j.op] = (byOp[j.op] || 0) + j.remainingArea;
  const machineDays = sum(Object.entries(byOp).map(([op, area]) => area / cap[op]));
  const sowW = opWindow(s, 'sowing');
  return { byOp, machineDays, suitableDays: sowW.good.length, until: sowW.closesAfter };
}

// Pending product needs, in the order the assistant ranks the jobs.
export function stockStatus(s) {
  const order = timingRecs(s).map((r) => r.crop);
  const jobs = autumnJobs(s).filter((j) => j.productId && j.remaining.length)
    .sort((a, b) => order.indexOf(a.crop) - order.indexOf(b.crop) || a.stepIndex - b.stepIndex);
  const needs = {};
  for (const j of jobs) {
    (needs[j.productId] = needs[j.productId] || []).push({ job: j, qty: j.remainingArea * j.rate });
  }
  return s.stock.products.map((prod) => {
    const level = stockLevel(s, prod.id);
    const list = needs[prod.id] || [];
    const total = sum(list.map((n) => n.qty));
    let status = 'none';
    if (list.length) status = level >= total ? 'ok' : level >= list[0].qty ? 'low' : 'critical';
    let runsOutAt = null;
    let cumulative = 0;
    for (const n of list) {
      cumulative += n.qty;
      if (cumulative > level) { runsOutAt = n; break; }
    }
    return { prod, level, needs: list, total, status, shortfall: Math.max(0, total - level), runsOutAt };
  });
}

export function stockRecs(s) {
  return stockStatus(s).filter((x) => x.status === 'low' || x.status === 'critical').map((x) => {
    const unit = x.prod.unit;
    const jobsText = x.needs.map((n) => `${cropName(n.job.crop).toLowerCase()} ${fmtQty(n.qty, unit)}`).join(', ');
    const lines = [`${fmtQty(x.level, unit)} in stock. Still to apply: ${jobsText} (${fmtQty(x.total, unit)} in total).`];
    const crop = x.runsOutAt?.job.crop;
    const pos = crop ? sowingPosition(s, crop) : null;
    if (crop) {
      lines.push(`Stock runs out at the ${cropName(crop).toLowerCase()} ${x.runsOutAt.job.label.toLowerCase()}${pos ? `; your usual ${cropName(crop).toLowerCase()} sowing median is ${fmtMonthDay(pos.median)}` : ''}.`);
    }
    return {
      id: `stock-${x.prod.id}`, kind: 'stock', status: x.status,
      priority: x.status === 'critical' ? 80 : 60,
      title: `${x.status === 'critical' ? 'Critical' : 'Low'}: order ${fmtQty(x.shortfall, unit)} of ${x.prod.name}`,
      lines, sources: ['simulated', 'records'],
    };
  });
}

export function nitrogenSummary(s, crop) {
  const h = s.farm.history[crop];
  const ref = s.farm.regional[crop]?.n_kg_ha ?? null;
  const ns = Object.values(h.n_by_year).filter((v) => v != null);
  const ys = Object.entries(h.yield_by_year).filter(([, v]) => v != null);
  const yLast = h.yield_by_year[String(year(s))];
  const lower = ys.filter(([, v]) => v < yLast).length;
  const ties = ys.filter(([, v]) => v === yLast).length - 1;
  const ids = parcelsOfCrop(s, crop);
  const totalArea = sum(ids.map((p) => p.area_ha));
  const season = s.assumptions.autumn_plan.season;
  const nNext = sum(ids.map((p) => p.area_ha * sum(allEvents(s)
    .filter((e) => e.parcel === p.id && e.type === 'fertilisation' && e.campaign === season)
    .map((e) => e.n || 0)))) / totalArea;
  const avg = mean(ns);
  return {
    crop, avg, ref, last: h.n_by_year[String(year(s))],
    diffPct: ref ? ((avg - ref) / ref) * 100 : null,
    seasonsAbove: ref ? ns.filter((v) => v > ref).length : null, seasons: ns.length,
    yAvg: mean(ys.map(([, v]) => v)), yLast, yRank: lower + 1, yTies: ties, ySeasons: ys.length,
    nNext, nextSeason: season,
  };
}

function yieldText(n, yr) {
  const avg = `average ${fmt(n.yAvg)}`;
  if (n.yRank === 1) return `${yr} yield ${fmt(n.yLast)} t/ha, the ${n.yTies > 0 ? 'joint lowest' : 'lowest'} of ${n.ySeasons} seasons (${avg}).`;
  if (n.yRank + n.yTies === n.ySeasons) return `${yr} yield ${fmt(n.yLast)} t/ha, the highest of ${n.ySeasons} seasons (${avg}).`;
  return `${yr} yield ${fmt(n.yLast)} t/ha, ${n.yLast >= n.yAvg ? 'above' : 'below'} your ${n.ySeasons}-season ${avg}.`;
}

export function nitrogenRecs(s) {
  const band = s.assumptions.nitrogen_band_pct;
  return cropsOnFarm(s).map((crop) => {
    const n = nitrogenSummary(s, crop);
    if (n.ref == null || n.avg == null) return null;
    const dir = n.diffPct > band ? 'above' : n.diffPct < -band ? 'below' : 'in line with';
    const lines = [
      `10-season average ${fmt(n.avg, 0)} kg N/ha vs ${fmt(n.ref, 0)} kg regional reference (${n.diffPct > 0 ? '+' : ''}${fmt(n.diffPct, 0)}%); above it in ${n.seasonsAbove} of ${n.seasons} seasons.`,
    ];
    if (n.yLast != null) lines.push(yieldText(n, year(s)));
    if (n.nNext > 0) lines.push(`${n.nextSeason} season so far: ${fmt(n.nNext, 0)} kg N/ha recorded.`);
    if (dir !== 'in line with') lines.push('Review the next nitrogen plan with your adviser.');
    const area = sum(parcelsOfCrop(s, crop).map((p) => p.area_ha));
    return {
      id: `nitrogen-${crop}`, kind: 'nitrogen', crop, dir,
      // Flagged crops first, larger crops first (more nitrogen at stake).
      priority: (dir === 'in line with' ? 10 : 40) + area / 10,
      title: `${cropName(crop)}: nitrogen ${dir} the regional reference`,
      lines, sources: ['records', 'regional'],
    };
  }).filter(Boolean).sort((a, b) => b.priority - a.priority);
}

export function watchOuts(s) {
  const out = [];
  const years = s.weather.autumn_history.years;
  const wet = years.filter((y) => y.dry_days <= s.assumptions.wet_autumn_dry_days);
  if (wet.length) {
    const dry = wet.map((y) => y.dry_days);
    out.push({
      text: `Windows can be short: in ${wet.length} of the last ${years.length} autumns (${wet.map((y) => y.year).join(', ')}) there were only ${Math.min(...dry)}–${Math.max(...dry)} dry days between 17 Oct and 15 Nov. Use the dry days you have.`,
      sources: ['regional'],
    });
  }
  const days = forecastDays(s);
  const heavy = days.filter((d) => d.precip_mm >= 5);
  if (heavy.length) {
    out.push({
      text: `Heavy rain forecast on ${heavy.map((d) => `${fmtDate(d.date)} (${fmt(d.precip_mm)} mm)`).join(', ')}. Give the soil a day or two before drilling.`,
      sources: ['forecast', 'rule'],
    });
  }
  const windy = days.filter((d) => d.wind_max_kmh > s.assumptions.thresholds.spraying.max_wind_kmh).map((d) => d.date);
  if (windy.length) out.push({ text: `Too windy to spray on ${fmtDateRuns(windy)}.`, sources: ['forecast', 'rule'] });
  const tmin = Math.min(...days.map((d) => d.tmin));
  const normals = s.weather.daily_normals.days.filter((d) => days.some((x) => x.date.slice(5) === d.md));
  const frostShare = mean(normals.map((d) => d.frost_share));
  out.push({
    text: tmin <= 0
      ? `Frost forecast (down to ${fmt(tmin)} °C): avoid spraying on frosty mornings and check emerging crops.`
      : `No frost forecast (lowest ${fmt(tmin)} °C). ${frostShare > 0.005 ? `In past years ${fmt(frostShare * 100, 0)}% of these days had frost in the region.` : 'The regional record shows no frost on these dates in the last 10 years.'}`,
    sources: ['forecast', 'regional'],
  });
  const mild = days.filter((d) => d.precip_mm >= 1 && d.tmin >= 8).map((d) => d.date);
  if (mild.length >= 2) {
    out.push({ text: `Mild, damp days (${fmtDateRuns(mild)}): check emerging crops for slugs and disease after sowing.`, sources: ['forecast', 'rule'] });
  }
  return out;
}

export function goodDayFor(s) {
  return Object.keys(OP_LABELS).map((op) => ({ op, ...evaluateDay(s, op, 0) }));
}

export function fieldNotes(s, p) {
  const notes = [];
  const job = autumnJobs(s).filter((j) => j.parcels.includes(p.id) && j.remaining.includes(p.id))
    .sort((a, b) => a.stepIndex - b.stepIndex)[0];
  if (job) {
    const w = opWindow(s, job.op);
    notes.push({ text: `Next: ${job.label.toLowerCase()}${job.productId ? ` (${product(s, job.productId).name}, ${job.rate} ${job.unit})` : ''}. Suitable days: ${fmtDateRuns(w.good)}.`, sources: ['forecast', 'rule'] });
  }
  const harvests = allEvents(s).filter((e) => e.parcel === p.id && e.type === 'harvest' && e.status === 'done' && e.yield_t_ha != null);
  const last = harvests.filter((e) => e.campaign === year(s))[0];
  const avg = mean(harvests.map((e) => e.yield_t_ha));
  if (last && avg) {
    const diff = ((last.yield_t_ha - avg) / avg) * 100;
    notes.push({ text: `${year(s)} yield ${fmt(last.yield_t_ha)} t/ha, ${fmt(Math.abs(diff), 0)}% ${diff >= 0 ? 'above' : 'below'} this field's ${harvests.length}-season average (${fmt(avg)}).`, sources: ['records'] });
  }
  const ref = s.farm.regional[p.crop]?.n_kg_ha;
  const nLast = sum(allEvents(s).filter((e) => e.parcel === p.id && e.type === 'fertilisation' && e.campaign === year(s)).map((e) => e.n || 0));
  if (ref && nLast) {
    notes.push({ text: `${year(s)} nitrogen ${fmt(nLast, 0)} kg/ha vs ${fmt(ref, 0)} regional reference (${nLast > ref ? '+' : ''}${fmt(((nLast - ref) / ref) * 100, 0)}%).`, sources: ['records', 'regional'] });
  }
  if (p.soil?.lime_requirement_t_ha > 0) {
    notes.push({ text: `Soil record shows a lime requirement of ${fmt(p.soil.lime_requirement_t_ha)} t/ha (pH ${fmt(p.soil.ph_h2o)}).`, sources: ['records'] });
  }
  const farmOm = mean(s.farm.parcels.map((x) => x.soil?.organic_matter_pct));
  if (p.soil?.organic_matter_pct != null && farmOm) {
    const rel = p.soil.organic_matter_pct < farmOm * 0.85 ? 'below' : p.soil.organic_matter_pct > farmOm * 1.15 ? 'above' : 'close to';
    notes.push({ text: `Organic matter ${fmt(p.soil.organic_matter_pct)}%, ${rel} the farm average (${fmt(farmOm)}%).`, sources: ['records'] });
  }
  return notes;
}

// Top of the home page: timing first (the team's priority), then the most
// urgent stock alert, otherwise the strongest nitrogen signal.
export function todaysActions(s) {
  const timing = timingRecs(s);
  const stock = stockRecs(s).sort((a, b) => b.priority - a.priority);
  const third = stock[0] || nitrogenRecs(s)[0];
  return [...timing.slice(0, 2), third].filter(Boolean);
}

export function allRecommendations(s) {
  return { timing: timingRecs(s), stock: stockRecs(s), nitrogen: nitrogenRecs(s), watch: watchOuts(s) };
}

export const fieldName = (s, id) => `${shortId(id)} · ${cropName(parcel(s, id).crop)}`;
