# SEO Indexation Baseline — Codex Pets

> Fixed measurement cohort and first slice. Rerun this cohort unchanged after every SEO-related rollout.
> Companion plan: `docs/superpowers/plans/2026-07-29-seo-indexation-priorities-ru.md` (item 1).

## 1. Observation metadata

- Technical slice: **2026-07-29T14:38:27Z** (all cohort HTTP fetches within 1.1 s).
- GSC data pulled: 2026-07-29 ~14:40 UTC via `google-search-console` MCP (property `sc-domain:pets.ydb-qdrant.tech`, permission `siteFullUser`).
- Yandex Webmaster data pulled: 2026-07-29 ~14:45 UTC via `yandex-webmaster` MCP (host `https:pets.ydb-qdrant.tech:443`, verified).
- Production release at slice time: `main@045b34c` (PR [#22](https://github.com/astandrik/codex-pets/pull/22), homepage JSON-LD cleanup, deployed 2026-07-29 earlier that day; rollback point `main@b6da0ec`). Release parity confirmed via post-deploy production HTML check the same day.
- Artifacts: `.scratch/seo-baseline/2026-07-29T14-38-27-268Z/` (`baseline.json`, `baseline.md`).

## 2. Cohort definition (frozen — 13 URLs)

Selection rules are deterministic; composition does not change when new pets/guides appear.

| # | URL | Selection rule |
|--:|---|---|
| 1 | `https://pets.ydb-qdrant.tech/` | Homepage |
| 2 | `https://pets.ydb-qdrant.tech/?page=2` | Catalog pagination, present in sitemap |
| 3 | `https://pets.ydb-qdrant.tech/about` | Static page |
| 4 | `https://pets.ydb-qdrant.tech/guides/best-codex-pets-for-ai-coding-agents` | Reference-quality guide |
| 5 | `https://pets.ydb-qdrant.tech/guides/codex-pets-vs-vscode-pets` | Weak guide (rewrite candidate) |
| 6 | `https://pets.ydb-qdrant.tech/guides/codex-pets-vs-openpets` | Weak guide (rewrite candidate) |
| 7 | `https://pets.ydb-qdrant.tech/guides/codex-pets-mcp-integration-guide` | Weak guide (rewrite candidate) |
| 8 | `https://pets.ydb-qdrant.tech/pets/crawlstack-polished` | Oldest approved pet (2026-05-09) |
| 9 | `https://pets.ydb-qdrant.tech/pets/kitsune-chibi-2` | Median approved pet (2026-05-17) |
| 10 | `https://pets.ydb-qdrant.tech/pets/wild-boar` | Second-newest approved pet (2026-07-26) |
| 11 | `https://pets.ydb-qdrant.tech/pets/kesha` | Newest approved pet (2026-07-26) |
| 12 | `https://pets.ydb-qdrant.tech/users/astandrik` | Public profile |
| 13 | `https://pets.ydb-qdrant.tech/?tags=anime` | Filtered control URL (`noindex, follow`), real tag from homepage tag links |

Pet positions were taken from the production sitemap snapshot of 2026-07-29 (`lastmod` = approval date, 146 pet entries, `.scratch/seo-verify/sitemap.xml`).

## 3. Technical slice (2026-07-29T14:38:27Z)

| URL | Status | Canonical | Meta robots | gzip bytes | TTFB ms |
|---|--:|---|---|---:|---:|
| `/` | 200 | `https://pets.ydb-qdrant.tech` | index, follow | 49 599 | 148 |
| `/?page=2` | 200 | self | index, follow | 26 872 | 96 |
| `/about` | 200 | self | index, follow | 9 928 | 33 |
| `/guides/best-codex-pets-for-ai-coding-agents` | 200 | self | index, follow | 16 069 | 230 |
| `/guides/codex-pets-vs-vscode-pets` | 200 | self | index, follow | 6 709 | 26 |
| `/guides/codex-pets-vs-openpets` | 200 | self | index, follow | 6 788 | 21 |
| `/guides/codex-pets-mcp-integration-guide` | 200 | self | index, follow | 6 683 | 22 |
| `/pets/crawlstack-polished` | 200 | self | index, follow | 17 864 | 82 |
| `/pets/kitsune-chibi-2` | 200 | self | index, follow | 17 917 | 111 |
| `/pets/wild-boar` | 200 | self | index, follow | 17 895 | 55 |
| `/pets/kesha` | 200 | self | index, follow | 17 910 | 48 |
| `/users/astandrik` | 200 | self | index, follow | 33 392 | 132 |
| `/?tags=anime` | 200 | `https://pets.ydb-qdrant.tech` (home) | **noindex, follow** | 48 795 | 57 |

No `X-Robots-Tag` header on any cohort URL. No redirects. Full per-URL timestamps in `baseline.json`.

## 4. GSC per-URL state (URL Inspection API, 2026-07-29)

| URL | Coverage verdict | lastCrawlTime (UTC) | Google canonical | Referring URLs |
|---|---|---|---|---|
| `/` | Crawled - currently not indexed | 2026-07-27 17:18 | = declared | getdrio.com/mcp?page=18; /pets/jedi-blue-lightsaber; mcpbench.ai/servers/tech.ydb-qdrant.pets/codex-pets |
| `/?page=2` | Crawled - currently not indexed | 2026-07-27 17:18 | = declared | none reported |
| `/about` | Crawled - currently not indexed | 2026-07-25 09:19 | = declared | /pets/jedi-blue-lightsaber |
| 4 guides (each) | Crawled - currently not indexed | 2026-07-25 09:21–09:23 | = declared | none reported |
| `/pets/*` (all 4) | URL is unknown to Google | unavailable | unavailable | unavailable |
| `/users/astandrik` | URL is unknown to Google | unavailable | unavailable | unavailable |
| `/?tags=anime` | URL is unknown to Google | unavailable | unavailable | unavailable |

For all crawled URLs: `robotsTxtState=ALLOWED`, `indexingState=INDEXING_ALLOWED`, `pageFetchState=SUCCESSFUL`, crawled as MOBILE, Google-selected canonical == user-declared canonical.

## 5. Sitemap report (GSC)

- `https://pets.ydb-qdrant.tech/sitemap.xml`: **165 submitted / 0 indexed**, 0 warnings, 0 errors.
- Last submitted 2026-07-27T17:16:14Z, last downloaded 2026-07-27T17:16:15Z.

## 6. Search analytics (2026-07-01 → 2026-07-29, 28 days)

- `search_analytics` with `dimensions=page` (rowLimit 50): **no data rows** — no recorded impressions/clicks.
- `search_analytics` with `dimensions=query` (rowLimit 25): **no data rows**.
- Recorded as "no data", consistent with 0 indexed pages; not treated as numeric zero of an established series.

## 7. Yandex Webmaster snapshot

- Host `https:pets.ydb-qdrant.tech:443` verified.
- External links: **17** found, from `github.com/astandrik/codex-pets`, `claudemarketplaces.com`, `mcp-katalog.ru`, `mcprepository.com`, `github.com/astandrik` (2026-05-18 → 2026-07-24).
- `get-summary`, `get-sitemaps`, `get-diagnostics`, `get-popular-queries`, `get-indexing-history`: **unavailable** — Webmaster API 403, OAuth token scopes are `[ALL_SCOPES, HOST_LIST, EXTERNAL_LINKS]`, these endpoints require scope `COMMON`. Fix: re-issue the token with the COMMON scope (`~/.config/codex-mcp/bin/store-yandex-token`), then backfill this section.

## 8. Rerun protocol

1. Technical slice: `node scripts/seo-baseline.mjs` → new `.scratch/seo-baseline/<timestamp>/` artifacts.
2. GSC sitemap: `get_sitemap(siteUrl="sc-domain:pets.ydb-qdrant.tech", feedpath="https://pets.ydb-qdrant.tech/sitemap.xml")`.
3. GSC inspection: `index_inspect(siteUrl="sc-domain:pets.ydb-qdrant.tech", inspectionUrl=<each of the 13 cohort URLs>)`.
4. GSC analytics: `search_analytics(siteUrl=..., startDate=<today-28d>, endDate=<today>, dimensions="page")` and totals.
5. Yandex Webmaster: `get-external-links` + (after token re-issue) `get-summary`, `get-sitemaps`, `get-indexing-history` for the last 28 days.

Comparison rules:

- Compare GSC fields only after Google records a **newer `lastCrawlTime`** than the previous slice for that URL.
- Do not attribute an indexation change to one work package if several shipped within the same crawl window.
- `site:` result counts are not a KPI.
- Missing evidence is recorded as `unavailable` / `no data`, never as zero.
- Requesting recrawl (Request Indexing / Validate Fix) is a separately confirmed operation, not part of this protocol.

## 9. Key observations from this slice

- Google last crawled the homepage **2026-07-27** — before the 2026-07-29 JSON-LD cleanup deploy (PR #22). Its effect is not yet observable; watch for `lastCrawlTime` newer than 2026-07-29.
- All 7 crawled indexable URLs sit at "Crawled - currently not indexed" with correct canonicals, allowed crawling and successful fetches — the bottleneck is selection, not crawlability.
- Pet detail pages and the profile are **unknown to Google** despite being in the sitemap — discovery/processing of detail URLs has not started.
- Search demand measurement (impressions/queries) starts from an empty series; first non-zero rows will be meaningful.

## 10. Rollout log

### 2026-07-29 — measurement cohort established (PR #23, `main@71cc858`)

This document: fixed 13-URL cohort + `scripts/seo-baseline.mjs` for the technical slice.

### 2026-07-29 — homepage JSON-LD cleanup (PR #22, `main@045b34c`)

Removed invisible `FAQPage` and news-oriented `SpeakableSpecification`; homepage JSON-LD is now `WebPage` + `ItemList` only. Production-verified the same day.

### 2026-07-29 — homepage semantic-search copy (PR #24 + heading fix #25, `main@8277530`)

SSR section "Find by vibe, not keywords" with the semantic-search value proposition; catalog behavior unchanged.

### 2026-07-29 — UGC profile links (PR #26, `main@a343f92`)

User-controlled external links on public profiles now `rel="nofollow ugc noreferrer"`; first-party navigation untouched.

### 2026-07-29 — branded 404, web manifest, favicon.ico (PR #27, `main@2d4a2f0`)

Branded 404 page, `/manifest.webmanifest`, generated ICO/PNG brand icons; IndexNow key moved behind a middleware rewrite.

### 2026-07-29/30 — three guide rewrites (PRs #28, #29, #30, up to `main@7610989`)

`codex-pets-mcp-integration-guide`, `codex-pets-vs-vscode-pets`, `codex-pets-vs-openpets` rewritten with first-hand methodology (reproducible queries with text excerpts), bylines, dates, decision tables, and contextual pet links; single content source for page + `.md` twin; `loadGuidePets` 500-fallback for all guides.

### 2026-07-31 — detail-page content model pilot (PR #31, `main@4b4be52`)

Plan task 5 (P1.4). No-schema path: richer owner-approved descriptions for 10 pilot pets + a server-rendered "Related pets" section (4 approved pets as gallery cards, deterministic rule: shared tags → same kind → approval date → slug) on every pet detail page and its `/pets/<slug>/markdown` twin (`Cache-Control: private`). Candidate list cached 60 s with synchronous invalidation (`revalidateTag(..., { expire: 0 })`) on approve/reject/delete.

- Pilot cohort (descriptions rewritten 2026-07-30, sitemap `lastmod` bumped): crawlstack-polished, kitsune-chibi-2, wild-boar, kesha, johnny, bolshoy-tyll, blond-flexer-2, foggy-hedgehog, rose-katana, polin.
- Control cohort (unchanged): cloud-flat-2, chibi-wolf, blue-rabbit-2, sakura, fire-skull, leon, curator, lain, maybe-baby-2-2, jinx.
- Cohort overlap: 4 of 13 baseline URLs are pilot pet pages (#8 crawlstack-polished, #9 kitsune-chibi-2, #10 wild-boar, #11 kesha); all 13 now also carry the related-pets section.
- Production verification 2026-07-31: deploy smoke 9/9 = 200; `/pets/kesha` SSR 73 KB → 114 KB with 4 related cards; markdown twin private + related block with ≤120-code-point one-liners; sitemap `lastmod 2026-07-30T21:06Z` on pilot URLs; JSON-LD, search, homepage unchanged. 0 console errors.
- Watch items for the next rerun: GSC `lastCrawlTime` newer than 2026-07-31 on pilot vs control pet URLs; coverage-verdict movement on the 4 baseline pet URLs (still "URL is unknown to Google" at baseline); sitemap submitted/indexed counts. Request Indexing for the 20 pilot+control URLs is a separately confirmed operation, pending.

