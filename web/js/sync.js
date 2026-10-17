// Shared state between the farm home and the phone app.
// With scripts/server.py running, records, notes and photos go to the server and every open
// page is told about changes through Server-Sent Events. Without it (static hosting), the page
// falls back to this browser's storage and nothing is shared.
const STORE = 'farm-assistant-demo-v1';
const EMPTY = { version: 0, captured: [], stockAdjust: {}, notes: [] };

function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    return { ...EMPTY, ...(saved || {}), notes: saved?.notes || [] };
  } catch {
    return { ...EMPTY };
  }
}

function saveLocal(state) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ captured: state.captured, stockAdjust: state.stockAdjust, notes: state.notes }));
  } catch { /* storage unavailable: keep for this session only */ }
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// onChange(state) is called whenever another device changes the shared state.
// onStatus('live' | 'reconnecting' | 'local') reports the connection.
export async function connectSync({ onChange, onStatus = () => {}, base = '' }) {
  let mode = 'local';
  let state;
  try {
    const res = await fetch(`${base}api/state`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    state = await res.json();
    mode = 'server';
  } catch {
    state = loadLocal();
  }

  let version = state.version;
  const refresh = async () => {
    try {
      const res = await fetch(`${base}api/state`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return;
      const next = await res.json();
      if (next.version !== version) {
        version = next.version;
        onChange(next);
      }
    } catch { /* next event or visibility change retries */ }
  };

  if (mode === 'server') {
    const events = new EventSource(`${base}api/events`, { withCredentials: true });
    events.addEventListener('update', (e) => {
      onStatus('live');
      const v = JSON.parse(e.data).version;
      if (v !== version) refresh();
    });
    events.addEventListener('open', () => onStatus('live'));
    events.addEventListener('error', () => onStatus('reconnecting'));
    // Phones pause pages in the background: catch up as soon as the app is visible again.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('focus', refresh);
  } else {
    onStatus('local');
  }

  const applied = (next) => { version = next.version; return next; };

  return {
    mode,
    state,
    async addRecords(events, adjust) {
      if (mode === 'server') return applied(await postJson(`${base}api/records`, { events, adjust }));
      state = { ...state, captured: [...state.captured, ...events], stockAdjust: { ...state.stockAdjust } };
      for (const [id, delta] of Object.entries(adjust)) state.stockAdjust[id] = (state.stockAdjust[id] || 0) + delta;
      saveLocal(state);
      return state;
    },
    async addNote(note) {
      if (mode === 'server') return applied(await postJson(`${base}api/notes`, note));
      const stored = {
        ...note, id: `local-${Date.now()}`, created_at: new Date().toISOString(),
        photo: note.photo || null, // kept as a data URL in local mode
      };
      state = { ...state, notes: [...state.notes, stored] };
      saveLocal(state);
      return state;
    },
    async reset() {
      if (mode === 'server') return applied(await postJson(`${base}api/reset`, {}));
      state = { ...EMPTY };
      saveLocal(state);
      return state;
    },
    async info() {
      if (mode !== 'server') return null;
      try { return await (await fetch(`${base}api/info`, { cache: 'no-store' })).json(); } catch { return null; }
    },
  };
}

// Resize a photo before upload so phone pictures (several MB) become ~200 KB.
export function resizePhoto(file, maxSide = 1280, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This photo format could not be read.')); };
    img.src = url;
  });
}

// Photos are stored as "photos/<id>.jpg" on the server, or as data URLs in local mode.
export function photoUrl(photo, base = '') {
  if (!photo) return '';
  return photo.startsWith('data:') ? photo : `${base}${photo}`;
}
