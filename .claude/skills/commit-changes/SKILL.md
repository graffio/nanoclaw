# Commit Changes

Goal: Message understandable 6 months later without reading the diff.

## Steps

1. **Check scope** - `git status --short`
2. **Identify problem/solution/impact** - From context of work just done
3. **Draft message** - Using format below
4. **Verify** - Would someone new understand this?

## Message Format

```
[Problem being solved, ~50 chars]

Problem: What was wrong/missing and why it matters (2-3 sentences)

Solution: The approach with enough detail to understand without the diff. Use bullet points.

Impact: What this enables, prevents, or improves.

Changes by purpose:
- component/dir: What and why
- component/dir: What and why
```

## Warning Signs (commit too large)

- Touches >3 subsystems
- "Changes by purpose" has >4 items
- Can't name it in one sentence

## Rules

- Lead with the problem, not the code change
- No jargon without definition
- No "Refactor code" / "Fix bugs" / "WIP"
- Self-contained—don't assume reader knows context
