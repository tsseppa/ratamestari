# Decision log: Ratamestari

## D1: Map input uses ocad2geojson; the project is AGPL-3.0 and public

**Date:** 2026-10-22
**Status:** Decided

### Decision

Read OCAD (`.ocd`) map files directly in the browser with [ocad2geojson](https://github.com/perliedman/ocad2geojson) (by Per Liedman). Because that library is AGPL-3.0, our project is also licensed **AGPL-3.0-or-later**, and the repository is public.

### Why

- Users drag and drop their `.ocd` file straight into the app, with no command line and no separate export step.
- It runs in the browser as pure JavaScript. The `fs` module is only used for file paths; we pass a `Buffer` instead.
- It is actively maintained (v2.1.23, July 2026). It supports OCAD 10, 11, 12 and 2018-format files, and newer OCAD versions appear to still save in the 2018 format.
- Each feature carries its OCAD **symbol number**, which maps directly to ISOM/ISSprOM categories.

### Alternatives considered

- **OCAD Viewer (free):** rejected. It only exports PDF and raster images, not Shapefile, DXF or GeoJSON.
- **OpenOrienteering Mapper export (GeoJSON, DXF, Shapefile):** a viable fallback with no AGPL obligations. But it needs a manual export step, and features are tagged with language-dependent symbol _names_, not numbers.
- **Our own OCD reader:** too big for the hackathon. It's a possible future step if we want a non-AGPL license.
- **Raster image + vision model:** loses the exact symbol data needed for rule checks.

### Consequences and checklist

- [ ] Add a `LICENSE` file (AGPL-3.0-or-later) and set `"license": "AGPL-3.0-or-later"` in `package.json`
- [ ] Keep the repo public, and add a visible "Source code" link in the running app (AGPL network-use clause)
- [ ] Use only AGPL-compatible dependencies (MIT, BSD and Apache-2.0 are fine)
- [ ] Credit ocad2geojson and Per Liedman in the README
- [ ] Tell all team members at kickoff that their contributions are AGPL. Going closed-source later would require replacing ocad2geojson **and** every contributor's agreement to relicense.
- [ ] Wrap ocad2geojson in one adapter module that outputs our internal map format (features with a category such as forbidden, impassable, water, path or control feature, plus scale and georeference). Then the reader can be swapped later without touching the course logic.
- [ ] Bundling: provide the `buffer` package and alias `fs` to an empty module (Vite or webpack 5)

---

## D2: Algorithms set the course; the AI handles language

**Date:** 2026-10-22
**Status:** Decided

### Decision

A deterministic course engine does all geometry: candidate control sites from ISOM symbols, a runnability cost map with A* routing, course search, rule checks and fitting to paper. The LLM works as an agent with tools. It turns the user's sentence into a course spec, calls engine tools (e.g. `generate_course`, `make_leg_harder`), reads the rule-check results, and explains the course in plain language.

### Why

- A language model is good at understanding "SM-level long distance" and explaining choices, but unreliable at measuring distances on a map.
- Rule checks must be exact and repeatable.

### Alternatives considered

- **Vision model placing controls on a map image:** rejected. The results look plausible but break rules.

### Consequences

- Rule values (control spacing, winning times per class, difficulty levels) live in a config file sourced from the IOF and SSL documents. The LLM reads them and never invents numbers.

---

## D3: The map never leaves the user's computer

**Date:** 2026-10-22
**Status:** Decided

### Decision

Privacy of the club's OCAD file is a core requirement. The map is parsed and processed only in the browser (course engine in a Web Worker). The LLM receives only text and numbers: the request, course and leg statistics, rule-check results and control descriptions as words. It never receives the map file, coordinates or geometry. Engine tools run locally and return summaries.

### Consequences

- MVP: the user pastes their own Claude API key, which is stored only in their browser.
- Future option: an offline mode with a local model.
- The open-source code (D1) lets anyone verify that the map is not uploaded. Mention this in pitches.

---

## D4: MVP is a static app on GitHub Pages, built to be server-ready

**Date:** 2026-10-22
**Status:** Decided

### Decision

The MVP is a static web app hosted on GitHub Pages, with no backend. The course engine is a browser-independent TypeScript package behind three interfaces:

- `MapSource`: OCAD, OMAP/XMAP, later PNG + world file
- `LlmProvider`: own key in the browser, a server proxy, or a local model
- `Storage`: the browser now, a database later

### Why

- No server work during the hackathon.
- The same engine can later run in a Node service, for our own hosted version or an integration into another system.

### Consequences

- A hosted service is fine under AGPL (D1) if users can get the source.
- Integration into a closed-source system requires replacing the OCAD reader first.

---

## D5: One-view workspace instead of a step-by-step wizard

**Date:** 2026-10-22
**Status:** Decided

### Decision

The UI is a single workspace:

- Main area: the map shown as the print page, with the course and control description box on it.
- Side panel: the assistant chat, interpreted spec, live progress, rule warnings with Fix buttons, and tabs for several courses (e.g. H21, D21).

The course draws itself live in the same view. The user can stop and take over at any point, drag controls or the description box, and rules re-check instantly.

### Alternatives considered

- **Four-step flow (map, build, edit, export):** rejected as too complex for non-technical users.

---

## D6: The user chooses the competition centre

**Date:** 2026-10-22
**Status:** Decided

### Decision

The tool does not guess the competition centre. It suggests candidate places found from the map (fields, buildings, parking areas, roads), and the user picks one or clicks the map. Other wishes, such as start and finish placement, are given in the chat.

### Why

- Usually only a few places on a map can work as the centre, and the organiser already knows which one.
- It narrows the search space and keeps the scope realistic.

---

## D7: Courses are fitted to paper automatically

**Date:** 2026-10-22
**Status:** Decided

### Decision

By default the engine plans the course so that the whole course and the control description box fit the chosen paper (A4 or A3). It picks the print area and orientation (landscape or portrait) automatically based on the course's shape. The user can override paper size, orientation, scale and the print area.

### Consequences

- "Fits on paper with the description box" is a rule check like any other.
- The description box placement must not cover the course.

---

## D8: IOF control descriptions are generated and printed on the map

**Date:** 2026-10-22
**Status:** Decided

### Decision

Control descriptions follow the IOF symbolic format (columns A–H, header rows with event, class, length and climb, thicker lines every third control, a finish row). They are generated from the map objects under each control, mainly columns D (feature) and G (location of the flag). They are printed on the map in the print area and also feed into the difficulty assessment (e.g. "hill, top" is too easy for SM level).

### Consequences

- The build uses the official IOF pictogram set. The concept sketches use hand-drawn stand-ins.

---

## D9: Export is IOF XML 3.0 for the course and PDF for the print

**Date:** 2026-10-22
**Status:** Decided

### Decision

- **IOF XML 3.0:** controls, their order and positions, so the course opens in OCAD, Condes and Purple Pen.
- **Print PDF:** the map with the course and the description box, plus a separate description sheet.

### Why

IOF XML 3.0 has no standard fields for control description symbols. Course controls carry map text, leg length, score, type and a special instruction. Descriptions could go into `Extensions`, but other programs would ignore them.

---

## D10: Hackathon scope

**Date:** 2026-10-22
**Status:** Decided

### In scope

- OCAD input (OMAP/XMAP if time allows), competition centre selection, chat request to spec, course search with core rules, live drawing, IOF description box, automatic paper fit, IOF XML export.

### Out of scope for the weekend

- PNG and PDF map input, relay forking, planning a whole event's courses together, a hosted server, a local model.

### Pitch material

- Long interactive pitch and a one-minute animated pitch (with narration, music and subtitles) exist as artifacts in the claude.ai project "AI Orienteering Course Setter".

---

## D11: Tech stack and package structure

**Date:** 2026-10-23
**Status:** Decided

### Decision

- **Language:** TypeScript, strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **Repo:** pnpm workspace. Internal packages export TypeScript source directly (`"exports": "./src/index.ts"`), so there is no per-package build step. One app consumes them.
  - `packages/core`: shared types, branded units and coordinates, rules config (IOF/SSL values) and its schemas
  - `packages/map-ocad`: `MapSource` adapter. The only package that imports ocad2geojson.
  - `packages/engine`: cost map, A* routing, control sites, course search, rule checks, paper fit. No DOM.
  - `packages/iof`: IOF control descriptions and IOF XML 3.0 export
  - `packages/agent`: `LlmProvider` interface, Claude implementation, tool definitions
  - `apps/web`: the one-view workspace (D5)
- **App:** React + Vite, with TanStack Store for app state and TanStack Form for settings. Add TanStack Query only if async worker/LLM plumbing needs it. No router (single view).
- **Schemas:** Zod is the single source of truth for the course spec, the rules config and LLM tool inputs. Tool calls from the LLM are validated at runtime.
- **Coordinates:** branded types for each coordinate system (OCAD paper units, ground metres, lat/lon, page/screen) so mixing them is a compile error. The engine works only in ground metres.
- **Map display:** OpenLayers. The OCAD map is rendered in the browser (ocad2geojson → SVG → canvas/bitmap) and shown as a static image layer. The engine uses the vector features, never the image. The course, paper frame and description box are vector layers; controls are draggable with OpenLayers interactions.
- **Coordinate frame:** the engine and the map view both use the map's **local frame**: ground metres, axes aligned with the printed map (map north up), origin at the OCAD paper origin. It is OCAD paper coordinates × scale. The projected CRS (the dev map is ETRS-TM35FIN, EPSG:3067, with a 10.2° grivation) is a rotation + offset away, so distances are identical. It's used only where real-world coordinates are needed (export, display). Non-georeferenced maps work the same way. Chosen during the first spike: ocad2geojson renders the map in paper orientation, and printing is in paper orientation too, so showing the map in EPSG:3067 would mean rotating the image for no benefit.
- **Worker:** the engine runs in a Web Worker via Comlink.
- **Testing:** Vitest, per package.
- **Deploy:** GitHub Actions → GitHub Pages.

### Why

- Solo developer: a small, familiar stack with strong types catches mistakes that no reviewer will.
- Packages give structure, keep the engine reusable outside the app (D4), and are easy to test in isolation.
- Several coordinate systems meet in this project. Branded types prevent unit-mix bugs.
- LLM tool inputs are untrusted; a Zod schema gives both the runtime check and the TypeScript type.
- OpenLayers handles projected and local coordinate systems as first-class citizens and has built-in feature editing.

### Alternatives considered

- **Single app with an engine folder:** simpler, but weaker boundaries and harder to reuse.
- **TanStack Router / Query:** mostly suited to server-data apps; ours is local state plus a map canvas.
- **Zustand:** equivalent to TanStack Store. TanStack chosen for consistency with TanStack Form.
- **Leaflet:** simpler, but only `CRS.Simple` for local coordinates, community types and plugin-based editing.
- **MapLibre GL:** fast, but locked to Web Mercator and cannot show non-georeferenced maps.
- **Rendering the vector features directly in the map library:** would mean reimplementing OCAD symbol styling. ocad2geojson already renders it.

### Consequences

- No online base map tiles: requesting tiles would reveal the event area to a tile server (spirit of D3).
- Browser canvas size limits (Safari's is the lowest) may require tiling the rendered map or a lower display resolution. Check with the spike.
- The PDF export renders at exact scale on its own; it does not screenshot the map view.
- First spike: load the real `.ocd` in `map-ocad`, render it, show it in OpenLayers with one draggable test control.

---

## D12: One engine package with a seeded, spec-driven course search

**Date:** 2026-10-23
**Status:** Decided

### Decision

`packages/engine` holds the whole pipeline as separate modules:

- **Cost map:** a grid of speed factors from the ISOM runnability classes; impassable and forbidden features block. Each contour crossed adds a cost for climb (since 2026-10-24), so routes can go around a hill instead of over it.
- **Router:** A\* on the cost map, giving the fastest route and its time between two points.
- **Leg evaluation:** length, best time, deviation from the straight line, route choice (distinct routes with nearly equal times), direction, climb.
- **Candidate sites:** features that can carry a control, with a difficulty score.
- **Course search:** builds the course.
- **Rule checks** and **paper fit.**

The course search is a stochastic optimisation driven by the spec:

- The LLM turns the request into a Zod-validated spec (format, class, level, centre, wishes). The engine turns the spec into targets and weights using values from `packages/rules` (course length from winning times, leg-length mix, control difficulty, amount of route choice). The LLM never supplies numbers.
- The search follows the Ratamestarikirja planning order: strong route-choice legs first, then map-reading links. It then improves the course by moving, adding and removing controls.
- A random seed drives the search. The same map, spec and seed give the same course; a new seed gives a different good course.
- Locked controls, feedback tools (e.g. `make_leg_harder`) and courses already set for the same event become constraints or weights, and the search continues from the current course.
- Climb is estimated from contour crossings along the route (contour interval × crossings), as the map has no elevation grid. Routing charges each contour it crosses.

### Why

- Routing answers "how fast from A to B"; the course search asks it thousands of times. Keeping them as layers in one package lets the search reuse the cost map and route cache.
- Different requests must produce different courses on the same map, and the user must be able to ask for alternatives, but results must stay reproducible for rule checks and debugging (D2).
- Spec-to-targets through the rules package keeps rule numbers out of the LLM (hard rule 3).

### Alternatives considered

- **Fixed greedy recipe:** always produces the same course for the same input, with no alternatives.
- **LLM chooses controls from a candidate list:** breaks D2; the LLM cannot judge legs it cannot measure.
- **Separate packages per pipeline stage:** more ceremony for a solo hackathon; the module boundaries inside `engine` are enough for now.

### Consequences

- The worker streams the best course found so far, which gives the live drawing in D5.
- Every generated course records its seed and spec, so it can be regenerated.
- Climb estimates are approximate; the 4% climb check is a warning, not an error.

---

## D13: Whole-course planning: shape, rhythm and skeleton before filling in

**Date:** 2026-10-24
**Status:** Decided

### Decision

Course generation follows [`course-planning-spec.md`](course-planning-spec.md): an explainable whole-course score with shape and rhythm metrics (route doglegs, length-scaled reversals, ring, spread, leg-length distribution, alternation, direction changes), skeleton-first planning (waypoint zones now, route-choice anchor legs next), a stronger search within a fixed time budget, a text-only course report for Claude, and calibration from real courses. It is built in phases A–E; phase A replaces the forced long-distance loop with waypoint zones.

### Why

- Generated courses looked like rings with monotonous legs and out-and-back turns. The old score never looked at leg rhythm or routes, and the loop produced the ring by design.
- Course setters plan the shape and key legs first, then link them (RMK 1.2.6.S, IOF App. 2 §3.4.1).
- An explainable score lets course setters and Claude see why a course scored as it did, and lets real courses calibrate the weights.

### Alternatives considered

- **Keep tuning the existing penalties:** the missing terms (rhythm, routes, shape) cannot be reached by tuning.
- **The original draft as written:** described a different engine and invented thresholds without sources; aligned instead (spec section 15).

### Consequences

- Quality values live in `packages/rules/src/course-quality.ts`, cited or flagged as interpretation until calibrated.
- A benchmark script measures every phase against the previous one.
- Real courses for calibration stay in the git-ignored `maps/` folder.

---

## D14: Site structure, UX and visual language

**Date:** 2026-10-24
**Status:** Decided

### Decision

The site and app follow [`site-ux-plan.md`](site-ux-plan.md):

- Two pages built as a Vite multi-page app: a landing page at `/` and the workspace at `/app/`. No client-side router.
- The landing page opens with a replay of a recorded engine run on a sample map, drawn as SVG, and its main action is "Try it with a sample map".
- The workspace has one main action per state. Expert tools move to the map toolbar (Layers, Measure) and Settings.
- The assistant is off by default and turned on in Settings with the user's own key. Settings already has a slot for a hosted provider.
- The whole workflow works on phones: the map fills the screen and the panel becomes a bottom sheet.
- English first. All UI text comes from typed message catalogues, so another language is one new file.
- Visual language from the orienteering map: white paper, black ink, overprint purple as the only accent, one typeface (Atkinson Hyperlegible Next), no boxes, no all-caps labels.
- A small sample map, © its club, is committed under `apps/web/public/sample/`.
- A credits section names the author (Pouju), ocad2geojson by Per Liedman and the sample map.

### Why

- The UI had grown one panel per engine feature, and most visitors will arrive on a phone without an OCAD file or an API key.
- Showing the real engine at work explains the tool in seconds without the usual AI-product look.
- A typed catalogue costs little now and avoids a rewrite when Finnish is added.

### Alternatives considered

- **GIF or video in the hero:** heavy, blurry on large screens, not translatable, and goes stale when the engine changes.
- **i18next:** heavier, and its keys are not type-checked without extra tooling.
- **Desktop-only workspace with a "use a larger screen" notice:** loses most first-time visitors.
- **Hanken Grotesk with IBM Plex Mono:** chosen from habit, and monospace data labels look generated.

### Consequences

- New conventions in `CLAUDE.md`: message catalogues, one design-token file, and the sample map as the only committed map.
- Engine and rules output stays language-free (structured findings). The UI writes the text.
- Map-dependent tests can run against the sample map in CI.

---

## D15: Course setter tools: routes, leg planning, locks and checking own courses

**Date:** 2026-10-24
**Status:** Decided

### Decision

The app gets four tools for course setters, described in [`site-ux-plan.md`](site-ux-plan.md) › Course setter tools:

- **Routes on a leg:** the fastest route and its alternatives are drawn green, blue and red (fastest to slowest), with letters and a row each in the panel.
- **Plan a leg:** the two-control dev tool becomes a user tool, and its leg can seed a generated course.
- **Lock controls and legs:** the search keeps locked controls in place and locked legs in order when it tries another course.
- **Check a course you set:** an IOF XML course file can be opened next to the map. It gets rule findings, routes, measured length and climb, and proposed descriptions. Fixes are only suggested.

They are built before the new UI (D14), in today's UI.

### Why

- Course setters want to see what the algorithm considered on a leg, and to plan the key legs themselves.
- Checking courses set in OCAD or Purple Pen widens the users from "wants a generated course" to every course setter and controller.
- The engine already has route alternatives, the IOF XML reader, recheckCourse and description generation. These tools are mostly UI.

### Alternatives considered

- **Green, yellow and red for routes:** the usual route-analysis colours, but yellow disappears on open land, so blue replaces it.
- **Fix that edits an imported course directly:** the course belongs to its setter, so fixes only suggest.
- **Lock every dragged control automatically:** surprising. Locking is an explicit choice.

### Consequences

- The course search must accept locked controls and anchor legs (D13 phases B and C come earlier for user-given anchors).
- Red and green differ in hue mainly, so routes always carry a letter and a panel row as well.

---

## D16: Public repo, versioned releases and automatic deploys to GitHub Pages

**Date:** 2026-10-24
**Status:** Decided, set up 2026-10-24; the first release waits for the new UI (D14)

### Decision

- The repository is public on GitHub (required by D1). Pages is set to **Source: GitHub Actions**. There is no `gh-pages` branch.
- **A release is what goes live.** Pushes to `main` never change the live site, so development continues on `main` while the released version stays untouched.
- **release-please** (Apache-2.0) keeps a "Release PR" open and up to date from the Conventional Commits on `main`. The PR bumps the version (`feat` → minor, `fix` → patch, `!` → major) and updates `CHANGELOG.md`, grouped by type and scope. **Merging the Release PR is the release:** it creates the `vX.Y.Z` tag and a GitHub Release with the notes.
- One version for the whole app, kept in the root `package.json` and starting at `0.1.0`. Internal packages are not versioned separately, since they are not published.
- Three workflows in `.github/workflows/`:
  - `ci.yml`: `pnpm check` and `pnpm build` on every pull request and push to `main`.
  - `release.yml`: on push to `main`, maintains the Release PR and, when a release was just created, calls `deploy.yml` with its tag.
  - `deploy.yml`: builds `apps/web` at a release tag and deploys it with `actions/deploy-pages`. It can also be started by hand with a tag to redeploy.
- The app shows its version next to the "Source code" link, so a bug report says which release it came from.
- The README gets a header with a one-line pitch, badges (CI, latest release, license, live demo), a screenshot or GIF of the workspace, a short "How it works" diagram showing that the map stays in the browser (D3), and a "Releasing" section.

### Why

- Releasing should take one click and no hand-edited versions or changelogs. The project already uses Conventional Commits, so the version bump and changelog can be derived from them.
- Deploying from Actions avoids a branch full of build output and extra deploy tooling.
- A Release PR lets us decide when to release, with the notes visible for review before they go out.
- The README is the first thing visitors see, and the privacy claim should be easy to check.

### Alternatives considered

- **`gh-pages` branch:** the older way to publish Pages. It mixes build output into the repository's history and needs a deploy tool.
- **Deploy on every push to `main`:** simplest, but half-finished work would go live during the hackathon.
- **changesets:** wants a hand-written note per change and suits published libraries with several versions.
- **semantic-release:** releases on every push to `main`, which removes the choice of when to release.

### Consequences

- Before going public, the history was checked: no map files (`.ocd`, `.omap`, `.xmap`) or source PDFs have ever been committed. `maps/` and `docs/sources` stay git-ignored.
- Vite already uses `base: './'`, so the build works under the `/ratamestari/` path of a project Pages site.
- Map-dependent tests skip in CI except those using the committed sample map.
- Commit types now matter for releases: a user-visible change must be `feat` or `fix` to appear in the changelog, and breaking changes need `!`.
- A release created with `GITHUB_TOKEN` does not trigger other workflows, so the deploy is called from `release.yml` rather than on a `release: published` event. For the same reason CI does not run on the Release PR itself; its commits already passed CI on `main`.
- The repository must allow GitHub Actions to create pull requests (Settings › Actions › General), and Pages must use GitHub Actions as its source.
- pnpm stops `install` on unapproved build scripts, which would fail CI. `pnpm-workspace.yaml` denies esbuild's script, which only verifies its binary.
- The app version comes from the root `package.json` through Vite's `define`.
- The README screenshot waits until the new UI is demo-ready.

## D17: What the assistant may know about the map and course

**Date:** 2026-10-24
**Status:** Decided

### Decision

- The assistant edits courses by number: it names controls ("control 5"), legs ("the leg from control 3") and compass directions, and the engine picks every site. Tools: `replace_control` (best, harder, easier or in a direction), `remove_control`, `insert_control`, `move_start`, `suggest_changes` + `apply_suggestion`, and a start-distance wish on `generate_course`.
- Tools return only what describes the course: feature descriptions in IOF words, distances rounded to 10 m, the eight compass points with map north up, times, rule-check results and score changes. Never coordinates, and never anything about sites that are not on the course or suggested for it.
- `suggest_changes` returns at most five suggestions, each a complete course the engine has already checked.
- "Here" means the leg the user has selected on the map; `get_workspace` names it ("control 3 to control 4"), not where it is.
- The start wish is a straight-line distance range from the finish. It stays for later courses ("Set course", "Try another course") until the assistant drops it or another map is opened.

### Why

- Users want to say "delete 5", "add a control here", "start near the centre" or "how could this be better?" in the chat (D2, D5), and a small model like Haiku needs tools that do exactly that.
- D3 forbids sending map geometry. Numbers and directions about the course's own stops let the assistant explain and edit the course, but a list of candidate sites or exact positions would let it rebuild the map.

### Alternatives considered

- **Coordinates in tool results:** the assistant could reason about places, but the map could be reconstructed from them. Rejected (D3).
- **Listing candidate sites around a control:** gives the assistant choice, but leaks the map's features site by site. The engine chooses instead.
- **No directions:** safest, but "move 5 north" and "the start is 300 m south-east of the finish" are natural ways to talk about a course, and the coarse course shape is not map content.

### Consequences

- Wishes that need the map's content ("start near the road") cannot be met from the chat; the assistant says so and offers a distance, a direction or dragging on the map.
- Suggestions are tied to the course they were made for; after any other change the assistant asks for new ones.

---

## D18: Set a course by hand: add, insert and delete controls

**Date:** 2026-10-24
**Status:** Decided, approved by the user 2026-10-24

### Decision

Ratamestari also helps a course setter set a course by hand, not only generates one.

- **Set it yourself**, next to Set course once the centre and class are chosen, starts an empty course. The first tap on the map places the start; the finish starts at the competition centre and can be dragged. Each later tap adds the next control.
- **Edit controls** in the map toolbar does the same on any course: generated, set by hand or opened from an IOF XML file. A tap on a leg line puts a control into that leg. A tap on a control selects it, and it can then be deleted with a button or Delete/Backspace, or dragged (on touch only the selected stop drags).
- **Placement:** a tapped point snaps to the nearest candidate control site within 60 m, as dragging does. With none near, the control stays where it was tapped and gets the finding "no map feature" (as in Check a course, D15), so it is never refused. Inserting at a tapped point (`insertControlAt`) differs from the assistant's `insertControl`, where the engine picks the best site on the leg (D17).
- Every edit runs the same rule checks, routing, measurement, descriptions and paper fit as dragging. A course with no or a few controls is a normal state.
- Edits made on the map can be undone one by one (Undo, Ctrl/Cmd+Z), back to the empty map.

### Why

- Many course setters want to place controls themselves and use Ratamestari for the checks, routes, descriptions, paper fit and export. This widens the product from "generates a course" to "helps you set one", like the checker in D15.
- The engine already re-checks any course (`recheckCourse`); adding, inserting and deleting are small additions on top of it.

### Alternatives considered

- **Always keep the clicked point:** like Check a course. But on a generated or hand-set course the description comes from a site, and dragging already snaps; two rules for the same gesture would surprise.
- **Refuse a control with no site near it:** as dragging does. Setters sometimes place controls on features the map reader does not recognise, so a finding is more useful than a refusal.
- **Undo as a separate history in the engine:** the course is a plain value in the app state, so a list of earlier courses is enough.

### Consequences

- The finish is draggable on every course.
- Changing the class while setting by hand re-checks the course as the new class.
- Featureless controls carry their finding through later edits, also on imported courses (`recheckCourse` raises it).
- The assistant can remove a control (`remove_control`, D17) but cannot add one at a chosen point, since it never sees positions; it points the user to Edit controls.

---

## D19: Section-based course planning: technical areas, skeleton, sections

**Date:** 2026-10-24
**Status:** Decided

### Decision

The course search plans top-down, following [`section-planning-spec.md`](section-planning-spec.md):

1. Find **technical areas** in the usable print area (clusters of good control sites, each with a capacity in seconds).
2. Choose a **skeleton** from a format template: which areas the course visits, in which order, the **connecting legs** between them (long: route-choice legs across weaker terrain; middle: one semi-long leg), the start, a run-in, and a **time budget for every section**, capped by the area's capacity.
3. **Fill each section** independently with a beam search from its entry to its exit within its budget.
4. **Improve** by rebuilding whole sections under simulated annealing, then repair as today.

Before that, quick wins: a middle leg mix calibrated on the reference courses, a crowding score term, and keeping the best of all drafts. The greedy builder and waypoint zones of D13 phase A are replaced once the benchmark passes. The score, metrics and benchmark of D13 stay.

### Why

- Generated courses bunch controls: around the start in middle distance, and in ten-control tangles in long distance, especially near the end. The greedy build has no time budget per part of the course. It fills time until the time runs out, its leg-length quota ignores position, and single-control moves can't untangle a cluster. A middle leg-mix target with 25% of legs under 150 m (human courses: about 7%) made middle distance worse.
- Course setters plan this way: route-choice legs first, joined by map-reading legs; connecting legs between terrain parts need not be good; a few very good legs joined by short links (RMK 1.2.6.S, IOF App. 2 §3.4.1). Middle distance is about changes of rhythm in 1.5–2 km² of detailed terrain (RMK 2.S.2).
- Budgets capped by capacity make "too much course for too small an area" impossible by construction. A course that doesn't fit comes out short, with a finding, instead of crammed.
- Sections are independent given their endpoints, so they can later be filled in parallel workers.

### Alternatives considered

- **Keep the greedy and tune it** (time budget per waypoint, crowding filter): cheaper, and kept as the demo fallback. But it still decides one control at a time without knowing whether the rest fits.
- **Global metaheuristic only** (annealing or large-neighbourhood search over the whole course): a stronger search, but it still starts from a bad greedy draft and has no idea of terrain parts or connecting legs. Its section-rebuild move is kept inside the new design.
- **Exact orienteering-problem solvers** (ILP, branch and cut): too slow in the browser for thousands of candidate sites, and our objective (shape, rhythm, readability) isn't linear.

### Consequences

- New engine modules `areas.ts`, `skeleton.ts` and `section-fill.ts`. New config in `course-quality.ts` (crowding, technical areas, format templates, search sizes), cited or flagged as interpretation.
- `pnpm render-course` gets overlays for areas and the skeleton. The benchmark gets crowding and end-of-course columns.
- `docs/rules/course-setting.md` › Course search and the CLAUDE.md engine pipeline are updated when the planner lands, and `pnpm record-demo-run` is re-run.
- Choosing the paper position from skeletons, parallel section filling and calibration of templates come after the demo.

---

## D20: Reveal the finished course instead of drawing the search live

**Date:** 2026-10-24
**Status:** Decided. Amends D5: "the course draws live".

### Decision

While the course is being set, the map shows no course. The side panel shows the search phase (finding areas, planning the course, setting sections, improving, checking) with a Stop button. When the search ends or is stopped, the final course is revealed control by control and line by line, as on the landing page. Edits (dragging, chat edits, undo, set by hand) update at once, without animation. With reduced motion, the course appears at once.

### Why

- Intermediate courses blink on the map. They mean nothing to the user and look unfinished. A single deliberate reveal of the chosen course is calmer and more impressive, which matters for the demo.
- The section planner (D19) works in phases, not by improving a full course step by step, so phases describe its progress better than intermediate courses do.

### Alternatives considered

- **Keep live drawing, but throttled:** less blinking, still unfinished-looking courses.
- **Show the skeleton (areas and connecting legs) while planning:** informative for course setters, possibly later as an option, but it shows working state the user can't act on.

### Consequences

- The engine's search yields `SearchProgress` (phase, done, total) instead of intermediate courses (spec section 7). Phase labels live in the web i18n catalogues.
- D5's "the user can stop" stays: Stop returns the best course so far, which is then revealed.
- CLAUDE.md › Product behaviour is updated when the reveal lands.

---

## D21: Routes for the whole course, and a live route preview when setting by hand

**Date:** 2026-10-24
**Status:** Decided

### Decision

Extends "Routes on a leg" (D15):

- **Routes on all legs** is a map layer in Layers, next to the cost map and candidate sites. It draws every leg's fastest route and alternatives in the leg view's colours (green, blue, red), thinner than the selected leg's.
- **A route list** under the course: one row per leg with its fastest time and its route choice (how many other routes, and how much slower the best one is), plus "a real route choice on N of M legs". A row opens that leg's route view. It is found on request ("Find routes on all legs") or when the layer is on.
- Both work for any course on the map: generated, set by hand, or opened from an IOF XML file and checked.
- **While setting by hand with a mouse,** the pointer shows where the next control would snap, the fastest route of each leg it would make at once, and the alternatives once the pointer rests for 150 ms. The panel says how much slower the other routes are. On touch, a control just placed shows its legs' routes.
- Route searches go to the worker one at a time through a queue (the pointer's preview first, then the selected leg, then the rest of the course), and their results are kept by leg ends and pace, so an edit only searches the legs it changed.

### Why

- Course setters look for legs with real route choice; seeing the routes while placing a control, and for the whole course at once, lets them find and keep those legs. This also makes route analysis of imported courses one click instead of one leg at a time.
- Finding alternatives takes 30 ms to 1.1 s per leg on the club maps (fastest route alone 2–120 ms), so the preview shows the fastest route first, and the queue keeps a long course's searches from delaying the pointer.

### Alternatives considered

- **A switch inside the leg view:** hidden where it is least useful, and no overview of the course.
- **Searching alternatives on every pointer move:** up to a second behind the pointer on long legs.
- **Fastest route only in the preview:** cheaper, but the alternatives are the point: they show which legs are interesting.

### Consequences

- The worker gets `previewControl` (snap as a tap does, then the fastest routes).
- Plan a leg and the selected leg use the same queue, so they never wait behind more than one leg's search.

---

## D22: Map input from PDF and images, and reading the printed course

**Date:** 2026-10-25
**Status:** Decided

### Decision

Ratamestari also reads a map from a **PDF** or an **image** (a scan or a phone photo of a paper map), because course setters often don't have the OCAD file. If a course is printed on the map, it is read as a course (start, controls, order, finish) and removed from the map, so the user can check or edit it, export it as IOF XML, or set a new course on the clean map.

- **Vector PDF first** (as exported from OCAD or OpenOrienteering Mapper). Its paths keep their exact geometry, colour and line width, and ISOM fixes colours and widths per symbol, so most symbols can be told apart. Scans and phone photos come later and reuse the same symbol classification and course reading.
- **Packages**, all named for what they do:
  - `packages/map-import-pdf`: PDF → internal map format (`MapFeature`s with ISOM codes), using pdf.js. Returns the same shape as the OCAD reader, so the engine doesn't change.
  - `packages/map-import-image`: later; image correction (perspective, folds, light) and pixel classes → internal map format.
  - `packages/course-detect`: the purple overprint (start triangle, control circles and numbers, legs, finish) → course, and the map with the course removed.
  - `packages/map-ocad` is renamed `packages/map-import-ocad` to match.
- **Scale:** a PDF page is in millimetres, so the user gives the map scale (often printed on the map). An image also needs a known distance, marked by the user.
- Everything runs in the browser (D3). The map, PDF or photo is never sent to an LLM or a server.
- Hand-drawn routes a runner has drawn on the map are out of scope: runners mostly record a GPX track.

### Why

- Map owners often share a print PDF, not the `.ocd`. Without PDF input, many course setters can't use the app at all.
- A vector PDF keeps much of what the engine needs (contours as lines, point symbols, areas). A raster loses it, so it gets the same pipeline later with a lower quality bar.
- `maps/` has OCAD files with their courses (`*.Courses.xml`), so a PDF made from them can be scored against the true features and the true course.

### Alternatives considered

- **Raster or photo first:** most useful for the "photo of my paper map" case, but the hardest. Doing it first would mean building the symbol table and course reading on noisy input.
- **Vision model reads the map:** rejected by D2 and D3 (it places things plausibly but wrongly, and the map would leave the computer).
- **Asking users to export from OpenOrienteering Mapper:** needs the source map file, which is exactly what they don't have.

### Consequences

- PDF features have no OCAD symbol numbers. The classifier gives each one an ISOM code and confidence, and the engine and description logic work from ISOM codes.
- Classification is a table of colour, width and shape → ISOM code in `packages/rules`, with sources cited like the other rule values.
- The app's file picker accepts `.pdf` (and later images) and asks for the scale when the file doesn't say it.
- Real OCAD and OOM PDF exports are needed as test inputs alongside PDFs we render ourselves; they stay in the git-ignored `maps/`.

---

## D23: Count visits and main actions with Umami Cloud

**Date:** 2026-10-25
**Status:** Decided

### Decision

- The published site loads Umami Cloud's script on the landing page, the workspace and the guides. It counts page views and a few actions: a map opened (sample or own), a course set (event level, distance, class, number of kept controls), setting a course by hand started, a course file checked, PDF or IOF XML downloaded, the assistant turned on, and a message sent to it.
- Events never carry the map, file names, coordinates, course geometry or chat text.
- Only the production build includes the script, and its `data-domains` limits counting to `pouju.github.io`, so `pnpm dev`, local builds and previews send nothing. Without a website ID in `apps/web/vite.config.ts` no script is added.
- The landing page's credits say what is counted and why. The privacy promise at the top stays about the map, which never leaves the computer.

### Why

- Page views alone cannot tell whether people use the app or only look at it; a handful of actions can.
- Umami sets no cookies, keeps no personal data and builds no profiles, so no consent banner is needed and the D3 promise about the map is unchanged.
- The script is loaded from Umami, not bundled, so it adds no dependency to the AGPL app (D1).

### Alternatives considered

- **No counting:** no way to know whether the app is used.
- **Google Analytics:** cookies, profiles and a consent banner.
- **Self-hosted Umami or Plausible:** needs a server, which D4 rules out.
- **Mentioning it next to the privacy promise at the top:** noise beside the main message that the map stays on the computer.

### Consequences

- New actions worth counting go through `track` in `apps/web/src/analytics.ts`, whose event types say what each may carry.

---

## D24: Experimental features behind a hidden switch

**Date:** 2026-10-25
**Status:** Decided

### Decision

Features that need a long time of tuning in real use ship in the published app but stay hidden until switched on.

- **On by default while developing** (`pnpm dev`), **off by default in the published app** (GitHub Pages).
- Switched on or off by clicking the version number in Settings seven times within three seconds. A short notice says which way it went. While they are on, Settings shows an "Experimental features" section listing them, with a button to turn them off.
- The choice is stored in the browser (`localStorage`), like the assistant key. Nothing is sent anywhere.
- The switch is not advertised in the app, the landing page or the guides.
- Code checks it with `useExperimentalFeatures()` (`apps/web/src/experimental.ts`). Large experimental code loads only when used (dynamic `import()`), so it costs nothing for users who never turn it on.
- First feature: opening a map from a PDF and reading the course printed on it (D22).

### Why

- PDF import works on the two real exports we have but will meet many more producers and print settings. Users who find it by accident would judge the app by unfinished results.
- Keeping it in the same build means testers use exactly what everyone gets, with no separate deployment.

### Alternatives considered

- **A separate preview deployment:** a second Pages site and build to keep in sync, for a single developer.
- **A URL parameter:** shared links would turn it on for people who didn't ask for it.
- **A visible "Labs" toggle:** advertises unfinished features.

### Consequences

- The source of experimental features is public anyway (AGPL, and it's in the bundle); the switch only keeps them out of the way.
- When a feature is ready, its `useExperimentalFeatures()` checks go and it becomes a normal `feat`.

---

## D25: Courses for training, with their own rules; contour-map training first

**Date:** 2026-10-29
**Status:** Proposed

### Decision

Every course request has a **purpose**: `competition` (the default) or `training`.

- **Competition** stays exactly as it is: IOF and SSL rules, values with sources, rule checks as today.
- **Training** has its own **training rules**. Ratamestari gives defaults, and the user can change any of them. They cover:
  - the target time or length,
  - the leg-length mix,
  - the control difficulty range,
  - which rule checks run, and whether a finding is advice or an error.
- Routing still blocks forbidden and impassable areas in training, as the map says.
- A training course has a **training kind**. The first is **contour-map training**. Other kinds can be added later as further kinds with their own defaults.

**Contour-map training** is for maps whose value is in the relief:

- **Remote-sensed maps**, generated from LiDAR and aerial or satellite data (e.g. with Karttapullautin) and maybe edited in OCAD, but never field-checked.
- **Reduced maps**: a full orienteering map printed with only some symbols.

How it works:

- **Two symbol sets per map.** The engine reads every symbol for routing, avoidance and the mapped area. Only the **printed set** is drawn on the map and PDF, and **controls go only on printed features**.
  - The remote-sensed preset prints everything.
  - The reduced preset starts from a contour-map set (contours, form lines, slope lines, water, forbidden areas), and the user adds or removes symbols.
- **Contour-detail quality.** Technical areas (D19) are found from how much the contours bend per hectare (count and sharpness of bends, knolls and re-entrants), instead of the density of demanding point features.
- **Contour sites with a clarity score.** Knolls, depressions, spurs and re-entrants from contours and form lines get a continuous clarity (size, bend angle, how many contours show the form) instead of fixed yes/no limits. The training rules set which clarity is wanted.
- **Leg style.** Long legs along or across a slope that end at one clear contour feature, between technical legs in detailed hillsides.

Where the values live:

- Training defaults live in `packages/rules`. They cite a new source, `Ratamestari defaults`, and are always flagged `interpretation`.
- The user's own training rules are stored in the browser (`Storage`), and every course records the training rules it was set with (D12).
- Training ships behind the experimental switch (D24) until it is tuned.

### Why

- Clubs train on maps and in forms that competition rules don't cover. Contour-only or reduced maps are a common training form
- Remote-sensed maps make it possible for individuals or clubs to do orienteering trainigns where there are no maps made.
- The engine finds areas from point-feature density, which these maps barely have. On one remote-sensed map, a long-distance H21 request found one technical area and set a 1-control, 19-minute course against a 90-minute target, with a mean terrain quality of 0.11.
- No IOF or SSL document gives values for training courses. The coach knows the group's needs, so they should be able to set them. A default of ours, named as such, is honest. Stretching a competition rule to cover training would not be.
- A runner can only navigate by what is printed. A control on a boulder that a reduced map hides would be unfair.
- Two presets of one mechanism avoid two pipelines that drift apart.

### Alternatives considered

- **A `training` event level next to national and SM level:** mixes "how strict" with "how big the event is". Every table keyed by level, winning times included, would need training values that no source has.
- **A map-type setting without a purpose:** a contour map would still be checked against competition rules it can't meet.
- **Fixed training values without user tuning:** our defaults would become rules nobody has written down.
- **Two separate pipelines for remote-sensed and reduced maps:** duplicated code, and fixes would land in only one of them.
- **Tuning the ISOM thresholds down:** point-feature density still can't see slope detail.
- **Reading LiDAR elevation directly:** better relief, but needs a new input.

### Consequences

- Hard rule 3 is reworded: rule numbers come from IOF and SSL documents. Training defaults are our own, cite `Ratamestari defaults`, and the user can change them.
- The spec (Zod) gets `purpose`, `trainingKind` and the training rules.
- The assistant can pick the purpose and training kind and pass numbers the user said ("a 60-minute course"). It never makes up training values (D2), and it can report contour-detail statistics as words (D17).
- New engine module for contour detail. `site-quality.ts` and `areas.ts` take the quality measure from the training kind. Candidate sites are limited to the printed set.
- The map view, print page and PDF draw only the printed set (the `renderSvg` object filter). Layers can show the full map for reference.
- Control descriptions (D8) are unchanged. The difficulty assessment uses the training rules' range.
- Settings get a training-rules editor with "Reset to defaults". All its text goes in the message catalogues (D14).
- `docs/rules/course-setting.md` gets a training section, marked as our defaults, not a digest.
- PDF and image maps (D22) can use contour-map training later.
