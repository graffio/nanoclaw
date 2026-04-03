#!/usr/bin/env node
/**
 * Enriches suitable listings in a city's knowledge base with:
 *   - Availability calendar
 *   - User travel wishlist (alerts)
 *   - Full home details (features, rules, full description)
 *
 * Usage:
 *   node enrich-city.mjs --city helsinki
 *   node enrich-city.mjs --city helsinki --all          (enrich all listings, not just suitable)
 *   node enrich-city.mjs --city helsinki --force        (re-enrich already enriched listings)
 *   node enrich-city.mjs --city helsinki --delay-ms 3000
 *
 * Reads from and writes back to the city JSON in the knowledge base.
 * Requires HOMEEXCHANGE_PROXY_URL environment variable.
 */

import fs from 'fs';
import { parseArgs } from 'util';

const PROXY_URL = process.env.HOMEEXCHANGE_PROXY_URL;
if (!PROXY_URL) {
  console.error('[enrich] HOMEEXCHANGE_PROXY_URL not set.');
  process.exit(1);
}

const KB_DIR = fs.existsSync('/workspace/global')
  ? '/workspace/global/knowledge-base/homeexchange/cities'
  : `${process.cwd()}/groups/global/knowledge-base/homeexchange/cities`;

// --- Helpers ---

function log(...args) {
  console.error('[enrich]', ...args);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send a progress message to the user via IPC
const IPC_MESSAGES_DIR = '/workspace/ipc/messages';
const CHAT_JID = process.env.NANOCLAW_CHAT_JID;
const GROUP_FOLDER = process.env.NANOCLAW_GROUP_FOLDER;

function sendProgress(text) {
  if (!CHAT_JID || !GROUP_FOLDER) return;
  try {
    fs.mkdirSync(IPC_MESSAGES_DIR, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const filepath = `${IPC_MESSAGES_DIR}/${filename}`;
    const data = { type: 'message', chatJid: CHAT_JID, text, groupFolder: GROUP_FOLDER, timestamp: new Date().toISOString() };
    fs.writeFileSync(`${filepath}.tmp`, JSON.stringify(data));
    fs.renameSync(`${filepath}.tmp`, filepath);
  } catch { /* best effort */ }
}

async function apiFetch(path) {
  const url = `${PROXY_URL}${path}`;
  log(`GET ${path}`);
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

// --- Enrichment functions ---

async function fetchCalendar(homeId) {
  try {
    return await apiFetch(`/v1/homes/${homeId}/calendar`);
  } catch (err) {
    log(`Calendar failed for ${homeId}: ${err.message}`);
    return null;
  }
}

async function fetchAlerts(userId) {
  try {
    return await apiFetch(`/v1/users/${userId}/alerts`);
  } catch (err) {
    log(`Alerts failed for user ${userId}: ${err.message}`);
    return null;
  }
}

async function fetchHomeDetails(homeId) {
  try {
    return await apiFetch(`/v1/homes/${homeId}`);
  } catch (err) {
    log(`Details failed for ${homeId}: ${err.message}`);
    return null;
  }
}

// --- Parse calendar into usable availability windows ---

function parseCalendar(calendarData) {
  if (!calendarData) return null;

  const SUMMER_START = '2026-06-15';
  const SUMMER_END = '2026-08-21';

  // Calendar is { updated_at, data: [{start_on, end_on, type, details}] }
  const updated = calendarData.updated_at || null;
  const entries = calendarData.data || [];

  if (entries.length === 0) {
    return {
      updated_at: updated,
      calendar_set: false,
      summer_entries: [],
      summary: 'No calendar set — availability unknown',
    };
  }

  // Filter to entries that overlap with summer 2026
  const summerEntries = entries.filter(e =>
    e.start_on <= SUMMER_END && e.end_on >= SUMMER_START
  ).map(e => ({
    from: e.start_on,
    to: e.end_on,
    type: e.type,
  }));

  // Types seen: BOOKED, NON_RECIPROCAL, possibly others
  const booked = summerEntries.filter(e => e.type === 'BOOKED');
  const nonReciprocal = summerEntries.filter(e => e.type === 'NON_RECIPROCAL');
  const other = summerEntries.filter(e => e.type !== 'BOOKED' && e.type !== 'NON_RECIPROCAL');

  let summary = '';
  if (summerEntries.length === 0) {
    summary = 'No summer entries — may be available';
  } else {
    const parts = [];
    if (booked.length) parts.push(`${booked.length} booked periods`);
    if (nonReciprocal.length) parts.push(`${nonReciprocal.length} guest-points-only periods`);
    if (other.length) parts.push(`${other.length} other (${other.map(e => e.type).join(', ')})`);
    summary = parts.join(', ');
  }

  return {
    updated_at: updated,
    calendar_set: true,
    summer_entries: summerEntries,
    summary,
  };
}

// --- Parse alerts into reciprocal interest assessment ---

function assessReciprocal(alerts, myLat, myLon) {
  if (!alerts || !Array.isArray(alerts)) return { match: 'unknown', details: [] };

  const SF_LAT = 37.75;
  const SF_LON = -122.42;

  const parsed = alerts.map(alert => {
    const p = alert.params || {};
    const place = p.place || 'unknown';
    const bounds = p.bounds ? p.bounds.split(',').map(Number) : null;

    // Check if SF falls within their alert bounds
    let containsSF = false;
    if (bounds && bounds.length === 4) {
      const [south, west, north, east] = bounds;
      containsSF = SF_LAT >= south && SF_LAT <= north && SF_LON >= west && SF_LON <= east;
    }

    // Classify specificity
    let specificity = 'none';
    const placeLower = place.toLowerCase();
    if (placeLower.includes('san francisco') || placeLower.includes('sf')) {
      specificity = 'exact';
    } else if (placeLower.includes('bay area')) {
      specificity = 'region';
    } else if (placeLower.includes('california') || placeLower.includes('ca')) {
      specificity = 'state';
    } else if (placeLower.includes('united states') || placeLower.includes('usa')) {
      specificity = 'country';
    } else if (containsSF) {
      specificity = 'bounds_overlap';
    }

    return {
      place,
      specificity,
      contains_sf: containsSF,
      capacity_wanted: p.home_capacity || null,
    };
  });

  // Best match level
  const specificities = ['exact', 'region', 'state', 'bounds_overlap', 'country'];
  let bestMatch = 'none';
  for (const level of specificities) {
    if (parsed.some(a => a.specificity === level)) {
      bestMatch = level;
      break;
    }
  }

  return {
    match: bestMatch,
    details: parsed,
  };
}

// --- Extract useful fields from full home details ---

function extractDetails(details) {
  if (!details) return null;

  const desc = (details.descriptions || []).find(d => d.locale === 'en') || details.descriptions?.[0] || {};

  return {
    full_description: desc.good_feature || null,
    full_area_description: desc.good_place || null,
    full_other: desc.other || null,
    features: details.feature || {},
    prefers_reciprocal: details.prefers_reciprocal || false,
    min_nights: details.min_nights || 0,
    size_sqft: details.detail?.localized_size || null,
    size_unit: details.detail?.size_unit || null,
    residence_type: details.detail?.residence_type || null,
    number_of_exchanges: details.user?.number_exchange || 0,
    global_rating: details.global_rating || null,
  };
}

// --- Main ---

const { values } = parseArgs({
  options: {
    city: { type: 'string' },
    all: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'delay-ms': { type: 'string', default: '2000' },
  },
  strict: false,
});

if (!values.city) {
  log('Usage: node enrich-city.mjs --city <city>');
  process.exit(1);
}

const delayMs = parseInt(values['delay-ms']);
const cityFile = `${KB_DIR}/${values.city}.json`;

if (!fs.existsSync(cityFile)) {
  log(`No data for ${values.city}. Run save-city.mjs first.`);
  process.exit(1);
}

const cityData = JSON.parse(fs.readFileSync(cityFile, 'utf-8'));
log(`Loaded ${cityData.listings.length} listings for ${cityData.label}`);

// Select which listings to enrich
const targets = values.all
  ? cityData.listings
  : cityData.listings.filter(l => l.suitable);

const toEnrich = values.force
  ? targets
  : targets.filter(l => !l.enriched);

log(`${toEnrich.length} listings to enrich (${targets.length} candidates, ${targets.length - toEnrich.length} already enriched)`);

if (toEnrich.length === 0) {
  log('Nothing to do.');
  process.exit(0);
}

sendProgress(`Enriching ${toEnrich.length} ${cityData.label} listings (calendar + wishlist + details)...`);

try {
  // Deduplicate user IDs (same user might have multiple listings)
  const alertsCache = {};

  for (let i = 0; i < toEnrich.length; i++) {
    const listing = toEnrich[i];
    log(`\n--- ${i + 1}/${toEnrich.length}: ${listing.home_id} (${listing.title.slice(0, 40)}) ---`);

    // Fetch calendar
    const calendarRaw = await fetchCalendar(listing.home_id);
    listing.calendar = parseCalendar(calendarRaw);
    await delay(delayMs);

    // Fetch alerts (cached by user_id)
    if (!alertsCache[listing.user_id]) {
      const alertsRaw = await fetchAlerts(listing.user_id);
      alertsCache[listing.user_id] = alertsRaw;
      await delay(delayMs);
    }
    listing.reciprocal = assessReciprocal(alertsCache[listing.user_id]);

    // Fetch full details
    const detailsRaw = await fetchHomeDetails(listing.home_id);
    listing.details = extractDetails(detailsRaw);
    await delay(delayMs);

    listing.enriched = true;
    listing.enriched_at = new Date().toISOString();

    // Progress every 5 listings or on the last one
    if ((i + 1) % 5 === 0 || i === toEnrich.length - 1) {
      const recipSoFar = toEnrich.slice(0, i + 1).filter(l => l.reciprocal?.match !== 'none').length;
      sendProgress(`Enriched ${i + 1}/${toEnrich.length} ${cityData.label} listings. ${recipSoFar} want SF so far.`);
    }
  }

  // Write back
  cityData.last_enriched = new Date().toISOString();
  fs.writeFileSync(cityFile, JSON.stringify(cityData, null, 2));
  log(`\nSaved enriched data to ${cityFile}`);

  // Final summary to user
  const enrichedAll = cityData.listings.filter(l => l.enriched);
  const recipAll = enrichedAll.filter(l => l.reciprocal && l.reciprocal.match !== 'none');
  sendProgress(`${cityData.label} enrichment done. ${enrichedAll.length} enriched, ${recipAll.length} want SF. Generating report...`);

  // Summary
  const enriched = cityData.listings.filter(l => l.enriched);
  const reciprocal = enriched.filter(l => l.reciprocal && l.reciprocal.match !== 'none');
  const prefersReciprocal = enriched.filter(l => l.details?.prefers_reciprocal);

  const summary = {
    city: values.city,
    enriched: enriched.length,
    reciprocal_interest: reciprocal.length,
    reciprocal_breakdown: reciprocal.reduce((acc, l) => {
      acc[l.reciprocal.match] = (acc[l.reciprocal.match] || 0) + 1;
      return acc;
    }, {}),
    prefers_reciprocal: prefersReciprocal.length,
    with_calendar: enriched.filter(l => l.calendar).length,
    listings: enriched.map(l => ({
      home_id: l.home_id,
      title: l.title.slice(0, 50),
      reciprocal: l.reciprocal?.match || 'unknown',
      wishlist: (l.reciprocal?.details || []).map(d => d.place).join(', '),
      prefers_reciprocal: l.details?.prefers_reciprocal || false,
      calendar: l.calendar?.summary || 'no data',
    })),
  };
  console.log(JSON.stringify(summary, null, 2));

} catch (err) {
  // Save progress even on error
  fs.writeFileSync(cityFile, JSON.stringify(cityData, null, 2));
  log(`Error: ${err.message} (progress saved)`);
  process.exit(1);
}
