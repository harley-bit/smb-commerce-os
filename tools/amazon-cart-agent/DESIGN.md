# Amazon Cart Agent — Design

**Status:** Plan / not yet implemented
**Owner:** Harley
**Date:** 2026-09-12

Takes a plain-text shopping list, resolves each line to a real Amazon product, and
leaves the items **in the cart** for a human to review and check out. It never
completes a purchase.

> **Scope note.** This is not part of the SMB Commerce OS build. It lives in
> `tools/` — outside the `apps/*` / `packages/*` pnpm workspace globs — so it
> cannot affect that build's CI gates, coverage thresholds, or lockfile. It does
> not consume a Day ID card and does not touch `BUILD_CALENDAR.md` /
> `BUILD_STATE.md`. See open decision **A3** on whether it should graduate to its
> own repository.

---

## 1. Integration landscape (researched 2026-09-12)

This is the part that determines the whole architecture, so it is stated before
anything else.

| Path                            | Can search the catalog?                                    | Can write to a cart?                   | Status                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-API 5.0                      | —                                                          | No (cart ops dropped after PA-API 4.0) | **Dead.** Deprecated 2026-05-15; calls now return `403 AccessDeniedException`                                                                                   |
| Creators API                    | **Yes** — search, ASIN lookup, price, images, availability | **No cart operations**                 | Live. REST, Associates-gated. The official PA-API successor                                                                                                     |
| Add to Cart form / URL          | —                                                          | **Yes, indirectly**                    | `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=…&Quantity.1=…&AssociateTag=…` — a _browser handoff_, not an API call                                       |
| Selling Partner API             | Seller catalog only                                        | No                                     | Wrong side of the marketplace — sellers, not shoppers                                                                                                           |
| Amazon Fresh / Whole Foods      | **No public API**                                          | **No public API**                      | AWS's stated position is that no Fresh/WFM API exists. The 2017 Allrecipes "add ingredients to Fresh cart" integration was a private partnership, not a product |
| Amazon Business PunchOut (cXML) | Yes                                                        | **Yes — genuinely builds a cart**      | Real and sanctioned, but B2B procurement-system integration. Overkill and a poor fit for a personal grocery list                                                |

**Conclusions that drive the design:**

1. **There is no API that adds items to a consumer Amazon cart.** Not PA-API, not
   Creators API. Cart writing is a browser operation, full stop. So the answer to
   "if no integration is available" is: none is, for the cart half.
2. **Catalog resolution and cart writing are separate problems with separate
   solutions.** Resolution can be a clean API call (Creators API). Writing is
   browser work. Do not conflate them.
3. **Amazon Fresh / Whole Foods Market carts are entirely separate from the
   retail cart**, with separate checkout and separate delivery windows. An item
   in the Fresh cart is not in the retail cart and cannot be moved there.
4. **The Add to Cart URL only reaches the retail cart.** It is useless for
   groceries.

### 1.1 The constraint that matters most for _this_ list

The example list is a one-week fat-loss meal plan. Grading its 39 line items
against what amazon.com's _retail_ storefront actually sells:

| Lane                                         | Items  | Examples                                                                                                                    |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Retail** (shelf-stable, shippable)         | **17** | tuna cans, oats, rice, penne, beans, almonds, peanut butter, olive oil, Dijon, vinegar, broth, all 5 spices, protein powder |
| **Fresh / WFM** (perishable, frozen, bakery) | **22** | all chicken/salmon/beef/shrimp, eggs, yogurt, every vegetable, every fruit, bread, frozen veg                               |

**56% of the list cannot be bought on retail amazon.com at any price.** Meat and
produce only exist in the Fresh/WFM storefront, which has no API. Any design that
assumes "get an API key, add to cart, done" fails on the majority of the actual
list. This is why the system is built as **two lanes** rather than one pipeline.

---

## 2. Architecture

```
                      ┌─────────────┐
  raw text  ─────────▶│  1. Ingest  │
 (paste/file/email)   └──────┬──────┘
                             ▼
                      ┌─────────────┐   section-aware; drops PREPARATION,
                      │  2. Parse   │   plate rules, greetings, signature
                      └──────┬──────┘
                             ▼  LineItem[]
                      ┌─────────────┐   perishable? frozen? bakery?
                      │  3. Lane    │   → retail | fresh | either
                      └──────┬──────┘
                  ┌──────────┴──────────┐
                  ▼                     ▼
          ┌───────────────┐     ┌───────────────┐
          │ 4a. Resolve   │     │ 4b. Resolve   │
          │    retail     │     │    fresh      │
          │ Creators API  │     │  Playwright   │
          │ (or Playwright│     │  (only option)│
          │  fallback)    │     │               │
          └───────┬───────┘     └───────┬───────┘
                  └──────────┬──────────┘
                             ▼  Candidate[] + confidence
                      ┌─────────────┐   3 lb ÷ 1.5 lb pack = 2
                      │ 5. Qty solve│   round-up, overshoot cap
                      └──────┬──────┘
                             ▼
                      ┌─────────────┐   low-confidence / ambiguous
                      │ 6. Review   │◀──── human decides, decision is
                      └──────┬──────┘      remembered (§5)
                             ▼
                  ┌──────────┴──────────┐
                  ▼                     ▼
          ┌───────────────┐     ┌───────────────┐
          │ 7a. Write     │     │ 7b. Write     │
          │ retail cart   │     │ fresh cart    │
          │ ATC URL first,│     │  Playwright   │
          │ Playwright    │     │               │
          │ fallback      │     │               │
          └───────┬───────┘     └───────┬───────┘
                  └──────────┬──────────┘
                             ▼
                      ┌─────────────┐  what landed, what didn't,
                      │  8. Report  │  substitutions, est. total,
                      └─────────────┘  2 cart links — STOP HERE
```

### Stage detail

**1. Ingest.** Accepts a file path, stdin, or pasted text. Stores the raw text
verbatim with the run — every later stage must be traceable back to a source line.

**2. Parse.** Turns free text into structured line items. Must handle, from the
example list alone:

- weights: `3 lb`
- weight _ranges_: `¾–1 lb` (note the unicode fraction and en-dash) → `{min: 0.75, max: 1, unit: lb}`
- counts: `18`, `4`, `3 cans`, `2 heads`, `3`
- vague containers: `1 large container`, `1 small bag`, `1 jar`, `1 box`, `1 loaf`
- servings: `5 servings` → must convert to a package count
- **no quantity at all**: the entire FLAVOR section → default to 1
- alternatives: `Chicken breast or skinless thighs`, `Lean beef or steak`, `Berries — 1 container or frozen bag`
- flags: `(optional)` on the yogurt
- notes that are not quantities: `1 loaf (freeze half)`, `1 backup bag`
- **non-items**: the `PREPARATION` numbered steps, the `Plate rule` paragraph, the
  `Harley,` greeting, the `—ChatGPT` signature. A parser that turns "Boil 8 eggs"
  into a second egg purchase is broken.

Implementation: deterministic regex/grammar pass for the `• Name — Qty Unit`
shape, with an LLM pass for the residue and for section classification. The LLM
output is validated against a zod schema and is never trusted to invent
quantities — if it cannot map a line, the line goes to review, not to a guess.

**3. Lane assignment.** A category table (`meat`, `seafood`, `produce`, `dairy`,
`eggs`, `bakery`, `frozen` → `fresh`; `canned`, `dry_goods`, `oil`, `spice`,
`condiment`, `supplement` → `retail`) plus an `either` state for genuinely
ambiguous items (berries fresh vs. frozen). `either` resolves to whichever lane
produces a confident match, preferring retail (cheaper, no delivery window).

**4. Resolve.** Item phrase → ranked candidate products.

- _Retail:_ Creators API search. Falls back to Playwright search on amazon.com if
  there are no Associates credentials (open decision **A2**).
- _Fresh:_ Playwright against the Fresh/WFM storefront. No alternative exists.
- _Ranking signals:_ token overlap with the requested name, unit price
  ($/lb, $/oz) to avoid the 4× "gourmet" trap, pack-size fit against the
  requested quantity, rating floor (≥4.0, ≥50 reviews), and — most heavily —
  whether this exact phrase was resolved before (§5).
- Emits a **confidence** score. Below threshold → review queue, never a silent pick.

**5. Quantity solve.** Requested amount vs. available pack size.
`3 lb chicken` against a 1.5 lb package = 2 packages. Rules: round **up** (under-buying
breaks the meal plan), cap overshoot at +50% (never buy a 10 lb bulk pack to
satisfy 3 lb), and for ranges buy to the **minimum** (`¾–1 lb salmon` → satisfy 0.75 lb).
Weight-variable grocery items (meat sold by the piece) get their estimated weight
recorded so the report can flag "≈3.2 lb ordered vs 3 lb requested".

**6. Review.** Anything low-confidence, every `(optional)` item, and every
substitution is presented before writing. Default mode is **dry-run**: resolve
and report, write nothing. Cart writing requires an explicit `--commit`.

**7. Write.**

- _Retail:_ try the Add to Cart URL first — it is the one Amazon-sanctioned
  mechanism, needs no DOM scraping, and survives UI redesigns. Batch
  `ASIN.1..ASIN.N`; chunk conservatively (10 per request) as the real cap is
  undocumented and must be verified empirically. Falls back to Playwright clicks
  if a batch silently drops items.
- _Fresh:_ Playwright only. Search within the storefront, match the resolved
  product, set quantity, add.
- Both lanes verify by reading the cart back afterwards. "Clicked add" is not
  evidence the item is in the cart.

**8. Report.** Markdown + JSON: what landed in which cart, what failed and why,
every substitution made, estimated total per cart, and direct links to both
carts. **The run ends here.** See §4.

---

## 3. Stack

TypeScript / Node 20+, matching the house stack (ADR-001) so there is one
toolchain to maintain.

| Concern     | Choice                                           | Why                                                                                                                                        |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Language    | TypeScript, strict                               | House standard                                                                                                                             |
| Browser     | **Playwright**, Chromium, **persistent context** | Persistent profile means log in once by hand, reuse forever. Re-logging in every run is the single fastest way to trigger anti-bot systems |
| Schema      | zod                                              | Validates LLM parse output at the boundary                                                                                                 |
| Storage     | SQLite (`better-sqlite3`)                        | Local, file-based, zero setup                                                                                                              |
| Catalog API | Creators API (REST + SigV4-style signing)        | Only live official catalog API                                                                                                             |
| CLI         | `commander`                                      | Small                                                                                                                                      |
| Tests       | Vitest                                           | House standard                                                                                                                             |

---

## 4. Safety boundaries — non-negotiable

These are hard rules, not preferences. They are what make automating one's own
account defensible.

1. **Stop at the cart. Always.** The agent never opens checkout, never selects a
   delivery window, never touches a payment method or address, never clicks
   "Place your order". The cart is the deliverable.
2. **Never store Amazon credentials.** No password in config, env, or SQLite. A
   one-time interactive human login populates a persistent Chromium profile; the
   agent reuses that profile. Profile directory is gitignored and `chmod 700`.
3. **Never solve, bypass, or evade a CAPTCHA.** If one appears, the run pauses and
   hands the visible browser to the human. Detection-evasion tooling is explicitly
   out of scope.
4. **Run headed, throttled, on the user's own machine and IP.** No proxy rotation,
   no fingerprint spoofing, no parallel sessions, human-rate delays between
   actions.
5. **Dry-run is the default.** Writing to a cart requires `--commit`.
6. **Full audit trail.** Every run logs every resolution and every cart write to
   SQLite, so any surprise item in the cart can be traced to the list line that
   caused it.

**ToS risk — stated plainly:** Amazon's Conditions of Use prohibit automated
access to the site. Browser automation of one's own account for personal
shopping is a low-severity, non-zero risk whose realistic worst case is a
CAPTCHA wall or account friction. The mitigations above (headed, throttled, own
IP, one session, no evasion, never past the cart) keep the behaviour
indistinguishable from an ordinary human session in rate and shape. The Add to
Cart URL path for the retail lane is preferred _specifically because_ it avoids
automation entirely for that lane. This is a real risk to accept knowingly, not
one to design around with evasion.

---

## 5. The part that makes it worth building: sticky resolutions

A single run is a novelty. The value is in week 2.

SQLite keeps a `resolutions` table: `list_phrase → chosen ASIN/product`, with the
human's review decisions. So "Chicken breast or skinless thighs" resolves to _the
same product you approved last week_, instantly and with no review prompt. Over a
few weeks the review queue shrinks toward zero and a weekly run becomes
"paste list → confirm → two carts ready".

Tables: `runs`, `line_items`, `candidates`, `resolutions` (the sticky memory),
`cart_writes`.

Corollary: a substitution is never silently sticky. If last week's product is
out of stock, that is a review prompt, not an automatic swap.

---

## 6. Build roadmap

| Phase  | Deliverable                                                                                                                           | Est.     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **P0** | Repo skeleton, TS config, SQLite schema, CLI shell, the example list committed as a golden fixture                                    | 2h       |
| **P1** | Parser → `LineItem[]`, tested against the full 39-item example list including the traps (ranges, `(optional)`, PREPARATION exclusion) | 4h       |
| **P2** | Lane assignment + category table                                                                                                      | 1.5h     |
| **P3** | Retail resolution via Creators API + ranking + confidence                                                                             | 5h       |
| **P4** | Quantity solver (pack-size fit, round-up, overshoot cap, ranges)                                                                      | 3h       |
| **P5** | Retail cart write via Add to Cart URL + read-back verification                                                                        | 3h       |
| **P6** | Playwright harness: persistent profile, one-time login, CAPTCHA-pause, throttling                                                     | 4h       |
| **P7** | Fresh/WFM resolution + cart write via Playwright                                                                                      | 6h       |
| **P8** | Review queue + sticky resolutions                                                                                                     | 4h       |
| **P9** | Report (markdown + JSON), end-to-end run on the real list                                                                             | 3h       |
|        | **Total**                                                                                                                             | **~35h** |

P0–P5 is a genuinely useful tool on its own (the 17 shelf-stable items, fully
automated, no browser automation at all). P6–P7 is where the majority of the list
becomes reachable and where all the fragility lives. **Build and validate P0–P5
before committing to P6+.**

---

## 7. Risks

| Risk                                                            | Severity                        | Mitigation                                                                                                               |
| --------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| No Fresh/WFM delivery in the area                               | **Blocking for 22 of 39 items** | Verify before building P7 (open decision **A1**). If unavailable, the fresh lane emits a printable in-store list instead |
| Creators API eligibility (Associates account, qualifying sales) | Medium                          | Playwright search fallback for the retail lane; costs speed, not capability (**A2**)                                     |
| Add to Cart URL breaks or silently caps batch size              | Medium                          | Read the cart back after every write; Playwright fallback already specified                                              |
| Fresh storefront DOM changes break selectors                    | High, recurring                 | Role/text-based locators over CSS paths; a selector smoke test that fails loudly and early rather than mid-run           |
| Anti-bot friction                                               | Medium                          | §4 mitigations; never evade, pause for the human                                                                         |
| Wrong product silently added                                    | Medium                          | Confidence threshold + review queue + report every substitution + dry-run default                                        |
| Grocery prices/stock shift between resolve and write            | Low                             | Resolve and write in the same run; report the delta                                                                      |

---

## 8. Open decisions

| #      | Decision                                                                  | Why it blocks                                                                                                                     | Default if unanswered                                                                     |
| ------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **A1** | Is Amazon Fresh / Whole Foods delivery available at the delivery address? | Determines whether 56% of the list is orderable from Amazon at all, and whether P7 (6h, the most fragile phase) is worth building | Assume yes; verify before starting P7                                                     |
| **A2** | Is there an Amazon Associates account for Creators API credentials?       | Decides whether retail resolution is a clean API call or more browser automation                                                  | Assume no; build the Playwright fallback first, wire the API in behind the same interface |
| **A3** | Does this stay in `tools/` here, or move to its own repository?           | It shares nothing with SMB Commerce OS but currently shares its git history                                                       | Stays in `tools/`, outside the workspace globs                                            |
| **A4** | CLI only, or a small local web review UI?                                 | Affects P8 scope                                                                                                                  | CLI + markdown report                                                                     |

---

## 9. Appendix — the example list, parsed

The worked output for the example one-week list is committed as a golden fixture
at `fixtures/example-list.parsed.json`: 39 line items, 17 retail / 22 fresh,
including the range quantities, the optional flag, the alternatives, and the
correctly-excluded PREPARATION section. P1 is done when the parser reproduces
that file from the raw text.

## Sources

- [Product Advertising API 5.0 — Add to Cart form](https://webservices.amazon.com/paapi5/documentation/add-to-cart-form.html)
- [Amazon Associates Central — Creators API documentation](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction)
- [Amazon Shopping API in 2026: PA-API deprecation and Creators API](https://vorplabs.com/agent-tools/amazon-shopping-cli)
- [Is there an API for Amazon Fresh or Whole Foods — AWS re:Post](https://repost.aws/questions/QUAWoPILDhS_6j458Ih6zAzQ/is-there-an-api-for-amazon-fresh-or-whole-foods)
- [Checkout Using the Amazon Fresh and Whole Foods Market Cart — Amazon Customer Service](https://www.amazon.com/gp/help/customer/display.html?nodeId=GQDB7EYYPKGLNG34)
- [Allrecipes adds AmazonFresh integration — GeekWire](https://www.geekwire.com/2017/allrecipes-adds-amazonfresh-integration-let-cooks-get-ingredients-delivered/)
- [Using Playwright's storageState — BrowserStack](https://www.browserstack.com/guide/playwright-storage-state)
