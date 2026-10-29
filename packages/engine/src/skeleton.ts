import type { LocalPoint } from '@ratamestari/core'
import { FORMAT_QUALITY, FORMAT_TEMPLATES, SKELETON_SEARCH } from '@ratamestari/rules'
import type { TechnicalArea } from './areas'
import { convexHullArea } from './course-metrics'
import type { PlanningContext, SearchProgress } from './course-search'
import { difficultyInCourse } from './flag-side'
import { CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS } from './section-fill'
import { isInsidePolygon, segmentsCross } from './polyline'
import type { Random } from './random'

export interface SkeletonSection {
  // Index into the areas, or null for the run-in or a single section over the whole pool.
  readonly area: number | null
  // Pool index of the first stop: the start, or the end of a connecting leg.
  readonly entry: number
  // Pool index of the last control (the start of the next connecting leg), or the finish.
  readonly exit: number | 'finish'
  readonly budgetSeconds: number
  readonly legBandMetres: readonly [number, number]
}

export interface ConnectingLeg {
  readonly from: number
  readonly to: number
  readonly seconds: number
  readonly routeChoice: number
}

export interface Skeleton {
  readonly start: number
  readonly sections: readonly SkeletonSection[]
  readonly connectingLegs: readonly ConnectingLeg[]
  readonly estimatedSeconds: number
  readonly score: number
}

// Ranked, best first; empty when no start can be found.
export type SkeletonPlanning = Generator<SearchProgress, Skeleton[], boolean | undefined>

// When the last area is farther from the finish than this share of the winning time, a run-in
// section from sites near the finish closes the course (the existing final-leg limit).
const DIRECT_FINISH_SHARE = 0.04
const RUN_IN_STRETCH = 1.3
// The start lies up to this share of the winning time away from the finish, towards the first
// area, so that much of the way to the first area costs no area capacity.
const START_REACH_SHARE = 0.12
const TOO_STRAIGHT_DEGREES = 60
const REVERSAL_DEGREES = 150
const BLOCKED_LINE_SLOWNESS = 1.5
const MIDDLE_ROUTE_CHOICE_SHARE = 0.3
// Trees from connecting-leg exits reach a little past the farthest entry candidate (and never
// much past the slowest allowed leg): the fastest route is rarely much slower than straight.
const BOUNDED_TREE_SLACK = 1.3

const distanceBetween = (a: LocalPoint, b: LocalPoint) => Math.hypot(b[0] - a[0], b[1] - a[1])

// Every leg from the start would pass through the circle of a control right beside it.
const isClearOfStart = (site: LocalPoint, start: LocalPoint) =>
  distanceBetween(site, start) >= 2 * CONTROL_CIRCLE_FOOTPRINT_RADIUS_METERS

export function planSkeleton(
  context: PlanningContext,
  areas: readonly TechnicalArea[],
  usableAreaSquareMetres: number,
  random: Random,
): Skeleton | null {
  const planning = planSkeletonSteps(context, areas, usableAreaSquareMetres, random)
  for (let step = planning.next(); ; step = planning.next()) {
    if (step.done) return step.value[0] ?? null
  }
}

// Yields between candidate skeletons so the worker can slice the work and stop it.
export function* planSkeletonSteps(
  context: PlanningContext,
  areas: readonly TechnicalArea[],
  usableAreaSquareMetres: number,
  random: Random,
): SkeletonPlanning {
  const { spec, pool, toFinish, quality, targetSeconds, finish } = context
  const template = FORMAT_TEMPLATES[spec.format]
  const { weights } = SKELETON_SEARCH
  const [minDifficulty, maxDifficulty] = spec.target.siteDifficulty
  const inDifficultyRange = (i: number) => {
    const difficulty = difficultyInCourse(pool[i]!, maxDifficulty)
    return difficulty >= minDifficulty && difficulty <= maxDifficulty
  }
  const nearestToFinish = areas.map(area => Math.min(...area.sites.map(i => toFinish[i]!)))
  const radiusOf = (area: TechnicalArea) => Math.sqrt(area.areaSquareMetres / Math.PI)
  const isMainCandidate = (a: number) =>
    nearestToFinish[a]! <= template.mainAreaReachShare * targetSeconds
  const usableAreas = areas.flatMap((area, a) =>
    area.capacitySeconds >= template.minAreaCapacityShare * targetSeconds ? [a] : [],
  )

  const estimatedLeg = (a: number, b: number) => {
    const from = areas[a]!.centre
    const to = areas[b]!.centre
    const centres = distanceBetween(from, to)
    const metres = Math.max(0, centres - 0.5 * (radiusOf(areas[a]!) + radiusOf(areas[b]!)))
    const straight = context.straightSeconds(from, to)
    const secondsPerMetre = Number.isFinite(straight)
      ? straight / Math.max(1, centres)
      : (BLOCKED_LINE_SLOWNESS * context.paceSecondsPerKm) / 1000
    return { metres, seconds: metres * secondsPerMetre }
  }
  const runInSecondsFor = (fromFinishSeconds: number) =>
    fromFinishSeconds <= DIRECT_FINISH_SHARE * targetSeconds
      ? 0
      : fromFinishSeconds * RUN_IN_STRETCH

  const outOfBand = (value: number, [low, high]: readonly [number, number]) =>
    value < low ? (low - value) / low : value > high ? (value - high) / high : 0
  const turnPenalty = (points: readonly LocalPoint[]) => {
    let penalty = 0
    for (let i = 1; i + 1 < points.length; i++) {
      const turn = turnDegrees(points[i - 1]!, points[i]!, points[i + 1]!)
      if (turn < TOO_STRAIGHT_DEGREES || turn > REVERSAL_DEGREES) penalty++
    }
    return penalty
  }
  const crossingsOf = (loop: readonly LocalPoint[]) => {
    let crossings = 0
    for (let a = 0; a + 1 < loop.length; a++) {
      for (let b = a + 2; b + 1 < loop.length; b++) {
        if (a === 0 && b + 1 === loop.length - 1) continue
        if (segmentsCross(loop[a]!, loop[a + 1]!, loop[b]!, loop[b + 1]!)) crossings++
      }
    }
    return crossings
  }
  const spreadPenalty = (points: readonly LocalPoint[]) => {
    const target = FORMAT_QUALITY[spec.format].spreadTarget
    const spread = usableAreaSquareMetres > 0 ? convexHullArea(points) / usableAreaSquareMetres : 0
    return Math.max(0, target - spread) / target
  }

  // Splits the free time between the technical sections in proportion to capacity × quality,
  // never giving a section more than it holds. Returns the budgets and the time left over.
  const allocate = (sequence: readonly number[], free: number, minimum: readonly number[]) => {
    const capOf = (k: number) => areas[sequence[k]!]!.capacitySeconds + minimum[k]!
    const budgets = minimum.map(m => m)
    let left = free - minimum.reduce((sum, m) => sum + m, 0)
    if (spec.format === 'middle' && sequence.length > 1) {
      const main = sequence.findIndex(isMainCandidate)
      if (main >= 0) {
        const wanted = Math.min(capOf(main), template.mainSectionMinShare * free)
        const extra = Math.max(0, Math.min(left, wanted - budgets[main]!))
        budgets[main]! += extra
        left -= extra
      }
    }
    for (let round = 0; round < sequence.length && left > 1; round++) {
      const open = sequence.map((_, k) => k).filter(k => budgets[k]! < capOf(k) - 1)
      if (open.length === 0) break
      const weightOf = (k: number) =>
        Math.max(1, areas[sequence[k]!]!.capacitySeconds * areas[sequence[k]!]!.meanQuality)
      const total = open.reduce((sum, k) => sum + weightOf(k), 0)
      let given = 0
      for (const k of open) {
        const share = Math.min((left * weightOf(k)) / total, capOf(k) - budgets[k]!)
        budgets[k]! += share
        given += share
      }
      left -= given
    }
    return { budgets, shortfall: Math.max(0, left) }
  }

  const scoreOf = (parts: {
    sequence: readonly number[]
    connectingSeconds: readonly number[]
    connectingMetres: readonly number[]
    shortfall: number
    overshoot: number
    loop: readonly LocalPoint[]
    routeChoice: number
  }) => {
    const connectingShare =
      parts.connectingSeconds.reduce((sum, s) => sum + s, 0) / Math.max(1, targetSeconds)
    const meanQuality =
      parts.sequence.reduce((sum, a) => sum + areas[a]!.meanQuality, 0) /
      Math.max(1, parts.sequence.length)
    return (
      (weights.timeShortfallPerPercent * 100 * (parts.shortfall + parts.overshoot)) /
        targetSeconds -
      weights.areaQuality * meanQuality +
      weights.connectingLegOutOfBand *
        parts.connectingMetres.reduce(
          (sum, metres) => sum + outOfBand(metres, template.connectingLegMetres),
          0,
        ) +
      weights.connectingShareOutOfRange *
        100 *
        Math.max(
          0,
          template.connectingTotalShare[0] - connectingShare,
          connectingShare - template.connectingTotalShare[1],
        ) *
        (parts.sequence.length > 1 ? 1 : 0) +
      weights.sharpTurn * turnPenalty(parts.loop) +
      weights.crossing * crossingsOf(parts.loop) +
      weights.spread * spreadPenalty(parts.loop) -
      weights.routeChoice * parts.routeChoice
    )
  }

  // 1. Order the areas on estimates between their centres.
  const [fewest, most] = template.technicalSections
  const complete: { sequence: number[]; score: number }[] = []
  let beam: number[][] = usableAreas.map(a => [a])
  for (let length = 1; length <= Math.min(most, usableAreas.length) && beam.length > 0; length++) {
    const scored = beam.map(sequence => {
      const legs = sequence.slice(1).map((a, i) => estimatedLeg(sequence[i]!, a))
      const connectingSeconds = legs.map(leg => leg.seconds)
      const startOverhead = Math.max(
        0,
        nearestToFinish[sequence[0]!]! - START_REACH_SHARE * targetSeconds,
      )
      const runIn = runInSecondsFor(nearestToFinish[sequence[sequence.length - 1]!]!)
      const free =
        targetSeconds - connectingSeconds.reduce((sum, s) => sum + s, 0) - runIn - startOverhead
      const capacity = sequence.reduce((sum, a) => sum + areas[a]!.capacitySeconds, 0)
      const loop = [finish, ...sequence.map(a => areas[a]!.centre), finish]
      const feasible = spec.format !== 'middle' || sequence.some(isMainCandidate)
      const score = feasible
        ? scoreOf({
            sequence,
            connectingSeconds,
            connectingMetres: legs.map(leg => leg.metres),
            shortfall: Math.max(0, free - capacity),
            overshoot: Math.max(0, -free),
            loop,
            routeChoice: 0,
          }) +
          random.next() * 0.01
        : Number.POSITIVE_INFINITY
      return { sequence, score }
    })
    if (length >= fewest) complete.push(...scored.filter(s => Number.isFinite(s.score)))
    beam = scored
      .sort((a, b) => a.score - b.score)
      .slice(0, SKELETON_SEARCH.beamWidth)
      .flatMap(({ sequence }) =>
        usableAreas.flatMap(a => (sequence.includes(a) ? [] : [[...sequence, a]])),
      )
  }
  const shortlist = complete.sort((a, b) => a.score - b.score).slice(0, SKELETON_SEARCH.refined)

  // 2. Refine the best orders with real endpoints, start, run-in and budgets.
  const ranked: Skeleton[] = []
  for (const [k, { sequence }] of shortlist.entries()) {
    if (yield { phase: 'skeleton', done: k, total: shortlist.length }) break
    const refined = refine(sequence)
    if (refined) ranked.push(refined)
  }
  if (ranked.length > 0) return ranked.sort((a, b) => a.score - b.score)
  const whole = wholePool()
  return whole ? [whole] : []

  function refine(sequence: readonly number[]): Skeleton | null {
    const used = new Set<number>()
    const legs: ConnectingLeg[] = []
    for (let k = 0; k + 1 < sequence.length; k++) {
      const leg = connectingLeg(sequence[k]!, sequence[k + 1]!, used)
      if (!leg) return null
      used.add(leg.from)
      used.add(leg.to)
      legs.push(leg)
    }
    const first = areas[sequence[0]!]!
    const main = sequence.find(isMainCandidate)
    const hull = main === undefined ? null : areas[main]!.hull
    const start = context.pickStart(
      [first.centre],
      i =>
        used.has(i) ||
        (spec.format === 'middle' &&
          !spec.startDistanceFromFinishMeters &&
          hull !== null &&
          isInsidePolygon(pool[i]!.position, hull)),
      random,
    )
    if (start < 0) return null

    const last = areas[sequence[sequence.length - 1]!]!
    const lastExit =
      nearestToFinish[sequence[sequence.length - 1]!]! <= DIRECT_FINISH_SHARE * targetSeconds
        ? null
        : last.sites
            .filter(
              i =>
                !used.has(i) &&
                i !== start &&
                inDifficultyRange(i) &&
                isClearOfStart(pool[i]!.position, pool[start]!.position),
            )
            .reduce<number | null>(
              (a, b) => (a === null || toFinish[b]! < toFinish[a]! ? b : a),
              null,
            )
    const runInBudget = lastExit === null ? 0 : runInSecondsFor(toFinish[lastExit]!)

    const entries = [start, ...legs.map(leg => leg.to)]
    const exits: (number | 'finish')[] = [
      ...legs.map(leg => leg.from),
      lastExit === null ? 'finish' : lastExit,
    ]
    const minimum = entries.map((entry, k) => secondsBetween(entry, exits[k]!))
    if (minimum.some(m => !Number.isFinite(m))) return null
    const connectingSeconds = legs.map(leg => leg.seconds)
    const free = targetSeconds - connectingSeconds.reduce((sum, s) => sum + s, 0) - runInBudget
    const { budgets, shortfall } = allocate(sequence, free, minimum)
    const overshoot = Math.max(0, minimum.reduce((sum, m) => sum + m, 0) - free)
    const band = template.technicalLegMetres
    const sections: SkeletonSection[] = sequence.map((area, k) => ({
      area,
      entry: entries[k]!,
      exit: exits[k]!,
      budgetSeconds: budgets[k]!,
      legBandMetres: band,
    }))
    if (lastExit !== null) {
      sections.push({
        area: null,
        entry: lastExit,
        exit: 'finish',
        budgetSeconds: runInBudget,
        legBandMetres: band,
      })
    }
    const positionOf = (i: number) => pool[i]!.position
    const loop = [
      finish,
      positionOf(start),
      ...legs.flatMap(leg => [positionOf(leg.from), positionOf(leg.to)]),
      ...(lastExit === null ? [] : [positionOf(lastExit)]),
      finish,
    ]
    const estimatedSeconds =
      connectingSeconds.reduce((sum, s) => sum + s, 0) +
      budgets.reduce((sum, b) => sum + b, 0) +
      runInBudget
    const routeChoice = legs.reduce(
      (sum, leg) =>
        sum + (spec.format === 'long' ? 1 : MIDDLE_ROUTE_CHOICE_SHARE) * leg.routeChoice,
      0,
    )
    return {
      start,
      sections,
      connectingLegs: legs,
      estimatedSeconds,
      score: scoreOf({
        sequence,
        connectingSeconds,
        connectingMetres: legs.map(leg =>
          distanceBetween(positionOf(leg.from), positionOf(leg.to)),
        ),
        shortfall,
        overshoot,
        loop,
        routeChoice,
      }),
    }
  }

  // The best exit in `from` and entry in `to`, from sites on the sides facing each other.
  function connectingLeg(
    from: number,
    to: number,
    used: ReadonlySet<number>,
  ): ConnectingLeg | null {
    const a = areas[from]!
    const b = areas[to]!
    const facing = (area: TechnicalArea, towards: LocalPoint) => {
      const [cx, cy] = area.centre
      const length = Math.max(1, distanceBetween(area.centre, towards))
      const [ux, uy] = [(towards[0] - cx) / length, (towards[1] - cy) / length]
      const along = (i: number) =>
        (pool[i]!.position[0] - cx) * ux + (pool[i]!.position[1] - cy) * uy
      const count = SKELETON_SEARCH.endpointCandidates
      return area.sites
        .filter(i => !used.has(i) && inDifficultyRange(i))
        .sort((x, y) => along(y) - along(x))
        .slice(0, count * 3)
        .sort((x, y) => quality[y]! - quality[x]!)
        .slice(0, count)
    }
    const exits = facing(a, b.centre)
    const entries = facing(b, a.centre)
    const [shortest, longest] = template.connectingLegMetres
    const [quickest, slowest] = template.connectingLegShare.map(share => share * targetSeconds)
    let best: (ConnectingLeg & { value: number }) | null = null
    for (const exit of exits) {
      const farthest = Math.max(
        ...entries.map(entry =>
          context.straightSeconds(pool[exit]!.position, pool[entry]!.position),
        ),
      )
      const reach = Number.isFinite(farthest) ? farthest * BOUNDED_TREE_SLACK : slowest!
      const times = context.timesFrom(exit, Math.min(reach, slowest! * BOUNDED_TREE_SLACK))
      for (const entry of entries) {
        const seconds = times[entry]!
        if (!Number.isFinite(seconds)) continue
        const from = pool[exit]!.position
        const toPosition = pool[entry]!.position
        if (!context.isAllowedCourseLine(from, toPosition)) continue
        const metres = distanceBetween(from, toPosition)
        const misfit =
          outOfBand(metres, [shortest, longest]) + outOfBand(seconds, [quickest!, slowest!])
        const routeChoice = context.routeChoiceValue(from, toPosition, seconds)
        const meanQuality = (quality[exit]! + quality[entry]!) / 2
        const value =
          spec.format === 'long'
            ? routeChoice + meanQuality - misfit
            : MIDDLE_ROUTE_CHOICE_SHARE * routeChoice + 0.5 * meanQuality - misfit
        if (!best || value > best.value) {
          best = { from: exit, to: entry, seconds, routeChoice, value }
        }
      }
    }
    return (
      best && { from: best.from, to: best.to, seconds: best.seconds, routeChoice: best.routeChoice }
    )
  }

  // A section's shortest way from entry to exit, for its least budget. The time along the
  // straight line is close enough here, and a time tree per section would cost most of the
  // planning time on a large map.
  function secondsBetween(from: number, to: number | 'finish'): number {
    if (to === 'finish') return toFinish[from]!
    if (from === to) return 0
    const straight = context.straightSeconds(pool[from]!.position, pool[to]!.position)
    return Number.isFinite(straight) ? straight : context.legSeconds(from, to)
  }

  // Too few areas: one section over the whole pool, as the planner's degenerate case.
  function wholePool(): Skeleton | null {
    const start = context.pickStart([], () => false, random)
    if (start < 0) return null
    return {
      start,
      sections: [
        {
          area: null,
          entry: start,
          exit: 'finish',
          budgetSeconds: targetSeconds,
          legBandMetres: template.technicalLegMetres,
        },
      ],
      connectingLegs: [],
      estimatedSeconds: targetSeconds,
      score: 0,
    }
  }
}

function turnDegrees(previous: LocalPoint, vertex: LocalPoint, next: LocalPoint): number {
  const a = Math.atan2(vertex[1] - previous[1], vertex[0] - previous[0])
  const b = Math.atan2(next[1] - vertex[1], next[0] - vertex[0])
  const turn = Math.abs(((b - a) * 180) / Math.PI) % 360
  return turn > 180 ? 360 - turn : turn
}
