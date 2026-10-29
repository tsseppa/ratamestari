# Ideas

Ideas mentioned while working, before they become a plan. One line each: date, idea, status (`idea`, `planned`, `done` with its commit). Ideas that need a design get a decision in [`decisions.md`](decisions.md).

## Training (D25)

- 2026-10-29 · Training UI: contour training in the course sentence, with its own winning time, behind the experimental switch · done (9b4a685)
- 2026-10-29 · Course type (race or training) as its own step before the course details; training has no class · done
- 2026-10-29 · Training findings as advice rather than errors (`findingsAsAdvice` in the training rules) · planned
- 2026-10-29 · Contour-map leg style: long legs along or across a slope that end at one clear contour feature · planned
- 2026-10-29 · Form-line bends as control sites (they have no known uphill side yet, so they are dropped) · planned
- 2026-10-29 · Reduced maps: a printed symbol set with a contour-map preset the user can change; controls only on printed features · planned
- 2026-10-29 · Leg turns as part of the contour training rules · idea
- 2026-10-29 · Tune the 30° minimum contour bend; it is fine for now · idea
- 2026-10-29 · Training-rules editor in Settings with "Reset to defaults" · planned
- 2026-10-29 · Training difficulty as a course colour the user can pick (black by default) · idea
- 2026-10-29 · The assistant can choose training and pass on the minutes the user says · idea

## Map reading

- 2026-10-29 · Use the contour interval printed on the map in the engine (it assumes 5 m, so a 2.5 m map doubles climb and slope cost), and a setting to override it · done
- 2026-10-29 · Contour interval for PDF maps, and in the benchmark and recording scripts (they still assume 5 m) · idea
- 2026-10-29 · Local-map tests pick the first map in `maps/`; skip ISOM-only checks on contour maps · idea

## Development

- 2026-10-29 · Vite listens only on IPv6 `[::1]` in the dev container, so the forwarded port never answers; set `server.host` to `127.0.0.1` · idea
