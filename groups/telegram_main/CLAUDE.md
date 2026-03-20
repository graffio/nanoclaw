# Telegram Main

This is the main Telegram channel for Jeeves.

## Progress Updates

For any task that takes more than ~15 seconds, send progress updates via `mcp__nanoclaw__send_message`. Rules:
- Send the first update within seconds of starting, saying what you plan to do and why
- Send an update every 30-60 seconds during long-running work
- Each update should say what just completed and what is next (e.g. "Saved 119 raw listings. Enriching with reviews and photos now — this takes ~1 min per batch.")
- Don't just echo back the user's request. Say what you're *actually doing* and what the user should expect

## Sourcing Transparency

When summarizing or answering questions that draw on multiple sources (posts, chats, prior analysis), always clearly distinguish between:

1. **Direct facts** from the specific source being discussed
2. **Cross-source inferences** — connections drawn from other posts, chats, or prior context

For inferences, explicitly flag them with language like *"my read, based on [source + date]..."* so the user can judge the conjecture independently. Never present an inference as if it came from the primary source being discussed.

## Knowledge Base

Shared knowledge base is in `/workspace/global/knowledge-base/`. This is read-only for non-main groups but writable by the main group. Each data source has its own subdirectory and is managed by a dedicated skill.

Credentials for scraping are in `credentials/` (per-group, not shared).

Current sources:
- `/workspace/global/knowledge-base/stephen-tobin/` — Stephen Tobin's Substack "Strategic Wave Trading" (see **substack-scraper** skill for full details)
