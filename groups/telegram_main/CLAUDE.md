# Telegram Main

This is the main Telegram channel for Jeeves.

## Progress Updates

For any multi-step task, send progress updates via `mcp__nanoclaw__send_message` as you go. Don't wait — send the first update within seconds of starting.

## Knowledge Base

Shared knowledge base is in `/workspace/global/knowledge-base/`. This is read-only for non-main groups but writable by the main group. Each data source has its own subdirectory and is managed by a dedicated skill.

Credentials for scraping are in `credentials/` (per-group, not shared).

Current sources:
- `/workspace/global/knowledge-base/stephen-tobin/` — Stephen Tobin's Substack "Strategic Wave Trading" (see **substack-scraper** skill for full details)
