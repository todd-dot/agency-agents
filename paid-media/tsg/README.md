# TSG — PPC Operating System

Uptick Marketing's PPC operating system (TSG playbooks).
The PPC strategist agent treats these files as its operating procedures —
not generic best practices, but how this agency actually runs paid search.

## Contents

| File | What it is |
|---|---|
| `weekly-optimization-cadence.md` | The recurring optimization cadence — core tasks (💎) and strategic checks (💡) with frequency and impact |
| `landing-page-checklist.md` | Landing page audit checklist in priority order (foundations → above the fold → form → trust → mobile → post-conversion) |
| `negative-keywords.csv` | Master negative keyword library: `category, keyword` — 40+ themes (adult, career, DIY, education, financial, etc.) |
| `negative-keyword-geo-exclusions.csv` | Geo exclusion lists: `region, place` — countries by continent for location negatives |
| `callouts.csv` | Callout asset examples: `vertical, callout` — e-commerce, software, service, accommodation, insurance, etc. |
| `audience-targeting.csv` | Google Ads audience taxonomy: `method, option` + channel applicability (display, video, gmail, search, shopping) |
| `scripts/weekly-optimization-template.js` | Google Ads Script template — pulls campaign/keyword/ad/search-term/MTD pacing data into a Sheet per client, then triggers AI analysis. Customise per client before first run |
| `scripts/mcc-search-terms-template.js` | MCC master script — portfolio-wide search query analysis with control-panel Sheet and heatmap dashboard |

## Reference datasets (live in Google Drive, not ported)

- **Countries/States/Counties/Cities expanded** (~48k rows) — full geo reference; too large for the repo, query in Drive when needed.

## How the agent uses this

1. **Weekly cadence** drives the recurring optimization loop: review data → adjust bids/budgets → mine search terms → apply negatives → test ads.
2. **Negative keyword library** is the starting exclusion set for every new build, extended with account-specific terms from search-term mining.
3. **Callouts** seed ad asset creation per vertical.
4. **Landing page checklist** runs on every new landing page before launch and on every CRO audit.
5. **Scripts** are deployed per client (one Sheet per client) and feed the AI analysis loop.
