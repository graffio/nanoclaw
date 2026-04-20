# Knowledge Base Autosync

## What this is

A post-container-exit lifecycle hook in the NanoClaw orchestrator that
automatically commits and pushes any changes under
`groups/global/knowledge-base/` after every container run — scheduled or
interactive. It runs on the host, never inside a container.

## Why it exists

Scraper containers (homeexchange, substack, and future ones) write fresh
knowledge to `groups/global/knowledge-base/` on every run. Without this
hook, that knowledge lives only on the Mac running NanoClaw:

- A disk failure or reinstall loses the data.
- The GitHub copy drifts behind reality, so diffs and history aren't
  grep-able.
- The operator has to remember to stage and push manually — a step that
  was being done by hand as recently as commit
  `c958390 Add scraped knowledge for Apr 19`.

Automating it removes a step the operator had to remember and keeps the
GitHub copy continuously current.

## Invariants this hook guarantees

1. **Path scope is exactly `groups/global/knowledge-base/`.** Nothing
   outside that prefix is ever staged. Unrelated WIP in `src/`, `docs/`,
   scripts, etc. is structurally unable to sneak into an auto-commit.
2. **No empty commits.** After staging, the index is checked with
   `git diff --cached --quiet`; if there are no real changes, the hook
   does nothing and produces no log noise.
3. **One attempt, no auto-rebase, no force-push.** If `git push origin
   main` is rejected (for example because origin is ahead), the commit
   stays local, the hook returns cleanly, and the operator resolves it
   on their own schedule with `git pull --rebase && git push`. The hook
   will never rewrite history or overwrite upstream state.
4. **`origin` only.** Other remotes (`telegram`, `upstream`, etc.) are
   never touched.
5. **Host-side only.** The hook fires from the orchestrator, outside any
   container. Container sandboxes do not gain push capability and
   container credentials stay absent — no SSH keys or git tokens leak
   into the agent's environment.
6. **Never blocks the scraper.** The hook runs in a `finally` block
   wrapped in its own try/catch, so sync errors are logged but never
   propagate to the user-visible result or to the scheduler's retry
   logic. A broken autosync will never take the orchestrator down.
7. **Fires on both success and error exits.** A scraper that crashed
   partway through may still have written knowledge; the `finally`
   placement ensures those changes still get committed.

## Commit subject format

`Knowledge base update YYYY-MM-DD HH:MM`, with both date and time
computed in `TIMEZONE` (from `src/config.ts`) via `Intl.DateTimeFormat`.

The subject is generic and scraper-agnostic on purpose: the commit
diff itself tells the story, and `git show <sha>` is a click away.
This avoids inventing a scraper → orchestrator IPC contract just to
produce a prettier commit message.

## Push-failure visibility

When `git push origin main` is rejected, the orchestrator sends one
short message to the main Telegram group:

> KB autopush failed — N commits queued locally, resolve with
> `git pull --rebase && git push`

`N` is computed from `git rev-list --count origin/main..HEAD` at ping
time, so the message reflects the real size of the local backlog even
if several scrapers failed to push in succession.

The ping fires on every failure. Local commits are safe; the message
is a nudge to resolve, not an emergency alert.

If no main group is registered at the moment of failure, the hook logs
the condition and returns without throwing. Commits still sit local and
will push the next time the operator runs `git pull --rebase && git
push`.

## What this hook does not do

The following are explicit non-goals — deliberately excluded to keep
the trigger surface narrow and the failure modes predictable:

- **No per-scrape user notifications.** There is no WhatsApp/Telegram
  ping when new knowledge lands. The commit log is the notification.
- **No periodic sweeper or cron.** The only trigger is
  post-container-exit. A stray host-side manual edit to a ticker file
  will not be auto-committed.
- **No retry loop or auto-rebase on push rejection.** One attempt,
  leave it local, ping the operator, done.
- **No auto-commit outside `groups/global/knowledge-base/`.** Even if
  a container writes elsewhere on the filesystem, this hook will not
  touch it.
- **No scraper → orchestrator IPC contract for commit messages.** The
  subject is generic. Scrapers remain unaware the hook exists.

## Where to find it

- `src/knowledge-base-autosync.ts` — the `syncKnowledgeBase` module.
- `src/knowledge-base-autosync.test.ts` — unit tests for the five
  decision branches (no-changes, staged-but-empty, success,
  push-rejection-with-main, push-rejection-no-main).
- `src/index.ts` — invokes `syncKnowledgeBase` in a `finally` block on
  the try wrapping `runContainerAgent` in `runAgent`, for interactive
  (channel-triggered) runs.
- `src/task-scheduler.ts` — same pattern in `runTask`, for scheduled
  runs.
