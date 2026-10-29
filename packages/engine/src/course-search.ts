import type { LocalPoint } from '@ratamestari/core'
import {
  ACUTE_ANGLE,
  COURSE_LINE_CROSSING,
  COURSE_SHAPE,
  FOREST_CONTROL_SPACING,
  TECHNICAL_AREAS,
  SECTION_FILL,
  controlSpacingForScale,
  REFERENCE_PACE_SECONDS_PER_KM,
  type CourseTarget,
  type Format,
  type ScoreTermName,
  type TrainingRules,
  expectedTrainingLegCount,
} from '@ratamestari/rules'
import type { ControlSiteCandidate, TechnicalDifficulty } from './control-sites'
import { difficultyInCourse, flagSideFor, type FlagSide } from './flag-side'
import { measureCourse } from './course-length'
import { findRoute } from './router'
import {
  alternation,
  closeness,
  crossingSeverity,
  crowding,
  crowdingCounts,
  legCount,
  parallelLegs,
  routeDoglegOverlaps,
  directionChanges,
  firstLegTowardsFinish,
  legLengthDistribution,
  mappedAreaWithin,
  reversals,
  ring,
  spread,
  type Metric,
} from './course-metrics'
import {
  isUsableInPrintArea,
  lineCrossesExtent,
  reservedBoxesOf,
  stopsOutsideFrame,
  type PaperBoxSize,
  type PrintArea,
  type PrintFrame,
} from './print-area'
import { findTechnicalAreas, type TechnicalArea } from './areas'
import { courseProfileOf, templateOf } from './course-profile'
import {
  angleAt,
  CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS,
  fillSection,
  FINISH_OUTER_CIRCLE_FOOTPRINT_RADIUS_METERS,
} from './section-fill'
import {
  fillAroundLocks,
  hasLocks,
  keepsLocks,
  withLockedSites,
  type CourseLocks,
  type LockedStops,
} from './locks'
import { planSkeleton, planSkeletonSteps, type Skeleton } from './skeleton'
import { siteAreaQualityOf, siteQuality, type SiteQualityOf } from './site-quality'
import { distanceToSegment, isInsidePolygon, segmentsCross } from './polyline'
import { BLOCKED, routableCellOf, type CostGrid } from './cost-grid'
import { seededRandom, type Random } from './random'
import { cellCenterOf, cellIndexOf } from './raster'
import type { Terrain } from './terrain'
import { secondsFrom, secondsUntil } from './time-tree'

export interface CourseSpec {
  readonly target: CourseTarget
  readonly format: Format
  readonly printScale: number
  readonly competitionCentre: LocalPoint
  readonly seed: number
  readonly paceSecondsPerKm?: number
  readonly improvementSteps?: number
  readonly printArea?: PrintArea
  // Placed by the user; when given, the course is set inside it and the paper is not moved.
  readonly printFrame?: PrintFrame
  readonly peripheralSize?: PaperBoxSize | null
  // The user's wish for the start, as straight-line metres from the finish.
  readonly startDistanceFromFinishMeters?: readonly [number, number] | null
  readonly locks?: CourseLocks | null
  readonly training?: TrainingRules | null
}

const technicalAreaRuleOf = (spec: CourseSpec) =>
  spec.training?.technicalAreas ?? TECHNICAL_AREAS[spec.format]

export interface Finding {
  readonly kind: keyof CourseProblems
  readonly stops: readonly number[]
}

export interface CourseProblems {
  readonly spacing: number
  readonly acuteAngleWarnings: number
  readonly acuteAngleNotes: number
  readonly difficultyOutsideRange: number
  readonly courseLineCrossings: number
  readonly courseLinesThroughControls: number
  readonly courseLinesOutsideMap: number
  readonly courseLinesOverDescriptions: number
  readonly stopsOutsidePrintArea: number
  readonly overlappingCircles: number
  readonly finalLegTooLong: boolean
  readonly winningTimeOutsideRange: boolean
  readonly controlsWithoutFeature: number
}

export interface Course {
  readonly seed: number
  readonly start: ControlSiteCandidate
  readonly controls: readonly ControlSiteCandidate[]
  readonly finish: LocalPoint
  readonly legSeconds: readonly number[]
  readonly estimatedSeconds: number
  readonly targetSeconds: number
  readonly controlDifficulties: readonly TechnicalDifficulty[]
  readonly flagSides: readonly (FlagSide | null)[]
  readonly lengthMeters: number | null
  readonly climbMeters: number | null
  readonly printArea: PrintArea | null
  readonly problems: CourseProblems
  readonly findings: readonly Finding[]
  readonly breakdown: ScoreBreakdown
  readonly score: number
}

interface LegProfile {
  readonly longLegShare: number
  readonly longLeg: readonly [number, number]
  readonly shortLeg: readonly [number, number]
}

const LEG_PROFILES: Readonly<Record<Format, LegProfile>> = {
  long: { longLegShare: 0.3, longLeg: [0.06, 0.12], shortLeg: [0.015, 0.04] },
  middle: { longLegShare: 0, longLeg: [0.02, 0.07], shortLeg: [0.02, 0.07] },
}
export function expectedControlCount(spec: Pick<CourseSpec, 'format' | 'training'>): number {
  if (spec.training) return expectedTrainingLegCount(spec.training)
  const { longLegShare, longLeg, shortLeg } = LEG_PROFILES[spec.format]
  const mean = (range: readonly [number, number]) => (range[0] + range[1]) / 2
  const meanLegShare = longLegShare * mean(longLeg) + (1 - longLegShare) * mean(shortLeg)
  return Math.ceil(1 / meanLegShare)
}

const START_DISTANCE_FROM_FINISH: readonly [number, number] = [0.05, 0.2]
export const MAX_START_DIFFICULTY = 2
const MAX_SITE_DIFFICULTY = 5
const DEFAULT_IMPROVEMENT_STEPS: Readonly<Record<Format, number>> = { long: 800, middle: 400 }
const TREE_LIMIT_SHARE_OF_TARGET = 0.25
const SWAP_LEG_TIME_RANGE: readonly [number, number] = [0.5, 1.6]
const INSERT_LEG_TIME_RANGE: readonly [number, number] = [0.3, 1.2]
const TIME_TOLERANCE_SHARE = 0.02
const LENGTH_CHANGE_CHANCE = 0.3
const MIN_CONTROLS = 3
const MIN_CONTROL_SEPARATION_METERS = Math.max(
  FOREST_CONTROL_SPACING.minStraightMetersForSimilarSites,
  2 * CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS,
)
const FINISH_CLEARANCE_METERS =
  CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS + FINISH_OUTER_CIRCLE_FOOTPRINT_RADIUS_METERS
const FINAL_LEG_MAX_SHARE_OF_TARGET = 0.04
const REVERSE_SECTION_CHANCE = 0.25
const SHIFT_CHANCE = 0.4
const TARGET_FLAGGED_CONTROL_CHANCE = 0.5
const SHIFT_RADIUS_METERS = 150
const DOGLEG_REPAIR_RADIUS_METERS = 250
const HARD_RULE_REPAIR_RADIUS_METERS = 400
// A dogleg is worth giving up this much of the score to remove, but never a hard rule.
const DOGLEG_WORTH = 60
const MAX_KEY_LEGS = 4
const LONG_MIN_AREA_QUALITY = 0.3
const MAX_DRAFTS = 3
// Filling around kept controls is cheap next to planning a skeleton.
const MAX_LOCKED_DRAFTS = 8
// A start right beside a kept control would make the first leg trivial.
const LOCKED_START_CLEARANCE_METERS = 150
const IMPROVEMENT_STEPS_PER_PROGRESS = 25
const ANNEALING = { startTemperature: 5, endTemperature: 0.05, rebuildShare: 0.5 }
const WINDOW_CONTROLS: readonly [number, number] = [3, 6]
const WINDOW_SITES_BUFFER_METERS = 200
const WINDOW_EXTRA_CONTROLS = 2
const TARGET_FINDING_WINDOW_CHANCE = 0.5
const BRING_LAST_CONTROL_HOME_CHANCE = 0.5
const START_TOWARDS_WAYPOINT_PREFERENCE = 1
const NO_SITE = -1

// A search yields its progress, or null at a pause point. Whoever runs it can pause at any step
// and passes true to next() to stop: the search then returns its best course so far (D20).
export type SearchPhase = 'areas' | 'skeleton' | 'sections' | 'improving' | 'checking'
export interface SearchProgress {
  readonly phase: SearchPhase
  readonly done: number
  readonly total: number
}
export type SearchStep = SearchProgress | null
export type Search = Generator<SearchStep, Course | null, boolean | undefined>

export function runSearch(
  search: Search,
  onProgress: (progress: SearchProgress) => void = () => {},
) {
  for (let step = search.next(); ; step = search.next()) {
    if (step.done) return step.value
    if (step.value) onProgress(step.value)
  }
}

export function searchCourse(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  onProgress: (progress: SearchProgress) => void = () => {},
): Course | null {
  return runSearch(searchCourseSteps(terrain, sites, spec), onProgress)
}

export function* searchCourseSteps(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
): Search {
  const random = seededRandom(spec.seed)
  let stopped = Boolean(yield { phase: 'areas', done: 0, total: 1 })
  const prepared = prepareSearch(terrain, sites, spec)
  if (!prepared) return null
  const { grid } = terrain
  const { finish, targetSeconds, qualityOf, secondsToFinish, reachable } = prepared
  const pace = prepared.paceSecondsPerKm
  const withLocks = hasLocks(spec.locks) ? withLockedSites(plannerPool(prepared), spec.locks) : null
  const pool = withLocks?.pool ?? plannerPool(prepared)
  const locked = withLocks?.locked ?? null
  if (pool.length === 0) return null
  const planning = planningContextFor(terrain, spec, prepared, pool)
  const { evaluation } = planning
  const context: CourseContext = { terrain, spec, pool, finish, targetSeconds, evaluation }
  let startIndex = NO_SITE
  let order: readonly number[] = []
  let best: ScoredCourse | null = null
  let anchors: ReadonlySet<number> = new Set()
  if (locked) {
    // Kept controls replace the plan: the stretches between them are filled instead (D15).
    anchors = new Set(locked.controls)
    const drafts = stopped ? 1 : MAX_LOCKED_DRAFTS
    for (let k = 0; k < drafts; k++) {
      stopped = Boolean(yield { phase: 'sections', done: k, total: drafts }) || stopped
      if (stopped && best) break
      const start =
        locked.start ??
        planning.pickStart(
          locked.controls.slice(0, 1).map(i => pool[i]!.position),
          i =>
            anchors.has(i) ||
            locked.controls.some(
              kept =>
                distanceBetween(pool[i]!.position, pool[kept]!.position) <
                LOCKED_START_CLEARANCE_METERS,
            ),
          random,
        )
      const scored = evaluation.score(
        start,
        fillAroundLocks(
          planning,
          locked,
          start,
          FINAL_LEG_MAX_SHARE_OF_TARGET * targetSeconds,
          random,
        ),
      )
      if (!best || scored.score < best.score) {
        best = scored
        startIndex = start
        order = scored.order
      }
    }
  } else {
    const areas = findTechnicalAreas(
      pool,
      planning.quality,
      technicalAreaRuleOf(spec),
      grid,
      planning.paceSecondsPerKm,
    )
    const usable = mappedAreaWithin(terrain, spec.printArea?.extent ?? null)
    const planningSkeletons = planSkeletonSteps(planning, areas, usable, random)
    let skeletons: readonly Skeleton[] = []
    for (let step = planningSkeletons.next(stopped); ; step = planningSkeletons.next(stopped)) {
      if (step.done) {
        skeletons = step.value
        break
      }
      stopped = Boolean(yield step.value) || stopped
    }
    const drafts = skeletons.slice(0, stopped ? 1 : MAX_DRAFTS)
    for (const [k, skeleton] of drafts.entries()) {
      stopped = Boolean(yield { phase: 'sections', done: k, total: drafts.length }) || stopped
      if (stopped && best) break
      const draft = fillSkeleton(planning, skeleton, areas, random)
      const scored = evaluation.score(skeleton.start, draft)
      if (!best || scored.score < best.score) {
        best = scored
        startIndex = skeleton.start
        order = draft
        anchors = new Set(skeleton.connectingLegs.flatMap(leg => [leg.from, leg.to]))
      }
    }
  }
  if (!best) return null

  // Simulated annealing: half the moves rebuild a window of controls with the section fill,
  // the rest are single-control changes. Worse courses are accepted with a chance that falls
  // as the search cools, so it can climb out of a tangle; the best course seen is kept.
  const steps = spec.improvementSteps ?? DEFAULT_IMPROVEMENT_STEPS[spec.format]
  const { startTemperature, endTemperature, rebuildShare } = ANNEALING
  let current = best
  for (let step = 0; step < steps && !stopped; step++) {
    const reportsProgress = step % IMPROVEMENT_STEPS_PER_PROGRESS === 0
    stopped = Boolean(
      yield reportsProgress ? { phase: 'improving', done: step, total: steps } : null,
    )
    if (stopped) break
    const rebuilds = random.next() < rebuildShare
    const candidate = rebuilds
      ? rebuildWindow(planning, startIndex, current, anchors, random)
      : proposeChange(
          startIndex,
          current.order,
          pool,
          planning.toFinish,
          planning.timesFrom,
          current,
          finish,
          random,
          anchors,
        )
    if (!candidate || [...anchors].some(anchor => !candidate.includes(anchor))) continue
    if (locked && !keepsLocks(locked, candidate)) continue
    const scored = evaluation.score(startIndex, candidate)
    if (!rebuilds && addsLineProblems(current.problems, scored.problems)) continue
    const temperature = startTemperature * (endTemperature / startTemperature) ** (step / steps)
    const worsening = scored.score - current.score
    if (worsening < 0 || random.next() < Math.exp(-worsening / temperature)) current = scored
    if (current.score < best.score) best = current
  }
  order = best.order
  if (!stopped) yield { phase: 'checking', done: 0, total: 1 }
  const kept = keptSites(locked)
  const cleared = repairHardRules(startIndex, best, pool, evaluation, kept)
  const repaired = repairDoglegs(startIndex, cleared, pool, finish, grid, pace, evaluation, kept)
  if (repaired !== best.order) best = evaluation.score(startIndex, repaired)
  return assembleCourse(context, startIndex, best.order, true)
}

const keptSites = (locked: LockedStops | null): ReadonlySet<number> =>
  new Set(locked ? [...locked.controls, ...(locked.start === null ? [] : [locked.start])] : [])

// Sites in usable terrain, plus any site near the finish for the run-in: weak terrain far from
// the finish never holds a control, but connecting legs may cross it.
function plannerPool({ reachable, qualityOf, secondsToFinish, targetSeconds }: PreparedSearch) {
  return reachable.filter(
    site =>
      qualityOf(site) >= LONG_MIN_AREA_QUALITY ||
      secondsToFinish(site) <= FINAL_LEG_MAX_SHARE_OF_TARGET * targetSeconds,
  )
}

// Sets every section of the skeleton in course order and returns the course's controls.
function fillSkeleton(
  context: PlanningContext,
  skeleton: Skeleton,
  areas: readonly TechnicalArea[],
  random: Random,
): number[] {
  const { pool, toFinish } = context
  const positionOf = (i: number) => pool[i]!.position
  const anchors = [
    skeleton.start,
    ...skeleton.connectingLegs.flatMap(leg => [leg.from, leg.to]),
    ...skeleton.sections.flatMap(section => (section.exit === 'finish' ? [] : [section.exit])),
  ]
  const connecting = skeleton.connectingLegs.map(
    leg => [positionOf(leg.from), positionOf(leg.to)] as const,
  )
  const order: number[] = []
  const filledLegs: (readonly [LocalPoint, LocalPoint])[] = []
  const used = new Set(anchors)
  skeleton.sections.forEach((section, k) => {
    if (section.entry !== skeleton.start && order[order.length - 1] !== section.entry) {
      order.push(section.entry)
    }
    const allowed =
      section.area === null
        ? pool.flatMap((_, i) => (toFinish[i]! <= section.budgetSeconds ? [i] : []))
        : sitesNearArea(pool, areas[section.area]!)
    const next = skeleton.connectingLegs[k]
    const fill = fillSection(
      context,
      {
        entry: section.entry,
        exit: section.exit,
        budgetSeconds: section.budgetSeconds,
        allowed,
        legBandMetres: section.legBandMetres,
        ...(context.spec.training &&
          section.entry === skeleton.start && {
            firstLegMaxMetres: templateOf(context.spec).connectingLegMetres[1],
          }),
        fixedStops: [...new Set([...anchors, ...order])]
          .filter(i => i !== section.entry)
          .map(positionOf),
        fixedLegs: [...connecting, ...filledLegs],
        usedSites: used,
        afterExit:
          next && section.exit === next.from && skeleton.sections[k + 1]?.area !== null
            ? positionOf(next.to)
            : null,
      },
      random,
    )
    const stops = [
      positionOf(section.entry),
      ...fill.controls.map(positionOf),
      section.exit === 'finish' ? context.finish : positionOf(section.exit),
    ]
    stops.slice(1).forEach((stop, j) => filledLegs.push([stops[j]!, stop]))
    for (const control of fill.controls) {
      order.push(control)
      used.add(control)
    }
    if (section.exit !== 'finish' && order[order.length - 1] !== section.exit) {
      order.push(section.exit)
    }
  })
  return order
}

function sitesNearArea(pool: readonly ControlSiteCandidate[], area: TechnicalArea): number[] {
  const buffer = SECTION_FILL.areaBufferMetres
  const hull = area.hull
  const isNear = (point: LocalPoint) =>
    isInsidePolygon(point, hull) ||
    hull.some(
      (corner, k) => distanceToSegment(point, corner, hull[(k + 1) % hull.length]!) <= buffer,
    )
  return pool.flatMap((site, i) => (isNear(site.position) ? [i] : []))
}

interface PreparedSearch {
  readonly finish: LocalPoint
  readonly targetSeconds: number
  readonly paceSecondsPerKm: number
  readonly toFinishGrid: Float32Array
  readonly qualityOf: SiteQualityOf
  readonly secondsToFinish: (site: ControlSiteCandidate) => number
  // Sites on the usable paper within half the winning time of the finish.
  readonly reachable: readonly ControlSiteCandidate[]
}

function prepareSearch(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
): PreparedSearch | null {
  const { grid } = terrain
  const paceSecondsPerKm = spec.paceSecondsPerKm ?? REFERENCE_PACE_SECONDS_PER_KM.value
  const targetSeconds = spec.target.winningTime.targetMinutes * 60
  const finish = nearestOpenPoint(grid, spec.competitionCentre)
  if (!finish) return null
  const toFinishGrid = secondsFrom(grid, finish, paceSecondsPerKm, Number.POSITIVE_INFINITY)
  const secondsToFinish = (site: ControlSiteCandidate) => {
    const index = routableCellOf(grid, site.position)
    return index === null ? Number.POSITIVE_INFINITY : toFinishGrid[index]!
  }
  const { printArea } = spec
  const reachable = sites.filter(
    site =>
      (!printArea || isUsableInPrintArea(site.position, printArea)) &&
      secondsToFinish(site) <= targetSeconds / 2,
  )
  return {
    finish,
    targetSeconds,
    paceSecondsPerKm,
    toFinishGrid,
    qualityOf: siteAreaQualityOf(sites, siteQuality(sites, terrain, spec.training)),
    secondsToFinish,
    reachable,
  }
}

// Everything the planner and the search need to know about a pool of candidate sites, with
// time trees built on demand and cached.
export interface PlanningContext {
  readonly terrain: Terrain
  readonly spec: CourseSpec
  readonly pool: readonly ControlSiteCandidate[]
  readonly finish: LocalPoint
  readonly targetSeconds: number
  readonly paceSecondsPerKm: number
  readonly toFinish: Float32Array
  readonly quality: Float32Array
  // Bounded trees are much cheaper; a full tree, when there is one, serves every bound.
  readonly timesFrom: (
    poolIndex: number,
    limitSeconds?: number,
    targets?: readonly number[],
  ) => Float32Array
  readonly legSeconds: (from: number, to: number) => number
  readonly straightSeconds: (from: LocalPoint, to: LocalPoint) => number
  // straightSeconds between two pool sites, cached.
  readonly straightSecondsBetween: (from: number, to: number) => number
  readonly routeChoiceValue: (from: LocalPoint, to: LocalPoint, fastestSeconds: number) => number
  readonly isAllowedCourseLine: (from: LocalPoint, to: LocalPoint) => boolean
  readonly evaluation: ReturnType<typeof createEvaluation>
  readonly pickStart: (
    towards: readonly LocalPoint[],
    excluded: (poolIndex: number) => boolean,
    random: Random,
  ) => number
}

function planningContextFor(
  terrain: Terrain,
  spec: CourseSpec,
  { finish, targetSeconds, paceSecondsPerKm, toFinishGrid, qualityOf }: PreparedSearch,
  pool: readonly ControlSiteCandidate[],
): PlanningContext {
  const { grid } = terrain
  const poolCells = pool.map(site => routableCellOf(grid, site.position))
  const toFinish = Float32Array.from(poolCells, cell =>
    cell === null ? Number.POSITIVE_INFINITY : toFinishGrid[cell]!,
  )
  const quality = Float32Array.from(pool, qualityOf)
  const treeLimit = targetSeconds * TREE_LIMIT_SHARE_OF_TARGET
  const timesCache = new Map<number, Float32Array>()
  // A bounded tree is exact up to its limit, so it serves any smaller limit too.
  const boundedCache = new Map<number, { readonly limit: number; readonly times: Float32Array }>()
  const treeFrom = (poolIndex: number, limit: number, targets: readonly number[] = []) => {
    const targetCells = targets.flatMap(i => {
      const cell = poolCells[i]
      return cell === null || cell === undefined ? [] : [cell]
    })
    const tree = secondsUntil(grid, pool[poolIndex]!.position, paceSecondsPerKm, limit, targetCells)
    const times = Float32Array.from(poolCells, cell =>
      cell === null ? Number.POSITIVE_INFINITY : tree.seconds[cell]!,
    )
    return { limit: Math.min(limit, tree.exactUpTo), times }
  }
  // With `targets`, only their times need be exact, so the tree may stop once they are known.
  const timesFrom = (
    poolIndex: number,
    limitSeconds = treeLimit,
    targets?: readonly number[],
  ): Float32Array => {
    const cached = timesCache.get(poolIndex)
    if (cached) return cached
    if (limitSeconds >= treeLimit && !targets) {
      const { times } = treeFrom(poolIndex, treeLimit)
      timesCache.set(poolIndex, times)
      return times
    }
    const limit = Math.min(limitSeconds, treeLimit)
    const bounded = boundedCache.get(poolIndex)
    const covers = (tree: { readonly limit: number; readonly times: Float32Array }) =>
      tree.limit >= limit ||
      (targets !== undefined && targets.every(i => tree.times[i]! <= tree.limit))
    if (bounded && covers(bounded)) return bounded.times
    const tree = treeFrom(poolIndex, limit, targets)
    boundedCache.set(poolIndex, tree)
    return tree.times
  }
  const knownSeconds = (from: number, to: number): number | null => {
    const full = timesCache.get(from)
    if (full) return full[to]!
    const bounded = boundedCache.get(from)
    const seconds = bounded?.times[to]
    return bounded && seconds! <= bounded.limit ? seconds! : null
  }
  // Costs are symmetric, so a tree from either end gives a leg's time. Without one, a route
  // between the two ends is much cheaper than a new tree: improvement tries many new sites.
  const routeCache = new Map<string, number>()
  const straightCache = new Map<number, number>()
  const legSeconds = (from: number, to: number): number => {
    const known = knownSeconds(from, to) ?? knownSeconds(to, from)
    if (known !== null) return known
    const key = from < to ? `${from},${to}` : `${to},${from}`
    const cached = routeCache.get(key)
    if (cached !== undefined) return cached
    const seconds =
      findRoute(grid, pool[from]!.position, pool[to]!.position, { paceSecondsPerKm })
        ?.timeSeconds ?? Number.POSITIVE_INFINITY
    routeCache.set(key, seconds)
    return seconds
  }
  const { evaluation, isAllowedCourseLine, routeChoiceValue } = evaluationFor(
    terrain,
    spec,
    pool,
    finish,
    toFinish,
    legSeconds,
    quality,
  )
  return {
    terrain,
    spec,
    pool,
    finish,
    targetSeconds,
    paceSecondsPerKm,
    toFinish,
    quality,
    timesFrom,
    legSeconds,
    straightSeconds: (from, to) => straightLineSeconds(grid, from, to, paceSecondsPerKm),
    straightSecondsBetween: (from, to) => {
      const key = from * pool.length + to
      const cached = straightCache.get(key)
      if (cached !== undefined) return cached
      const seconds = straightLineSeconds(
        grid,
        pool[from]!.position,
        pool[to]!.position,
        paceSecondsPerKm,
      )
      straightCache.set(key, seconds)
      return seconds
    },
    routeChoiceValue,
    isAllowedCourseLine,
    evaluation,
    pickStart: (towards, excluded, random) =>
      pickStart(
        pool,
        toFinish,
        targetSeconds,
        towards,
        finish,
        spec.startDistanceFromFinishMeters ?? null,
        random,
        excluded,
      ),
  }
}

export interface CoursePlan {
  readonly context: PlanningContext
  readonly areas: readonly TechnicalArea[]
  readonly skeleton: Skeleton | null
}

// The section planner's view of a course (D19): technical areas and the skeleton joining them.
export function planCourse(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
): CoursePlan | null {
  const prepared = prepareSearch(terrain, sites, spec)
  if (!prepared) return null
  const pool = plannerPool(prepared)
  if (pool.length === 0) return null
  const context = planningContextFor(terrain, spec, prepared, pool)
  const areas = findTechnicalAreas(
    pool,
    context.quality,
    technicalAreaRuleOf(spec),
    terrain.grid,
    context.paceSecondsPerKm,
  )
  const usable = mappedAreaWithin(terrain, spec.printArea?.extent ?? null)
  return { context, areas, skeleton: planSkeleton(context, areas, usable, seededRandom(spec.seed)) }
}

export interface CourseContext {
  readonly terrain: Terrain
  readonly spec: CourseSpec
  readonly pool: readonly ControlSiteCandidate[]
  readonly finish: LocalPoint
  readonly targetSeconds: number
  readonly evaluation: ReturnType<typeof createEvaluation>
}

export function evaluationFor(
  terrain: Terrain,
  spec: CourseSpec,
  pool: readonly ControlSiteCandidate[],
  finish: LocalPoint,
  toFinish: Float32Array,
  legSeconds: (from: number, to: number) => number,
  quality: Float32Array,
) {
  const { grid } = terrain
  const { printArea } = spec
  const pace = spec.paceSecondsPerKm ?? REFERENCE_PACE_SECONDS_PER_KM.value
  const staysOnMap = (from: LocalPoint, to: LocalPoint) =>
    courseLineStaysOnMap(grid, terrain.mappedArea, from, to)
  const clearOfDescriptions = (from: LocalPoint, to: LocalPoint) =>
    !printArea || reservedBoxesOf(printArea).every(box => !lineCrossesExtent(from, to, box))
  const isAllowedCourseLine = (from: LocalPoint, to: LocalPoint) =>
    staysOnMap(from, to) && clearOfDescriptions(from, to)
  const routeChoiceValue = (from: LocalPoint, to: LocalPoint, fastestSeconds: number) =>
    routeChoiceValueOf(straightLineSeconds(grid, from, to, pace), fastestSeconds)
  const evaluation = createEvaluation(
    pool,
    spec,
    finish,
    toFinish,
    legSeconds,
    spec.target.winningTime.targetMinutes * 60,
    staysOnMap,
    clearOfDescriptions,
    quality,
    routeChoiceValue,
    mappedAreaWithin(terrain, printArea?.extent ?? null),
  )
  return { evaluation, isAllowedCourseLine, routeChoiceValue }
}

export function assembleCourse(
  { terrain, spec, pool, finish, targetSeconds, evaluation }: CourseContext,
  startIndex: number,
  order: readonly number[],
  withLength: boolean,
): Course {
  const scored = evaluation.score(startIndex, order)
  const stops = [startIndex, ...order].map(i => pool[i]!.position)
  const measured = withLength ? measureCourse(terrain, [...stops, finish]) : null
  const controls = order.map(i => pool[i]!)
  const maxDifficulty = spec.target.siteDifficulty[1]
  return {
    seed: spec.seed,
    start: pool[startIndex]!,
    controls,
    controlDifficulties: controls.map(site => difficultyInCourse(site, maxDifficulty)),
    flagSides: controls.map((site, i) => flagSideFor(site, stops[i]!, maxDifficulty)),
    finish,
    legSeconds: scored.legSeconds,
    estimatedSeconds: scored.estimatedSeconds,
    targetSeconds,
    lengthMeters: measured?.lengthMeters ?? null,
    climbMeters: measured?.climbMeters ?? null,
    printArea: spec.printArea ?? null,
    problems: scored.problems,
    findings: scored.findings,
    breakdown: scored.breakdown,
    score: scored.score,
  }
}

export interface ScoreTerm {
  readonly value: number
  readonly weight: number
  readonly contribution: number
  readonly note: string
}

export interface ScoreBreakdown {
  readonly total: number
  readonly terms: Readonly<Record<ScoreTermName, ScoreTerm>>
}

interface ScoredCourse {
  readonly order: readonly number[]
  readonly legSeconds: readonly number[]
  readonly estimatedSeconds: number
  readonly targetSeconds: number
  readonly problems: CourseProblems
  readonly breakdown: ScoreBreakdown
  readonly findings: readonly Finding[]
  readonly score: number
}

function createEvaluation(
  pool: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  finish: LocalPoint,
  toFinish: Float32Array,
  legSecondsBetween: (from: number, to: number) => number,
  targetSeconds: number,
  staysOnMap: (from: LocalPoint, to: LocalPoint) => boolean,
  clearOfDescriptions: (from: LocalPoint, to: LocalPoint) => boolean,
  quality: Float32Array,
  routeChoiceValue: (from: LocalPoint, to: LocalPoint, fastestSeconds: number) => number,
  usableAreaSquareMetres: number,
) {
  const spacing = controlSpacingForScale(spec.printScale)
  const {
    weights,
    quality: profile,
    crowding: crowdingRule,
    allowsCrossingLegs,
  } = courseProfileOf(spec)
  const [minDifficulty, maxDifficulty] = spec.target.siteDifficulty

  const score = (startIndex: number, order: readonly number[]): ScoredCourse => {
    const findings: Finding[] = []
    const found = (kind: Finding['kind'], ...stops: number[]) => findings.push({ kind, stops })
    const sequence = [startIndex, ...order]
    const legSeconds = [
      ...order.map((site, i) => legSecondsBetween(sequence[i]!, site)),
      toFinish[sequence[sequence.length - 1]!]!,
    ]
    const estimatedSeconds = legSeconds.reduce((sum, s) => sum + s, 0)

    let spacingProblems = 0
    for (let a = 0; a < sequence.length; a++) {
      for (let b = a + 1; b < sequence.length; b++) {
        const siteA = pool[sequence[a]!]!
        const siteB = pool[sequence[b]!]!
        const distance = distanceBetween(siteA.position, siteB.position)
        const minimum =
          siteA.isomCode === siteB.isomCode
            ? spacing.minStraightMetersForSimilarSites
            : spacing.minStraightMeters
        if (distance < minimum) {
          spacingProblems++
          found('spacing', a, b)
        }
      }
    }

    let acuteAngleWarnings = 0
    let acuteAngleNotes = 0
    const stops = [...sequence.map(i => pool[i]!.position), finish]
    for (let i = 1; i + 1 < stops.length; i++) {
      const angle = angleAt(stops[i - 1]!, stops[i]!, stops[i + 1]!)
      if (angle < ACUTE_ANGLE.warningBelowDegrees) {
        acuteAngleWarnings++
        found('acuteAngleWarnings', i)
      } else if (angle < ACUTE_ANGLE.noteBelowDegrees) {
        acuteAngleNotes++
        found('acuteAngleNotes', i)
      }
    }

    const keyLegValues = legSeconds
      .flatMap((seconds, i) =>
        seconds >= LEG_PROFILES.long.longLeg[0] * targetSeconds
          ? [routeChoiceValue(stops[i]!, stops[i + 1]!, seconds)]
          : [],
      )
      .sort((a, b) => b - a)
      .slice(0, MAX_KEY_LEGS)
    const routeChoiceTotal = keyLegValues.reduce((sum, value) => sum + value, 0)
    const meanQuality =
      order.length === 0 ? 0 : order.reduce((sum, i) => sum + quality[i]!, 0) / order.length
    let difficultyOutsideRange = 0
    order.forEach((site, i) => {
      const difficulty = difficultyInCourse(pool[site]!, maxDifficulty)
      if (difficulty < minDifficulty || difficulty > maxDifficulty) {
        difficultyOutsideRange++
        found('difficultyOutsideRange', i + 1)
      }
    })

    const crossings = courseLineCrossings(stops).map(([a, b]) => ({
      a,
      b,
      severity: crossingSeverity(stops[a]!, stops[a + 1]!, stops[b]!, stops[b + 1]!, stops),
    }))
    const badCrossings = allowsCrossingLegs
      ? []
      : crossings.filter(c => c.severity > COURSE_LINE_CROSSING.acceptableSeverity)
    badCrossings.forEach(({ a, b }) => found('courseLineCrossings', a, a + 1, b, b + 1))
    const crossingSeverityTotal = crossings.reduce((sum, c) => sum + c.severity, 0)
    const overlapping = overlappingCircles(stops)
    overlapping.forEach(([a, b]) => found('overlappingCircles', a, b))
    let courseLinesOutsideMap = 0
    let courseLinesOverDescriptions = 0
    for (let i = 0; i + 1 < stops.length; i++) {
      if (!staysOnMap(stops[i]!, stops[i + 1]!)) {
        courseLinesOutsideMap++
        found('courseLinesOutsideMap', i, i + 1)
      }
      if (!clearOfDescriptions(stops[i]!, stops[i + 1]!)) {
        courseLinesOverDescriptions++
        found('courseLinesOverDescriptions', i, i + 1)
      }
    }
    const stopsOutsidePrintArea = stopsOutsideFrame(stops, spec.printArea ?? null)
    stopsOutsidePrintArea.forEach(stop => found('stopsOutsidePrintArea', stop))
    const linesThroughControls = courseLinesThroughControls(stops)
    linesThroughControls.forEach(([leg, control]) =>
      found('courseLinesThroughControls', leg, leg + 1, control),
    )
    const finalLegShare = legSeconds[legSeconds.length - 1]! / targetSeconds
    const finalLegPercentOverLimit = Math.max(
      0,
      100 * (finalLegShare - FINAL_LEG_MAX_SHARE_OF_TARGET),
    )
    if (finalLegPercentOverLimit > 0) found('finalLegTooLong', stops.length - 2, stops.length - 1)

    const { minMinutes, maxMinutes } = spec.target.winningTime
    const outsideRangeSeconds = Math.max(
      0,
      minMinutes * 60 - estimatedSeconds,
      estimatedSeconds - maxMinutes * 60,
    )
    const outsideRangePercent = (100 * outsideRangeSeconds) / targetSeconds
    if (outsideRangePercent > 0) found('winningTimeOutsideRange', 0, sequence.length)
    const problems = {
      spacing: spacingProblems,
      acuteAngleWarnings,
      acuteAngleNotes,
      difficultyOutsideRange,
      courseLineCrossings: badCrossings.length,
      courseLinesThroughControls: linesThroughControls.length,
      courseLinesOutsideMap,
      courseLinesOverDescriptions,
      stopsOutsidePrintArea: stopsOutsidePrintArea.length,
      overlappingCircles: overlapping.length,
      finalLegTooLong: finalLegPercentOverLimit > 0,
      winningTimeOutsideRange: outsideRangePercent > 0,
      controlsWithoutFeature: 0,
    }
    const timeErrorPercent = (100 * Math.abs(estimatedSeconds - targetSeconds)) / targetSeconds
    const isUnreachable = !Number.isFinite(estimatedSeconds)
    const term = (name: ScoreTermName, value: number, note: string): ScoreTerm => ({
      value,
      weight: weights[name],
      contribution: value * weights[name],
      note,
    })
    const count = (n: number, what: string) => `${n} ${what}`
    const terms: Record<ScoreTermName, ScoreTerm> = {
      timeErrorPerPercent: term(
        'timeErrorPerPercent',
        timeErrorPercent,
        `estimated ${Math.round(estimatedSeconds / 60)} min, target ${Math.round(targetSeconds / 60)} min`,
      ),
      timeOutsideRangePerPercent: term(
        'timeOutsideRangePerPercent',
        outsideRangePercent,
        outsideRangePercent > 0
          ? `outside the class's ${minMinutes}–${maxMinutes} min`
          : `within ${minMinutes}–${maxMinutes} min`,
      ),
      spacing: term('spacing', spacingProblems, count(spacingProblems, 'pairs too close')),
      acuteAngleWarning: term(
        'acuteAngleWarning',
        acuteAngleWarnings,
        count(acuteAngleWarnings, 'sharp angles'),
      ),
      acuteAngleNote: term(
        'acuteAngleNote',
        acuteAngleNotes,
        count(acuteAngleNotes, 'angles under 60°'),
      ),
      difficultyOutsideRange: term(
        'difficultyOutsideRange',
        difficultyOutsideRange,
        count(difficultyOutsideRange, "controls off the class's difficulty"),
      ),
      courseLineCrossing: term(
        'courseLineCrossing',
        crossingSeverityTotal,
        `${crossings.length} crossings, ${badCrossings.length} near a control or at a shallow angle`,
      ),
      courseLineThroughControl: term(
        'courseLineThroughControl',
        linesThroughControls.length,
        count(linesThroughControls.length, 'lines through circles'),
      ),
      finalLegPerPercentOverLimit: term(
        'finalLegPerPercentOverLimit',
        finalLegPercentOverLimit,
        `last leg ${Math.round(finalLegShare * 100)}% of the winning time`,
      ),
      courseLineOutsideMap: term(
        'courseLineOutsideMap',
        courseLinesOutsideMap,
        count(courseLinesOutsideMap, 'lines off the map'),
      ),
      courseLineOverDescriptions: term(
        'courseLineOverDescriptions',
        courseLinesOverDescriptions,
        count(courseLinesOverDescriptions, 'lines under the descriptions'),
      ),
      overlappingCircles: term(
        'overlappingCircles',
        overlapping.length,
        count(overlapping.length, 'overlapping circles'),
      ),
      areaQuality: term(
        'areaQuality',
        -meanQuality,
        `mean terrain quality ${meanQuality.toFixed(2)}`,
      ),
      routeChoicePerKeyLeg: term(
        'routeChoicePerKeyLeg',
        -routeChoiceTotal,
        `route-choice value ${routeChoiceTotal.toFixed(1)} on the key legs`,
      ),
      ...shapeTerms(stops),
    }
    const total = Object.values(terms).reduce((sum, t) => sum + t.contribution, 0)
    // NaN would lose every comparison silently and freeze the search.
    const score = isUnreachable || Number.isNaN(total) ? Number.POSITIVE_INFINITY : total
    return {
      order,
      legSeconds,
      estimatedSeconds,
      targetSeconds,
      problems,
      breakdown: { total: score, terms },
      findings,
      score,
    }
  }

  const shapeTerms = (stops: readonly LocalPoint[]) => {
    const asTerm = (name: ScoreTermName, metric: Metric): ScoreTerm => ({
      value: metric.value,
      weight: weights[name],
      contribution: metric.value * weights[name],
      note: metric.note,
    })
    return {
      legCount: asTerm('legCount', legCount(stops, profile.legLengths)),
      parallelLegs: asTerm('parallelLegs', parallelLegs(stops)),
      closeness: asTerm('closeness', closeness(stops)),
      crowding: asTerm(
        'crowding',
        crowding(stops, crowdingRule.radiusMetres, crowdingRule.maxControls),
      ),
      reversals: asTerm('reversals', reversals(stops)),
      ring: asTerm('ring', ring(stops)),
      legLengths: asTerm('legLengths', legLengthDistribution(stops, profile.legLengths)),
      alternation: asTerm('alternation', alternation(stops)),
      directionChanges: asTerm(
        'directionChanges',
        directionChanges(
          stops,
          profile.directionChangeRateTarget,
          profile.directionChangeMinDegrees,
        ),
      ),
      firstLeg: asTerm('firstLeg', firstLegTowardsFinish(stops)),
      spread: asTerm('spread', spread(stops, usableAreaSquareMetres, profile.spreadTarget)),
    }
  }

  return { score }
}

function pickStart(
  pool: readonly ControlSiteCandidate[],
  toFinish: Float32Array,
  targetSeconds: number,
  towards: readonly LocalPoint[],
  finish: LocalPoint,
  wishedDistance: readonly [number, number] | null,
  random: Random,
  excluded: (poolIndex: number) => boolean = () => false,
): number {
  const [nearShare, farShare] = START_DISTANCE_FROM_FINISH
  const metresOutsideWish = (i: number) => {
    if (!wishedDistance) return 0
    const distance = distanceBetween(pool[i]!.position, finish)
    return Math.max(0, wishedDistance[0] - distance, distance - wishedDistance[1])
  }
  const fitsDistance = (i: number) =>
    wishedDistance
      ? metresOutsideWish(i) === 0
      : toFinish[i]! >= nearShare * targetSeconds && toFinish[i]! <= farShare * targetSeconds
  const reachable = (i: number) => Number.isFinite(toFinish[i]!) && !excluded(i)
  const sitesUpTo = (maxDifficulty: number) =>
    pool.flatMap((site, i) =>
      site.technicalDifficulty <= maxDifficulty && reachable(i) ? [i] : [],
    )
  const firstWaypoint = towards[0]
  const towardsFirstWaypoint = (site: ControlSiteCandidate) => {
    if (!firstWaypoint) return 0
    const ax = site.position[0] - finish[0]
    const ay = site.position[1] - finish[1]
    const bx = firstWaypoint[0] - finish[0]
    const by = firstWaypoint[1] - finish[1]
    return (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1)
  }
  const easy = sitesUpTo(MAX_START_DIFFICULTY)
  const inRange = easy.filter(fitsDistance)
  const pickable =
    inRange.length > 0 ? inRange : sitesUpTo(MAX_SITE_DIFFICULTY).filter(fitsDistance)
  if (pickable.length === 0) {
    // No site meets the user's wish, so the start comes as near to it as the map allows.
    if (!wishedDistance || easy.length === 0) return NO_SITE
    return easy.reduce((a, b) => (metresOutsideWish(b) < metresOutsideWish(a) ? b : a))
  }
  const preference = (i: number) =>
    START_TOWARDS_WAYPOINT_PREFERENCE * towardsFirstWaypoint(pool[i]!) + random.next()
  return pickable.reduce((a, b) => (preference(b) > preference(a) ? b : a))
}

function proposeChange(
  startIndex: number,
  order: readonly number[],
  pool: readonly ControlSiteCandidate[],
  toFinish: Float32Array,
  timesFrom: (poolIndex: number, limitSeconds?: number) => Float32Array,
  current: ScoredCourse,
  finish: LocalPoint,
  random: Random,
  anchors: ReadonlySet<number>,
): number[] | null {
  if (order.length === 0) {
    const fromStart = timesFrom(startIndex)
    const firstControls = pool.flatMap((_, i) =>
      i !== startIndex && Number.isFinite(fromStart[i]!) && Number.isFinite(toFinish[i]!)
        ? [i]
        : [],
    )
    const first = random.pick(firstControls)
    return first === undefined ? null : [first]
  }
  const used = new Set([startIndex, ...order])
  const isTooLong = current.estimatedSeconds > current.targetSeconds * (1 + TIME_TOLERANCE_SHARE)
  const isTooShort = current.estimatedSeconds < current.targetSeconds * (1 - TIME_TOLERANCE_SHARE)
  const flaggedPositions = current.findings
    .flatMap(finding => finding.stops)
    .map(stop => Math.min(stop, order.length) - 1)
    .filter(position => position >= 0)
  const position =
    flaggedPositions.length > 0 && random.next() < TARGET_FLAGGED_CONTROL_CHANCE
      ? random.pick(flaggedPositions)!
      : Math.floor(random.next() * order.length)

  if (current.problems.finalLegTooLong && random.next() < BRING_LAST_CONTROL_HOME_CHANCE) {
    const last = order.length - 1
    // A kept or anchored last control stays, and a control near the finish follows it.
    const keepsLast = anchors.has(order[last]!)
    const beforeLast = keepsLast ? order[last]! : last === 0 ? startIndex : order[last - 1]!
    const fromBeforeLast = timesFrom(beforeLast)
    const finalLegMax = FINAL_LEG_MAX_SHARE_OF_TARGET * current.targetSeconds
    const nearFinish = pool.flatMap((_, i) =>
      !used.has(i) && toFinish[i]! <= finalLegMax && Number.isFinite(fromBeforeLast[i]!) ? [i] : [],
    )
    const home = random.pick(nearFinish)
    if (home !== undefined) return [...order.slice(0, keepsLast ? last + 1 : last), home]
  }

  if (order.length >= 2 && random.next() < REVERSE_SECTION_CHANCE) {
    const end = position + 1 + Math.floor(random.next() * (order.length - position - 1))
    if (end > position) {
      return [
        ...order.slice(0, position),
        ...order.slice(position, end + 1).reverse(),
        ...order.slice(end + 1),
      ]
    }
  }

  if (isTooLong && order.length > MIN_CONTROLS && random.next() < LENGTH_CHANGE_CHANCE) {
    return order.filter((_, i) => i !== position)
  }

  const previous = position === 0 ? startIndex : order[position - 1]!
  const legSeconds = current.legSeconds[position]!
  // Only as far as the longest leg a swap or insert may make.
  let fromPreviousTree: Float32Array | null = null
  const fromPrevious = () =>
    (fromPreviousTree ??= timesFrom(
      previous,
      legSeconds * Math.max(SWAP_LEG_TIME_RANGE[1], INSERT_LEG_TIME_RANGE[1]),
    ))
  const stops = [startIndex, ...order].map(i => pool[i]!.position)
  const next = position + 1 < order.length ? pool[order[position + 1]!]!.position : finish
  // Legs that stay when the control at `position` is replaced (or a control inserted before it).
  const keepsClear = (candidate: LocalPoint, replacing: boolean) => {
    const before = stops[position]!
    const after = replacing ? next : (stops[position + 1] ?? finish)
    const skipFrom = position
    const skipTo = replacing ? position + 1 : position
    for (let k = 0; k + 1 < stops.length; k++) {
      if (k >= skipFrom && k <= skipTo) continue
      const a = stops[k]!
      const b = stops[k + 1]!
      const near = [...stops, candidate, finish]
      if (
        Math.max(
          crossingSeverity(a, b, before, candidate, near),
          crossingSeverity(a, b, candidate, after, near),
        ) > COURSE_LINE_CROSSING.acceptableSeverity
      ) {
        return false
      }
    }
    if (distanceBetween(candidate, finish) < FINISH_CLEARANCE_METERS) return false
    const replaced = replacing ? position + 1 : -1
    const tooClose = stops.some(
      (stop, k) =>
        k !== replaced && distanceBetween(stop, candidate) < MIN_CONTROL_SEPARATION_METERS,
    )
    if (tooClose) return false
    const sequence = [...stops, finish]
    const beforeThat = sequence[position - 1]
    const afterThat = sequence[replacing ? position + 3 : position + 2]
    const minimumAngle = ACUTE_ANGLE.noteBelowDegrees
    if (beforeThat && angleAt(beforeThat, before, candidate) < minimumAngle) return false
    if (angleAt(before, candidate, after) < minimumAngle) return false
    if (afterThat && angleAt(candidate, after, afterThat) < minimumAngle) return false
    return true
  }
  const candidatesWithin = (lowShare: number, highShare: number, replacing = true) =>
    pool.flatMap((site, i) => {
      const t = fromPrevious()[i]!
      return !used.has(i) &&
        t >= legSeconds * lowShare &&
        t <= legSeconds * highShare &&
        keepsClear(site.position, replacing)
        ? [i]
        : []
    })

  if (isTooShort && random.next() < LENGTH_CHANGE_CHANCE) {
    const inserted = random.pick(candidatesWithin(...INSERT_LEG_TIME_RANGE, false))
    if (inserted !== undefined)
      return [...order.slice(0, position), inserted, ...order.slice(position)]
  }

  if (random.next() < SHIFT_CHANCE) {
    const here = pool[order[position]!]!.position
    const nearby = pool.flatMap((site, i) =>
      !used.has(i) &&
      distanceBetween(site.position, here) <= SHIFT_RADIUS_METERS &&
      keepsClear(site.position, true)
        ? [i]
        : [],
    )
    const shifted = random.pick(nearby)
    if (shifted !== undefined) {
      const changed = [...order]
      changed[position] = shifted
      return changed
    }
  }

  const replacement = random.pick(candidatesWithin(...SWAP_LEG_TIME_RANGE))
  if (replacement === undefined) return null
  const changed = [...order]
  changed[position] = replacement
  return changed
}

// Refills a window of 3-6 consecutive controls (not connecting-leg endpoints) from the stop
// before it to the stop after it, in the time the window takes now. Windows with findings are
// picked more often.
function rebuildWindow(
  context: PlanningContext,
  startIndex: number,
  current: ScoredCourse,
  anchors: ReadonlySet<number>,
  random: Random,
): number[] | null {
  const { pool, finish } = context
  const order = current.order
  if (order.length < WINDOW_CONTROLS[0]) return null
  const length = Math.min(
    order.length,
    WINDOW_CONTROLS[0] + Math.floor(random.next() * (WINDOW_CONTROLS[1] - WINDOW_CONTROLS[0] + 1)),
  )
  const flagged = current.findings
    .flatMap(finding => finding.stops)
    .filter(stop => stop >= 1 && stop <= order.length)
  const centre =
    flagged.length > 0 && random.next() < TARGET_FINDING_WINDOW_CHANCE
      ? random.pick(flagged)! - 1
      : Math.floor(random.next() * order.length)
  const first = Math.max(0, Math.min(order.length - length, centre - Math.floor(length / 2)))
  const last = first + length - 1
  const window = order.slice(first, last + 1)
  if (window.some(site => anchors.has(site))) return null

  const positionOf = (i: number) => pool[i]!.position
  const stops = [startIndex, ...order]
  const entry = stops[first]!
  const exit = last + 1 < order.length ? order[last + 1]! : ('finish' as const)
  const stopPositions = [...stops.map(positionOf), finish]
  const budget = current.legSeconds.slice(first, last + 2).reduce((sum, s) => sum + s, 0)
  const around = [positionOf(entry), ...window.map(positionOf), stopPositions[last + 2]!]
  const [minX, minY, maxX, maxY] = [
    Math.min(...around.map(p => p[0])) - WINDOW_SITES_BUFFER_METERS,
    Math.min(...around.map(p => p[1])) - WINDOW_SITES_BUFFER_METERS,
    Math.max(...around.map(p => p[0])) + WINDOW_SITES_BUFFER_METERS,
    Math.max(...around.map(p => p[1])) + WINDOW_SITES_BUFFER_METERS,
  ]
  const kept = new Set([startIndex, ...order.filter((_, k) => k < first || k > last)])
  const allowed = pool.flatMap((site, i) => {
    const [x, y] = site.position
    return !kept.has(i) && x >= minX && x <= maxX && y >= minY && y <= maxY ? [i] : []
  })
  const outside = (k: number) => k < first || k > last + 1
  const fill = fillSection(
    context,
    {
      entry,
      exit,
      budgetSeconds: budget,
      allowed,
      legBandMetres: templateOf(context.spec).technicalLegMetres,
      fixedStops: stopPositions.filter((_, k) => k !== first && (k < first + 1 || k > last + 1)),
      fixedLegs: stopPositions
        .slice(1)
        .flatMap((stop, k) => (outside(k) ? [[stopPositions[k]!, stop] as const] : [])),
      usedSites: kept,
      afterExit: stopPositions[last + 3] ?? null,
      rebuildingControls: length + WINDOW_EXTRA_CONTROLS,
    },
    random,
  )
  if (fill.short) return null
  return [...order.slice(0, first), ...fill.controls, ...order.slice(last + 1)]
}

// Moves are not all checked for geometry, so never accept one that makes the course harder to read.
const addsLineProblems = (before: CourseProblems, after: CourseProblems) =>
  after.courseLineCrossings > before.courseLineCrossings ||
  after.courseLinesThroughControls > before.courseLinesThroughControls ||
  after.acuteAngleWarnings > before.acuteAngleWarnings

const HARD_RULES: ReadonlySet<Finding['kind']> = new Set(['spacing', 'overlappingCircles'])

// The random moves usually clear a broken hard rule, but not always; try every nearby site for
// each control involved before giving up.
function repairHardRules(
  startIndex: number,
  scored: ScoredCourse,
  pool: readonly ControlSiteCandidate[],
  evaluation: ReturnType<typeof createEvaluation>,
  kept: ReadonlySet<number>,
): readonly number[] {
  let current = scored
  const involved = new Set(
    current.findings
      .filter(finding => HARD_RULES.has(finding.kind))
      .flatMap(finding => finding.stops)
      .filter(stop => stop >= 1 && stop <= current.order.length),
  )
  for (const stop of involved) {
    const position = stop - 1
    if (kept.has(current.order[position]!)) continue
    const here = pool[current.order[position]!]!.position
    const used = new Set([startIndex, ...current.order])
    pool.forEach((site, i) => {
      if (used.has(i) || distanceBetween(site.position, here) > HARD_RULE_REPAIR_RADIUS_METERS)
        return
      const replaced = current.order.map((siteIndex, k) => (k === position ? i : siteIndex))
      const candidate = evaluation.score(startIndex, replaced)
      if (candidate.score < current.score) current = candidate
    })
  }
  return current.order
}

// Doglegs need the actual routes, which are too slow to compute at every search step, so the
// finished course is checked once and each doubling-back control moved to a nearby site.
function repairDoglegs(
  startIndex: number,
  order: readonly number[],
  pool: readonly ControlSiteCandidate[],
  finish: LocalPoint,
  grid: CostGrid,
  paceSecondsPerKm: number,
  evaluation: ReturnType<typeof createEvaluation>,
  kept: ReadonlySet<number>,
): readonly number[] {
  const routes = new Map<string, readonly LocalPoint[]>()
  const routeBetween = (from: LocalPoint, to: LocalPoint): readonly LocalPoint[] => {
    const key = `${from[0]},${from[1]},${to[0]},${to[1]}`
    const cached = routes.get(key)
    if (cached) return cached
    const route = findRoute(grid, from, to, { paceSecondsPerKm })?.points ?? [from, to]
    routes.set(key, route)
    return route
  }
  const doublesBack = (before: LocalPoint, at: LocalPoint, after: LocalPoint) =>
    routeDoglegOverlaps([routeBetween(before, at), routeBetween(at, after)])[0]! >
    COURSE_SHAPE.doglegHardOverlap

  let current = order
  for (let position = 0; position < current.length; position++) {
    if (kept.has(current[position]!)) continue
    const positionOf = (sequence: readonly number[], k: number) =>
      k < 0
        ? pool[startIndex]!.position
        : k >= sequence.length
          ? finish
          : pool[sequence[k]!]!.position
    const before = positionOf(current, position - 1)
    const here = positionOf(current, position)
    const after = positionOf(current, position + 1)
    if (!doublesBack(before, here, after)) continue
    const used = new Set([startIndex, ...current])
    const keepScore = evaluation.score(startIndex, current).score
    let best: { order: number[]; score: number } | null = null
    pool.forEach((site, i) => {
      if (used.has(i) || distanceBetween(site.position, here) > DOGLEG_REPAIR_RADIUS_METERS) return
      if (doublesBack(before, site.position, after)) return
      const replaced = current.map((siteIndex, k) => (k === position ? i : siteIndex))
      const { score } = evaluation.score(startIndex, replaced)
      if (!best || score < best.score) best = { order: replaced, score }
    })
    const chosen = best as { order: number[]; score: number } | null
    if (chosen && chosen.score < keepScore + DOGLEG_WORTH) current = chosen.order
  }
  return current
}

function nearestOpenPoint(grid: CostGrid, target: LocalPoint): LocalPoint | null {
  const targetIndex = cellIndexOf(grid, target)
  if (targetIndex !== null && grid.speed[targetIndex] !== BLOCKED) return target
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  grid.speed.forEach((speed, index) => {
    if (speed === BLOCKED) return
    const [x, y] = cellCenterOf(grid, index)
    const distance = Math.hypot(x - target[0], y - target[1])
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best === null ? null : cellCenterOf(grid, best)
}

const distanceBetween = (a: LocalPoint, b: LocalPoint) => Math.hypot(b[0] - a[0], b[1] - a[1])

type Pair = [number, number]

function courseLineCrossings(stops: readonly LocalPoint[]): Pair[] {
  const crossings: Pair[] = []
  for (let a = 0; a + 1 < stops.length; a++) {
    for (let b = a + 2; b + 1 < stops.length; b++) {
      if (segmentsCross(stops[a]!, stops[a + 1]!, stops[b]!, stops[b + 1]!)) crossings.push([a, b])
    }
  }
  return crossings
}

// Lines through other controls' circles, or through the finish circle on the way elsewhere.
function courseLinesThroughControls(stops: readonly LocalPoint[]): Pair[] {
  const throughControls: Pair[] = []
  const finish = stops.length - 1
  const radiusOf = (stop: number) =>
    stop === finish
      ? FINISH_OUTER_CIRCLE_FOOTPRINT_RADIUS_METERS
      : CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS
  for (let leg = 0; leg + 1 < stops.length; leg++) {
    for (let control = 1; control < stops.length; control++) {
      if (control === leg || control === leg + 1) continue
      const distance = distanceToSegment(stops[control]!, stops[leg]!, stops[leg + 1]!)
      if (distance < radiusOf(control)) throughControls.push([leg, control])
    }
  }
  return throughControls
}

function overlappingCircles(stops: readonly LocalPoint[]): Pair[] {
  const radiusOf = (i: number) =>
    i === stops.length - 1
      ? FINISH_OUTER_CIRCLE_FOOTPRINT_RADIUS_METERS
      : CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS
  const overlapping: Pair[] = []
  for (let a = 0; a < stops.length; a++) {
    for (let b = a + 1; b < stops.length; b++) {
      if (distanceBetween(stops[a]!, stops[b]!) < radiusOf(a) + radiusOf(b))
        overlapping.push([a, b])
    }
  }
  return overlapping
}

function courseLineStaysOnMap(
  grid: CostGrid,
  mappedArea: Uint8Array,
  from: LocalPoint,
  to: LocalPoint,
): boolean {
  const samples = Math.max(1, Math.ceil(distanceBetween(from, to) / grid.cellSizeMeters))
  for (let s = 0; s <= samples; s++) {
    const t = s / samples
    const index = cellIndexOf(grid, [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ] as const as LocalPoint)
    if (index === null || !mappedArea[index]) return false
  }
  return true
}

function straightLineSeconds(
  grid: CostGrid,
  from: LocalPoint,
  to: LocalPoint,
  paceSecondsPerKm: number,
): number {
  const length = distanceBetween(from, to)
  const samples = Math.max(1, Math.ceil(length / grid.cellSizeMeters))
  const stepSeconds = ((length / samples) * paceSecondsPerKm) / 1000
  const { minX, minY, cellSizeMeters, columns, rows } = grid
  let seconds = 0
  // cellIndexOf, inlined: this runs for every candidate leg the section fill weighs.
  for (let s = 0; s < samples; s++) {
    const t = (s + 0.5) / samples
    const column = Math.floor((from[0] + (to[0] - from[0]) * t - minX) / cellSizeMeters)
    const row = Math.floor((from[1] + (to[1] - from[1]) * t - minY) / cellSizeMeters)
    if (column < 0 || row < 0 || column >= columns || row >= rows) return Number.POSITIVE_INFINITY
    const speed = grid.speed[row * columns + column]!
    if (speed === BLOCKED) return Number.POSITIVE_INFINITY
    seconds += stepSeconds / speed
  }
  return seconds
}

const ROUTE_CHOICE_RATIO_FULL_FROM = 1.05
const ROUTE_CHOICE_RATIO_FULL_UNTIL = 1.3
const ROUTE_CHOICE_RATIO_FADED_AT = 2
const FORCED_DETOUR_VALUE = 0.3

function routeChoiceValueOf(straightSeconds: number, fastestSeconds: number): number {
  if (fastestSeconds <= 0) return 0
  if (!Number.isFinite(straightSeconds)) return FORCED_DETOUR_VALUE
  const ratio = straightSeconds / fastestSeconds
  if (ratio <= 1) return 0
  if (ratio < ROUTE_CHOICE_RATIO_FULL_FROM) return (ratio - 1) / (ROUTE_CHOICE_RATIO_FULL_FROM - 1)
  if (ratio <= ROUTE_CHOICE_RATIO_FULL_UNTIL) return 1
  const fade =
    (ratio - ROUTE_CHOICE_RATIO_FULL_UNTIL) /
    (ROUTE_CHOICE_RATIO_FADED_AT - ROUTE_CHOICE_RATIO_FULL_UNTIL)
  return Math.max(FORCED_DETOUR_VALUE, 1 - fade * (1 - FORCED_DETOUR_VALUE))
}
