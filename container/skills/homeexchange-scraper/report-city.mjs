#!/usr/bin/env node
/**
 * Generates a summary report for a city's suitable listings.
 *
 * Usage:
 *   node report-city.mjs --city helsinki              (text table to stdout)
 *   node report-city.mjs --city helsinki --html       (HTML file to knowledge base)
 *   node report-city.mjs --city helsinki --all        (include unsuitable listings too)
 *
 * Reads from the city JSON in the knowledge base.
 */

import fs from 'fs';
import { parseArgs } from 'util';

const KB_DIR = fs.existsSync('/workspace/global')
  ? '/workspace/global/knowledge-base/homeexchange'
  : `${process.cwd()}/groups/global/knowledge-base/homeexchange`;

const { values } = parseArgs({
  options: {
    city: { type: 'string' },
    html: { type: 'boolean', default: false },
    telegram: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
  },
  strict: false,
});

if (!values.city) {
  console.error('Usage: node report-city.mjs --city <city>');
  process.exit(1);
}

const cityFile = `${KB_DIR}/cities/${values.city}.json`;
if (!fs.existsSync(cityFile)) {
  console.error(`No data for ${values.city}. Run save-city.mjs first.`);
  process.exit(1);
}

const cityData = JSON.parse(fs.readFileSync(cityFile, 'utf-8'));

// Select listings
const listings = values.all
  ? cityData.listings
  : cityData.listings.filter(l => l.suitable);

// Sort: enriched first, then by response rate, then reviews
listings.sort((a, b) =>
  (b.enriched ? 1 : 0) - (a.enriched ? 1 : 0) ||
  b.response_rate - a.response_rate ||
  b.reviews - a.reviews
);

// --- Calendar formatting ---

function formatCalendar(listing) {
  const cal = listing.calendar;
  if (!cal) return { summary: 'Not enriched', periods: [] };
  if (!cal.calendar_set) {
    const updated = cal.updated_at ? cal.updated_at.slice(0, 10) : 'never';
    return { summary: `No calendar set (last updated: ${updated})`, periods: [] };
  }

  const entries = cal.summer_entries || [];
  if (entries.length === 0) {
    return { summary: 'No summer entries — likely available all summer', periods: [] };
  }

  const periods = entries
    .sort((a, b) => a.from.localeCompare(b.from))
    .map(e => {
      const from = e.from.slice(5); // MM-DD
      const to = e.to.slice(5);
      const typeLabel = {
        BOOKED: 'booked',
        NON_RECIPROCAL: 'GP only',
        RECIPROCAL: 'reciprocal only',
      }[e.type] || e.type;
      return { from, to, type: typeLabel, raw: e };
    });

  const summary = periods.map(p => `${p.from} to ${p.to}: ${p.type}`).join('; ');
  return { summary, periods };
}

// --- Reciprocal formatting ---

function formatReciprocal(listing) {
  const recip = listing.reciprocal;
  const details = listing.details || {};
  const prefersReciprocal = details.prefers_reciprocal || false;

  if (!recip) return { pref: prefersReciprocal ? 'prefers reciprocal' : 'GP ok', wishlist: '—' };

  const places = (recip.details || []).map(d => d.place).filter(Boolean);
  const wishlist = places.length > 0 ? places.join(', ') : '—';

  return {
    pref: prefersReciprocal ? 'prefers reciprocal' : 'GP ok',
    match: recip.match || 'none',
    wishlist,
  };
}

// --- Bed formatting ---

function formatBeds(listing) {
  const ab = listing.adult_beds;
  if (!ab) return `${listing.bedrooms}BR`;
  return `${listing.bedrooms}BR, ${ab.permanent}+${ab.putup} beds`;
}

// --- Notes / deal-breakers ---

function formatNotes(listing) {
  const notes = [];
  if (listing.min_nights > 0) notes.push(`min ${listing.min_nights} nights`);
  if (listing.gp_per_night === 0) notes.push('no GP');

  const other = listing.details?.full_other || listing.other_notes || '';
  if (other.trim()) notes.push(other.trim());

  return notes;
}

// --- Text output ---

function outputText() {
  const label = values.all ? 'all' : 'suitable';
  console.log(`${cityData.label} — ${listings.length} ${label} listings`);
  if (!values.all) console.log(`Filter: verified, contact allowed, not private room, 5+ adult beds, 2+ BR, 50%+ response`);
  console.log(`Last scraped: ${cityData.last_scraped}`);
  if (cityData.last_enriched) console.log(`Last enriched: ${cityData.last_enriched}`);
  console.log();

  for (const l of listings) {
    const beds = formatBeds(l);
    const cal = formatCalendar(l);
    const recip = formatReciprocal(l);
    const notes = formatNotes(l);

    console.log(`${l.home_id} — ${l.title}`);
    console.log(`  ${beds} | sleeps ${l.capacity} | ${l.response_rate}% response | ${l.reviews} reviews | ${l.rating.toFixed(1)} rating`);
    console.log(`  GP: ${l.gp_per_night}/night | ${recip.pref} | neighborhood: ${l.neighborhood || 'other'}`);
    console.log(`  Calendar: ${cal.summary}`);
    if (recip.wishlist !== '—') console.log(`  Wishlist: ${recip.wishlist}`);
    if (notes.length > 0) console.log(`  Notes: ${notes.join(' | ')}`);
    if (!values.all && l.issues && l.issues.length > 0) console.log(`  Issues: ${l.issues.join(', ')}`);
    console.log(`  https://www.homeexchange.com/en/listing/${l.home_id}`);
    console.log();
  }
}

// --- HTML output ---

function outputHtml() {
  const rows = listings.map(l => {
    const beds = formatBeds(l);
    const cal = formatCalendar(l);
    const recip = formatReciprocal(l);
    const notes = formatNotes(l);

    const calHtml = cal.periods.length > 0
      ? cal.periods.map(p => {
          const color = { booked: '#e53935', 'GP only': '#1e88e5', 'reciprocal only': '#f9a825' }[p.type] || '#666';
          return `<span style="color:${color}">${p.from}→${p.to}: ${p.type}</span>`;
        }).join('<br>')
      : `<span style="color:#999">${cal.summary}</span>`;

    const noteHtml = notes.map(n => `<span style="color:#666">${escapeHtml(n.slice(0, 150))}</span>`).join('<br>');

    const recipHtml = recip.wishlist !== '—'
      ? `${recip.pref}<br><small>${escapeHtml(recip.wishlist)}</small>`
      : recip.pref;

    const thumbHtml = l.thumbnail
      ? `<img src="${l.thumbnail}" style="width:80px;height:60px;object-fit:cover;border-radius:4px">`
      : '';

    return `<tr>
      <td>${thumbHtml}</td>
      <td><a href="https://www.homeexchange.com/en/listing/${l.home_id}" target="_blank"><strong>${escapeHtml(l.title)}</strong></a><br><small>${l.neighborhood || 'other'}</small></td>
      <td>${beds}</td>
      <td>${l.response_rate}%<br>${l.reviews} rev</td>
      <td>${l.gp_per_night}</td>
      <td>${recipHtml}</td>
      <td>${calHtml}</td>
      <td>${noteHtml}</td>
    </tr>`;
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cityData.label} — HomeExchange Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th { background: #f5f5f5; text-align: left; padding: 8px 10px; border-bottom: 2px solid #ddd; white-space: nowrap; }
  td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:hover { background: #fafafa; }
  a { color: #1a73e8; text-decoration: none; }
  a:hover { text-decoration: underline; }
  small { color: #888; }
</style>
</head>
<body>
<h1>${cityData.label} — ${listings.length} ${values.all ? '' : 'suitable '}listings</h1>
<div class="meta">
  ${!values.all ? `Filter: ${cityData.suitable_filter}<br>` : ''}
  Scraped: ${cityData.last_scraped?.slice(0, 10) || '?'} | Enriched: ${cityData.last_enriched?.slice(0, 10) || 'not yet'} | Total in area: ${cityData.total_in_area}
</div>
<table>
<thead><tr>
  <th></th>
  <th>Listing</th>
  <th>Beds</th>
  <th>Response</th>
  <th>GP/n</th>
  <th>Reciprocal</th>
  <th>Summer 2026 calendar</th>
  <th>Notes</th>
</tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</body>
</html>`;

  const outPath = `${KB_DIR}/reports/${values.city}.html`;
  fs.mkdirSync(`${KB_DIR}/reports`, { recursive: true });
  fs.writeFileSync(outPath, html);
  console.error(`[report] Written to ${outPath}`);
}

// --- Telegram output (card-style, WhatsApp/Telegram formatting) ---

function outputTelegram() {
  const label = values.all ? 'all' : 'suitable';
  const lines = [];

  lines.push(`*${cityData.label}* — ${listings.length} ${label} listings`);
  lines.push(`_Scraped ${cityData.last_scraped?.slice(0, 10) || '?'} · ${cityData.total_in_area || '?'} total in area_`);
  lines.push('');

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    const beds = formatBeds(l);
    const cal = formatCalendar(l);
    const recip = formatReciprocal(l);
    const notes = formatNotes(l);

    lines.push(`*${i + 1}. ${l.title}* (${l.home_id})`);
    lines.push(`${beds} · ${l.response_rate}% resp · ${l.reviews} rev · ${l.rating ? l.rating.toFixed(1) + ' rating' : 'no rating'}`);
    lines.push(`${l.gp_per_night} GP/night · ${recip.pref}${l.neighborhood ? ' · ' + l.neighborhood : ''}`);

    // Calendar - compact format
    if (cal.periods.length > 0) {
      const calParts = cal.periods.map(p => `${p.from} to ${p.to}: ${p.type}`);
      lines.push(`Calendar: ${calParts.join(', ')}`);
    } else {
      lines.push(`Calendar: ${cal.summary}`);
    }

    // Wishlist if present
    if (recip.wishlist !== '—') {
      lines.push(`Wishlist: ${recip.wishlist}`);
    }

    // Warnings / notes - keep short
    const warnings = [];
    if (l.gp_per_night === 0) warnings.push('no GP');
    if (l.min_nights > 0) warnings.push(`min ${l.min_nights} nights`);
    if (l.title.toLowerCase().includes('no guest')) warnings.push('says no GP in title');

    const otherText = l.details?.full_other || l.other_notes || '';
    if (otherText.trim()) {
      // Extract just the first sentence or 100 chars
      const firstSentence = otherText.trim().split(/[.\n]/)[0].slice(0, 100);
      if (firstSentence) warnings.push(firstSentence);
    }

    if (warnings.length > 0) {
      lines.push(`_${warnings.join(' · ')}_`);
    }

    lines.push(`https://www.homeexchange.com/en/listing/${l.home_id}`);
    lines.push('');
  }

  console.log(lines.join('\n'));
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Run ---

if (values.telegram) {
  outputTelegram();
} else if (values.html) {
  outputHtml();
} else {
  outputText();
}
