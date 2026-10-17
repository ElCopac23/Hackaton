import { fmtLongDate, fmt } from './util.js';
import {
  sidebar, homeView, weatherView, activitiesView, ndviView, lastView, recsView, inventoryView, fieldDrawer,
} from './views.js';
import { createCapture } from './capture.js';

const STORE = 'farm-assistant-demo-v1';
const VIEWS = {
  home: homeView, weather: weatherView, activities: activitiesView, ndvi: ndviView,
  last: lastView, recs: recsView, inventory: inventoryView,
};

const app = {
  state: null,
  commit,
};

async function loadJson(name) {
  const res = await fetch(`data/${name}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`data/${name}.json: ${res.status}. Run scripts/build_data.py first.`);
  return res.json();
}

function restore(state) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) {
      state.captured = saved.captured || [];
      state.stockAdjust = saved.stockAdjust || {};
    }
  } catch { /* storage unavailable: start from the seed data */ }
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ captured: app.state.captured, stockAdjust: app.state.stockAdjust }));
  } catch { /* the demo still works for this session */ }
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('is-on'), 3600);
}

let previousTitles = null;

function render() {
  const s = app.state;
  document.getElementById('sidebar').innerHTML = sidebar(s);
  const main = document.getElementById('main');
  main.innerHTML = VIEWS[s.ui.view](s);
  const drawer = document.getElementById('drawer');
  if (s.ui.parcel) {
    drawer.innerHTML = fieldDrawer(s);
    drawer.classList.add('is-open');
  } else {
    drawer.classList.remove('is-open');
  }
  document.getElementById('log-count').textContent = s.captured.length ? `${s.captured.length} logged` : '';
  document.getElementById('reset').hidden = !s.captured.length;
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

function commit({ events, adjust, flash, message }) {
  const s = app.state;
  previousTitles = currentTitles();
  s.captured.push(...events);
  for (const [id, delta] of Object.entries(adjust)) s.stockAdjust[id] = (s.stockAdjust[id] || 0) + delta;
  s.ui.flash = flash;
  persist();
  render();
  toast(message);
  setTimeout(() => { s.ui.flash = []; previousTitles = null; }, 4000);
}

function go(view) {
  app.state.ui.view = view;
  app.state.ui.event = null;
  previousTitles = null;
  render();
  document.getElementById('main').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

async function start() {
  const [farm, weather, stock, assumptions] = await Promise.all(['farm', 'weather', 'stock', 'assumptions'].map(loadJson));
  const state = {
    farm, weather, stock, assumptions, captured: [], stockAdjust: {},
    ui: { view: 'home', parcel: null, flash: [], activityFilter: 'all', activitySeason: Number(farm.meta.today.slice(0, 4)), event: null },
  };
  restore(state);
  app.state = state;
  document.getElementById('farm-line').textContent = `${farm.meta.holding_id} · ${farm.meta.region_name} (${farm.meta.country}) · ${fmt(farm.meta.area_ha)} ha · ${farm.meta.parcels} fields`;
  document.getElementById('today').textContent = fmtLongDate(farm.meta.today);
  const capture = createCapture(app);

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-view],[data-parcel],[data-action],[data-filter],[data-season],[data-event]');
    if (!el || el.closest('#capture')) return;
    const s = app.state;
    if (el.dataset.action === 'log') capture.open();
    else if (el.dataset.action === 'close-drawer') { s.ui.parcel = null; render(); }
    else if (el.dataset.action === 'reset') {
      if (window.confirm('Remove the activities logged in this demo and restore the starting stock?')) {
        s.captured = [];
        s.stockAdjust = {};
        persist();
        render();
        toast('Demo reset to the farm records.');
      }
    } else if (el.dataset.view) go(el.dataset.view);
    else if (el.dataset.parcel) { s.ui.parcel = el.dataset.parcel; render(); }
    else if (el.dataset.filter) { s.ui.activityFilter = el.dataset.filter; render(); }
    else if (el.dataset.season) { s.ui.activitySeason = Number(el.dataset.season); render(); }
    else if (el.dataset.event) { s.ui.event = s.ui.event === el.dataset.event ? null : el.dataset.event; render(); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !capture.isOpen() && app.state.ui.parcel) { app.state.ui.parcel = null; render(); }
    if (ev.key === 'Enter' && ev.target.matches?.('.field')) { app.state.ui.parcel = ev.target.dataset.parcel; render(); }
  });

  render();
}

start().catch((err) => {
  document.getElementById('main').innerHTML = `<div class="card error"><h2>Could not load the farm data</h2><p>${String(err.message)}</p></div>`;
  console.error(err);
});
