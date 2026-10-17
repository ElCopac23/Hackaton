// Onboarding: a farmer brings whatever data they have (photos, CAP documents, spreadsheets,
// notes) and an agent reads it, or answers a few questions. Scripted demo: files stay in the
// browser, nothing is stored and the agent is simulated (a language model is on the roadmap).
import { esc, fmt, CROPS, cropName, cropColor, shortId, lowerFirst } from './util.js';
import { icon } from './icons.js';

const STAGES = [
  ['Reading your files', (f) => `${f.length} file${f.length > 1 ? 's' : ''}, ${fmt(sumSize(f) / 1e6, 1)} MB`],
  ['Recognising documents', (f) => kindsText(f)],
  ['Extracting fields, crops and work', () => 'Field names, areas, crops, dates, products and rates'],
  ['Matching to your farm', () => 'Field by field, against what is already in DemetrAg'],
];

const QUESTION_STEPS = ['basics', 'fields', 'history', 'cap', 'records', 'stock'];
const REQUIRED = new Set(['basics', 'fields']);
const STEP_TITLE = {
  basics: 'Your farm', fields: 'Fields and crops this year', history: 'Last season', cap: 'CAP documents',
  records: 'Farm records', stock: 'Stock in the shed',
};
const CROP_OPTIONS = Object.keys(CROPS);

function sumSize(files) { return files.reduce((a, f) => a + f.size, 0); }

// What a file probably is, from its type and name.
export function fileKind(file) {
  const n = file.name.toLowerCase();
  const ext = n.split('.').pop();
  if (/^image\//.test(file.type) || ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)) {
    return /receipt|invoice|facture|label|etiquette|bon/.test(n) ? 'Receipt or label' : 'Field photo';
  }
  if (['shp', 'kml', 'kmz', 'geojson', 'gpkg'].includes(ext)) return 'Field boundaries';
  if (/pac|telepac|cap|iacs|lpis|declar|parcell/.test(n)) return 'CAP declaration';
  if (/soil|sol|analys/.test(n)) return 'Soil analysis';
  if (/invoice|facture|receipt|achat/.test(n)) return 'Invoice';
  if (['csv', 'xls', 'xlsx', 'ods'].includes(ext)) return 'Farm records';
  if (['txt', 'md', 'doc', 'docx', 'rtf', 'pages', 'm4a', 'mp3', 'wav'].includes(ext)) return 'Notes';
  if (ext === 'pdf') return 'Document';
  return 'Other';
}

function kindsText(files) {
  const counts = {};
  files.forEach((f) => { counts[f.kind] = (counts[f.kind] || 0) + 1; });
  return Object.entries(counts).map(([k, c]) => `${c} ${lowerFirst(k)}${c > 1 && !k.endsWith('s') ? 's' : ''}`).join(', ');
}

// Scripted result of the simulated agent, shaped by the kinds of files dropped.
function extraction(files, farm) {
  const has = (k) => files.filter((f) => f.kind === k).length;
  const fields = farm?.parcels?.length || 7;
  const out = [];
  if (has('CAP declaration') || has('Field boundaries')) out.push(['fields', `${fields} fields and their 2026 crops`, 'Matched to the fields on your map']);
  if (has('Farm records')) out.push(['table', `${36 * has('Farm records')} operations, 2024–2026`, 'Sowing, fertiliser, spraying and harvest records']);
  if (has('Soil analysis')) out.push(['ndvi', `Soil analyses for ${Math.min(fields, 3 * has('Soil analysis'))} fields`, 'pH, organic matter, P and K']);
  if (has('Invoice') || has('Receipt or label')) out.push(['inventory', `${4 * (has('Invoice') + has('Receipt or label'))} product purchases`, 'Opening stock and costs']);
  if (has('Field photo')) out.push(['camera', `${has('Field photo')} photo${has('Field photo') > 1 ? 's' : ''} filed as field notes`, 'Placed on the field by their location and date']);
  if (has('Notes')) out.push(['notes', `${has('Notes')} note${has('Notes') > 1 ? 's' : ''} read`, 'Topics found: field visits, machinery']);
  if (has('Document') || has('Other')) out.push(['file', `${has('Document') + has('Other')} other document${has('Document') + has('Other') > 1 ? 's' : ''} kept`, 'Stored with the farm, nothing extracted']);
  return out;
}

export function createOnboarding({ root, toast, onOpenFarm, currentFarm, loadDemoFarm, sheet = false }) {
  let ui = null;

  const fresh = () => ({
    step: 'start', files: [], stage: 0, timer: null, error: '',
    answers: { name: '', region: 'FRB06', area: '', organic: 'no', fields: [{ name: '', area: '', crop: '' }], cap: '', stock: [] },
  });

  function close() {
    clearTimeout(ui?.timer);
    root.hidden = true;
    root.innerHTML = '';
    ui = null;
  }

  function open(step = 'start') {
    ui = fresh();
    ui.step = step === 'optional' ? 'hub' : 'start';
    root.hidden = false;
    render();
  }

  const head = (title, back = null) => `<div class="onb-head">
      ${back ? `<button class="icon-btn" data-onb="back" data-to="${back}" aria-label="Back">${icon('left')}</button>` : `<span class="onb-mark">${icon('sparkle')}</span>`}
      <b>${esc(title)}</b>
      <button class="icon-btn" data-onb="close" aria-label="Close">${icon('close')}</button></div>`;

  function progress(step) {
    const i = QUESTION_STEPS.indexOf(step);
    return `<div class="onb-steps">${QUESTION_STEPS.map((k, j) => `<span class="${j < i ? 'done' : j === i ? 'on' : ''}${REQUIRED.has(k) ? ' req' : ''}" title="${esc(STEP_TITLE[k])}"></span>`).join('')}</div>
      <div class="onb-step-label">${REQUIRED.has(step) ? '<span class="pill pill-req">Required</span>' : '<span class="pill">Optional</span>'} Step ${i + 1} of ${QUESTION_STEPS.length}</div>`;
  }

  function startView() {
    return `${head('Bring your farm in')}
    <div class="onb-body">
      <p class="onb-lead">Start with what you have. You can add more later.</p>
      <div class="onb-choices">
        <button class="onb-choice" data-onb="go" data-to="upload">${icon('upload', 'onb-ico')}<b>I have data</b>
          <span>Photos, CAP declaration, spreadsheets, notebooks: anything. The agent sorts it out.</span></button>
        <button class="onb-choice" data-onb="go" data-to="basics">${icon('notes', 'onb-ico')}<b>Start from questions</b>
          <span>Fields and crops this year take 3 minutes. The rest is optional.</span></button>
      </div>
    </div>`;
  }

  function uploadView() {
    return `${head('Upload your data', 'start')}
    <div class="onb-body">
      <label class="drop" data-drop>
        ${icon('upload', 'drop-ico')}<b>Drop files here or tap to choose</b>
        <span>Any format: photos, PDF, CAP/PAC declarations, Excel or CSV, notes, voice memos</span>
        <input type="file" multiple hidden data-onb-files>
      </label>
      ${ui.files.length ? `<div class="file-list">${ui.files.map((f, i) => `<div class="file-row">${icon(f.kind === 'Field photo' ? 'image' : f.kind === 'Farm records' ? 'table' : 'file', 'ico-sm')}
        <span class="file-name">${esc(f.name)}</span><span class="pill">${esc(f.kind)}</span>
        <button class="icon-btn sm" data-onb="remove" data-i="${i}" aria-label="Remove">${icon('close', 'ico-sm')}</button></div>`).join('')}</div>` : ''}
      <p class="onb-note">${icon('shield', 'ico-sm')} Demo: files stay on this device and are not uploaded.</p>
    </div>
    <div class="onb-foot"><button class="btn primary" data-onb="agent" ${ui.files.length ? '' : 'disabled'}>Let the agent read ${ui.files.length || ''} file${ui.files.length === 1 ? '' : 's'}</button></div>`;
  }

  function agentView() {
    return `${head('DemetrAg agent at work')}
    <div class="onb-body">
      <div class="agent">${STAGES.map(([title, detail], i) => `<div class="agent-row ${i < ui.stage ? 'done' : i === ui.stage ? 'on' : ''}">
        <span class="agent-dot">${i < ui.stage ? icon('check', 'ico-sm') : ''}</span>
        <div><b>${title}</b>${i <= ui.stage ? `<span class="muted small">${esc(detail(ui.files))}</span>` : ''}</div></div>`).join('')}</div>
      <p class="onb-note">${icon('sparkle', 'ico-sm')} Simulated agent for the demo.</p>
    </div>`;
  }

  function reviewView() {
    const farm = currentFarm();
    const found = extraction(ui.files, farm);
    return `${head('Ready to add')}
    <div class="onb-body">
      <p class="onb-lead">The agent found:</p>
      <div class="found">${found.map(([ic, t, d]) => `<div class="found-row">${icon(ic, 'found-ico')}<div><b>${esc(t)}</b><span class="muted small">${esc(d)}</span></div>${icon('check', 'ok-ico')}</div>`).join('')}</div>
      <p class="onb-note">${icon('info', 'ico-sm')} Scripted result: in the product you check each item before it joins ${esc(farm.meta.holding_id)}.</p>
    </div>
    <div class="onb-foot"><button class="btn ghost" data-onb="go" data-to="upload">Add more files</button><button class="btn primary" data-onb="integrate">Add to my farm</button></div>`;
  }

  // Optional data for a farm that is already in: pick what to add.
  function hubView() {
    const farm = currentFarm();
    const items = (farm.meta.onboarding?.items || []).filter((i) => !i.done);
    const route = { records: 'history', cap: 'cap', stock: 'stock', accounts: 'records', soil: 'records' };
    return `${head('Complete your profile')}
    <div class="onb-body">
      <p class="onb-lead">${items.length ? 'Each item unlocks more advice. Upload it or answer a few questions.' : 'This profile is complete.'}</p>
      <div class="hub">${items.map((i) => `<div class="hub-row"><b>${esc(i.label)}</b>
        <span class="hub-actions"><button class="btn ghost sm" data-onb="go" data-to="upload">${icon('upload', 'ico-sm')} Upload</button>
        <button class="btn ghost sm" data-onb="go" data-to="${route[i.key] || 'records'}" data-single="1">Answer</button></span></div>`).join('')}</div>
    </div>`;
  }

  const input = (key, label, attrs = '') => `<label class="onb-field"><span>${label}</span><input data-a="${key}" value="${esc(ui.answers[key])}" ${attrs}></label>`;

  function questionView() {
    const step = ui.step;
    const a = ui.answers;
    const idx = QUESTION_STEPS.indexOf(step);
    const prev = idx > 0 ? QUESTION_STEPS[idx - 1] : 'start';
    let body = '';
    if (step === 'basics') {
      body = `${input('name', 'Farm name', 'placeholder="e.g. Ferme des Trois Chênes" autocomplete="off"')}
        <label class="onb-field"><span>Region</span><select data-a="region"><option value="FRB06">Loiret (FR)</option><option value="other">Other region</option></select></label>
        ${input('area', 'Farmed area (ha)', 'type="number" inputmode="decimal" min="0" step="0.1" placeholder="e.g. 41"')}
        <div class="onb-field"><span>Farming</span><div class="seg">${[['no', 'Conventional'], ['yes', 'Organic']].map(([v, l]) => `<button class="seg-btn${a.organic === v ? ' is-on' : ''}" data-onb="organic" data-v="${v}">${l}</button>`).join('')}</div></div>`;
    } else if (step === 'fields') {
      const total = a.fields.reduce((t, f) => t + (Number(f.area) || 0), 0);
      body = `<div class="ftable">${a.fields.map((f, i) => `<div class="frow">
          <input data-f="${i}" data-k="name" value="${esc(f.name)}" placeholder="Field name" aria-label="Field name" autocomplete="off">
          <input data-f="${i}" data-k="area" value="${esc(f.area)}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="ha" aria-label="Area in hectares">
          <select data-f="${i}" data-k="crop" aria-label="Crop 2026"><option value="">Crop…</option>${CROP_OPTIONS.map((c) => `<option value="${c}" ${f.crop === c ? 'selected' : ''}>${esc(cropName(c))}</option>`).join('')}</select>
          <button class="icon-btn sm" data-onb="del-field" data-i="${i}" aria-label="Remove field" ${a.fields.length === 1 ? 'disabled' : ''}>${icon('close', 'ico-sm')}</button></div>`).join('')}</div>
        <div class="ftotal"><button class="btn ghost sm" data-onb="add-field">${icon('plus', 'ico-sm')} Add field</button><span class="muted small">${a.fields.length} field${a.fields.length > 1 ? 's' : ''} · ${fmt(total)} ha${a.area ? ` of ${fmt(Number(a.area))} ha` : ''}</span></div>
        <p class="onb-note">${icon('upload', 'ico-sm')} Faster: <button class="link-btn inline" data-onb="go" data-to="upload">upload your CAP declaration</button> and the agent fills this in.</p>`;
    } else if (step === 'history') {
      body = `<p class="muted">Which crop did each field carry last season, and how did it yield? Skip what you don't know.</p>
        <div class="ftable">${a.fields.filter((f) => f.name).map((f) => `<div class="frow frow-2"><b>${esc(f.name)}</b>
          <select aria-label="Crop 2025"><option>Crop 2025…</option>${CROP_OPTIONS.map((c) => `<option>${esc(cropName(c))}</option>`).join('')}</select>
          <input type="number" inputmode="decimal" placeholder="t/ha" aria-label="Yield"></div>`).join('') || '<p class="muted small">Add your fields first.</p>'}</div>`;
    } else if (step === 'cap') {
      body = `${input('cap', 'CAP/PAC application number', 'placeholder="Optional" autocomplete="off"')}
        <label class="drop small-drop">${icon('upload', 'drop-ico')}<b>Upload last CAP declaration</b><span>PDF or photo of the Telepac summary</span><input type="file" hidden data-onb-files></label>`;
    } else if (step === 'records') {
      body = `<label class="drop small-drop">${icon('upload', 'drop-ico')}<b>Upload farm records</b><span>Spreadsheets, field notebook photos, accounts, soil analyses</span><input type="file" multiple hidden data-onb-files></label>`;
    } else if (step === 'stock') {
      body = `<p class="muted">What is in the shed? DemetrAg warns you before a job runs short.</p>
        <div class="ftable">${['Fertiliser', 'Seed', 'Herbicide'].map((t) => `<div class="frow frow-2"><b>${t}</b><input placeholder="Product" aria-label="${t} product"><input type="number" inputmode="decimal" placeholder="kg or L" aria-label="${t} quantity"></div>`).join('')}</div>`;
    }
    if (ui.files.length && !['basics', 'fields'].includes(step)) body += `<div class="file-list">${ui.files.map((f) => `<div class="file-row">${icon('file', 'ico-sm')}<span class="file-name">${esc(f.name)}</span><span class="pill">${esc(f.kind)}</span></div>`).join('')}</div>`;
    const required = REQUIRED.has(step);
    const last = idx === QUESTION_STEPS.length - 1 || ui.single;
    return `${head(STEP_TITLE[step], ui.single ? 'hub' : prev)}
      ${ui.single ? '' : progress(step)}
      <div class="onb-body">${body}${ui.error ? `<p class="onb-error">${esc(ui.error)}</p>` : ''}</div>
      <div class="onb-foot">
        ${step === 'basics' || step === 'fields' ? '<button class="btn ghost" data-onb="demo">Use demo answers</button>' : ''}
        ${!required && !last ? '<button class="btn ghost" data-onb="skip">Skip</button>' : ''}
        <button class="btn primary" data-onb="next">${last ? 'Finish' : 'Next'}</button>
      </div>`;
  }

  function doneView() {
    const a = ui.answers;
    const fields = a.fields.filter((f) => f.name && Number(f.area) > 0 && f.crop);
    const total = fields.reduce((t, f) => t + Number(f.area), 0);
    const crops = [...new Set(fields.map((f) => f.crop))];
    const optional = QUESTION_STEPS.filter((k) => !REQUIRED.has(k));
    return `${head('Profile ready')}
    <div class="onb-body onb-done">
      <div class="ring big" style="--p:${(2 / 7) * 100}"><span>${fmt((2 / 7) * 100, 0)}%</span></div>
      <h3>${esc(a.name || 'Your farm')}</h3>
      <p class="muted">${fields.length} fields · ${fmt(total)} ha</p>
      <div class="legend center">${crops.map((c) => `<span class="crop-chip"><i style="background:${cropColor(c)}"></i>${esc(cropName(c))}</span>`).join('')}</div>
      <p class="onb-lead">You get weather windows, field notes and an economics estimate today. Add ${optional.map((k) => lowerFirst(STEP_TITLE[k])).join(', ')} any time to unlock more.</p>
    </div>
    <div class="onb-foot"><button class="btn primary" data-onb="open-farm">Open my farm</button></div>`;
  }

  function render() {
    if (!ui) return;
    const views = { start: startView, upload: uploadView, agent: agentView, review: reviewView, hub: hubView, done: doneView };
    const html = (views[ui.step] || questionView)();
    root.innerHTML = `<div class="modal-box onb${sheet ? ' is-sheet' : ''}" role="dialog" aria-modal="true" aria-label="Onboarding">${html}</div>`;
  }

  function runAgent() {
    ui.step = 'agent';
    ui.stage = 0;
    render();
    const tick = () => {
      if (!ui) return;
      ui.stage += 1;
      if (ui.stage >= STAGES.length) { ui.step = 'review'; render(); return; }
      render();
      ui.timer = setTimeout(tick, 900);
    };
    ui.timer = setTimeout(tick, 900);
  }

  function addFiles(list) {
    for (const f of list) ui.files.push({ name: f.name, size: f.size, type: f.type, kind: fileKind(f) });
    render();
  }

  function validate(step) {
    const a = ui.answers;
    if (step === 'basics' && !(Number(a.area) > 0)) return 'Enter the farmed area in hectares.';
    if (step === 'fields') {
      const ok = a.fields.filter((f) => f.name.trim() && Number(f.area) > 0 && f.crop);
      if (!ok.length) return 'Add at least one field with a name, an area and a crop.';
      if (ok.length < a.fields.length) return 'Each field needs a name, an area and a crop (or remove the empty row).';
    }
    return '';
  }

  async function fillDemo() {
    const farm = await loadDemoFarm();
    ui.answers.name = 'Farm FARM-00268';
    ui.answers.area = String(farm.meta.area_ha);
    ui.answers.fields = farm.parcels.map((p) => ({ name: shortId(p.id), area: String(p.area_ha), crop: p.crop }));
    ui.error = '';
    render();
  }

  root.addEventListener('click', (ev) => {
    if (ev.target === root && !sheet) { close(); return; }
    const el = ev.target.closest('[data-onb]');
    if (!el || !ui) return;
    const act = el.dataset.onb;
    ui.error = '';
    if (act === 'close') close();
    else if (act === 'go' || act === 'back') { ui.single = el.dataset.single === '1'; ui.step = el.dataset.to; render(); }
    else if (act === 'remove') { ui.files.splice(Number(el.dataset.i), 1); render(); }
    else if (act === 'agent') runAgent();
    else if (act === 'integrate') { close(); toast('Demo: nothing stored. In the product these records join the farm after your check.'); }
    else if (act === 'organic') { ui.answers.organic = el.dataset.v; render(); }
    else if (act === 'add-field') { ui.answers.fields.push({ name: '', area: '', crop: '' }); render(); }
    else if (act === 'del-field') { ui.answers.fields.splice(Number(el.dataset.i), 1); render(); }
    else if (act === 'demo') fillDemo();
    else if (act === 'skip' || act === 'next') {
      const err = act === 'next' ? validate(ui.step) : '';
      if (err) { ui.error = err; render(); return; }
      if (ui.single) { close(); toast('Demo: saved for the pitch only. Your advice updates once real data is in.'); return; }
      const i = QUESTION_STEPS.indexOf(ui.step);
      ui.step = i === QUESTION_STEPS.length - 1 ? 'done' : QUESTION_STEPS[i + 1];
      render();
    } else if (act === 'open-farm') { close(); onOpenFarm('FARM-00268'); }
  });

  root.addEventListener('input', (ev) => {
    if (!ui) return;
    const el = ev.target;
    if (el.dataset.a) ui.answers[el.dataset.a] = el.value;
    if (el.dataset.f != null) ui.answers.fields[Number(el.dataset.f)][el.dataset.k] = el.value;
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!ui) return;
    if (el.matches('[data-onb-files]') && el.files.length) addFiles(el.files);
    else if (el.dataset.f != null && el.tagName === 'SELECT') { ui.answers.fields[Number(el.dataset.f)][el.dataset.k] = el.value; }
  });

  root.addEventListener('dragover', (ev) => {
    if (!ev.target.closest('[data-drop]')) return;
    ev.preventDefault();
    ev.target.closest('[data-drop]').classList.add('is-over');
  });
  root.addEventListener('dragleave', (ev) => ev.target.closest?.('[data-drop]')?.classList.remove('is-over'));
  root.addEventListener('drop', (ev) => {
    if (!ev.target.closest('[data-drop]') || !ui) return;
    ev.preventDefault();
    addFiles(ev.dataTransfer.files);
  });

  return { open, close, isOpen: () => !root.hidden };
}
