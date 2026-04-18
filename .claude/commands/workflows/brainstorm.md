---
name: workflows:brainstorm
description: Explore requirements and approaches through collaborative dialogue before planning implementation
argument-hint: "[feature idea or problem to explore]"
---

# Brainstorm a Feature or Improvement

**Effort:** Switch to high (`/model`) before running — this is judgment-heavy work.

**Note: The current year is 2026.** Use this when dating brainstorm documents.

Brainstorming helps answer **WHAT** to build through collaborative dialogue. It precedes `/workflows:plan`, which
answers **HOW** to build it.

**Process knowledge:** Load the `brainstorming` skill for detailed question techniques, approach exploration patterns,
and YAGNI principles.

## Feature Description

<feature_description> #$ARGUMENTS </feature_description>

**If the feature description above is empty, ask the user:** "What would you like to explore? Please describe the
feature, problem, or improvement you're thinking about."

Do not proceed until you have a feature description from the user.

## Execution Flow

### Phase 0: Assess Requirements Clarity

Evaluate whether brainstorming is needed based on the feature description.

**Clear requirements indicators:**

- Specific acceptance criteria provided
- Referenced existing patterns to follow
- Described exact expected behavior
- Constrained, well-defined scope

**If requirements are already clear:**
Use **AskUserQuestion tool** to suggest: "Your requirements seem detailed enough to proceed directly to planning. Should
I run `/workflows:plan` instead, or would you like to explore the idea further?"

### Phase 1: Understand the Idea

#### 1.1 Repository Research (Lightweight)

Run a quick repo scan to understand existing patterns:

- Task repo-research-analyst("Understand existing patterns related to: <feature_description>")

Focus on: similar features, established patterns, CLAUDE.md guidance.

#### 1.2 Collaborative Dialogue

Use the **AskUserQuestion tool** to ask questions **one at a time**.

**Guidelines (see `brainstorming` skill for detailed techniques):**

- Prefer multiple choice when natural options exist
- Start broad (purpose, users) then narrow (constraints, edge cases)
- Validate assumptions explicitly
- Ask about success criteria

**Exit condition:** Continue until the idea is clear OR user says "proceed"

### Phase 2: Explore Approaches

Propose **2-3 concrete approaches** based on research and conversation.

For each approach, provide:

- Brief description (2-3 sentences)
- Pros and cons
- When it's best suited

Lead with your recommendation and explain why. Apply YAGNI—prefer simpler solutions.

Use **AskUserQuestion tool** to ask which approach the user prefers.

### Phase 3: Capture the Design

Write a brainstorm document to `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md`.

**Required sections** (in this order):

```markdown
# Title

**Date:** YYYY-MM-DD
**Status:** Brainstorm

## What We're Building

## Why This Matters

## Settled Approach (or "Settled Decisions")

## Knowledge Destination

## Open Questions
```

The **Knowledge Destination** section declares where content goes at wrap-up:

| Destination                                                  | When                                                                           |
|--------------------------------------------------------------|--------------------------------------------------------------------------------|
| `solution:` docs/solutions/{category}/{slug}.md (new/update) | Solved a **problem with symptoms** — bug, perf issue, confusing behavior       |
| `architecture:` docs/architecture/{file}.md (update)         | **Changes how a subsystem works** — new data flow, new component relationships |
| `decisions:` append                                          | **Isolated decision** that doesn't warrant a full doc                          |
| `none`                                                       | Knowledge lives in the code — no symptoms, no architecture change              |

Ensure `docs/brainstorms/` directory exists before writing.

### Phase 4: Handoff

Use **AskUserQuestion tool** to present next steps:

**Question:** "Brainstorm captured. What would you like to do next?"

**Options:**

1. **Proceed to planning** - Run `/workflows:plan` (will auto-detect this brainstorm)
2. **Refine design further** - Continue exploring
3. **Done for now** - Return later

## Output Summary

When complete, display:

```
Brainstorm complete!

Document: docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md

Key decisions:
- [Decision 1]
- [Decision 2]

Next: Run `/workflows:plan` when ready to implement.
```

## Important Guidelines

- **Stay focused on WHAT, not HOW** - Implementation details belong in the plan
- **Ask one question at a time** - Don't overwhelm
- **Apply YAGNI** - Prefer simpler approaches
- **Keep outputs concise** - 200-300 words per section max

NEVER CODE! Just explore and document decisions.
