export const CROPS = {
  COWT: { name: 'Wheat', color: '#C98A1E', season: 'winter' },
  BARL: { name: 'Barley', color: '#97A35A', season: 'winter' },
  RAPE: { name: 'Rapeseed', color: '#EDCB34', season: 'winter' },
  MAIZ: { name: 'Maize', color: '#3E8B5A', season: 'spring' },
  SUNF: { name: 'Sunflower', color: '#C4572F', season: 'spring' },
};

export const OP_LABELS = {
  harvest: 'Harvest',
  spreading: 'Fertiliser spreading',
  sowing: 'Sowing',
  spraying: 'Spraying',
};

export const TYPE_LABELS = {
  sowing: 'Sowing',
  fertilisation: 'Fertilising',
  spraying: 'Spraying',
  harvest: 'Harvest',
};

import { icon } from './icons.js';

export const SOURCES = {
  records: { label: 'Your records', title: 'From the farm records (synthetic hackathon dataset)' },
  captured: { label: 'Captured', title: 'Logged in this app' },
  regional: { label: 'Regional', title: 'Regional reference data for Loiret (AgERA5, NPKGRIDS via the dataset)' },
  forecast: { label: 'Forecast', title: 'Open-Meteo forecast snapshot' },
  simulated: { label: 'Simulated', title: 'Simulated for the demo, not in the dataset' },
  rule: { label: 'Rule of thumb', title: 'Threshold set by the team, to be confirmed by an adviser' },
  note: { label: 'Your notes', title: 'From notes and photos logged on the phone or the farm home' },
  accounts: { label: 'Your accounts', title: 'Farm accounts: synthetic economics, subsidy and sales tables (dataset)' },
  market: { label: 'Market prices', title: 'Monthly crop prices, synthetic market price table (dataset)' },
  benchmark: { label: 'Similar farms', title: 'Median of synthetic arable farms in the same region (dataset)' },
};
const SOURCE_ICON = { accounts: 'economics' };

export const cropName = (c) => CROPS[c]?.name ?? c;
export const cropColor = (c) => CROPS[c]?.color ?? '#999';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function fmt(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '–';
  return Number(value).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtQty(value, unit) {
  if (value == null) return '–';
  if (unit === 'kg' && Math.abs(value) >= 1000) return `${fmt(value / 1000, 2)} t`;
  if (unit === 'kg') return `${fmt(value, 0)} kg`;
  return `${fmt(value, Math.abs(value) < 100 ? 1 : 0)} ${unit}`;
}

// Data sources are shown as small icons; the name and details appear on hover or tap.
export function badge(source) {
  const s = SOURCES[source];
  if (!s) return '';
  return `<span class="src src-${source}" role="img" tabindex="0" aria-label="${esc(s.label)}" data-tip="${esc(s.label)}: ${esc(s.title)}">${icon(SOURCE_ICON[source] || source, 'src-ico')}</span>`;
}

export const badges = (list) => (list.length ? `<span class="srcs">${list.map(badge).join('')}</span>` : '');

// Euros: "€1,240", "€12.4k", "€1.2M".
export function fmtEur(value, { sign = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '–';
  const v = Number(value);
  const a = Math.abs(v);
  let body;
  if (a >= 1e6) body = `${fmt(a / 1e6, 1)}M`;
  else if (a >= 1e4) body = `${fmt(a / 1e3, a >= 1e5 ? 0 : 1)}k`;
  else body = fmt(a, 0);
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}€${body}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const parseDate = (iso) => new Date(`${iso}T12:00:00Z`);
export const isoDate = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => isoDate(new Date(parseDate(iso).getTime() + n * 86400000));
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
export const monthName = (m) => MONTHS[m - 1];

export function fmtDate(iso, withYear = false) {
  const d = parseDate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
}

export function fmtDay(iso) {
  const d = parseDate(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

export function fmtLongDate(iso) {
  const d = parseDate(iso);
  const long = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${long[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// "11-02" -> "2 Nov"
export function fmtMonthDay(md) {
  const [m, d] = md.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

// Compact list of dates: consecutive days are merged ("17–19, 21–23 Oct").
export function fmtDateRuns(isos) {
  if (!isos.length) return 'none';
  const runs = [];
  let start = isos[0];
  let prev = isos[0];
  for (const iso of isos.slice(1)) {
    if (daysBetween(prev, iso) === 1) { prev = iso; continue; }
    runs.push([start, prev]);
    start = iso;
    prev = iso;
  }
  runs.push([start, prev]);
  const month = (iso) => MONTHS[parseDate(iso).getUTCMonth()];
  const sameMonth = runs.every(([a, b]) => month(a) === month(runs[0][0]) && month(b) === month(runs[0][0]));
  const day = (iso) => parseDate(iso).getUTCDate();
  const part = ([a, b]) => {
    if (sameMonth) return a === b ? `${day(a)}` : `${day(a)}–${day(b)}`;
    return a === b ? fmtDate(a) : `${fmtDate(a)}–${fmtDate(b)}`;
  };
  return sameMonth ? `${runs.map(part).join(', ')} ${month(runs[0][0])}` : runs.map(part).join(', ');
}

export const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
export const mean = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? sum(v) / v.length : null;
};

export function weatherIcon(code) {
  if (code === 0) return { icon: '☀️', text: 'Clear' };
  if (code <= 2) return { icon: '🌤️', text: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', text: 'Overcast' };
  if (code === 45 || code === 48) return { icon: '🌫️', text: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', text: 'Drizzle' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', text: 'Rain' };
  if (code >= 71 && code <= 77) return { icon: '🌨️', text: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: '🌦️', text: 'Showers' };
  if (code >= 95) return { icon: '⛈️', text: 'Thunderstorm' };
  return { icon: '🌥️', text: 'Cloudy' };
}

// "Crops 2026" -> "crops 2026", but "CAP documents" stays as it is.
export const lowerFirst = (text) => text.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());

export const shortId = (parcelId) => `P-${parcelId.slice(-4)}`;

// Where photos are served from: '' on the farm home, '../' in the phone app.
export const assets = { base: '' };
export const photoSrc = (photo) => (!photo ? '' : photo.startsWith('data:') ? photo : `${assets.base}${photo}`);
