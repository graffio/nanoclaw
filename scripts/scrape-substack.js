#!/usr/bin/env node

// Substack scraper for Stephen Tobin / Strategic Wave Trading
// Usage: node scripts/scrape-substack.js [--posts] [--notes] [--chat] [--since YYYY-MM-DD] [--dry-run] [--proxy]
// No flags = posts only (notes/chat require explicit opt-in until endpoints are confirmed)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import TurndownService from 'turndown';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Allow overriding paths for container use (--kb-dir, --creds)
function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const KB_DIR = getArg('--kb-dir') || path.join(PROJECT_ROOT, 'groups/global/knowledge-base/stephen-tobin');
const CRED_PATHS = getArg('--creds')
  ? [getArg('--creds')]
  : [
      path.join(KB_DIR, 'credentials/substack-cookies.json'),
      path.join(PROJECT_ROOT, 'groups/telegram_main/credentials/substack-cookies.json'),
    ];
const BASE_URL = 'https://stephentobin.substack.com';
const PUBLICATION_ID = 1592835;
const RATE_LIMIT_MS = 2000;
const STEPHEN_NAMES = ['stephen tobin', 'stephentobin'];

// --- CLI parsing ---

const args = process.argv.slice(2);
const flags = {
  posts: args.includes('--posts'),
  notes: args.includes('--notes'),
  chat: args.includes('--chat'),
  dryRun: args.includes('--dry-run'),
  proxy: args.includes('--proxy'),
  since: null,
};
const sinceIdx = args.indexOf('--since');
if (sinceIdx !== -1 && args[sinceIdx + 1]) {
  flags.since = args[sinceIdx + 1];
}
// Default: posts only if no type flags given
if (!flags.posts && !flags.notes && !flags.chat) {
  flags.posts = true;
}

// When using proxy, rewrite URLs to go through localhost:3002
const PROXY_BASE = 'http://127.0.0.1:3002';

// --- Cookie loading (skipped when using proxy) ---

function loadCookies() {
  if (flags.proxy) {
    console.log('Using proxy at localhost:3002 (no local cookies needed)');
    return '';
  }
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

// Rewrite a URL to go through the proxy (strips the host, keeps the path)
function proxyUrl(url) {
  if (!flags.proxy) return url;
  const parsed = new URL(url);
  return `${PROXY_BASE}${parsed.pathname}${parsed.search || ''}`;
}

// --- HTTP with rate limiting ---

let lastRequestTime = 0;

async function fetchAPI(url, cookieHeader) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const actualUrl = proxyUrl(url);
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) NanoClaw/1.0' };
  if (!flags.proxy && cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  const res = await fetch(actualUrl, { headers });
  if (res.status === 429) {
    // Rate limited — wait and retry once
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
    console.warn(`  Rate limited, waiting ${retryAfter}s...`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    lastRequestTime = Date.now();
    const retry = await fetch(actualUrl, { headers });
    if (!retry.ok) throw new Error(`HTTP ${retry.status} for ${url}`);
    return retry.json();
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function downloadFile(url, destPath, cookieHeader) {
  if (fs.existsSync(destPath)) return false;
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const res = await fetch(url, {
    headers: { 'Cookie': cookieHeader },
  });
  if (!res.ok) {
    console.warn(`  Failed to download image: HTTP ${res.status}`);
    return false;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return true;
}

// --- HTML to Markdown ---

function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Strip subscription CTAs and paywall dividers
  td.remove(['button', 'form']);
  td.addRule('paywall', {
    filter: (node) => {
      const cls = node.getAttribute?.('class') || '';
      return cls.includes('paywall') || cls.includes('subscription-widget');
    },
    replacement: () => '',
  });

  return td;
}

function htmlToMarkdown(html, slug) {
  const td = createTurndown();
  const imageUrls = [];

  // Collect image URLs and replace with local paths
  td.addRule('images', {
    filter: 'img',
    replacement: (content, node) => {
      const src = node.getAttribute('src') || '';
      if (!src || src.includes('pixel') || src.includes('tracking')) return '';
      // Extract the actual image URL from Substack CDN proxy
      let imageUrl = src;
      const s3Match = src.match(/https%3A%2F%2Fsubstack-post-media\.s3\.amazonaws\.com[^)&\s]*/);
      if (s3Match) {
        imageUrl = decodeURIComponent(s3Match[0]);
      }
      const n = imageUrls.length + 1;
      imageUrls.push(imageUrl);
      const alt = node.getAttribute('alt') || `Image ${n}`;
      return `![${alt}](../images/${slug}-${n}.png)`;
    },
  });

  const markdown = td.turndown(html);
  return { markdown, imageUrls };
}

// --- Index management ---

function loadRootIndex() {
  const p = path.join(KB_DIR, 'index.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  return { source: `${BASE_URL}`, publication_url: 'stephentobin.substack.com', last_scraped: null, years: [] };
}

function saveRootIndex(index) {
  index.last_scraped = new Date().toISOString();
  fs.writeFileSync(path.join(KB_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

function loadYearIndex(year) {
  const p = path.join(KB_DIR, `index-${year}.json`);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  return { year: parseInt(year), items: [] };
}

function saveYearIndex(year, data) {
  // Sort items by date descending
  data.items.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(path.join(KB_DIR, `index-${year}.json`), JSON.stringify(data, null, 2) + '\n');
}

function isPostIndexed(yearIndex, slug) {
  return yearIndex.items.some(i => i.type === 'post' && i.slug === slug);
}

// --- Post type classification ---

function classifyPost(title) {
  if (/^Trade Alert/i.test(title)) return 'trade_alert';
  if (/^SW Weekly/i.test(title)) return 'sw_weekly';
  if (/^Weekly (Update|Review)/i.test(title)) return 'weekly_update';
  if (/^Portfolio Review/i.test(title)) return 'stock_review';
  if (/^Reviewing Stocks/i.test(title)) return 'stock_review';
  return 'thematic';
}

// --- Ticker extraction ---

const TICKER_STOPLIST = new Set([
  'OK', 'CEO', 'ETF', 'IPO', 'FDA', 'GDP', 'UK', 'US', 'AI', 'EV', 'HK',
  'THE', 'AND', 'FOR', 'NOT', 'BUT', 'ARE', 'WAS', 'HAS', 'HAD', 'CAN',
  'ALL', 'NEW', 'NOW', 'OLD', 'OUR', 'ONE', 'TWO', 'ANY', 'FEW', 'HOW',
  'MAN', 'OWN', 'SAY', 'SHE', 'TOO', 'USE', 'DAD', 'MOM', 'SON', 'WAR',
  'BIG', 'END', 'FAR', 'FIT', 'GOT', 'HOT', 'LET', 'MAP', 'RUN', 'TEN',
  'TOP', 'YES', 'YET', 'WHO', 'WHY', 'OIL', 'GAS', 'KEY', 'LOW', 'RAW',
  'SET', 'PUT', 'CUT', 'ADD', 'AGE', 'AGO', 'ARM', 'ART', 'BAD', 'BED',
  'BIT', 'BOX', 'BOY', 'BUS', 'CAR', 'CUP', 'DID', 'DOG', 'EAR', 'EAT',
  'RMB', 'USD', 'CAD', 'AUD', 'GBP', 'EUR', 'JPY', 'CNY', 'NZD', 'CHF',
  'YOY', 'QOQ', 'MOM', 'YTD', 'MTD', 'WTD', 'ATH', 'ATL', 'EPS', 'P&L',
  'SEC', 'OEM', 'MWC', 'FY25', 'FY26', 'GAAP', 'NON', 'TAX', 'REE',
  'DOE', 'ESG', 'OTC', 'MOU', 'CTO', 'VP', 'MD', 'LLC', 'INC', 'LTD',
  'PLC', 'ADR', 'ADY', 'ISA', 'BOM', 'DOF', 'FOV',
]);

function extractTickers(text) {
  const tickers = new Set();
  // Standard US tickers: 2-5 uppercase letters as standalone words
  const usMatches = text.match(/\b[A-Z]{2,5}\b/g) || [];
  for (const m of usMatches) {
    if (!TICKER_STOPLIST.has(m)) tickers.add(m);
  }
  // Exchange-prefixed: TSE:MDA, ASX:EOS, CVE:ROOF
  const prefixed = text.match(/[A-Z]{2,4}:[A-Z]{2,5}/g) || [];
  for (const m of prefixed) tickers.add(m);
  // Asian tickers: 0425.HK, 6324.T, 688017.SS
  const asian = text.match(/\d{3,6}\.[A-Z]{1,2}/g) || [];
  for (const m of asian) tickers.add(m);
  // Dollar-prefixed
  const dollar = text.match(/\$[A-Z]{2,5}\b/g) || [];
  for (const m of dollar) tickers.add(m.slice(1));

  return [...tickers].sort();
}

// --- Posts scraping ---

async function scrapePosts(cookieHeader, sinceDate) {
  console.log('\n=== Scraping Posts ===');
  const rootIndex = loadRootIndex();
  let offset = 0;
  let totalNew = 0;
  let done = false;

  while (!done) {
    const url = `${BASE_URL}/api/v1/archive?sort=new&limit=50&offset=${offset}`;
    console.log(`Fetching archive offset=${offset}...`);
    const posts = await fetchAPI(url, cookieHeader);

    if (!posts.length) {
      console.log('No more posts.');
      break;
    }

    for (const post of posts) {
      const date = post.post_date.slice(0, 10);
      const year = date.slice(0, 4);

      if (sinceDate && date < sinceDate) {
        console.log(`Reached --since date (${sinceDate}), stopping.`);
        done = true;
        break;
      }

      const yearIndex = loadYearIndex(year);
      if (isPostIndexed(yearIndex, post.slug)) {
        continue;
      }

      console.log(`  NEW: ${date} ${post.slug}`);

      if (flags.dryRun) {
        totalNew++;
        continue;
      }

      // Fetch full post
      const fullUrl = `${BASE_URL}/api/v1/posts/${post.slug}`;
      let fullPost;
      try {
        fullPost = await fetchAPI(fullUrl, cookieHeader);
      } catch (err) {
        console.warn(`  Failed to fetch ${post.slug}: ${err.message}`);
        continue;
      }

      const bodyHtml = fullPost.body_html || '';
      if (!bodyHtml) {
        console.warn(`  No body_html for ${post.slug} (paywalled without access?)`);
        // Still index it but save minimal file
      }

      // Convert HTML to markdown
      const { markdown, imageUrls } = bodyHtml ? htmlToMarkdown(bodyHtml, post.slug) : { markdown: '', imageUrls: [] };

      // Download images
      for (let i = 0; i < imageUrls.length; i++) {
        const imgDest = path.join(KB_DIR, 'images', `${post.slug}-${i + 1}.png`);
        try {
          const downloaded = await downloadFile(imageUrls[i], imgDest, cookieHeader);
          if (downloaded) console.log(`    Downloaded image ${i + 1}/${imageUrls.length}`);
        } catch (err) {
          console.warn(`    Failed to download image ${i + 1}: ${err.message}`);
        }
      }

      // Build markdown file
      const postType = classifyPost(post.title);
      const frontmatter = [
        '---',
        `title: ${JSON.stringify(post.title)}`,
        `date: ${date}`,
        `url: ${post.canonical_url || `${BASE_URL}/p/${post.slug}`}`,
        `audience: ${post.audience || 'everyone'}`,
        `post_type: ${postType}`,
        `summary: ${JSON.stringify(post.subtitle || post.description || '')}`,
        '---',
      ].join('\n');

      const fileContent = `${frontmatter}\n\n# ${post.title}\n\n${post.subtitle ? `*${post.subtitle}*\n\n` : ''}${markdown}\n\n---\n\n*Source: [Strategic Wave Trading](${BASE_URL}/p/${post.slug})*\n`;

      const postDir = path.join(KB_DIR, 'posts');
      fs.mkdirSync(postDir, { recursive: true });
      fs.writeFileSync(path.join(postDir, `${post.slug}.md`), fileContent);

      // Extract tickers from title + body
      const tickers = extractTickers(`${post.title} ${markdown}`);

      // Update index
      const indexEntry = {
        title: post.title,
        date,
        slug: post.slug,
        url: post.canonical_url || `${BASE_URL}/p/${post.slug}`,
        type: 'post',
        post_type: postType,
        audience: post.audience || 'everyone',
        summary: (post.subtitle || post.description || '').slice(0, 200),
        tickers,
        has_images: imageUrls.length > 0,
      };

      yearIndex.items.push(indexEntry);
      if (!rootIndex.years.includes(year)) rootIndex.years.push(year);
      saveYearIndex(year, yearIndex);
      manifest.posts.push({ ...indexEntry, file: `posts/${post.slug}.md`, imageCount: imageUrls.length });
      totalNew++;
    }

    offset += posts.length;
  }

  saveRootIndex(rootIndex);
  console.log(`Posts done: ${totalNew} new${flags.dryRun ? ' (dry run)' : ''}`);
  return totalNew;
}

// --- Notes scraping ---

const STEPHEN_USER_ID = 39434881;

function isNoteIndexed(yearIndex, entityKey) {
  return yearIndex.items.some(i => i.type === 'note' && i.entity_key === entityKey);
}

async function scrapeNotes(cookieHeader, sinceDate) {
  console.log('\n=== Scraping Notes ===');

  const rootIndex = loadRootIndex();
  let totalNew = 0;
  let cursor = null;
  let done = false;

  while (!done) {
    let url = `https://substack.com/api/v1/reader/feed/profile/${STEPHEN_USER_ID}?types=note&limit=20`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    console.log(`Fetching notes${cursor ? ' (next page)' : ''}...`);
    let data;
    try {
      data = await fetchAPI(url, cookieHeader);
    } catch (err) {
      console.warn(`Failed to fetch notes: ${err.message}`);
      break;
    }

    const items = data.items || [];
    if (!items.length) {
      console.log('No more notes.');
      break;
    }

    for (const item of items) {
      const timestamp = item.context?.timestamp;
      if (!timestamp) continue;
      const date = timestamp.slice(0, 10);
      const year = date.slice(0, 4);
      const entityKey = item.entity_key;

      if (sinceDate && date < sinceDate) {
        console.log(`Reached --since date (${sinceDate}), stopping.`);
        done = true;
        break;
      }

      const yearIndex = loadYearIndex(year);
      if (isNoteIndexed(yearIndex, entityKey)) continue;

      const comment = item.comment || {};
      const body = comment.body || '';
      if (!body.trim()) continue;

      console.log(`  NEW note: ${date} ${entityKey} - ${body.slice(0, 60)}...`);

      if (flags.dryRun) {
        totalNew++;
        continue;
      }

      // Check for attached post
      let attachedPost = '';
      if (item.post) {
        attachedPost = `\nAttached post: [${item.post.title}](${BASE_URL}/p/${item.post.slug})\n`;
      }

      // Check for images in attachments
      const attachments = comment.attachments || [];
      let imageRefs = '';
      if (Array.isArray(attachments)) {
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i];
          if (att?.imageUrl || att?.url) {
            const imgUrl = att.imageUrl || att.url;
            const imgDest = path.join(KB_DIR, 'images', `note-${entityKey}-${i + 1}.png`);
            try {
              await downloadFile(imgUrl, imgDest, cookieHeader);
              imageRefs += `\n![Image](../images/note-${entityKey}-${i + 1}.png)\n`;
            } catch (err) {
              console.warn(`    Failed to download note image: ${err.message}`);
            }
          }
        }
      }

      const summary = body.slice(0, 200).replace(/\n/g, ' ');
      const dateObj = new Date(timestamp);
      const monthName = dateObj.toLocaleString('en-US', { month: 'long' });
      const day = dateObj.getDate();

      const fileContent = [
        '---',
        'type: note',
        `entity_key: ${entityKey}`,
        `date: ${date}`,
        `summary: ${JSON.stringify(summary)}`,
        '---',
        '',
        `# Note -- ${monthName} ${day}, ${year}`,
        '',
        body,
        imageRefs,
        attachedPost,
        '---',
        '',
        `*Source: [Strategic Wave Trading Notes](${BASE_URL})*`,
        '',
      ].join('\n');

      const notesDir = path.join(KB_DIR, 'notes');
      fs.mkdirSync(notesDir, { recursive: true });
      fs.writeFileSync(path.join(notesDir, `note-${entityKey}.md`), fileContent);

      const tickers = extractTickers(body);
      const indexEntry = {
        date,
        type: 'note',
        entity_key: entityKey,
        summary,
        tickers,
      };

      yearIndex.items.push(indexEntry);
      if (!rootIndex.years.includes(year)) rootIndex.years.push(year);
      saveYearIndex(year, yearIndex);
      manifest.notes.push({ ...indexEntry, file: `notes/note-${entityKey}.md` });
      totalNew++;
    }

    cursor = data.nextCursor;
    if (!cursor) break;
  }

  saveRootIndex(rootIndex);
  console.log(`Notes done: ${totalNew} new${flags.dryRun ? ' (dry run)' : ''}`);
  return totalNew;
}

// --- Chat scraping ---

const CHAT_THREADS_URL = `https://substack.com/api/v1/community/publications/${PUBLICATION_ID}/posts`;
const CHAT_COMMENTS_URL = `https://substack.com/api/v1/community/posts`;

function isChatThreadIndexed(yearIndex, threadId) {
  return yearIndex.items.some(i => i.type === 'chat' && i.thread_id === threadId);
}

function isStephen(userId) {
  return userId === STEPHEN_USER_ID;
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

async function scrapeChat(cookieHeader, sinceDate) {
  console.log('\n=== Scraping Chat ===');

  const rootIndex = loadRootIndex();
  let totalNew = 0;
  let before = null;
  let done = false;

  while (!done) {
    let url = `${CHAT_THREADS_URL}?limit=25`;
    if (before) url += `&before=${encodeURIComponent(before)}`;

    console.log(`Fetching chat threads${before ? ' (older)' : ''}...`);
    let data;
    try {
      data = await fetchAPI(url, cookieHeader);
    } catch (err) {
      console.warn(`Failed to fetch chat threads: ${err.message}`);
      break;
    }

    const threads = data.threads || [];
    if (!threads.length) {
      console.log('No more threads.');
      break;
    }

    // Group threads by date for daily files
    const threadsByDate = {};

    for (const thread of threads) {
      const cp = thread.communityPost;
      const date = cp.created_at.slice(0, 10);
      const threadId = cp.id;

      if (sinceDate && date < sinceDate) {
        console.log(`Reached --since date (${sinceDate}), stopping.`);
        done = true;
        break;
      }

      const year = date.slice(0, 4);
      const yearIndex = loadYearIndex(year);
      if (isChatThreadIndexed(yearIndex, threadId)) continue;

      // Fetch replies to check for Stephen
      let replies = [];
      if (cp.comment_count > 0) {
        try {
          const commentsUrl = `${CHAT_COMMENTS_URL}/${threadId}/comments?limit=100`;
          const commentsData = await fetchAPI(commentsUrl, cookieHeader);
          replies = (commentsData.replies || []).map(r => ({
            name: r.user?.name || '?',
            userId: r.comment.user_id,
            body: r.comment.body || '',
            createdAt: r.comment.created_at,
          }));
        } catch (err) {
          console.warn(`  Failed to fetch replies for ${threadId}: ${err.message}`);
        }
      }

      const stephenReplies = replies.filter(r => isStephen(r.userId));
      const hasStephen = isStephen(cp.user_id) || stephenReplies.length > 0;
      const authorName = cp.user?.name || thread.user?.name || '?';

      console.log(`  Thread: ${date} ${authorName}: ${cp.body?.slice(0, 50)}... [${stephenReplies.length} Stephen replies]`);

      if (flags.dryRun) {
        if (hasStephen) totalNew++;
        continue;
      }

      // Only save threads where Stephen participated
      if (!hasStephen) {
        // Still index it so we skip it next time, but no file
        yearIndex.items.push({
          date,
          type: 'chat',
          thread_id: threadId,
          file: null,
          author: authorName,
          has_stephen: false,
          thread_topic: cp.body?.slice(0, 80) || '',
          summary: `${authorName}: ${(cp.body || '').slice(0, 80)}`,
          tickers: extractTickers(cp.body || ''),
          reply_count: replies.length,
          stephen_reply_count: 0,
        });
        if (!rootIndex.years.includes(year)) rootIndex.years.push(year);
        saveYearIndex(year, yearIndex);
        continue;
      }

      // Build chat file content for this thread
      if (!threadsByDate[date]) threadsByDate[date] = [];

      let threadContent = `## ${cp.body?.slice(0, 80) || 'Thread'}\n`;
      threadContent += `*${authorName} at ${cp.created_at.slice(11, 16)} UTC*\n\n`;

      if (isStephen(cp.user_id)) {
        threadContent += `**Stephen Tobin:**\n${cp.body}\n\n`;
      } else {
        threadContent += `${cp.body}\n\n`;
      }

      if (replies.length > 0) {
        threadContent += '**Replies:**\n\n';
        for (const r of replies) {
          const star = isStephen(r.userId) ? '**Stephen Tobin**' : `**${r.name}**`;
          threadContent += `> ${star} (${r.createdAt.slice(11, 16)}): ${r.body}\n\n`;
        }
      }

      threadsByDate[date].push(threadContent);

      // Collect all text for ticker extraction
      const allText = [cp.body || '', ...replies.map(r => r.body)].join(' ');
      const tickers = extractTickers(allText);

      const chatIndexEntry = {
        date,
        type: 'chat',
        thread_id: threadId,
        file: `chat/chat-${date}.md`,
        author: authorName,
        has_stephen: true,
        thread_topic: cp.body?.slice(0, 80) || '',
        summary: stephenReplies.length > 0
          ? `${authorName}: ${(cp.body || '').slice(0, 40)}... Stephen: ${stephenReplies[0].body.slice(0, 60)}`
          : `Stephen: ${(cp.body || '').slice(0, 80)}`,
        tickers,
        reply_count: replies.length,
        stephen_reply_count: stephenReplies.length,
      };
      yearIndex.items.push(chatIndexEntry);
      if (!rootIndex.years.includes(year)) rootIndex.years.push(year);
      saveYearIndex(year, yearIndex);
      manifest.chat.push({ ...chatIndexEntry, stephen_content: stephenReplies.map(r => r.body).join('\n') });
      totalNew++;
    }

    // Write daily chat files
    if (!flags.dryRun) {
      const chatDir = path.join(KB_DIR, 'chat');
      fs.mkdirSync(chatDir, { recursive: true });

      for (const [date, contents] of Object.entries(threadsByDate)) {
        const filePath = path.join(chatDir, `chat-${date}.md`);
        const header = `# Stephen Tobin Chat -- ${date}\n\n---\n\n`;

        if (fs.existsSync(filePath)) {
          // Append to existing daily file
          fs.appendFileSync(filePath, '\n---\n\n' + contents.join('\n---\n\n'));
        } else {
          fs.writeFileSync(filePath, header + contents.join('\n---\n\n') + '\n');
        }
      }
    }

    // Pagination: use oldest thread's created_at
    if (data.moreBefore && threads.length > 0) {
      const oldest = threads[threads.length - 1].communityPost.created_at;
      before = oldest;
    } else {
      break;
    }
  }

  saveRootIndex(rootIndex);
  console.log(`Chat done: ${totalNew} new threads with Stephen${flags.dryRun ? ' (dry run)' : ''}`);
  return totalNew;
}

// --- Main ---

// --- Manifest ---
// After scraping, write a manifest of what's new so the agent can process it

const manifest = { posts: [], notes: [], chat: [], timestamp: new Date().toISOString() };

async function main() {
  console.log('Substack scraper for Strategic Wave Trading');
  console.log(`Knowledge base: ${KB_DIR}`);
  if (flags.since) console.log(`Since: ${flags.since}`);
  if (flags.dryRun) console.log('DRY RUN - no files will be written');
  console.log(`Scraping: ${[flags.posts && 'posts', flags.notes && 'notes', flags.chat && 'chat'].filter(Boolean).join(', ')}`);

  const cookieHeader = loadCookies();

  let totalNew = 0;
  if (flags.posts) totalNew += await scrapePosts(cookieHeader, flags.since);
  if (flags.notes) totalNew += await scrapeNotes(cookieHeader, flags.since);
  if (flags.chat) totalNew += await scrapeChat(cookieHeader, flags.since);

  // Write manifest for the agent to process
  if (!flags.dryRun && totalNew > 0) {
    const manifestPath = path.join(KB_DIR, 'scrape-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Manifest written: ${manifestPath} (${totalNew} items)`);
  }

  console.log(`\nDone. ${totalNew} new items.`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
