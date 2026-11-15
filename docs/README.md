# Documentation index

New here? Read [HANDOVER.md](../HANDOVER.md) first (one page).

**Authority.** When two documents give different numbers, trust them in this order: (1) the gold tables and
[gold/README.md](../harmonization/argentina/gold/README.md), (2) [HARMONIZATION_APPROACH.md](../harmonization/argentina/HARMONIZATION_APPROACH.md),
(3) [SCOPE_AND_GAPS.md](../harmonization/argentina/SCOPE_AND_GAPS.md), (4) older logs (`findings_log.md`, `recommendation.md`, `MVP_LOG.md`).
"Authoritative" below means the first three.

Audience: **judges** (non-technical), **team** (anyone on the project), **technical** (builds or checks the data).

## Argentina MVP (the demo app), in `harmonization/argentina/`

| File | Purpose | Audience | Read it when | Authoritative |
|---|---|---|---|---|
| [gold/README.md](../harmonization/argentina/gold/README.md) | Schema of every gold table, units, regions, which page reads which table | technical | you touch data or the app code | **yes (1)** |
| [HARMONIZATION_APPROACH.md](../harmonization/argentina/HARMONIZATION_APPROACH.md) | The method, tests and uncertainty in plain English | judges, team | you must explain or defend the method | **yes (2)** |
| [SCOPE_AND_GAPS.md](../harmonization/argentina/SCOPE_AND_GAPS.md) | Status, decisions (D-), known gaps (G-), open questions, future scope, change log | team | you plan work or change anything | **yes (3)** |
| [EXPLAIN_IT.md](../harmonization/argentina/EXPLAIN_IT.md) | One-page pitch: 60-second story, ten numbers, hard questions, do-not-say list | team (presenters) | before presenting | no |
| [APP_READING_GUIDE.md](../harmonization/argentina/APP_READING_GUIDE.md) | How to read each page, sanity ranges, likely judge questions, how to check the numbers | team | before a demo or review | no |
| [findings_log.md](../harmonization/argentina/findings_log.md) | Day-by-day investigation with every figure's source | technical | you need the evidence behind a number | no (older log) |
| [recommendation.md](../harmonization/argentina/recommendation.md) | Investigation-time recommendation; marked superseded | technical | history only | no (older log) |
| [MVP_LOG.md](../harmonization/argentina/MVP_LOG.md) | Build log of the gold tables and front-end change list (now done) | technical | history of the build | no (older log) |

## Project-wide

| File | Purpose | Audience | Read it when | Authoritative |
|---|---|---|---|---|
| [README.md](../README.md) | Repo overview: where data lives in R2, layout, scripts, setup | team | first day | no |
| [HANDOVER.md](../HANDOVER.md) | One-page handover: where things are, how to run, check, deploy, fix | team | first day, or taking over | no |
| [WEB_DEPLOYMENT.md](../WEB_DEPLOYMENT.md) | Stack, API, Cloudflare Pages setup, how data plugs in | technical | you deploy or change the Worker | no |
| [CLAUDE.md](../CLAUDE.md) | Rules for the AI assistant: data rules, git workflow | technical | you use the assistant | no |
| [harmonization_data_brief.md](harmonization_data_brief.md) | Data, schema and the draft method for the whole project | technical | you work on the raw or silver data | no |
| [desired_output.md](desired_output.md) | What the harmonized output should look like (early design) | team | background | no |
| [challenge.md](challenge.md) | The official challenge text | judges, team | scope and judging questions | no |
| [youtube_transcript.md](youtube_transcript.md) | The challenge author's video intro | team | background | no |

## Background and early work (not part of the final app)

| File | Purpose | Audience | Read it when |
|---|---|---|---|
| [../harmonization/docs/investigation_prompt.md](../harmonization/docs/investigation_prompt.md) | The brief given for the investigation | technical | history |
| [../harmonization/docs/context_and_hypothesis.md](../harmonization/docs/context_and_hypothesis.md) | Team notes and open questions before the investigation | technical | history |
| [../harmonization/docs/new_prompt.md](../harmonization/docs/new_prompt.md) | The brief for building the Argentina data product | technical | history |
| [../exploration/jack_v1/eda_summary.md](../exploration/jack_v1/eda_summary.md) | First exploratory analysis of MODIS and VIIRS counts | technical | history |
| [../exploration/jack_v1/eda_firms_v2_outputs.md](../exploration/jack_v1/eda_firms_v2_outputs.md) | Notebook outputs for the same analysis | technical | history |

Notes. The two files in `harmonization/docs/` and `exploration/` are inputs and early work; their numbers can differ from the final ones.
Document links inside the website (`DOCS_BASE` in `web/mvp.js`) point at the `dev` branch until the merge; after it, point them at `main`.
