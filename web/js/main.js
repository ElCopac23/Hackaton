import { fmtLongDate, fmt, esc, shortId } from './util.js';
import {
  sidebar, homeView, weatherView, activitiesView, ndviView, recsView, inventoryView, economicsView, notesView,
  fieldDrawer, farmMenu, sourcesSheet,
} from './views.js';
import { icon } from './icons.js';
import { createCapture } from './capture.js';
import { createOnboarding } from './onboarding.js';
import { zoomView, clampView, viewBoxOf } from './map.js';
import { EMPTY_FILTER } from './rules.js';
import { connectSync, resizePhoto } from './sync.js';
import { today } from './model.js';
import {
  listFarms, savedFarm, rememberFarm, loadFarm, sharedFor, completeness,
} from './farms.js';
import { scenarioOut, roiBox, actionsTable } from './econ-views.js';
import { setupTooltips } from './tooltip.js';

// Identifies this open page, so it does not announce its own changes as news.
const CLIENT = Math.random().toString(36).slice(2, 10);
let sync = null;
let farmIndex = null;
const VIEWS = {
  home: homeView, weather: weatherView, activities: activitiesView, ndvi: ndviView,
  recs: recsView, inventory: inventoryView, economics: economicsView, notes: notesView,
};

const app = {
  state: null,
  commit,
  device: 'web',
};

const farmId = () => app.state.farm.meta.holding_id;

function applyShared(next) {
  Object.assign(app.state, sharedFor(next, farmId()));
}

function setLive(status) {
  const el = document.getElementById('live');
  if (!el) return;
  const text = { live: 'Live', reconnecting: 'Reconnecting…', local: 'Not shared' }[status];
  el.className = `live live-${status}`;
  el.textContent = text;
  el.dataset.tip = status === 'local' ? 'No sync server: records stay in this browser. Start scripts/server.py to share with the phone.' : 'Changes from the phone app appear here in real time.';
}

// Something changed on another device: show it, flash the fields and mark the updated advice.
function onRemote(next) {
  const s = app.state;
  const mine = sharedFor(next, farmId());
  const knownEvents = new Set(s.captured.map((e) => e.id));
  const knownNotes = new Set((s.notes || []).map((n) => n.id));
  const newEvents = mine.captured.filter((e) => !knownEvents.has(e.id) && e.client !== CLIENT);
  const newNotes = mine.notes.filter((n) => !knownNotes.has(n.id) && n.client !== CLIENT);
  previousTitles = currentTitles();
  applyShared(next);
  const fields = [...newEvents.map((e) => e.parcel), ...newNotes.map((n) => n.target).filter((t) => t && t !== 'farm')];
  s.ui.flash = [...new Set(fields)];
  render();
  const from = (x) => (x.device === 'phone' ? 'phone' : 'another screen');
  if (newEvents.length) {
    const e = newEvents[0];
    toast(`New from ${from(e)}: ${e.type} on ${new Set(newEvents.map((x) => x.parcel)).size} field(s). Advice updated.`);
  } else if (newNotes.length) {
    const n = newNotes[0];
    toast(`New note from ${from(n)}${n.target !== 'farm' ? ` on ${shortId(n.target)}` : ''}${n.photo ? ' with photo' : ''}. Advice updated.`);
  }
  setTimeout(() => { s.ui.flash = []; previousTitles = null; }, 4000);
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('is-on'), 3600);
}

// The field panel covers the "Today" column on the home page,
// and a generous share of the screen elsewhere.
function sizeDrawer() {
  const drawer = document.getElementById('drawer');
  const card = document.querySelector('.assistant-card');
  let width = Math.min(Math.max(window.innerWidth * 0.36, 480), 640);
  if (card && window.innerWidth > 1180) width = Math.max(420, window.innerWidth - card.getBoundingClientRect().left + 12);
  drawer.style.width = `${Math.min(width, window.innerWidth)}px`;
}

let previousTitles = null;

function topBar() {
  const s = app.state;
  const m = s.farm.meta;
  const pct = completeness(s);
  document.getElementById('farm-switch').innerHTML = `<span class="ring sm" style="--p:${pct * 100}"></span>
    <span class="farm-sw-text"><b>${esc(m.holding_id)}</b><span>${esc(m.region_name)} · ${fmt(m.area_ha)} ha · ${m.parcels} fields</span></span>${icon('down', 'ico-sm')}`;
  document.getElementById('today').textContent = fmtLongDate(m.today);
  document.getElementById('log-count').textContent = s.captured.length ? `${s.captured.length} logged` : '';
}

function render() {
  const s = app.state;
  topBar();
  document.getElementById('sidebar').innerHTML = sidebar(s);
  const main = document.getElementById('main');
  main.innerHTML = VIEWS[s.ui.view](s);
  const drawer = document.getElementById('drawer');
  if (s.ui.parcel) {
    // Do not wipe a note the farmer is typing when a live update arrives.
    const typing = drawer.classList.contains('is-open') && document.activeElement?.closest?.('[data-note-form]') && drawer.dataset.parcel === s.ui.parcel;
    if (!typing) drawer.innerHTML = fieldDrawer(s);
    drawer.dataset.parcel = s.ui.parcel;
    drawer.classList.add('is-open');
  } else {
    drawer.classList.remove('is-open');
  }
  sizeDrawer();
  // After a new record, mark the advice that changed.
  if (previousTitles) {
    document.querySelectorAll('.rec').forEach((el) => {
      if (!previousTitles.has(el.querySelector('h4').textContent)) el.classList.add('is-changed');
    });
  }
}

function currentTitles() {
  const holder = document.createElement('div');
  holder.innerHTML = VIEWS[app.state.ui.view](app.state);
  return new Set([...holder.querySelectorAll('.rec h4')].map((h) => h.textContent));
}

async function commit({ events, adjust, flash, message }) {
  const s = app.state;
  previousTitles = currentTitles();
  try {
    applyShared(await sync.addRecords(events.map((e) => ({ ...e, farm: farmId(), device: app.device, client: CLIENT })), adjust));
  } catch (err) {
    toast(`Not saved: ${err.message}`);
    return;
  }
  s.ui.flash = flash;
  render();
  toast(message);
  setTimeout(() => { s.ui.flash = []; previousTitles = null; }, 4000);
}

async function saveNote(form) {
  const s = app.state;
  const target = form.where?.value || form.dataset.noteForm;
  const text = form.text.value.trim();
  const tags = [...form.querySelectorAll('input[name="tags"]:checked')].map((x) => x.value);
  const file = form.photo.files[0];
  if (!text && !file) { toast('Write something or add a photo first.'); return; }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const photo = file ? await resizePhoto(file) : null;
    previousTitles = currentTitles();
    applyShared(await sync.addNote({
      farm: farmId(), target, date: today(s), text, tags, photo, device: 'web', channel: 'text', client: CLIENT,
    }));
    s.ui.flash = target !== 'farm' ? [target] : [];
    render();
    toast('Note saved. The assistant has read it.');
    setTimeout(() => { s.ui.flash = []; previousTitles = null; }, 4000);
  } catch (err) {
    button.disabled = false;
    toast(`Note not saved: ${err.message}`);
  }
}

function closePanels(except = null) {
  for (const id of ['phone-panel', 'farm-menu', 'more-menu', 'sources-panel']) {
    if (id !== except) document.getElementById(id).hidden = true;
  }
}

function togglePanel(id, html) {
  const panel = document.getElementById(id);
  const opening = panel.hidden;
  closePanels();
  if (!opening) return;
  if (html != null) panel.innerHTML = html;
  panel.hidden = false;
}

async function showPhoneLink() {
  const panel = document.getElementById('phone-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  const info = sync ? await sync.info() : null;
  let body;
  if (!info) {
    body = '<p>The sync server is not running, so the phone cannot connect.</p><p>Start it with <code>python3 scripts/server.py --lan</code> and reload this page.</p>';
  } else if (!info.phoneUrl && !info.tailscaleUrl && !info.tailscaleHttpUrl) {
    body = '<p>The server only accepts this Mac. Restart it with <code>python3 scripts/server.py --lan</code> so the iPhone can connect over Wi-Fi.</p>';
  } else {
    const link = (url) => `<div class="phone-url"><code>${esc(url)}</code><button class="btn ghost" data-action="copy-phone" data-url="${esc(url)}">Copy</button></div>`;
    body = `${info.tailscaleUrl ? `<p><b>Anywhere, secure (Tailscale):</b> Wi-Fi or mobile data, with the in-app microphone. Tailscale must be on.</p>${link(info.tailscaleUrl)}` : ''}
      ${!info.tailscaleUrl && info.tailscaleHttpUrl ? `<p><b>Anywhere (Tailscale):</b> any network while Tailscale is on, on the Mac and the iPhone.</p>${link(info.tailscaleHttpUrl)}` : ''}
      ${info.phoneUrl ? `<p>${info.tailscaleUrl || info.tailscaleHttpUrl ? '<b>Backup, same Wi-Fi only:</b>' : 'On the iPhone (same Wi-Fi), open in <b>Safari</b>:'}</p>${link(info.phoneUrl)}` : ''}
      <ol><li>Send the link to the phone (AirDrop, Messages or Notes).</li>
      <li>Share → <b>Add to Home Screen</b>.</li>
      <li>Open <b>DemetrAg</b>: what you record appears here live.</li></ol>`;
  }
  closePanels('phone-panel');
  panel.innerHTML = `<div class="phone-head"><b>${icon('phone', 'ico-sm')} Phone app</b><button class="icon-btn" data-action="phone" aria-label="Close">${icon('close')}</button></div>${body}`;
  panel.hidden = false;
}

function go(view) {
  closePanels();
  app.state.ui.view = view === 'last' ? 'activities' : view;
  if (view === 'last') app.state.ui.actTab = 'timeline';
  app.state.ui.event = null;
  previousTitles = null;
  render();
  document.getElementById('main').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function freshUi(farm, view = 'home') {
  return {
    view, parcel: null, flash: [], activityFilter: 'all', activitySeason: Number(farm.meta.today.slice(0, 4)), event: null,
    mapView: { crop: null, ndvi: null }, recFilter: { ...EMPTY_FILTER }, actTab: 'log',
    noteFilter: { kind: 'all', field: 'all', topic: 'all' }, econ: { priceAdj: 0, yieldAdj: 0 },
  };
}

async function switchFarm(id) {
  closePanels();
  if (id === farmId()) return;
  const view = app.state.ui.view;
  try {
    const state = await loadFarm(id);
    state.ui = freshUi(state.farm, view);
    app.state = state;
    rememberFarm(id);
    applyShared(sync.current());
    render();
    toast(`Showing ${id}.`);
  } catch (err) {
    toast(`Could not open ${id}: ${err.message}`);
  }
}

// ---------- map zoom and pan ----------

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function currentView(svg) {
  const vb = svg.viewBox.baseVal;
  return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
}

function setView(svg, view) {
  const v = clampView(app.state, view);
  svg.setAttribute('viewBox', viewBoxOf(v));
  app.state.ui.mapView[svg.dataset.mode] = v;
}

let drag = null;
let suppressClick = false;

function setupMapGestures() {
  document.addEventListener('wheel', (ev) => {
    const svg = ev.target.closest?.('.farm-map');
    if (!svg) return;
    ev.preventDefault();
    const factor = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView(svg, zoomView(app.state, currentView(svg), factor, svgPoint(svg, ev.clientX, ev.clientY)));
  }, { passive: false });

  document.addEventListener('pointerdown', (ev) => {
    const svg = ev.target.closest?.('.farm-map');
    if (!svg || ev.button !== 0) return;
    drag = { svg, x: ev.clientX, y: ev.clientY, view: currentView(svg), moved: false, id: ev.pointerId };
  });
  document.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; drag.svg.classList.add('is-panning'); drag.svg.setPointerCapture?.(ev.pointerId); }
    const scale = 1 / drag.svg.getScreenCTM().a;
    setView(drag.svg, { ...drag.view, x: drag.view.x - dx * scale, y: drag.view.y - dy * scale });
  });
  const end = () => {
    if (drag?.moved) { suppressClick = true; drag.svg.classList.remove('is-panning'); }
    drag = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

function zoomButton(kind, mode) {
  const s = app.state;
  if (kind === 'fit') s.ui.mapView[mode] = null;
  else s.ui.mapView[mode] = zoomView(s, s.ui.mapView[mode], kind === 'in' ? 0.75 : 1 / 0.75);
  const svg = document.querySelector(`.farm-map[data-mode="${mode}"]`);
  if (svg && s.ui.mapView[mode]) svg.setAttribute('viewBox', viewBoxOf(s.ui.mapView[mode]));
  else render();
}

// Scenario sliders: recompute the figures without rebuilding the sliders being dragged.
function onSlider(el) {
  const s = app.state;
  s.ui.econ[el.dataset.adj] = Number(el.value) / 100;
  const v = s.ui.econ[el.dataset.adj];
  document.querySelector(`[data-adj-out="${el.dataset.adj}"]`).textContent = `${v >= 0 ? '+' : ''}${fmt(v * 100, 0)}%`;
  document.getElementById('scenario-out').innerHTML = scenarioOut(s, s.ui.econ);
  document.getElementById('roi-out').innerHTML = roiBox(s, s.ui.econ);
  document.getElementById('actions-out').innerHTML = actionsTable(s, s.ui.econ);
}

async function start() {
  farmIndex = await listFarms();
  const state = await loadFarm(savedFarm(farmIndex));
  state.ui = freshUi(state.farm);
  app.state = state;
  sync = await connectSync({ onChange: onRemote, onStatus: setLive });
  applyShared(sync.state);
  const capture = createCapture(app);
  const onboarding = createOnboarding({
    root: document.getElementById('onboarding'),
    toast,
    currentFarm: () => app.state.farm,
    loadDemoFarm: async () => (await loadFarm('FARM-00268')).farm,
    onOpenFarm: (id) => { if (id === farmId()) toast(`${id} is open.`); else switchFarm(id); },
  });
  setupMapGestures();
  setupTooltips();

  document.addEventListener('click', (ev) => {
    if (suppressClick) { suppressClick = false; if (ev.target.closest('.farm-map')) return; }
    const el = ev.target.closest('[data-view],[data-parcel],[data-action],[data-filter],[data-season],[data-event],[data-zoom],[data-rf-cat],[data-act-tab],[data-nf],[data-farm]');
    if (!el) {
      if (!ev.target.closest('.menu, .phone-panel, .sheet')) closePanels();
      return;
    }
    if (el.closest('#capture') || el.closest('#onboarding')) return;
    const s = app.state;
    const action = el.dataset.action;
    if (el.dataset.zoom) zoomButton(el.dataset.zoom, el.dataset.mode);
    else if (el.dataset.rfCat) { s.ui.recFilter.category = el.dataset.rfCat; render(); }
    else if (el.dataset.actTab) { s.ui.actTab = el.dataset.actTab; render(); }
    else if (el.dataset.nf) { s.ui.noteFilter[el.dataset.nf] = el.dataset.value; render(); }
    else if (el.dataset.farm) switchFarm(el.dataset.farm);
    else if (action === 'rf-clear') { s.ui.recFilter = { ...EMPTY_FILTER }; render(); }
    else if (action === 'log') { closePanels(); capture.open(); }
    else if (action === 'onboarding') { closePanels(); onboarding.open(el.dataset.step); }
    else if (action === 'phone') showPhoneLink();
    else if (action === 'farms') togglePanel('farm-menu', farmMenu(s, farmIndex));
    else if (action === 'more') togglePanel('more-menu');
    else if (action === 'sources') togglePanel('sources-panel', sourcesSheet());
    else if (action === 'copy-phone') {
      navigator.clipboard?.writeText(el.dataset.url).then(() => toast('Link copied.'), () => toast('Copy failed: select the link instead.'));
    } else if (action === 'close-drawer') { s.ui.parcel = null; render(); }
    else if (action === 'reset') {
      closePanels();
      if (window.confirm('Remove the activities and notes logged in this demo (on every device and farm) and restore the starting stock?')) {
        sync.reset().then((next) => { applyShared(next); render(); toast('Demo reset to the farm records.'); },
          (err) => toast(`Reset failed: ${err.message}`));
      }
    } else if (el.dataset.view) go(el.dataset.view);
    else if (el.dataset.parcel) { s.ui.parcel = el.dataset.parcel; render(); }
    else if (el.dataset.filter) { s.ui.activityFilter = el.dataset.filter; render(); }
    else if (el.dataset.season) { s.ui.activitySeason = Number(el.dataset.season); render(); }
    else if (el.dataset.event) { s.ui.event = s.ui.event === el.dataset.event ? null : el.dataset.event; render(); }
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-note-form]');
    if (!form) return;
    ev.preventDefault();
    saveNote(form);
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.dataset?.adj) onSlider(ev.target);
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.name === 'photo' && el.closest('[data-note-form]')) {
      el.closest('[data-note-form]').querySelector('.photo-name').textContent = el.files[0] ? el.files[0].name : '';
      return;
    }
    if (el.matches?.('[data-nf-field]')) { app.state.ui.noteFilter.field = el.value; render(); return; }
    if (el.dataset?.rf && !el.closest('#capture')) {
      app.state.ui.recFilter[el.dataset.rf] = el.value;
      render();
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (onboarding.isOpen()) { onboarding.close(); return; }
      closePanels();
      if (!capture.isOpen() && app.state.ui.parcel) { app.state.ui.parcel = null; render(); }
    }
    if (ev.key === 'Enter' && ev.target.matches?.('.field')) { app.state.ui.parcel = ev.target.dataset.parcel; render(); }
  });

  window.addEventListener('resize', sizeDrawer);
  render();
}

start().catch((err) => {
  document.getElementById('main').innerHTML = `<div class="card error"><h2>Could not load the farm data</h2><p>${esc(String(err.message))}</p></div>`;
  console.error(err);
});
