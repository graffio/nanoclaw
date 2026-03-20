# Stephen Tobin — Strategic Wave Trading

Substack newsletter by Stephen Tobin covering small/micro-cap stock analysis, portfolio management, and trade ideas.

## Structure

- `index.json` — metadata and year list
- `index-{year}.json` — post and chat index per year with titles, dates, URLs, summaries
- `posts/` — full post content as markdown (one file per post)
- `tickers/` — per-ticker dossier files (analysis, mentions, price targets)
- `chat/` — archived chat conversations about Tobin's analysis
- `notes/` — scraped Substack Notes (short-form posts/comments)
- `derived/` — computed data: `holdings/` (weekly snapshots), portfolio history CSV, account balances CSV
- `images/` — screenshots and charts from posts
- `credentials/` — scraping credentials (per-group, not shared)

## Scraping

Managed by the **substack-scraper** skill (`container/skills/substack-scraper/SKILL.md`). Posts are scraped from `stephentobin.substack.com`.

## Usage

Read `index-{year}.json` to find posts by date or topic, then read individual files from `posts/` or `tickers/` for detail. Chat transcripts are in `chat/`.
