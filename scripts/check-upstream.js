#!/usr/bin/env node

// Daily upstream monitor for NanoClaw.
// Fetches upstream, finds new commits since last review, categorizes them,
// and sends a Telegram summary. Tracks state in upstream-state.json.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'upstream-state.json');
const POLICY_FILE = path.join(__dirname, '..', 'docs', 'MERGE-POLICY.md');
const ROOT = path.join(__dirname, '..');

// Files that signal OneCLI / architectural incompatibility
const ONECLI_MARKERS = ['@onecli-sh/sdk', 'OneCLI', 'onecli'];
const SKIP_PATTERNS = [
  /^docs:/,
  /^chore: bump version/,
  /^docs: update token count/,
  /^style: (run |apply )?(prettier|eslint)/,
  /^ci:/,
  /^repo-tokens\//,
];

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { last_reviewed_commit: null, cherry_picked: [], skipped: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(state) {
  state.last_check = new Date().toISOString().split('T')[0];
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function fetchUpstream() {
  try {
    run('git fetch upstream --prune');
    return true;
  } catch (err) {
    console.error('Failed to fetch upstream:', err.message);
    return false;
  }
}

function getNewCommits(sinceHash) {
  const range = sinceHash ? `${sinceHash}..upstream/main` : 'HEAD..upstream/main';
  const log = run(`git log --oneline --no-merges ${range}`);
  if (!log) return [];
  return log.split('\n').map(line => {
    const [hash, ...rest] = line.split(' ');
    return { hash, message: rest.join(' ') };
  });
}

function getCommitFiles(hash) {
  try {
    return run(`git diff-tree --no-commit-id --name-only -r ${hash}`).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getCommitDiff(hash) {
  try {
    return run(`git show ${hash} --no-stat -p`);
  } catch {
    return '';
  }
}

function isOneCLIRelated(hash) {
  const diff = getCommitDiff(hash);
  return ONECLI_MARKERS.some(marker => diff.includes(marker));
}

function categorize(commit) {
  const msg = commit.message;
  const files = getCommitFiles(commit.hash);

  // Skip noise
  if (SKIP_PATTERNS.some(p => p.test(msg))) return 'skip';

  // Check for OneCLI contamination
  if (isOneCLIRelated(commit.hash)) return 'incompatible';

  // Security
  if (msg.includes('security') || msg.includes('injection') || msg.includes('redact')) return 'security';

  // Bug fixes
  if (msg.startsWith('fix')) return 'fix';

  // Features
  if (msg.startsWith('feat')) return 'feature';

  // Tests
  if (msg.startsWith('test')) return 'test';

  // Skills (new skill additions)
  if (files.some(f => f.includes('.claude/skills/'))) return 'skill';

  return 'other';
}

function formatCategory(cat) {
  const labels = {
    security: '🔒 SECURITY',
    fix: '🐛 Fix',
    feature: '✨ Feature',
    test: '🧪 Test',
    skill: '🔧 Skill',
    incompatible: '⛔ Incompatible (OneCLI)',
    other: '📦 Other',
    skip: null,
  };
  return labels[cat];
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || '7783522550';

  if (!token) {
    // Try reading from .env
    try {
      const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
      const match = envContent.match(/TELEGRAM_BOT_TOKEN=(.+)/);
      if (match) {
        return sendWithToken(match[1].trim(), chatId, text);
      }
    } catch {}
    console.log('No TELEGRAM_BOT_TOKEN found. Message:');
    console.log(text);
    return;
  }

  return sendWithToken(token, chatId, text);
}

async function sendWithToken(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!resp.ok) {
    console.error('Telegram API error:', resp.status, await resp.text());
  }
}

async function main() {
  const state = loadState();

  if (!fetchUpstream()) {
    process.exit(1);
  }

  const commits = getNewCommits(state.last_reviewed_commit);

  if (commits.length === 0) {
    console.log('No new upstream commits.');
    saveState(state);
    return;
  }

  // Categorize
  const knownHashes = new Set([
    ...state.cherry_picked.map(c => c.hash),
    ...state.skipped.map(c => c.hash),
  ]);

  const grouped = {};
  let newCount = 0;
  for (const commit of commits) {
    if (knownHashes.has(commit.hash)) continue;
    const cat = categorize(commit);
    if (cat === 'skip') continue;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(commit);
    newCount++;
  }

  if (newCount === 0) {
    console.log(`${commits.length} new commits, all noise/already reviewed.`);
    state.last_reviewed_commit = commits[0].hash;
    saveState(state);
    return;
  }

  // Build message
  let msg = `<b>NanoClaw upstream: ${newCount} new commit(s)</b>\n\n`;

  const order = ['security', 'fix', 'feature', 'skill', 'test', 'incompatible', 'other'];
  for (const cat of order) {
    if (!grouped[cat] || grouped[cat].length === 0) continue;
    const label = formatCategory(cat);
    msg += `${label}:\n`;
    for (const c of grouped[cat]) {
      msg += `  <code>${c.hash.slice(0, 8)}</code> ${escapeHtml(c.message)}\n`;
    }
    msg += '\n';
  }

  msg += `Reply to cherry-pick, or ignore to skip.`;

  await sendTelegram(msg);
  console.log(`Sent summary of ${newCount} commits to Telegram.`);

  // Update last reviewed to newest commit
  state.last_reviewed_commit = commits[0].hash;
  saveState(state);
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch(err => {
  console.error('Upstream check failed:', err);
  process.exit(1);
});
