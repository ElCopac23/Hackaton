// What the assistant learns from field notes and photos (rule-based).
// Each note is read for topics, from the tags the farmer picked and from keywords in the text.
// A topic becomes advice for that field (or the whole farm), combined with the forecast and the
// farm's open jobs. Repeated reports of the same topic on a field raise its priority.
import { cropName, fmt, fmtDate, fmtDateRuns, shortId } from './util.js';
import { parcel, cropsOnFarm, year } from './model.js';
import { opWindow, forecastDays } from './rules.js';

export const TOPICS = [
  {
    key: 'pests', label: 'Pests', ops: ['spraying'], category: 'warning',
    words: ['slug', 'slugs', 'aphid', 'aphids', 'beetle', 'beetles', 'flea', 'insect', 'insects', 'pest', 'pests', 'larvae', 'caterpillars?', 'mice', 'voles', 'rabbits?', 'wireworms?', 'leatherjackets?'],
  },
  {
    key: 'disease', label: 'Disease', ops: ['spraying'], category: 'warning',
    words: ['rust', 'mildew', 'septoria', 'fungus', 'fungal', 'disease', 'diseased', 'leaf spots?', 'spots', 'blight', 'mould', 'mold', 'rot', 'rotting'],
  },
  {
    key: 'weeds', label: 'Weeds', ops: ['spraying'], category: 'warning',
    words: ['weeds?', 'weedy', 'black-?grass', 'thistles?', 'volunteers?', 'ryegrass', 'couch', 'cleavers', 'poppies'],
  },
  {
    key: 'water', label: 'Waterlogging', ops: ['sowing', 'harvest', 'spreading'], category: 'warning',
    words: ['waterlogged', 'waterlogging', 'flooded', 'flooding', 'puddles?', 'standing water', 'wet patch(?:es)?', 'drainage', 'boggy', 'too wet'],
  },
  {
    key: 'dry', label: 'Dry soil', ops: ['sowing'], category: 'warning',
    words: ['too dry', 'very dry', 'drought', 'cracked', 'cracks', 'dusty', 'dry seedbed'],
  },
  {
    key: 'emergence', label: 'Emergence', ops: ['sowing'], category: 'warning',
    words: ['emergence', 'gaps', 'patchy', 'poor establishment', 'not emerged', 'bare patch(?:es)?', 'uneven'],
  },
  {
    key: 'machinery', label: 'Machinery', ops: ['harvest', 'spreading', 'sowing', 'spraying'], category: 'alert',
    words: ['broke', 'broken', 'breakdown', 'broken down', 'leak', 'leaking', 'puncture', 'flat tyre', 'fault', 'faulty', 'not working', 'damaged', 'blocked'],
  },
];

export const NOTE_TAGS = [...TOPICS.map((t) => t.label), 'Crop looks good', 'Other'];

const wordRe = (t) => new RegExp(`\\b(?:${t.words.join('|')})\\b`, 'i');

export function noteTopics(note) {
  const tags = (note.tags || []).map((x) => x.toLowerCase());
  return TOPICS.filter((t) => tags.includes(t.label.toLowerCase()) || wordRe(t).test(note.text || ''));
}

export const noteWhere = (s, note) => (note.target && note.target !== 'farm'
  ? `${shortId(note.target)} (${cropName(parcel(s, note.target).crop).toLowerCase()})`
  : 'the farm');

function excerpt(text, max = 140) {
  const t = (text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function adviceFor(s, topic, note, where) {
  const days = forecastDays(s);
  const heavy = days.filter((d) => d.precip_mm >= 5);
  const spray = opWindow(s, 'spraying').good;
  const sow = opWindow(s, 'sowing').good;
  switch (topic.key) {
    case 'pests': {
      const slugs = /\bslugs?\b/i.test(note.text || '');
      if (slugs && heavy.length) return [`Rain on ${fmtDate(heavy[0].date)} favours slugs: check ${where} again after it, then decide on treatment with your adviser.`];
      return [`Check ${where} again in 3–4 days and count before treating. Calm, dry spraying days: ${fmtDateRuns(spray)}.`];
    }
    case 'disease':
      return [`Check how much of ${where} is affected. Calm, dry spraying days: ${fmtDateRuns(spray)}.`];
    case 'weeds':
      return [`Plan weed control on ${where} with the post-sowing herbicide. Calm, dry spraying days: ${fmtDateRuns(spray)}.`];
    case 'water':
      return [`Keep machinery off ${where} until it drains; suitable sowing days: ${fmtDateRuns(sow)}.`, 'Mark the wet area for a drainage check after harvest.'];
    case 'dry':
      return [heavy.length ? `Rain is forecast on ${fmtDate(heavy[0].date)} (${fmt(heavy[0].precip_mm)} mm): sowing just before it helps emergence.` : 'No significant rain forecast: consider rolling after sowing to keep moisture.'];
    case 'emergence':
      return [`Re-check ${where} in 7–10 days; if gaps persist, consider re-drilling them.`];
    case 'machinery':
      return [`Fix it before the next field days (${fmtDateRuns(sow)}): the autumn plan has little slack.`];
    default:
      return [];
  }
}

// One recommendation per (note, topic). Tagged like the other recommendations so the
// Recommendations filters apply.
export function noteInsights(s) {
  const notes = [...(s.notes || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const season = s.assumptions.autumn_plan.season;
  const allCrops = cropsOnFarm(s);
  const allFields = s.farm.parcels.map((p) => p.id);
  const out = [];
  for (const note of notes) {
    const where = noteWhere(s, note);
    const onField = note.target && note.target !== 'farm';
    for (const topic of noteTopics(note)) {
      const repeats = notes.filter((n) => n.target === note.target && noteTopics(n).some((t) => t.key === topic.key)).length;
      const lines = [`“${excerpt(note.text) || 'Photo without text'}”${note.photo ? ' · photo attached' : ''}`, ...adviceFor(s, topic, note, where)];
      if (repeats > 1) lines.push(`${repeats} reports of ${topic.label.toLowerCase()} on ${where} so far: worth a closer look.`);
      out.push({
        id: `note-${note.id}-${topic.key}`, kind: 'note', category: topic.category,
        priority: (topic.category === 'alert' ? 78 : 66) + Math.min(repeats, 3),
        title: `${onField ? shortId(note.target) : 'Farm'}: ${topic.label.toLowerCase()} reported${note.date ? ` (${fmtDate(note.date)})` : ''}`,
        lines, sources: ['note', 'rule'], photo: note.photo || null, noteId: note.id, topic: topic.key,
        crops: onField ? [parcel(s, note.target).crop] : allCrops, ops: topic.ops,
        seasons: [year(s), season], products: [], parcels: onField ? [note.target] : allFields,
        crop: onField ? parcel(s, note.target).crop : null,
      });
    }
  }
  return out;
}

// Notes for one field (and farm-wide notes), newest first.
export function notesFor(s, parcelId) {
  return [...(s.notes || [])]
    .filter((n) => n.target === parcelId || (parcelId === 'farm' && n.target === 'farm'))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

// Everything the farmer wrote or photographed, newest first: notes from the phone and the farm
// home, plus the farm's field annotations (simulated for the demo).
export function allNotes(s) {
  const own = (s.notes || []).map((n) => ({
    ...n, parcel: n.target && n.target !== 'farm' ? n.target : null, source: 'captured',
    kind: n.device === 'phone' ? 'Phone' : 'Farm home', when: n.created_at || n.date || '',
  }));
  const annotations = (s.assumptions.simulated_notes || []).map((n, i) => ({
    ...n, id: `sim-${i}`, target: n.parcel || 'farm', tags: [], photo: null, source: 'simulated', when: n.date,
  }));
  return [...own, ...annotations].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.when.localeCompare(a.when));
}
