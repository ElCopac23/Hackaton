// Rule-based parser: turns a typed or spoken field note into a draft record.
// No AI service is used; a language model is on the roadmap.
import { CROPS, cropName, addDays, parseDate, isoDate } from './util.js';
import { today, parcelsOfCrop } from './model.js';

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// "one hundred and fifty" -> "150", "a hundred" -> "100", "one and a half" -> "1.5"
export function wordsToNumbers(text) {
  const words = text.split(/(\s+)/);
  const out = [];
  let i = 0;
  const isNum = (w) => w in UNITS || w in TENS || w === 'hundred' || w === 'thousand';
  while (i < words.length) {
    const w = words[i].toLowerCase();
    const next = (words[i + 2] || '').toLowerCase();
    const startsNumber = isNum(w) || (w === 'a' && (next === 'hundred' || next === 'thousand' || next === 'half'));
    if (!startsNumber || /^\s+$/.test(w)) { out.push(words[i]); i += 1; continue; }
    let total = 0;
    let current = 0;
    let j = i;
    let last = i;
    while (j < words.length) {
      const x = words[j].toLowerCase();
      if (/^\s+$/.test(x)) { j += 1; continue; }
      const after = (words[j + 2] || '').toLowerCase();
      if (x in UNITS) current += UNITS[x];
      else if (x in TENS) current += TENS[x];
      else if (x === 'hundred') current = (current || 1) * 100;
      else if (x === 'thousand') { total += (current || 1) * 1000; current = 0; }
      else if (x === 'a' && (after === 'hundred' || after === 'thousand' || after === 'half')) current += after === 'half' ? 0 : 1;
      else if (x === 'half') current += 0.5;
      else if (x === 'and' && (isNum(after) || after === 'a')) { /* "hundred and fifty" */ }
      else break;
      last = j;
      j += 1;
    }
    out.push(String(total + current));
    i = last + 1;
  }
  return out.join('');
}

const CROP_WORDS = [
  ['oilseed rape', 'RAPE'], ['rapeseed', 'RAPE'], ['colza', 'RAPE'], ['canola', 'RAPE'], ['rape', 'RAPE'],
  ['wheat', 'COWT'], ['barley', 'BARL'], ['maize', 'MAIZ'], ['corn', 'MAIZ'], ['sunflower', 'SUNF'],
];

const OP_WORDS = [
  ['harvest', /\b(harvested|harvesting|harvest|combined)\b/],
  ['spraying', /\b(sprayed|spraying|spray|herbicide|fungicide|insecticide)\b/],
  ['fertilisation', /\b(fertili[sz]ed|fertili[sz]ing|fertili[sz]er|fertili[sz]e|spread|manure|nitrogen)\b/],
  ['sowing', /\b(sowed|sown|sowing|sow|drilled|drilling|drill|planted|seeded)\b/],
];

const TYPE_FOR_PRODUCT = { FERTILISER: 'fertilisation', HERBICIDE: 'spraying', FUNGICIDE: 'spraying', INSECTICIDE: 'spraying', SEED: 'sowing' };
export const PRODUCT_TYPES_FOR_OP = { fertilisation: ['FERTILISER'], spraying: ['HERBICIDE', 'FUNGICIDE', 'INSECTICIDE'], sowing: ['SEED'] };

function findProducts(s, text) {
  const hits = [];
  for (const p of s.stock.products) {
    const names = [p.name.toLowerCase(), ...p.aliases];
    const hit = names.filter((n) => text.includes(n)).sort((a, b) => b.length - a.length)[0];
    if (hit) hits.push({ product: p, len: hit.length });
  }
  if (hits.length) {
    const best = Math.max(...hits.map((h) => h.len));
    const top = hits.filter((h) => h.len === best).map((h) => h.product);
    return { matched: top.length === 1 ? top[0] : null, candidates: top.length > 1 ? top : [] };
  }
  // Brand name only ("nuvexa") -> several candidates, the assistant asks which one.
  const brand = s.stock.products.filter((p) => {
    if (!['HERBICIDE', 'FUNGICIDE', 'INSECTICIDE'].includes(p.type)) return false;
    const first = p.name.toLowerCase().split(' ')[0];
    return first.length > 4 && new RegExp(`\\b${first}\\b`).test(text);
  });
  return { matched: brand.length === 1 ? brand[0] : null, candidates: brand.length > 1 ? brand : [] };
}

function findRate(text) {
  const re = /(\d+(?:[.,]\d+)?)\s*(kilograms?|kilos?|kgs?|tonnes?|tons?|t|litres?|liters?|ltrs?|lt|l)\b(\s*(?:\/\s*ha|per\s+(?:ha|hectare)|an?\s+hectare|each\s+hectare|\/\s*hectare))?/;
  const m = text.match(re);
  if (!m) return null;
  let value = Number(m[1].replace(',', '.'));
  const u = m[2];
  let unit = 'kg';
  if (/^(l|lt|ltrs?|litres?|liters?)$/.test(u)) unit = 'L';
  if (/^(t|tonnes?|tons?)$/.test(u)) { value *= 1000; unit = 'kg'; }
  return { value, unit, perHa: m[3] ? true : null, raw: m[0] };
}

function findDate(s, text) {
  const t = today(s);
  if (/\byesterday\b/.test(text)) return { date: addDays(t, -1), assumed: false };
  if (/\b(today|this morning|this afternoon|this evening|tonight)\b/.test(text)) return { date: t, assumed: false };
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const m = text.match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const target = days.indexOf(m[1]);
    const d = parseDate(t);
    const back = (d.getUTCDay() - target + 7) % 7;
    return { date: isoDate(new Date(d.getTime() - back * 86400000)), assumed: false };
  }
  return { date: t, assumed: true };
}

export function parseNote(s, raw) {
  const text = wordsToNumbers(raw.toLowerCase()).replace(/[’']/g, "'");
  const draft = {
    raw, type: null, productId: null, productCandidates: [], rate: null, unit: null, basis: 'per_ha', basisAssumed: false,
    parcels: [], fieldsAmbiguous: null, crops: [], date: null, dateAssumed: false, yield: null, notes: [],
  };

  const { matched, candidates } = findProducts(s, text);
  if (matched) draft.productId = matched.id;
  draft.productCandidates = candidates.map((p) => p.id);

  if (matched) draft.type = TYPE_FOR_PRODUCT[matched.type];
  else if (candidates.length) draft.type = TYPE_FOR_PRODUCT[candidates[0].type];
  else draft.type = OP_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;

  const rate = findRate(text);
  if (rate && draft.type === 'harvest') {
    draft.yield = rate.unit === 'kg' ? rate.value / 1000 : null;
  } else if (rate) {
    draft.rate = rate.value;
    draft.unit = rate.unit;
    if (rate.perHa === null) draft.basisAssumed = true;
  }

  const crops = [];
  let rest = text;
  for (const [word, code] of CROP_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(rest)) {
      if (!crops.includes(code)) crops.push(code);
      rest = rest.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ');
    }
  }
  draft.crops = crops.filter((c) => s.farm.parcels.some((p) => p.crop === c));

  const ids = new Set();
  const fieldRe = /\b(?:fields?|parcels?|plots?|p)\s*-?\s*((?:\d{2,7}(?:\s*(?:,|and|&)\s*)?)+)/g;
  let m;
  while ((m = fieldRe.exec(text))) {
    for (const n of m[1].match(/\d{2,7}/g)) {
      const hit = s.farm.parcels.find((p) => p.id.endsWith(n));
      if (hit) ids.add(hit.id);
    }
  }
  // "all fields" is ambiguous; "all wheat fields" is not.
  const all = text.match(/\b(all|every|whole)\b(.*?)\b(fields?|parcels?|farm)\b/);
  const allFields = Boolean(all) && !CROP_WORDS.some(([word]) => all[2].includes(word));
  if (ids.size) {
    draft.parcels = [...ids];
  } else if (allFields && draft.crops.length) {
    draft.fieldsAmbiguous = { crops: draft.crops };
  } else if (draft.crops.length) {
    draft.parcels = draft.crops.flatMap((c) => parcelsOfCrop(s, c).map((p) => p.id));
  } else if (allFields) {
    draft.parcels = s.farm.parcels.map((p) => p.id);
  } else if (draft.type === 'sowing' && draft.productId) {
    const crop = s.stock.products.find((p) => p.id === draft.productId).crop;
    draft.crops = [crop];
  }

  const date = findDate(s, text);
  draft.date = date.date;
  draft.dateAssumed = date.assumed;
  return draft;
}

// Next question the assistant asks, or null when the draft is complete.
// Required details: what was done, which product, how much, which fields.
export function nextQuestion(s, draft) {
  if (!draft.type) {
    return {
      key: 'type', text: 'What did you do?',
      options: [['fertilisation', 'Fertilised'], ['spraying', 'Sprayed'], ['sowing', 'Sowed'], ['harvest', 'Harvested']]
        .map(([value, label]) => ({ label, value })),
    };
  }
  if (draft.productCandidates.length && !draft.productId) {
    return {
      key: 'productId', text: 'Which product exactly?',
      options: draft.productCandidates.map((id) => {
        const p = s.stock.products.find((x) => x.id === id);
        return { label: `${p.name} (${p.type.toLowerCase()})`, value: id };
      }),
    };
  }
  if (draft.fieldsAmbiguous) {
    const crops = draft.fieldsAmbiguous.crops;
    const options = crops.map((c) => {
      const n = parcelsOfCrop(s, c).length;
      return { label: `The ${n} ${cropName(c).toLowerCase()} fields`, value: `crop:${c}` };
    });
    options.push({ label: `All ${s.farm.parcels.length} fields`, value: 'all' });
    return { key: 'parcels', text: `"All fields": all ${s.farm.parcels.length} fields on the farm, or only the ${crops.map((c) => cropName(c).toLowerCase()).join(' and ')} fields?`, options };
  }
  if (draft.type !== 'harvest' && !draft.productId) {
    const types = PRODUCT_TYPES_FOR_OP[draft.type] || [];
    let products = s.stock.products.filter((p) => types.includes(p.type));
    if (draft.type === 'sowing' && draft.crops.length) products = products.filter((p) => draft.crops.includes(p.crop));
    return {
      key: 'productId', text: draft.type === 'sowing' ? 'Which seed?' : 'Which product did you use?',
      options: products.slice(0, 6).map((p) => ({ label: p.name, value: p.id })),
    };
  }
  if (!draft.parcels.length) {
    const crops = Object.keys(CROPS).filter((c) => s.farm.parcels.some((p) => p.crop === c));
    const options = crops.map((c) => ({ label: `${cropName(c)} fields (${parcelsOfCrop(s, c).length})`, value: `crop:${c}` }));
    options.push({ label: `All ${s.farm.parcels.length} fields`, value: 'all' });
    return { key: 'parcels', text: 'On which fields?', options };
  }
  if (draft.type !== 'harvest' && draft.rate == null) {
    const p = s.stock.products.find((x) => x.id === draft.productId);
    const unit = p?.unit === 'L' ? 'L' : 'kg';
    let usual = [];
    if (draft.type === 'sowing' && p?.crop) {
      const median = s.farm.history[p.crop].seed_rate_median;
      usual = [median >= 20 ? Math.round(median) : Math.round(median * 10) / 10];
    }
    else if (draft.type === 'fertilisation') usual = [100, 150, 200];
    else usual = [0.5, 1, 1.5];
    return {
      key: 'rate', text: `How much per hectare?${draft.type === 'sowing' ? ' Your usual seed rate is shown first.' : ''}`,
      options: usual.map((v) => ({ label: `${v} ${unit}/ha`, value: { value: v, unit } })),
    };
  }
  return null;
}

export function applyAnswer(s, draft, key, value) {
  const d = { ...draft };
  if (key === 'type') d.type = value;
  if (key === 'productId') {
    d.productId = value;
    d.productCandidates = [];
    const p = s.stock.products.find((x) => x.id === value);
    d.type = TYPE_FOR_PRODUCT[p.type];
  }
  if (key === 'parcels') {
    d.fieldsAmbiguous = null;
    d.parcels = value === 'all' ? s.farm.parcels.map((p) => p.id) : parcelsOfCrop(s, value.slice(5)).map((p) => p.id);
  }
  if (key === 'rate') {
    d.rate = value.value;
    d.unit = value.unit;
    d.basisAssumed = false;
  }
  return d;
}

// Short summary of what the parser understood, shown back to the farmer.
export function understood(s, d) {
  const parts = [];
  const types = { fertilisation: 'fertiliser application', spraying: 'spraying', sowing: 'sowing', harvest: 'harvest' };
  if (d.type) parts.push(types[d.type]);
  if (d.productId) parts.push(s.stock.products.find((p) => p.id === d.productId).name);
  if (d.rate != null) parts.push(`${d.rate} ${d.unit}${d.basis === 'per_ha' ? '/ha' : ' in total'}`);
  if (d.parcels.length) parts.push(`${d.parcels.length} field${d.parcels.length > 1 ? 's' : ''}`);
  return parts.join(' · ');
}
