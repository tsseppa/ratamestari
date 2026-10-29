import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  localPoint,
  localToProjected,
  projectedToGeographic,
  type LocalExtent,
  type LocalPoint,
} from '@ratamestari/core'
import {
  buildTerrain,
  convexHullArea,
  crowdingCounts,
  findControlSites,
  findPeripheralInformation,
  fitPrintAreaToCourse,
  legLengths,
  mappedAreaWithin,
  measureCourseShape,
  findRoute,
  routeDoglegOverlaps,
  setCourseOnPaper,
  signedTurns,
  withMapContourInterval,
  type Terrain,
} from '@ratamestari/engine'
import { describeControl, readCourseData, type ImportedCourseData } from '@ratamestari/iof'
import { loadOcadMap, type OcadMap } from '@ratamestari/map-import-ocad'
import {
  COURSE_SHAPE,
  CROWDING,
  courseTargetFor,
  FORMAT_QUALITY,
  printScaleFor,
  type Format,
} from '@ratamestari/rules'

const MAPS_FOLDER = 'maps'
const COURSES_SUFFIX = '.Courses.xml'
const DEFAULT_OUT = join(MAPS_FOLDER, 'renders', 'benchmark.md')
const PACE_SECONDS_PER_KM = 300
const MATCH_TOLERANCE_DEGREES = 0.001
const METRES_PER_DEGREE = 111_000
const MIN_STOPS = 3
const END_SHARE = 0.25

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '3' },
    formats: { type: 'string', default: 'long,middle' },
    out: { type: 'string', default: DEFAULT_OUT },
    only: { type: 'string' },
    // Searches run in parallel child processes, one per core by default.
    jobs: { type: 'string', default: String(availableParallelism()) },
    worker: { type: 'string' },
  },
})
const seeds = Array.from({ length: Number(values.seeds) }, (_, i) => i + 1)
const formats = values.formats.split(',') as Format[]

interface SearchJob {
  readonly mapFile: string
  readonly format: Format
  readonly seed: number
  readonly centre: readonly [number, number]
}

interface SearchResult {
  readonly controls: number
  readonly stops: readonly (readonly [number, number])[]
  readonly printExtent: LocalExtent | null
  readonly timeErrorPercent: number
  readonly findings: number
  readonly searchSeconds: number
}

interface Row {
  readonly source: string
  readonly controls: number
  readonly stops: readonly LocalPoint[]
  readonly printExtent: LocalExtent | null
  readonly timeErrorPercent: number | null
  readonly findings: number | null
  readonly searchSeconds: number | null
}

const lines: string[] = []
const mapFiles = readdirSync(MAPS_FOLDER).filter(name => name.endsWith('.ocd'))
const courseFiles = readdirSync(MAPS_FOLDER).filter(
  name => name.endsWith(COURSES_SUFFIX) && (!values.only || name.includes(values.only)),
)
const loaded = new Map<string, OcadMap>()
const loadMap = async (file: string) => {
  const cached = loaded.get(file)
  if (cached) return cached
  const map = await loadOcadMap(new Uint8Array(readFileSync(join(MAPS_FOLDER, file))))
  loaded.set(file, map)
  return map
}

if (values.worker) {
  console.log(JSON.stringify(await runSearchJob(JSON.parse(values.worker) as SearchJob)))
  process.exit(0)
}

interface Benchmarked {
  readonly title: string
  readonly terrain: Terrain
  readonly references: readonly Row[]
  readonly jobs: readonly SearchJob[]
}

const benchmarked: Benchmarked[] = []
for (const courseFile of courseFiles) {
  const data = readCourseData(readFileSync(join(MAPS_FOLDER, courseFile), 'utf8'))
  const scale = data.mapScale ?? 15000
  const toLocal = (id: string) => {
    const position = data.controls.get(id)?.mapPositionMillimetres
    return position ? localPoint((position[0] * scale) / 1000, (position[1] * scale) / 1000) : null
  }
  const references = data.courses
    .map(course => ({
      name: course.name,
      stops: course.controlIds.map(toLocal).filter((stop): stop is LocalPoint => stop !== null),
    }))
    .filter(reference => reference.stops.length >= MIN_STOPS)
  const firstStops = references[0]?.stops ?? []
  const mapFile = await mapContaining(data, scale)
  if (!mapFile) continue
  const map = await loadMap(mapFile)
  const terrain = terrainOf(map)
  const centre = firstStops[firstStops.length - 1]!
  benchmarked.push({
    title: `## ${courseFile.replace(COURSES_SUFFIX, '')} (${data.courses.length} reference courses)`,
    terrain,
    references: references.map(reference => ({
      source: `reference ${reference.name}`,
      controls: reference.stops.length - 2,
      stops: reference.stops,
      printExtent:
        fitPrintAreaToCourse(terrain, reference.stops, {
          papers: ['A4', 'A3'],
          printScale: scale,
          descriptionRows: reference.stops.length + 2,
        })?.extent ?? null,
      timeErrorPercent: null,
      findings: null,
      searchSeconds: null,
    })),
    jobs: formats.flatMap(format =>
      seeds.map(seed => ({ mapFile, format, seed, centre: [centre[0], centre[1]] as const })),
    ),
  })
}

const allJobs = benchmarked.flatMap(entry => entry.jobs)
const results = await runInParallel(allJobs, Math.max(1, Number(values.jobs)))
for (const entry of benchmarked) {
  const rows: Row[] = [...entry.references]
  for (const job of entry.jobs) {
    const result = results.get(job)
    if (!result) continue
    rows.push({
      source: `${job.format} seed ${job.seed}`,
      controls: result.controls,
      stops: result.stops.map(([x, y]) => localPoint(x, y)),
      printExtent: result.printExtent,
      timeErrorPercent: result.timeErrorPercent,
      findings: result.findings,
      searchSeconds: result.searchSeconds,
    })
  }
  lines.push(entry.title, '', table(rows, entry.terrain), '')
  console.log(lines.slice(-3).join('\n'))
}

mkdirSync(join(MAPS_FOLDER, 'renders'), { recursive: true })
writeFileSync(values.out, `# Course benchmark\n\n${legend()}\n\n${lines.join('\n')}\n`)
console.log(`Wrote ${values.out}`)

// Each OCAD file has its own paper coordinates, so match maps by where the controls land on the
// ground: the right map turns the course's map positions into the course's own longitudes and
// latitudes. Without georeferences, fall back to a map whose extent holds the course.
async function mapContaining(data: ImportedCourseData, scale: number): Promise<string | undefined> {
  const controls = [...data.controls.values()].filter(c => c.mapPositionMillimetres !== null)
  if (controls.length === 0) return undefined
  let best: { file: string; error: number } | undefined
  for (const file of mapFiles) {
    const { georef, extent } = (await loadMap(file)).info
    const errors = controls.map(control => {
      const [x, y] = control.mapPositionMillimetres!
      const local = localPoint((x * scale) / 1000, (y * scale) / 1000)
      if (georef && control.projected) {
        const [easting, northing] = localToProjected(local, georef)
        const metres = Math.hypot(easting - control.projected[0], northing - control.projected[1])
        return metres / METRES_PER_DEGREE
      }
      if (!georef || !control.longitudeLatitude) {
        const inside =
          local[0] >= extent[0] &&
          local[0] <= extent[2] &&
          local[1] >= extent[1] &&
          local[1] <= extent[3]
        return inside ? 0 : Number.POSITIVE_INFINITY
      }
      const ground = projectedToGeographic(localToProjected(local, georef), georef.epsg)
      if (!ground) return Number.POSITIVE_INFINITY
      const [longitude, latitude] = control.longitudeLatitude
      return Math.hypot(ground.longitudeDegrees - longitude, ground.latitudeDegrees - latitude)
    })
    const error = errors.reduce((sum, e) => sum + e, 0) / Math.max(1, errors.length)
    if (!best || error < best.error) best = { file, error }
  }
  return best && best.error < MATCH_TOLERANCE_DEGREES ? best.file : undefined
}

function table(rows: readonly Row[], terrain: Terrain): string {
  const header = [
    'course',
    'ctrl',
    'median leg m',
    'leg mix (bins)',
    'turn >60°',
    'same-way turning',
    'reversals',
    'monotonous',
    'spread',
    'doglegs',
    'crowd L/M',
    'end tangle',
    'long fit',
    'middle fit',
    'time err',
    'findings',
    'search s',
  ]
  const body = rows.map(row => {
    const legs = legLengths(row.stops)
    const turns = signedTurns(row.stops)
    const metricsFor = (format: Format) =>
      measureCourseShape(terrain, row.stops, format, row.printExtent)
    const long = metricsFor('long')
    const usable = mappedAreaWithin(terrain, row.printExtent)
    return [
      row.source,
      String(row.controls),
      String(Math.round(median(legs))),
      histogram(legs).join('/'),
      percent(
        turns.filter(t => Math.abs(t) > COURSE_SHAPE.directionChangeDegrees).length / turns.length,
      ),
      long.ring.note.split('%')[0] + '%',
      long.reversals.value.toFixed(2),
      percent(long.alternation.value),
      percent(usable > 0 ? convexHullArea(row.stops) / usable : 0),
      doglegs(row.stops, terrain),
      (['long', 'middle'] as const)
        .map(format => Math.max(0, ...crowdingCounts(row.stops, CROWDING[format].radiusMetres)))
        .join('/'),
      endTangle(row.stops).toFixed(2),
      long.legLengths.value.toFixed(2),
      metricsFor('middle').legLengths.value.toFixed(2),
      row.timeErrorPercent === null ? '' : `${row.timeErrorPercent.toFixed(1)}%`,
      row.findings === null ? '' : String(row.findings),
      row.searchSeconds === null ? '' : row.searchSeconds.toFixed(1),
    ]
  })
  return [header, header.map(() => '---'), ...body]
    .map(cells => `| ${cells.join(' | ')} |`)
    .join('\n')
}

function doglegs(stops: readonly LocalPoint[], terrain: Terrain): string {
  const routes = stops
    .slice(1)
    .map((stop, i) => findRoute(terrain.grid, stops[i]!, stop)?.points ?? [stops[i]!, stop])
  const overlaps = routeDoglegOverlaps(routes)
  const hard = overlaps.filter(overlap => overlap > COURSE_SHAPE.doglegHardOverlap).length
  return `${hard} (max ${percent(Math.max(0, ...overlaps))})`
}

// Mean nearest-neighbour distance of the controls in the last quarter of the course (by
// straight-line length, which references also have) over that of all controls. Below 1 the end
// is denser than the rest.
function endTangle(stops: readonly LocalPoint[]): number {
  const controls = stops.slice(1, -1)
  if (controls.length < 2) return 1
  const nearest = controls.map((control, i) =>
    Math.min(
      ...controls.flatMap((other, j) =>
        i === j ? [] : [Math.hypot(other[0] - control[0], other[1] - control[1])],
      ),
    ),
  )
  const legs = legLengths(stops)
  const total = legs.reduce((sum, leg) => sum + leg, 0)
  let travelled = 0
  const inEnd = controls.map((_, i) => {
    travelled += legs[i]!
    return travelled >= (1 - END_SHARE) * total
  })
  const mean = (values: readonly number[]) =>
    values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length)
  const endNearest = nearest.filter((_, i) => inEnd[i])
  return endNearest.length === 0 ? 1 : mean(endNearest) / mean(nearest)
}

function legend(): string {
  const edges = FORMAT_QUALITY.long.legLengths.binEdgesMetres
  return [
    `Leg mix: number of legs per straight-length bin, edges ${edges.join(', ')} m.`,
    'Same-way turning: share of turning in one direction (100% is a ring).',
    `Reversals: turns over ${COURSE_SHAPE.reversalDegrees}°, weighted by the shorter leg.`,
    'Monotonous: share of legs in runs of similar length. Spread: course hull / mapped area on the paper.',
    `Doglegs: controls where the next route runs back along the incoming one by more than ${COURSE_SHAPE.doglegHardOverlap * 100}% (worst overlap in brackets).`,
    `Crowd L/M: most controls within ${CROWDING.long.radiusMetres} m / ${CROWDING.middle.radiusMetres} m of one control (limit ${CROWDING.long.maxControls}).`,
    `End tangle: mean nearest-neighbour distance of the controls in the last ${END_SHARE * 100}% of the length over that of all controls (below 1: the end is denser).`,
    'Long/middle fit: distance from the leg-length target of that format (0 is a perfect match).',
    `Search s: time of one search; with --jobs above 1 the searches share the processor, so use --jobs 1 to compare speed.`,
  ].join('\n')
}

function histogram(legs: readonly number[]): number[] {
  const edges = FORMAT_QUALITY.long.legLengths.binEdgesMetres
  const counts = new Array<number>(edges.length - 1).fill(0)
  for (const leg of legs) {
    const bin = edges.findIndex((edge, i) => i > 0 && leg < edge) - 1
    counts[bin < 0 ? counts.length - 1 : bin]!++
  }
  return counts
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

// Long searches first, so the slowest jobs do not start last.
async function runInParallel(
  jobs: readonly SearchJob[],
  concurrency: number,
): Promise<Map<SearchJob, SearchResult | null>> {
  const queue = [...jobs].sort((a, b) => Number(b.format === 'long') - Number(a.format === 'long'))
  const results = new Map<SearchJob, SearchResult | null>()
  const script = fileURLToPath(import.meta.url)
  const runOne = (job: SearchJob) =>
    new Promise<SearchResult | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', script, '--worker', JSON.stringify(job)],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      )
      let output = ''
      child.stdout.on('data', chunk => (output += chunk))
      child.on('error', reject)
      child.on('close', code =>
        code === 0
          ? resolve(JSON.parse(output.trim().split('\n').pop() ?? 'null') as SearchResult | null)
          : reject(new Error(`${job.mapFile} ${job.format} seed ${job.seed} failed (${code})`)),
      )
    })
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      results.set(job, await runOne(job))
      console.log(`${results.size}/${jobs.length}: ${job.mapFile} ${job.format} seed ${job.seed}`)
    }
  })
  await Promise.all(workers)
  return results
}

function terrainOf(map: OcadMap) {
  const terrain = buildTerrain(map.features(), map.info.extent)
  const peripheral = findPeripheralInformation(map.annotations(), terrain, map.info.scale)
  return withMapContourInterval(terrain, peripheral)
}

async function runSearchJob({ mapFile, format, seed, centre }: SearchJob) {
  const map = await loadMap(mapFile)
  const terrain = terrainOf(map)
  const sites = findControlSites(map.features(), terrain).filter(s => describeControl(s) !== null)
  const target = courseTargetFor({
    eventLevel: 'finnishChampionship',
    format,
    sex: 'H',
    ageClass: 21,
    skillLetter: 'A',
  })!
  const started = performance.now()
  const course = setCourseOnPaper(
    terrain,
    sites,
    {
      target,
      format,
      printScale: printScaleFor('auto', format),
      competitionCentre: localPoint(centre[0], centre[1]),
      seed,
      paceSecondsPerKm: PACE_SECONDS_PER_KM,
    },
    'auto',
  )
  if (!course) return null
  const stops = [course.start.position, ...course.controls.map(s => s.position), course.finish]
  return {
    controls: course.controls.length,
    stops: stops.map(([x, y]) => [x, y] as const),
    printExtent: course.printArea?.extent ?? null,
    timeErrorPercent:
      (100 * (course.estimatedSeconds - course.targetSeconds)) / course.targetSeconds,
    findings: course.findings.length,
    searchSeconds: (performance.now() - started) / 1000,
  } satisfies SearchResult
}
