/**
 * Upstream watcher. Weekly cron that fetches upstream/main, asks Haiku which
 * new commits are security-relevant, and posts a digest to the main group
 * only when something matters. Replaces the retired /update-nanoclaw skill.
 */
import { execSync } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import { TIMEZONE } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface WatcherDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

export interface RunOptions {
  statePath?: string;
}

interface UpstreamState {
  last_reviewed_commit: string;
  last_check: string;
  last_watch_check_sha: string;
  last_watch_check: string;
  cherry_picked: Array<{ hash: string; desc: string; date: string }>;
  skipped: Array<{ hash: string; desc: string; reason: string }>;
  v2_landed?: boolean;
}

interface Commit {
  sha: string;
  subject: string;
}

interface Classification {
  sha: string;
  security_relevant: boolean;
  reason: string;
}

const DEFAULT_STATE_PATH = path.resolve(
  process.cwd(),
  'scripts',
  'upstream-state.json',
);
const COMMIT_URL_BASE = 'https://github.com/qwibitai/nanoclaw/commit/';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

function readState(statePath: string): UpstreamState {
  return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as UpstreamState;
}

function writeState(statePath: string, state: UpstreamState): void {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function listNewCommits(sinceSha: string): Commit[] {
  // %x09 is a literal tab, safe as a subject separator since git log strips
  // newlines and tabs from the subject.
  const output = execSync(
    `git log --no-merges --format=%H%x09%s ${sinceSha}..upstream/main`,
    { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
  );
  if (!output.trim()) return [];
  return output
    .trim()
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('\t');
      return {
        sha: line.slice(0, idx),
        subject: line.slice(idx + 1),
      };
    });
}

function currentUpstreamTip(): string {
  return execSync('git rev-parse upstream/main', {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  }).trim();
}

function isV2Landed(): boolean {
  try {
    execSync('git merge-base --is-ancestor upstream/v2 upstream/main', {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function commitStat(sha: string): string {
  return execSync(`git show --stat --format=%s ${sha}`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
}

async function classify(commit: Commit): Promise<Classification> {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  const apiKey = secrets.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Conservative: missing key → treat as non-security so silent weeks stay
    // silent. The passive GitHub Watch subscription is the safety net for
    // missed findings; a loud alert here would cry wolf on config gaps.
    logger.warn(
      { sha: commit.sha },
      'Upstream watcher: no ANTHROPIC_API_KEY, skipping classification',
    );
    return {
      sha: commit.sha,
      security_relevant: false,
      reason: 'classifier unavailable',
    };
  }

  const stat = commitStat(commit.sha);
  const prompt = `You are reviewing an upstream open-source commit for security relevance.

A commit is security-relevant if it fixes a CVE, hardens auth, fixes an injection/
XSS/SSRF/path-traversal/command-execution bug, redacts secrets, or closes any
exploitable vulnerability. Formatting, refactors, features, docs, CI, and version
bumps are NOT security-relevant even when the subject says "fix".

Commit subject: ${commit.subject}

Files changed (git show --stat):
${stat}

Respond with a single JSON object and nothing else:
{"security_relevant": true|false, "reason": "<one-sentence rationale>"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const body = (await res.json()) as {
      content?: Array<{ text?: string }>;
    };
    const content = body?.content?.[0]?.text || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn(
        { sha: commit.sha, content },
        'Upstream watcher: classifier returned no JSON, treating as non-security',
      );
      return {
        sha: commit.sha,
        security_relevant: false,
        reason: 'classifier output unparseable',
      };
    }
    const parsed = JSON.parse(match[0]) as {
      security_relevant?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.security_relevant !== 'boolean') {
      logger.warn(
        { sha: commit.sha, parsed },
        'Upstream watcher: classifier returned wrong shape, treating as non-security',
      );
      return {
        sha: commit.sha,
        security_relevant: false,
        reason: 'classifier output wrong shape',
      };
    }
    return {
      sha: commit.sha,
      security_relevant: parsed.security_relevant,
      reason: String(parsed.reason || '').slice(0, 300),
    };
  } catch (err) {
    logger.warn(
      { err, sha: commit.sha },
      'Upstream watcher: classifier error, treating as non-security',
    );
    return {
      sha: commit.sha,
      security_relevant: false,
      reason: 'classifier error',
    };
  }
}

function findMainGroup(
  groups: Record<string, RegisteredGroup>,
): { jid: string; group: RegisteredGroup } | null {
  for (const [jid, group] of Object.entries(groups)) {
    if (group.isMain === true) return { jid, group };
  }
  return null;
}

function formatDigest(
  state: UpstreamState,
  findings: Classification[],
  commitSubjects: Map<string, string>,
  newlyLandedV2: boolean,
): string {
  const from = state.last_watch_check;
  const to = todayIso();
  const security = findings.filter((f) => f.security_relevant);
  const parts: string[] = [
    `🔒 Upstream watch — ${from} → ${to}`,
    `Security-relevant: ${security.length} | v2 landed: ${newlyLandedV2 ? 'yes' : 'no'}`,
  ];
  if (security.length > 0) {
    parts.push('');
    security.forEach((f, i) => {
      const subject = commitSubjects.get(f.sha) || '';
      const shortSha = f.sha.slice(0, 7);
      parts.push(
        `${i + 1}. ${shortSha} ${subject}\n   ${f.reason}\n   ${COMMIT_URL_BASE}${f.sha}`,
      );
    });
  }
  if (newlyLandedV2) {
    parts.push('');
    parts.push(
      'upstream/v2 has landed on upstream/main — re-fork decision needed.',
    );
  }
  return parts.join('\n');
}

export async function run(
  deps: WatcherDependencies,
  options: RunOptions = {},
): Promise<void> {
  const statePath = options.statePath || DEFAULT_STATE_PATH;

  try {
    execSync('git fetch upstream --prune', { stdio: 'pipe' });
  } catch (err) {
    // State untouched so next run re-attempts the same window.
    logger.error({ err }, 'Upstream watcher: git fetch failed');
    return;
  }

  const state = readState(statePath);
  const commits = listNewCommits(state.last_watch_check_sha);
  const tip = currentUpstreamTip();

  // v2_landed is a transition flag, not the current v2 status. We only alert
  // when the ancestor check flips false→true; undefined on older state files
  // is treated as false so the first real run fires correctly if v2 is
  // already landed by then.
  const previouslyV2Landed = state.v2_landed === true;
  const v2Now = isV2Landed();
  const newlyLandedV2 = v2Now && !previouslyV2Landed;

  const commitSubjects = new Map(commits.map((c) => [c.sha, c.subject]));
  const classifications: Classification[] = [];
  for (const commit of commits) {
    // Serial classification: ~20 commits/week at peak is a handful of calls,
    // not worth the rate-limit risk of parallel fan-out.
    classifications.push(await classify(commit));
  }

  const security = classifications.filter((c) => c.security_relevant);
  const shouldSend = security.length > 0 || newlyLandedV2;

  if (shouldSend) {
    const groups = deps.registeredGroups();
    const main = findMainGroup(groups);
    if (main) {
      const digest = formatDigest(
        state,
        classifications,
        commitSubjects,
        newlyLandedV2,
      );
      try {
        await deps.sendMessage(main.jid, digest);
      } catch (err) {
        logger.error({ err }, 'Upstream watcher: failed to send digest');
      }
    } else {
      logger.info(
        'Upstream watcher: findings present but no main group registered, skipping digest',
      );
    }
  }

  // Advance state on every completed run. Only git fetch failure (above)
  // leaves state untouched — send failure and no-main-group are logged but
  // still move the cursor, mirroring the brainstorm's "skipped run still
  // updates last_watch_check_sha and date" rule.
  writeState(statePath, {
    ...state,
    last_watch_check_sha: tip,
    last_watch_check: todayIso(),
    v2_landed: v2Now,
  });

  logger.info(
    {
      commits: commits.length,
      security: security.length,
      newlyLandedV2,
      sent: shouldSend,
    },
    'Upstream watcher: run complete',
  );
}

// Monday 9am in TIMEZONE — the brainstorm's chosen cadence. Not registered
// through the SQLite tasks table so it stays out of /task listings and
// per-group container contexts.
const WATCH_CRON = '0 9 * * 1';

let watcherCronRunning = false;

export function startUpstreamWatcherCron(deps: WatcherDependencies): void {
  if (watcherCronRunning) {
    logger.debug(
      'Upstream watcher cron already running, skipping duplicate start',
    );
    return;
  }
  watcherCronRunning = true;

  const schedule = () => {
    const iter = CronExpressionParser.parse(WATCH_CRON, { tz: TIMEZONE });
    const delayMs = Math.max(0, iter.next().getTime() - Date.now());
    setTimeout(() => {
      run(deps)
        .catch((err) => {
          // run() already logs fetch failure; this only catches a programmer
          // bug that breaks out of run()'s own try/catch. Never let a cron
          // fire rip the orchestrator down.
          logger.error({ err }, 'Upstream watcher: unexpected crash in run');
        })
        .finally(schedule);
    }, delayMs);
  };

  logger.info({ cron: WATCH_CRON, tz: TIMEZONE }, 'Upstream watcher scheduled');
  schedule();
}

/** @internal - for tests only. */
export function _resetUpstreamWatcherCronForTests(): void {
  watcherCronRunning = false;
}
