# Upstream Merge Policy

We track `upstream` (https://github.com/qwibitai/nanoclaw.git) but do NOT bulk-merge
`upstream/main`. Instead we cherry-pick individual commits after reviewing them.

## Why not bulk merge?

Upstream's `main` branch bakes in OneCLI Agent Vault as the credential system. We use
Apple Container with the native credential proxy, which is an explicitly supported but
opt-in path. Bulk merging brings in OneCLI imports, removes credential proxy code, and
requires re-applying skill branches (`skill/native-credential-proxy`,
`skill/apple-container`) every time. The conflict surface is large and touches core files.

## Update workflow

1. A daily cron job fetches `upstream` and compares against our last-reviewed commit
   (stored in `scripts/upstream-state.json`).
2. New commits are categorized and sent as a Telegram summary.
3. Interesting commits are cherry-picked individually or in small batches.
4. Cherry-picked commits are recorded in the `cherry_picked` array in
   `scripts/upstream-state.json` so they are not proposed again.

## Architectural divergences

These are deliberate differences from upstream that must be preserved on any merge or
cherry-pick. If a commit touches these areas, it needs manual review.

### Runtime: Apple Container (not Docker)

- `src/container-runtime.ts`: `CONTAINER_RUNTIME_BIN = 'container'`,
  `CONTAINER_HOST_GATEWAY = '192.168.64.1'`
- Mount syntax uses `--mount type=bind` (not `-v`)
- Upstream's Docker-specific changes (e.g. `-t 1` stop timeout) may not apply

### Credentials: native credential proxy (not OneCLI)

- `src/credential-proxy.ts` and its import in `src/index.ts` must stay
- `src/container-runner.ts`: injects `ANTHROPIC_BASE_URL` pointing at the proxy
- Any commit that imports `@onecli-sh/sdk` or removes credential proxy code is
  incompatible. The `/use-native-credential-proxy` skill branch exists for this but
  we handle it by simply not merging those commits.
- `package.json`: do NOT add `@onecli-sh/sdk`, do NOT remove credential proxy deps

### HomeExchange proxy

- `src/homeexchange-proxy.ts` and its import in `src/index.ts` — our addition
- `src/container-runner.ts`: injects `HOMEEXCHANGE_PROXY_PORT` env var into containers
- Not upstream; will never conflict with upstream changes, but cherry-picks that
  rewrite `buildContainerArgs()` or container env setup need our additions preserved

### Logger: dates in timestamps

- `src/logger.ts`: our timestamp format includes the date (`yyyy-mm-dd HH:MM:ss.l`),
  not just time-of-day. Upstream's built-in logger (replaced pino in 1.2.36) only
  outputs `HH:MM:SS.mmm`. If we adopt upstream's logger rewrite, patch `ts()` to
  include the date.

### Global knowledge-base mount

- `src/container-runner.ts`: mounts `groups/global` into every container (writable
  for main, readonly for others). Our addition, not upstream.

### Main container runs as root

- `src/container-runner.ts`: main containers use `RUN_UID`/`RUN_GID` env vars instead
  of `--user` flag. Our addition for elevated privilege handling.

### Telegram channel

- `src/channels/telegram.ts`: we keep our local copy. Upstream deleted it from `main`
  (moved to separate `nanoclaw-telegram` repo). Cherry-picks that delete this file
  must be rejected. We also have the `telegram` remote but track our own copy.

### Activity logging

- `src/container-runner.ts`: captures `[tool]` lines from stderr for activity summaries
  in logs. Our addition.

### Stop command

- `src/index.ts`: `/stop` command for interrupting agent turns. Our addition.

### Heartbeat

- `src/index.ts`, `src/group-queue.ts`: `notifyActivity()`, `isStopping()`,
  `setHeartbeatFn()` for periodic "still working" messages. Our addition.

### sendDocument

- `src/index.ts`: `sendDocument` channel capability. Our addition.

### groups/main/CLAUDE.md

- We deleted this file (redundant with `groups/global/CLAUDE.md`). Upstream keeps and
  updates it. Reject any commit that re-creates it unless the content is genuinely new.

### Dependencies we added

- `grammy` — Telegram bot framework
- `turndown` — HTML-to-markdown conversion
- These must be preserved in `package.json` on any cherry-pick that modifies deps.

## Cherry-pick log

Commits successfully cherry-picked from upstream, with date applied:

(See `scripts/upstream-state.json` for machine-readable record)
