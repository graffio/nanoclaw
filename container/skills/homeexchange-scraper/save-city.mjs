#!/usr/bin/env node
/**
 * Fetches ALL HomeExchange listings for a city and saves to the knowledge base.
 *
 * Strategy: pull everything from the API with minimal filters, tag suitability
 * client-side. Suitable = in a named neighborhood + 4 adult beds + 2BR + not
 * a private room.
 *
 * Usage:
 *   node save-city.mjs --city helsinki
 *   node save-city.mjs --city helsinki --from 2026-07-01 --to 2026-07-15
 *   node save-city.mjs --city helsinki --no-dates    (skip date filtering)
 *
 * Reads city bounds from cities.json. Fetches ALL results (no arbitrary page cap).
 * Writes structured JSON to /workspace/global/knowledge-base/homeexchange/cities/{city}.json
 *
 * Requires HOMEEXCHANGE_PROXY_URL environment variable.
 */

import fs from 'fs';
import { parseArgs } from 'util';

const SKILL_DIR = new URL('.', import.meta.url).pathname;
const CITIES = JSON.parse(fs.readFileSync(`${SKILL_DIR}/cities.json`, 'utf-8'));
const KB_DIR = fs.existsSync('/workspace/global')
  ? '/workspace/global/knowledge-base/homeexchange/cities'
  : `${process.cwd()}/groups/global/knowledge-base/homeexchange/cities`;

const PROXY_URL = process.env.HOMEEXCHANGE_PROXY_URL;
if (!PROXY_URL) {
  console.error('[save-city] HOMEEXCHANGE_PROXY_URL not set.');
  process.exit(1);
}

// --- Helpers ---

function log(...args) {
  console.error('[save-city]', ...args);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Send a progress message to the user via IPC (same mechanism as send_message MCP tool)
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

async function apiFetch(path, { method = 'GET', body = null } = {}) {
  const url = `${PROXY_URL}${path}`;
  const opts = { method, headers: { Accept: 'application/json' } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  log(`${method} ${path}`);
  const response = await fetch(url, opts);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

// --- Search: fetch ALL results ---

async function fetchAll(searchQuery, { pageSize = 2000, delayMs = 200 } = {}) {
  // First request: get total count
  const first = await apiFetch(
    `/search/homes?offset=0&limit=${pageSize}`,
    { method: 'POST', body: searchQuery },
  );

  const total = first.total;
  let allHomes = first.homes || [];
  log(`Total: ${total}, got ${allHomes.length} in first page (limit=${pageSize})`);

  // Fetch remaining pages
  while (allHomes.length < total) {
    await delay(delayMs);
    const data = await apiFetch(
      `/search/homes?offset=${allHomes.length}&limit=${pageSize}`,
      { method: 'POST', body: searchQuery },
    );
    if (!data.homes || data.homes.length === 0) break;
    allHomes = allHomes.concat(data.homes);
    log(`${allHomes.length} of ${total}`);
    sendProgress(`Fetching listings: ${allHomes.length} of ${total}...`);
  }

  return { total, homes: allHomes };
}

// --- Transform a raw API listing into our knowledge-base format ---

function countAdultBeds(bd) {
  if (!bd) return { permanent: 0, putup: 0, total: 0 };
  const permanent = (bd.big_double_bed || 0) * 2
    + (bd.double_bed || 0) * 2
    + (bd.single_bed || 0);
  const putup = (bd.double_bed_up || 0) * 2
    + (bd.single_bed_up || 0);
  return { permanent, putup, total: permanent + putup };
}

function transformListing(raw, cityKey, neighborhoods) {
  const coords = raw.location.coordinates;
  const user = raw.user;
  const beds = raw.beds;
  const titles = raw.translations.title || {};
  const descs = raw.translations.description || {};
  const enDesc = descs.en || {};

  // Assign neighborhood by checking which bounding box contains this point
  let neighborhood = null;
  if (neighborhoods) {
    for (const [key, hood] of Object.entries(neighborhoods)) {
      if (coords.latitude >= hood.s && coords.latitude <= hood.n &&
          coords.longitude >= hood.w && coords.longitude <= hood.e) {
        neighborhood = key;
        break;
      }
    }
  }

  return {
    home_id: raw.homeId,
    user_id: user.userId,
    title: titles.en || Object.values(titles)[0] || `Listing ${raw.homeId}`,
    lat: coords.latitude,
    lon: coords.longitude,
    neighborhood,
    bedrooms: beds.bedroomsCount,
    beds_count: beds.bedsCount,
    bed_details: beds.bedsDetails,
    capacity: raw.capacity,
    gp_per_night: raw.gpPerNight,
    is_verified: raw.isVerified,
    response_rate: user.reactivityLevel,
    reviews: user.reviews,
    rating: user.rating || 0,
    loyalty_badge: user.loyaltyBadge || 0,
    min_nights: raw.minimumOfNights,
    contact_allowed: raw.contactAllowed,
    description: (enDesc.goodFeature || '').slice(0, 500),
    area_description: (enDesc.goodPlace || '').slice(0, 500),
    other_notes: (enDesc.other || '').slice(0, 300),
    thumbnail: (raw.images.home && raw.images.home[0]) || null,
    image_count: raw.images.home ? raw.images.home.length : 0,
    url: `https://www.homeexchange.com/en/listing/${raw.homeId}`,
    adult_beds: countAdultBeds(beds.bedsDetails),
    is_private_room: raw.isPrivateRoom || false,
    already_contacted: (raw.userContext || {}).alreadyContacted || false,
    in_favorites: (raw.userContext || {}).inFavorites || false,
  };
}

// --- Main ---

const { values } = parseArgs({
  options: {
    city: { type: 'string' },
    from: { type: 'string', default: '2026-07-01' },
    to: { type: 'string', default: '2026-08-21' },
    flexibility: { type: 'string', default: '0' },
    reverse: { type: 'string' },
    'no-dates': { type: 'boolean', default: false },
    'page-size': { type: 'string' },
    'delay-ms': { type: 'string' },
  },
  strict: false,
});

if (!values.city) {
  log('Usage: node save-city.mjs --city <city>');
  log('Available cities:', Object.keys(CITIES.cities).join(', '));
  process.exit(1);
}

const cityKey = values.city;
const cityConfig = CITIES.cities[cityKey];
if (!cityConfig) {
  log(`Unknown city: ${cityKey}. Available: ${Object.keys(CITIES.cities).join(', ')}`);
  process.exit(1);
}

const pageSize = values['page-size'] ? parseInt(values['page-size']) : 200;
const delayMs = values['delay-ms'] ? parseInt(values['delay-ms']) : 200;

// Build search query -- minimal filters, pull everything
const searchQuery = {
  search_query: {
    location: {
      bounds: {
        ne: { lat: cityConfig.wide_bounds.n, lon: cityConfig.wide_bounds.e },
        sw: { lat: cityConfig.wide_bounds.s, lon: cityConfig.wide_bounds.w },
      },
    },
    home: { size: { beds: { adults: 1 } } },
    extended: true,
  },
};

if (!values['no-dates']) {
  searchQuery.search_query.calendar = {
    date_ranges: [{ from: values.from, to: values.to }],
    flexibility: parseInt(values.flexibility),
  };
}

if (values.reverse) {
  searchQuery.search_query.reverse = [parseInt(values.reverse)];
}

try {
  log(`Searching ${cityConfig.label}...`);
  log(`Bounds: ${JSON.stringify(cityConfig.wide_bounds)}`);
  log(`Page size: ${pageSize}, delay: ${delayMs}ms`);
  sendProgress(`Searching ${cityConfig.label} listings...`);

  const { total, homes } = await fetchAll(searchQuery, { pageSize, delayMs });
  log(`Got ${homes.length} of ${total} total results`);
  sendProgress(`Fetched ${homes.length} ${cityConfig.label} listings. Filtering and saving...`);

  // Transform all listings and tag suitability client-side
  // Suitable = in a named neighborhood + 4 adult beds + 2BR + not private room
  const listings = homes.map(h => {
    const l = transformListing(h, cityKey, cityConfig.neighborhoods);

    const issues = [];
    if (l.is_private_room) issues.push('private room');
    if (l.adult_beds.total < 4) issues.push(`${l.adult_beds.total} adult beds`);
    if (l.bedrooms < 2) issues.push(`${l.bedrooms}BR`);
    if (!l.neighborhood) issues.push('outside target neighborhoods');

    l.suitable = issues.length === 0;
    l.issues = issues;
    return l;
  });

  const suitable = listings.filter(l => l.suitable);
  log(`${listings.length} total, ${suitable.length} suitable, ${listings.length - suitable.length} have issues`);

  // Neighborhood summary
  const hoodCounts = {};
  for (const l of listings) {
    const key = l.neighborhood || 'other';
    hoodCounts[key] = (hoodCounts[key] || 0) + 1;
  }

  // Build city data
  const cityData = {
    city: cityKey,
    label: cityConfig.label,
    last_scraped: new Date().toISOString(),
    search_params: {
      bounds: cityConfig.wide_bounds,
      dates: values['no-dates'] ? null : `${values.from} to ${values.to}`,
      flexibility: values['no-dates'] ? null : parseInt(values.flexibility),
      reverse: values.reverse ? parseInt(values.reverse) : null,
    },
    total_results: total,
    fetched: listings.length,
    neighborhood_counts: hoodCounts,
    listings,
  };

  // Write to knowledge base
  fs.mkdirSync(KB_DIR, { recursive: true });
  const outPath = `${KB_DIR}/${cityKey}.json`;
  fs.writeFileSync(outPath, JSON.stringify(cityData, null, 2));
  log(`Saved to ${outPath}`);
  sendProgress(`${cityConfig.label}: ${listings.length} listings saved, ${suitable.length} suitable (in neighborhood, 4+ beds, 2+ BR). Ready for enrichment.`);

  // Summary to stdout
  const summary = {
    city: cityKey,
    total_in_area: total,
    fetched: listings.length,
    suitable: suitable.length,
    suitable_filter: 'in named neighborhood AND NOT private_room AND adult_beds >= 4 AND bedrooms >= 2',
    neighborhoods_all: hoodCounts,
    neighborhoods_suitable: Object.fromEntries(
      Object.entries(
        suitable.reduce((acc, l) => { acc[l.neighborhood || 'other'] = (acc[l.neighborhood || 'other'] || 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1])
    ),
    top_suitable: suitable
      .sort((a, b) => (b.response_rate - a.response_rate) || (b.reviews - a.reviews))
      .slice(0, 10)
      .map(l => `${l.home_id} | ${l.bedrooms}BR ${l.adult_beds.permanent}+${l.adult_beds.putup} beds | ${l.response_rate}% resp | ${l.reviews} rev | GP:${l.gp_per_night} | ${l.neighborhood} | ${l.title.slice(0, 40)}`),
  };
  console.log(JSON.stringify(summary, null, 2));

} catch (err) {
  log('Error:', err.message);
  process.exit(1);
}
