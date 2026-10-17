// HTML for every screen. Pure functions of the state.
import {
  CROPS, TYPE_LABELS, OP_LABELS, esc, fmt, fmtQty, fmtDate, fmtDay, fmtLongDate, fmtMonthDay, fmtDateRuns,
  badges, cropName, cropColor, weatherIcon, shortId, monthName, mean, sum,
} from './util.js';
import {
  today, year, parcel, parcelsOfCrop, areaOf, cropsOnFarm, parcelStatus, autumnJobs, workLeft, seasonSummary,
  product, stockLevel, productUsage, lastProductsUsed, lastActivities, allEvents, ndviFor, farmNdvi, eventQty,
} from './model.js';
import {
  forecastDays, evaluateDay, opWindow, timingRecs, workload, stockStatus, stockRecs, nitrogenRecs, nitrogenSummary,
  watchOuts, goodDayFor, fieldNotes, todaysActions,
} from './rules.js';
import { renderMap, STATUS_LEGEND, ndviColor } from './map.js';
import { barChart, progressBar, stackedBar } from './charts.js';

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  weather: '<path d="M12 3v2M5.6 5.6l1.4 1.4M3 12h2M17 7l1.4-1.4"/><circle cx="12" cy="11" r="3.5"/><path d="M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A3 3 0 0 0 8 20z"/>',
  activities: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>',
  ndvi: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19 13 11"/>',
  last: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  recs: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  inventory: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
};
export const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const KIND = { timing: 'Timing', stock: 'Stock', nitrogen: 'Nitrogen' };

function cropChip(crop) {
  return `<span class="crop-chip"><i style="background:${cropColor(crop)}"></i>${esc(cropName(crop))}</span>`;
}

function dayChips(dates) {
  return dates.length ? `<div class="day-chips">${dates.map((d) => `<span class="day-chip">${esc(fmtDay(d))}</span>`).join('')}</div>` : '';
}

export function recCard(r, { index = null, compact = false } = {}) {
  return `<article class="rec rec-${r.kind}${r.status ? ` rec-${r.status}` : ''}" data-rec="${esc(r.id)}">
    <header>
      ${index != null ? `<span class="rec-num">${index}</span>` : ''}
      <span class="kind kind-${r.kind}">${KIND[r.kind]}</span>
      ${r.crop ? cropChip(r.crop) : ''}
    </header>
    <h4>${esc(r.title)}</h4>
    <ul class="rec-lines">${r.lines.slice(0, compact ? 3 : 9).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${r.goodDays ? dayChips(r.goodDays) : ''}
    <footer>${badges(r.sources)}</footer>
  </article>`;
}

// ---------- sidebar ----------

export function sidebar(s) {
  const view = s.ui.view;
  const t = today(s);
  const d0 = forecastDays(s)[0];
  const w = weatherIcon(d0.weather_code);
  const left = workLeft(s).left;
  const ndvi = farmNdvi(s);
  const last = lastActivities(s, 40);
  const lastDay = last.find((e) => e.kind === 'event')?.date;
  const lastDayItems = last.filter((e) => e.date === lastDay && e.kind === 'event');
  const top = todaysActions(s)[0];
  const alerts = stockStatus(s).filter((x) => x.status === 'low' || x.status === 'critical');
  const area = s.farm.meta.area_ha;

  const tiles = [
    {
      view: 'home', title: 'Farm map', summary: `${s.farm.parcels.length} fields · ${cropsOnFarm(s).length} crops · ${fmt(area)} ha`,
      pop: `<h5>Fields by crop</h5>${cropsOnFarm(s).map((c) => {
        const ids = parcelsOfCrop(s, c).map((p) => p.id);
        return `<div class="pop-row">${cropChip(c)}<span>${ids.length} · ${fmt(areaOf(s, ids))} ha</span></div>`;
      }).join('')}`,
    },
    {
      view: 'weather', title: 'Weather', summary: `${w.icon} ${fmt(d0.tmax, 0)}° / ${fmt(d0.tmin, 0)}° · ${w.text}`,
      pop: `<h5>${esc(fmtLongDate(t))}</h5>
        <div class="pop-row"><span>${w.icon} ${esc(w.text)}</span><span>${fmt(d0.tmax, 0)}° / ${fmt(d0.tmin, 0)}°</span></div>
        <div class="pop-row"><span>Rain</span><span>${fmt(d0.precip_mm)} mm · ${d0.precip_prob}%</span></div>
        <div class="pop-row"><span>Wind</span><span>up to ${fmt(d0.wind_max_kmh, 0)} km/h</span></div>
        <h5>Good day for</h5>${goodDayFor(s).map((g) => `<div class="pop-row"><span>${esc(OP_LABELS[g.op])}</span><span class="${g.ok ? 'ok' : 'no'}">${g.ok ? '✓ yes' : `✗ ${esc(g.reasons[0])}`}</span></div>`).join('')}`,
    },
    {
      view: 'activities', title: 'Activities', summary: `${fmt(left.sowing)} ha to sow · ${fmt(left.harvest)} ha to harvest`,
      pop: `<h5>Autumn work left</h5>${[['harvest', 'To harvest'], ['fertilisation', 'To fertilise'], ['sowing', 'To sow'], ['spraying', 'To spray']].map(([k, l]) => {
        const tot = workLeft(s).total[k];
        return `<div class="pop-row"><span>${l}</span><span>${fmt(left[k])} of ${fmt(tot)} ha</span></div>${progressBar(tot - left[k], tot)}`;
      }).join('')}`,
    },
    {
      view: 'ndvi', title: 'NDVI', summary: `Farm index ${fmt(ndvi, 2)} · simulated`,
      pop: `<h5>Farm vegetation index</h5><div class="pop-big" style="color:${ndviColor(ndvi)}">${fmt(ndvi, 2)}</div>
        <p>Low because most fields are harvested and bare in mid-October.</p><p class="pop-note">Simulated: the dataset has no satellite data.</p>`,
    },
    {
      view: 'last', title: 'Last activities', summary: lastDay ? `${fmtDate(lastDay)} · ${lastDayItems.length} operation${lastDayItems.length > 1 ? 's' : ''}` : 'None yet',
      pop: `<h5>${lastDay ? esc(fmtLongDate(lastDay)) : ''}</h5>${lastDayItems.slice(0, 5).map((e) => `<div class="pop-row"><span>${esc(TYPE_LABELS[e.type])} · ${esc(shortId(e.parcel))}</span><span>${e.source === 'captured' ? 'logged' : esc(cropName(parcel(s, e.parcel).crop))}</span></div>`).join('')}`,
    },
    {
      view: 'recs', title: 'Recommendations', summary: top ? top.title : 'Nothing urgent',
      pop: top ? `<h5>Today's top action</h5><p class="pop-strong">${esc(top.title)}</p><p>${esc(top.lines[0])}</p><p class="pop-note">Rule-based assistant. Language model on the roadmap.</p>` : '',
    },
    {
      view: 'inventory', title: 'Inventory', summary: alerts.length ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''} · ${alerts[0].prod.name.split(' (')[0]} ${alerts[0].status}` : 'Stock covers the plan',
      pop: `<h5>Last products used</h5>${lastProductsUsed(s).map((u) => `<div class="pop-row"><span>${esc(u.name)}</span><span>${esc(fmtDate(u.date))} · ${esc(shortId(u.parcel))}</span></div>`).join('')}`,
    },
  ];

  return tiles.map((tile) => `
    <div class="tile-wrap">
      <button class="tile${view === tile.view ? ' is-active' : ''}" data-view="${tile.view}">
        <span class="tile-ico">${icon(tile.view)}</span>
        <span class="tile-text"><span class="tile-title">${esc(tile.title)}</span><span class="tile-sum">${esc(tile.summary)}</span></span>
      </button>
      <div class="pop" role="tooltip">${tile.pop}</div>
    </div>`).join('');
}

// ---------- home ----------

function autumnProgress(s) {
  const wl = workLeft(s);
  const rows = [['harvest', 'Harvest standing maize'], ['fertilisation', 'Base fertiliser'], ['sowing', 'Sowing'], ['spraying', 'Post-sowing herbicide']];
  return `<div class="progress-grid">${rows.map(([k, l]) => {
    const done = wl.total[k] - wl.left[k];
    return `<div class="progress-item"><div class="progress-head"><span>${l}</span><span>${fmt(done)} / ${fmt(wl.total[k])} ha</span></div>${progressBar(done, wl.total[k])}</div>`;
  }).join('')}</div>`;
}

function workloadBox(s) {
  const wl = workload(s);
  const ratio = wl.suitableDays ? wl.machineDays / wl.suitableDays : 2;
  const tight = ratio > 1;
  return `<div class="workload ${tight ? 'is-tight' : ''}">
    <div><strong>${fmt(wl.machineDays)} days of field work</strong> left, <strong>${wl.suitableDays} suitable days</strong> in the forecast${wl.until ? ` until ${fmtDate(wl.until)}` : ''}.</div>
    <div class="workload-bar"><div style="width:${Math.min(100, (wl.suitableDays / Math.max(wl.machineDays, wl.suitableDays)) * 100)}%"></div></div>
    <div class="workload-note">${tight ? 'More work than good days: do the job whose window closes first.' : 'The forecast leaves room for the planned work.'} ${badges(['forecast', 'rule'])}</div>
  </div>`;
}

export function homeView(s) {
  const actions = todaysActions(s);
  return `
  <section class="home-grid">
    <div class="card map-card">
      <div class="card-head">
        <div><h2>Your fields</h2><p class="sub">${s.farm.parcels.length} fields · ${fmt(s.farm.meta.area_ha)} ha · click a field for details</p></div>
        <div class="legend">${cropsOnFarm(s).map(cropChip).join('')}</div>
      </div>
      <div class="map-wrap">${renderMap(s, { selected: s.ui.parcel, flash: s.ui.flash })}</div>
      <div class="map-foot">
        <div class="legend status-legend">${STATUS_LEGEND.map(([m, l]) => `<span><b>${m}</b> ${l}</span>`).join('')}</div>
        <span class="muted">Schematic layout from the dataset's local grid. Not to scale, no real location.</span>
      </div>
      <h3 class="section-title">Autumn work</h3>
      ${autumnProgress(s)}
    </div>
    <div class="card assistant-card">
      <div class="card-head"><div><h2>Assistant · today</h2><p class="sub">${esc(fmtLongDate(today(s)))}</p></div></div>
      ${workloadBox(s)}
      <div class="rec-list">${actions.map((r, i) => recCard(r, { index: i + 1, compact: true })).join('')}</div>
      <button class="link-btn" data-view="recs">All recommendations →</button>
    </div>
  </section>`;
}

// ---------- weather ----------

export function weatherView(s) {
  const days = forecastDays(s);
  const d0 = days[0];
  const w0 = weatherIcon(d0.weather_code);
  const ops = Object.keys(OP_LABELS);
  const hist = s.weather.autumn_history.years;
  const wetIdx = hist.map((y, i) => (y.dry_days <= s.assumptions.wet_autumn_dry_days ? i : -1)).filter((i) => i >= 0);
  const season = s.weather.season_monthly.months;
  const f = s.weather.forecast;
  return `
  <section class="view-head"><h2>Weather</h2><p class="sub">Forecast for the ${esc(s.farm.meta.region_name)} region centre, history from regional reanalysis ${badges(['forecast', 'regional'])}</p></section>
  <section class="grid-2">
    <div class="card today-card">
      <div class="today-main"><span class="today-ico">${w0.icon}</span>
        <div><div class="today-temp">${fmt(d0.tmax, 0)}° <span>/ ${fmt(d0.tmin, 0)}°</span></div><div>${esc(w0.text)} · rain ${fmt(d0.precip_mm)} mm (${d0.precip_prob}%) · wind up to ${fmt(d0.wind_max_kmh, 0)} km/h</div></div>
      </div>
      <h3 class="section-title">Good day for</h3>
      <div class="good-for">${goodDayFor(s).map((g) => `<div class="good ${g.ok ? 'ok' : 'no'}"><b>${g.ok ? '✓' : '✗'}</b> ${esc(OP_LABELS[g.op])}${g.ok ? '' : `<small>${esc(g.reasons.join(', '))}</small>`}</div>`).join('')}</div>
    </div>
    <div class="card">
      <h3 class="section-title">Things to consider</h3>
      <ul class="watch">${watchOuts(s).map((x) => `<li>${esc(x.text)} ${badges(x.sources)}</li>`).join('')}</ul>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h3>Next ${days.length} days</h3><span class="muted">Snapshot fetched ${esc(f.fetched_at.replace('T', ' '))} · ${esc(f.source)}</span></div>
    <div class="forecast-row">${days.map((d) => {
      const wi = weatherIcon(d.weather_code);
      return `<div class="fday${d.precip_mm >= 5 ? ' is-wet' : ''}"><div class="fday-name">${esc(fmtDay(d.date))}</div><div class="fday-ico" title="${esc(wi.text)}">${wi.icon}</div>
        <div class="fday-t">${fmt(d.tmax, 0)}° <span>${fmt(d.tmin, 0)}°</span></div>
        <div class="fday-r">${fmt(d.precip_mm)} mm · ${d.precip_prob}%</div><div class="fday-w">${fmt(d.wind_max_kmh, 0)} km/h</div></div>`;
    }).join('')}</div>
    <h3 class="section-title">Work windows ${badges(['rule'])}</h3>
    <div class="table-scroll"><table class="windows">
      <thead><tr><th></th>${days.map((d) => `<th>${esc(fmtDay(d.date))}</th>`).join('')}</tr></thead>
      <tbody>${ops.map((op) => `<tr><th>${esc(OP_LABELS[op])}</th>${days.map((_, i) => {
        const e = evaluateDay(s, op, i);
        return `<td class="${e.ok ? 'ok' : 'no'}" title="${esc(e.ok ? 'Suitable' : e.reasons.join(', '))}">${e.ok ? '✓' : '✗'}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </section>
  <section class="grid-2">
    <div class="card">
      <h3>Dry days, 17 Oct–15 Nov, last 10 autumns ${badges(['regional'])}</h3>
      <p class="sub">Days with less than 1 mm rain. Orange: autumns with ${s.assumptions.wet_autumn_dry_days} dry days or fewer.</p>
      ${barChart({ labels: hist.map((y) => String(y.year)), values: hist.map((y) => y.dry_days), highlight: wetIdx, unit: 'dry days', digits: 0 })}
      <p class="muted">Rain in the same window: ${hist.map((y) => `${y.year} ${fmt(y.total_mm, 0)} mm`).join(' · ')}</p>
    </div>
    <div class="card">
      <h3>${s.weather.season_monthly.year} season so far ${badges(['regional'])}</h3>
      <p class="sub">Monthly rain (mm) in the region, synthetic monthly series from the dataset.</p>
      ${barChart({ labels: season.map((m) => monthName(m.month)), values: season.map((m) => m.precip_mm), unit: 'mm', digits: 0, color: '#5B8DB8' })}
      <p class="muted">Mean temperature: ${season.map((m) => `${monthName(m.month)} ${fmt(m.tmean_c, 0)}°`).join(' · ')}</p>
    </div>
  </section>`;
}

// ---------- activities ----------

function eventDetail(s, e) {
  const p = parcel(s, e.parcel);
  const rows = [['Field', `${shortId(e.parcel)} · ${cropName(p.crop)} · ${fmt(p.area_ha)} ha`], ['Date', fmtLongDate(e.date)], ['Season', String(e.campaign)]];
  if (e.type === 'sowing') rows.push(['Seed', `${e.variety || (e.productId ? product(s, e.productId).name : '–')}${e.seed_origin ? ` (${e.seed_origin.toLowerCase().replace('_', '-')})` : ''}`], ['Rate', `${fmt(e.rate, 1)} kg/ha`], ['Total', fmtQty(eventQty(s, e), 'kg')]);
  if (e.type === 'fertilisation') {
    rows.push(['Product', e.productId ? product(s, e.productId).name : `${(e.product_type || '').toLowerCase()} fertiliser (records hold N-P-K only)`]);
    if (e.rate) rows.push(['Rate', `${fmt(e.rate, 0)} kg/ha`], ['Total product', fmtQty(eventQty(s, e), 'kg')]);
    rows.push(['N / P₂O₅ / K₂O', `${fmt(e.n, 1)} / ${fmt(e.p2o5, 1)} / ${fmt(e.k2o, 1)} kg/ha`], ['Total N', `${fmt((e.n || 0) * p.area_ha, 0)} kg`]);
    if (e.method) rows.push(['Method', e.method.toLowerCase().replace('_', ' ')]);
  }
  if (e.type === 'spraying') {
    const name = e.productId ? product(s, e.productId).name : e.product;
    rows.push(['Product', `${name}${e.product_type ? ` (${e.product_type.toLowerCase()})` : ''}`], ['Active substance', e.active_substance || (e.productId ? product(s, e.productId).active_substance : '–') || '–'],
      ['Dose', `${fmt(e.rate, 2)} ${e.unit || 'L/ha'}`], ['Total', `${fmt(eventQty(s, e), 1)} ${e.productId ? product(s, e.productId).unit : 'L or kg'}`]);
  }
  if (e.type === 'harvest') rows.push(['Yield', e.status === 'planned' ? 'not harvested yet' : `${fmt(e.yield_t_ha, 2)} t/ha`], ['Total', e.status === 'planned' ? '–' : `${fmt((e.yield_t_ha || 0) * p.area_ha, 1)} t`], ['Moisture', e.status === 'planned' ? '–' : `${fmt(e.moisture_pct, 1)}%`]);
  if (e.raw) rows.push(['Logged as', `"${e.raw}" (${e.channel})`]);
  return `<div class="event-detail"><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
}

function eventSummary(s, e) {
  if (e.type === 'sowing') return `${e.variety || (e.productId ? product(s, e.productId).name : '')} · ${fmt(e.rate, 0)} kg/ha`;
  if (e.type === 'fertilisation') return `${e.productId ? `${product(s, e.productId).name} · ${fmt(e.rate, 0)} kg/ha · ` : ''}${fmt(e.n, 0)} kg N/ha`;
  if (e.type === 'spraying') return `${e.productId ? product(s, e.productId).name : e.product} · ${fmt(e.rate, 2)} ${e.productId ? `${product(s, e.productId).unit}/ha` : 'L or kg/ha'}`;
  if (e.type === 'harvest') return e.status === 'planned' ? 'planned' : `${fmt(e.yield_t_ha, 2)} t/ha`;
  return '';
}

export function activitiesView(s) {
  const wl = workLeft(s);
  const jobs = autumnJobs(s);
  const sum26 = seasonSummary(s, year(s));
  const filter = s.ui.activityFilter;
  const seasonSel = s.ui.activitySeason;
  const evs = allEvents(s).filter((e) => e.campaign === seasonSel && (filter === 'all' || e.type === filter))
    .sort((a, b) => b.date.localeCompare(a.date));
  const seasons = [s.assumptions.autumn_plan.season, year(s), year(s) - 1, year(s) - 2];
  return `
  <section class="view-head"><h2>Activities</h2><p class="sub">What has been done on the farm, and what is left this autumn ${badges(['records', 'captured'])}</p></section>
  <section class="grid-2">
    <div class="card">
      <h3>Autumn work left (${s.assumptions.autumn_plan.season} season) ${badges(['simulated'])}</h3>
      <p class="sub">Plan: maize harvest from your records; base fertiliser, sowing and herbicide for the winter crops (demo assumption).</p>
      ${[['harvest', 'Harvest'], ['fertilisation', 'Base fertiliser'], ['sowing', 'Sowing'], ['spraying', 'Post-sowing herbicide']].map(([k, l]) => {
        const done = wl.total[k] - wl.left[k];
        const leftFields = jobs.filter((j) => j.type === k).flatMap((j) => j.remaining);
        return `<div class="progress-item"><div class="progress-head"><span>${l}</span><span><b>${fmt(wl.left[k])} ha left</b> of ${fmt(wl.total[k])}</span></div>${progressBar(done, wl.total[k])}
          <div class="muted small">${leftFields.length ? `Left: ${leftFields.map(shortId).join(', ')}` : 'All done ✓'}</div></div>`;
      }).join('')}
      <button class="link-btn" data-view="recs">What to do next →</button>
    </div>
    <div class="card">
      <h3>${year(s)} season in numbers ${badges(['records'])}</h3>
      <div class="kpis">
        <div class="kpi"><span class="kpi-v">${fmt(sum26.sowing.area)} ha</span><span class="kpi-l">sown (${sum26.sowing.count} sowings)</span></div>
        <div class="kpi"><span class="kpi-v">${fmt(sum26.fertilisation.nKg / 1000, 1)} t N</span><span class="kpi-l">${sum26.fertilisation.count} fertiliser passes</span></div>
        <div class="kpi"><span class="kpi-v">${sum26.spraying.count}</span><span class="kpi-l">spray passes on ${fmt(sum26.spraying.area)} ha</span></div>
        <div class="kpi"><span class="kpi-v">${fmt(sum26.harvest.tonnes, 0)} t</span><span class="kpi-l">harvested from ${fmt(sum26.harvest.area)} ha</span></div>
      </div>
      <p class="muted small">Two maize fields are still standing (harvest planned in the records). ${s.farm.meta.dropped_events ? `${sum(Object.values(s.farm.meta.dropped_events))} implausible records dated after harvest were left out.` : ''}</p>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h3>Activity log</h3>
      <div class="chips">${seasons.map((y) => `<button class="chip${seasonSel === y ? ' is-on' : ''}" data-season="${y}">${y === s.assumptions.autumn_plan.season ? `${y} (autumn)` : y}</button>`).join('')}</div>
    </div>
    <div class="chips">${['all', 'sowing', 'fertilisation', 'spraying', 'harvest'].map((f) => `<button class="chip${filter === f ? ' is-on' : ''}" data-filter="${f}">${f === 'all' ? 'All' : TYPE_LABELS[f]}</button>`).join('')}</div>
    ${evs.length ? `<div class="table-scroll"><table class="log">
      <thead><tr><th>Date</th><th>Field</th><th>Operation</th><th>Details</th><th class="num">Area</th><th>Source</th></tr></thead>
      <tbody>${evs.map((e) => {
        const p = parcel(s, e.parcel);
        const open = s.ui.event === e.id;
        return `<tr class="log-row${open ? ' is-open' : ''}${e.status === 'planned' ? ' is-planned' : ''}" data-event="${esc(e.id)}">
          <td>${esc(fmtDate(e.date, true))}</td><td>${esc(shortId(e.parcel))} ${cropChip(p.crop)}</td>
          <td>${esc(TYPE_LABELS[e.type])}${e.status === 'planned' ? ' <span class="tag">planned</span>' : ''}</td>
          <td>${esc(eventSummary(s, e))}</td><td class="num">${fmt(p.area_ha)} ha</td><td>${badges([e.source])}</td></tr>
          ${open ? `<tr class="detail-row"><td colspan="6">${eventDetail(s, e)}</td></tr>` : ''}`;
      }).join('')}</tbody></table></div>` : `<p class="empty">No activities logged for this season yet. Use <b>Log activity</b> to add one.</p>`}
  </section>`;
}

// ---------- NDVI (design only, simulated) ----------

export function ndviView(s) {
  const comment = {
    standing: 'Maize senescing before harvest: index falling, as expected.',
    'to-sow': 'Bare stubble after harvest: low index is normal.',
    prepared: 'Seedbed prepared: bare soil.',
    sown: 'Just sown: emergence in 1–3 weeks.',
    fallow: 'Spring-crop stubble until next season.',
  };
  const avg = farmNdvi(s);
  return `
  <section class="view-head"><h2>NDVI</h2><p class="sub">Vegetation index per field ${badges(['simulated'])}</p></section>
  <div class="banner">Simulated design screen. The dataset has no satellite signal and the fields have no real location, so these values are illustrative. Roadmap: Sentinel-2 once the farmer imports real field boundaries.</div>
  <section class="home-grid">
    <div class="card map-card">
      <div class="card-head"><div><h2>Farm index <span style="color:${ndviColor(avg)}">${fmt(avg, 2)}</span></h2><p class="sub">Area-weighted mean</p></div>
        <div class="ndvi-scale"><span>0.1</span><div></div><span>0.6+</span></div></div>
      <div class="map-wrap">${renderMap(s, { mode: 'ndvi', selected: s.ui.parcel })}</div>
    </div>
    <div class="card">
      <h3>By field</h3>
      <div class="ndvi-list">${s.farm.parcels.map((p) => {
        const n = ndviFor(s, p);
        const st = parcelStatus(s, p);
        return `<button class="ndvi-row" data-parcel="${p.id}">
          <span class="ndvi-id">${esc(shortId(p.id))} ${cropChip(p.crop)}</span>
          <span class="ndvi-v" style="color:${ndviColor(n.value)}">${fmt(n.value, 2)}</span>
          ${stackedBar([[n.red, '#C4452F', 'Low'], [n.yellow, '#E8B83A', 'Medium'], [n.green, '#3E8B5A', 'High']])}
          <span class="muted small">${esc(comment[st.code] || '')}</span></button>`;
      }).join('')}</div>
      <h3 class="section-title">What to look for</h3>
      <ul class="watch"><li>After sowing, fields should turn from red to yellow within 3–4 weeks. A field that stays red may have poor emergence: walk it.</li>
      <li>Uneven colour inside one field points to soil or drainage differences worth a soil test.</li></ul>
    </div>
  </section>`;
}

// ---------- last activities ----------

const TL_ICON = { sowing: '🌱', fertilisation: '🧪', spraying: '💧', harvest: '🌾' };

export function lastView(s) {
  const groups = [];
  for (const it of lastActivities(s, 24)) {
    const g = groups[groups.length - 1];
    if (g && g.date === it.date) g.items.push(it); else groups.push({ date: it.date, items: [it] });
  }
  const row = (it) => {
    if (it.kind === 'note') {
      return `<div class="tl-item"${it.parcel ? ` data-parcel="${it.parcel}"` : ''}><span class="tl-ico">📝</span>
        <div class="tl-body"><b>${esc(it.noteKind)}${it.parcel ? ` · ${esc(shortId(it.parcel))}` : ''}</b><span>${esc(it.text)}</span></div>${badges(['simulated'])}</div>`;
    }
    const p = parcel(s, it.parcel);
    return `<div class="tl-item" data-parcel="${it.parcel}"><span class="tl-ico">${TL_ICON[it.type]}</span>
      <div class="tl-body"><b>${esc(TYPE_LABELS[it.type])} · ${esc(shortId(it.parcel))} ${cropChip(p.crop)}</b><span>${esc(eventSummary(s, it))} · ${fmt(p.area_ha)} ha</span></div>${badges([it.source])}</div>`;
  };
  return `
  <section class="view-head"><h2>Last activities</h2><p class="sub">Operations from your records and logs, plus field visits and machinery notes ${badges(['records', 'captured', 'simulated'])}</p></section>
  <section class="card timeline">${groups.map((g) => `
    <div class="tl-day"><div class="tl-date">${esc(fmtLongDate(g.date))}</div>${g.items.map(row).join('')}</div>`).join('')}
  </section>`;
}

// ---------- recommendations ----------

export function recsView(s) {
  const timing = timingRecs(s);
  const stock = stockRecs(s);
  const nitrogen = nitrogenRecs(s);
  return `
  <section class="view-head"><h2>Recommendations</h2><p class="sub">Rule-based assistant: every advice line shows where its numbers come from. A language model is on the roadmap.</p></section>
  <section class="card">
    <div class="card-head"><h3>1 · Timing: what to do while the weather allows</h3><span>${badges(['forecast', 'records', 'rule'])}</span></div>
    ${workloadBox(s)}
    <div class="rec-grid">${timing.map((r, i) => recCard(r, { index: i + 1 })).join('') || '<p class="empty">No autumn jobs left.</p>'}</div>
  </section>
  <section class="grid-2">
    <div class="card">
      <h3>2 · Stock</h3>
      <div class="rec-list">${stock.map((r) => recCard(r)).join('') || '<p class="empty">Stock covers every planned job ✓</p>'}</div>
      <button class="link-btn" data-view="inventory">Open inventory →</button>
    </div>
    <div class="card">
      <h3>3 · Nitrogen against your history and the region</h3>
      <div class="rec-list">${nitrogen.map((r) => recCard(r, { compact: true })).join('')}</div>
    </div>
  </section>
  <section class="card">
    <h3>Watch-outs</h3>
    <ul class="watch">${watchOuts(s).map((x) => `<li>${esc(x.text)} ${badges(x.sources)}</li>`).join('')}</ul>
  </section>
  <section class="card">
    <h3>By field</h3>
    <div class="field-grid">${s.farm.parcels.map((p) => {
      const st = parcelStatus(s, p);
      const notes = fieldNotes(s, p).slice(0, 2);
      return `<button class="field-card" data-parcel="${p.id}">
        <span class="fc-head"><b>${esc(shortId(p.id))}</b>${cropChip(p.crop)}<span class="muted">${fmt(p.area_ha)} ha</span></span>
        <span class="fc-status">${esc(st.label)}</span>
        ${notes.map((n) => `<span class="fc-note">${esc(n.text)}</span>`).join('')}
      </button>`;
    }).join('')}</div>
  </section>`;
}

// ---------- inventory ----------

const STATUS_TEXT = { ok: 'Covers plan', low: 'Low', critical: 'Critical', none: 'No planned use' };

export function inventoryView(s) {
  const rows = stockStatus(s);
  const alerts = rows.filter((r) => r.status === 'low' || r.status === 'critical');
  return `
  <section class="view-head"><h2>Inventory</h2><p class="sub">Stock in the shed, what has been used and what the autumn plan still needs ${badges(['simulated', 'records', 'captured'])}</p></section>
  ${alerts.length ? `<div class="rec-list">${stockRecs(s).map((r) => recCard(r)).join('')}</div>` : ''}
  <section class="card">
    <div class="table-scroll"><table class="inv">
      <thead><tr><th>Product</th><th class="num">In stock</th><th>Autumn plan needs</th><th>Status</th><th class="num">Used ${year(s)} season</th><th class="num">Logged today</th><th>Last used</th></tr></thead>
      <tbody>${rows.map((r) => {
        const u = productUsage(s, r.prod);
        const unit = r.prod.unit;
        const need = r.needs.length ? r.needs.map((n) => `${cropName(n.job.crop)} ${n.job.label.toLowerCase()} ${fmtQty(n.qty, unit)}`).join('<br>') : '–';
        const cover = r.total ? Math.min(1, r.level / r.total) : 1;
        return `<tr class="inv-${r.status}">
          <td><b>${esc(r.prod.name)}</b><div class="muted small">${esc(r.prod.type.toLowerCase())}${r.prod.active_substance ? ` · ${esc(r.prod.active_substance)}` : ''}</div></td>
          <td class="num"><b>${esc(fmtQty(r.level, unit))}</b>${r.total ? `<div class="cover"><div style="width:${cover * 100}%"></div></div>` : ''}</td>
          <td class="small">${need}</td>
          <td><span class="status status-${r.status}">${STATUS_TEXT[r.status]}</span></td>
          <td class="num">${u.recordsHaveNoProduct ? '<span class="muted small">records hold N-P-K only</span>' : esc(fmtQty(u.usedSeason, unit))}</td>
          <td class="num">${u.usedCaptured ? esc(fmtQty(u.usedCaptured, unit)) : '–'}</td>
          <td class="small">${u.last ? `${esc(fmtDate(u.last.date, true))} · ${esc(shortId(u.last.parcel))}` : '–'}</td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="muted small">Opening stock is simulated (set by the team). Usage comes from the farm records and from activities logged in this app. Fuel is not tracked: the dataset only holds annual energy costs.</p>
  </section>`;
}

// ---------- field drawer ----------

export function fieldDrawer(s) {
  const p = parcel(s, s.ui.parcel);
  if (!p) return '';
  const st = parcelStatus(s, p);
  const evs = allEvents(s).filter((e) => e.parcel === p.id);
  const years = Object.keys(s.farm.history[p.crop].yield_by_year).map(Number);
  const yields = years.map((y) => evs.find((e) => e.type === 'harvest' && e.campaign === y && e.status === 'done')?.yield_t_ha ?? null);
  const nByYear = years.map((y) => {
    const list = evs.filter((e) => e.type === 'fertilisation' && e.campaign === y);
    return list.length ? sum(list.map((e) => e.n || 0)) : null;
  });
  const ref = s.farm.regional[p.crop]?.n_kg_ha;
  const timeline = evs.filter((e) => e.campaign >= year(s)).sort((a, b) => b.date.localeCompare(a.date));
  const soil = p.soil || {};
  const fw = p.field_weather?.[String(year(s))];
  const irr = p.irrigation?.[String(year(s))];
  const soilRows = [
    ['pH', fmt(soil.ph_h2o)], ['Organic matter', `${fmt(soil.organic_matter_pct)}%`], ['Nitrogen', `${fmt(soil.nitrogen_g_kg, 2)} g/kg`],
    ['Phosphorus', `${fmt(soil.phosphorus_mg_kg, 0)} mg/kg`], ['Potassium', `${fmt(soil.potassium_mg_kg, 0)} mg/kg`], ['CEC', `${fmt(soil.cec_cmol_kg)} cmol/kg`],
    ['Sand / silt / clay', `${fmt(soil.sand_pct, 0)} / ${fmt(soil.silt_pct, 0)} / ${fmt(soil.clay_pct, 0)}%`], ['Lime requirement', `${fmt(soil.lime_requirement_t_ha)} t/ha`],
  ];
  return `
  <div class="drawer-head">
    <div><div class="drawer-title">${esc(shortId(p.id))} ${cropChip(p.crop)}</div>
      <div class="sub">${fmt(p.area_ha)} ha · ${esc(p.tenure.toLowerCase())} · previous crop ${esc(cropName(p.crop_previous))}</div></div>
    <button class="icon-btn" data-action="close-drawer" aria-label="Close">✕</button>
  </div>
  <div class="drawer-body">
    <div class="status-box status-${st.code}"><b>${esc(st.label)}</b><span>${esc(st.detail)}</span></div>
    <h4>What to watch</h4>
    <ul class="watch">${fieldNotes(s, p).map((n) => `<li>${esc(n.text)} ${badges(n.sources)}</li>`).join('')}</ul>
    <h4>Yield, last ${years.length} seasons (t/ha) ${badges(['records'])}</h4>
    ${barChart({ labels: years.map((y) => `'${String(y).slice(2)}`), values: yields, color: cropColor(p.crop), height: 130, unit: 't/ha', refValue: mean(yields), refLabel: 'avg' })}
    <h4>Nitrogen applied (kg N/ha) ${badges(['records', 'regional'])}</h4>
    ${barChart({ labels: years.map((y) => `'${String(y).slice(2)}`), values: nByYear, color: '#6C8EAD', height: 130, unit: 'kg N/ha', refValue: ref, refLabel: 'regional ref.', digits: 0 })}
    <h4>Soil ${badges(['records'])}</h4>
    <dl class="soil">${soilRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${fw ? `<h4>${year(s)} season water and warmth ${badges(['records'])}</h4>
      <dl class="soil"><dt>Rain</dt><dd>${fmt(fw.precip_mm, 0)} mm</dd><dt>Irrigation</dt><dd>${irr?.irrigated ? `${fmt(irr.water_mm, 0)} mm` : 'none'}</dd>
      <dt>Crop water demand (ET₀)</dt><dd>${fmt(fw.et0_mm, 0)} mm</dd><dt>Growing degree days</dt><dd>${fmt(fw.gdd_annual, 0)} (base 10 °C)</dd></dl>` : ''}
    <h4>Timeline, ${year(s)} and ${s.assumptions.autumn_plan.season} seasons</h4>
    <div class="mini-tl">${timeline.map((e) => `<div class="mini-tl-row${e.status === 'planned' ? ' is-planned' : ''}${e.source === 'captured' ? ' is-captured' : ''}">
      <span class="mini-date">${esc(fmtDate(e.date))}</span><span>${TL_ICON[e.type]} ${esc(TYPE_LABELS[e.type])}${e.status === 'planned' ? ' (planned)' : ''}</span><span class="muted">${esc(eventSummary(s, e))}</span></div>`).join('')}</div>
  </div>`;
}
