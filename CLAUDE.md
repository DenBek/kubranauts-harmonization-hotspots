# CLAUDE.md

Kubranauts, NASA Space Apps 2026: harmonize MODIS and VIIRS fire hotspots into one consistent record and build a burning-activity calendar web app.

## Read first (loaded every session)

@README.md
@docs/harmonization_data_brief.md

The brief covers the data, schema, findings, draft method and the gold-table contract. Read these before proposing any method or pipeline change.

Read on demand only (not auto-loaded):
- `docs/challenge.md`: official challenge text, for judging and scope questions.
- `docs/youtube_transcript.md`: the challenge author's video intro.

## Environment
- Runs in GitHub Codespaces. Packages come from `requirements.txt` (DuckDB is pinned to 2.0.0, which has query quirks listed in the brief, section 5).
- Credentials are environment variables (`R2_KEY_ID`, `R2_SECRET`, `CF_ACCOUNT_ID`, `FIRMS_MAP_KEY`). Never hard-code or commit keys; the repo is public.
- Run scripts from the repo root, e.g. `python -u pipeline/bronze/ingest_firms_api.py test`.

## Data rules
- Aggregate in DuckDB; never load raw detections into pandas.
- Filter on `source` and `year` so only the needed folders are read.
- Standard fire-count filter: `is_vegetation_fire AND confidence_class <> 'low'`.
- Never sum counts across satellites (the brief explains why).
- Never modify `raw/` or `raw_api/` (bronze is immutable).

## Git workflow
- Branch from `dev`, not `main`: `git checkout dev && git pull origin dev`.
- Branch name `name/what`; open the PR into `dev`.
- Commit format: `feat|fix|refactor|test|docs(scope): short description`.

## Maintaining this file
Keep only knowledge useful to almost every session. Don't repeat what the code or docs already show; point to them. Prefer rewriting or pruning over appending. Keep entries concise.
