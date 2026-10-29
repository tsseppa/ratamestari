import type { LocalExtent, LocalPoint } from '@ratamestari/core'
import {
  ACUTE_ANGLE,
  COURSE_LINE_CROSSING,
  COURSE_SHAPE,
  FORMAT_QUALITY,
  type Format,
  type LegLengthTarget,
} from '@ratamestari/rules'
import { distanceToSegment, segmentIntersection } from './polyline'
import { cellCenterOf } from './raster'
import type { Terrain } from './terrain'

export interface Metric {
  readonly value: number
  readonly note: string
}

const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(b[0] - a[0], b[1] - a[1])
const degrees = (radians: number) => (radians * 180) / Math.PI
const controlName = (stop: number) => `control ${stop}`

export const legLengths = (stops: readonly LocalPoint[]): number[] =>
  stops.slice(1).map((stop, i) => distance(stops[i]!, stop))

// Turning angle at each control: 0° is straight on, 180° a full reversal. Positive turns left.
export function signedTurns(stops: readonly LocalPoint[]): number[] {
  const turns: number[] = []
  for (let i = 1; i + 1 < stops.length; i++) {
    const [ax, ay] = stops[i - 1]!
    const [bx, by] = stops[i]!
    const [cx, cy] = stops[i + 1]!
    const inX = bx - ax
    const inY = by - ay
    const outX = cx - bx
    const outY = cy - by
    turns.push(degrees(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY)))
  }
  return turns
}

export function reversals(stops: readonly LocalPoint[]): Metric {
  const legs = legLengths(stops)
  const worst: string[] = []
  let value = 0
  signedTurns(stops).forEach((turn, i) => {
    const angle = Math.abs(turn)
    if (angle <= COURSE_SHAPE.reversalDegrees) return
    const shorterLeg = Math.min(legs[i]!, legs[i + 1]!)
    value +=
      ((angle - COURSE_SHAPE.reversalDegrees) / (180 - COURSE_SHAPE.reversalDegrees)) *
      (shorterLeg / COURSE_SHAPE.reversalReferenceLegMetres)
    worst.push(controlName(i + 1))
  })
  return {
    value,
    note: worst.length === 0 ? 'no reversals' : `turns back at ${worst.join(', ')}`,
  }
}

// A short course is naturally a small loop; only a long run of turns all one way is a ring.
export function ring(stops: readonly LocalPoint[]): Metric {
  const turns = signedTurns(stops)
  const total = turns.reduce((sum, turn) => sum + Math.abs(turn), 0)
  if (total === 0) return { value: 0, note: 'no turns' }
  const consistency = Math.abs(turns.reduce((sum, turn) => sum + turn, 0)) / total
  const note = `${Math.round(consistency * 100)}% of the turning goes the same way`
  if (turns.length < COURSE_SHAPE.ringMinTurns) return { value: 0, note }
  const { ringFreeConsistency } = COURSE_SHAPE
  return {
    value: Math.max(0, consistency - ringFreeConsistency) / (1 - ringFreeConsistency),
    note,
  }
}

// How bad one crossing of two course lines is: worst near a control or at a shallow angle,
// mild far from controls at nearly a right angle. Every crossing keeps a base cost.
export function crossingSeverity(
  a: LocalPoint,
  b: LocalPoint,
  c: LocalPoint,
  d: LocalPoint,
  stops: readonly LocalPoint[],
): number {
  const at = segmentIntersection(a, b, c, d)
  if (!at) return 0
  const { fullyBadWithinMetres, harmlessBeyondMetres, baseSeverity } = COURSE_LINE_CROSSING
  const nearest = Math.min(...stops.map(stop => distance(stop, at)))
  const nearness = Math.max(
    0,
    Math.min(1, (harmlessBeyondMetres - nearest) / (harmlessBeyondMetres - fullyBadWithinMetres)),
  )
  const [ux, uy] = [b[0] - a[0], b[1] - a[1]]
  const [vx, vy] = [d[0] - c[0], d[1] - c[1]]
  const shallowness = Math.abs(ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1)
  return baseSeverity + (1 - baseSeverity) * Math.max(nearness, shallowness)
}

export function legLengthDistribution(
  stops: readonly LocalPoint[],
  target: LegLengthTarget,
): Metric {
  const edges = target.binEdgesMetres
  const legs = legLengths(stops)
  const counts = new Array<number>(edges.length - 1).fill(0)
  for (const leg of legs) {
    let bin = edges.findIndex((edge, i) => i > 0 && leg < edge) - 1
    if (bin < 0) bin = counts.length - 1
    counts[bin]!++
  }
  const shares = counts.map(count => count / Math.max(1, legs.length))
  const targetTotal = target.shares.reduce((sum, share) => sum + share, 0) || 1
  let courseCumulative = 0
  let targetCumulative = 0
  let earthMoversDistance = 0
  for (let i = 0; i < shares.length; i++) {
    courseCumulative += shares[i]!
    targetCumulative += (target.shares[i] ?? 0) / targetTotal
    earthMoversDistance += Math.abs(courseCumulative - targetCumulative)
  }
  const value = earthMoversDistance / Math.max(1, shares.length - 1)
  const fullest = shares.indexOf(Math.max(...shares))
  return {
    value,
    note: `${Math.round(shares[fullest]! * 100)}% of legs are ${edges[fullest]}–${edges[fullest + 1]} m`,
  }
}

export function alternation(stops: readonly LocalPoint[]): Metric {
  const legs = legLengths(stops)
  const { alternationLengthRatio, alternationRunLength } = COURSE_SHAPE
  let monotonousLegs = 0
  const runs: string[] = []
  let runStart = 0
  for (let i = 1; i <= legs.length; i++) {
    const run = legs.slice(runStart, i + 1)
    const isSimilar =
      i < legs.length && Math.max(...run) / Math.max(1, Math.min(...run)) <= alternationLengthRatio
    if (isSimilar) continue
    const runLength = i - runStart
    if (runLength >= alternationRunLength) {
      monotonousLegs += runLength - alternationRunLength + 1
      runs.push(`legs ${runStart + 1}–${i}`)
    }
    runStart = i
  }
  return {
    value: monotonousLegs / Math.max(1, legs.length),
    note: runs.length === 0 ? 'leg lengths vary' : `similar lengths in ${runs.join(', ')}`,
  }
}

export function directionChanges(
  stops: readonly LocalPoint[],
  targetRate: number,
  minDegrees = COURSE_SHAPE.directionChangeDegrees,
): Metric {
  const turns = signedTurns(stops)
  const sharpestTurn = 180 - ACUTE_ANGLE.warningBelowDegrees
  const rate =
    turns.filter(turn => {
      const angle = Math.abs(turn)
      return angle > minDegrees && angle <= sharpestTurn
    }).length / Math.max(1, turns.length)
  return {
    value: Math.max(0, targetRate - rate),
    note: `${Math.round(rate * 100)}% of controls turn ${minDegrees}–${sharpestTurn}°`,
  }
}

export function firstLegTowardsFinish(stops: readonly LocalPoint[]): Metric {
  if (stops.length < 3) return { value: 0, note: 'too few controls' }
  const [start, first] = stops
  const finish = stops[stops.length - 1]!
  const bearing = (to: LocalPoint) => Math.atan2(to[1] - start![1], to[0] - start![0])
  const difference = Math.abs(degrees(bearing(first!) - bearing(finish)))
  const angle = Math.min(difference, 360 - difference)
  const isTowards = angle < COURSE_SHAPE.firstLegTowardsFinishDegrees
  return {
    value: isTowards ? 1 : 0,
    note: isTowards ? 'the first leg heads towards the finish' : 'the first leg leads away',
  }
}

export function convexHull(points: readonly LocalPoint[]): LocalPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: LocalPoint, a: LocalPoint, b: LocalPoint) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (input: LocalPoint[]) => {
    const hull: LocalPoint[] = []
    for (const point of input) {
      while (
        hull.length >= 2 &&
        cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0
      ) {
        hull.pop()
      }
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

export function convexHullArea(points: readonly LocalPoint[]): number {
  const hull = convexHull(points)
  if (hull.length < 3) return 0
  let area = 0
  hull.forEach((point, i) => {
    const next = hull[(i + 1) % hull.length]!
    area += point[0] * next[1] - next[0] * point[1]
  })
  return Math.abs(area) / 2
}

export function spread(
  stops: readonly LocalPoint[],
  usableAreaSquareMetres: number,
  target: number,
): Metric {
  const share = usableAreaSquareMetres > 0 ? convexHullArea(stops) / usableAreaSquareMetres : 0
  return {
    value: Math.max(0, target - share) / Math.max(target, Number.EPSILON),
    note: `the course reaches ${Math.round(share * 100)}% of the usable terrain`,
  }
}

export type ShapeMetricName =
  | 'legCount'
  | 'parallelLegs'
  | 'closeness'
  | 'reversals'
  | 'ring'
  | 'legLengths'
  | 'alternation'
  | 'directionChanges'
  | 'firstLeg'
  | 'spread'

export function mappedAreaWithin(terrain: Terrain, extent: LocalExtent | null): number {
  const { grid, mappedArea } = terrain
  let cells = 0
  mappedArea.forEach((isMapped, index) => {
    if (!isMapped) return
    if (extent) {
      const [x, y] = cellCenterOf(grid, index)
      if (x < extent[0] || x > extent[2] || y < extent[1] || y > extent[3]) return
    }
    cells++
  })
  return cells * grid.cellSizeMeters ** 2
}

export function measureCourseShape(
  terrain: Terrain,
  stops: readonly LocalPoint[],
  format: Format,
  printExtent: LocalExtent | null,
): Record<ShapeMetricName, Metric> {
  const profile = FORMAT_QUALITY[format]
  return {
    legCount: legCount(stops, profile.legLengths),
    parallelLegs: parallelLegs(stops),
    closeness: closeness(stops),
    reversals: reversals(stops),
    ring: ring(stops),
    legLengths: legLengthDistribution(stops, profile.legLengths),
    alternation: alternation(stops),
    directionChanges: directionChanges(
      stops,
      profile.directionChangeRateTarget,
      profile.directionChangeMinDegrees,
    ),
    firstLeg: firstLegTowardsFinish(stops),
    spread: spread(stops, mappedAreaWithin(terrain, printExtent), profile.spreadTarget),
  }
}

const ROUTE_SAMPLE_SPACING_METRES = 5

function pointsAlong(
  route: readonly LocalPoint[],
  lengthMetres: number,
  fromEnd: boolean,
): LocalPoint[] {
  const path = fromEnd ? [...route].reverse() : route
  const samples: LocalPoint[] = path.length > 0 ? [path[0]!] : []
  let travelled = 0
  for (let i = 1; i < path.length && travelled < lengthMetres; i++) {
    const [ax, ay] = path[i - 1]!
    const [bx, by] = path[i]!
    const segment = Math.hypot(bx - ax, by - ay)
    for (
      let along = ROUTE_SAMPLE_SPACING_METRES;
      along <= segment;
      along += ROUTE_SAMPLE_SPACING_METRES
    ) {
      if (travelled + along > lengthMetres) break
      const t = along / segment
      samples.push([ax + (bx - ax) * t, ay + (by - ay) * t] as const as LocalPoint)
    }
    travelled += segment
  }
  return samples
}

function distanceToPolyline(point: LocalPoint, line: readonly LocalPoint[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!
    const [bx, by] = line[i]!
    const dx = bx - ax
    const dy = by - ay
    const lengthSquared = dx * dx + dy * dy
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / lengthSquared))
    best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)))
  }
  return best
}

// Share of the start of each outgoing route that runs back along the end of the incoming one.
export function routeDoglegOverlaps(legRoutes: readonly (readonly LocalPoint[])[]): number[] {
  const { doglegLengthMetres, doglegWidthMetres } = COURSE_SHAPE
  return legRoutes.slice(1).map((outgoing, i) => {
    const incomingEnd = pointsAlong(legRoutes[i]!, doglegLengthMetres, true)
    const control = outgoing[0]
    const outgoingStart = pointsAlong(outgoing, doglegLengthMetres, false).filter(
      point => !control || distance(point, control) > doglegWidthMetres,
    )
    if (incomingEnd.length < 2 || outgoingStart.length === 0) return 0
    const alongIncoming = outgoingStart.filter(
      point => distanceToPolyline(point, incomingEnd) <= doglegWidthMetres,
    )
    return alongIncoming.length / outgoingStart.length
  })
}

export function routeDoglegs(legRoutes: readonly (readonly LocalPoint[])[]): Metric {
  const overlaps = routeDoglegOverlaps(legRoutes)
  const doglegs = overlaps.flatMap((overlap, i) =>
    overlap > 0 ? [{ control: i + 1, overlap }] : [],
  )
  return {
    value: overlaps.reduce((sum, overlap) => sum + overlap, 0),
    note:
      doglegs.length === 0
        ? 'no doglegs'
        : `routes double back at ${doglegs.map(d => `${controlName(d.control)} (${Math.round(d.overlap * 100)}%)`).join(', ')}`,
  }
}

const PARALLEL_SAMPLES = 6
const PARALLEL_REFERENCE_METRES = 1000

// Two legs that are not next to each other running side by side: out and back on almost the
// same line, or the same direction twice. Runners on one see those on the other.
export function parallelLegs(stops: readonly LocalPoint[]): Metric {
  const { parallelMaxDegrees, parallelMaxSeparationMetres, parallelMinLegMetres } = COURSE_SHAPE
  const legs = stops
    .slice(1)
    .map((to, i) => ({ from: stops[i]!, to, length: distance(stops[i]!, to) }))
  let value = 0
  const pairs: string[] = []
  legs.forEach((first, i) => {
    for (let j = i + 2; j < legs.length; j++) {
      const second = legs[j]!
      if (first.length < parallelMinLegMetres || second.length < parallelMinLegMetres) continue
      const [ux, uy] = [first.to[0] - first.from[0], first.to[1] - first.from[1]]
      const [vx, vy] = [second.to[0] - second.from[0], second.to[1] - second.from[1]]
      const cosine = Math.abs(ux * vx + uy * vy) / (first.length * second.length)
      const angle = degrees(Math.acos(Math.min(1, cosine)))
      if (angle >= parallelMaxDegrees) continue
      const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first]
      const lx = longer.to[0] - longer.from[0]
      const ly = longer.to[1] - longer.from[1]
      const separations: number[] = []
      for (let k = 0; k < PARALLEL_SAMPLES; k++) {
        const t = (k + 0.5) / PARALLEL_SAMPLES
        const point = [
          shorter.from[0] + (shorter.to[0] - shorter.from[0]) * t,
          shorter.from[1] + (shorter.to[1] - shorter.from[1]) * t,
        ] as const as LocalPoint
        const along =
          ((point[0] - longer.from[0]) * lx + (point[1] - longer.from[1]) * ly) /
          (longer.length * longer.length)
        if (along < 0 || along > 1) continue
        separations.push(distanceToSegment(point, longer.from, longer.to))
      }
      if (separations.length === 0) continue
      const separation = separations.reduce((sum, d) => sum + d, 0) / separations.length
      if (separation >= parallelMaxSeparationMetres) continue
      const overlap = (separations.length / PARALLEL_SAMPLES) * shorter.length
      value +=
        (overlap / PARALLEL_REFERENCE_METRES) *
        (1 - separation / parallelMaxSeparationMetres) *
        (1 - angle / parallelMaxDegrees)
      pairs.push(`legs ${i + 1} and ${j + 1}`)
    }
  })
  return {
    value,
    note: pairs.length === 0 ? 'no legs side by side' : `side by side: ${pairs.join(', ')}`,
  }
}

// Controls passed close by again later: near another, non-adjacent leg or near a control
// several steps away in the course order.
export function closeness(stops: readonly LocalPoint[]): Metric {
  const { nearPassMetres, revisitMetres, revisitMinOrderGap } = COURSE_SHAPE
  const lastControl = stops.length - 2
  let value = 0
  const close = new Set<number>()
  for (let control = 1; control <= lastControl; control++) {
    for (let leg = 0; leg + 1 < stops.length; leg++) {
      if (leg === control || leg + 1 === control) continue
      const d = distanceToSegment(stops[control]!, stops[leg]!, stops[leg + 1]!)
      if (d < nearPassMetres) {
        value += 1 - d / nearPassMetres
        close.add(control)
      }
    }
    for (let other = control + revisitMinOrderGap; other <= lastControl; other++) {
      const d = distance(stops[control]!, stops[other]!)
      if (d < revisitMetres) {
        value += 1 - d / revisitMetres
        close.add(control)
        close.add(other)
      }
    }
  }
  return {
    value,
    note:
      close.size === 0
        ? 'controls and legs keep apart'
        : `passed close by again: ${[...close]
            .sort((a, b) => a - b)
            .map(controlName)
            .join(', ')}`,
  }
}

// For each control, how many controls (itself included) lie within the radius. The start and
// finish are not controls.
export function crowdingCounts(stops: readonly LocalPoint[], radiusMetres: number): number[] {
  const controls = stops.slice(1, -1)
  return controls.map(
    control => controls.filter(other => distance(control, other) <= radiusMetres).length,
  )
}

export function crowding(
  stops: readonly LocalPoint[],
  radiusMetres: number,
  maxControls: number,
): Metric {
  const counts = crowdingCounts(stops, radiusMetres)
  const crowded = counts.flatMap((count, i) => (count > maxControls ? [i + 1] : []))
  return {
    value: counts.reduce((sum, count) => sum + Math.max(0, count - maxControls), 0),
    note:
      crowded.length === 0
        ? `at most ${maxControls} controls within ${radiusMetres} m`
        : `more than ${maxControls} controls within ${radiusMetres} m around ${crowded
            .map(controlName)
            .join(', ')}`,
  }
}

// Nearly every other term adds up per control, so without this a course with a few very long
// legs would score best. The target leg mix says how many legs a course of this length needs.
export function legCount(stops: readonly LocalPoint[], target: LegLengthTarget): Metric {
  const edges = target.binEdgesMetres
  const totalShare = target.shares.reduce((sum, share) => sum + share, 0) || 1
  const meanLeg = target.shares.reduce(
    (sum, share, bin) => sum + (share / totalShare) * ((edges[bin]! + edges[bin + 1]!) / 2),
    0,
  )
  const legs = legLengths(stops)
  const expected = legs.reduce((sum, leg) => sum + leg, 0) / Math.max(meanLeg, 1)
  if (expected < 1) return { value: 0, note: 'too short to judge' }
  return {
    value: Math.abs(legs.length - expected) / expected,
    note: `${legs.length} legs where the leg mix suggests about ${Math.round(expected)}`,
  }
}
