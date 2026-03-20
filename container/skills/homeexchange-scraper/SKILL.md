# HomeExchange Scraper

Search, evaluate, and track HomeExchange listings for summer 2026 trip planning.

Target cities: London, Copenhagen, Stockholm, Helsinki.
Trip window: mid-June through August 21, 2026.
Party size: 5 people.
Our home ID: 1632849 (San Francisco).
Guest points: 4400+ (growing as incoming requests confirm).

## How It Works

All API requests go through a read-only proxy on the host (`$HOMEEXCHANGE_PROXY_URL`). The proxy handles authentication and blocks any write operations. The container never sees credentials.

Scripts are at `/home/node/.claude/skills/homeexchange-scraper/`.
City configs are at `/home/node/.claude/skills/homeexchange-scraper/cities.json`.
Knowledge base is at `/workspace/global/knowledge-base/homeexchange/`.

## Three-Step Pipeline

### Step 1: Fetch all listings for a city

```bash
node /home/node/.claude/skills/homeexchange-scraper/save-city.mjs --city helsinki --max-pages 10
```

Fetches ALL listings in the city bounds (adults=1), then tags each as `suitable` or not.

Suitable = verified AND contact allowed AND NOT private room AND 5+ adult sleeping spots AND 2+ bedrooms AND 50%+ response rate.

Adult sleeping spots = big_double_bed*2 + double_bed*2 + single_bed + double_bed_up*2 + single_bed_up (excludes children's beds and baby beds). The `_up` suffix means put-up/sofa beds.

Saves everything to `/workspace/global/knowledge-base/homeexchange/cities/{city}.json`.

IMPORTANT: Always use the default dates (Jul 1 – Aug 21, flex 0). Omitting dates returns FEWER results, not more. Never pass --no-dates.

Options:
- `--max-pages 10` (need this to get all results; default is 5)
- `--reverse 1632849` (filter to reciprocal candidates only)
- `--from` / `--to` / `--flexibility` (override date range; defaults are correct for this trip)

### Step 2: Enrich suitable listings with calendar, wishlist, and details

```bash
node /home/node/.claude/skills/homeexchange-scraper/enrich-city.mjs --city helsinki
```

For each suitable listing, fetches:
- **Calendar**: availability windows for summer 2026. Types: BOOKED, NON_RECIPROCAL (GP only), RECIPROCAL (reciprocal only).
- **User alerts (wishlist)**: where they want to travel. Classified as exact/region/state/country/none relative to San Francisco.
- **Full home details**: features, rules, full description text, whether they prefer reciprocal.

Options:
- `--all` (enrich all listings, not just suitable)
- `--force` (re-enrich already enriched listings)
- `--delay-ms 3000` (slow down if rate limited; default 2000)

### Step 3: Generate a report

```bash
node /home/node/.claude/skills/homeexchange-scraper/report-map.mjs --city helsinki
```

This generates an interactive HTML file with a map and table at:
`/workspace/global/knowledge-base/homeexchange/reports/{city}.html`

IMPORTANT: After generating the report, you MUST do exactly these two things:

1. Send the HTML file as a document attachment:
   Use `mcp__nanoclaw__send_document` with `file_path="/workspace/global/knowledge-base/homeexchange/reports/helsinki.html"`

2. Send a brief text summary:
   Use `mcp__nanoclaw__send_message` with a one-line summary like "Helsinki: 11 suitable listings attached"

Do NOT paste the report content as text. Do NOT use markdown tables. The user will open the HTML file in their browser.

Options:
- `--all` (include unsuitable listings too)

## Responding to User Requests

When the user asks about HomeExchange listings:

**"Show me Helsinki listings"** or **"What's available in Helsinki?"**
→ If city data exists in the knowledge base, just run `report-map.mjs` and send the document. Do NOT re-scrape.
→ If no data, run save-city then enrich-city then report-map.

**"Refresh Helsinki"** or **"Update Helsinki listings"**
→ Run `save-city.mjs` then `enrich-city.mjs` then `report-map.mjs`.

**"Show me all four cities"** or **"Run the full pipeline"**
→ Run all three steps for each city: london, copenhagen, stockholm, helsinki.

**"What reciprocal options are there for Stockholm?"**
→ Run `save-city.mjs --city stockholm --reverse 1632849 --max-pages 10`, then enrich, then report.

**"Tell me about listing 1473180"**
→ Look it up in the city JSON. If enriched, show full details. If not, enrich it first.

**Questions about the data** (e.g., "which Helsinki listings are available in July?", "who has the most reviews?")
→ Read the city JSON from the knowledge base and answer from the stored data. No need to re-fetch.

## Low-Level Search (for ad-hoc queries)

The `search.mjs` script provides direct API access:

```bash
node /home/node/.claude/skills/homeexchange-scraper/search.mjs --city london
node /home/node/.claude/skills/homeexchange-scraper/search.mjs --city london --hood hampstead
node /home/node/.claude/skills/homeexchange-scraper/search.mjs --detail <home_id>
node /home/node/.claude/skills/homeexchange-scraper/search.mjs --calendar <home_id>
node /home/node/.claude/skills/homeexchange-scraper/search.mjs --alerts <user_id>
node /home/node/.claude/skills/homeexchange-scraper/search.mjs --enrich <home_id>
```

## City & Neighborhood Context

**London** — Difficult on HomeExchange. Good neighborhoods: Hampstead, Islington, Highbury, Hackney, Stoke Newington, Camden, Clapham, Balham, Brixton, Peckham, Notting Hill, Queen's Park. Too far: Ealing, Greenwich. Potential reciprocal exchange Jul 29 – Aug 9 in Clapham/Balham.

**Copenhagen** — Nørrebro, Vesterbro, Frederiksberg (bigger apartments), Christianshavn (rare), Østerbro, Indre By.

**Stockholm** — Södermalm (hip), Östermalm, Kungsholmen (underrated), Vasastan, Norrmalm, Gamla Stan.

**Helsinki** — Kallio (hip), Töölö (bigger, near sea), Punavuori/Design District, Kruununhaka, Ullanlinna, Kamppi. Very compact — almost anywhere within 3km of central station works.

## Trip Planning Context

- Flexible dates mid-June through Aug 21, 2026
- Most European exchangers travel July/August (school holidays)
- Potential reciprocal: London Jul 29 – Aug 9 (Clapham/Balham)
- Guest points growing from incoming requests early Jul through early Aug
- Prefer longer stays (7-10 nights per city) over tourist-length
- 3-4 week total trip, 3-4 cities
- No car — walkable neighborhoods with good transit
- Consider: Helsinki first (longest days in June), then Stockholm, Copenhagen, London last
