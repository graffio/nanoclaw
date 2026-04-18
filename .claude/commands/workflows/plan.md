---
name: workflows:plan
description: Generate a task file from a brainstorm document
argument-hint: "[brainstorm file path]"
---

# Plan

**Effort:** Switch to high (`/model`) before running — this is judgment-heavy work.

Generates a task file with intent-level steps. Claude decides file-level implementation details and commit
boundaries. The pre-commit hook and wrap-up review provide quality enforcement.

## Input

<brainstorm_input> #$ARGUMENTS </brainstorm_input>

**If a brainstorm file path:** Read it. Verify it has a settled approach and no open questions.

**If a feature description or empty:** Ask: "Run `/workflows:brainstorm` first — planning requires a brainstorm with
settled decisions."

**If brainstorm has open questions:** Stop. "This brainstorm has open questions — resolve them before planning."

---

## Research

Before generating, search `docs/solutions/` for relevant past solutions:

```
learnings-researcher("Search docs/solutions/ for: {brainstorm topic and scope}")
```

Include relevant findings as context when generating steps — past mistakes, patterns that worked, gotchas.

**If brainstorm scope is narrow and self-contained** (single module, clear approach) — skip research.

---

## Generate Task File

Read `.claude/preferences.md` and the brainstorm's Settled Approach before generating.

**Output path:** `docs/brainstorms/{brainstorm-name}.task.json`

### Schema

```json
{
    "feature"          : "Short name",
    "goal"             : "One sentence — what and why",
    "brainstorm"       : "docs/brainstorms/{name}.md",
    "not_building"     : ["Explicit scope exclusions from brainstorm"],
    "integration_tests": ["test/relevant.integration-test.js"],
    "steps"            : [
        {
            "step"            : 1,
            "intent"          : "What this logical unit accomplishes (1-2 sentences)",
            "scope"           : "Which modules/areas are touched — enough for resumption, not file-level prescription",
            "key_constraints" : ["Settled decisions from the brainstorm that Claude might otherwise re-open"],
            "style_cards"     : ["js-module", "test-file"],
            "acceptance"      : "How to know this step is done (1 sentence)",
            "status"          : "pending",
            "notes"           : ""
        },
        {
            "step"            : 2,
            "intent"          : "Commit step 1",
            "scope"           : "git",
            "key_constraints" : [],
            "style_cards"     : [],
            "acceptance"      : "Changes from step 1 committed with Problem/Solution/Impact message",
            "status"          : "pending",
            "notes"           : ""
        }
    ],
    "verification"     : ["How to confirm the feature works end-to-end"]
}
```

### Step design

Steps are **logical work units**, not file edits.

- **3-8 implementation steps** for a typical feature (plus one commit step each). Fewer than 3 means the feature is
  simple enough to just implement without a plan. More than 8 means decompose the brainstorm into smaller features.
- **Intent** describes what Claude is building, not which files to edit. "Build filter resolution pipeline — merge chip
  filters into IR, chip-wins on conflict" not "Edit resolve-chip-filters.js." If the step introduces testable logic
  (new branching, business rules, bug fix with identifiable root cause), end the intent with what to test and the test
  type: "Unit test: count selector returns correct count per variant. Integration: assertion in positions-report that
  filtering to non-investment account shows 0." Unit tests for pure logic, integration tests for cross-component
  behavior. Prefer adding assertions to existing integration test files.
- **Scope** names modules and areas, enough that a resuming session can orient itself. Not file lists.
- **Key constraints** — settled decisions from the brainstorm that are relevant to this step. "Use LookupTable, not
  Map", "chip filters win on conflict", etc. Prevents Claude from re-opening decisions the brainstorm already closed.
  Omit if the step has no relevant constraints.
- **Style cards** lists which cards are relevant to this step (for documentation — all cards are loaded at session start).
- **Acceptance** is one sentence describing how to verify the step is done. Prefer testable criteria. Every step's
  acceptance implicitly includes "WHY comments present for all design decisions" — don't repeat it, but check it.
- **Notes** — Claude fills this in during and after implementation. Record deviations, surprises, and in-progress
  breadcrumbs (for resumption). "Started merge logic, 3 of 5 variant tests passing" is useful. Absence of notes on a
  completed step is a rule violation.

### What steps do NOT contain

- File-level edit instructions
- Mechanical review/validator steps (pre-commit hook handles enforcement)
- Code snippets or function signatures
- Prescribed implementation order within a step
- Separate test-only steps (tests go with their implementation step)

### Commit steps

Every implementation step is followed by a commit step — no exceptions. This is mechanical; the schema example above
shows the pattern. If two things must be committed together, they should be one implementation step.

### Style card mapping

When populating `style_cards` for a step, use this mapping:

| File pattern      | Style card        |
|-------------------|-------------------|
| `*.jsx`           | `react-component` |
| `**/selectors.js` | `selector`        |
| `*.tap.js`        | `test-file`       |
| Other `*.js`      | `js-module`       |

### Rules that still apply

These aren't generated as separate steps, but Claude must follow them during implementation:

- **Style cards:** Load all style cards at session start (they total ~160 lines — trivial at 1M context)
- **WHY comments:** Every design decision gets a WHY comment at the point of use — during implementation, not
  retroactively. "Chose X over Y because Z" belongs in the code, not in chat or commit messages. Before marking a
  step done, verify each decision made during the step has a corresponding WHY comment.
- **TDD:** Write failing tests first when introducing new branching logic or business rules. Do NOT write tests for:
  adding entries to lookup tables/registries, filtering/mapping with standard operations, passing new input to existing
  infrastructure, or wiring components to existing selectors.
- **Action tests:** When implementing a new Action variant → write TAP test for dispatch → reducer → new state
- **UI verification:** When a step adds keyboard, focus, or visual interaction → add specific manual verification items
  to the task file's `verification` array
- **Type definitions:** Modify `type-definitions/*.type.js`, never `src/types/*.js`. Run `yarn types:generate-all` after
- **Commit messages:** Use Problem/Solution/Impact format (see `.claude/tasks/commit-changes.md`)
- **Commit at logical boundaries:** Commit when a logical unit is complete, not at arbitrary file-type transitions
- **Complexity review:** When the style validator reports budget failures, run `review <file>` before attempting fixes.
  The review's simplification strategies table turns "budget exceeded" into actionable moves.
- **Complexity debt:** When modifying a file with `// COMPLEXITY:` or `// COMPLEXITY-TODO:` comments → clean them up,
  run the validator, and fix violations or ask before adding new exemptions
- **Step size:** When a step touches >5 files → split before proceeding, grouped by module or concern
- **Precedent:** When about to introduce a new pattern, library, or file organization that doesn't exist in the
  codebase → stop and flag: "No precedent for X — should I proceed?"
- **Scope discipline:** If it's not in a step's scope or intent, don't do it. If you discover necessary adjacent work,
  note it and ask before expanding scope

### Integration tests

Populate the task file's `integration_tests` array during planning by grepping ABOUTME comments in
`test/*.integration-test.js` for affected component or module names. This isn't limited to `.jsx` changes — selector,
reducer, or utility changes can break integration tests too. Wrap-up runs whatever is listed.

---

## Review the Plan

After generating the task file, spawn three review agents in parallel. Each receives the task file JSON and the
brainstorm document. No additional instructions beyond the agent's base prompt — let each agent apply its full
methodology.

**Agents:**

- **architecture-strategist**
- **code-simplicity-reviewer**
- **jeff-js-reviewer**

**After agents return:** For each point where reviewers flagged an issue or disagreed with each other, write a
**titled paragraph** that explains:

1. What the original plan said
2. What the reviewer(s) objected to and **why** (the reasoning, not just "flagged layer placement")
3. If reviewers disagreed with each other, what each side argued
4. Your assessment — which side you picked and your reasoning

Skip issues where all reviewers agreed and the fix is obvious (e.g., "file already supports this prop"). Just apply
those silently to the task file.

**Do not use tables or bullet lists for reviewer feedback.** Tables compress the reasoning into cryptic phrases that
don't communicate the actual trade-off. Paragraphs force you to explain the disagreement clearly enough for Jeff to
evaluate your judgment.

## Present the Plan

Present the generated task file summary. Include:

- Step count (implementation + commit steps)
- The `not_building` list (scope boundaries)
- Any precedent concerns (new patterns, new libraries)
- Reviewer feedback paragraphs (see above) — with changes already applied to the task file

Ask: "Plan ready. Should I start implementing?"
