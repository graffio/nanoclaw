# Substack Scraper — Stephen Tobin / Strategic Wave Trading

This skill handles scraping, indexing, and derived data extraction from Stephen Tobin's Substack newsletter "Strategic Wave Trading".

Knowledge base location: `/workspace/global/knowledge-base/stephen-tobin/`
Credentials location: `/workspace/group/credentials/substack-cookies.json`

## CRITICAL RULES — apply to ALL scraping and data extraction tasks

1. **Stephen-only filter for chat and comments**: NEVER save messages from other users unless they are the direct parent of a Stephen Tobin reply (for context). Stephen's username variants: "stephen Tobin", "Stephen Tobin", "stephentobin". When in doubt, check the author field.
2. **Always update index-{year}.json**: Every piece of scraped content MUST be indexed in `index-{year}.json`. If you scrape chat messages, add them to the `chat` array. If you scrape notes, add them to the `notes` array. The index is the primary lookup mechanism.
3. **Extract tickers**: Every post, note, and chat message must have a `tickers` array in the index, even if empty. Look for stock symbols (e.g., PONY, QRHC, 0425.HK) and company names that imply tickers.
4. **Classify posts**: Every post entry must have a `post_type` field — see Post Types section below.
5. **Use the correct directories**: Posts go in `posts/{slug}.md`, notes in `notes/{entity_key}.md`, chat in `chat/{date}-{topic-slug}.md`. NOT in the root `stephen-tobin/` directory.
6. **Read the existing index-{year}.json first** before scraping, to avoid duplicating work.
7. **Update derived data**: After scraping, always run the derived data extraction step (ticker files, portfolio snapshots). Derived data is as important as the raw content.

## Structure

```
/workspace/global/knowledge-base/stephen-tobin/
├── index.json              # Root manifest: source URL, last_scraped, list of year files
├── index-2026.json         # All items for 2026 (posts, notes, chat) sorted by date desc
├── images/                 # Downloaded images from posts
│   └── {slug}-{n}.png
├── posts/                  # Full post content as markdown
│   └── {slug}.md
├── notes/                  # Notes as markdown
│   └── {entity_key}.md
├── chat/                   # Stephen's chat messages ONLY (+ parent for context)
│   └── {date}-{topic-slug}.md
├── tickers/                # Per-ticker timeline (derived, append-only)
│   ├── MDA.md
│   ├── OWL.md
│   └── ...
└── derived/                # Portfolio snapshots and history (derived)
    ├── portfolio-history.csv
    └── holdings/
        └── {date}.json
```

## Content Model

Stephen Tobin's Substack ("Strategic Wave Trading") has three content types:

**Posts** — the main content, always paid except thematic pieces.

**Notes** — short-form: teasers, quick market reactions, portfolio performance snippets.

**Chat** — open comment threads. Mostly noise. ONLY Stephen's messages matter. Save each Stephen message with the thread topic and any parent message he's replying to. Discard everything else.

**Comments on posts/notes** — same rule: ONLY Stephen's comments. Append to the relevant post/note markdown as an "Author follow-up" section.

## Post Types

Classify every post into one of these types based on the title pattern and content:

| post_type | Title pattern | Content structure |
|-----------|--------------|-------------------|
| `trade_alert` | "Trade Alert #NNN: ..." or "Trade Alert: ..." | Single stock deep dive. Always contains: ticker, company name, position size (full=$600, half=$280), buy/sell action, current portfolio position (screenshot), thesis, risk assessment, conclusion. |
| `weekly_update` | "Weekly Update: ..." or "Weekly Review: ..." | Portfolio-wide. Always contains: weekly performance (% and $), account balance, cash position, holdings spreadsheet (screenshot), per-stock news digest for every holding, trades executed that week, forward outlook. |
| `sw_weekly` | "SW Weekly: ..." | Sector deep dive + brief portfolio performance at top. Analyzes a sector (humanoid robots, EVs, etc.), compares companies, often previews next week's trade alert. |
| `thematic` | No standard prefix | Broader topic for wider audience, often free/everyone. No portfolio data. |
| `stock_review` | "Reviewing Stocks" or similar | Mid-week review of concerning holdings. Per-stock bull/bear analysis with conclusion on hold/exit. |

## Data Extraction — what to pull from each post type

### From Trade Alerts, extract:
- Ticker and company name
- Action: buy / sell / add to position
- Position size and dollar amount
- Entry price if mentioned
- Key thesis points (2-3 sentences)
- Risk factors

### From Weekly Updates, extract:
- Portfolio total value, cash position
- Weekly change (% and $)
- Annualised IRR if mentioned
- Trades executed (ticker, action, amount)
- Per-stock news items (ticker → headline + key numbers)
- Any stocks flagged "under review"

### From SW Weekly, extract:
- Sector being analyzed
- Companies compared and Stephen's ranking/preference
- Portfolio performance summary
- Any trades mentioned or previewed

### From Stock Reviews, extract:
- Each stock reviewed: ticker, current position, P&L
- Bull case and bear case
- Conclusion: hold / exit / watch

## Derived Data

After scraping and extracting from raw posts, update these derived files:

### Ticker Files (`tickers/{TICKER}.md`)

One file per ticker mentioned anywhere (posts, notes, chat). Append-only, chronological. Each entry has date, source type, and the relevant content:

Each ticker file MUST have this structure:

```markdown
# EH — Ehang Holdings

**Exchange:** NASDAQ
**Sector:** Advanced Air Mobility / eVTOL
**Status:** ACTIVE HOLD
**Fair Value Target:** $60

## Position Data

| Date | Status | Shares | Avg Buy | Latest | Invested | Open P&L | Return |
|------|--------|--------|---------|--------|----------|----------|--------|
| Mar 01 | Under review | 27 | $15.12 | $12.27 | $408 | -$76.99 | -19% |
| Mar 08 | Hold | 27 | $15.12 | $11.51 | $408 | -$97.51 | -24% |

## Key Events

### 2026-03-12 — Trade Alert #104
Added half-size position ($280, 1.5% of portfolio) following earnings.
Record Q4 revenue up 48.4% YoY. First GAAP profitable quarter.
```

The Position Data table is MANDATORY. Extract it from the portfolio spreadsheet screenshots in `images/`. Each weekly update has a holdings spreadsheet image — read it with vision and extract every row. When updating ticker files after a new weekly scrape, append a new row to the Position Data table.

Key Events entries must include hard numbers: share counts, entry prices, position sizes, dollar amounts, P&L percentages. Qualitative summaries without numbers are not sufficient.

### Portfolio History (`derived/portfolio-history.csv`)

Append a row for each weekly update:

```csv
date,total_value,cash,weekly_change_pct,weekly_change_usd,holdings_count,irr,sp500_comparison
2026-03-15,14113,3200,-1.4,-196,26,,outperformed
2026-03-08,14309,3428,-1.9,-368,26,105.9,marginally better
2026-03-01,14677,3428,-0.3,-40,26,105.9,
```

Extract these numbers from the portfolio performance sections and screenshots in weekly updates.

### Holdings Snapshots (`derived/holdings/{date}.json`)

After each weekly update, if there's a holdings spreadsheet screenshot, extract it:

```json
{
  "date": "2026-03-01",
  "source": "weekly-update-q1-still-flat-and-long",
  "holdings": [
    {"ticker": "EH", "company": "Ehang", "shares": 100, "entry_price": 15.20, "current_price": 12.50, "pnl_pct": -17.8}
  ],
  "total_value": 14677,
  "cash": 3428
}
```

This REQUIRES reading the portfolio screenshot images with vision. The images are clear spreadsheets — you MUST extract the data. For each holding extract: ticker, status (Hold/Under review/Pre-Buy), $ invested, open profit, total return %, positions taken, shares bought, average buy price, latest price, fair value, target. If a field is partially legible, include what you can and mark it `"partial": true`.

## Index Schema

**Root manifest** (`index.json`): source URL, last_scraped timestamp, list of year files.

**Yearly index** (`index-{year}.json`): single `items` array, all content types mixed, sorted by date descending. Each item has a `type` field ("post", "note", "chat").

```json
{
  "year": 2026,
  "items": [
    {
      "title": "Trade Alert #103: ...",
      "date": "2026-03-10",
      "slug": "trade-alert-103-...",
      "type": "post",
      "post_type": "trade_alert",
      "audience": "only_paid",
      "summary": "...",
      "tickers": ["0425.HK"],
      "has_images": true
    },
    {
      "date": "2026-03-13",
      "type": "chat",
      "file": "2026-03-13-owl-entry.md",
      "summary": "Watching OWL — bank run style drop",
      "thread_topic": "OWL entry point",
      "tickers": ["OWL"]
    },
    {
      "date": "2026-03-14",
      "type": "note",
      "entity_key": "c-227667436",
      "summary": "Teaser note linking to AI Bubble post",
      "tickers": []
    }
  ]
}
```

The index MUST be kept in sync with scraped files. Every scraped item gets an index entry. When scraping, read `index.json` to find the current year file, then read `index-{year}.json` to check for duplicates. Create a new year file when January content arrives.

## Answering Questions from the Knowledge Base

When the user asks a question that might relate to knowledge base content:
1. **Per-ticker questions** ("what does he think of MDA?"): Read `tickers/MDA.md` for the full timeline
2. **Portfolio questions** ("what's his current portfolio?"): Read the latest `derived/holdings/{date}.json`
3. **Performance questions** ("how's he doing this year?"): Read `derived/portfolio-history.csv`
4. **General questions**: Read `index-{year}.json` index, search by title/summary/tickers/post_type, then read relevant files
5. Cite the source (title, date, type) in your answer
6. If images contained data (tables, spreadsheets), the extracted data is in the post markdown

## Scraping Substack

Credentials are stored per-group in `/workspace/group/credentials/substack-cookies.json`. Use them with curl:

```bash
COOKIES=$(cat /workspace/group/credentials/substack-cookies.json)
SID=$(echo "$COOKIES" | jq -r '.["substack.sid"]')
LLI=$(echo "$COOKIES" | jq -r '.["substack.lli"]')
COOKIE_HEADER="Cookie: substack.sid=$SID; substack.lli=$LLI"

# List posts
curl -s "https://stephentobin.substack.com/api/v1/archive?sort=new&limit=25&offset=0" \
  -H "$COOKIE_HEADER"

# Get a single post (returns JSON with body_html)
curl -s "https://stephentobin.substack.com/api/v1/posts/{slug}" \
  -H "$COOKIE_HEADER"
```

Note: the API endpoints for notes, chat, and comments need to be discovered. Use the browser
(`agent-browser`) to inspect network requests if curl endpoints aren't obvious. Check:
- Profile page: `https://substack.com/@stephentobin`
- Chat: look for chat-related API calls in the network tab
- Comments: try `https://stephentobin.substack.com/api/v1/post/{post_id}/comments`

### Scrape Workflow

1. Read `index-{year}.json` to know what's already scraped
2. Fetch the archive endpoint, paginate with `offset` until no more results (or until reaching already-scraped posts)
3. Compare against index to find new posts
4. For each new post:
   a. Fetch the full post JSON
   b. Convert `body_html` to clean markdown (strip tags, preserve structure)
   c. Download images from `<img>` tags to `images/{slug}-{n}.png`
   d. For images containing data (tables, spreadsheets, charts): read the image, extract data as markdown table
   e. Save as `posts/{slug}.md` with frontmatter (title, date, URL, type)
   f. Classify post type from title pattern (see Post Types table)
   g. Extract tickers mentioned
   h. Fetch Stephen's comments on the post (ONLY Stephen's), append as "Author follow-up" section
5. Scrape notes (discover the API endpoint first)
6. Scrape chat — **ONLY Stephen's messages** with thread topic and parent for context. Save as `chat/{date}-{topic-slug}.md`
7. Update `index-{year}.json` index with ALL new content and metadata
8. **Run derived data extraction**:
   a. For each ticker found in new content, update or create `tickers/{TICKER}.md`
   b. For weekly updates: extract portfolio numbers → append to `derived/portfolio-history.csv`
   c. For weekly updates with holdings screenshots: extract → save `derived/holdings/{date}.json`
   d. For trade alerts: extract trade details → update relevant ticker file
9. Report what was found

### Handling Images with Data

When you encounter an image that appears to contain tabular data (spreadsheet screenshot, table, chart):
- Download the image to `images/`
- Read the image file (you have vision capabilities)
- Extract the data into a markdown table
- Include both a reference to the image and the extracted table in the post markdown
- If it's a holdings spreadsheet from a weekly update, also extract to `derived/holdings/{date}.json`

### Rate Limiting

Keep requests under 1/second. Add a small delay between API calls when bulk scraping.

## Processing Existing Posts (no new scraping needed)

When asked to "process" or "extract data from" existing posts, skip steps 1-7 above and go straight to step 8. Read each post file in `posts/`, extract the relevant data, and update derived files. Also update `index-{year}.json` with any missing fields (post_type, tickers).

## Daily Scrape Task

When asked to set up daily scraping, create a scheduled task:

```bash
echo '{"type":"schedule_task","prompt":"Scrape Stephen Tobin Substack for new content. Follow the substack-scraper skill workflow exactly — read index-{year}.json first, check for new posts/notes/chat, apply Stephen-only filter for chat, extract tickers, classify posts, update the index, update all derived data (ticker files, portfolio history, holdings snapshots). Report what was found.","schedule_type":"cron","schedule_value":"0 8 * * *","context_mode":"isolated"}' > /workspace/ipc/tasks/scrape_$(date +%s).json
```
