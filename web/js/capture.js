// "Log activity" dialog: type or speak a note, the assistant asks for anything
// missing, the farmer confirms, then the record updates fields, stock and advice.
import { esc, fmt, fmtQty, cropName, cropColor, shortId } from './util.js';
import { parseNote, nextQuestion, applyAnswer, understood, PRODUCT_TYPES_FOR_OP } from './parser.js';
import { product, stockLevel, parcel, areaOf, campaignFor, today, cropsOnFarm, parcelsOfCrop } from './model.js';

const EXAMPLES = [
  'Applied 100 kg of complex fertiliser before wheat sowing for all fields',
  'Sprayed Nuvexa, 1 litre per hectare on the wheat',
  'Harvested maize on field 77 today, 13.5 tonnes per hectare',
  'Sowed barley on fields 73 and 81 today',
];

const OPS = [['fertilisation', 'Fertiliser application'], ['spraying', 'Spraying'], ['sowing', 'Sowing'], ['harvest', 'Harvest']];

export function createCapture(app) {
  const root = document.getElementById('capture');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let draft = null;
  let messages = [];
  let question = null;
  let channel = 'text';
  let recognition = null;
  let listening = false;

  const s = () => app.state;

  function open() {
    draft = null;
    messages = [{ from: 'assistant', html: 'What did you do in the field? Type it or press the microphone and say it. I will ask if something is missing, and nothing is saved until you confirm.' }];
    question = null;
    channel = 'text';
    root.hidden = false;
    render();
    root.querySelector('textarea')?.focus();
  }

  function close() {
    if (recognition && listening) recognition.abort();
    root.hidden = true;
    root.innerHTML = '';
  }

  function say(html) { messages.push({ from: 'assistant', html }); }

  function advance() {
    question = nextQuestion(s(), draft);
    const got = understood(s(), draft);
    if (question) {
      say(`${got ? `<span class="got">Understood: ${esc(got)}</span>` : ''}${esc(question.text)}`);
    } else {
      say(`${got ? `<span class="got">Understood: ${esc(got)}</span>` : ''}Please check the record below and confirm.`);
    }
    render();
  }

  function send(text) {
    const value = text.trim();
    if (!value) return;
    messages.push({ from: 'farmer', html: esc(value), channel });
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

  function perHaRate() {
    if (draft.rate == null) return null;
    const area = areaOf(s(), draft.parcels);
    return draft.basis === 'per_ha' ? draft.rate : draft.rate / area;
  }

  function summary() {
    const area = areaOf(s(), draft.parcels);
    const prod = draft.productId ? product(s(), draft.productId) : null;
    const rows = [['Fields', `${draft.parcels.length} · ${fmt(area)} ha`]];
    if (draft.type === 'harvest') {
      if (draft.yield) rows.push(['Harvested', `${fmt(draft.yield * area, 1)} t (${fmt(draft.yield, 1)} t/ha)`]);
      return { rows, warn: null };
    }
    const per = perHaRate();
    let warn = null;
    if (prod && per != null) {
      const qty = per * area;
      rows.push(['Total product', fmtQty(qty, prod.unit)]);
      if (prod.composition) {
        rows.push(['Nutrients', `N ${fmt((prod.composition.n * per) / 100, 1)} · P₂O₅ ${fmt((prod.composition.p2o5 * per) / 100, 1)} · K₂O ${fmt((prod.composition.k2o * per) / 100, 1)} kg/ha`]);
      }
      const before = stockLevel(s(), prod.id);
      const after = before - qty;
      rows.push(['Stock', `${fmtQty(before, prod.unit)} → <b class="${after < 0 ? 'neg' : ''}">${fmtQty(after, prod.unit)}</b>`]);
      if (after < 0) warn = `That is more than the ${fmtQty(before, prod.unit)} in stock. Check the amount, or the stock record.`;
      const expected = { fertilisation: [20, 800], spraying: [0.05, 8], sowing: [2, 300] }[draft.type];
      if (expected && (per < expected[0] || per > expected[1])) warn = `${fmt(per, 2)} ${prod.unit}/ha is unusual for this product. Is the amount per hectare or for all the fields?`;
    }
    return { rows, warn };
  }

  function confirmCard() {
    const st = s();
    const prod = draft.productId ? product(st, draft.productId) : null;
    const types = PRODUCT_TYPES_FOR_OP[draft.type] || [];
    const products = st.stock.products.filter((p) => types.includes(p.type));
    const { rows, warn } = summary();
    const unit = prod?.unit || (draft.unit === 'L' ? 'L' : 'kg');
    const fieldGroups = cropsOnFarm(st).map((c) => `
      <div class="fg"><span class="fg-crop"><i style="background:${cropColor(c)}"></i>${esc(cropName(c))}</span>
      ${parcelsOfCrop(st, c).map((p) => `<label class="fg-field"><input type="checkbox" data-field="${p.id}" ${draft.parcels.includes(p.id) ? 'checked' : ''}> ${esc(shortId(p.id))} <span>${fmt(p.area_ha)} ha</span></label>`).join('')}</div>`).join('');
    return `<div class="confirm">
      <div class="confirm-grid">
        <label>Operation<select data-k="type">${OPS.map(([v, l]) => `<option value="${v}" ${draft.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${draft.type === 'harvest' ? `<label>Yield (t/ha)<input type="number" step="0.1" min="0" data-k="yield" value="${draft.yield ?? ''}"></label>` : `
        <label>Product<select data-k="productId">${products.map((p) => `<option value="${p.id}" ${draft.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Amount<span class="amount"><input type="number" step="any" min="0" data-k="rate" value="${draft.rate ?? ''}"><span>${unit}</span>
          <select data-k="basis"><option value="per_ha" ${draft.basis === 'per_ha' ? 'selected' : ''}>per hectare</option><option value="total" ${draft.basis === 'total' ? 'selected' : ''}>in total</option></select></span>
          ${draft.basisAssumed ? '<small class="hint">You did not say "per hectare": I assumed it. Change if needed.</small>' : ''}</label>`}
        <label>Date<input type="date" data-k="date" value="${draft.date}" max="${today(st)}">${draft.dateAssumed ? '<small class="hint">No date given: today assumed.</small>' : ''}</label>
      </div>
      <div class="fields-pick"><div class="label">Fields</div>${fieldGroups}</div>
      <dl class="confirm-sum">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      ${warn ? `<div class="warn">${esc(warn)}</div>` : ''}
      <div class="confirm-note">Saving adds this to ${draft.parcels.length} field timeline${draft.parcels.length === 1 ? '' : 's'}, updates the inventory and refreshes the advice.</div>
      <div class="confirm-actions">
        <button class="btn ghost" data-cap="restart">Start over</button>
        <button class="btn primary" data-cap="save" ${draft.parcels.length && (draft.type === 'harvest' || (draft.productId && draft.rate)) ? '' : 'disabled'}>Confirm and save</button>
      </div>
    </div>`;
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
      <div class="composer">
        <textarea rows="2" placeholder="e.g. Applied 100 kg of complex fertiliser on the wheat fields today"></textarea>
        <button class="icon-btn mic${listening ? ' is-on' : ''}" data-cap="mic" ${SR ? '' : 'disabled title="Voice input needs Chrome"'} aria-label="Speak">🎙</button>
        <button class="btn primary" data-cap="send">Send</button>
      </div>
      ${draft ? '' : `<div class="examples"><span class="muted small">Try:</span>${EXAMPLES.map((e, i) => `<button class="chip" data-example="${i}">${esc(e)}</button>`).join('')}</div>`}`}
    </div>`;
    const convo = root.querySelector('.convo');
    convo.scrollTop = convo.scrollHeight;
  }

  function toggleMic() {
    if (!SR) return;
    if (listening) { recognition.stop(); return; }
    recognition = new SR();
    recognition.lang = 'en-GB';
    recognition.interimResults = true;
    let heard = '';
    recognition.onresult = (e) => {
      heard = Array.from(e.results).map((r) => r[0].transcript).join('');
      const box = root.querySelector('textarea');
      if (box) box.value = heard;
    };
    recognition.onerror = (e) => {
      listening = false;
      say(`Voice input stopped (${esc(e.error)}). You can type the note instead.`);
      render();
    };
    recognition.onend = () => {
      listening = false;
      if (heard.trim()) { channel = 'voice'; send(heard); } else render();
    };
    listening = true;
    recognition.start();
    render();
  }

  function save() {
    const st = s();
    const prod = draft.productId ? product(st, draft.productId) : null;
    const per = perHaRate();
    const stamp = Date.now();
    const events = draft.parcels.map((id) => {
      const p = parcel(st, id);
      const e = {
        id: `cap-${stamp}-${p.short}`, type: draft.type, parcel: id, campaign: campaignFor(st, draft.type, draft.date),
        date: draft.date, status: 'done', source: 'captured', channel: draft.channel || 'text', raw: draft.raw,
      };
      if (draft.type === 'harvest') return { ...e, crop: p.crop, yield_t_ha: draft.yield ?? null };
      Object.assign(e, { productId: prod.id, rate: per, unit: `${prod.unit}/ha` });
      if (prod.composition) Object.assign(e, { n: (prod.composition.n * per) / 100, p2o5: (prod.composition.p2o5 * per) / 100, k2o: (prod.composition.k2o * per) / 100, product_type: 'MINERAL' });
      if (draft.type === 'sowing') Object.assign(e, { crop: prod.crop || p.crop, variety: prod.name });
      if (draft.type === 'spraying') Object.assign(e, { product_type: prod.type, active_substance: prod.active_substance });
      return e;
    });
    const adjust = prod ? { [prod.id]: -(per * areaOf(st, draft.parcels)) } : {};
    const what = draft.type === 'harvest' ? 'Harvest' : prod.name;
    app.commit({ events, adjust, flash: draft.parcels, message: `${what} saved to ${events.length} field${events.length > 1 ? 's' : ''}. Stock and advice updated.` });
    close();
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (ev.target === root) { close(); return; }
    if (!t) return;
    if (t.dataset.example != null) { channel = 'text'; send(EXAMPLES[Number(t.dataset.example)]); return; }
    if (t.dataset.answer != null) { answer(Number(t.dataset.answer)); return; }
    const action = t.dataset.cap;
    if (action === 'close') close();
    if (action === 'send') { channel = 'text'; send(root.querySelector('textarea').value); }
    if (action === 'mic') toggleMic();
    if (action === 'restart') open();
    if (action === 'save') save();
  });

  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && ev.target.tagName === 'TEXTAREA') {
      ev.preventDefault();
      channel = 'text';
      send(ev.target.value);
    }
    if (ev.key === 'Escape') close();
  });

  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.field) {
      draft.parcels = el.checked ? [...new Set([...draft.parcels, el.dataset.field])] : draft.parcels.filter((id) => id !== el.dataset.field);
    } else if (el.dataset.k) {
      const k = el.dataset.k;
      if (k === 'rate' || k === 'yield') draft[k] = el.value === '' ? null : Number(el.value);
      else draft[k] = el.value;
      if (k === 'basis') draft.basisAssumed = false;
      if (k === 'date') draft.dateAssumed = false;
      if (k === 'type') {
        const types = PRODUCT_TYPES_FOR_OP[draft.type] || [];
        if (draft.productId && !types.includes(product(s(), draft.productId).type)) draft.productId = null;
        if (!draft.productId && types.length) draft.productId = s().stock.products.find((p) => types.includes(p.type)).id;
      }
    }
    render();
  });

  return { open, close, isOpen: () => !root.hidden };
}

