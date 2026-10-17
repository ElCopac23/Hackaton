// Economics screens, shared by the farm home and the phone app.
import { esc, fmt, fmtEur, cropName, cropColor, badges, sum, mean } from './util.js';
import { icon } from './icons.js';
import {
  pnl, INPUT_LABELS, SCHEME_LABELS, cropPrice, scenario, subscription, farmEstimate, actionValue, hasAccounts,
} from './economics.js';
import { barChart } from './charts.js';

const delta = (v, avg) => {
  if (v == null || !avg) return '';
  const pct = ((v - avg) / Math.abs(avg)) * 100;
  return `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${fmt(Math.abs(pct), 0)}%</span>`;
};

// Horizontal bars as plain HTML: [{ label, value, color, note }].
export function hBars(items, { format = fmtEur } = {}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return `<div class="hbars">${items.map((i) => `
    <div class="hbar"><span class="hbar-l">${i.label}</span>
      <span class="hbar-t"><span style="width:${(Math.abs(i.value) / max) * 100}%;background:${i.color || 'var(--accent)'}"></span></span>
      <span class="hbar-v">${format(i.value)}</span></div>`).join('')}</div>`;
}

// Money chip on a recommendation card: what is at stake, or what it saves.
export function moneyChip(s, rec) {
  if (!hasAccounts(s)) return '';
  const v = actionValue(s, rec);
  if (!v) return '';
  const text = rec.kind === 'nitrogen' ? `save ${fmtEur(v.atStake)}/season` : `${fmtEur(v.atStake)} at stake`;
  return `<span class="money" tabindex="0" data-tip="${esc(v.how.join(' '))}">${icon('euro', 'money-ico')}${esc(text)}${v.cost ? ` · costs ${fmtEur(v.cost)}` : ''}</span>`;
}

export function kpiTiles(s) {
  const p = pnl(s);
  const y = p.last;
  const tiles = [
    ['Output', y.output, p.avg.output, 'Sales and stock change'],
    ['Costs', y.total_inputs, p.avg.inputs, 'All inputs, wages and depreciation'],
    ['CAP payments', y.subsidies_total, p.avg.subsidies, 'Direct payments and rural development'],
    ['Net value added', y.fnva, p.avg.fnva, 'Output − costs + CAP'],
  ];
  return `<div class="kpi-row">${tiles.map(([l, v, avg, tip], i) => `
    <div class="kpi-tile${i === 3 ? ' is-key' : ''}" data-tip="${esc(tip)}"><span class="kpi-l">${l} ${y.year}</span>
      <span class="kpi-v">${fmtEur(v)}</span><span class="kpi-d">${delta(v, avg)} <span>vs 10-yr avg</span></span></div>`).join('')}</div>`;
}

// Output, minus costs, plus CAP, equals net value added.
export function waterfall(s) {
  const y = pnl(s).last;
  const max = y.output + y.subsidies_total;
  const pct = (v) => `${(v / max) * 100}%`;
  const rows = [
    ['Output', 0, y.output, 'var(--accent)'],
    ['Costs', y.output - y.total_inputs, y.total_inputs, 'var(--crit)', '−'],
    ['CAP', y.output - y.total_inputs, y.subsidies_total, 'var(--gold)', '+'],
    ['Net value added', 0, y.fnva, 'var(--ink)'],
  ];
  return `<div class="wf">${rows.map(([l, from, v, c, sign = '']) => `
    <div class="wf-row"><span class="wf-l">${l}</span>
      <span class="wf-t"><span style="left:${pct(from)};width:${pct(v)};background:${c}"></span></span>
      <span class="wf-v">${sign}${fmtEur(v)}</span></div>`).join('')}</div>`;
}

export function costBars(s) {
  const y = pnl(s).last;
  const items = Object.entries(y.inputs).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: INPUT_LABELS[k] || k, value: v, color: 'var(--crit-2)' }));
  return hBars(items);
}

export function fnvaTrend(s) {
  const years = pnl(s).years;
  const values = years.map((y) => Math.round(y.fnva / 1000));
  return barChart({
    labels: years.map((y) => `'${String(y.year).slice(2)}`), values, unit: 'k€', digits: 0, height: 150,
    refValue: mean(values), refLabel: 'avg', color: 'var(--accent)',
  });
}

export function capList(s) {
  const y = pnl(s).last;
  return hBars(Object.entries(y.subsidies).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: SCHEME_LABELS[k] || k, value: v, color: 'var(--gold)' })));
}

export function salesList(s) {
  const year = pnl(s).last.year;
  const sales = s.farm.economics.sales.filter((x) => x.year === year);
  if (!sales.length) return '<p class="empty">No sales recorded this year.</p>';
  return `<div class="sales">${sales.map((x) => {
    const market = (s.farm.market_prices[x.product] || []).find(([m]) => m === x.date.slice(0, 7))?.[1];
    const diff = market ? ((x.price_eur_t - market) / market) * 100 : null;
    return `<div class="sale"><span class="crop-dot" style="background:${cropColor(x.product)}"></span>
      <span class="sale-main"><b>${esc(cropName(x.product))}</b><span class="muted">${fmt(x.volume_t, 0)} t · ${esc(x.contract.toLowerCase())}</span></span>
      <span class="sale-v"><b>${fmtEur(x.volume_t * x.price_eur_t)}</b><span class="muted">€${fmt(x.price_eur_t, 0)}/t${diff != null ? ` · ${diff >= 0 ? '+' : ''}${fmt(diff, 0)}% vs market` : ''}</span></span></div>`;
  }).join('')}</div>`;
}

export function actionsTable(s, adj) {
  const sc = scenario(s, adj);
  if (!sc.actions.length) return '<p class="empty">No advice with a euro value right now.</p>';
  return `<div class="actions">${sc.actions.map(({ rec, value: v }) => `
    <div class="act" tabindex="0" data-tip="${esc(v.how.join(' '))}">
      <div class="act-main"><b>${esc(rec.title)}</b><span class="muted small">${esc(v.how[0])}</span></div>
      <div class="act-num"><span class="muted small">Cost</span><b>${v.cost ? fmtEur(v.cost) : '–'}</b></div>
      <div class="act-num"><span class="muted small">${rec.kind === 'nitrogen' ? 'Saves' : 'At stake'}</span><b class="pos">${fmtEur(v.atStake)}</b></div>
      <div class="act-num"><span class="muted small">Return</span><b>${v.roi ? `×${fmt(v.roi, 1)}` : 'no cost'}</b></div>
    </div>`).join('')}</div>`;
}

export function scenarioOut(s, adj) {
  const sc = scenario(s, adj);
  const max = Math.max(sc.bau, sc.advice, 1);
  return `
    <div class="sc-bars">
      <div class="sc-bar"><span>Business as usual</span><span class="sc-t"><span style="width:${(Math.max(sc.bau, 0) / max) * 100}%" class="is-bau"></span></span><b>${fmtEur(sc.bau)}</b></div>
      <div class="sc-bar"><span>Follow the advice</span><span class="sc-t"><span style="width:${(Math.max(sc.advice, 0) / max) * 100}%"></span></span><b>${fmtEur(sc.advice)}</b></div>
    </div>
    <div class="sc-gain"><span class="sc-gain-v">${fmtEur(sc.gain, { sign: true })}</span><span>more margin this season by following the advice</span></div>
    <div class="sc-crops">${sc.margins.map((m) => `<div class="sc-crop"><span class="crop-dot" style="background:${cropColor(m.crop)}"></span>
      <span>${esc(cropName(m.crop))} <span class="muted">${fmt(m.area)} ha</span></span>
      <span class="muted small">${fmt(m.yield, 1)} t × €${fmt(m.price, 0)}</span><b>${fmtEur(m.marginHa)}/ha</b></div>`).join('')}</div>`;
}

export function scenarioCard(s, adj) {
  const slider = (key, label) => `<label class="slider"><span>${label} <b data-adj-out="${key}">${adj[key] >= 0 ? '+' : ''}${fmt(adj[key] * 100, 0)}%</b></span>
    <input type="range" min="-30" max="30" step="5" value="${Math.round(adj[key] * 100)}" data-adj="${key}" aria-label="${label}"></label>`;
  return `<div class="scenario">
    <div class="sliders">${slider('priceAdj', 'Crop prices')}${slider('yieldAdj', 'Yields')}</div>
    <div id="scenario-out">${scenarioOut(s, adj)}</div>
  </div>`;
}

export function roiBox(s, adj) {
  const sc = scenario(s, adj);
  return `<div class="roi">
    <div class="roi-main"><span class="roi-x">${sc.roi ? `×${fmt(sc.roi, 0)}` : '–'}</span><span>return on DemetrAg</span></div>
    <dl class="roi-dl"><dt>DemetrAg</dt><dd>${sc.sub.total ? `${fmtEur(sc.sub.total)}/yr` : esc(sc.sub.text)}</dd>
      <dt>Extra margin</dt><dd>${fmtEur(sc.gain)}</dd>
      <dt>Pays for itself</dt><dd>${sc.gain > 0 && sc.sub.total ? `with ${fmt(Math.max(1, (sc.sub.total / sc.gain) * 100), 0)}% of the gain` : '–'}</dd></dl>
    <p class="muted small">${esc(sc.sub.text)}</p>
  </div>`;
}

// Farms that gave only fields and crops: an estimate from similar farms and today's prices.
export function estimateCard(s) {
  const est = farmEstimate(s);
  const sub = subscription(s, s.farm.meta.area_ha);
  const b = s.farm.regional_benchmark;
  return `<div class="estimate">
    <div class="est-head"><span class="pill pill-est">Estimate</span>${badges(['benchmark', 'market'])}</div>
    <div class="kpi-row">
      <div class="kpi-tile"><span class="kpi-l">Crop sales</span><span class="kpi-v">${fmtEur(est.revenue)}</span></div>
      <div class="kpi-tile"><span class="kpi-l">Costs</span><span class="kpi-v">${fmtEur(est.cost)}</span></div>
      <div class="kpi-tile"><span class="kpi-l">CAP</span><span class="kpi-v">${fmtEur(est.cap)}</span></div>
      <div class="kpi-tile is-key"><span class="kpi-l">Margin</span><span class="kpi-v">${fmtEur(est.margin)}</span></div>
    </div>
    <div class="sc-crops">${est.margins.map((m) => `<div class="sc-crop"><span class="crop-dot" style="background:${cropColor(m.crop)}"></span>
      <span>${esc(cropName(m.crop))} <span class="muted">${fmt(m.area)} ha</span></span>
      <span class="muted small">${fmt(m.yield, 1)} t × €${fmt(m.price, 0)}</span><b>${fmtEur(m.marginHa)}/ha</b></div>`).join('')}</div>
    <p class="muted small">Yields and costs: median of ${b.farms} similar farms in ${esc(s.farm.meta.region_name)}. Prices: ${esc(cropPrice(s, est.margins[0]?.crop)?.month || '')}. DemetrAg: ${sub.total ? `${fmtEur(sub.total)}/yr` : esc(sub.text)}.</p>
  </div>`;
}

export function unlockCard(items) {
  return `<div class="unlock">${icon('sparkle', 'unlock-ico')}
    <div><b>Unlock your own figures</b><span class="muted small">${items.map(esc).join(' · ')}</span></div>
    <button class="btn primary" data-action="onboarding" data-step="optional">Add data</button></div>`;
}

export const totalAtStake = (s) => sum(scenario(s).actions.map((a) => a.value.atStake));
