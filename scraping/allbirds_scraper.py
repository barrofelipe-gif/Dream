#!/usr/bin/env python3
"""
Scrape the full Allbirds product catalog (with prices) and save it to a CSV file.

Usage:
    .venv/bin/python allbirds_scraper.py [-o OUTPUT.csv] [--store-url URL]

How it works
------------
Allbirds runs on Shopify. Every Shopify storefront exposes a public,
paginated JSON feed of its catalog at `/products.json`, which is the most
reliable way to get the *complete* catalog with prices (the storefront's
HTML is a JS-rendered React app, so blindly scraping the DOM would miss
lazy-loaded products and would need a real browser + scrolling).

We still fetch that JSON feed through Scrapling's `Fetcher`, which:
  - impersonates a real browser's TLS/HTTP fingerprint (via curl_cffi) so
    requests aren't trivially blocked as bot traffic,
  - gives us a `Selector`-wrapped `Response` we can inspect/parse the same
    way as HTML, and
  - handles retries/timeouts consistently with the rest of a Scrapling
    project.

Each page returns up to 250 products; we page through until an empty
"products" array is returned. For every product we flatten its variants
into one CSV row each (a shoe with multiple sizes -> multiple rows), since
price can differ per variant.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time

from scrapling.fetchers import Fetcher

DEFAULT_STORE_URL = "https://www.allbirds.com"
PAGE_SIZE = 250
CSV_FIELDS = [
    "product_id",
    "product_title",
    "product_type",
    "vendor",
    "handle",
    "product_url",
    "variant_id",
    "variant_title",
    "sku",
    "price",
    "compare_at_price",
    "available",
]


def fetch_products(store_url: str, delay: float = 1.0):
    """Yield every product dict from the store's paginated /products.json feed."""
    page = 1
    while True:
        url = f"{store_url}/products.json?limit={PAGE_SIZE}&page={page}"
        response = Fetcher.get(url, stealthy_headers=True)
        if response.status != 200:
            raise RuntimeError(f"Unexpected status {response.status} for {url}")

        data = json.loads(response.body)
        products = data.get("products", [])
        if not products:
            break

        for product in products:
            yield product

        print(f"  page {page}: {len(products)} products", file=sys.stderr)
        page += 1
        time.sleep(delay)  # be polite


def flatten_rows(products, store_url: str):
    for product in products:
        handle = product.get("handle", "")
        product_url = f"{store_url}/products/{handle}"
        base = {
            "product_id": product.get("id"),
            "product_title": product.get("title"),
            "product_type": product.get("product_type"),
            "vendor": product.get("vendor"),
            "handle": handle,
            "product_url": product_url,
        }
        variants = product.get("variants") or [{}]
        for variant in variants:
            row = dict(base)
            row.update(
                {
                    "variant_id": variant.get("id"),
                    "variant_title": variant.get("title"),
                    "sku": variant.get("sku"),
                    "price": variant.get("price"),
                    "compare_at_price": variant.get("compare_at_price"),
                    "available": variant.get("available"),
                }
            )
            yield row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o", "--output", default="allbirds_catalog.csv", help="CSV output path"
    )
    parser.add_argument(
        "--store-url",
        default=DEFAULT_STORE_URL,
        help="Shopify storefront base URL (default: %(default)s)",
    )
    args = parser.parse_args()

    print(f"Scraping catalog from {args.store_url} ...", file=sys.stderr)
    products = list(fetch_products(args.store_url))
    rows = list(flatten_rows(products, args.store_url))

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(
        f"Done: {len(products)} products / {len(rows)} variant rows -> {args.output}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
