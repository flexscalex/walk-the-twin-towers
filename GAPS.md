# Known gaps, assumptions, and how to check this work

This page exists so that anyone can see what this reconstruction rests on, what it
does not know, and how to verify or correct it. It is maintained alongside the
public errata log. Last updated 2026-09-11.

## What the tenant list is, and is not

- **What it is:** CNN's "List of World Trade Center tenants," compiled from data
  provided by CoStar Group, Inc., as captured by the Internet Archive on
  2001-09-13. Six pages, 329 rows. Every row on this site is one row from that list.
- **What it is not:** a lease ledger. CoStar's commercial listing data can lag
  actual occupancy by months, can list a tenant's total lease rather than the
  space it actually occupied, and does not record subtenants consistently.
- **Coverage measured from the source:** 92% of rows have a numeric floor, 83%
  have square footage, 8,981,813 sq ft accounted for. Both towers have 84 of 110
  floors with at least one named tenant. The South Tower has 77 rows to the
  North Tower's 203. That asymmetry is in the source and is shown, not smoothed.
- **One unexplained row:** "CINDE" in 2 WTC, no floor, no square footage, listed
  directly under Continental Insurance Company. Kept verbatim (paradata P-015).

## Evidence levels currently in use

Every tenant row is `documented` (one contemporaneous source). **No row is
`corroborated` yet.** Nine spot checks were made against independent facts while
building the dataset (Cantor Fitzgerald 101-105, Windows on the World 106, Marsh
93-100, Aon 92/99/100, Sandler O'Neill 104, Fiduciary Trust 90/94-97, KBW
85/88/89, Fuji Bank 79-82, Morgan Stanley 43-46/56/59-74), all matched, but the
independent sources were not recorded with citations, so they do not count.
Recording them is open work.

## Ways to verify or extend the tenant data

Sources that could independently confirm or correct rows, none of which have
been consulted yet:

1. **Port Authority of NY & NJ records.** The Port Authority owned the complex
   and published tenant directories. Its archives and annual reports are the
   primary source for tenancy.
2. **The printed WTC tenant directory** (lobby directories were published and
   updated; copies survive in libraries and private collections).
3. **Contemporaneous trade press:** Real Estate Weekly, Crain's New York
   Business, the New York Times real estate section (1995-2001) reported
   leases with floor and square footage.
4. **SEC filings.** Public companies listed office addresses and lease
   commitments in 10-K filings; EDGAR is free and searchable for 1996 onward.
5. **New York City Department of Buildings** certificate of occupancy and
   alteration records by floor.
6. **CoStar itself,** if a licensed user is willing to pull the historical record.
7. **Oral history from people who worked there.** Welcome, but goes in a separate
   visibly distinct layer and never merges into the cited ledger (BUILD-PLAN
   decision 6).

## Geometry: what is cited and what is missing

All dimensions come from NIST NCSTAR 1-1 and 1-2A with page-level citations
(`data/geometry-params.json`). 145 values are cited. **15 are unresolved**, the
important ones being:

- **The WTC 2 story-height schedule.** NIST gives a full floor-by-floor
  elevation for WTC 1 (Fig. 2-2) and only the roof height (1,362 ft) for WTC 2.
  The generator must not copy WTC 1's schedule to WTC 2 without a source.
- **Window width** (the clear gap between perimeter columns), which drives the
  facade's look.
- **Tower positions on the site** and the distance between them.
- **Core column count and exact core plan.**

**Facade infill is derived, not cited.** The glass panels on the Towers page
are drawn at the clear gap between steel column faces (40 in. pitch minus the
14 in. column, both cited). The visible window was narrower, because the
aluminum column covers were wider than the steel, and no cover width is
stated. Recorded in the manifest as a derived value (paradata P-061).

## City context: only what stood in 2001 and still stands

The Towers page surrounds the site with gray massing from NYC Open Data
"Building Footprints" (dataset 5zhs-2jue), filtered to `construction_year <=
2001` and extruded to the published roof height. That file describes buildings
that exist today, so the context shows **only buildings that stood in 2001 and
still stand**. Anything demolished since 2001, including the seven World Trade
Center buildings themselves and neighbours such as 130 Liberty Street, is
absent: it is a lower bound on the 2001 street wall, labeled as such on the
Towers page and the method page. Roof heights are today's, not 2001's. The
massing carries no names or addresses. Tower positions inside the block are a
layout choice (paradata P-064 to P-067; `data/context/`).

Six places where the two NIST reports disagree (truss depth, floor 2 elevation,
sub-level naming, and others) are recorded as separate parameters rather than
resolved. Each resolution will be a paradata row.

Where to look next: NIST NCSTAR 1-1A, 1-2, 1-2A appendix drawing books, 1-7
(elevators), and the Skyscraper Museum and Yamasaki archives for original
drawings.

## How to audit this yourself

- Every tenant's citation panel links to the archived source page. Open it and
  find the row.
- Every geometry parameter carries a PDF page number and a verbatim quote. The
  PDFs are free from NIST.
- Every interpretive decision is a row in `data/paradata.json`, rendered on the
  method page, with what was rejected and why.
- Found an error? Open an issue. Corrections are logged with a date on the
  errata page.
