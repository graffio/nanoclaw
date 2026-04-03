---
name: update-nanoclaw
description: Cherry-pick upstream NanoClaw updates using our merge policy. Reads docs/MERGE-POLICY.md for architectural decisions and scripts/upstream-state.json for tracking.
---

# Update NanoClaw (Cherry-Pick Workflow)

We do NOT bulk-merge upstream/main. We cherry-pick individual commits after review.
Read `docs/MERGE-POLICY.md` for the full rationale and list of architectural divergences.

## Step 0: Preflight

1. Check for clean working tree: `git status --porcelain`
   - If dirty, tell user to commit or stash first.

2. Confirm upstream remote exists: `git remote -v`
   - If missing, add: `git remote add upstream https://github.com/qwibitai/nanoclaw.git`

3. Fetch: `git fetch upstream --prune`

## Step 1: Load context

Read these files:
- `docs/MERGE-POLICY.md` — architectural divergences and merge decisions
- `scripts/upstream-state.json` — last reviewed commit, cherry-picked hashes, skipped hashes

## Step 2: Find new commits

Run: `git log --oneline --no-merges <last_reviewed_commit>..upstream/main`

Filter out:
- Commits already in `cherry_picked` array (by hash prefix match)
- Commits already in `skipped` array
- Noise: version bumps, token count updates, prettier/eslint formatting, CI changes

## Step 3: Categorize and present

For each remaining commit, check what files it touches (`git diff-tree --no-commit-id --name-only -r <hash>`).

Flag as **incompatible** if the diff contains:
- `@onecli-sh/sdk` import
- Removal of credential proxy code
- Deletion of `src/channels/telegram.ts`

Flag as **needs review** if it touches:
- `src/container-runner.ts` (our HomeExchange proxy, global mount, isMain, activity logging)
- `src/index.ts` (our /stop command, heartbeat, credential proxy, HomeExchange proxy)
- `src/container-runtime.ts` (our Apple Container constants)
- `src/logger.ts` (our date-in-timestamp format)
- `package.json` (dependency changes)

Present commits grouped by category:
- Security (highest priority)
- Bug fixes
- Features
- Incompatible (explain why)
- Needs review (explain which divergence is affected)

Use AskUserQuestion to ask which commits to cherry-pick. Options:
- Pick all safe commits
- Pick specific commits (list hashes)
- Skip all — just update the reviewed marker

## Step 4: Cherry-pick

For each selected commit:

1. Try: `git cherry-pick <hash> --no-commit`
2. If clean: review the staged diff, commit with message:
   ```
   Cherry-pick: <original commit message>

   From upstream <hash>.
   ```
3. If conflict:
   - Read `docs/MERGE-POLICY.md` to determine which side to favor
   - Show the user each conflict with explanation of what each side changed
   - Resolve per the policy (keep our divergences, accept upstream improvements)
   - If unsure, ask the user
4. Run `npm run build` after each pick to verify compilation
5. Run `npx vitest run` on affected test files

After all picks, run full test suite: `npx vitest run`

## Step 5: Update state

Update `scripts/upstream-state.json`:
- Set `last_reviewed_commit` to the tip of upstream/main
- Add picked commits to `cherry_picked` array with description and date
- Add skipped commits to `skipped` array with reason
- Set `last_check` to today

## Step 6: Summary

Show:
- Commits cherry-picked (with descriptions)
- Commits skipped (with reasons)
- Any test failures or build warnings
- Reminder to restart: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

## Key rules

- NEVER bulk merge upstream/main
- ALWAYS read docs/MERGE-POLICY.md before resolving any conflict
- ALWAYS keep our credential proxy (reject OneCLI)
- ALWAYS keep our Apple Container runtime constants
- ALWAYS keep date in logger timestamps
- ALWAYS keep our Telegram channel file
- ALWAYS preserve HomeExchange proxy, global mount, isMain handling, /stop, heartbeat
- When in doubt about a conflict, ask the user
