/**
 * Knowledge base autosync. Runs after every container exit: stages anything
 * under groups/global/knowledge-base/, commits with a generic subject, and
 * pushes to origin main. On push rejection, commits stay local and a single
 * message is sent to the main group — no auto-rebase, no force-push, no
 * retry loop.
 */
import { execSync } from 'child_process';

import { TIMEZONE } from './config.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface AutosyncDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

export interface SyncOptions {
  now?: Date;
}

const KB_PATH = 'groups/global/knowledge-base/';

function findMainGroup(
  groups: Record<string, RegisteredGroup>,
): { jid: string; group: RegisteredGroup } | null {
  for (const [jid, group] of Object.entries(groups)) {
    if (group.isMain === true) return { jid, group };
  }
  return null;
}

function formatCommitSubject(now: Date): string {
  // Intl.DateTimeFormat is required — toLocaleDateString alone does not
  // produce HH:MM, and we need both date and time in TIMEZONE.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  // Some ICU builds emit "24" for midnight in hour12:false — normalize.
  const hour = get('hour') === '24' ? '00' : get('hour');
  const time = `${hour}:${get('minute')}`;
  return `Knowledge base update ${date} ${time}`;
}

function hasStagedChanges(): boolean {
  try {
    execSync('git diff --cached --quiet', { stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
}

function localCommitsAhead(): number {
  try {
    const out = execSync('git rev-list --count origin/main..HEAD', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const n = parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    logger.warn({ err }, 'KB autosync: could not count local commits ahead');
    return 0;
  }
}

export async function syncKnowledgeBase(
  deps: AutosyncDependencies,
  options: SyncOptions = {},
): Promise<void> {
  const now = options.now || new Date();

  try {
    execSync(`git add ${KB_PATH}`, { stdio: 'pipe' });
  } catch (err) {
    logger.error({ err }, 'KB autosync: git add failed');
    return;
  }

  if (!hasStagedChanges()) {
    logger.debug('KB autosync: no changes to commit');
    return;
  }

  const subject = formatCommitSubject(now);

  try {
    execSync(`git commit -m ${JSON.stringify(subject)}`, { stdio: 'pipe' });
  } catch (err) {
    logger.error({ err }, 'KB autosync: git commit failed');
    return;
  }

  logger.info({ subject }, 'KB autosync: committed');

  try {
    execSync('git push origin main', { stdio: 'pipe' });
    logger.info('KB autosync: pushed to origin main');
    return;
  } catch (err) {
    logger.warn({ err }, 'KB autosync: push rejected, commit left local');
  }

  const ahead = localCommitsAhead();
  const message = `KB autopush failed — ${ahead} commit${ahead === 1 ? '' : 's'} queued locally, resolve with git pull --rebase && git push`;

  const groups = deps.registeredGroups();
  const main = findMainGroup(groups);
  if (!main) {
    logger.info(
      'KB autosync: push rejected but no main group registered, skipping ping',
    );
    return;
  }

  try {
    await deps.sendMessage(main.jid, message);
  } catch (sendErr) {
    logger.error({ err: sendErr }, 'KB autosync: failed to send failure ping');
  }
}
