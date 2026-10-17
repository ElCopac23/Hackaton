// DemetrAg phone app: same farm, data and rules as the farm home, focused on recording
// work by voice or text and adding notes and photos per field. Changes go to the sync
// server and appear on the farm home in real time.
import {
  esc, fmt, fmtQty, fmtDate, fmtDay, fmtLongDate, cropName, cropColor, shortId, weatherIcon, assets, OP_LABELS, TYPE_LABELS,
  badges, photoSrc,
} from '../js/util.js';
import {
  today, parcel, parcelStatus, workLeft, lastActivities, cropsOnFarm, allEvents, year,
} from '../js/model.js';
import {
  forecastDays, goodDayFor, todaysActions, timingRecs, stockRecs, nitrogenRecs, watchOuts, fieldNotes, stockStatus, workload,
} from '../js/rules.js';
import { noteInsights, notesFor, NOTE_TAGS } from '../js/notes.js';
import { recCard, noteItem } from '../js/views.js';
import { renderMap } from '../js/map.js';
import { barChart, progressBar } from '../js/charts.js';
import { createCapture } from '../js/capture.js';
import { connectSync, resizePhoto } from '../js/sync.js';

assets.base = '../';
const CLIENT = Math.random().toString(36).slice(2, 10);
const app = { state: null, device: 'phone', commit };
const ui = { tab: 'today', field: null, noteTarget: 'farm', lastNoteId: null, photo: null };
let sync = null;
let capture = null;

const $ = (sel) => document.querySelector(sel);

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
  el.textContent = { live: 'Live', reconnecting: 'Reconnecting…', local: 'Offline' }[status];
}

function applyShared(next) {
  const s = app.state;
  s.captured = next.captured || [];
  s.stockAdjust = next.stockAdjust || {};
  s.notes = next.notes || [];
}

async function commit({ events, adjust, message }) {
  try {
    applyShared(await sync.addRecords(events.map((e) => ({ ...e, device: 'phone', client: CLIENT })), adjust));
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
  const left = workLeft(s);
  const all = [...timingRecs(s), ...noteInsights(s), ...stockRecs(s), ...nitrogenRecs(s)];
  return `
  <section class="m-card">
    <div class="m-weather"><span class="ico">${w.icon}</span>
      <div><div class="m-temp">${fmt(d0.tmax, 0)}° <span>/ ${fmt(d0.tmin, 0)}°</span></div>
      <p class="m-sub">${esc(fmtLongDate(today(s)))} · ${esc(w.text)} · rain ${fmt(d0.precip_mm)} mm · wind ${fmt(d0.wind_max_kmh, 0)} km/h</p></div></div>
    <div class="m-good">${goodDayFor(s).map((g) => `<span class="${g.ok ? 'ok' : 'no'}">${g.ok ? '✓' : '✗'} ${esc(OP_LABELS[g.op])}</span>`).join('')}</div>
    <div class="m-days">${days.slice(1, 6).map((d) => `<div class="${d.precip_mm >= 5 ? 'wet' : ''}">${esc(fmtDay(d.date))}<b>${weatherIcon(d.weather_code).icon}</b>${fmt(d.tmax, 0)}°<br>${fmt(d.precip_mm, 0)} mm</div>`).join('')}</div>
  </section>
  <h2 class="m-h">Assistant · today</h2>
  <div class="workload ${wl.machineDays > wl.suitableDays ? 'is-tight' : ''}"><strong>${fmt(wl.machineDays)} days of field work</strong> left, <strong>${wl.suitableDays} suitable days</strong>${wl.until ? ` until ${fmtDate(wl.until)}` : ''}.</div>
  ${todaysActions(s).map((r, i) => recCard(r, { index: i + 1, compact: true })).join('')}
  <h2 class="m-h">Autumn work</h2>
  <section class="m-card">${[['harvest', 'Harvest'], ['fertilisation', 'Base fertiliser'], ['sowing', 'Sowing'], ['spraying', 'Herbicide']].map(([k, l]) => (
    `<div class="progress-item"><div class="progress-head"><span>${l}</span><span>${fmt(left.total[k] - left.left[k])} / ${fmt(left.total[k])} ha</span></div>${progressBar(left.total[k] - left.left[k], left.total[k])}</div>`)).join('')}</section>
  <details class="m-more m-card"><summary>All advice (${all.length})</summary>
    ${all.map((r) => recCard(r, { compact: true })).join('')}
    <ul class="watch" style="margin-top:10px">${watchOuts(s).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>
  </details>
  <p class="m-foot">Synthetic farm data · rule-based advice · same data as the farm home</p>`;
}

function fieldsView(s) {
  if (ui.field) return fieldDetail(s, parcel(s, ui.field));
  return `
  <div class="m-map">${renderMap(s, {})}</div>
  <p class="m-sub">Tap a field for details, notes and photos.</p>
  <div class="m-list">${s.farm.parcels.map((p) => {
    const st = parcelStatus(s, p);
    const n = notesFor(s, p.id).length;
    return `<button class="m-field" data-field="${p.id}">
      <span><b>${esc(shortId(p.id))}</b> <span class="crop-chip"><i style="background:${cropColor(p.crop)}"></i>${esc(cropName(p.crop))}</span></span>
      <span class="chev">›</span>
      <span class="muted">${fmt(p.area_ha)} ha · ${esc(st.label)}${n ? ` · 📝 ${n}` : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

function fieldDetail(s, p) {
  const st = parcelStatus(s, p);
  const years = Object.keys(s.farm.history[p.crop].yield_by_year).map(Number);
  const yields = years.map((y) => allEvents(s).find((e) => e.parcel === p.id && e.type === 'harvest' && e.campaign === y && e.status === 'done')?.yield_t_ha ?? null);
  const timeline = allEvents(s).filter((e) => e.parcel === p.id && e.campaign >= year(s)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const soil = p.soil || {};
  return `
  <button class="m-back" data-back>‹ Fields</button>
  <div class="m-detail-title">${esc(shortId(p.id))} <span class="crop-chip"><i style="background:${cropColor(p.crop)}"></i>${esc(cropName(p.crop))}</span></div>
  <p class="m-sub">${fmt(p.area_ha)} ha · ${esc(p.tenure.toLowerCase())} · ${esc(st.label)} · ${esc(st.detail)}</p>
  <section class="m-card"><h3>What to watch</h3><ul class="watch">${fieldNotes(s, p).map((n) => `<li>${esc(n.text)} ${badges(n.sources)}</li>`).join('')}</ul></section>
  <section class="m-card"><h3>Notes and photos</h3>
    <div class="note-list">${notesFor(s, p.id).map(noteItem).join('') || '<p class="m-sub">No notes yet.</p>'}</div>
    <button class="btn primary" style="margin-top:10px;width:100%" data-note-for="${p.id}">📝 Add a note or photo</button>
  </section>
  <section class="m-card"><h3>Latest operations</h3>
    <div class="mini-tl">${timeline.map((e) => `<div class="mini-tl-row${e.status === 'planned' ? ' is-planned' : ''}${e.source === 'captured' ? ' is-captured' : ''}"><span class="mini-date">${esc(fmtDate(e.date))}</span><span>${esc(TYPE_LABELS[e.type])}${e.status === 'planned' ? ' (planned)' : ''}</span><span class="muted">${e.source === 'captured' ? (e.device === 'phone' ? 'phone' : 'farm home') : 'records'}</span></div>`).join('')}</div>
  </section>
  <section class="m-card"><h3>Yield, last ${years.length} seasons (t/ha)</h3>
    ${barChart({ labels: years.map((y) => `'${String(y).slice(2)}`), values: yields, color: cropColor(p.crop), height: 140, unit: 't/ha' })}</section>
  <section class="m-card"><h3>Soil</h3><div class="m-kv">
    <div>pH<b>${fmt(soil.ph_h2o)}</b></div><div>Organic matter<b>${fmt(soil.organic_matter_pct)}%</b></div>
    <div>Phosphorus<b>${fmt(soil.phosphorus_mg_kg, 0)} mg/kg</b></div><div>Potassium<b>${fmt(soil.potassium_mg_kg, 0)} mg/kg</b></div>
  </div></section>`;
}

function notesView(s) {
  const insights = ui.lastNoteId ? noteInsights(s).filter((r) => r.noteId === ui.lastNoteId) : [];
  const last = ui.lastNoteId ? (s.notes || []).find((n) => n.id === ui.lastNoteId) : null;
  const recent = [...(s.notes || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 12);
  return `
  <h2 class="m-h">Note or photo</h2>
  <p class="m-sub">For one field or the whole farm. The assistant reads it and updates its advice on the phone and the farm home.</p>
  <form class="note-form" id="m-note-form">
    <label class="m-label">Where<select name="target">
      <option value="farm" ${ui.noteTarget === 'farm' ? 'selected' : ''}>Whole farm</option>
      ${s.farm.parcels.map((p) => `<option value="${p.id}" ${ui.noteTarget === p.id ? 'selected' : ''}>${esc(shortId(p.id))} · ${esc(cropName(p.crop))}</option>`).join('')}
    </select></label>
    <textarea name="text" rows="4" placeholder="What did you see? To dictate, tap here and then the microphone key on the keyboard."></textarea>
    <div class="m-label">Tags (optional)</div>
    <div class="note-tags">${NOTE_TAGS.map((t) => `<label class="tag-pick"><input type="checkbox" name="tags" value="${esc(t)}"><span>${esc(t)}</span></label>`).join('')}</div>
    ${ui.photo ? `<img class="m-preview" src="${ui.photo}" alt="Photo to attach">` : ''}
    <div class="note-actions">
      <label class="btn ghost file-btn">📷 ${ui.photo ? 'Change photo' : 'Add photo'}<input type="file" name="photo" accept="image/*" hidden></label>
      ${ui.photo ? '<button type="button" class="btn ghost" data-clear-photo>Remove</button>' : ''}
      <button class="btn primary" type="submit">Save note</button>
    </div>
  </form>
  ${last ? `<section class="m-card m-result"><h3>What the assistant took from your note</h3>
    ${insights.length ? `<ul>${insights.map((r) => `<li><b>${esc(r.title)}</b>: ${esc(r.lines.slice(1).join(' '))}</li>`).join('')}</ul>`
    : '<p class="m-sub">No problem recognised. It is saved in the field history and shown on the farm home.</p>'}</section>` : ''}
  <h2 class="m-h">Recent notes</h2>
  <div class="note-list">${recent.map((n) => `<div><div class="m-sub">${n.target === 'farm' ? 'Whole farm' : esc(shortId(n.target))}</div>${noteItem(n)}</div>`).join('') || '<p class="m-sub">No notes yet.</p>'}</div>`;
}

function stockView(s) {
  const words = { ok: 'Covers plan', low: 'Low', critical: 'Critical', none: 'No planned use' };
  const acts = lastActivities(s, 12);
  return `
  <h2 class="m-h">Stock</h2>
  ${stockRecs(s).map((r) => recCard(r, { compact: true })).join('')}
  <div class="m-list">${stockStatus(s).map((x) => `<div class="m-stock">
    <span><b>${esc(x.prod.name)}</b></span><span class="lvl">${esc(fmtQty(x.level, x.prod.unit))}</span>
    <span class="muted">${esc(x.prod.type.toLowerCase())}${x.total ? ` · plan needs ${esc(fmtQty(x.total, x.prod.unit))}` : ''}</span>
    <span class="status status-${x.status}">${words[x.status]}</span></div>`).join('')}</div>
  <h2 class="m-h">Last activities</h2>
  <div class="m-list">${acts.map((a) => {
    if (a.kind === 'note') {
      return `<div class="m-act"><span class="tl-ico">📝</span><div class="grow"><b>${esc(a.noteKind)}${a.parcel ? ` · ${esc(shortId(a.parcel))}` : ''}</b><div class="muted">${esc(fmtDate(a.date))} · ${esc(a.text || 'Photo')}</div></div>${a.photo ? `<img class="tl-photo" src="${esc(photoSrc(a.photo))}" alt="">` : ''}</div>`;
    }
    return `<div class="m-act"><span class="tl-ico">${{ sowing: '🌱', fertilisation: '🧪', spraying: '💧', harvest: '🌾' }[a.type]}</span><div class="grow"><b>${esc(TYPE_LABELS[a.type])} · ${esc(shortId(a.parcel))}</b><div class="muted">${esc(fmtDate(a.date))} · ${esc(cropName(parcel(s, a.parcel).crop))}${a.source === 'captured' ? ` · logged on ${a.device === 'phone' ? 'phone' : 'farm home'}` : ''}</div></div></div>`;
  }).join('')}</div>`;
}

const VIEWS = { today: todayView, fields: fieldsView, notes: notesView, stock: stockView };

function render() {
  const s = app.state;
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
      target: form.target.value, date: today(s), text, tags, photo: ui.photo, device: 'phone', channel: 'text', client: CLIENT,
    }));
    ui.lastNoteId = (s.notes || []).find((n) => !before.has(n.id))?.id || null;
    ui.photo = null;
    toast('Note saved and sent to the farm home.');
    document.activeElement?.blur();
    render();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Save note';
    toast(`Not saved: ${err.message}`);
  }
}

async function start() {
  const load = async (name) => {
    const res = await fetch(`../data/${name}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 403 ? 'Open the app with the link from the farm home (it contains the access key).' : `Farm data missing (${res.status}).`);
    return res.json();
  };
  const [farm, weather, stock, assumptions] = await Promise.all(['farm', 'weather', 'stock', 'assumptions'].map(load));
  app.state = { farm, weather, stock, assumptions, captured: [], stockAdjust: {}, notes: [], ui: { flash: [] } };
  $('#m-farm').textContent = `${farm.meta.holding_id} · ${farm.meta.region_name} · ${fmt(farm.meta.area_ha)} ha`;
  sync = await connectSync({
    base: '../',
    onStatus: setLive,
    onChange: (next) => {
      const fresh = (next.captured || []).length + (next.notes || []).length > app.state.captured.length + app.state.notes.length;
      applyShared(next);
      render();
      if (fresh) toast('Updated from the farm home.');
    },
  });
  applyShared(sync.state);
  capture = createCapture(app, { root: $('#record-root'), embedded: true });
  capture.open();

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab],[data-field],[data-parcel],[data-back],[data-note-for],[data-clear-photo]');
    if (!t || t.closest('#record-root')) return;
    if (t.dataset.tab) go(t.dataset.tab);
    else if (t.dataset.field || t.dataset.parcel) { ui.tab = 'fields'; ui.field = t.dataset.field || t.dataset.parcel; render(); window.scrollTo(0, 0); }
    else if (t.hasAttribute('data-back')) { ui.field = null; render(); }
    else if (t.dataset.noteFor) { ui.noteTarget = t.dataset.noteFor; ui.lastNoteId = null; go('notes'); }
    else if (t.hasAttribute('data-clear-photo')) { ui.photo = null; render(); }
  });
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
