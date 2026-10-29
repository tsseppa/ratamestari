import { localPoint, type LocalPoint } from '@ratamestari/core'
import { REFERENCE_PACE_SECONDS_PER_KM } from '@ratamestari/rules'
import {
  FEATURELESS_SITE_ID,
  type ControlSiteCandidate,
  type TechnicalDifficulty,
} from './control-sites'
import {
  assembleCourse,
  evaluationFor,
  MAX_START_DIFFICULTY,
  type Course,
  type CourseContext,
  type CourseSpec,
  type Finding,
} from './course-search'
import { difficultyInCourse } from './flag-side'
import { isUsableInPrintArea } from './print-area'
import { routableCellOf } from './cost-grid'
import { findRoute } from './router'
import { siteAreaQualityOf, siteQuality } from './site-quality'
import type { Terrain } from './terrain'
import { secondsFrom } from './time-tree'

const SNAP_RADIUS_METERS = 60
const FIX_SEARCH_RADIUS_METERS = 400
const MIN_DIRECTED_MOVE_METERS = 30
const INSERT_SEARCH_MARGIN_METERS = 150
const MAX_INSERT_CANDIDATES = 40
const START_SEARCH_RADIUS_METERS = 2000
const SUGGESTION_CANDIDATES_PER_STOP = 12
const MIN_SUGGESTION_GAIN = 1e-6

export const COMPASS_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type CompassDirection = (typeof COMPASS_DIRECTIONS)[number]

const distanceBetween = (a: LocalPoint, b: LocalPoint) => Math.hypot(b[0] - a[0], b[1] - a[1])

function editingContext(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  finish: LocalPoint,
  pool: readonly ControlSiteCandidate[],
): CourseContext {
  const { grid } = terrain
  const pace = spec.paceSecondsPerKm ?? REFERENCE_PACE_SECONDS_PER_KM.value
  const toFinishGrid = secondsFrom(grid, finish, pace, Number.POSITIVE_INFINITY)
  const toFinish = Float32Array.from(pool, site => {
    const cell = routableCellOf(grid, site.position)
    return cell === null ? Number.POSITIVE_INFINITY : toFinishGrid[cell]!
  })
  const quality = Float32Array.from(
    pool,
    siteAreaQualityOf(sites, siteQuality(sites, terrain, spec.training)),
  )
  const legCache = new Map<string, number>()
  const legSeconds = (from: number, to: number) => {
    const key = from < to ? `${from},${to}` : `${to},${from}`
    const cached = legCache.get(key)
    if (cached !== undefined) return cached
    const route = findRoute(grid, pool[from]!.position, pool[to]!.position, {
      paceSecondsPerKm: pace,
    })
    const seconds = route?.timeSeconds ?? Number.POSITIVE_INFINITY
    legCache.set(key, seconds)
    return seconds
  }
  const { evaluation } = evaluationFor(terrain, spec, pool, finish, toFinish, legSeconds, quality)
  return {
    terrain,
    spec,
    pool,
    finish,
    targetSeconds: spec.target.winningTime.targetMinutes * 60,
    evaluation,
  }
}

const controlOrder = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

// Local frame: y points to map north.
export function compassDirection(from: LocalPoint, to: LocalPoint): CompassDirection {
  const degrees = (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI
  return COMPASS_DIRECTIONS[Math.round(((degrees + 360) % 360) / 45) % 8]!
}

const liesTowards = (from: LocalPoint, to: LocalPoint, direction: CompassDirection) =>
  distanceBetween(from, to) >= MIN_DIRECTED_MOVE_METERS && compassDirection(from, to) === direction

const onPaper = (spec: CourseSpec, site: ControlSiteCandidate) =>
  !spec.printArea || isUsableInPrintArea(site.position, spec.printArea)

const courseSiteIds = (course: Course) =>
  new Set([course.start.id, ...course.controls.map(site => site.id)])

export function recheckCourse(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  { start, controls, finish }: Pick<Course, 'start' | 'controls' | 'finish'>,
): Course {
  const context = editingContext(terrain, sites, spec, finish, [start, ...controls])
  const checked = assembleCourse(context, 0, controlOrder(controls.length), true)
  const withoutFeature = controls.flatMap((site, i) => (isFeatureless(site) ? [i + 1] : []))
  if (withoutFeature.length === 0) return checked
  const findings: Finding[] = withoutFeature.map(stop => ({
    kind: 'controlsWithoutFeature',
    stops: [stop],
  }))
  return {
    ...checked,
    problems: { ...checked.problems, controlsWithoutFeature: withoutFeature.length },
    findings: [...checked.findings, ...findings],
  }
}

export const isFeatureless = (site: ControlSiteCandidate) => site.isomCode === ''

// Without a feature the control cannot be described; its difficulty is taken as the class's
// highest so that it raises no difficulty finding of its own.
export function featurelessSite(
  position: LocalPoint,
  difficulty: TechnicalDifficulty,
): ControlSiteCandidate {
  return {
    id: FEATURELESS_SITE_ID,
    position,
    isomCode: '',
    symbolNumber: 0,
    placement: 'point',
    contourForm: null,
    distanceToLeadingFeatureMeters: 0,
    leadingFeatureDistance: 'far',
    inSlowTerrain: false,
    technicalDifficulty: difficulty,
    orientation: null,
    similarFeatureOffsets: [],
    flagSide: null,
  }
}

// A clicked point snaps to a nearby control site as a dragged control does; with none near, the
// control stays where it was clicked and is flagged as having no feature to describe.
export function siteForPoint(
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  position: LocalPoint,
): ControlSiteCandidate {
  return (
    nearestSite(sites, position) ??
    featurelessSite(position, spec.target.siteDifficulty[1] as TechnicalDifficulty)
  )
}

export function startCourse(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  start: LocalPoint,
  finish: LocalPoint,
): Course {
  return recheckCourse(terrain, sites, spec, {
    start: siteForPoint(sites, spec, start),
    controls: [],
    finish,
  })
}

// afterStopIndex 0 puts the new control first; the number of controls puts it last.
export function insertControlAt(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  afterStopIndex: number,
  point: LocalPoint,
): Course | null {
  if (afterStopIndex < 0 || afterStopIndex > course.controls.length) return null
  const controls = [...course.controls]
  controls.splice(afterStopIndex, 0, siteForPoint(sites, spec, point))
  return recheckCourse(terrain, sites, spec, { ...course, controls })
}

export const addControl = (
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  point: LocalPoint,
): Course => insertControlAt(terrain, sites, spec, course, course.controls.length, point)!

export const setFinish = (
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  point: LocalPoint,
): Course => recheckCourse(terrain, sites, spec, { ...course, finish: point })

export function nearestSite(
  sites: readonly ControlSiteCandidate[],
  position: LocalPoint,
  withinMeters = SNAP_RADIUS_METERS,
): ControlSiteCandidate | null {
  let best: ControlSiteCandidate | null = null
  let bestDistance = withinMeters
  for (const site of sites) {
    const distance = distanceBetween(site.position, position)
    if (distance <= bestDistance) {
      best = site
      bestDistance = distance
    }
  }
  return best
}

export function moveControl(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  stopIndex: number,
  to: LocalPoint,
): Course | null {
  const site = nearestSite(sites, to)
  if (!site) return null
  const moved =
    stopIndex === 0
      ? { ...course, start: site }
      : { ...course, controls: course.controls.map((c, i) => (i === stopIndex - 1 ? site : c)) }
  return recheckCourse(terrain, sites, spec, moved)
}

export type ReplacementPreference = 'best' | 'harder' | 'easier'

export function fixControl(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  controlNumber: number,
  preference: ReplacementPreference = 'best',
  direction: CompassDirection | null = null,
): Course {
  const current = course.controls[controlNumber - 1]
  if (!current) return course
  const maxDifficulty = spec.target.siteDifficulty[1]
  const currentDifficulty = difficultyInCourse(current, maxDifficulty)
  const suitsPreference = (site: ControlSiteCandidate) => {
    const difficulty = difficultyInCourse(site, maxDifficulty)
    if (preference === 'harder') return difficulty > currentDifficulty
    if (preference === 'easier') return difficulty < currentDifficulty
    return true
  }
  const inCourse = courseSiteIds(course)
  const candidates = sites.filter(
    site =>
      !inCourse.has(site.id) &&
      suitsPreference(site) &&
      onPaper(spec, site) &&
      distanceBetween(site.position, current.position) <= FIX_SEARCH_RADIUS_METERS &&
      (!direction || liesTowards(current.position, site.position, direction)),
  )
  const pool = [course.start, ...course.controls, ...candidates]
  const context = editingContext(terrain, sites, spec, course.finish, pool)
  const order = controlOrder(course.controls.length)
  let bestOrder = order
  // A harder, easier or moved control is wanted even if the rules score it a little worse.
  let bestScore =
    preference === 'best' && !direction
      ? context.evaluation.score(0, order).score
      : Number.POSITIVE_INFINITY
  candidates.forEach((_, i) => {
    const replaced = order.map((poolIndex, k) =>
      k === controlNumber - 1 ? course.controls.length + 1 + i : poolIndex,
    )
    const { score } = context.evaluation.score(0, replaced)
    if (score < bestScore) {
      bestScore = score
      bestOrder = replaced
    }
  })
  return assembleCourse(context, 0, bestOrder, true)
}

export function removeControl(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  controlNumber: number,
): Course | null {
  if (controlNumber < 1 || controlNumber > course.controls.length) return null
  const controls = course.controls.filter((_, i) => i !== controlNumber - 1)
  return recheckCourse(terrain, sites, spec, { ...course, controls })
}

// afterStop 0 is the start, k is control k: the new control goes on the leg that leaves it.
export function insertControl(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  afterStop: number,
): Course | null {
  if (afterStop < 0 || afterStop > course.controls.length) return null
  const stops = [course.start.position, ...course.controls.map(site => site.position)]
  const from = stops[afterStop]!
  const to = stops[afterStop + 1] ?? course.finish
  const middle = localPoint((from[0] + to[0]) / 2, (from[1] + to[1]) / 2)
  const radius = distanceBetween(from, to) / 2 + INSERT_SEARCH_MARGIN_METERS
  const inCourse = courseSiteIds(course)
  const candidates = sites
    .filter(
      site =>
        !inCourse.has(site.id) &&
        onPaper(spec, site) &&
        distanceBetween(site.position, middle) <= radius,
    )
    .sort((a, b) => distanceBetween(a.position, middle) - distanceBetween(b.position, middle))
    .slice(0, MAX_INSERT_CANDIDATES)
  if (candidates.length === 0) return null
  const pool = [course.start, ...course.controls, ...candidates]
  const context = editingContext(terrain, sites, spec, course.finish, pool)
  const order = controlOrder(course.controls.length)
  let bestOrder: number[] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  candidates.forEach((_, i) => {
    const inserted = [...order.slice(0, afterStop), order.length + 1 + i, ...order.slice(afterStop)]
    const { score } = context.evaluation.score(0, inserted)
    if (score < bestScore) {
      bestScore = score
      bestOrder = inserted
    }
  })
  return bestOrder ? assembleCourse(context, 0, bestOrder, true) : null
}

export interface StartWish {
  readonly distanceFromFinishMeters?: readonly [number, number]
  readonly direction?: CompassDirection
}

export function moveStart(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  { distanceFromFinishMeters, direction }: StartWish,
): Course | null {
  const inCourse = courseSiteIds(course)
  const fitsDistance = (site: ControlSiteCandidate) => {
    const distance = distanceBetween(site.position, course.finish)
    return distanceFromFinishMeters
      ? distance >= distanceFromFinishMeters[0] && distance <= distanceFromFinishMeters[1]
      : distance <= START_SEARCH_RADIUS_METERS
  }
  const fitting = sites.filter(
    site =>
      !inCourse.has(site.id) &&
      onPaper(spec, site) &&
      fitsDistance(site) &&
      (!direction || liesTowards(course.start.position, site.position, direction)),
  )
  const clear = fitting.filter(site => site.technicalDifficulty <= MAX_START_DIFFICULTY)
  const candidates = clear.length > 0 ? clear : fitting
  if (candidates.length === 0) return null
  const pool = [...course.controls, ...candidates]
  const context = editingContext(terrain, sites, spec, course.finish, pool)
  const order = course.controls.map((_, i) => i)
  let bestStart = -1
  let bestScore = Number.POSITIVE_INFINITY
  candidates.forEach((_, i) => {
    const startIndex = course.controls.length + i
    const { score } = context.evaluation.score(startIndex, order)
    if (score < bestScore) {
      bestScore = score
      bestStart = startIndex
    }
  })
  return bestStart === -1 ? null : assembleCourse(context, bestStart, order, true)
}

export type SuggestionKind = 'replace' | 'remove' | 'insert'

export interface CourseSuggestion {
  readonly kind: SuggestionKind
  // The control replaced or removed, or for an insert the stop the new leg leaves (0 = start).
  readonly stop: number
  readonly course: Course
  // How much better the course scores by the rules; larger is better.
  readonly scoreGain: number
}

export function suggestChanges(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  course: Course,
  limit = 5,
): CourseSuggestion[] {
  const inCourse = courseSiteIds(course)
  const usable = sites.filter(site => !inCourse.has(site.id) && onPaper(spec, site))
  const nearest = (point: LocalPoint, withinMeters: number) =>
    usable
      .filter(site => distanceBetween(site.position, point) <= withinMeters)
      .sort((a, b) => distanceBetween(a.position, point) - distanceBetween(b.position, point))
      .slice(0, SUGGESTION_CANDIDATES_PER_STOP)
  const stops = [course.start.position, ...course.controls.map(site => site.position)]
  const legEnds = stops.map((from, i) => [from, stops[i + 1] ?? course.finish] as const)
  const replacementsFor = course.controls.map(site =>
    nearest(site.position, FIX_SEARCH_RADIUS_METERS),
  )
  const insertsFor = legEnds.map(([from, to]) =>
    nearest(
      localPoint((from[0] + to[0]) / 2, (from[1] + to[1]) / 2),
      distanceBetween(from, to) / 2 + INSERT_SEARCH_MARGIN_METERS,
    ),
  )

  const pool: ControlSiteCandidate[] = [course.start, ...course.controls]
  const poolIndexOf = new Map<number, number>()
  const indexOf = (site: ControlSiteCandidate) => {
    let index = poolIndexOf.get(site.id)
    if (index === undefined) {
      index = pool.push(site) - 1
      poolIndexOf.set(site.id, index)
    }
    return index
  }
  const replacementIndices = replacementsFor.map(candidates => candidates.map(indexOf))
  const insertIndices = insertsFor.map(candidates => candidates.map(indexOf))
  const context = editingContext(terrain, sites, spec, course.finish, pool)
  const order = controlOrder(course.controls.length)
  const baseScore = context.evaluation.score(0, order).score

  const tried: { kind: SuggestionKind; stop: number; order: number[]; score: number }[] = []
  const keepBest = (kind: SuggestionKind, stop: number, orders: number[][]) => {
    let best: { order: number[]; score: number } | null = null
    for (const candidate of orders) {
      const { score } = context.evaluation.score(0, candidate)
      if (!best || score < best.score) best = { order: candidate, score }
    }
    if (best) tried.push({ kind, stop, ...best })
  }
  order.forEach((_, k) => {
    keepBest(
      'replace',
      k + 1,
      replacementIndices[k]!.map(index => order.map((p, j) => (j === k ? index : p))),
    )
    if (order.length > 2) keepBest('remove', k + 1, [order.filter((_, j) => j !== k)])
  })
  insertIndices.forEach((indices, afterStop) =>
    keepBest(
      'insert',
      afterStop,
      indices.map(index => [...order.slice(0, afterStop), index, ...order.slice(afterStop)]),
    ),
  )

  return tried
    .map(change => ({ ...change, scoreGain: baseScore - change.score }))
    .filter(change => change.scoreGain > MIN_SUGGESTION_GAIN)
    .sort((a, b) => b.scoreGain - a.scoreGain)
    .slice(0, limit)
    .map(({ kind, stop, order: changed, scoreGain }) => ({
      kind,
      stop,
      scoreGain,
      course: assembleCourse(context, 0, changed, true),
    }))
}
