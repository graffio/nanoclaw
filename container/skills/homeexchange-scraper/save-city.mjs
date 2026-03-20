#!/usr/bin/env node
/**
 * Fetches HomeExchange listings for a city and saves to the knowledge base.
 *
 * Usage:
 *   node save-city.mjs --city helsinki
 *   node save-city.mjs --city helsinki --from 2026-07-01 --to 2026-07-15 --flexibility 30
 *   node save-city.mjs --city helsinki --reverse 1632849
 *   node save-city.mjs --city helsinki --no-dates    (skip date filtering)
 *
 * Reads city bounds from cities.json. Paginates through all results.
 * Writes structured JSON to /workspace/global/knowledge-base/homeexchange/cities/{city}.json
 *
 * Requires HOMEEXCHANGE_PROXY_URL environment variable.
 */

import fs from 'fs';
import { parseArgs } from 'util';

const SKILL_DIR = new URL('.', import.meta.url).pathname;
const CITIES = JSON.parse(fs.readFileSync(`${SKILL_DIR}/cities.json`, 'utf-8'));
const DEFAULTS = CITIES.search_defaults;
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

// --- Search with pagination ---

async function searchAll(bounds, searchQuery, options) {
  const { pageSize, maxPages, delayMs } = options;
  let allHomes = [];
  let total = null;
  let page = 0;

  while (page < maxPages) {
    const offset = allHomes.length;
    const data = await apiFetch(
      `/search/homes?offset=${offset}&limit=${pageSize}`,
      { method: 'POST', body: searchQuery },
    );

    if (total === null) total = data.total;
    if (!data.homes || data.homes.length === 0) break;

    allHomes = allHomes.concat(data.homes);
    log(`Page ${page + 1}: ${allHomes.length} of ${total}`);

    if (allHomes.length >= total) break;
    page++;
    if (page < maxPages) await delay(delayMs);
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
    'max-pages': { type: 'string' },
    'delay-ms': { type: 'string' },
    'min-beds': { type: 'string' },
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

const options = {
  pageSize: values['page-size'] ? parseInt(values['page-size']) : DEFAULTS.page_size,
  maxPages: values['max-pages'] ? parseInt(values['max-pages']) : DEFAULTS.max_pages,
  delayMs: values['delay-ms'] ? parseInt(values['delay-ms']) : DEFAULTS.delay_between_requests_ms,
  minBeds: values['min-beds'] ? parseInt(values['min-beds']) : DEFAULTS.min_beds,
};

// Build search query
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
  log(`Options: beds=${options.minBeds}, pageSize=${options.pageSize}, maxPages=${options.maxPages}`);

  const { total, homes } = await searchAll(cityConfig.wide_bounds, searchQuery, options);
  log(`Got ${homes.length} of ${total} total results`);

  // Transform all listings and tag suitability
  const listings = homes.map(h => {
    const l = transformListing(h, cityKey, cityConfig.neighborhoods);

    // Reasons this listing might not work
    const issues = [];
    if (!l.is_verified) issues.push('not verified');
    if (!l.contact_allowed) issues.push('contact not allowed');
    if (l.is_private_room) issues.push('private room');
    if (l.adult_beds.total < 5) issues.push(`${l.adult_beds.total} adult beds`);
    if (l.bedrooms < 2) issues.push(`${l.bedrooms}BR`);
    if (l.response_rate < 50) issues.push(`${l.response_rate}% response`);

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
      min_beds: options.minBeds,
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

  // Summary to stdout
  const summary = {
    city: cityKey,
    total_in_area: total,
    fetched: listings.length,
    suitable: suitable.length,
    suitable_filter: 'verified AND contact_allowed AND NOT private_room AND adult_beds >= 5 (permanent + put-up) AND bedrooms >= 2 AND response_rate >= 50%',
    neighborhoods_all: hoodCounts,
    neighborhoods_suitable: Object.fromEntries(
      Object.entries(
        suitable.reduce((acc, l) => { acc[l.neighborhood || 'other'] = (acc[l.neighborhood || 'other'] || 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1])
    ),
    top_suitable: suitable
      .sort((a, b) => (b.response_rate - a.response_rate) || (b.reviews - a.reviews))
      .slice(0, 10)
      .map(l => `${l.home_id} | ${l.bedrooms}BR ${l.adult_beds.permanent}+${l.adult_beds.putup} beds | ${l.response_rate}% resp | ${l.reviews} rev | GP:${l.gp_per_night} | ${l.title.slice(0, 50)}`),
  };
  console.log(JSON.stringify(summary, null, 2));

} catch (err) {
  log('Error:', err.message);
  process.exit(1);
}
