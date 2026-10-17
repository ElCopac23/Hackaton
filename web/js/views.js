// HTML for every screen of the farm home. Pure functions of the state.
import {
  TYPE_LABELS, OP_LABELS, esc, fmt, fmtQty, fmtDate, fmtDay, fmtLongDate,
  badges, cropName, cropColor, weatherIcon, shortId, monthName, mean, sum, photoSrc, fmtEur, lowerFirst,
} from './util.js';
import { icon } from './icons.js';
import { noteInsights, notesFor, noteTopics, NOTE_TAGS, TOPICS, allNotes } from './notes.js';
import {
  today, year, parcel, parcelsOfCrop, areaOf, cropsOnFarm, parcelStatus, autumnJobs, workLeft, seasonSummary,
  product, productUsage, lastActivities, allEvents, ndviFor, farmNdvi, eventQty, stockTracked,
} from './model.js';
import {
  forecastDays, evaluateDay, workload, stockStatus, stockRecs, nitrogenRecs, timingRecs,
  watchOuts, goodDayFor, fieldNotes, todaysActions, matchesFilter,
} from './rules.js';
import { renderMap, STATUS_LEGEND, ndviColor, mapTools } from './map.js';
import { barChart, progressBar, stackedBar } from './charts.js';
import { hasAccounts, pnl } from './economics.js';
import {
  moneyChip, kpiTiles, waterfall, costBars, fnvaTrend, capList, salesList, actionsTable, scenarioCard, roiBox,
  estimateCard, unlockCard,
} from './econ-views.js';
import { isBasic, completeness } from './farms.js';

export { icon };

const KIND = { timing: 'Timing', stock: 'Stock', nitrogen: 'Nitrogen', note: 'Your note' };

export function cropChip(crop) {
  return `<span class="crop-chip"><i style="background:${cropColor(crop)}"></i>${esc(cropName(crop))}</span>`;
}

function dayChips(dates) {
  return dates.length ? `<div class="day-chips">${dates.map((d) => `<span class="day-chip">${esc(fmtDay(d))}</span>`).join('')}</div>` : '';
}

// Small (i) with the longer explanation on hover or tap.
export const tip = (text) => `<span class="tip" tabindex="0" role="img" aria-label="${esc(text)}" data-tip="${esc(text)}">${icon('info', 'tip-ico')}</span>`;

// A recommendation: title, the key line, good days and what it is worth. The rest folds away.
export function recCard(r, { index = null, compact = false, s = null } = {}) {
  const [first, ...rest] = r.lines;
  return `<article class="rec rec-${r.kind}${r.status ? ` rec-${r.status}` : ''}" data-rec="${esc(r.id)}">
    <header>
      ${index != null ? `<span class="rec-num">${index}</span>` : ''}
      <span class="kind kind-${r.kind}">${KIND[r.kind]}</span>
      ${r.crop ? cropChip(r.crop) : ''}
      ${badges(r.sources)}
    </header>
    <h4>${esc(r.title)}</h4>
    ${r.photo ? `<img class="rec-photo" src="${esc(photoSrc(r.photo))}" alt="Photo attached to the note" loading="lazy">` : ''}
    ${first ? `<p class="rec-line">${esc(first)}</p>` : ''}
    ${r.goodDays ? dayChips(r.goodDays) : ''}
    ${s ? moneyChip(s, r) : ''}
    ${rest.length && !compact ? `<details class="rec-more"><summary>Details</summary><ul class="rec-lines">${rest.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}
  </article>`;
}

// ---------- sidebar ----------

const NAV = [
  ['home', 'Home'], ['weather', 'Weather'], ['activities', 'Activities'], ['ndvi', 'NDVI'],
  ['recs', 'Advice'], ['inventory', 'Stock'], ['economics', 'Economics'], ['notes', 'Notes'],
];

function navStatus(s) {
  const d0 = forecastDays(s)[0];
  const w = weatherIcon(d0.weather_code);
  const left = workLeft(s).left;
  const top = todaysActions(s)[0];
  const alerts = stockStatus(s).filter((x) => x.status === 'low' || x.status === 'critical');
  const notes = allNotes(s);
  const photos = notes.filter((n) => n.photo).length;
  return {
    home: [`${s.farm.parcels.length} fields · ${fmt(s.farm.meta.area_ha)} ha`],
    weather: [`${w.icon} ${fmt(d0.tmax, 0)}° · ${w.text}`],
    activities: [isBasic(s) ? `${s.captured.length} logged` : `${fmt(left.sowing)} ha to sow`],
    ndvi: [`${fmt(farmNdvi(s), 2)} · simulated`],
    recs: [top ? top.title : 'Nothing urgent'],
    inventory: !stockTracked(s) ? ['Not tracked yet'] : [alerts.length ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''}` : 'Covers the plan', alerts.length ? 'alert' : ''],
    economics: [hasAccounts(s) ? `${fmtEur(pnl(s).last.fnva)} net value added` : 'Estimate'],
    notes: [`${notes.length} note${notes.length === 1 ? '' : 's'} · ${photos} photo${photos === 1 ? '' : 's'}`],
  };
}

function noteThumb(n) {
  return n.photo ? `<img src="${esc(photoSrc(n.photo))}" alt="" loading="lazy">` : `<span class="thumb-ico">${icon(n.source === 'simulated' ? 'notes' : 'note')}</span>`;
}

export function sidebar(s) {
  const status = navStatus(s);
  const latest = allNotes(s).slice(0, 3);
  return `<div class="nav-list">${NAV.map(([view, label]) => {
    const [line, flag] = status[view];
    return `<button class="nav${s.ui.view === view ? ' is-active' : ''}" data-view="${view}">
      <span class="nav-ico">${icon(view)}</span>
      <span class="nav-text"><b>${label}</b><span>${esc(line)}</span></span>${flag ? '<i class="nav-dot"></i>' : ''}</button>`;
  }).join('')}</div>
  <section class="feed" aria-label="Latest notes">
    <div class="feed-head"><b>Latest notes</b><button class="link-btn" data-view="notes">All</button></div>
    ${latest.length ? latest.map((n) => `<button class="feed-item" ${n.parcel ? `data-parcel="${n.parcel}"` : 'data-view="notes"'}>
      <span class="thumb">${noteThumb(n)}</span>
      <span class="feed-text"><span>${esc(n.text || 'Photo')}</span><span class="muted">${n.parcel ? esc(shortId(n.parcel)) : 'Farm'} · ${esc(fmtDate(n.date || today(s)))}</span></span></button>`).join('')
    : '<p class="muted small">No notes yet. Add one on a field or from the phone.</p>'}
  </section>`;
}

// ---------- shared pieces ----------

function viewHead(title, extra = '') {
  return `<section class="view-head"><h2>${esc(title)}</h2>${extra}</section>`;
}

export function profileCard(s) {
  const pct = completeness(s);
  const items = s.farm.meta.onboarding?.items || [];
  const missing = items.filter((i) => !i.done).map((i) => i.label);
  return `<div class="profile">
    <div class="ring" style="--p:${pct * 100}"><span>${fmt(pct * 100, 0)}%</span></div>
    <div class="profile-text"><b>Profile ${pct >= 1 ? 'complete' : `${fmt(pct * 100, 0)}% complete`}</b>
      <span class="muted small">${missing.length ? `Add ${missing.slice(0, 3).map((m) => lowerFirst(m)).join(', ')}${missing.length > 3 ? '…' : ''} for full advice and economics.` : 'Records, accounts, CAP data and stock are in.'}</span></div>
    ${missing.length ? '<button class="btn primary" data-action="onboarding" data-step="optional">Add data</button>' : ''}
  </div>`;
}

function workloadBox(s) {
  const wl = workload(s);
  if (!wl.machineDays) return '';
  const tight = wl.machineDays > wl.suitableDays;
  return `<div class="workload ${tight ? 'is-tight' : ''}">
    <div class="wl-nums"><span><b>${fmt(wl.machineDays)}</b> days of work</span><span><b>${wl.suitableDays}</b> good days${wl.until ? ` to ${fmtDate(wl.until)}` : ''}</span></div>
    <div class="workload-bar"><div style="width:${Math.min(100, (wl.suitableDays / Math.max(wl.machineDays, wl.suitableDays)) * 100)}%"></div></div>
    <div class="workload-note">${tight ? 'More work than good days: start with the job whose window closes first.' : 'The forecast leaves room for the planned work.'}</div>
  </div>`;
}

// ---------- home ----------

function autumnProgress(s) {
  const wl = workLeft(s);
  const rows = [['harvest', 'Harvest'], ['fertilisation', 'Base fertiliser'], ['sowing', 'Sowing'], ['spraying', 'Herbicide']];
  return `<div class="progress-grid">${rows.filter(([k]) => wl.total[k]).map(([k, l]) => {
    const done = wl.total[k] - wl.left[k];
    return `<div class="progress-item"><div class="progress-head"><span>${l}</span><span>${fmt(done)} / ${fmt(wl.total[k])} ha</span></div>${progressBar(done, wl.total[k])}</div>`;
  }).join('')}</div>`;
}

export function homeView(s) {
  const actions = todaysActions(s);
  const hasPlan = sum(Object.values(workLeft(s).total)) > 0;
  return `
  <section class="home-grid">
    <div class="card map-card">
      <div class="card-head">
        <div><h2>Your fields</h2><p class="sub">${s.farm.parcels.length} fields · ${fmt(s.farm.meta.area_ha)} ha</p></div>
        <div class="legend">${cropsOnFarm(s).map(cropChip).join('')}</div>
      </div>
      <div class="map-wrap">${renderMap(s, { selected: s.ui.parcel, flash: s.ui.flash, view: s.ui.mapView.crop })}${mapTools('crop')}</div>
      <div class="map-foot">
        <div class="legend status-legend">${(isBasic(s) ? [] : STATUS_LEGEND).map(([m, l]) => `<span><b>${m}</b> ${l}</span>`).join('')}</div>
        ${tip('Schematic layout from the dataset\'s local grid: not to scale, no real location.')}
      </div>
      ${hasPlan ? `<h3 class="section-title">Autumn work</h3>${autumnProgress(s)}` : ''}
    </div>
    <div class="card assistant-card">
      <div class="card-head"><div><h2>Today</h2><p class="sub">${esc(fmtLongDate(today(s)))}</p></div></div>
      ${isBasic(s) ? profileCard(s) : ''}
      ${workloadBox(s)}
      <div class="rec-list">${actions.map((r, i) => recCard(r, { index: i + 1, compact: true, s })).join('') || '<p class="empty">Nothing urgent today.</p>'}</div>
      <button class="link-btn" data-view="recs">All advice ${icon('right', 'ico-sm')}</button>
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
  ${viewHead('Weather', `<p class="sub">${esc(s.farm.meta.region_name)} ${badges(['forecast', 'regional'])}</p>`)}
  <section class="grid-2">
    <div class="card today-card">
      <div class="today-main"><span class="today-ico">${w0.icon}</span>
        <div><div class="today-temp">${fmt(d0.tmax, 0)}° <span>/ ${fmt(d0.tmin, 0)}°</span></div><div class="muted">${esc(w0.text)} · ${fmt(d0.precip_mm)} mm · ${fmt(d0.wind_max_kmh, 0)} km/h</div></div>
      </div>
      <h3 class="section-title">Good day for</h3>
      <div class="good-for">${goodDayFor(s).map((g) => `<div class="good ${g.ok ? 'ok' : 'no'}"><b>${icon(g.ok ? 'check' : 'close', 'ico-sm')} ${esc(OP_LABELS[g.op])}</b>${g.ok ? '' : `<small>${esc(g.reasons.join(', '))}</small>`}</div>`).join('')}</div>
    </div>
    <div class="card">
      <h3>Watch out</h3>
      <ul class="watch">${watchOuts(s).map((x) => `<li>${esc(x.text)} ${badges(x.sources)}</li>`).join('')}</ul>
    </div>
  </section>
  <section class="card">
    <div class="card-head"><h3>Next ${days.length} days</h3>${tip(`Snapshot fetched ${f.fetched_at.replace('T', ' ')} · ${f.source}`)}</div>
    <div class="forecast-row">${days.map((d) => {
      const wi = weatherIcon(d.weather_code);
      return `<div class="fday${d.precip_mm >= 5 ? ' is-wet' : ''}"><div class="fday-name">${esc(fmtDay(d.date))}</div><div class="fday-ico" title="${esc(wi.text)}">${wi.icon}</div>
        <div class="fday-t">${fmt(d.tmax, 0)}° <span>${fmt(d.tmin, 0)}°</span></div>
        <div class="fday-r">${fmt(d.precip_mm)} mm</div><div class="fday-w">${fmt(d.wind_max_kmh, 0)} km/h</div></div>`;
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
      <div class="card-head"><h3>Dry days, 17 Oct–15 Nov</h3>${tip(`Days with less than 1 mm rain in the last 10 autumns. Orange: ${s.assumptions.wet_autumn_dry_days} dry days or fewer.`)}</div>
      ${barChart({ labels: hist.map((y) => String(y.year)), values: hist.map((y) => y.dry_days), highlight: wetIdx, unit: 'dry days', digits: 0 })}
    </div>
    <div class="card">
      <div class="card-head"><h3>${s.weather.season_monthly.year} rain so far</h3>${tip('Monthly rain (mm) in the region, synthetic monthly series from the dataset.')}</div>
      ${barChart({ labels: season.map((m) => monthName(m.month)), values: season.map((m) => m.precip_mm), unit: 'mm', digits: 0, color: 'var(--info)' })}
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

export function eventSummary(s, e) {
  if (e.type === 'sowing') return `${e.variety || (e.productId ? product(s, e.productId).name : '')}${e.rate != null ? ` · ${fmt(e.rate, 0)} kg/ha` : ''}`;
  if (e.type === 'fertilisation') return `${e.productId ? `${product(s, e.productId).name} · ${fmt(e.rate, 0)} kg/ha · ` : ''}${fmt(e.n, 0)} kg N/ha`;
  if (e.type === 'spraying') return `${e.productId ? product(s, e.productId).name : e.product} · ${fmt(e.rate, 2)} ${e.productId ? `${product(s, e.productId).unit}/ha` : 'L or kg/ha'}`;
  if (e.type === 'harvest') return e.status === 'planned' ? 'planned' : `${fmt(e.yield_t_ha, 2)} t/ha`;
  return '';
}

function activityLog(s) {
  const filter = s.ui.activityFilter;
  const seasonSel = s.ui.activitySeason;
  const evs = allEvents(s).filter((e) => e.campaign === seasonSel && (filter === 'all' || e.type === filter))
    .sort((a, b) => b.date.localeCompare(a.date));
  const seasons = [s.assumptions.autumn_plan.season, year(s), year(s) - 1, year(s) - 2];
  return `<section class="card">
    <div class="card-head"><h3>Log</h3>
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
      }).join('')}</tbody></table></div>` : `<p class="empty">Nothing logged for this season yet. Use <b>Log activity</b> to add work.</p>`}
  </section>`;
}

export function activitiesView(s) {
  const tab = s.ui.actTab || 'log';
  const wl = workLeft(s);
  const jobs = autumnJobs(s);
  const sum26 = seasonSummary(s, year(s));
  const hasPlan = sum(Object.values(wl.total)) > 0;
  const tabs = `<div class="seg" role="tablist">${[['log', 'Log'], ['timeline', 'Timeline']].map(([k, l]) => `<button class="seg-btn${tab === k ? ' is-on' : ''}" data-act-tab="${k}">${l}</button>`).join('')}</div>`;
  const summary = hasPlan ? `<section class="grid-2">
    <div class="card">
      <div class="card-head"><h3>Autumn work left</h3>${badges(['simulated'])}</div>
      ${[['harvest', 'Harvest'], ['fertilisation', 'Base fertiliser'], ['sowing', 'Sowing'], ['spraying', 'Herbicide']].map(([k, l]) => {
        const done = wl.total[k] - wl.left[k];
        const leftFields = jobs.filter((j) => j.type === k).flatMap((j) => j.remaining);
        return `<div class="progress-item"><div class="progress-head"><span>${l}</span><span><b>${fmt(wl.left[k])} ha left</b> of ${fmt(wl.total[k])}</span></div>${progressBar(done, wl.total[k])}
          <div class="muted small">${leftFields.length ? leftFields.map(shortId).join(', ') : 'All done ✓'}</div></div>`;
      }).join('')}
    </div>
    <div class="card">
      <div class="card-head"><h3>${year(s)} season</h3>${badges(['records'])}</div>
      <div class="kpis">
        <div class="kpi"><span class="kpi-v">${fmt(sum26.sowing.area)} ha</span><span class="kpi-l">sown</span></div>
        <div class="kpi"><span class="kpi-v">${fmt(sum26.fertilisation.nKg / 1000, 1)} t N</span><span class="kpi-l">${sum26.fertilisation.count} fertiliser passes</span></div>
        <div class="kpi"><span class="kpi-v">${sum26.spraying.count}</span><span class="kpi-l">spray passes</span></div>
        <div class="kpi"><span class="kpi-v">${fmt(sum26.harvest.tonnes, 0)} t</span><span class="kpi-l">harvested</span></div>
      </div>
    </div>
  </section>` : (isBasic(s) ? `<section class="card">${profileCard(s)}</section>` : '');
  return `
  ${viewHead('Activities', tabs)}
  ${tab === 'timeline' ? timeline(s) : `${summary}${activityLog(s)}`}`;
}

// ---------- NDVI (design only, simulated) ----------

export function ndviView(s) {
  const comment = {
    standing: 'Maize drying down before harvest.',
    'to-sow': 'Bare stubble: low index is normal.',
    prepared: 'Seedbed prepared: bare soil.',
    sown: 'Just sown: emergence in 1–3 weeks.',
    fallow: 'Stubble until spring.',
    basic: '',
  };
  const avg = farmNdvi(s);
  return `
  ${viewHead('NDVI', `<p class="sub"><span class="pill pill-sim">Simulated</span> ${tip('The dataset has no satellite signal and the fields have no real location, so these values are illustrative. Roadmap: Sentinel-2 once real field boundaries are imported.')}</p>`)}
  <section class="home-grid">
    <div class="card map-card">
      <div class="card-head"><div><h2>Farm index <span style="color:${ndviColor(avg)}">${fmt(avg, 2)}</span></h2></div>
        <div class="ndvi-scale"><span>0.1</span><div></div><span>0.6+</span></div></div>
      <div class="map-wrap">${renderMap(s, { mode: 'ndvi', selected: s.ui.parcel, view: s.ui.mapView.ndvi })}${mapTools('ndvi')}</div>
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
          ${comment[st.code] ? `<span class="muted small">${esc(comment[st.code])}</span>` : ''}</button>`;
      }).join('')}</div>
    </div>
  </section>`;
}

// ---------- timeline (last activities) ----------

function timeline(s) {
  const groups = [];
  for (const it of lastActivities(s, 24)) {
    const g = groups[groups.length - 1];
    if (g && g.date === it.date) g.items.push(it); else groups.push({ date: it.date, items: [it] });
  }
  const row = (it) => {
    if (it.kind === 'note') {
      return `<div class="tl-item"${it.parcel ? ` data-parcel="${it.parcel}"` : ''}><span class="tl-ico">${icon('notes')}</span>
        <div class="tl-body"><b>${esc(it.noteKind)}${it.parcel ? ` · ${esc(shortId(it.parcel))}` : ''}</b><span>${esc(it.text || 'Photo')}</span></div>
        ${it.photo ? `<img class="tl-photo" src="${esc(photoSrc(it.photo))}" alt="" loading="lazy">` : ''}${badges([it.source === 'captured' ? 'note' : it.source])}</div>`;
    }
    const p = parcel(s, it.parcel);
    return `<div class="tl-item" data-parcel="${it.parcel}"><span class="tl-ico tl-${it.type}">${icon(it.type)}</span>
      <div class="tl-body"><b>${esc(TYPE_LABELS[it.type])} · ${esc(shortId(it.parcel))} ${cropChip(p.crop)}</b><span>${esc(eventSummary(s, it))} · ${fmt(p.area_ha)} ha</span></div>${badges([it.source])}</div>`;
  };
  return groups.length ? `<section class="card timeline">${groups.map((g) => `
    <div class="tl-day"><div class="tl-date">${esc(fmtLongDate(g.date))}</div>${g.items.map(row).join('')}</div>`).join('')}
  </section>` : '<section class="card"><p class="empty">Nothing yet. Logged work and notes appear here.</p></section>';
}

// ---------- recommendations ----------

const CATEGORIES = [['all', 'All'], ['timing', 'Timing'], ['warning', 'Warnings'], ['alert', 'Alerts']];
const STOCK_STATUS_WORD = { critical: 'critical', low: 'low', ok: 'covers plan', none: 'no planned use' };

function filterBar(s, f, shown, total) {
  const season = s.assumptions.autumn_plan.season;
  const select = (key, label, options) => `<label class="rf"><span>${esc(label)}</span><select data-rf="${key}">${options.map(([v, l]) => (
    `<option value="${esc(v)}" ${String(f[key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`)).join('')}</select></label>`;
  const active = Object.values(f).filter((v) => v !== 'all').length;
  return `<section class="card filter-bar">
    <div class="rf-head">
      <div class="chips rf-cats" role="group" aria-label="Kind of advice">${CATEGORIES.map(([v, l]) => (
        `<button class="chip${f.category === v ? ' is-on' : ''}" data-rf-cat="${v}">${l}</button>`)).join('')}</div>
      <span class="muted small"><b>${shown}</b> of ${total}${active ? ` · ${active} filter${active > 1 ? 's' : ''}` : ''}</span>
    </div>
    <div class="rf-row">
      ${select('crop', 'Crop', [['all', 'All crops'], ...cropsOnFarm(s).map((c) => [c, cropName(c)])])}
      ${select('op', 'Work', [['all', 'All work'], ...Object.entries(OP_LABELS)])}
      ${select('season', 'Season', [['all', 'All seasons'], [String(year(s)), `${year(s)}`], [String(season), `${season} (autumn work)`]])}
      ${stockTracked(s) ? select('product', 'Stock', [['all', 'All products'], ...stockStatus(s).map((x) => [x.prod.id, `${x.prod.name} · ${STOCK_STATUS_WORD[x.status]}`])]) : ''}
      ${select('parcel', 'Field', [['all', 'All fields'], ...s.farm.parcels.map((p) => [p.id, `${shortId(p.id)} · ${cropName(p.crop)}`])])}
      <button class="btn ghost" data-action="rf-clear" ${active ? '' : 'disabled'}>Clear</button>
    </div>
  </section>`;
}

export function recsView(s) {
  const f = s.ui.recFilter;
  const all = { timing: timingRecs(s), notes: noteInsights(s), stock: stockRecs(s), nitrogen: nitrogenRecs(s), watch: watchOuts(s) };
  const shown = Object.fromEntries(Object.entries(all).map(([k, list]) => [k, list.filter((r) => matchesFilter(r, f))]));
  const total = sum(Object.values(all).map((l) => l.length));
  const count = sum(Object.values(shown).map((l) => l.length));
  const fieldFilterOnly = f.category === 'all' && f.op === 'all' && f.product === 'all' && f.season === 'all';
  const fields = fieldFilterOnly ? s.farm.parcels.filter((p) => (f.crop === 'all' || p.crop === f.crop) && (f.parcel === 'all' || p.id === f.parcel)) : [];

  const timingCard = shown.timing.length ? `
  <section class="card">
    <div class="card-head"><h3>Timing</h3></div>
    ${workloadBox(s)}
    <div class="rec-grid">${shown.timing.map((r) => recCard(r, { index: all.timing.indexOf(r) + 1, s })).join('')}</div>
  </section>` : '';
  const notesCard = shown.notes.length ? `
  <section class="card">
    <div class="card-head"><h3>From your notes</h3></div>
    <div class="rec-grid">${shown.notes.map((r) => recCard(r, { s })).join('')}</div>
  </section>` : '';
  const stockCard = shown.stock.length ? `<div class="card">
      <h3>Stock</h3>
      <div class="rec-list">${shown.stock.map((r) => recCard(r, { s })).join('')}</div>
      <button class="link-btn" data-view="inventory">Open stock ${icon('right', 'ico-sm')}</button>
    </div>` : '';
  const nitrogenCard = shown.nitrogen.length ? `<div class="card">
      <h3>Nitrogen vs your history and the region</h3>
      <div class="rec-list">${shown.nitrogen.map((r) => recCard(r, { s })).join('')}</div>
    </div>` : '';
  const pair = stockCard && nitrogenCard ? `<section class="grid-2">${stockCard}${nitrogenCard}</section>` : (stockCard || nitrogenCard);
  const watchCard = shown.watch.length ? `
  <section class="card">
    <h3>Weather warnings</h3>
    <ul class="watch">${shown.watch.map((x) => `<li>${esc(x.text)} ${badges(x.sources)}</li>`).join('')}</ul>
  </section>` : '';
  const fieldsCard = fields.length ? `
  <section class="card">
    <h3>By field</h3>
    <div class="field-grid">${fields.map((p) => {
      const st = parcelStatus(s, p);
      const notes = fieldNotes(s, p).slice(0, 2);
      return `<button class="field-card" data-parcel="${p.id}">
        <span class="fc-head"><b>${esc(shortId(p.id))}</b>${cropChip(p.crop)}<span class="muted">${fmt(p.area_ha)} ha</span></span>
        <span class="fc-status">${esc(st.label)}</span>
        ${notes.map((n) => `<span class="fc-note">${esc(n.text)}</span>`).join('')}
      </button>`;
    }).join('')}</div>
  </section>` : '';

  return `
  ${viewHead('Advice', `<p class="sub">Rule-based: every figure shows its source ${tip('Rules of thumb set by the team, to be confirmed by an adviser. A language model is on the roadmap.')}</p>`)}
  ${isBasic(s) ? `<section class="card">${profileCard(s)}</section>` : ''}
  ${filterBar(s, f, count, total)}
  ${count || fields.length ? `${timingCard}${notesCard}${pair}${watchCard}${fieldsCard}` : '<section class="card"><p class="empty">No advice matches these filters. <button class="link-btn" data-action="rf-clear">Clear filters</button></p></section>'}`;
}

// ---------- inventory ----------

const STATUS_TEXT = { ok: 'Covers plan', low: 'Low', critical: 'Critical', none: 'No planned use' };

export function inventoryView(s) {
  if (!stockTracked(s)) {
    return `${viewHead('Stock')}
    <section class="card empty-state">${icon('inventory', 'empty-ico')}<h3>Stock is not tracked yet</h3>
      <p class="muted">Add what is in the shed and DemetrAg warns you before a job runs short. Logged work already records the products used.</p>
      <button class="btn primary" data-action="onboarding" data-step="optional">Add stock</button></section>`;
  }
  const rows = stockStatus(s);
  const alerts = rows.filter((r) => r.status === 'low' || r.status === 'critical');
  return `
  ${viewHead('Stock', `<p class="sub">${badges(['simulated', 'records', 'captured'])} ${tip('Opening stock is simulated (set by the team). Usage comes from the farm records and from work logged in this app. Fuel is not tracked: the dataset only holds annual energy costs.')}</p>`)}
  ${alerts.length ? `<div class="rec-grid">${stockRecs(s).map((r) => recCard(r, { s })).join('')}</div>` : ''}
  <section class="card">
    <div class="table-scroll"><table class="inv">
      <thead><tr><th>Product</th><th class="num">In stock</th><th>Plan needs</th><th>Status</th><th class="num">Used ${year(s)}</th><th class="num">Logged</th><th>Last used</th></tr></thead>
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
          <td class="num">${u.recordsHaveNoProduct ? '<span class="muted small">N-P-K only</span>' : esc(fmtQty(u.usedSeason, unit))}</td>
          <td class="num">${u.usedCaptured ? esc(fmtQty(u.usedCaptured, unit)) : '–'}</td>
          <td class="small">${u.last ? `${esc(fmtDate(u.last.date, true))} · ${esc(shortId(u.last.parcel))}` : '–'}</td></tr>`;
      }).join('')}</tbody></table></div>
  </section>`;
}

// ---------- economics ----------

export function economicsView(s) {
  const adj = s.ui.econ;
  if (!hasAccounts(s)) {
    return `
    ${viewHead('Economics', `<p class="sub">What ${fmt(s.farm.meta.area_ha)} ha of these crops typically earn</p>`)}
    <section class="card">${estimateCard(s)}</section>
    <section class="card">${unlockCard(['Your accounts and CAP payments', 'Cost and return of each piece of advice', 'Season scenario and DemetrAg return'])}</section>`;
  }
  const p = pnl(s);
  return `
  ${viewHead('Economics', `<p class="sub">${p.last.year} accounts and the euro value of today's advice ${badges(['accounts', 'market', 'rule'])}</p>`)}
  ${kpiTiles(s)}
  <section class="grid-2">
    <div class="card"><div class="card-head"><h3>Where the money goes, ${p.last.year}</h3></div>${waterfall(s)}<h3 class="section-title">Costs</h3>${costBars(s)}</div>
    <div class="card"><div class="card-head"><h3>Net value added, 10 seasons (k€)</h3></div>${fnvaTrend(s)}
      <div class="grid-2 tight"><div><h3 class="section-title">CAP ${p.last.year}</h3>${capList(s)}</div><div><h3 class="section-title">Sales ${p.last.year}</h3>${salesList(s)}</div></div></div>
  </section>
  <section class="card">
    <div class="card-head"><h3>Advice in euros</h3>${tip('Cost: extra money to follow the advice. At stake: money lost if it is not followed. Prices, yields and unit costs from the dataset; loss rates are rules of thumb in assumptions.json.')}</div>
    <div id="actions-out">${actionsTable(s, adj)}</div>
  </section>
  <section class="grid-2 wide-left">
    <div class="card"><div class="card-head"><h3>${s.assumptions.autumn_plan.season} season scenario</h3>${tip('Business as usual: jobs slip to the next window, problems stay untreated, nitrogen stays at the 10-season average. Margin = crop sales − costs + CAP. Move the sliders to test prices and yields.')}</div>${scenarioCard(s, adj)}</div>
    <div class="card"><div class="card-head"><h3>Return on DemetrAg</h3></div><div id="roi-out">${roiBox(s, adj)}</div></div>
  </section>`;
}

// ---------- notes ----------

export function noteCard(s, n) {
  const topics = noteTopics(n).map((x) => `<span class="topic">${esc(x.label)}</span>`).join('');
  const p = n.parcel ? parcel(s, n.parcel) : null;
  return `<article class="ncard${n.photo ? ' has-photo' : ''}"${n.parcel ? ` data-parcel="${n.parcel}"` : ''}>
    ${n.photo ? `<img src="${esc(photoSrc(n.photo))}" alt="Photo from the field" loading="lazy">` : ''}
    <div class="ncard-body">
      <div class="ncard-meta">${p ? `<b>${esc(shortId(p.id))}</b> ${cropChip(p.crop)}` : '<b>Whole farm</b>'}<span class="muted">${esc(fmtDate(n.date || today(s)))}</span></div>
      ${n.text ? `<p>${esc(n.text)}</p>` : ''}
      <div class="ncard-foot">${topics}<span class="muted small">${n.source === 'simulated' ? `${esc(n.kind)} · simulated` : `${esc(n.kind)}${n.channel === 'voice' ? ' · voice' : ''}`}</span></div>
    </div>
  </article>`;
}

export function notesView(s) {
  const f = s.ui.noteFilter;
  const notes = allNotes(s).filter((n) => (f.kind !== 'photos' || n.photo)
    && (f.field === 'all' || (f.field === 'farm' ? !n.parcel : n.parcel === f.field))
    && (f.topic === 'all' || noteTopics(n).some((t) => t.key === f.topic)));
  const chip = (key, value, label) => `<button class="chip${f[key] === value ? ' is-on' : ''}" data-nf="${key}" data-value="${value}">${label}</button>`;
  return `
  ${viewHead('Notes', `<p class="sub">Annotations and photos from the field ${badges(['note'])}</p>`)}
  <section class="notes-layout">
    <div class="notes-main">
      <div class="card filter-bar">
        <div class="chips">${chip('kind', 'all', 'All')}${chip('kind', 'photos', 'With photo')}
          ${TOPICS.map((t) => chip('topic', t.key, t.label)).join('')}${f.topic !== 'all' ? chip('topic', 'all', 'Any topic') : ''}</div>
        <label class="rf"><span>Field</span><select data-nf-field>
          <option value="all">All fields</option><option value="farm" ${f.field === 'farm' ? 'selected' : ''}>Whole farm</option>
          ${s.farm.parcels.map((p) => `<option value="${p.id}" ${f.field === p.id ? 'selected' : ''}>${esc(shortId(p.id))} · ${esc(cropName(p.crop))}</option>`).join('')}
        </select></label>
      </div>
      <div class="ngrid">${notes.map((n) => noteCard(s, n)).join('') || '<p class="empty">No notes match.</p>'}</div>
    </div>
    <aside class="card notes-side"><h3>New note</h3>${noteForm('farm', 'What did you see?', s)}</aside>
  </section>`;
}

// ---------- field drawer ----------

export function fieldDrawer(s) {
  const p = parcel(s, s.ui.parcel);
  if (!p) return '';
  const st = parcelStatus(s, p);
  const evs = allEvents(s).filter((e) => e.parcel === p.id);
  const hist = s.farm.history[p.crop];
  const years = hist ? Object.keys(hist.yield_by_year).map(Number) : [];
  const yields = years.map((y) => evs.find((e) => e.type === 'harvest' && e.campaign === y && e.status === 'done')?.yield_t_ha ?? null);
  const nByYear = years.map((y) => {
    const list = evs.filter((e) => e.type === 'fertilisation' && e.campaign === y);
    return list.length ? sum(list.map((e) => e.n || 0)) : null;
  });
  const ref = s.farm.regional[p.crop]?.n_kg_ha;
  const timelineRows = evs.filter((e) => e.campaign >= year(s)).sort((a, b) => b.date.localeCompare(a.date));
  const soil = p.soil;
  const fw = p.field_weather?.[String(year(s))];
  const irr = p.irrigation?.[String(year(s))];
  const soilRows = soil ? [
    ['pH', fmt(soil.ph_h2o)], ['Organic matter', `${fmt(soil.organic_matter_pct)}%`], ['Nitrogen', `${fmt(soil.nitrogen_g_kg, 2)} g/kg`],
    ['Phosphorus', `${fmt(soil.phosphorus_mg_kg, 0)} mg/kg`], ['Potassium', `${fmt(soil.potassium_mg_kg, 0)} mg/kg`], ['CEC', `${fmt(soil.cec_cmol_kg)} cmol/kg`],
    ['Sand / silt / clay', `${fmt(soil.sand_pct, 0)} / ${fmt(soil.silt_pct, 0)} / ${fmt(soil.clay_pct, 0)}%`], ['Lime requirement', `${fmt(soil.lime_requirement_t_ha)} t/ha`],
  ] : [];
  const notes = notesFor(s, p.id);
  return `
  <div class="drawer-head">
    <div><div class="drawer-title">${esc(shortId(p.id))} ${cropChip(p.crop)}</div>
      <div class="sub">${fmt(p.area_ha)} ha · ${esc(p.tenure.toLowerCase())}${p.crop_previous ? ` · after ${esc(cropName(p.crop_previous).toLowerCase())}` : ''}</div></div>
    <button class="icon-btn" data-action="close-drawer" aria-label="Close">${icon('close')}</button>
  </div>
  <div class="drawer-body">
    <div class="status-box status-${st.code}"><b>${esc(st.label)}</b><span>${esc(st.detail)}</span></div>
    <h4>What to watch</h4>
    <ul class="watch">${fieldNotes(s, p).map((n) => `<li>${esc(n.text)} ${badges(n.sources)}</li>`).join('') || '<li class="muted">Nothing to flag.</li>'}</ul>
    <h4>Notes and photos ${notes.length ? `<span class="count">${notes.length}</span>` : ''}</h4>
    <div class="note-list">${notes.map(noteItem).join('')}</div>
    ${noteForm(p.id, `What did you see on ${shortId(p.id)}?`)}
    ${hist ? `<h4>Yield (t/ha) ${badges(['records'])}</h4>
    ${barChart({ labels: years.map((y) => `'${String(y).slice(2)}`), values: yields, color: cropColor(p.crop), height: 130, unit: 't/ha', refValue: mean(yields), refLabel: 'avg' })}
    <h4>Nitrogen (kg N/ha) ${badges(['records', 'regional'])}</h4>
    ${barChart({ labels: years.map((y) => `'${String(y).slice(2)}`), values: nByYear, color: 'var(--info)', height: 130, unit: 'kg N/ha', refValue: ref, refLabel: 'regional ref.', digits: 0 })}`
    : `<div class="unlock small-unlock">${icon('sparkle', 'unlock-ico')}<div><b>No history for this field yet</b><span class="muted small">Add last season's records to see yields, nitrogen and soil.</span></div><button class="btn ghost" data-action="onboarding" data-step="optional">Add records</button></div>`}
    ${soil ? `<h4>Soil ${badges(['records'])}</h4>
    <dl class="soil">${soilRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    ${fw ? `<h4>${year(s)} water and warmth ${badges(['records'])}</h4>
      <dl class="soil"><dt>Rain</dt><dd>${fmt(fw.precip_mm, 0)} mm</dd><dt>Irrigation</dt><dd>${irr?.irrigated ? `${fmt(irr.water_mm, 0)} mm` : 'none'}</dd>
      <dt>Crop water demand (ET₀)</dt><dd>${fmt(fw.et0_mm, 0)} mm</dd><dt>Growing degree days</dt><dd>${fmt(fw.gdd_annual, 0)} (base 10 °C)</dd></dl>` : ''}
    ${timelineRows.length ? `<h4>Timeline</h4>
    <div class="mini-tl">${timelineRows.map((e) => `<div class="mini-tl-row${e.status === 'planned' ? ' is-planned' : ''}${e.source === 'captured' ? ' is-captured' : ''}">
      <span class="mini-date">${esc(fmtDate(e.date))}</span><span>${esc(TYPE_LABELS[e.type])}${e.status === 'planned' ? ' (planned)' : ''}</span><span class="muted">${esc(eventSummary(s, e))}</span></div>`).join('')}</div>` : ''}
  </div>`;
}

// ---------- notes and photos (shared with the phone app) ----------

export function noteItem(n) {
  const topics = noteTopics(n).map((x) => `<span class="topic">${esc(x.label)}</span>`).join('');
  const when = n.date ? fmtDate(n.date) : '';
  const who = n.device === 'phone' ? 'phone' : 'farm home';
  return `<div class="note-item">
    ${n.photo ? `<a href="${esc(photoSrc(n.photo))}" target="_blank" rel="noopener"><img src="${esc(photoSrc(n.photo))}" alt="Field photo" loading="lazy"></a>` : ''}
    <div class="note-body"><div class="note-meta">${esc(when)} · ${esc(who)}${n.channel === 'voice' ? ' · voice' : ''}</div>
      ${n.text ? `<div class="note-text">${esc(n.text)}</div>` : ''}
      ${topics ? `<div class="note-topics">${topics}</div>` : ''}</div>
  </div>`;
}

// With s, the form also lets the farmer pick the field.
export function noteForm(target, placeholder, s = null) {
  return `<form class="note-form" data-note-form="${esc(target)}">
    ${s ? `<select name="where" aria-label="Field"><option value="farm">Whole farm</option>${s.farm.parcels.map((p) => `<option value="${p.id}">${esc(shortId(p.id))} · ${esc(cropName(p.crop))}</option>`).join('')}</select>` : ''}
    <textarea name="text" rows="2" placeholder="${esc(placeholder)}"></textarea>
    <div class="note-tags">${NOTE_TAGS.map((t) => `<label class="tag-pick"><input type="checkbox" name="tags" value="${esc(t)}"><span>${esc(t)}</span></label>`).join('')}</div>
    <div class="note-actions">
      <label class="btn ghost file-btn">${icon('camera', 'ico-sm')} Photo<input type="file" name="photo" accept="image/*" hidden></label>
      <span class="photo-name muted small"></span>
      <button class="btn primary" type="submit">Save note</button>
    </div>
  </form>`;
}

// ---------- top bar menus ----------

export function farmMenu(s, index) {
  return `<div class="menu-head"><b>Farms</b></div>
  ${index.farms.map((f) => `<button class="farm-opt${f.id === s.farm.meta.holding_id ? ' is-on' : ''}" data-farm="${f.id}">
    <span class="farm-opt-main"><b>${esc(f.id)}</b><span class="muted small">${esc(f.region_name)} · ${fmt(f.area_ha)} ha · ${f.parcels} fields</span></span>
    <span class="farm-opt-p"><span class="mini-bar"><span style="width:${f.completeness * 100}%"></span></span><span class="muted small">${f.level === 'basic' ? 'Onboarded · fields and crops' : 'Full records'}</span></span>
  </button>`).join('')}
  <button class="menu-item" data-action="onboarding">${icon('plus', 'ico-sm')} Add a farm</button>`;
}

export function sourcesSheet() {
  const rows = [
    ['records', 'Farm records', 'EU Agri Hackathon synthetic dataset. Not a real farm, do not redistribute.'],
    ['accounts', 'Farm accounts', 'Synthetic economics, CAP payment, sales and indicator tables.'],
    ['market', 'Market prices', 'Synthetic monthly crop prices (dataset).'],
    ['benchmark', 'Similar farms', 'Median of synthetic arable farms in the same region (dataset).'],
    ['regional', 'Regional reference', 'AgERA5 weather (Copernicus licence) and NPKGRIDS nitrogen (CC BY 4.0), via the dataset.'],
    ['forecast', 'Forecast', 'Open-Meteo (CC BY 4.0), snapshot.'],
    ['simulated', 'Simulated', 'Opening stock, autumn plan, field annotations and NDVI, set by the team.'],
    ['rule', 'Rules of thumb', 'Weather thresholds, work rates and euro loss rates: to be confirmed by an adviser.'],
    ['note', 'Your notes', 'Notes and photos stay on the sync server on this Mac.'],
  ];
  return `<div class="sheet-head"><b>Data sources</b><button class="icon-btn" data-action="sources" aria-label="Close">${icon('close')}</button></div>
  <div class="sources">${rows.map(([k, l, t]) => `<div class="source-row">${badges([k])}<div><b>${l}</b><span class="muted small">${t}</span></div></div>`).join('')}</div>
  <p class="muted small">Advice is rule-based. The onboarding agent is simulated.</p>`;
}
