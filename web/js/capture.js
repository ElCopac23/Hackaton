// "Log activity" dialog: type or speak a note, the assistant asks for anything
// missing, the farmer checks the exact record, then it updates fields, stock and advice.
import { esc, fmt, fmtQty, fmtLongDate, cropName, cropColor, shortId } from './util.js';
import {
  parseNote, reviewDraft, nextQuestion, applyAnswer, understood, expectedUnit, PRODUCT_TYPES_FOR_OP,
} from './parser.js';
import { product, stockLevel, parcel, areaOf, campaignFor, today, cropsOnFarm, parcelsOfCrop } from './model.js';

const EXAMPLES = [
  'Applied 100 kg of complex fertiliser before wheat sowing for all fields',
  'Sprayed Nuvexa, 1 litre per hectare on the wheat',
  'Harvested maize on field 77 today, 13.5 tonnes per hectare',
  'Sowed barley on fields 73 and 81 today',
  'Do not spray the barley today',
];

// Exact figures for the record check: 100 -> "100", 4.615 -> "4.62", 2163.0 kg -> "2,163 kg".
const num = (v) => (Number.isInteger(Math.round(v * 100) / 100) ? fmt(v, 0) : fmt(v, Math.abs(v) < 10 ? 2 : 1));
const exact = (v, unit) => `${unit === 't' ? fmt(v, 2) : fmt(v, unit === 'L' ? 1 : 0)} ${unit}`;

const OPS = [['fertilisation', 'Fertiliser application'], ['spraying', 'Spraying'], ['sowing', 'Sowing'], ['harvest', 'Harvest']];
const LONG_KEY = 'demetrag-long-voice';
const MAX_RECORDING_MS = 3 * 60 * 1000;

export function createCapture(app) {
  const root = document.getElementById('capture');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let draft = null;
  let messages = [];
  let question = null;
  let pending = '';
  let fromVoice = false;
  let recognition = null;
  let listening = false;
  let stopRequested = false;
  let finalText = '';
  let startedAt = 0;
  let timer = null;
  let longMode = false;
  try { longMode = localStorage.getItem(LONG_KEY) === '1'; } catch { /* default: short recording */ }

  const s = () => app.state;

  function open() {
    draft = null;
    messages = [{ from: 'assistant', html: 'What did you do in the field? Type it or press the microphone and say it. I will ask if something is missing, and nothing is saved until you confirm.' }];
    question = null;
    pending = '';
    fromVoice = false;
    root.hidden = false;
    render();
    root.querySelector('textarea')?.focus();
  }

  function stopListening() {
    stopRequested = true;
    if (recognition && listening) recognition.abort();
    listening = false;
    clearInterval(timer);
  }

  function close() {
    stopListening();
    root.hidden = true;
    root.innerHTML = '';
  }

  function say(html) { messages.push({ from: 'assistant', html }); }

  function advance() {
    if (draft.rejected) {
      say(`<span class="rejected">${esc(draft.rejected)}</span>`);
      draft = null;
      question = null;
      render();
      return;
    }
    draft = reviewDraft(s(), draft);
    question = nextQuestion(s(), draft);
    const got = understood(s(), draft);
    const head = got ? `<span class="got">Understood: ${esc(got)}</span>` : '';
    say(`${head}${esc(question ? question.text : 'Please check the record below. Nothing is saved until you confirm.')}`);
    render();
  }

  function send(text) {
    const value = text.trim();
    if (!value) return;
    const channel = fromVoice ? 'voice' : 'text';
    messages.push({ from: 'farmer', html: esc(value), channel });
    pending = '';
    fromVoice = false;
    draft = parseNote(s(), value);
    draft.channel = channel;
    advance();
  }

  function answer(i) {
    const opt = question.options[i];
    messages.push({ from: 'farmer', html: esc(opt.label), channel: 'tap' });
    draft = applyAnswer(s(), draft, question.key, opt.value);
    advance();
  }

  // Rate per hectare and total, whatever the farmer gave.
  function amounts() {
    const area = areaOf(s(), draft.parcels);
    if (draft.rate == null || !area || !draft.basis) return { area, perHa: null, total: null };
    const perHa = draft.basis === 'per_ha' ? draft.rate : draft.rate / area;
    return { area, perHa, total: perHa * area };
  }

  function blockers() {
    const list = [];
    if (!draft.parcels.length) list.push('choose at least one field');
    if (draft.type !== 'harvest' && !draft.productId) list.push('choose a product');
    if (draft.type !== 'harvest' && draft.rate == null) list.push('enter the amount');
    if (draft.rate != null && !draft.basis) list.push('say whether the amount is per hectare or in total');
    if (draft.unitError) list.push('give the amount in the right unit');
    if (draft.date > today(s())) list.push('the date cannot be in the future');
    return list;
  }

  function recordSummary() {
    const st = s();
    const prod = draft.productId ? product(st, draft.productId) : null;
    const unit = expectedUnit(st, draft) || draft.unit || '';
    const { area, perHa, total } = amounts();
    const rows = [];
    rows.push(['Operation', OPS.find(([v]) => v === draft.type)?.[1] || '–']);
    if (prod) rows.push(['Product', esc(prod.name)]);
    rows.push(['Fields', draft.parcels.length
      ? `${draft.parcels.map((id) => { const p = parcel(st, id); return `<b>${esc(shortId(id))}</b> ${esc(cropName(p.crop))} ${fmt(p.area_ha)} ha`; }).join('<br>')}<br><span class="muted">${draft.parcels.length} field${draft.parcels.length > 1 ? 's' : ''}, ${fmt(area)} ha</span>`
      : '<span class="neg">none selected</span>']);
    rows.push(['Date', `${esc(fmtLongDate(draft.date))}${draft.dateAssumed ? ' <span class="hint">(no date said: today)</span>' : ''}`]);
    if (draft.type === 'harvest' && draft.rate == null) {
      rows.push(['Yield', '<span class="muted">not given</span>']);
    } else {
      rows.push(['Rate', perHa == null ? '<span class="neg">missing</span>' : `<b>${num(perHa)} ${unit}/ha</b>${draft.basis === 'total' ? ` <span class="muted">(${exact(total, unit)} ÷ ${fmt(area, 2)} ha)</span>` : ''}`]);
      rows.push(['Total', total == null ? '<span class="neg">missing</span>' : `<b>${exact(total, unit)}</b>${draft.basis === 'per_ha' ? ` <span class="muted">(${num(perHa)} ${unit}/ha × ${fmt(area, 2)} ha)</span>` : ' <span class="muted">(as you said)</span>'}`]);
    }
    let warn = null;
    if (prod && perHa != null) {
      if (prod.composition) {
        rows.push(['Nutrients', `N ${fmt((prod.composition.n * perHa) / 100, 1)} · P₂O₅ ${fmt((prod.composition.p2o5 * perHa) / 100, 1)} · K₂O ${fmt((prod.composition.k2o * perHa) / 100, 1)} kg/ha`]);
      }
      const before = stockLevel(st, prod.id);
      const after = before - total;
      rows.push(['Stock', `${fmtQty(before, prod.unit)} → <b class="${after < 0 ? 'neg' : ''}">${fmtQty(after, prod.unit)}</b>`]);
      if (after < 0) warn = `That is more than the ${fmtQty(before, prod.unit)} in stock. Check the amount, or the stock record.`;
      const expected = { fertilisation: [20, 800], spraying: [0.05, 8], sowing: [2, 300] }[draft.type];
      if (expected && (perHa < expected[0] || perHa > expected[1])) warn = `${fmt(perHa, 2)} ${prod.unit}/ha is unusual for this product. Check whether the amount is per hectare or in total.`;
    }
    return { rows, warn };
  }

  function confirmCard() {
    const st = s();
    const prod = draft.productId ? product(st, draft.productId) : null;
    const types = PRODUCT_TYPES_FOR_OP[draft.type] || [];
    const products = st.stock.products.filter((p) => types.includes(p.type));
    const unit = expectedUnit(st, draft) || draft.unit || (prod?.unit ?? 'kg');
    const { rows, warn } = recordSummary();
    const blocked = blockers();
    const fieldGroups = cropsOnFarm(st).map((c) => `
      <div class="fg"><span class="fg-crop"><i style="background:${cropColor(c)}"></i>${esc(cropName(c))}</span>
      ${parcelsOfCrop(st, c).map((p) => `<label class="fg-field"><input type="checkbox" data-field="${p.id}" ${draft.parcels.includes(p.id) ? 'checked' : ''}> ${esc(shortId(p.id))} <span>${fmt(p.area_ha)} ha</span></label>`).join('')}</div>`).join('');
    return `<div class="confirm">
      <div class="confirm-grid">
        <label>Operation<select data-k="type">${OPS.map(([v, l]) => `<option value="${v}" ${draft.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${draft.type === 'harvest' ? '<label>Product<input type="text" value="–" disabled></label>' : `
        <label>Product<select data-k="productId">${products.map((p) => `<option value="${p.id}" ${draft.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`}
        <label>${draft.type === 'harvest' ? 'Harvested' : 'Amount'}<span class="amount"><input type="number" step="any" min="0" data-k="rate" value="${draft.rate ?? ''}"><span>${unit}</span>
          <select data-k="basis"><option value="" ${draft.basis ? '' : 'selected'} disabled>per ha or total?</option><option value="per_ha" ${draft.basis === 'per_ha' ? 'selected' : ''}>per hectare</option><option value="total" ${draft.basis === 'total' ? 'selected' : ''}>in total</option></select></span></label>
        <label>Date<input type="date" data-k="date" value="${draft.date}" max="${today(st)}"></label>
      </div>
      <div class="fields-pick"><div class="label">Fields</div>${fieldGroups}</div>
      <div class="record-check">
        <div class="label">You are about to record</div>
        <dl class="confirm-sum">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      </div>
      ${warn ? `<div class="warn">${esc(warn)}</div>` : ''}
      ${blocked.length ? `<div class="warn">Before saving: ${esc(blocked.join('; '))}.</div>` : ''}
      <div class="confirm-note">Saving adds this to ${draft.parcels.length} field timeline${draft.parcels.length === 1 ? '' : 's'}, updates the inventory and refreshes the advice.</div>
      <div class="confirm-actions">
        <button class="btn ghost" data-cap="restart">Start over</button>
        <button class="btn primary" data-cap="save" ${blocked.length ? 'disabled' : ''}>Confirm and save</button>
      </div>
    </div>`;
  }

  function recBar() {
    if (!listening) return '';
    return `<div class="rec-bar"><span class="rec-dot"></span><b>Listening</b> <span id="rec-time">0:00</span>
      <span class="muted">${longMode ? '· long recording: press ■ to stop (3 min max)' : '· stops when you pause'}</span></div>`;
  }

  function render() {
    const complete = draft && !question;
    root.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-label="Log an activity">
      <div class="modal-head"><div><h2>Log an activity</h2><p class="sub">Rule-based assistant · works without an AI service</p></div>
        <button class="icon-btn" data-cap="close" aria-label="Close">✕</button></div>
      <div class="convo">${messages.map((m) => `<div class="msg msg-${m.from}">${m.from === 'farmer' && m.channel === 'voice' ? '<span class="via">🎙 voice</span>' : ''}${m.html}</div>`).join('')}
        ${question ? `<div class="answers">${question.options.map((o, i) => `<button class="chip" data-answer="${i}">${esc(o.label)}</button>`).join('')}</div>` : ''}
      </div>
      ${complete ? confirmCard() : `
      ${recBar()}
      <div class="composer">
        <textarea rows="${longMode ? 3 : 2}" placeholder="e.g. Applied 100 kg per hectare of complex fertiliser on the wheat fields today">${esc(pending)}</textarea>
        <button class="icon-btn mic${listening ? ' is-on' : ''}" data-cap="mic" ${SR ? '' : 'disabled title="Voice input needs Chrome"'} aria-label="${listening ? 'Stop recording' : 'Speak'}">${listening ? '■' : '🎙'}</button>
        <button class="btn primary" data-cap="send">Send</button>
      </div>
      <label class="long-toggle"><input type="checkbox" data-cap-long ${longMode ? 'checked' : ''} ${SR ? '' : 'disabled'}>
        Long recording: keep listening through pauses until I press stop (up to 3 minutes)</label>
      ${draft ? '' : `<div class="examples"><span class="muted small">Try:</span>${EXAMPLES.map((e, i) => `<button class="chip" data-example="${i}">${esc(e)}</button>`).join('')}</div>`}`}
    </div>`;
    const convo = root.querySelector('.convo');
    convo.scrollTop = convo.scrollHeight;
  }

  function tick() {
    const el = root.querySelector('#rec-time');
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    if (el) el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (Date.now() - startedAt > MAX_RECORDING_MS && recognition) { stopRequested = true; recognition.stop(); }
  }

  function finishRecording() {
    listening = false;
    clearInterval(timer);
    const text = pending.trim();
    if (!text) { render(); return; }
    fromVoice = true;
    if (longMode) {
      say('Recording stopped. Check the text, edit it if needed, then press Send.');
      render();
      root.querySelector('textarea')?.focus();
    } else {
      send(text);
    }
  }

  function startRecognition() {
    recognition = new SR();
    recognition.lang = 'en-GB';
    recognition.interimResults = true;
    recognition.continuous = longMode;
    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
        else interim += e.results[i][0].transcript;
      }
      pending = `${finalText}${interim}`.trim();
      const box = root.querySelector('textarea');
      if (box) box.value = pending;
    };
    recognition.onerror = (e) => {
      if (longMode && !stopRequested && e.error === 'no-speech') return; // onend restarts
      if (e.error === 'aborted') return;
      stopRequested = true;
      say(`Voice input stopped (${esc(e.error)}). You can type the note instead.`);
    };
    recognition.onend = () => {
      // Chrome ends a session after a pause; in long mode, keep going until the farmer stops.
      if (longMode && !stopRequested && Date.now() - startedAt < MAX_RECORDING_MS) {
        try { recognition.start(); return; } catch { /* fall through and finish */ }
      }
      finishRecording();
    };
    recognition.start();
  }

  function toggleMic() {
    if (!SR) return;
    if (listening) { stopRequested = true; recognition.stop(); return; }
    finalText = pending ? `${pending} ` : '';
    stopRequested = false;
    listening = true;
    startedAt = Date.now();
    startRecognition();
    render();
    timer = setInterval(tick, 500);
  }

  function save() {
    const st = s();
    const prod = draft.productId ? product(st, draft.productId) : null;
    const { perHa, total } = amounts();
    const stamp = Date.now();
    const events = draft.parcels.map((id) => {
      const p = parcel(st, id);
      const e = {
        id: `cap-${stamp}-${p.short}`, type: draft.type, parcel: id, campaign: campaignFor(st, draft.type, draft.date),
        date: draft.date, status: 'done', source: 'captured', channel: draft.channel || 'text', raw: draft.raw,
      };
      if (draft.type === 'harvest') return { ...e, crop: p.crop, yield_t_ha: perHa };
      Object.assign(e, { productId: prod.id, rate: perHa, unit: `${prod.unit}/ha` });
      if (prod.composition) Object.assign(e, { n: (prod.composition.n * perHa) / 100, p2o5: (prod.composition.p2o5 * perHa) / 100, k2o: (prod.composition.k2o * perHa) / 100, product_type: 'MINERAL' });
      if (draft.type === 'sowing') Object.assign(e, { crop: prod.crop || p.crop, variety: prod.name });
      if (draft.type === 'spraying') Object.assign(e, { product_type: prod.type, active_substance: prod.active_substance });
      return e;
    });
    const adjust = prod ? { [prod.id]: -total } : {};
    const what = draft.type === 'harvest' ? 'Harvest' : prod.name;
    app.commit({ events, adjust, flash: draft.parcels, message: `${what} saved to ${events.length} field${events.length > 1 ? 's' : ''}. Stock and advice updated.` });
    close();
  }

  root.addEventListener('click', (ev) => {
    if (ev.target === root) { close(); return; }
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.example != null) { fromVoice = false; send(EXAMPLES[Number(t.dataset.example)]); return; }
    if (t.dataset.answer != null) { answer(Number(t.dataset.answer)); return; }
    const action = t.dataset.cap;
    if (action === 'close') close();
    if (action === 'send') { if (listening) stopListening(); send(root.querySelector('textarea').value); }
    if (action === 'mic') toggleMic();
    if (action === 'restart') open();
    if (action === 'save') save();
  });

  root.addEventListener('input', (ev) => {
    if (ev.target.tagName === 'TEXTAREA') pending = ev.target.value;
  });

  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && ev.target.tagName === 'TEXTAREA') {
      ev.preventDefault();
      if (listening) stopListening();
      send(ev.target.value);
    }
    if (ev.key === 'Escape') close();
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.hasAttribute('data-cap-long')) {
      longMode = el.checked;
      try { localStorage.setItem(LONG_KEY, longMode ? '1' : '0'); } catch { /* preference kept for this session */ }
      render();
      return;
    }
    if (!draft) return;
    if (el.dataset.field) {
      draft.parcels = el.checked ? [...new Set([...draft.parcels, el.dataset.field])] : draft.parcels.filter((id) => id !== el.dataset.field);
    } else if (el.dataset.k) {
      const k = el.dataset.k;
      if (k === 'rate') {
        draft.rate = el.value === '' ? null : Number(el.value);
        draft.unit = expectedUnit(s(), draft) || draft.unit;
        draft.unitError = null;
      } else {
        draft[k] = el.value;
      }
      if (k === 'basis') draft.basisConflict = false;
      if (k === 'date') draft.dateAssumed = false;
      if (k === 'type' || k === 'productId') {
        const types = PRODUCT_TYPES_FOR_OP[draft.type] || [];
        if (draft.productId && !types.includes(product(s(), draft.productId).type)) draft.productId = null;
        if (!draft.productId && types.length) draft.productId = s().stock.products.find((p) => types.includes(p.type)).id;
        if (draft.type === 'harvest') draft.productId = null;
        if (draft.rate != null) {
          // Re-check the amount against the new product's unit (litres vs kilograms, tonnes for harvests).
          draft.amountRaw = `${fmt(draft.rate, 2)} ${draft.unit}`;
          draft = reviewDraft(s(), draft);
        }
      }
    }
    render();
  });

  return { open, close, isOpen: () => !root.hidden };
}
