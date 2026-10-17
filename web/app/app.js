// DemetrAg phone app: same farms, data and rules as the farm home, focused on what the farmer
// does in the field: check today's job, record work by voice or text, add notes and photos,
// and see what the farm earns. Changes go to the sync server and appear on the farm home live.
import {
  esc, fmt, fmtQty, fmtDate, fmtDay, fmtLongDate, cropName, cropColor, shortId, weatherIcon, assets, OP_LABELS, TYPE_LABELS,
  badges, photoSrc,
} from '../js/util.js';
import { icon } from '../js/icons.js';
import {
  today, parcel, parcelStatus, workLeft, lastActivities, allEvents, year, stockTracked,
} from '../js/model.js';
import {
  forecastDays, goodDayFor, todaysActions, timingRecs, stockRecs, nitrogenRecs, watchOuts, fieldNotes, stockStatus, workload,
} from '../js/rules.js';
import { noteInsights, notesFor, NOTE_TAGS, allNotes } from '../js/notes.js';
import { recCard, noteItem, noteCard, profileCard, farmMenu, sourcesSheet } from '../js/views.js';
import { renderMap } from '../js/map.js';
import { barChart, progressBar } from '../js/charts.js';
import { createCapture } from '../js/capture.js';
import { createOnboarding } from '../js/onboarding.js';
import { connectSync, resizePhoto } from '../js/sync.js';
import {
  listFarms, savedFarm, rememberFarm, loadFarm, sharedFor, completeness, isBasic,
} from '../js/farms.js';
import { hasAccounts } from '../js/economics.js';
import {
  kpiTiles, waterfall, actionsTable, scenarioCard, scenarioOut, roiBox, estimateCard, unlockCard, moneyChip,
} from '../js/econ-views.js';
import { setupTooltips } from '../js/tooltip.js';

assets.base = '../';
const CLIENT = Math.random().toString(36).slice(2, 10);
const app = { state: null, device: 'phone', commit };
const freshUi = () => ({
  tab: 'today', field: null, noteTarget: 'farm', lastNoteId: null, photo: null, composing: false, noteKind: 'all',
  farmTab: 'money', econ: { priceAdj: 0, yieldAdj: 0 },
});
let ui = freshUi();
let sync = null;
let capture = null;
let farmIndex = null;

const $ = (sel) => document.querySelector(sel);
const farmId = () => app.state.farm.meta.holding_id;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('is-on'), 3200);
}

function setLive(status) {
  const el = $('#live');
  el.className = `live live-${status}`;
  el.textContent = { live: 'Live', reconnecting: '…', local: 'Offline' }[status];
}

function applyShared(next) {
  Object.assign(app.state, sharedFor(next, farmId()));
}

async function commit({ events, adjust, message }) {
  try {
    applyShared(await sync.addRecords(events.map((e) => ({ ...e, farm: farmId(), device: 'phone', client: CLIENT })), adjust));
    toast(`${message} Sent to the farm home.`);
    render();
  } catch (err) {
    toast(`Not saved: ${err.message}`);
  }
}

// ---------- tabs ----------

function todayView(s) {
  const days = forecastDays(s);
  const d0 = days[0];
  const w = weatherIcon(d0.weather_code);
  const wl = workload(s);
  const [top, ...rest] = todaysActions(s);
  const all = [...timingRecs(s), ...noteInsights(s), ...stockRecs(s), ...nitrogenRecs(s)];
  return `
  <section class="m-card m-weather-card">
    <div class="m-weather"><span class="ico">${w.icon}</span>
      <div><div class="m-temp">${fmt(d0.tmax, 0)}° <span>/ ${fmt(d0.tmin, 0)}°</span></div>
      <p class="m-sub">${esc(w.text)} · ${fmt(d0.precip_mm)} mm · ${fmt(d0.wind_max_kmh, 0)} km/h</p></div></div>
    <div class="m-good">${goodDayFor(s).map((g) => `<span class="${g.ok ? 'ok' : 'no'}">${icon(g.ok ? 'check' : 'close', 'ico-xs')} ${esc(OP_LABELS[g.op])}</span>`).join('')}</div>
    <div class="m-days">${days.slice(1, 6).map((d) => `<div class="${d.precip_mm >= 5 ? 'wet' : ''}">${esc(fmtDay(d.date))}<b>${weatherIcon(d.weather_code).icon}</b>${fmt(d.tmax, 0)}° · ${fmt(d.precip_mm, 0)} mm</div>`).join('')}</div>
  </section>
  ${isBasic(s) ? `<section class="m-card">${profileCard(s)}</section>` : ''}
  ${top ? `<section class="m-hero">
    <span class="m-hero-label">Next job</span>
    <h2>${esc(top.title)}</h2>
    ${top.lines[0] ? `<p>${esc(top.lines[0])}</p>` : ''}
    ${top.goodDays?.length ? `<div class="day-chips">${top.goodDays.map((d) => `<span class="day-chip">${esc(fmtDay(d))}</span>`).join('')}</div>` : ''}
    ${moneyChip(s, top)}
  </section>` : ''}
  ${wl.machineDays ? `<div class="workload ${wl.machineDays > wl.suitableDays ? 'is-tight' : ''}"><div class="wl-nums"><span><b>${fmt(wl.machineDays)}</b> days of work</span><span><b>${wl.suitableDays}</b> good days</span></div></div>` : ''}
  ${rest.length ? `<h2 class="m-h">Also today</h2>${rest.map((r, i) => recCard(r, { index: i + 2, compact: true, s })).join('')}` : ''}
  <details class="m-more m-card"><summary>All advice (${all.length})</summary>
    ${all.map((r) => recCard(r, { compact: true, s })).join('')}
    <ul class="watch" style="margin-top:10px">${watchOuts(s).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>
  </details>`;
}

function fieldsView(s) {
  if (ui.field) return fieldDetail(s, parcel(s, ui.field));
  return `
  <div class="m-map">${renderMap(s, {})}</div>
  <div class="m-list">${s.farm.parcels.map((p) => {
    const st = parcelStatus(s, p);
    const n = notesFor(s, p.id).length;
    return `<button class="m-field" data-field="${p.id}">
      <span><b>${esc(shortId(p.id))}</b> <span class="crop-chip"><i style="background:${cropColor(p.crop)}"></i>${esc(cropName(p.crop))}</span></span>
      <span class="chev">${icon('right')}</span>
      <span class="muted">${fmt(p.area_ha)} ha · ${esc(st.label)}${n ? ` · ${n} note${n > 1 ? 's' : ''}` : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

function fieldDetail(s, p) {
  const st = parcelStatus(s, p);
  const hist = s.farm.history[p.crop];
  const years = hist ? Object.keys(hist.yield_by_year).map(Number) : [];
  const yields = years.map((y) => allEvents(s).find((e) => e.parcel === p.id && e.type === 'harvest' && e.campaign === y && e.status === 'done')?.yield_t_ha ?? null);
  const timeline = allEvents(s).filter((e) => e.parcel === p.id && e.campaign >= year(s)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const soil = p.soil;
  const watch = fieldNotes(s, p);
  return `
  <button class="m-back" data-back>${icon('left', 'ico-sm')} Fields</button>
  <div class="m-detail-title">${esc(shortId(p.id))} <span class="crop-chip"><i style="background:${cropColor(p.crop)}"></i>${esc(cropName(p.crop))}</span></div>
  <p class="m-sub">${fmt(p.area_ha)} ha · ${esc(st.label)}</p>
  <button class="btn primary m-wide" data-note-for="${p.id}">${icon('camera', 'ico-sm')} Note or photo</button>
  ${watch.length ? `<section class="m-card"><h3>What to watch</h3><ul class="watch">${watch.map((n) => `<li>${esc(n.text)} ${badges(n.sources)}</li>`).join('')}</ul></section>` : ''}
  ${notesFor(s, p.id).length ? `<section class="m-card"><h3>Notes and photos</h3><div class="note-list">${notesFor(s, p.id).map(noteItem).join('')}</div></section>` : ''}
  ${timeline.length ? `<section class="m-card"><h3>Latest work</h3>
    <div class="mini-tl">${timeline.map((e) => `<div class="mini-tl-row${e.status === 'planned' ? ' is-planned' : ''}${e.source === 'captured' ? ' is-captured' : ''}"><span class="mini-date">${esc(fmtDate(e.date))}</span><span>${esc(TYPE_LABELS[e.type])}${e.status === 'planned' ? ' (planned)' : ''}</span><span class="muted">${e.source === 'captured' ? (e.device === 'phone' ? 'phone' : 'farm home') : 'records'}</span></div>`).join('')}</div>
  </section>` : ''}
  ${hist ? `<section class="m-card"><h3>Yield (t/ha)</h3>
    ${barChart({ labels: years.map((y) => `'${String(y).slice(2)}`), values: yields, color: cropColor(p.crop), height: 140, unit: 't/ha' })}</section>` : `<section class="m-card">${unlockCard(["Last season's records for yields and nitrogen"])}</section>`}
  ${soil ? `<section class="m-card"><h3>Soil</h3><div class="m-kv">
    <div>pH<b>${fmt(soil.ph_h2o)}</b></div><div>Organic matter<b>${fmt(soil.organic_matter_pct)}%</b></div>
    <div>Phosphorus<b>${fmt(soil.phosphorus_mg_kg, 0)} mg/kg</b></div><div>Potassium<b>${fmt(soil.potassium_mg_kg, 0)} mg/kg</b></div>
  </div></section>` : ''}`;
}

function composeForm(s) {
  return `<form class="note-form" id="m-note-form">
    <label class="m-label">Where<select name="target">
      <option value="farm" ${ui.noteTarget === 'farm' ? 'selected' : ''}>Whole farm</option>
      ${s.farm.parcels.map((p) => `<option value="${p.id}" ${ui.noteTarget === p.id ? 'selected' : ''}>${esc(shortId(p.id))} · ${esc(cropName(p.crop))}</option>`).join('')}
    </select></label>
    ${ui.photo ? `<img class="m-preview" src="${ui.photo}" alt="Photo to attach">` : ''}
    <textarea name="text" rows="3" placeholder="What did you see? Tap the keyboard's microphone to dictate."></textarea>
    <div class="note-tags">${NOTE_TAGS.map((t) => `<label class="tag-pick"><input type="checkbox" name="tags" value="${esc(t)}"><span>${esc(t)}</span></label>`).join('')}</div>
    <div class="note-actions">
      <label class="btn ghost file-btn">${icon('camera', 'ico-sm')} ${ui.photo ? 'Change' : 'Photo'}<input type="file" name="photo" accept="image/*" hidden></label>
      ${ui.photo ? '<button type="button" class="btn ghost" data-clear-photo>Remove</button>' : ''}
      <button class="btn primary" type="submit">Save</button>
    </div>
  </form>`;
}

function notesView(s) {
  const insights = ui.lastNoteId ? noteInsights(s).filter((r) => r.noteId === ui.lastNoteId) : [];
  const last = ui.lastNoteId ? (s.notes || []).find((n) => n.id === ui.lastNoteId) : null;
  const notes = allNotes(s).filter((n) => ui.noteKind !== 'photos' || n.photo);
  return `
  <div class="m-row"><h2 class="m-h">Notes</h2>
    <button class="btn ${ui.composing ? 'ghost' : 'primary'}" data-compose>${ui.composing ? 'Cancel' : `${icon('plus', 'ico-sm')} New`}</button></div>
  ${ui.composing ? composeForm(s) : ''}
  ${last ? `<section class="m-card m-result"><h3>What the assistant took from your note</h3>
    ${insights.length ? `<ul>${insights.map((r) => `<li><b>${esc(r.title)}</b>: ${esc(r.lines.slice(1).join(' '))}</li>`).join('')}</ul>`
    : '<p class="m-sub">No problem recognised. Saved in the field history.</p>'}</section>` : ''}
  <div class="seg m-seg">${[['all', 'All'], ['photos', 'Photos']].map(([k, l]) => `<button class="seg-btn${ui.noteKind === k ? ' is-on' : ''}" data-note-kind="${k}">${l}</button>`).join('')}</div>
  <div class="ngrid m-ngrid">${notes.map((n) => noteCard(s, n)).join('') || '<p class="m-sub">No notes yet. Tap New to add one.</p>'}</div>`;
}

function moneyView(s) {
  if (!hasAccounts(s)) {
    return `<section class="m-card">${estimateCard(s)}</section>
      <section class="m-card">${unlockCard(['Your accounts and CAP payments', 'Euro value of each piece of advice', 'Season scenario'])}</section>`;
  }
  return `${kpiTiles(s)}
    <section class="m-card"><h3>Where the money goes</h3>${waterfall(s)}</section>
    <section class="m-card"><h3>Advice in euros</h3><div id="actions-out">${actionsTable(s, ui.econ)}</div></section>
    <section class="m-card"><h3>${s.assumptions.autumn_plan.season} season</h3>${scenarioCard(s, ui.econ)}</section>
    <section class="m-card"><h3>Return on DemetrAg</h3><div id="roi-out">${roiBox(s, ui.econ)}</div></section>`;
}

function stockView(s) {
  const words = { ok: 'Covers plan', low: 'Low', critical: 'Critical', none: 'No planned use' };
  const acts = lastActivities(s, 12);
  const stock = stockTracked(s) ? `${stockRecs(s).map((r) => recCard(r, { compact: true, s })).join('')}
  <div class="m-list">${stockStatus(s).map((x) => `<div class="m-stock">
    <span><b>${esc(x.prod.name)}</b></span><span class="lvl">${esc(fmtQty(x.level, x.prod.unit))}</span>
    <span class="muted">${esc(x.prod.type.toLowerCase())}${x.total ? ` · plan needs ${esc(fmtQty(x.total, x.prod.unit))}` : ''}</span>
    <span class="status status-${x.status}">${words[x.status]}</span></div>`).join('')}</div>`
    : `<section class="m-card">${unlockCard(['Stock in the shed, so jobs never run short'])}</section>`;
  return `${stock}
  <h2 class="m-h">Last activities</h2>
  <div class="m-list">${acts.map((a) => {
    if (a.kind === 'note') {
      return `<div class="m-act"><span class="tl-ico">${icon('notes')}</span><div class="grow"><b>${esc(a.noteKind)}${a.parcel ? ` · ${esc(shortId(a.parcel))}` : ''}</b><div class="muted">${esc(fmtDate(a.date))} · ${esc(a.text || 'Photo')}</div></div>${a.photo ? `<img class="tl-photo" src="${esc(photoSrc(a.photo))}" alt="">` : ''}</div>`;
    }
    return `<div class="m-act"><span class="tl-ico tl-${a.type}">${icon(a.type)}</span><div class="grow"><b>${esc(TYPE_LABELS[a.type])} · ${esc(shortId(a.parcel))}</b><div class="muted">${esc(fmtDate(a.date))} · ${esc(cropName(parcel(s, a.parcel).crop))}${a.source === 'captured' ? ` · ${a.device === 'phone' ? 'phone' : 'farm home'}` : ''}</div></div></div>`;
  }).join('') || '<p class="m-sub">Nothing yet.</p>'}</div>`;
}

function profileView(s) {
  const m = s.farm.meta;
  const items = m.onboarding?.items || [];
  return `<section class="m-card">${profileCard(s)}
    <div class="checklist">${items.map((i) => `<div class="check-row ${i.done ? 'done' : ''}">${icon(i.done ? 'check' : 'plus', 'ico-sm')}<span>${esc(i.label)}</span></div>`).join('')}</div></section>
  <section class="m-card"><div class="m-kv">
    <div>Farm<b>${esc(m.holding_id)}</b></div><div>Region<b>${esc(m.region_name)}</b></div>
    <div>Area<b>${fmt(m.area_ha)} ha</b></div><div>Fields<b>${m.parcels}</b></div></div>
    <button class="btn ghost m-wide" data-farms style="margin-top:10px">Switch farm</button></section>
  <section class="m-card">${sourcesSheet().replace(/<div class="sheet-head">[\s\S]*?<\/div>/, '<h3>Data sources</h3>')}</section>`;
}

function farmView(s) {
  const tabs = [['money', 'Money'], ['stock', 'Stock'], ['profile', 'Profile']];
  const body = { money: moneyView, stock: stockView, profile: profileView }[ui.farmTab](s);
  return `<div class="seg m-seg m-seg-wide">${tabs.map(([k, l]) => `<button class="seg-btn${ui.farmTab === k ? ' is-on' : ''}" data-farm-tab="${k}">${l}</button>`).join('')}</div>${body}`;
}

const VIEWS = { today: todayView, fields: fieldsView, notes: notesView, farm: farmView };

function header() {
  const m = app.state.farm.meta;
  $('#m-farm-btn').innerHTML = `<span class="m-name">${esc(m.holding_id)}</span><span class="m-farm">${esc(m.region_name)} · ${fmt(m.area_ha)} ha ${icon('down', 'ico-xs')}</span>`;
}

function render() {
  const s = app.state;
  header();
  document.querySelectorAll('.m-tabs button').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === ui.tab));
  const recording = ui.tab === 'record';
  $('#m-record').hidden = !recording;
  $('#m-main').hidden = recording;
  if (recording) return;
  // Keep a note being typed when a live update arrives.
  if (ui.tab === 'notes' && document.activeElement?.closest?.('#m-note-form')) return;
  $('#m-main').innerHTML = VIEWS[ui.tab](s);
}

function go(tab) {
  ui.tab = tab;
  if (tab !== 'fields') ui.field = null;
  render();
  window.scrollTo(0, 0);
}

async function saveNote(form) {
  const s = app.state;
  const text = form.text.value.trim();
  const tags = [...form.querySelectorAll('input[name="tags"]:checked')].map((x) => x.value);
  if (!text && !ui.photo) { toast('Write or dictate something, or add a photo.'); return; }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const before = new Set((s.notes || []).map((n) => n.id));
    applyShared(await sync.addNote({
      farm: farmId(), target: form.target.value, date: today(s), text, tags, photo: ui.photo, device: 'phone', channel: 'text', client: CLIENT,
    }));
    ui.lastNoteId = (s.notes || []).find((n) => !before.has(n.id))?.id || null;
    ui.photo = null;
    ui.composing = false;
    toast('Note saved and sent to the farm home.');
    document.activeElement?.blur();
    render();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Save';
    toast(`Not saved: ${err.message}`);
  }
}

function openSheet(html) {
  $('#m-sheet').innerHTML = `<div class="m-sheet-box">${html}</div>`;
  $('#m-sheet').hidden = false;
}

async function switchFarm(id) {
  $('#m-sheet').hidden = true;
  if (id === farmId()) return;
  try {
    const state = await loadFarm(id, '../');
    state.ui = { flash: [] };
    app.state = state;
    rememberFarm(id);
    applyShared(sync.current());
    const tab = ui.tab === 'record' ? 'today' : ui.tab;
    ui = { ...freshUi(), tab };
    capture.open(); // starts a fresh conversation for the new farm
    render();
    toast(`Showing ${id}.`);
  } catch (err) {
    toast(`Could not open ${id}: ${err.message}`);
  }
}

function onSlider(el) {
  const s = app.state;
  ui.econ[el.dataset.adj] = Number(el.value) / 100;
  const v = ui.econ[el.dataset.adj];
  document.querySelector(`[data-adj-out="${el.dataset.adj}"]`).textContent = `${v >= 0 ? '+' : ''}${fmt(v * 100, 0)}%`;
  $('#scenario-out').innerHTML = scenarioOut(s, ui.econ);
  $('#roi-out').innerHTML = roiBox(s, ui.econ);
  $('#actions-out').innerHTML = actionsTable(s, ui.econ);
}

async function start() {
  farmIndex = await listFarms('../');
  const state = await loadFarm(savedFarm(farmIndex), '../');
  state.ui = { flash: [] };
  app.state = state;
  sync = await connectSync({
    base: '../',
    onStatus: setLive,
    onChange: (next) => {
      const mine = sharedFor(next, farmId());
      const fresh = mine.captured.length + mine.notes.length > app.state.captured.length + app.state.notes.length;
      applyShared(next);
      render();
      if (fresh) toast('Updated from the farm home.');
    },
  });
  applyShared(sync.state);
  capture = createCapture(app, { root: $('#record-root'), embedded: true });
  capture.open();
  const onboarding = createOnboarding({
    root: $('#m-onboarding'),
    toast,
    sheet: true,
    currentFarm: () => app.state.farm,
    loadDemoFarm: async () => (await loadFarm('FARM-00268', '../')).farm,
    onOpenFarm: (id) => { ui.tab = 'today'; if (id === farmId()) render(); else switchFarm(id); },
  });
  setupTooltips();

  document.addEventListener('click', (ev) => {
    if (ev.target.id === 'm-sheet') { ev.target.hidden = true; return; }
    if (ev.target.closest('#m-sheet [data-action]')) $('#m-sheet').hidden = true;
    const t = ev.target.closest('[data-tab],[data-field],[data-parcel],[data-back],[data-note-for],[data-clear-photo],[data-compose],[data-note-kind],[data-farm-tab],[data-farms],[data-farm],[data-action]');
    if (!t || t.closest('#record-root') || t.closest('#m-onboarding')) return;
    if (t.dataset.tab) go(t.dataset.tab);
    else if (t.dataset.action === 'onboarding') onboarding.open(t.dataset.step);
    else if (t.hasAttribute('data-farms') || t.dataset.action === 'farms') openSheet(farmMenu(app.state, farmIndex));
    else if (t.dataset.farm) switchFarm(t.dataset.farm);
    else if (t.dataset.farmTab) { ui.farmTab = t.dataset.farmTab; render(); }
    else if (t.dataset.noteKind) { ui.noteKind = t.dataset.noteKind; render(); }
    else if (t.hasAttribute('data-compose')) { ui.composing = !ui.composing; ui.lastNoteId = null; render(); }
    else if (t.dataset.field || t.dataset.parcel) { ui.tab = 'fields'; ui.field = t.dataset.field || t.dataset.parcel; render(); window.scrollTo(0, 0); }
    else if (t.hasAttribute('data-back')) { ui.field = null; render(); }
    else if (t.dataset.noteFor) { ui.noteTarget = t.dataset.noteFor; ui.lastNoteId = null; ui.composing = true; go('notes'); }
    else if (t.hasAttribute('data-clear-photo')) { ui.photo = null; render(); }
  });
  document.addEventListener('input', (ev) => { if (ev.target.dataset?.adj) onSlider(ev.target); });
  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.name === 'target' && el.closest('#m-note-form')) ui.noteTarget = el.value;
    if (el.name === 'photo' && el.closest('#m-note-form') && el.files[0]) {
      try {
        const form = el.closest('form');
        const keep = { text: form.text.value, tags: [...form.querySelectorAll('input[name="tags"]:checked')].map((x) => x.value) };
        ui.photo = await resizePhoto(el.files[0]);
        document.activeElement?.blur();
        render();
        const again = $('#m-note-form');
        again.text.value = keep.text;
        again.querySelectorAll('input[name="tags"]').forEach((x) => { x.checked = keep.tags.includes(x.value); });
      } catch (err) {
        toast(err.message);
      }
    }
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'm-note-form') { ev.preventDefault(); saveNote(ev.target); }
  });
  render();
}

start().catch((err) => {
  $('#m-main').innerHTML = `<section class="m-card"><h3>Could not open the farm</h3><p class="m-sub">${esc(err.message)}</p></section>`;
  console.error(err);
});
