# Website deployment

The fire calendar is a static site on Cloudflare Pages. The pages are HTML, CSS, and JavaScript in `web/`. API routes live in `functions/` and are served from the same address as the pages. Those routes are Pages Functions, which run as Workers. There is no separate Worker project.

The site can be clicked through on sample data before any Cloudflare setup. Live gold tables are plugged in later by writing JSON into R2. A page changes dataset when its own file is published. Other pages can still be on the sample.

## Stack

- Pages: HTML, CSS, and JavaScript. No React and no build.
- Map: Leaflet 1.9.4 from a pinned CDN, plus OpenStreetMap tiles. Both need a network when the map is open. The cell circles still draw if the tiles fail. Attribution is on the map.
- API: Pages Functions in `functions/`. Local preview uses `npx wrangler pages dev web`. Wrangler is not a production dependency.
- Node: only for that local command. The Codespace image already has it.
- Python, in the Codespace: `duckdb` and `boto3`, already in `requirements.txt`.
- Cloudflare: Pages, the Workers runtime for `functions/`, and the R2 bucket `firms-data`.

## Run it on your machine

From the repo root:

```
npx wrangler pages dev web
```

Open `http://localhost:8788`. Do not double-click an HTML file. A `file://` page cannot call the API.

No Cloudflare login is required. With no R2 credentials, each API route returns the matching file in `web/sample/` and the banner says the figures are illustrative.

## Pages

| Page | What it shows |
|---|---|
| `web/index.html` | Headline for the selected region |
| `web/map.html` | Clickable cells from `gold_cell_monthly` |
| `web/calendar.html` | Month-by-year anomaly calendar from `gold_region_monthly` |
| `web/year.html` | Annual bars, season, analogs, and calibration ratios |
| `web/briefing.html` | SMS preview. Twilio is not connected |
| `web/glossary.html` | Definitions of the units and comparisons |

A new page is a new HTML file that links `styles.css`, `nav.js`, and `gold.js`, plus one entry in `web/nav.js`.

## API

`GET /api/gold/<table>` is implemented in `functions/api/gold/[table].js`.

Allowed tables:

- `gold_cell_monthly`
- `gold_region_monthly`
- `gold_region_annual`
- `gold_region_analogs`
- `gold_region_headline`
- `gold_calibration`

The Worker reads `publish/<table>.json` through the R2 binding named `FIRMS`. If that object is missing, it returns `web/sample/<table>.json` and sets `source` to `sample`. Responses send `cache-control: no-store`.

`POST /api/notify` previews a text. It does not send.

## Where live data plugs in

The pages never open Parquet and never see R2 keys. `scripts/export_calendar.py` is the publisher.

| Parquet in `firms-data` | JSON the site reads |
|---|---|
| `gold/gold_cell_monthly.parquet` | `publish/gold_cell_monthly.json` |
| `gold/gold_region_monthly.parquet` | `publish/gold_region_monthly.json` |
| `gold/gold_region_annual.parquet` | `publish/gold_region_annual.json` |
| `gold/gold_region_analogs.parquet` | `publish/gold_region_analogs.json` |
| `gold/gold_region_headline.parquet` | `publish/gold_region_headline.json` |
| `gold/gold_calibration.parquet` | `publish/gold_calibration.json` |

When a file exists:

1. Write the Parquet to that key from the Codespace.
2. If a column name differs, change the list for that table at the top of `scripts/export_calendar.py`.
3. Run `python scripts/export_calendar.py` in the Codespace. It uses `R2_KEY_ID`, `R2_SECRET`, and `CF_ACCOUNT_ID` from the Codespaces secrets.
4. Reload the site. A table that was written leaves the sample. A table that was skipped stays on the sample, and its banner says so.

The cell export is limited to strata `chaco` and `cerrado` (`DEMO_STRATA` in the script) so the map does not download a global grid. Clear that tuple only when the JSON is still small enough for a browser.

`python scripts/build_sample_gold.py` rewrites the illustrative files in `web/sample/`. It does not upload anything. Regenerate rather than hand-editing one file, because the cell sums, the region months, the annual totals, and the headline are built together.

## Sample data

- Every sample response has `source: "sample"`. The figures are not FIRMS detections. The map dots are a made-up half-degree grid, not burn scars.
- The unit on screen is harmonized cell-days.
- Sample ranks use the years in the sample, so a rank can read "3 of 11". The live `n_years_ranked` value replaces that. The page prints the column. It does not assume 26 years.
- Map cells are 2024 and 2025, so both sensors are present there. Region months before April 2018 have null VIIRS, which is how the calendar seam toggle shows an empty value.
- November 2025 is provisional, and 2025 and 2000 are incomplete years.
- `web/sample-calendar.json` is a leftover from the first layout. The pages do not use it.

## How the Workers fit

One website: `https://kubranauts-hotspots.pages.dev`. Do not create a second project on `workers.dev`. If the dashboard asks for a `something.workers.dev` name the first time someone opens Workers, that is an account username. Pick one, such as `kubranauts`, and continue.

A push to `main`, after Pages is connected, publishes the HTML and the functions together. The functions run as Workers on that same host. Teammates do not run `wrangler deploy`.

The Worker reads R2 through the binding named `FIRMS`. It does not use `R2_KEY_ID` or `R2_SECRET`. `env.ASSETS` is how it reads the sample JSON shipped in `web/`. The browser calls same-origin `/api/gold/...`, so there is no CORS setup.

Each page requests only the tables it draws.

## Deploy

1. Click through locally with `npx wrangler pages dev web`.
2. Commit and push to `main`.
3. In the Cloudflare account that owns `firms-data`: Workers & Pages → Create → Pages → Connect to Git. Production branch `main`. Project name `kubranauts-hotspots`. If that name is taken, add a short suffix and tell the team the address.
4. Framework None. Build command empty. Output directory `web`. Root directory the repository root. A root of `web/` hides `functions/` and the API returns 404.
5. Settings → Bindings → R2. Variable name `FIRMS`, bucket `firms-data`, on Production and on Preview. Leave the bucket private. Do not paste the R2 keys.
6. Deploy. Later pushes to `main` publish on their own. Pull requests get a preview URL. No GitHub Actions workflow.
7. When gold Parquet exists, run the export in the Codespace and reload.
8. Twilio stays off. To send later, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, and `TWILIO_LIVE=true` on the Pages project, then fill in the marked request in `functions/api/notify.js`. Those values are Pages environment variables, not Codespaces secrets.

## Easy to get wrong

- The Pages project and the bucket have to be on the same Cloudflare account.
- The `FIRMS` binding has to be on Preview as well as Production, or a pull-request URL stays on the sample.
- A partial export is normal. Check each banner. One table can be live while another is still sample.
- If a required column is missing, the export skips that table and prints the error. It does not upload a partial file.
- Parquet dates become ISO strings in the JSON.
- A global cell file will not fit in the browser. Keep the demo slice.
- `.dev.vars` and `.wrangler/` are gitignored. Do not commit keys.
