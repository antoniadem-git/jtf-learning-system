# JTF Learning System dashboard

A live dashboard for Just Transition Fund (JTF), a foundation funding coal-community economic transition. It is plain static HTML/CSS/JS (no framework, no build step) deployed on Vercel from GitHub `main`, with Vercel serverless functions in `/api` that read Airtable.

Owner: Antonia (ademedinaceli@justtransitionfund.org, GitHub `antoniadem-git`). She works in small, specific edits ("move X", "rename Y"). Make exactly the change asked, then say what changed.

## Which version to edit

| Version | File | Status |
|---|---|---|
| **Original 6-dials** | `index.html` (repo root); also git tag `original-6-dials` | Paused. **Never edit.** |
| **Version 6-dials** | `6-dials/index.html` | The working copy. **All edits go here.** |

Live URLs: `https://jtf-learning-system-zeta.vercel.app/` (Original) and `https://jtf-learning-system-zeta.vercel.app/6-dials/` (working). A custom domain such as learning.justtransitionfund.org may be set up later.

Version 6-dials has six tiles: **Grantee Signal, Economic Output, Readiness, Reach, Annual Review, Field Signal**. Cards carry a "2026" label in the upper-right corner. Grantee Signal, Economic Output and Field Signal have "More Details" drill-downs.

## Deploy and workflow

- Push to `main` and Vercel deploys automatically. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Other Claude sessions commit to this repo at the same time. Run `git fetch` and check `git status` / `git log origin/main` before pushing. Never force-push.
- There is no Node or bun on Antonia's machine. Preview locally with `python3 -m http.server` for the HTML, and a small mock API for `/api/*` (the real functions only run on Vercel). Don't rely on browser viewport emulation for mobile checks; inspect the DOM or inject CSS.
- Design doc: "JTF Learning System: Design and Contents" is a Google Doc on the JTF Shared Drive (doc id `1UgXfWi20iM4gEH0w4SYx7np3P0-fWdM1VchvsWVF5Tw`). It is the main copy. When asked to update it, read it first (others edit it), change the Google Doc, and leave the older Claude Artifact alone. When the data rules below change, update the cohort list in its Grantee Signal section too.

## Security rules

- **Never put tokens in chat, code or commits.** `AIRTABLE_TOKEN` lives only in Vercel environment variables (Production, and Preview if needed). Don't ask Antonia to paste tokens into chat.
- The repo may be public. Do not create endpoints that expose raw grantee, contact or grant records. Endpoints return aggregates and organization names only; check-in trend text is themes only, no grantee names.
- Don't add debug endpoints that dump records. If you must inspect fields, return field names only, then delete the endpoint.
- Airtable MCP tools may be available for read-only schema and count checks. Use them sparingly and don't print personal data.

## Architecture

- `6-dials/index.html`: all markup, styles and scripts for the working version. Light/dark themes through CSS custom properties.
- Page pattern: cards with `.card-heading` / `.card-title-text` / `.card-heading-badge`. Elements with `data-metric="..."` get their value and progress bar from `/api/dashboard`. Drill-down overlays open via `setupDrilldown(triggerId, overlayId, closeBtnId)` (stack-aware; Escape closes the topmost). Every fetch has a fallback to sample values so the page still renders if the API fails.
- Pages call: `/api/grantee-signal`, `/api/economic-output`, `/api/brightspot`, `/api/dashboard?reach=county`.
- `api/_cohort.js`: shared cohort rules. The leading underscore keeps it from becoming an endpoint.
- Functions are Node ESM using global `fetch`, return HTTP 200 with `{error: ...}` on failure, and set `Cache-Control: s-maxage=60, stale-while-revalidate=300`.

## Airtable

| Base | ID | Used for |
|---|---|---|
| Contacts & Grants | `appJZpvBPzPyZL9DS` | Grants & Services, Proposals, Grantee Check-in, Organizations, Grant Impact Data, Grant Reports |
| Dashboard Metrics | `appW88cboHe8nuhwK` | Table "Dashboard Metrics": Metric, Category, Period, Current, Target, Prefix, Suffix, Status, Order, Text Summary |
| JTF County Data | `appaRgCRhALmxR9by` | "County Master List" and "Reach Summary" (Reach tile) |
| Local Economy Lab (LEL) | `appgeINSbkSpmdB0F` | LEL Step 1 / Step 2 Application, LEL Impact (Brightspot, pipeline) |

Field quirks that have bitten us:
- **Grant Year is numeric.** Compare with `Number(...)`, never `=== '2026'`.
- Link and lookup fields come back as **arrays**; lookups of link fields give **record IDs, not names**. Resolve organization names through the Organizations table, field "Org Name".
- Blank fields are omitted from the response entirely.
- Special Dashboard Metrics rows: "Top Three Needs" and "Check-In Trends" hold newline-separated phrases in "Text Summary" (not current/target numbers).
- The two Airtable bases use different record IDs. Match a proposal across bases by its **name** (Proposals "ID", e.g. "Wind River-CED-07/08/2025").

## The grant cohort ("this year's grants")

Defined once in `api/_cohort.js`; it mirrors Antonia's Airtable view **"2026 Grants (LEARNING SYSTEM)"** in Contacts & Grants > Grants & Services, which she treats as the source of truth. If her view changes, change `_cohort.js` to match.

- Grant Year = current calendar year (computed dynamically, rolls over each January)
- Strategy (from Proposal) is **not** State Policy, Federal Policy or Convening
- Status is **not** On Hold (Matching Funds), On Hold (Future Multi-Year) or Never Paid Out
- Service Type is **not** TA (equivalent to a $0 grant; tell Antonia if a TA grant ever has money, or a non-TA grant is $0)

Earlier versions filtered on Cycle and missed the TA rule, which is why numbers once read 19–20 instead of 17. Used by `grantee-signal`, `economic-output` and `brightspot`.

## How each number is calculated

- **Grantee Signal (On Track %)**: denominator = cohort grants. Numerator = cohort grants whose most recent *Completed* check-in (Grantee Check-in: Status = "Completed", latest "Actual Check-In Date") has Project Status = "On-track". Check-ins link to grants through the "Grant" field. At Risk or Delayed = cohort grants with a check-in that is not On-track; No Data = cohort grants with no completed check-in.
- **Reports Due**: Grant Reports linked to cohort grants (via "Grant Id") with no "Report Received Date", counted per "Report Due Date", sorted by date.
- **Proposed Impact**: sums of the proposed values on Grant Impact Data (Proposed/Actual = "Proposed") for cohort grants, linked by "Grant & Service ID".
- **Economic Output, Growth generated**: sum of "Economic Output" on Grant Impact Data linked to cohort grants, skipping records whose "Proposed Inclusion" = "Exclude". Split by Strategy: Workforce = "Workforce", Entrepreneurship = "CED", Infrastructure = "Infrastructure", anything else goes under "other" so pieces sum to the total.
- **ROI (estimated)**: growth ÷ the sum of cohort "Grant Amount" awards, per strategy and overall (overall uses the summed totals). Open question Antonia was offered: use all cohort grants' awards (current) vs. only grants that have output recorded.
- **Brightspot candidates**: cohort grant → Grants & Services "Grant Proposals" → Proposals "ID" name → LEL Step 2 Application "ID" → "LEL Program (from Step 1)" contains "Bright Spot". A grant counts once. Live result at last check: 0 (with 8 grants matched in LEL). "Projects in pipeline" uses any non-empty LEL Program ("Bright Spot" or "Get Ready").
- **Reach**: from JTF County Data, Core counties only (2023 Prioritization = "Core"). Total communities reached uses the Reach Summary table (stored as a fraction, 0.70 = 70%). New reached via LEL / TE = First Reach Year 2026 and First Reach Cycle matching (LEL: FAC, Local Economy Lab, Policy; TE: Transition Exchange). Opt-in via `?reach=county`; falls back to Dashboard Metrics values if the fetch fails.
- **Field Signal "Top Needs"** and check-in trends: Dashboard Metrics text rows, edited by staff in Airtable.
- Goals/targets (e.g. a metric's Target) come from Dashboard Metrics rows, not from code.

## Things to remember when editing

- Keep changes inside `6-dials/` (and `api/` for data logic). Don't touch root `index.html`.
- Percentages in legends use largest-remainder rounding so they sum to 100%.
- The "ROI (estimated)" title and "More Details" link wording were set deliberately; keep user-chosen labels unless asked.
- After changing cohort or calculation rules, check the live endpoint numbers against Antonia's Airtable view, and tell her when the dashboard and the view disagree.
