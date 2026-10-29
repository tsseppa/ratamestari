# Ratamestari: Orienteering Course Setter

A web app that takes an orienteering map (OCAD `.ocd`) and generates a requested course automatically, following IOF/SSL rules and course-setting guidelines. Users choose the class and distance and get a course drawn on the print page, with IOF control descriptions, ready to export. An optional AI assistant lets them ask in plain language ("SM-level long distance for H21"); the course itself is always set by the engine (D2).

Built as an MVP for a hackathon weekend: a few hours of hacking on Friday and Saturday, demo on Sunday. Favour working end-to-end over completeness.

Full decision log with reasoning and rejected alternatives: [`docs/decisions.md`](docs/decisions.md). Read it before changing architecture, licensing, or anything touching privacy.

## Hard rules (do not break these)

1. **The map never leaves the user's computer** (D3). OCAD parsing and the course engine run in the browser (engine in a Web Worker). The LLM receives only text and numbers: the request, course/leg statistics, rule-check results, control descriptions as words. Never send the map file, coordinates or geometry to the LLM or any server.
2. **Algorithms set the course; the LLM handles language** (D2). All geometry, distances, routing and rule checks are deterministic code. The LLM is an agent that turns the request into a spec, calls engine tools, reads results and explains. It never measures or places controls itself.
3. **The LLM never invents rule numbers.** Control spacing, winning times per class, difficulty levels etc. live in a config file sourced from IOF and SSL documents, or in case of training user can set their own ruleset.
4. **License is AGPL-3.0-or-later** (D1), because we use ocad2geojson. Only add AGPL-compatible dependencies (MIT, BSD, Apache-2.0 are fine). Keep a visible "Source code" link in the running app.

## Architecture

- **Static web app on GitHub Pages**, no backend (D4). Visits and main actions are counted with Umami Cloud on the published site only; events never carry map data (D23). Landing page at `/`, workspace at `/app/`, animated how-to guides at `/guides/`, as a Vite multi-page app (D14).
- **Stack** (D11): strict TypeScript, pnpm workspace, React + Vite, TanStack Store + Form, Zod, OpenLayers, Comlink, Vitest. Internal packages export TS source directly (no per-package build).
  - `packages/core` (types, branded units/coordinates), `packages/rules` (ISOM symbol table, runnability classes, course rule values; every value cites its source and flags `interpretation`; mirrors `docs/rules`), `packages/map-import-ocad` (only importer of ocad2geojson), `packages/map-import-pdf` and later `packages/map-import-image` (PDF and image maps, D22), `packages/course-detect` (the printed course on a PDF or image map), `packages/engine` (no DOM), `packages/iof` (descriptions, IOF XML), `packages/agent` (LlmProvider, tools), `apps/web`.
  - Engine works in ground metres only; coordinate systems are branded types — don't mix them. Zod schemas are the source of truth for spec, rules config and LLM tool inputs.
  - Coordinates: engine and view use the map's **local frame** (ground metres, map north up = OCAD paper × scale). Convert to the projected CRS (dev map: EPSG:3067) only via `core` (`localToProjected`); don't use ocad2geojson's `toMapCoord` (buggy).
  - Map display: OCAD rendered in-browser to SVG, rasterised once to PNG, shown in OpenLayers as a static image. No online base map tiles.
  - ocad2geojson is CommonJS without types: import its submodules (`ocad2geojson/src/...`) only from `packages/map-import-ocad`, typed in `ocad2geojson.d.ts`.
  - Commands: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm format`, and `pnpm check` (all checks; run before every commit). Dev tools: `pnpm render-course` (render a generated course to PNG), `pnpm crop-ocad` (cut a small OCAD file, as for the sample map) and `pnpm benchmark-courses` (generated against reference courses on the club maps; searches run in parallel, `--seeds 1 --only <map>` for a quick look, `--jobs 1` to compare search times), `pnpm score-pdf` (score PDF map import per ISOM code against the OCAD file the PDF was printed from, aligned by the printed course and its IOF XML; `--confuse 202,415` shows what each code was mixed up with), `pnpm record-demo-run` (re-record the landing page's hero run on the sample map into `apps/web/src/landing/`, the guides' demos into `apps/web/src/guides/`, and the link preview `apps/web/public/social-preview.png`; run it after engine or sample map changes), `pnpm record-reel` (a vertical promo video of real engine runs: PNG frames and, with ffmpeg installed, an MP4 in `maps/renders/reel/`; `--map` for another map, `--every 5` for a quick look, `--font` for the app font as TTF). Club maps go in git-ignored `maps/`; map-dependent tests skip without them. The only committed map is the sample in `apps/web/public/sample/` (© its map owner, not AGPL; see its README; D14).

## Conventions

- **Ask before introducing a new convention** (pattern, tool, naming scheme, folder layout).
- **Small, tested commits.** Each commit passes `pnpm check`.
- **Commit messages:** Conventional Commits, scope = package name (`feat(map-import-ocad): …`, `docs: …`, `chore: …`). The body says **why**, not only what. Releases and the changelog are generated from them (D16): user-visible changes are `feat` or `fix`, breaking ones get `!`.
- **No unnecessary comments.** Use descriptive names instead. Comment only a non-obvious _why_ that a name can't carry.
- **No file extensions in imports** (`./geometry`, not `./geometry.ts`).
- **UI text** (D14): no user-facing string inline. Messages live in typed catalogues in `apps/web/src/i18n/` (`en.ts` is the source; other languages must satisfy its type), read with `useMessages()`. Numbers, units and plurals go through `Intl`. Engine and rules output stays language-free.
- **Design tokens** (D14): colours, type and spacing are CSS custom properties in one file in `apps/web`; see `docs/site-ux-plan.md` › Visual language. Don't hard-code colours or font sizes in components.
- **Experimental features** (D24): unfinished features check `useExperimentalFeatures()` (`apps/web/src/experimental.ts`): on in `pnpm dev`, hidden in the published app until switched on (seven clicks on the version in Settings). Load their large code with dynamic `import()`.
- **Tests** live in each package's `test/` folder (`packages/core/test/map.test.ts`), not next to the source.
- **Anonymous test data:** no test or doc names a real map, place, club or event, not even ones read from a file; only the sample map's required copyright credit does. Club maps and their files in `maps/` are named `map-a.ocd`, `map-a.Courses.xml`, `map-b-forked.pdf`, …
- **Formatting:** Prettier, no semicolons, single quotes, 100 columns (`.prettierrc.json`).
- **Rule digests** (`docs/rules/*.md`): written in English from the PDFs in `docs/sources` (git-ignored; see its README), never from memory. Every statement cites document + section (`ISOM 2017-2 sym. 406`, `Lajisäännöt 2026 §11.25`). Our own readings are marked **Interpretation:**. Read the relevant digest before working on rules, the cost map or control sites.
- **Course engine**: a browser-independent TypeScript package (so it can later run in Node), behind three interfaces:
  - `MapSource` — OCAD; vector PDF next, then scans and phone photos (D22); OMAP/XMAP later
  - `LlmProvider` — user's own Claude API key stored in the browser (MVP); later a server proxy or local model
  - `Storage` — browser now, database later
- **Map input** (D1): [ocad2geojson](https://github.com/perliedman/ocad2geojson) by Per Liedman, wrapped in **one adapter module** that outputs our internal map format: features with a category (forbidden, impassable, water, path, control feature…), plus scale and georeference. Course logic must not depend on ocad2geojson directly. Features carry OCAD symbol numbers, which map to ISOM/ISSprOM categories.
  - Bundling: provide the `buffer` package and alias `fs` to an empty module (Vite or webpack 5). Pass a `Buffer`, not a file path.
- **Engine pipeline**: candidate control sites from ISOM symbols → runnability cost map + A* routing → technical areas → skeleton (which areas, connecting legs, a time budget per section) → section fill (beam search) → improvement and rule checks → fit to paper (D19).
- **Agent tools** (examples): `generate_course`, `make_leg_harder`. Tools run locally and return summaries only.

## Product behaviour

- **One-view workspace** (D5), not a wizard. Main area: the map as the print page with course and description box. Side panel: assistant chat, interpreted spec, live progress, rule warnings with Fix buttons, tabs per course (H21, D21…). While the course is being set, the panel shows the search phase; the finished course is then revealed (D20). The user can stop, drag controls or the description box, and rules re-check instantly.
- **User picks the competition centre** (D6). Suggest candidates from the map (fields, buildings, parking, roads); user picks or clicks. Start/finish wishes come via chat.
- **Auto-fit to paper** (D7): course + description box fit A4 or A3; engine picks print area and orientation. User can override paper, orientation, scale, print area. "Fits on paper" is a normal rule check; the description box must not cover the course.
- **IOF control descriptions** (D8): symbolic format, columns A–H, header rows (event, class, length, climb), thicker line every third control, finish row. Generated from map objects under each control (mainly column D feature, G flag location). Also used in difficulty assessment (e.g. "hill, top" is too easy for SM level). Use the official IOF pictogram set.
- **Export** (D9): IOF XML 3.0 (controls, order, positions; opens in OCAD, Condes, Purple Pen) and a print PDF (map with course and description box, plus a separate description sheet). IOF XML has no standard fields for description symbols.

## Hackathon scope (D10)

In: OCAD input (OMAP/XMAP if time), competition centre selection, chat → spec, course search with core rules, live drawing, IOF description box, automatic paper fit, IOF XML export.

Out for the weekend: PNG/PDF map input, relay forking, planning a whole event's courses together, hosted server, local model.

## Open setup checklist

- [x] `LICENSE` file (AGPL-3.0-or-later) and `"license": "AGPL-3.0-or-later"` in `package.json`
- [ ] Repo public; "Source code" link in the app (link exists; set `SOURCE_CODE_URL` in `apps/web/src/config.ts`)
- [x] Credit ocad2geojson and Per Liedman in the README
- [ ] Tell all team members at kickoff that contributions are AGPL
- [x] ocad2geojson adapter module → internal map format (scale, extent, georef, SVG render, features with ISOM codes and per-map overrides)
- [x] Bundler config: `buffer` + `string_decoder` polyfills, `fs` aliased to empty module
- [x] Rules config file (IOF + SSL values): `packages/rules`; winning times and course lengths still to do
- [x] Releases and Pages deploy (D16): release-please, CI/release/deploy workflows, version in the app, README
- [ ] First release (D16): enable Actions PRs and Pages source in repo settings, merge the Release PR; add a README screenshot once the new UI is ready

## Recording new decisions

Add new decisions to `docs/decisions.md` using the same format (D11, D12…: Date, Status, Decision, Why, Alternatives considered, Consequences). Update this file if a decision changes a hard rule or the architecture.
