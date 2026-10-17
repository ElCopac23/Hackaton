// Schematic field map. Parcels in the dataset are squares on a local metre grid
// with no real location, so the map is drawn as a layout, enlarged to stay readable.
import { CROPS, esc, fmt, cropName, shortId } from './util.js';
import { parcelStatus, ndviFor } from './model.js';

function layout(parcels) {
  const items = parcels.map((p) => ({ p, cx: p.x + p.side_m / 2, cy: p.y + p.side_m / 2, side: p.side_m }));
  // Enlarge every square by the same factor so the median field spans ~14% of the farm,
  // then push overlapping squares apart. Positions stay roughly where the data puts them.
  const extent = Math.max(
    Math.max(...items.map((it) => it.cx)) - Math.min(...items.map((it) => it.cx)),
    Math.max(...items.map((it) => it.cy)) - Math.min(...items.map((it) => it.cy)),
  );
  const sides = items.map((it) => it.side).sort((a, b) => a - b);
  const k = (0.17 * extent) / sides[Math.floor(sides.length / 2)];
  const gap = 0.012 * extent;
  for (let round = 0; round < 80; round += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        const need = ((a.side + b.side) * k) / 2 + gap;
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const ox = need - Math.abs(dx);
        const oy = need - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) {
            const shift = (ox / 2) * (dx >= 0 ? 1 : -1);
            a.cx -= shift;
            b.cx += shift;
          } else {
            const shift = (oy / 2) * (dy >= 0 ? 1 : -1);
            a.cy -= shift;
            b.cy += shift;
          }
        }
      }
    }
    if (!moved) break;
  }
  const half = (it) => (it.side * k) / 2;
  const minX = Math.min(...items.map((it) => it.cx - half(it)));
  const maxX = Math.max(...items.map((it) => it.cx + half(it)));
  const minY = Math.min(...items.map((it) => it.cy - half(it)));
  const maxY = Math.max(...items.map((it) => it.cy + half(it)));
  const pad = 0.04 * extent;
  return {
    k,
    viewBox: `${minX - pad} 0 ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`,
    rects: items.map((it) => ({
      ...it, s: it.side * k, x: it.cx - half(it), y: maxY + pad - (it.cy + half(it)),
    })),
  };
}

export function ndviColor(v) {
  const stops = [[0.1, [196, 69, 47]], [0.3, [232, 184, 58]], [0.6, [62, 139, 90]]];
  const t = Math.max(stops[0][0], Math.min(stops[2][0], v));
  const [a, b] = t <= stops[1][0] ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const f = (t - a[0]) / (b[0] - a[0]);
  const c = a[1].map((x, i) => Math.round(x + (b[1][i] - x) * f));
  return `rgb(${c.join(',')})`;
}

const STATUS_MARK = { standing: '▲', 'to-sow': '○', prepared: '◐', sown: '●', fallow: '–' };

export function renderMap(s, { mode = 'crop', selected = null, flash = [] } = {}) {
  const { viewBox, rects } = layout(s.farm.parcels);
  const patterns = Object.entries(CROPS).map(([code, c]) => `
    <pattern id="stub-${code}" patternUnits="userSpaceOnUse" width="36" height="36" patternTransform="rotate(45)">
      <rect width="36" height="36" fill="${c.color}"/><rect width="13" height="36" fill="#fff" opacity="0.42"/>
    </pattern>
    <pattern id="sown-${code}" patternUnits="userSpaceOnUse" width="34" height="34">
      <rect width="34" height="34" fill="${c.color}" opacity="0.55"/><circle cx="17" cy="17" r="5" fill="${c.color}"/>
    </pattern>`).join('');
  const shapes = rects.map((r) => {
    const st = parcelStatus(s, r.p);
    let fill;
    if (mode === 'ndvi') fill = ndviColor(ndviFor(s, r.p).value);
    else if (st.code === 'standing') fill = CROPS[r.p.crop].color;
    else if (st.code === 'sown') fill = `url(#sown-${r.p.crop})`;
    else fill = `url(#stub-${r.p.crop})`;
    const fs = r.s * 0.15;
    const label = mode === 'ndvi' ? fmt(ndviFor(s, r.p).value, 2) : cropName(r.p.crop);
    const cls = ['field', selected === r.p.id ? 'is-selected' : '', flash.includes(r.p.id) ? 'is-flash' : ''].join(' ');
    return `<g class="${cls}" data-parcel="${r.p.id}" tabindex="0" role="button" aria-label="${esc(shortId(r.p.id))} ${esc(cropName(r.p.crop))}">
      <title>${esc(shortId(r.p.id))} · ${esc(cropName(r.p.crop))} · ${fmt(r.p.area_ha)} ha · ${esc(st.label)}</title>
      <rect x="${r.x}" y="${r.y}" width="${r.s}" height="${r.s}" rx="${r.s * 0.04}" fill="${fill}" class="field-shape"/>
      ${st.code === 'prepared' && mode !== 'ndvi' ? `<rect x="${r.x}" y="${r.y}" width="${r.s}" height="${r.s}" rx="${r.s * 0.04}" class="field-prepared"/>` : ''}
      <text x="${r.x + r.s * 0.07}" y="${r.y + r.s * 0.07 + fs}" class="field-id" font-size="${fs * 1.05}">${esc(r.p.short)}</text>
      <text x="${r.x + r.s * 0.07}" y="${r.y + r.s * 0.07 + fs * 2.15}" class="field-crop" font-size="${fs * 0.82}">${esc(label)}</text>
      ${mode === 'ndvi' ? '' : `<text x="${r.x + r.s * 0.93}" y="${r.y + r.s * 0.07 + fs}" class="field-mark" font-size="${fs}" text-anchor="end">${STATUS_MARK[st.code] || ''}</text>`}
    </g>`;
  }).join('');
  return `<svg class="farm-map" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Schematic map of the farm's fields">
    <defs>${patterns}</defs>
    <rect class="map-bg" x="-100000" y="-100000" width="200000" height="200000"/>
    ${shapes}
  </svg>`;
}

export const STATUS_LEGEND = [
  ['▲', 'Standing crop'], ['○', 'Harvested, to sow'], ['◐', 'Fertilised, to sow'], ['●', 'Sown'], ['–', 'Harvested (spring crop)'],
];
