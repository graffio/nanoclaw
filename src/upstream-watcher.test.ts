import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { run } from './upstream-watcher.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

interface State {
  last_reviewed_commit: string;
  last_check: string;
  last_watch_check_sha: string;
  last_watch_check: string;
  cherry_picked: unknown[];
  skipped: unknown[];
  v2_landed?: boolean;
}

const SEED_SHA = 'caf2320';
const NEW_TIP = 'abcdef1234567890abcdef1234567890abcdef12';

const MAIN_GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: '',
  added_at: '2026-01-01T00:00:00.000Z',
  isMain: true,
};

const NON_MAIN_GROUP: RegisteredGroup = {
  name: 'Other',
  folder: 'other',
  trigger: '@Andy',
  added_at: '2026-01-01T00:00:00.000Z',
};

let tmpDir: string;
let statePath: string;
let sendMessage: Mock;

function writeSeedState(overrides: Partial<State> = {}): void {
  const state: State = {
    last_reviewed_commit: SEED_SHA,
    last_check: '2026-04-18',
    last_watch_check_sha: SEED_SHA,
    last_watch_check: '2026-04-18',
    cherry_picked: [{ hash: 'keep-me', desc: 'x', date: '2026-04-03' }],
    skipped: [{ hash: 'keep-skip', desc: 'y', reason: 'architecture' }],
    ...overrides,
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

function readWrittenState(): State {
  return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as State;
}

function mockHaiku(
  verdicts: Array<{ security_relevant: boolean; reason: string }>,
): void {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const verdict = verdicts[call++];
      return {
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                security_relevant: verdict.security_relevant,
                reason: verdict.reason,
              }),
            },
          ],
        }),
      } as Response;
    }),
  );
}

function mockGit({
  commits = [] as Array<{ sha: string; subject: string }>,
  tip = NEW_TIP,
  v2Landed = false,
  fetchFails = false,
}: {
  commits?: Array<{ sha: string; subject: string }>;
  tip?: string;
  v2Landed?: boolean;
  fetchFails?: boolean;
} = {}): void {
  mockExecSync.mockImplementation(((cmd: string) => {
    if (cmd === 'git fetch upstream --prune') {
      if (fetchFails) throw new Error('network down');
      return '';
    }
    if (cmd.startsWith('git log')) {
      if (commits.length === 0) return '';
      return commits.map((c) => `${c.sha}\t${c.subject}`).join('\n') + '\n';
    }
    if (cmd === 'git rev-parse upstream/main') {
      return tip + '\n';
    }
    if (cmd === 'git merge-base --is-ancestor upstream/v2 upstream/main') {
      if (v2Landed) return '';
      throw new Error('not an ancestor');
    }
    if (cmd.startsWith('git show --stat')) {
      return 'src/example.ts | 2 +-\n 1 file changed';
    }
    throw new Error(`Unexpected git command in test: ${cmd}`);
  }) as (cmd: string) => string);
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-watcher-test-'));
  statePath = path.join(tmpDir, 'upstream-state.json');
  sendMessage = vi.fn().mockResolvedValue(undefined);
  // Haiku classifier needs an API key to attempt the call; set a dummy one
  // so classify() doesn't short-circuit to "classifier unavailable" in tests
  // that exercise fetch mocking.
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ANTHROPIC_API_KEY;
});

describe('upstream-watcher.run', () => {
  it('stays silent when no commits are security-relevant and v2 has not landed', async () => {
    writeSeedState({ v2_landed: false });
    mockGit({
      commits: [
        {
          sha: 'aaaaaaa1111111111111111111111111111111',
          subject: 'chore: bump version',
        },
        {
          sha: 'bbbbbbb2222222222222222222222222222222',
          subject: 'docs: readme typo',
        },
      ],
    });
    mockHaiku([
      { security_relevant: false, reason: 'version bump' },
      { security_relevant: false, reason: 'docs only' },
    ]);

    await run(
      { registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }), sendMessage },
      { statePath },
    );

    expect(sendMessage).not.toHaveBeenCalled();
    const state = readWrittenState();
    expect(state.last_watch_check_sha).toBe(NEW_TIP);
    expect(state.last_watch_check).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.cherry_picked).toHaveLength(1);
    expect(state.skipped).toHaveLength(1);
    expect(state.v2_landed).toBe(false);
  });

  it('posts a digest and advances state when a security-relevant commit appears', async () => {
    writeSeedState({ v2_landed: false });
    mockGit({
      commits: [
        {
          sha: 'ccccccc3333333333333333333333333333333',
          subject: 'fix: sanitize prompt path',
        },
      ],
    });
    mockHaiku([
      {
        security_relevant: true,
        reason: 'Prevents path traversal in prompt handling',
      },
    ]);

    await run(
      { registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }), sendMessage },
      { statePath },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [jid, text] = sendMessage.mock.calls[0];
    expect(jid).toBe('main@g.us');
    expect(text).toContain('🔒 Upstream watch');
    expect(text).toContain('Security-relevant: 1');
    expect(text).toContain('v2 landed: no');
    expect(text).toContain('ccccccc fix: sanitize prompt path');
    expect(text).toContain('Prevents path traversal');
    expect(text).toContain(
      'https://github.com/qwibitai/nanoclaw/commit/ccccccc3333333333333333333333333333333',
    );
    expect(readWrittenState().last_watch_check_sha).toBe(NEW_TIP);
  });

  it('fires v2-landed line on transition and stays silent on the next run', async () => {
    writeSeedState({ v2_landed: false });
    mockGit({ commits: [], v2Landed: true });

    await run(
      { registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }), sendMessage },
      { statePath },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toContain('v2 landed: yes');
    expect(sendMessage.mock.calls[0][1]).toContain(
      'upstream/v2 has landed on upstream/main',
    );
    expect(readWrittenState().v2_landed).toBe(true);

    sendMessage.mockClear();
    mockGit({ commits: [], v2Landed: true, tip: NEW_TIP });

    await run(
      { registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }), sendMessage },
      { statePath },
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('bundles security + v2 findings into one digest', async () => {
    writeSeedState({ v2_landed: false });
    mockGit({
      commits: [
        {
          sha: 'ddddddd4444444444444444444444444444444',
          subject: 'security: redact logs',
        },
        {
          sha: 'eeeeeee5555555555555555555555555555555',
          subject: 'chore: update deps',
        },
      ],
      v2Landed: true,
    });
    mockHaiku([
      { security_relevant: true, reason: 'redacts secrets from logs' },
      { security_relevant: false, reason: 'dep bump' },
    ]);

    await run(
      { registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }), sendMessage },
      { statePath },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const text = sendMessage.mock.calls[0][1];
    expect(text).toContain('Security-relevant: 1');
    expect(text).toContain('v2 landed: yes');
    expect(text).toContain('ddddddd security: redact logs');
    expect(text).not.toContain('eeeeeee');
    expect(text).toContain('upstream/v2 has landed');
  });

  it('leaves state untouched and logs when git fetch fails', async () => {
    writeSeedState({ v2_landed: false });
    mockGit({ fetchFails: true });
    const before = fs.readFileSync(statePath, 'utf-8');

    await run(
      { registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }), sendMessage },
      { statePath },
    );

    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Upstream watcher: git fetch failed',
    );
    expect(fs.readFileSync(statePath, 'utf-8')).toBe(before);
  });

  it('silent-skips the send but still advances state when no main group is registered', async () => {
    writeSeedState({ v2_landed: false });
    mockGit({
      commits: [
        {
          sha: 'fffffff6666666666666666666666666666666',
          subject: 'fix: auth bypass',
        },
      ],
    });
    mockHaiku([{ security_relevant: true, reason: 'closes auth bypass' }]);

    await run(
      {
        registeredGroups: () => ({ 'other@g.us': NON_MAIN_GROUP }),
        sendMessage,
      },
      { statePath },
    );

    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no main group registered'),
    );
    expect(readWrittenState().last_watch_check_sha).toBe(NEW_TIP);
  });
});
