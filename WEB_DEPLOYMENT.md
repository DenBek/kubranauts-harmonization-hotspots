# Website deployment

The fire calendar is a static site on Cloudflare Pages. The pages are HTML, CSS, and JavaScript in `web/`. API routes live in `functions/` and are served from the same address as the pages. Those routes are Pages Functions, which run as Workers. There is no separate Worker project.

The site can be clicked through on sample data before any Cloudflare setup. (Historical: the Argentina data is now published; the sample is only a fallback.) Live gold tables are plugged in later by writing JSON into R2. A page changes dataset when its own file is published. Other pages can still be on the sample.

## Stack

- Pages: HTML, CSS, and JavaScript. No React and no build.
- Charts: a small SVG kit in `web/charts.js` (bars, line with normal-range band, sparklines, tooltips, table view). No chart library.
- Themes: light and dark from the CSS tokens at the top of `web/styles.css`. The header toggle overrides the system setting. Data colors (anomaly classes, map ramp, sensors) were checked for color-blind separation and contrast in both themes; change them there, not in page code.
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

Nav, in this order. The bare address opens the map (`web/index.html`, script `web/home.js`).

| Nav | Page | What it shows |
|---|---|---|
| 1 | `web/index.html` (Map) | Split layout: a one-sentence answer on top ("2.3× the usual August, busiest in 23 years"), the map with the timeline under it, and a side column that always shows the calendar for the current selection (Argentina, a region, or a drawn area) with detail, stats, series and CSV. Each 1° cell is a circle: area = detections, colour = that month against the same place's usual month (median 2003–2022), in the calendar's colours; provisional months are hollow. The map opens fitted to Argentina, with grey tiles and everything outside Argentina faded (`web/argentina.json`, Natural Earth 1:50m). Three modes: **Explore months** (play, Harmonized / MODIS Aqua / VIIRS, cell history), **Regions** (Argentina and the five boxes, known events) and **Draw an area** (rectangle, polygon, examples, typed corners, year range). Calendar, timeline and headline move together. URL: `?mode=explore\|region\|draw&region=&rect=s,n,w,e&year=&month=&metric=&cell=` |
| 2 | `web/problem.html` | The problem: raw counts joined end to end against the harmonized series, with year, month and by-camera views |
| 3 | `web/regions.html` | Fire calendar: month-by-year calendar for Argentina and five regions, with region buttons, baseline toggle, flags and likely ranges |
| 4 | `web/index.html?mode=draw` | Draw an area, on the map. `web/draw.html` forwards there and keeps `?rect=` |
| 5 | `web/accuracy.html` | How accurate is it?: held-out test results and the reliability table |
| 6 | `web/glossary.html` | Words used |

The area sums on the map use the same logic as the former `web/draw.js` (kept in the repo), so the numbers match. `web/map.html`
forwards to the map. Hidden from the nav (files kept, reachable by address): `web/map-old.html`, `calendar.html`, `overview.html`,
`year.html` and `briefing.html`. Which page reads which table: `harmonization/argentina/gold/README.md`.

There is no region picker in the header. Fire calendar has its own region buttons (`?region=` in the URL, remembered in the browser).

A new page is a new HTML file that links `styles.css` and then loads `gold.js`, `charts.js`, and `nav.js` in that order, plus one entry in `PAGES` in `web/nav.js`. Pages listen for the `regionchange` event instead of owning a region select.

## API

`GET /api/gold/<table>` is implemented in `functions/api/gold/[table].js`.

Allowed tables:

- `gold_cell_monthly`
- `gold_region_monthly`
- `gold_region_annual`
- `gold_region_analogs`
- `gold_region_headline`
- `gold_calibration`
- `gold_reliability`
- `gold_accuracy`

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
| `gold/gold_reliability.parquet` | `publish/gold_reliability.json` |
| `gold/gold_accuracy.parquet` | `publish/gold_accuracy.json` |

In the Argentina MVP all of these except `gold_region_analogs` are published (2026-11-15). Nothing visible reads the sample files now. If a table is missing from R2, the Worker falls back to `web/sample/`, which has no `gold_reliability` or `gold_accuracy` file, so those two return an error instead.
When a file exists:

1. Write the Parquet to that key from the Codespace.
2. If a column name differs, change the list for that table at the top of `scripts/export_calendar.py`.
3. Run `python scripts/export_calendar.py` in the Codespace. It uses `R2_KEY_ID`, `R2_SECRET`, and `CF_ACCOUNT_ID` from the Codespaces secrets.
4. Reload the site. A table that was written leaves the sample. A table that was skipped stays on the sample, and its banner says so.

The cell export is limited to the stratum `argentina` (`DEMO_STRATA` in the script) so the map does not download a global grid. Clear that tuple only when the JSON is still small enough for a browser.

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

1. Click through locally with `python scripts/dev_server.py` (real published data) or `npx wrangler pages dev web`.
2. Team flow used so far: commit and push to `dev`, test the preview at `https://dev.kubranauts-hotspots.pages.dev`, then merge `dev` into `main`. See `HANDOVER.md` section 6 for the full checklist. (The first-time setup below pushes to `main`.)
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
