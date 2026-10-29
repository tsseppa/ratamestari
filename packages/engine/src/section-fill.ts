import type { LocalPoint } from '@ratamestari/core'
import {
  ACUTE_ANGLE,
  COURSE_LINE_CROSSING,
  SECTION_FILL,
  controlSpacingForScale,
  type LegLengthTarget,
} from '@ratamestari/rules'
import type { ControlSiteCandidate } from './control-sites'
import { crossingSeverity } from './course-metrics'
import { courseProfileOf } from './course-profile'
import type { PlanningContext } from './course-search'
import { difficultyInCourse } from './flag-side'
import { distanceToSegment } from './polyline'
import type { Random } from './random'

// ISOM sym. 703: control circles have a 5 mm diameter, 75 m at 1:15 000.
export const CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS = 37.5
export const FINISH_OUTER_CIRCLE_FOOTPRINT_RADIUS_METERS = 45

export interface SectionRequest {
  readonly entry: number
  readonly exit: number | 'finish'
  readonly budgetSeconds: number
  // Pool indices that may hold the section's controls.
  readonly allowed: readonly number[]
  readonly legBandMetres: readonly [number, number]
  // Stops already set elsewhere on the course, in course order, with their legs.
  readonly fixedStops: readonly LocalPoint[]
  readonly fixedLegs: readonly (readonly [LocalPoint, LocalPoint])[]
  readonly usedSites: ReadonlySet<number>
  // The stop after the exit (the end of the next connecting leg), for the angle at the exit.
  readonly afterExit: LocalPoint | null
  // The stop before the entry, when it is already set, for the angle at the entry.
  readonly beforeEntry?: LocalPoint | null
  // The first leg may walk in from a start outside the band, as far as this.
  readonly firstLegMaxMetres?: number
  // A smaller search, for rebuilding a few controls: at most this many controls.
  readonly rebuildingControls?: number
}

export interface SectionFill {
  // The controls between the entry and the exit, in order.
  readonly controls: readonly number[]
  readonly estimatedSeconds: number
  // No path fitted the budget within its tolerance; this is the nearest one under it.
  readonly short: boolean
}

interface State {
  readonly path: readonly number[]
  readonly elapsed: number
  readonly qualityTotal: number
  readonly outOfRange: number
  readonly straightOn: number
  readonly legs: readonly number[]
  readonly cost: number
}

const STRAIGHT_ON_DEGREES = 150
const EXIT_LEG_STRETCH = 1.5
const CANDIDATE_SHORTLIST = 3
const MAX_DEPTH_FACTOR = 3
const HOMING_FROM_SHARE = 0.6
// Within about this distance of the exit, a crossing with the last leg counts as a bad one
// (COURSE_LINE_CROSSING), so early legs keep clear of it to leave the way home open.
const EXIT_CORRIDOR_METERS = 200

const distanceBetween = (a: LocalPoint, b: LocalPoint) => Math.hypot(b[0] - a[0], b[1] - a[1])

export function angleAt(previous: LocalPoint, vertex: LocalPoint, next: LocalPoint): number {
  const ax = previous[0] - vertex[0]
  const ay = previous[1] - vertex[1]
  const bx = next[0] - vertex[0]
  const by = next[1] - vertex[1]
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by)
  if (lengths === 0) return 180
  return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / lengths))) * 180) / Math.PI
}

// Beam search over the controls of one section: from its entry to its exit, close to its budget.
export function fillSection(
  context: PlanningContext,
  request: SectionRequest,
  random: Random,
): SectionFill {
  const { pool, spec, finish, toFinish } = context
  const { budgetTolerance, weights } = SECTION_FILL
  const { beamWidth, expansions } =
    request.rebuildingControls === undefined ? SECTION_FILL : SECTION_FILL.rebuild
  const [minDifficulty, maxDifficulty] = spec.target.siteDifficulty
  const spacing = controlSpacingForScale(spec.printScale)
  const profile = courseProfileOf(spec)
  const crowdingRule = profile.crowding
  const mix = mixWithin(profile.quality.legLengths, request.legBandMetres)
  const [shortestLeg, longestLeg] = request.legBandMetres
  const positionOf = (i: number) => pool[i]!.position
  const entry = positionOf(request.entry)
  const exitPosition = request.exit === 'finish' ? finish : positionOf(request.exit)
  const budget = request.budgetSeconds
  const latest = budget * (1 + budgetTolerance)
  const earliest = budget * (1 - budgetTolerance)
  // Only the entry's and the allowed sites' times to the exit are read.
  const toExit: ArrayLike<number> =
    request.exit === 'finish'
      ? toFinish
      : context.timesFrom(request.exit, latest, [request.entry, ...request.allowed])
  const meanLegSeconds = meanLegOf(mix) * (context.paceSecondsPerKm / 1000) * 1.2
  const expectedLegs = Math.max(1, budget / meanLegSeconds)
  const inRange = (i: number) => {
    const difficulty = difficultyInCourse(pool[i]!, maxDifficulty)
    return difficulty >= minDifficulty && difficulty <= maxDifficulty
  }
  const allowed = request.allowed.filter(i => !request.usedSites.has(i) && i !== request.entry)

  const minimumApart = (a: ControlSiteCandidate, b: ControlSiteCandidate) =>
    Math.max(
      a.isomCode === b.isomCode
        ? spacing.minStraightMetersForSimilarSites
        : spacing.minStraightMeters,
      2 * CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS,
    )
  const stopsOf = (path: readonly number[]) => [entry, ...path.map(positionOf)]

  // The checks a new leg from the last stop of `path` to `site` must pass (as in the old build).
  const legFits = (
    path: readonly number[],
    site: number,
    to: LocalPoint,
    isExit: boolean,
    allowsCrossings = profile.allowsCrossingLegs,
  ) => {
    const stops = stopsOf(path)
    const from = stops[stops.length - 1]!
    if (!context.isAllowedCourseLine(from, to)) return false
    const before = stops.length >= 2 ? stops[stops.length - 2]! : request.beforeEntry
    if (before && angleAt(before, from, to) < ACUTE_ANGLE.noteBelowDegrees) return false
    const near = [...request.fixedStops, ...stops, to]
    const legs = [
      ...request.fixedLegs,
      ...stops.slice(1).map((stop, k) => [stops[k]!, stop] as const),
    ]
    const touches = (point: LocalPoint) =>
      distanceBetween(point, from) < 1 || distanceBetween(point, to) < 1
    for (const [a, b] of allowsCrossings ? [] : legs) {
      if (touches(a) || touches(b)) continue
      if (crossingSeverity(a, b, from, to, near) > COURSE_LINE_CROSSING.acceptableSeverity)
        return false
    }
    const isEndpoint = (stop: LocalPoint) => distanceBetween(stop, to) < 1
    const others = [...request.fixedStops, ...stops.slice(0, -1)].filter(stop => !isEndpoint(stop))
    if (
      others.some(
        stop => distanceToSegment(stop, from, to) < CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS,
      )
    )
      return false
    if (
      !isEndpoint(finish) &&
      distanceToSegment(finish, from, to) < FINISH_OUTER_CIRCLE_FOOTPRINT_RADIUS_METERS
    )
      return false
    if (isExit) return true
    const candidate = pool[site]!
    if (legs.some(([a, b]) => distanceToSegment(to, a, b) < CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS))
      return false
    const placed = [...request.fixedStops, ...stops]
    const sites = [...path.map(i => pool[i]!), pool[request.entry]!]
    if (sites.some(other => distanceBetween(other.position, to) < minimumApart(other, candidate)))
      return false
    if (placed.some(stop => distanceBetween(stop, to) < 2 * CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS))
      return false
    if (
      distanceBetween(to, finish) <
      CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS + FINISH_OUTER_CIRCLE_FOOTPRINT_RADIUS_METERS
    )
      return false
    // Adding `to` must keep its own circle and every circle it falls into within the limit.
    const withNew = [...placed, to]
    const crowdAround = (centre: LocalPoint) =>
      withNew.filter(stop => distanceBetween(stop, centre) <= crowdingRule.radiusMetres).length
    return [
      to,
      ...placed.filter(stop => distanceBetween(stop, to) <= crowdingRule.radiusMetres),
    ].every(centre => crowdAround(centre) <= crowdingRule.maxControls)
  }

  const costOf = (state: Omit<State, 'cost'>, closingSeconds: number | null) => {
    const count = state.path.length
    const meanQuality = count === 0 ? 0 : state.qualityTotal / count
    const pacing = Math.abs(state.elapsed / budget - count / expectedLegs)
    const total = closingSeconds === null ? null : state.elapsed + closingSeconds
    return (
      -weights.quality * meanQuality +
      weights.difficultyOutsideRange * (count === 0 ? 0 : state.outOfRange / count) +
      weights.legMix * mixDeviation(state.legs, mix) +
      weights.pacing * pacing +
      weights.straightOn * (count === 0 ? 0 : state.straightOn / count) +
      (total === null
        ? 0
        : (weights.budgetErrorPerPercent * 100 * Math.abs(total - budget)) / budget)
    )
  }

  const complete: { path: readonly number[]; total: number; cost: number }[] = []
  // Closings whose only fault is crossing the course: better than a section far too short.
  const crossingCloses: { path: readonly number[]; total: number; cost: number }[] = []
  const closings: { path: readonly number[]; total: number }[] = []
  // The time of a clean last leg from the end of `path` to the exit, or null if there is none.
  const closingSeconds = (
    path: readonly number[],
    allowsCrossings = profile.allowsCrossingLegs,
  ): number | null => {
    const stops = stopsOf(path)
    const from = stops[stops.length - 1]!
    const last = path.length === 0 ? request.entry : path[path.length - 1]!
    const closing = toExit[last]!
    if (!Number.isFinite(closing)) return null
    if (distanceBetween(from, exitPosition) > longestLeg * EXIT_LEG_STRETCH && path.length > 0)
      return null
    if (!legFits(path, -1, exitPosition, true, allowsCrossings)) return null
    if (
      request.afterExit &&
      angleAt(from, exitPosition, request.afterExit) < ACUTE_ANGLE.noteBelowDegrees
    )
      return null
    return closing
  }
  const tryClose = (state: State) => {
    const closing = closingSeconds(state.path)
    if (closing === null) {
      const crossing = closingSeconds(state.path, true)
      const total = crossing === null ? null : state.elapsed + crossing
      if (total !== null && total >= earliest && total <= latest) {
        const cost = costOf(state, crossing) + weights.crossingClose
        crossingCloses.push({ path: state.path, total, cost })
      }
      return
    }
    const total = state.elapsed + closing
    if (total > latest) return
    closings.push({ path: state.path, total })
    if (total >= earliest) complete.push({ path: state.path, total, cost: costOf(state, closing) })
  }

  let beam: State[] = [
    { path: [], elapsed: 0, qualityTotal: 0, outOfRange: 0, straightOn: 0, legs: [], cost: 0 },
  ]
  const maxDepth =
    request.rebuildingControls ?? Math.max(3, Math.ceil(expectedLegs * MAX_DEPTH_FACTOR))
  for (let depth = 0; beam.length > 0 && depth <= maxDepth; depth++) {
    const next: State[] = []
    for (const state of beam) {
      tryClose(state)
      const stops = stopsOf(state.path)
      const from = stops[stops.length - 1]!
      const lastStop = state.path.length === 0 ? request.entry : state.path[state.path.length - 1]!
      const used = new Set(state.path)
      const reachable = allowed.flatMap(i => {
        if (used.has(i)) return []
        const metres = distanceBetween(from, positionOf(i))
        const maxMetres =
          state.path.length === 0
            ? Math.max(longestLeg, request.firstLegMaxMetres ?? 0)
            : longestLeg
        if (metres < shortestLeg || metres > maxMetres) return []
        const seconds = context.straightSecondsBetween(lastStop, i)
        if (!Number.isFinite(seconds)) return []
        if (state.elapsed + seconds + toExit[i]! > latest) return []
        const legs = [...state.legs, metres]
        const previous = stops[stops.length - 2]
        const isStraightOn =
          previous !== undefined && angleAt(previous, from, positionOf(i)) > STRAIGHT_ON_DEGREES
        const passesExit =
          request.exit !== 'finish' && i === request.exit
            ? Number.POSITIVE_INFINITY
            : distanceToSegment(exitPosition, from, positionOf(i))
        const corridor = Math.max(0, 1 - passesExit / EXIT_CORRIDOR_METERS)
        const grown = {
          path: [...state.path, i],
          elapsed: state.elapsed + seconds,
          qualityTotal: state.qualityTotal + context.quality[i]!,
          outOfRange: state.outOfRange + (inRange(i) ? 0 : 1),
          straightOn: state.straightOn + (isStraightOn ? 1 : 0),
          legs,
        }
        return [
          {
            ...grown,
            cost:
              costOf(grown, null) + weights.exitCorridor * corridor + weights.noise * random.next(),
          },
        ]
      })
      reachable.sort((a, b) => a.cost - b.cost)
      let taken = 0
      for (const candidate of reachable.slice(0, expansions * CANDIDATE_SHORTLIST)) {
        if (taken >= expansions) break
        const site = candidate.path[candidate.path.length - 1]!
        if (!legFits(state.path, site, positionOf(site), false)) continue
        // Late in the budget, a state that cannot close cleanly to the exit is a dead end: steer
        // the beam home instead of letting it wander until nothing can finish.
        const lateness = candidate.elapsed / budget - HOMING_FROM_SHARE
        const homing =
          lateness > 0 && closingSeconds(candidate.path) === null
            ? weights.unclosable * lateness
            : 0
        next.push({ ...candidate, cost: candidate.cost + homing })
        taken++
      }
    }
    beam = next.sort((a, b) => a.cost - b.cost).slice(0, beamWidth)
  }

  for (const candidates of [complete, crossingCloses]) {
    if (candidates.length === 0) continue
    const best = candidates.reduce((a, b) => (b.cost < a.cost ? b : a))
    return { controls: best.path, estimatedSeconds: best.total, short: false }
  }
  const nearest = closings.reduce<{ path: readonly number[]; total: number } | null>(
    (a, b) => (a === null || b.total > a.total ? b : a),
    null,
  )
  return nearest
    ? { controls: nearest.path, estimatedSeconds: nearest.total, short: true }
    : { controls: [], estimatedSeconds: toExit[request.entry]!, short: true }
}

// The format's leg mix limited to the section's leg band, as shares of whole bins.
function mixWithin(target: LegLengthTarget, [low, high]: readonly [number, number]) {
  const edges = target.binEdgesMetres
  const shares = target.shares.map((share, bin) =>
    edges[bin + 1]! > low && edges[bin]! < high ? share : 0,
  )
  const total = shares.reduce((sum, share) => sum + share, 0) || 1
  return { edges, shares: shares.map(share => share / total) }
}

function meanLegOf({ edges, shares }: { edges: readonly number[]; shares: readonly number[] }) {
  return shares.reduce((sum, share, bin) => sum + share * ((edges[bin]! + edges[bin + 1]!) / 2), 0)
}

function mixDeviation(
  legs: readonly number[],
  { edges, shares }: { edges: readonly number[]; shares: readonly number[] },
): number {
  if (legs.length === 0) return 0
  const counts = shares.map(() => 0)
  for (const leg of legs) {
    const bin = edges.findIndex((edge, i) => i > 0 && leg < edge) - 1
    counts[bin < 0 ? counts.length - 1 : bin]!++
  }
  return (
    shares.reduce((sum, share, bin) => sum + Math.abs(counts[bin]! / legs.length - share), 0) / 2
  )
}
