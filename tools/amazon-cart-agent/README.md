# Amazon Cart Agent

Turns a plain-text shopping list into a ready-to-review Amazon cart. It stops at
the cart — it never checks out.

**Status: design only.** No code yet. Read [`DESIGN.md`](./DESIGN.md).

## The short version

There is **no Amazon API that can add items to a consumer cart.** PA-API 5.0 was
shut down on 2026-05-15 and its replacement, the Creators API, does catalog
search only — cart operations were dropped back in PA-API 4.0 and never returned.
So the design splits in two:

- **Catalog resolution** (list phrase → real product) — a clean API call via the
  Creators API.
- **Cart writing** — a browser operation. The Add to Cart URL for shelf-stable
  retail items; Playwright for everything else.

And because groceries live in the **Amazon Fresh / Whole Foods storefront**,
which has no API and a cart entirely separate from the retail cart, the pipeline
runs two lanes. On the example fat-loss list, 22 of 39 items are Fresh-only.

## Not part of the SMB Commerce OS build

This sits in `tools/` — outside the `apps/*` / `packages/*` pnpm workspace globs
— so it has no effect on that build's CI gates, coverage thresholds, or lockfile.
It has no Day ID card and does not touch `BUILD_CALENDAR.md` or `BUILD_STATE.md`.

## Layout

```
DESIGN.md                           architecture, risks, roadmap, open decisions
fixtures/example-list.txt           the raw input
fixtures/example-list.parsed.json   golden parse: 39 items, 17 retail / 22 fresh
```
