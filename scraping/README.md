# Scrapling setup

This folder sets up [Scrapling](https://github.com/D4Vinci/Scrapling) — a free,
open-source scraping library — in its own virtual environment, isolated from
any other Python environment on the machine, plus a ready-to-run scraper for
the Allbirds product catalog.

## What's here

- `.venv/` (gitignored, created locally) — dedicated virtual environment for Scrapling.
- `requirements.txt` — pinned `scrapling[fetchers,shell]` version.
- `allbirds_scraper.py` — scrapes the full Allbirds catalog (all products +
  variants, with prices) and writes it to a CSV file.

## Setup

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/scrapling install   # downloads the Playwright/Camoufox browsers
```

Python 3.10+ is required (Scrapling 0.4.15's own requirement). This was
installed and verified against Python 3.11.15.

## Running the Allbirds scraper

```bash
./.venv/bin/python allbirds_scraper.py -o allbirds_catalog.csv
```

This uses Scrapling's `Fetcher` (browser-fingerprint-impersonating HTTP
client, no headless browser needed) against Allbirds' public Shopify
`/products.json` feed, paging through the whole catalog and flattening every
product's variants into their own CSV row (so a shoe with multiple sizes
becomes multiple rows, since price can vary per variant). Columns:
`product_id, product_title, product_type, vendor, handle, product_url,
variant_id, variant_title, sku, price, compare_at_price, available`.

Why the JSON feed instead of scraping rendered HTML: Allbirds' storefront is
a JS-rendered React app, so a plain HTML scrape would miss lazily-loaded
products and need a real browser plus scroll/pagination handling. Every
Shopify store exposes this same `/products.json` endpoint, so
`allbirds_scraper.py --store-url https://<other-shopify-store>.com` works
against any other Shopify storefront too.

## Note on where this was built

This setup was built and validated inside Claude Code's sandboxed remote
execution environment, which only allows outbound network access to a small
allowlist (PyPI, npm, Anthropic's own APIs, etc.) — it cannot reach arbitrary
websites. Concretely, in that sandbox:

- `pip install scrapling[fetchers,shell]` worked (PyPI is allowlisted) and is
  confirmed working end-to-end — parsing, CSV writing, and the full
  `allbirds_scraper.py` pipeline were unit-tested against mocked responses.
- `scrapling install` (which downloads Playwright's Chromium build from
  `cdn.playwright.dev`) is blocked in that sandbox. Browser automation itself
  was still verified working there by pointing Scrapling's `DynamicFetcher`
  at the sandbox's own pre-installed Chromium via `executable_path=...`
  against a local test page — so the browser-fetching code path is sound,
  only the *download* is blocked in that specific sandbox.
- Actually reaching `www.allbirds.com` (or any other live site) is blocked
  in that sandbox too, so the CSV in this repo has **not** been generated
  from the real live site from inside that environment.

None of this applies on a normal machine (or any environment with regular
internet access, as in the original playbook) — there, `scrapling install`
and `python allbirds_scraper.py` will work as-is with no extra flags.

## Using Scrapling for anything else

Once set up, you can ask in plain language:

> Use o Scrapling para fazer scraping de [URL] e me traga [o que você quer].
