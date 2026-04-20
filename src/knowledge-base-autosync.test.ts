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

vi.mock('./config.js', () => ({
  TIMEZONE: 'America/Los_Angeles',
}));

import { syncKnowledgeBase } from './knowledge-base-autosync.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

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

// Fixed instant → deterministic commit subject. 2026-04-20 09:30 UTC →
// 2026-04-20 02:30 America/Los_Angeles.
const FIXED_NOW = new Date('2026-04-20T09:30:00Z');
const EXPECTED_SUBJECT = 'Knowledge base update 2026-04-20 02:30';

interface GitPlan {
  dirty?: boolean; // whether staged index has changes after `git add`
  pushFails?: boolean;
  commitsAhead?: number;
}

function stubGit(plan: GitPlan = {}): void {
  const dirty = plan.dirty ?? true;
  mockExecSync.mockImplementation(((cmd: string) => {
    if (cmd.startsWith('git add ')) return '';
    if (cmd === 'git diff --cached --quiet') {
      if (dirty) throw new Error('has staged changes');
      return '';
    }
    if (cmd.startsWith('git commit')) return '';
    if (cmd === 'git push origin main') {
      if (plan.pushFails) throw new Error('push rejected');
      return '';
    }
    if (cmd === 'git rev-list --count origin/main..HEAD') {
      return `${plan.commitsAhead ?? 0}\n`;
    }
    throw new Error(`Unexpected git command in test: ${cmd}`);
  }) as (cmd: string) => string);
}

let sendMessage: Mock;

beforeEach(() => {
  vi.clearAllMocks();
  sendMessage = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncKnowledgeBase', () => {
  it('skips commit and push when the index is empty after git add', async () => {
    stubGit({ dirty: false });

    await syncKnowledgeBase(
      {
        registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }),
        sendMessage,
      },
      { now: FIXED_NOW },
    );

    const commands = mockExecSync.mock.calls.map((c) => c[0]);
    expect(commands).toContain('git add groups/global/knowledge-base/');
    expect(commands).toContain('git diff --cached --quiet');
    expect(commands.some((c: string) => c.startsWith('git commit'))).toBe(
      false,
    );
    expect(commands).not.toContain('git push origin main');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stages, commits, and pushes when changes are present', async () => {
    stubGit({ dirty: true });

    await syncKnowledgeBase(
      {
        registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }),
        sendMessage,
      },
      { now: FIXED_NOW },
    );

    const commands = mockExecSync.mock.calls.map((c) => c[0]);
    expect(commands).toContain('git add groups/global/knowledge-base/');
    const commitCmd = commands.find((c: string) => c.startsWith('git commit'));
    expect(commitCmd).toBeDefined();
    expect(commitCmd).toContain(EXPECTED_SUBJECT);
    expect(commands).toContain('git push origin main');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('never stages paths outside groups/global/knowledge-base/', async () => {
    stubGit({ dirty: true });

    await syncKnowledgeBase(
      {
        registeredGroups: () => ({ 'main@g.us': MAIN_GROUP }),
        sendMessage,
      },
      { now: FIXED_NOW },
    );

    const addCommands = mockExecSync.mock.calls
      .map((c) => c[0] as string)
      .filter((c) => c.startsWith('git add'));
    expect(addCommands).toEqual(['git add groups/global/knowledge-base/']);
  });

  it('sends a failure ping to the main group when push is rejected', async () => {
    stubGit({ dirty: true, pushFails: true, commitsAhead: 3 });

    await syncKnowledgeBase(
      {
        registeredGroups: () => ({
          'main@g.us': MAIN_GROUP,
          'other@g.us': NON_MAIN_GROUP,
        }),
        sendMessage,
      },
      { now: FIXED_NOW },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [jid, text] = sendMessage.mock.calls[0];
    expect(jid).toBe('main@g.us');
    expect(text).toContain('KB autopush failed');
    expect(text).toContain('3 commits queued locally');
    expect(text).toContain('git pull --rebase && git push');
    expect(mockExecSync.mock.calls.map((c) => c[0])).toContain(
      'git rev-list --count origin/main..HEAD',
    );
  });

  it('logs and does not throw when push is rejected but no main group is registered', async () => {
    stubGit({ dirty: true, pushFails: true, commitsAhead: 1 });

    await expect(
      syncKnowledgeBase(
        {
          registeredGroups: () => ({ 'other@g.us': NON_MAIN_GROUP }),
          sendMessage,
        },
        { now: FIXED_NOW },
      ),
    ).resolves.toBeUndefined();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no main group registered'),
    );
  });
});
