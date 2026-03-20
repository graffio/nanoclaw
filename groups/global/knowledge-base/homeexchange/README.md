# HomeExchange

Home exchange listings for a summer 2026 Europe trip (London, Copenhagen, Stockholm, Helsinki).

## Structure

- `index.json` — trip parameters (dates, target cities, party size, potential exchanges)
- `cities/` — scraped listing data per city (JSON)
- `reports/` — pre-formatted HTML reports per city
- `maps/` — map visualizations
- `shortlist/` — shortlisted/favorited listings
- `dismissed/` — rejected listings

## Scraping

Managed by the **homeexchange-scraper** skill (`container/skills/homeexchange-scraper/`). Uses the HomeExchange API via an outbound proxy.

## Usage

Read `index.json` for trip context and target cities. City data is in `cities/{city}.json`. Reports in `reports/` are pre-formatted HTML summaries suitable for sending as document attachments.
