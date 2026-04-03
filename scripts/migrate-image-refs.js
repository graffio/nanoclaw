#!/usr/bin/env node

// Migrate local image references to CDN URLs in existing post files.
// For each post with ../images/ refs, fetches the HTML to get CDN URLs,
// then does in-place replacement. Does NOT regenerate the markdown.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const KB_DIR = path.join(PROJECT_ROOT, 'groups/global/knowledge-base/stephen-tobin');
const POSTS_DIR = path.join(KB_DIR, 'posts');
const BASE_URL = 'https://stephentobin.substack.com';
const RATE_LIMIT_MS = 2000;

const CRED_PATHS = [
  path.join(KB_DIR, 'credentials/substack-cookies.json'),
  path.join(PROJECT_ROOT, 'groups/telegram_main/credentials/substack-cookies.json'),
];

function loadCookies() {
  for (const p of CRED_PATHS) {
    if (fs.existsSync(p)) {
      const creds = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const sid = creds['substack.sid'];
      const lli = creds['substack.lli'];
      if (sid) {
        console.log(`Loaded cookies from ${path.relative(PROJECT_ROOT, p)}`);
        return `substack.sid=${sid}; substack.lli=${lli || ''}`;
      }
    }
  }
  throw new Error('No credentials found');
}

let lastRequestTime = 0;

async function fetchAPI(url, cookieHeader) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) NanoClaw/1.0',
    'Cookie': cookieHeader,
  };
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
    console.warn(`  Rate limited, waiting ${retryAfter}s...`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    lastRequestTime = Date.now();
    const retry = await fetch(url, { headers });
    if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Extract CDN URLs from post HTML in order (same logic as scraper)
function extractImageUrls(html) {
  const urls = [];
  // Match img tags and extract src
  const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (!src || src.includes('pixel') || src.includes('tracking')) continue;
    // Extract S3 URL from Substack CDN proxy URL
    const s3Match = src.match(/https%3A%2F%2Fsubstack-post-media\.s3\.amazonaws\.com[^)&\s"']*/);
    if (s3Match) {
      urls.push(decodeURIComponent(s3Match[0]));
    } else {
      urls.push(src);
    }
  }
  return urls;
}

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const cookieHeader = loadCookies();

  // Find posts with local image references
  const postFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  const needsMigration = [];

  for (const file of postFiles) {
    const content = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8');
    if (content.includes('../images/')) {
      needsMigration.push(file);
    }
  }

  console.log(`Found ${needsMigration.length} posts with local image references`);
  if (dryRun) console.log('DRY RUN - no files will be modified');

  let migrated = 0;
  let failed = 0;

  for (const file of needsMigration) {
    const slug = file.replace('.md', '');
    const filePath = path.join(POSTS_DIR, file);
    let content = fs.readFileSync(filePath, 'utf-8');

    // Find all local image refs: ../images/{slug}-{n}.png
    const localRefs = [...content.matchAll(/\.\.\/images\/[^\s)]+/g)].map(m => m[0]);
    if (!localRefs.length) continue;

    console.log(`  ${slug}: ${localRefs.length} image refs`);

    // Fetch HTML to get CDN URLs
    let cdnUrls;
    try {
      const fullPost = await fetchAPI(`${BASE_URL}/api/v1/posts/${slug}`, cookieHeader);
      const html = fullPost.body_html || '';
      if (!html) {
        console.warn(`    No body_html, skipping`);
        failed++;
        continue;
      }
      cdnUrls = extractImageUrls(html);
    } catch (err) {
      console.warn(`    Failed to fetch: ${err.message}`);
      failed++;
      continue;
    }

    // Build replacement map: ../images/{slug}-N.png -> CDN URL
    let replaced = 0;
    for (const ref of localRefs) {
      // Extract N from ../images/{slug}-{N}.png or ../images/note-{key}-{N}.png
      const nMatch = ref.match(/-(\d+)\.\w+$/);
      if (!nMatch) continue;
      const n = parseInt(nMatch[1], 10);
      const cdnUrl = cdnUrls[n - 1]; // 1-indexed in filenames, 0-indexed in array
      if (!cdnUrl) {
        console.warn(`    No CDN URL for ${ref} (index ${n})`);
        continue;
      }
      content = content.replaceAll(ref, cdnUrl);
      replaced++;
    }

    if (replaced > 0 && !dryRun) {
      fs.writeFileSync(filePath, content);
    }
    console.log(`    Replaced ${replaced}/${localRefs.length} refs`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Failed: ${failed}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
