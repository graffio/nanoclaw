#!/usr/bin/env node
/**
 * HomeExchange Search Script
 *
 * All requests go through the HE read-only proxy (set via HOMEEXCHANGE_PROXY_URL env var).
 * The proxy handles authentication and blocks write operations.
 * This script never sees credentials or bearer tokens.
 *
 * Usage:
 *   node search.mjs --city london                    # wide search
 *   node search.mjs --city london --hood hampstead    # single neighborhood
 *   node search.mjs --city london --all-hoods         # all neighborhoods separately
 *   node search.mjs --detail 12345                    # single listing details
 *   node search.mjs --calendar 12345                  # listing availability
 *   node search.mjs --alerts 67890                    # user preferred locations
 *   node search.mjs --enrich 12345                    # detail + calendar + alerts in one
 *
 * Outputs JSON to stdout. Logs to stderr.
 */

import fs from 'fs';
import { parseArgs } from 'util';

const SKILL_DIR = new URL('.', import.meta.url).pathname;
const CITIES = JSON.parse(fs.readFileSync(`${SKILL_DIR}/cities.json`, 'utf-8'));
const DEFAULTS = CITIES.search_defaults;

// The proxy URL is injected by the container runner as an env var.
// The proxy handles auth and only allows read operations.
const PROXY_URL = process.env.HOMEEXCHANGE_PROXY_URL;
if (!PROXY_URL) {
  console.error('[homeexchange] HOMEEXCHANGE_PROXY_URL not set. Cannot reach HomeExchange API.');
  process.exit(1);
}

// --- HTTP ---

function log(...args) {
  console.error('[homeexchange]', ...args);
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make an API request through the proxy.
 * The proxy maps paths to the correct upstream:
 *   /api/homes/search  -> www.homeexchange.com
 *   /v1/homes/...      -> api.homeexchange.com
 */
async function apiFetch(path, { method = 'GET', body = null } = {}) {
  const url = `${PROXY_URL}${path}`;

  const opts = {
    method,
    headers: {
      Accept: 'application/json',
    },
  };

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

// --- Search ---

async function searchHomes(bounds, options = {}) {
  const {
    minBeds = DEFAULTS.min_beds,
    pageSize = DEFAULTS.page_size,
    maxPages = DEFAULTS.max_pages,
    delayMs = DEFAULTS.delay_between_requests_ms,
    myHomeId = CITIES.my_home_id,
  } = options;

  const query = {
    search_query: {
      home: { size: { beds: { adults: minBeds } } },
      location: {
        bounds: {
          ne: { lat: bounds.n, lon: bounds.e },
          sw: { lat: bounds.s, lon: bounds.w },
        },
      },
      extended: true,
    },
  };

  // Add reciprocal check if we have our home ID
  if (myHomeId) {
    query.search_query.reverse = [myHomeId];
  }

  let allHomes = [];
  let total = null;
  let page = 0;

  while (page < maxPages) {
    const offset = allHomes.length;
    const data = await apiFetch(
      `/search/homes?offset=${offset}&limit=${pageSize}`,
      { method: 'POST', body: query },
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

// --- Detail endpoints ---

async function getHomeDetails(homeId) {
  return apiFetch(`/v1/homes/${homeId}`);
}

async function getCalendar(homeId) {
  return apiFetch(`/v1/homes/${homeId}/calendar`);
}

async function getUserAlerts(userId) {
  return apiFetch(`/v1/users/${userId}/alerts`);
}

// --- Enrichment ---

async function enrichListing(homeId, { delayMs = DEFAULTS.delay_between_requests_ms } = {}) {
  const details = await getHomeDetails(homeId);
  await delay(delayMs);

  const calendar = await getCalendar(homeId).catch(err => {
    log(`Calendar fetch failed for ${homeId}: ${err.message}`);
    return null;
  });
  await delay(delayMs);

  let alerts = null;
  const userId = details.user_id || details.user?.id;
  if (userId) {
    alerts = await getUserAlerts(userId).catch(err => {
      log(`Alerts fetch failed for user ${userId}: ${err.message}`);
      return null;
    });
  }

  return { details, calendar, alerts };
}

// --- Main ---

const { values } = parseArgs({
  options: {
    city: { type: 'string' },
    hood: { type: 'string' },
    'all-hoods': { type: 'boolean', default: false },
    detail: { type: 'string' },
    calendar: { type: 'string' },
    alerts: { type: 'string' },
    enrich: { type: 'string' },
    'page-size': { type: 'string' },
    'max-pages': { type: 'string' },
    'delay-ms': { type: 'string' },
    'min-beds': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: false,
});

const options = {
  pageSize: values['page-size'] ? parseInt(values['page-size']) : undefined,
  maxPages: values['max-pages'] ? parseInt(values['max-pages']) : undefined,
  delayMs: values['delay-ms'] ? parseInt(values['delay-ms']) : undefined,
  minBeds: values['min-beds'] ? parseInt(values['min-beds']) : undefined,
};

try {
  if (values.detail) {
    const data = await getHomeDetails(values.detail);
    console.log(JSON.stringify(data, null, 2));
  } else if (values.calendar) {
    const data = await getCalendar(values.calendar);
    console.log(JSON.stringify(data, null, 2));
  } else if (values.alerts) {
    const data = await getUserAlerts(values.alerts);
    console.log(JSON.stringify(data, null, 2));
  } else if (values.enrich) {
    const data = await enrichListing(values.enrich, options);
    console.log(JSON.stringify(data, null, 2));
  } else if (values.city) {
    const cityConfig = CITIES.cities[values.city];
    if (!cityConfig) {
      log(`Unknown city: ${values.city}. Available: ${Object.keys(CITIES.cities).join(', ')}`);
      process.exit(1);
    }

    if (values['dry-run']) {
      log('Dry run — showing search configuration:');
      console.log(JSON.stringify({ city: values.city, config: cityConfig, options }, null, 2));
      process.exit(0);
    }

    if (values.hood) {
      const hoodConfig = cityConfig.neighborhoods[values.hood];
      if (!hoodConfig) {
        log(`Unknown neighborhood: ${values.hood}. Available: ${Object.keys(cityConfig.neighborhoods).join(', ')}`);
        process.exit(1);
      }
      log(`Searching ${hoodConfig.label}, ${cityConfig.label}...`);
      const result = await searchHomes(hoodConfig, options);
      console.log(JSON.stringify({ city: values.city, neighborhood: values.hood, ...result }, null, 2));
    } else if (values['all-hoods']) {
      const results = {};
      const hoods = Object.entries(cityConfig.neighborhoods);
      for (let i = 0; i < hoods.length; i++) {
        const [key, config] = hoods[i];
        log(`Searching ${config.label}, ${cityConfig.label}... (${i + 1}/${hoods.length})`);
        results[key] = await searchHomes(config, options);
        if (i < hoods.length - 1) await delay(options.delayMs || DEFAULTS.delay_between_requests_ms);
      }
      console.log(JSON.stringify({ city: values.city, neighborhoods: results }, null, 2));
    } else {
      log(`Searching ${cityConfig.label} (wide bounds)...`);
      const result = await searchHomes(cityConfig.wide_bounds, options);
      console.log(JSON.stringify({ city: values.city, ...result }, null, 2));
    }
  } else {
    log('Usage:');
    log('  node search.mjs --city london');
    log('  node search.mjs --city london --hood hampstead');
    log('  node search.mjs --city london --all-hoods');
    log('  node search.mjs --detail <home_id>');
    log('  node search.mjs --calendar <home_id>');
    log('  node search.mjs --alerts <user_id>');
    log('  node search.mjs --enrich <home_id>');
    log('Available cities:', Object.keys(CITIES.cities).join(', '));
    process.exit(1);
  }
} catch (err) {
  log('Error:', err.message);
  process.exit(1);
}
