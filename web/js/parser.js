// Rule-based parser: turns a typed or spoken field note into a draft record.
// No AI service is used; a language model is on the roadmap.
// Rules: only completed work is recorded (negated or planned work is rejected),
// "per hectare" and "in total" must be explicit (otherwise the assistant asks),
// units must match the product, and every field or crop that cannot be matched is flagged.
import { cropName, addDays, parseDate, isoDate, shortId, fmt, fmtQty } from './util.js';
import { today, parcelsOfCrop, parcel, areaOf, product } from './model.js';

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
  ['wheat', 'COWT'], ['barley', 'BARL'], ['maize', 'MAIZ'], ['corn', 'MAIZ'], ['sunflowers?', 'SUNF'],
];
// Crops a farmer might mention that this farm does not grow: flagged, never matched.
const OTHER_CROPS = [
  ['oats?', 'oats'], ['rye', 'rye'], ['triticale', 'triticale'], ['potato(?:es)?', 'potatoes'], ['sugar ?beets?', 'sugar beet'],
  ['soy(?:a|beans?)', 'soya'], ['olives?', 'olives'], ['hay', 'hay'], ['grass(?:land)?', 'grassland'], ['peas', 'peas'], ['vines?', 'vines'],
];

const OP_WORDS = [
  ['harvest', /\b(harvested|harvesting|harvest|combined)\b/],
  ['spraying', /\b(sprayed|spraying|spray|herbicide|fungicide|insecticide)\b/],
  ['fertilisation', /\b(fertili[sz]ed|fertili[sz]ing|fertili[sz]er|fertili[sz]e|spread|manure|nitrogen)\b/],
  ['sowing', /\b(sowed|sown|sowing|sow|drilled|drilling|drill|planted|seeded)\b/],
];

const WORK = '(?:spray(?:ed|ing)?|sow(?:ed|n|ing)?|drill(?:ed|ing)?|plant(?:ed|ing)?|fertili[sz](?:e|ed|ing|er)|spread(?:ing)?|appl(?:y|ied|ying)|harvest(?:ed|ing)?|treat(?:ed|ing)?)';
const NEGATED = [
  new RegExp(`\\b(?:do not|don't|dont|did not|didn't|didnt|does not|doesn't|not|never|no|skip(?:ped)?|cancel(?:l?ed)?|avoid|won't|will not|cannot|can't|could not|couldn't|should not|shouldn't)\\b(?:\\s+[\\w']+){0,3}?\\s+${WORK}\\b`),
  new RegExp(`\\b${WORK}\\b(?:\\s+[\\w']+){0,5}?\\s+(?:cancel(?:l?ed)?|postponed|called off|skipped|not done|did not happen|didn't happen)\\b`),
];
const PLANNED = /\b(will|going to|plan(?:ning)? to|tomorrow|next (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|later today|need(?:s)? to|have to|has to|must)\b/;

const PER_HA = /(\/\s*(?:ha|hectare)\b|\bper\s+(?:ha|hectare)\b|\ban?\s+hectare\b|\beach\s+hectare\b|\bevery\s+hectare\b)/;
const TOTAL = /\b(in total|total of|a total|totall?ing|altogether|all together|overall|in all|for the lot|for all of it|whole lot)\b/;

const TYPE_FOR_PRODUCT = { FERTILISER: 'fertilisation', HERBICIDE: 'spraying', FUNGICIDE: 'spraying', INSECTICIDE: 'spraying', SEED: 'sowing' };
export const PRODUCT_TYPES_FOR_OP = { fertilisation: ['FERTILISER'], spraying: ['HERBICIDE', 'FUNGICIDE', 'INSECTICIDE'], sowing: ['SEED'] };
const UNIT_WORD = { kg: 'kilograms', L: 'litres', t: 'tonnes' };

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

function findAmount(text) {
  const re = /(\d+(?:[.,]\d+)?)\s*(kilograms?|kilos?|kgs?|tonnes?|tons?|t|litres?|liters?|ltrs?|lt|l)\b/;
  const m = text.match(re);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const u = m[2];
  let unit = 'kg';
  if (/^(l|lt|ltrs?|litres?|liters?)$/.test(u)) unit = 'L';
  if (/^(t|tonnes?|tons?)$/.test(u)) unit = 't';
  return { value, unit, raw: m[0] };
}

function findDate(s, text) {
  const t = today(s);
  if (/\byesterday\b/.test(text)) return { date: addDays(t, -1), assumed: false };
  if (/\b(today|this morning|this afternoon|this evening|tonight)\b/.test(text)) return { date: t, assumed: false };
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const m = text.match(/\b(?:on\s+|last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const target = days.indexOf(m[1]);
    const d = parseDate(t);
    const back = (d.getUTCDay() - target + 7) % 7;
    return { date: isoDate(new Date(d.getTime() - back * 86400000)), assumed: false };
  }
  return { date: t, assumed: true };
}

export function parseNote(s, raw) {
  const text = wordsToNumbers(raw.toLowerCase()).replace(/[’`]/g, "'");
  const draft = {
    raw, rejected: null, type: null, productId: null, productCandidates: [],
    rate: null, unit: null, amountRaw: null, basis: null, basisConflict: false, unitError: null,
    parcels: [], fieldsAmbiguous: null, crops: [], unmatched: [], unmatchedResolved: false,
    mismatched: [], mismatchResolved: false, date: null, dateAssumed: false,
  };

  // Only completed work is recorded.
  for (const re of NEGATED) {
    const m = text.match(re);
    if (m) {
      draft.rejected = `Not recorded: “${m[0].trim()}” says the work was not done. I only record completed work. Tell me what you actually did.`;
      return draft;
    }
  }
  const plan = text.match(PLANNED);
  if (plan) {
    draft.rejected = `Not recorded: “${plan[0]}” sounds like a plan, not completed work. Log it again once the work is done.`;
    return draft;
  }

  const { matched, candidates } = findProducts(s, text);
  if (matched) draft.productId = matched.id;
  draft.productCandidates = candidates.map((p) => p.id);
  if (matched) draft.type = TYPE_FOR_PRODUCT[matched.type];
  else if (candidates.length) draft.type = TYPE_FOR_PRODUCT[candidates[0].type];
  else draft.type = OP_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;

  const amount = findAmount(text);
  if (amount) {
    draft.rate = amount.value;
    draft.unit = amount.unit;
    draft.amountRaw = amount.raw;
    const perHa = PER_HA.test(text);
    const total = TOTAL.test(text);
    if (perHa && total) draft.basisConflict = true;
    else if (perHa) draft.basis = 'per_ha';
    else if (total) draft.basis = 'total';
  }

  const crops = [];
  for (const [word, code] of CROP_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text) && !crops.includes(code)) crops.push(code);
  }
  const grown = (c) => s.farm.parcels.some((p) => p.crop === c);
  for (const c of crops.filter((x) => !grown(x))) draft.unmatched.push({ ref: cropName(c).toLowerCase(), reason: 'not grown on this farm' });
  draft.crops = crops.filter(grown);
  for (const [word, name] of OTHER_CROPS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) draft.unmatched.push({ ref: name, reason: 'not grown on this farm' });
  }

  const ids = new Set();
  // Amounts and decimals are removed first so "field 77, 13.5 t" does not read 13 as a field.
  const fieldText = (amount ? text.replace(amount.raw, ' ') : text).replace(/\d+[.,]\d+/g, ' ');
  const fieldRe = /\b(?:fields?|parcels?|plots?|p)\s*-?\s*((?:\d{1,7}(?:\s*(?:,|and|&)\s*)?)+)/g;
  let m;
  while ((m = fieldRe.exec(fieldText))) {
    for (const n of m[1].match(/\d{1,7}/g)) {
      const hit = n.length >= 2 ? s.farm.parcels.find((p) => p.id.endsWith(n)) : null;
      if (hit) ids.add(hit.id);
      else draft.unmatched.push({ ref: `field ${n}`, reason: 'no field with that number on this farm' });
    }
  }
  // "all fields" is ambiguous; "all wheat fields" is not.
  const all = text.match(/\b(all|every|whole)\b(.*?)\b(fields?|parcels?|farm)\b/);
  const allFields = Boolean(all) && !CROP_WORDS.some(([word]) => new RegExp(`\\b${word}\\b`).test(all[2]));
  if (ids.size) {
    draft.parcels = [...ids];
    if (draft.crops.length) draft.mismatched = draft.parcels.filter((id) => !draft.crops.includes(parcel(s, id).crop));
  } else if (allFields && draft.crops.length) {
    draft.fieldsAmbiguous = { crops: draft.crops };
  } else if (draft.crops.length) {
    draft.parcels = draft.crops.flatMap((c) => parcelsOfCrop(s, c).map((p) => p.id));
  } else if (allFields) {
    draft.parcels = s.farm.parcels.map((p) => p.id);
  } else if (draft.type === 'sowing' && draft.productId) {
    draft.crops = [product(s, draft.productId).crop];
  }
  if (!draft.unmatched.length) draft.unmatchedResolved = true;
  if (!draft.mismatched.length) draft.mismatchResolved = true;

  const date = findDate(s, text);
  draft.date = date.date;
  draft.dateAssumed = date.assumed;
  return draft;
}

// Unit the record must use: harvests in tonnes, products in their stock unit.
export function expectedUnit(s, d) {
  if (d.type === 'harvest') return 't';
  return d.productId ? product(s, d.productId).unit : null;
}

// Checks run after every answer: unit compatibility, tonnes for harvests.
export function reviewDraft(s, d) {
  if (d.rate == null) return d;
  const expected = expectedUnit(s, d);
  if (!expected) return d;
  const given = d.unit;
  const solid = (u) => u === 'kg' || u === 't';
  const ok = expected === 'L' ? given === 'L' : solid(given);
  if (!ok) {
    const name = d.type === 'harvest' ? 'A harvest' : product(s, d.productId).name;
    d.unitError = `${name} is recorded in ${UNIT_WORD[expected]}, so “${d.amountRaw}” cannot be used.`;
    d.rate = null;
    d.unit = null;
    d.basis = null;
    d.basisConflict = false;
    return d;
  }
  if (expected === 't' && given === 'kg') { d.rate /= 1000; d.unit = 't'; }
  if (expected === 'kg' && given === 't') { d.rate *= 1000; d.unit = 'kg'; }
  return d;
}

function basisOptions(s, d) {
  const area = areaOf(s, d.parcels);
  const u = d.unit;
  return [
    { label: `${num(d.rate)} ${u} per hectare (${fmtQty(d.rate * area, u)} in total)`, value: 'per_ha' },
    { label: `${num(d.rate)} ${u} in total (${num(d.rate / area)} ${u}/ha)`, value: 'total' },
  ];
}

// 100 -> "100", 0.5 -> "0.5", 4.615 -> "4.62"
const num = (v) => (Number.isInteger(v) ? fmt(v, 0) : fmt(v, Math.abs(v) < 10 ? 2 : 1));

const listOf = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]);

// Next question the assistant asks, or null when the draft is complete.
export function nextQuestion(s, draft) {
  if (draft.rejected) return null;
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
        const p = product(s, id);
        return { label: `${p.name} (${p.type.toLowerCase()})`, value: id };
      }),
    };
  }
  if (!draft.unmatchedResolved) {
    const flagged = draft.unmatched.map((u) => `${u.ref} (${u.reason})`);
    const options = [];
    if (draft.parcels.length) options.push({ label: `Continue with ${draft.parcels.map(shortId).join(', ')}`, value: 'drop' });
    options.push({ label: 'Choose the fields', value: 'choose' });
    return { key: 'unmatched', text: `I could not match ${listOf(flagged)}. Nothing will be recorded for ${draft.unmatched.length > 1 ? 'them' : 'it'}.`, options };
  }
  if (!draft.mismatchResolved) {
    const parts = draft.mismatched.map((id) => `${shortId(id)} grows ${cropName(parcel(s, id).crop).toLowerCase()}`);
    return {
      key: 'mismatch',
      text: `${listOf(parts)}, not ${listOf(draft.crops.map((c) => cropName(c).toLowerCase()))}. Keep ${draft.mismatched.length > 1 ? 'these fields' : 'this field'}?`,
      options: [{ label: 'Keep', value: 'keep' }, { label: 'Remove', value: 'remove' }],
    };
  }
  if (draft.fieldsAmbiguous) {
    const crops = draft.fieldsAmbiguous.crops;
    const options = crops.map((c) => ({ label: `The ${parcelsOfCrop(s, c).length} ${cropName(c).toLowerCase()} fields`, value: `crop:${c}` }));
    options.push({ label: `All ${s.farm.parcels.length} fields`, value: 'all' });
    return { key: 'parcels', text: `"All fields": all ${s.farm.parcels.length} fields on the farm, or only the ${crops.map((c) => cropName(c).toLowerCase()).join(' and ')} fields?`, options };
  }
  if (draft.type !== 'harvest' && !draft.productId) {
    const types = PRODUCT_TYPES_FOR_OP[draft.type] || [];
    let products = s.stock.products.filter((p) => types.includes(p.type));
    // For sowing, offer the seed for the crops named, or else for the crops of the fields named.
    const crops = draft.crops.length ? draft.crops : [...new Set(draft.parcels.map((id) => parcel(s, id).crop))];
    if (draft.type === 'sowing' && crops.length) {
      const matching = products.filter((p) => crops.includes(p.crop));
      if (matching.length) products = matching;
    }
    return {
      key: 'productId', text: draft.type === 'sowing' ? 'Which seed?' : 'Which product did you use?',
      options: products.slice(0, 6).map((p) => ({ label: p.name, value: p.id })),
    };
  }
  if (!draft.parcels.length) {
    const crops = [...new Set(s.farm.parcels.map((p) => p.crop))];
    const options = crops.map((c) => ({ label: `${cropName(c)} fields (${parcelsOfCrop(s, c).length})`, value: `crop:${c}` }));
    options.push({ label: `All ${s.farm.parcels.length} fields`, value: 'all' });
    return { key: 'parcels', text: 'On which fields?', options };
  }
  if (draft.type !== 'harvest' && draft.rate == null) {
    const p = product(s, draft.productId);
    const unit = p.unit;
    let usual;
    if (draft.type === 'sowing') {
      const median = s.farm.history[p.crop].seed_rate_median;
      usual = [median >= 20 ? Math.round(median) : Math.round(median * 10) / 10];
    } else if (draft.type === 'fertilisation') usual = [100, 150, 200];
    else usual = [0.5, 1, 1.5];
    return {
      key: 'rate',
      text: `${draft.unitError ? `${draft.unitError} ` : ''}How much ${p.name} per hectare, in ${UNIT_WORD[unit]}?${draft.type === 'sowing' ? ' Your usual seed rate is shown first.' : ''}`,
      options: usual.map((v) => ({ label: `${v} ${unit}/ha`, value: { value: v, unit } })),
    };
  }
  if (draft.type === 'harvest' && draft.unitError) {
    return {
      key: 'rate', text: `${draft.unitError} How much did you harvest per hectare, in tonnes?`,
      options: [8, 10, 12].map((v) => ({ label: `${v} t/ha`, value: { value: v, unit: 't' } })),
    };
  }
  if (draft.rate != null && (draft.basis == null || draft.basisConflict)) {
    const fields = `${draft.parcels.length} field${draft.parcels.length > 1 ? 's' : ''}`;
    const text = draft.basisConflict
      ? 'You said both "per hectare" and "in total". Which one is right?'
      : `Is ${num(draft.rate)} ${draft.unit} per hectare, or in total for the ${fields} (${fmt(areaOf(s, draft.parcels))} ha)?`;
    return { key: 'basis', text, options: basisOptions(s, draft) };
  }
  return null;
}

export function applyAnswer(s, draft, key, value) {
  const d = { ...draft };
  if (key === 'type') d.type = value;
  if (key === 'productId') {
    d.productId = value;
    d.productCandidates = [];
    d.type = TYPE_FOR_PRODUCT[product(s, value).type];
  }
  if (key === 'unmatched') {
    d.unmatchedResolved = true;
    if (value === 'choose') { d.parcels = []; d.fieldsAmbiguous = null; d.mismatched = []; d.mismatchResolved = true; }
  }
  if (key === 'mismatch') {
    d.mismatchResolved = true;
    if (value === 'remove') d.parcels = d.parcels.filter((id) => !d.mismatched.includes(id));
  }
  if (key === 'parcels') {
    d.fieldsAmbiguous = null;
    d.parcels = value === 'all' ? s.farm.parcels.map((p) => p.id) : parcelsOfCrop(s, value.slice(5)).map((p) => p.id);
  }
  if (key === 'rate') {
    d.rate = value.value;
    d.unit = value.unit;
    d.basis = 'per_ha';
    d.basisConflict = false;
    d.unitError = null;
  }
  if (key === 'basis') {
    d.basis = value;
    d.basisConflict = false;
  }
  return d;
}

// Short summary of what the parser understood, shown back to the farmer.
export function understood(s, d) {
  const parts = [];
  const types = { fertilisation: 'fertiliser application', spraying: 'spraying', sowing: 'sowing', harvest: 'harvest' };
  if (d.type) parts.push(types[d.type]);
  if (d.productId) parts.push(product(s, d.productId).name);
  if (d.rate != null) {
    const basis = d.basisConflict ? ' (per hectare or total?)' : d.basis === 'per_ha' ? '/ha' : d.basis === 'total' ? ' in total' : ' (per hectare or total?)';
    parts.push(`${num(d.rate)} ${d.unit}${basis}`);
  }
  if (d.parcels.length) parts.push(d.parcels.map(shortId).join(', '));
  return parts.join(' · ');
}
