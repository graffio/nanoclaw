#!/usr/bin/env node
/**
 * Generates an interactive HTML report with map + table for a city.
 * Map markers and table rows are linked — click one, the other highlights.
 *
 * Usage:
 *   node report-map.mjs --city helsinki
 *   node report-map.mjs --city helsinki --all    (include unsuitable listings)
 *   node report-map.mjs --city helsinki --open   (open in browser after generating)
 *
 * Outputs to: knowledge-base/homeexchange/reports/{city}.html
 */

import fs from 'fs';
import { parseArgs } from 'util';

const KB_DIR = fs.existsSync('/workspace/global')
  ? '/workspace/global/knowledge-base/homeexchange'
  : `${process.cwd()}/groups/global/knowledge-base/homeexchange`;

const SKILL_DIR = new URL('.', import.meta.url).pathname;
const CITIES = JSON.parse(fs.readFileSync(`${SKILL_DIR}/cities.json`, 'utf-8'));

const { values } = parseArgs({
  options: {
    city: { type: 'string' },
    all: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
  },
  strict: false,
});

if (!values.city) {
  console.error('Usage: node report-map.mjs --city <city>');
  process.exit(1);
}

const cityFile = `${KB_DIR}/cities/${values.city}.json`;
if (!fs.existsSync(cityFile)) {
  console.error(`No data for ${values.city}. Run save-city.mjs first.`);
  process.exit(1);
}

const cityData = JSON.parse(fs.readFileSync(cityFile, 'utf-8'));
const cityKey = values.city;
const cityConfig = CITIES.cities[cityKey] || {};

const listings = values.all
  ? cityData.listings
  : cityData.listings.filter(l => l.suitable);

// --- Availability: compute free days in summer window ---

const SUMMER_START = '2026-06-15';
const SUMMER_END = '2026-08-21';

function computeAvailability(l) {
  if (!l.enriched || !l.calendar) return { freeDays: -1, status: 'unknown' };
  const cal = l.calendar;
  if (!cal.calendar_set) return { freeDays: -1, status: 'no calendar' };

  const entries = cal.summer_entries || [];

  // No summer entries at all = they haven't indicated summer availability
  if (entries.length === 0) return { freeDays: -1, status: 'no summer dates' };

  // Check if there are any availability entries (GP ok, reciprocal, or explicit available) vs just booked
  const hasAvailability = entries.some(e => e.type !== 'BOOKED');
  const bookedRanges = entries
    .filter(e => e.type === 'BOOKED')
    .map(e => ({
      from: Math.max(new Date(e.from).getTime(), new Date(SUMMER_START).getTime()),
      to: Math.min(new Date(e.to).getTime(), new Date(SUMMER_END).getTime()),
    }))
    .filter(r => r.to > r.from);

  const totalDays = Math.round((new Date(SUMMER_END) - new Date(SUMMER_START)) / 86400000);
  let bookedDays = 0;
  for (const r of bookedRanges) {
    bookedDays += Math.round((r.to - r.from) / 86400000);
  }
  const freeDays = totalDays - bookedDays;
  const status = freeDays <= 0 ? 'fully booked' : hasAvailability ? 'available' : 'partial';
  return { freeDays, totalDays, status, hasAvailability };
}

// --- Accessibility: can we actually book this? ---
// London = reciprocal target (Jul 29 - Aug 9 window). All other cities = GP only.

function accessScore(l, cityKey) {
  const prefRecip = l.details?.prefers_reciprocal || false;
  const wantsSF = l.reciprocal?.match && l.reciprocal.match !== 'none';

  if (cityKey === 'london') {
    // London: reciprocal is the goal
    if (!prefRecip) return 20;                // GP ok = fallback, still works
    if (prefRecip && wantsSF) return 25;      // reciprocal + wants SF = ideal match
    if (prefRecip && !wantsSF) return 3;      // reciprocal but no SF interest = long shot
    return 10;
  }

  // All other cities: GP only, reciprocal preference is a negative
  if (!prefRecip) return 25;              // GP ok = easy
  if (prefRecip && !wantsSF) return 3;    // reciprocal-preferred, no SF = long shot
  if (prefRecip && wantsSF) return 5;     // reciprocal + wants SF = unlikely this late
  return 10;
}

// --- Rank score heuristic (0-100) ---

function rankScore(l, cityKey) {
  // Availability is dominant: if fully booked, nothing else matters
  const avail = computeAvailability(l);

  if (avail.status === 'fully booked') return 0;

  const access = accessScore(l, cityKey);

  let score = 0;

  // Availability (0-40 pts): most important factor
  if (avail.status === 'no summer dates') {
    score += 5; // haven't set summer calendar = probably not interested
  } else if (avail.status === 'no calendar') {
    score += 10; // no calendar at all = unknown
  } else if (avail.hasAvailability) {
    // They explicitly marked summer availability (GP ok or reciprocal entries)
    score += Math.min(40, Math.round((avail.freeDays / (avail.totalDays || 1)) * 40));
  } else {
    // Only booked entries, gaps are ambiguous
    score += Math.min(25, Math.round((avail.freeDays / (avail.totalDays || 1)) * 25));
  }

  // Accessibility (0-25 pts)
  score += access;

  // Reviews (0-20 pts): trust signal, more important than response rate
  score += Math.min(20, Math.sqrt(l.reviews || 0) * 3);

  // Response rate (0-10 pts): will they reply?
  score += Math.min(10, (l.response_rate || 0) * 0.1);

  // Beds (0-5 pts): minor, already filtered to 4+
  const totalBeds = l.adult_beds?.total || 0;
  score += Math.min(5, (totalBeds - 3) * 2);

  return Math.round(Math.max(0, Math.min(100, score)));
}

listings.forEach(l => { l._rank = rankScore(l, cityKey); });
listings.sort((a, b) => b._rank - a._rank);

// --- Calendar summary ---

function calendarSummary(listing) {
  const cal = listing.calendar;
  if (!cal) return 'not enriched';
  if (!cal.calendar_set) return 'no calendar';

  const entries = cal.summer_entries || [];
  if (entries.length === 0) return 'no summer dates set';

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtRange(e) {
    const from = new Date(e.from);
    const to = new Date(e.to);
    const days = Math.round((to - from) / 86400000);
    return `${months[from.getMonth()]} ${from.getDate()} - ${days}d`;
  }

  // Group by condition, show start date + duration for each
  const groups = {};
  const labels = { BOOKED: 'booked', NON_RECIPROCAL: 'GP ok', RECIPROCAL: 'recip only', AVAILABLE: 'available' };
  for (const e of entries) {
    const label = labels[e.type] || e.type;
    if (!groups[label]) groups[label] = [];
    groups[label].push(fmtRange(e));
  }

  return Object.entries(groups)
    .map(([label, ranges]) => `${label}: ${ranges.join(', ')}`)
    .join('\n');
}

// --- Build HTML ---

const center = cityConfig.center || [listings[0]?.lat || 0, listings[0]?.lon || 0];
const neighborhoods = cityConfig.neighborhoods || {};

const listingsJson = JSON.stringify(listings.map((l, i) => ({
  idx: i,
  id: l.home_id,
  title: l.title,
  lat: l.lat,
  lon: l.lon,
  hood: l.neighborhood || 'other',
  hoodLabel: (neighborhoods[l.neighborhood] || {}).label || l.neighborhood || 'other',
  rank: l._rank,
  br: l.bedrooms,
  perm: l.adult_beds?.permanent ?? '?',
  putup: l.adult_beds?.putup ?? '?',
  cap: l.capacity,
  resp: l.response_rate,
  rev: l.reviews,
  rating: l.rating || 0,
  gp: l.gp_per_night,
  minNights: l.min_nights || 0,
  prefRecip: l.details?.prefers_reciprocal || false,
  cal: calendarSummary(l),
  wishlist: (l.reciprocal?.details || []).map(d => d.place).join(', ') || '',
  thumb: l.thumbnail || '',
  url: `https://www.homeexchange.com/en/listing/${l.home_id}`,
  suitable: l.suitable,
  issues: l.issues || [],
  notes: (l.details?.full_other || l.other_notes || '').slice(0, 200),
})));

const hoodsJson = JSON.stringify(neighborhoods);

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cityData.label} — HomeExchange</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; }

  #map { height: 50vh; min-height: 250px; }
  #table-container { height: 50vh; overflow-y: auto; }

  .header {
    padding: 12px 16px; background: white; border-bottom: 1px solid #e0e0e0;
    display: flex; justify-content: space-between; align-items: center;
  }
  .header h1 { font-size: 16px; font-weight: 600; }
  .header .meta { font-size: 12px; color: #888; }

  #table-container { padding: 0 8px 0; }

  table { width: 100%; border-collapse: collapse; font-size: 12px; background: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  thead th {
    background: #f5f5f5; padding: 8px 6px; text-align: left; font-weight: 600;
    border-bottom: 2px solid #e0e0e0; position: sticky; top: 0; cursor: pointer;
    white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  thead th:hover { background: #eee; }
  tbody td { padding: 6px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  tbody tr { cursor: pointer; transition: background 0.15s; }
  tbody tr:hover { background: #f0f7ff; }
  tbody tr.highlighted { background: #dbeafe; }

  .thumb { width: 60px; height: 45px; object-fit: cover; border-radius: 3px; }
  .title-cell a { color: #1a73e8; text-decoration: none; font-weight: 500; font-size: 12px; }
  .title-cell a:hover { text-decoration: underline; }
  .title-cell .hood { color: #888; font-size: 11px; }
  .beds-perm { font-weight: 600; }
  .beds-putup { color: #888; }
  .cal-cell { font-size: 11px; max-width: 220px; white-space: pre-line; }
  .cal-booked { color: #e53935; }
  .cal-gp { color: #1e88e5; }
  .cal-recip { color: #f9a825; }
  .cal-avail { color: #2e7d32; }
  .cal-unknown { color: #999; }
  .notes-cell { font-size: 11px; color: #666; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
  .wishlist { font-size: 11px; color: #888; }
  .street-view-link { font-size: 10px; color: #888; text-decoration: none; }
  .street-view-link:hover { color: #1a73e8; }
  .resp-high { color: #2e7d32; font-weight: 600; }
  .resp-med { color: #f57f17; }
  .resp-low { color: #c62828; }
  .pref-tag { font-size: 10px; padding: 1px 4px; border-radius: 3px; white-space: nowrap; }
  .pref-recip { background: #fff3e0; color: #e65100; }
  .pref-gp { background: #e8f5e9; color: #2e7d32; }
  .rank-high { color: #2e7d32; font-weight: 700; }
  .rank-med { color: #f57f17; font-weight: 600; }
  .rank-low { color: #999; }
  .hood-cell { font-size: 11px; white-space: nowrap; }
  th.sort-asc::after { content: ' \\25B2'; font-size: 9px; }
  th.sort-desc::after { content: ' \\25BC'; font-size: 9px; }

  .neighborhood-label { background: none !important; border: none !important; box-shadow: none !important; font-size: 10px; font-weight: 600; color: #666; white-space: nowrap; }

  .leaflet-popup-content { font-size: 12px; line-height: 1.4; }
  .leaflet-popup-content a { color: #1a73e8; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>${cityData.label} — ${listings.length} ${values.all ? '' : 'suitable '}listings</h1>
    <div class="meta">Scraped ${cityData.last_scraped?.slice(0, 10) || '?'} · Enriched ${cityData.last_enriched?.slice(0, 10) || 'no'} · ${cityData.total_in_area || cityData.total_results || '?'} total in area</div>
  </div>
</div>

<div id="map"></div>
<div id="table-container">
<table id="listings-table">
<thead><tr>
  <th data-col="idx">#</th>
  <th data-col="id">ID</th>
  <th></th>
  <th data-col="title">Listing</th>
  <th data-col="hood">Hood</th>
  <th data-col="rank">Rank</th>
  <th data-col="beds">Beds</th>
  <th data-col="resp">Resp</th>
  <th data-col="rev">Rev</th>
  <th data-col="gp">GP/n</th>
  <th data-col="type">Type</th>
  <th data-col="cal">Summer calendar</th>
  <th data-col="notes">Notes</th>
</tr></thead>
<tbody id="listings-body"></tbody>
</table>
</div>

<script>
const LISTINGS = ${listingsJson};
const HOODS = ${hoodsJson};
const CENTER = [${center[0]}, ${center[1]}];
const CITY_LABEL = ${JSON.stringify(cityData.label)};

// --- Map ---
const map = L.map('map').setView(CENTER, 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19,
}).addTo(map);

// Draw neighborhood bounds
Object.entries(HOODS).forEach(([key, h]) => {
  if (!h.n) return;
  L.rectangle([[h.s, h.w], [h.n, h.e]], {
    color: '#888', weight: 1, fillOpacity: 0.03, dashArray: '4',
  }).addTo(map);
  L.marker([(h.n + h.s) / 2, (h.e + h.w) / 2], {
    icon: L.divIcon({ className: 'neighborhood-label', html: h.label || key }),
  }).addTo(map);
});

// Markers
const markers = {};
const defaultColor = '#1a73e8';
const dimColor = '#93b4d4';

function makeIcon(color, size, label) {
  return L.divIcon({
    className: '',
    html: \`<div style="position:relative;width:\${size}px;height:\${size}px;border-radius:50%;background:\${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700">\${label}</div>\`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
  });
}

function highlightIcon(label) {
  return makeIcon('#e53935', 26, label);
}

LISTINGS.forEach((l, i) => {
  const num = String(i + 1);
  const color = l.resp >= 80 ? defaultColor : dimColor;
  const marker = L.marker([l.lat, l.lon], {
    icon: makeIcon(color, 20, num),
    zIndexOffset: l.resp >= 80 ? 1000 : 0,
  }).addTo(map);

  marker.bindPopup(\`
    <strong>\${l.title}</strong><br>
    \${l.br}BR, \${l.perm}+\${l.putup} beds · \${l.resp}% · \${l.rev} rev<br>
    \${l.gp} GP/night · \${l.hood}<br>
    <a href="\${l.url}" target="_blank">View listing</a> ·
    <a href="https://www.google.com/maps/dir/\${l.lat},\${l.lon}/\${CITY_LABEL}/data=!4m2!4m1!3e2" target="_blank">Walking directions</a>
  \`);

  marker.on('click', () => highlightRow(i));
  marker._defaultIcon = makeIcon(color, 20, num);
  markers[i] = marker;
});

// Fit map to markers
if (LISTINGS.length > 0) {
  const bounds = L.latLngBounds(LISTINGS.map(l => [l.lat, l.lon]));
  map.fitBounds(bounds, { padding: [30, 30] });
}

// --- Table ---
const tbody = document.getElementById('listings-body');

function respClass(r) { return r >= 80 ? 'resp-high' : r >= 50 ? 'resp-med' : 'resp-low'; }
function rankClass(r) { return r >= 60 ? 'rank-high' : r >= 40 ? 'rank-med' : 'rank-low'; }

function formatCal(cal) {
  if (!cal || cal === 'not enriched' || cal === 'no calendar') {
    return \`<span class="cal-unknown">\${cal}</span>\`;
  }
  return cal
    .replace(/booked/g, '<span class="cal-booked">booked</span>')
    .replace(/\\bGP\\b/g, '<span class="cal-gp">GP</span>')
    .replace(/recip only/g, '<span class="cal-recip">recip only</span>')
    .replace(/\bavailable\b/g, '<span class="cal-avail">available</span>');
}

function renderTable() {
  tbody.innerHTML = '';
  LISTINGS.forEach((l, i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.onclick = () => highlightRow(i);

    const prefTag = l.prefRecip
      ? '<span class="pref-tag pref-recip">reciprocal</span>'
      : '<span class="pref-tag pref-gp">GP ok</span>';

    const notes = [];
    if (l.minNights > 0) notes.push(\`min \${l.minNights}n\`);
    if (l.gp === 0) notes.push('no GP');
    if (l.wishlist) notes.push(\`wants: \${l.wishlist.slice(0, 60)}\`);
    if (l.notes) notes.push(l.notes.split(/[.\\n]/)[0].slice(0, 80));

    tr.innerHTML = \`
      <td>\${i + 1}</td>
      <td><a href="\${l.url}" target="_blank" style="font-size:11px;color:#888">\${l.id}</a></td>
      <td>\${l.thumb ? \`<img class="thumb" src="\${l.thumb}" loading="lazy">\` : ''}</td>
      <td class="title-cell">
        <a href="\${l.url}" target="_blank">\${l.title.slice(0, 45)}</a><br>
        <a class="street-view-link" href="https://www.google.com/maps/dir/\${l.lat},\${l.lon}/\${CITY_LABEL}/data=!4m2!4m1!3e2" target="_blank">walk to center</a>
      </td>
      <td class="hood-cell">\${l.hoodLabel}</td>
      <td class="\${rankClass(l.rank)}">\${l.rank}</td>
      <td><span class="beds-perm">\${l.br}BR \${l.perm}</span><span class="beds-putup">+\${l.putup}</span></td>
      <td class="\${respClass(l.resp)}">\${l.resp}%</td>
      <td>\${l.rev}</td>
      <td>\${l.gp}</td>
      <td>\${prefTag}</td>
      <td class="cal-cell">\${formatCal(l.cal)}</td>
      <td class="notes-cell">\${notes.join(' · ')}</td>
    \`;
    tbody.appendChild(tr);
  });
}
renderTable();

// --- Interaction ---
let highlightedIdx = null;

function highlightRow(idx) {
  // Reset previous
  if (highlightedIdx !== null) {
    const prevRow = tbody.querySelector(\`tr[data-idx="\${highlightedIdx}"]\`);
    if (prevRow) prevRow.classList.remove('highlighted');
    const prevMarker = markers[highlightedIdx];
    if (prevMarker) prevMarker.setIcon(prevMarker._defaultIcon);
  }

  // Highlight new
  const row = tbody.querySelector(\`tr[data-idx="\${idx}"]\`);
  if (row) {
    row.classList.add('highlighted');
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const marker = markers[idx];
  if (marker) {
    marker.setIcon(highlightIcon(String(idx + 1)));
    marker.openPopup();
    map.panTo(marker.getLatLng(), { animate: true });
  }

  highlightedIdx = idx;
}

// --- Sort ---
let sortCol = null;
let sortDir = 'desc';

const sortKeys = {
  idx: l => l.idx,
  id: l => l.id,
  title: l => l.title.toLowerCase(),
  hood: l => l.hoodLabel.toLowerCase(),
  rank: l => l.rank,
  beds: l => l.perm + l.putup,
  resp: l => l.resp,
  rev: l => l.rev,
  gp: l => l.gp,
  type: l => l.prefRecip ? 1 : 0,
  cal: l => l.cal,
  notes: l => '',
};

document.querySelectorAll('thead th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'title' || col === 'hood' || col === 'cal' ? 'asc' : 'desc';
    }
    const fn = sortKeys[col];
    if (!fn) return;
    LISTINGS.sort((a, b) => {
      const va = fn(a), vb = fn(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    document.querySelectorAll('thead th').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    renderTable();
  });
});
</script>
</body>
</html>`;

// Write
const outDir = `${KB_DIR}/reports`;
fs.mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/${values.city}.html`;
fs.writeFileSync(outPath, html);
console.error(`[report-map] Written to ${outPath}`);
console.log(outPath);
