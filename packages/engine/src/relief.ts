import type { LocalExtent, LocalPoint, MapFeature } from '@ratamestari/core'
import { drawingDirectionsOf } from './drawing-direction'
import { mappedAreaMask } from './mapped-area'
import { distanceToSegment } from './polyline'
import { cellIndexOf, fillPolygon, traceLine, type GridFrame } from './raster'

export interface ContourLine {
  readonly points: readonly LocalPoint[]
  readonly isClosed: boolean
}

export const LEFT_IS_UPHILL = 1
export const RIGHT_IS_UPHILL = -1
export const UPHILL_UNKNOWN = 0
type UphillSide = typeof LEFT_IS_UPHILL | typeof RIGHT_IS_UPHILL | typeof UPHILL_UNKNOWN

const REGION_CELL_SIZE_METERS = 2.5
const SIDE_SAMPLE_OFFSET_CELLS = 1.5
const SIDE_SAMPLE_SPACING_METERS = 10
const SLOPE_TICK_MAX_DISTANCE_FROM_CONTOUR_METERS = 3
const SLOPE_TICK_ISOM_CODE = '101'
const WATER_ISOM_CODES = new Set(['301', '302'])
// Contours often stop short of the map frame, at the edge of the mapped area, which would join the
// land on both sides around the end. Such an end is extended to the frame to keep the sides apart.
const MAPPED_EDGE_MAX_DISTANCE_FROM_END_METERS = 100
// A slope tick is drawn by the mapper; that a closed contour is a knoll is only the likelier guess.
const SLOPE_TICK_WEIGHT_AGAINST_RINGS = 10
const NONE = -1
const DESCENDING = -1
const CLIMBING = 1

interface Seed {
  readonly region: number
  readonly slope: number
}

interface Edge {
  readonly line: number
  readonly to: number
  readonly levelChange: number | null
}

export function computeUphillSides(
  lines: readonly ContourLine[],
  features: readonly MapFeature[],
  extent: LocalExtent,
): Int8Array {
  const tickVotes = slopeTickVotes(lines, features)
  const evidence = uphillEvidence(lines, tickVotes)
  const drawn = drawingDirectionsOf(lines)
  const uphillWhenDrawnWithMap = drawn && uphillSideOfDrawing(lines, drawn, tickVotes, evidence)
  if (drawn && uphillWhenDrawnWithMap) {
    return Int8Array.from(lines, (_, id): UphillSide =>
      tickVotes[id]! !== 0
        ? (Math.sign(tickVotes[id]!) as UphillSide)
        : ((uphillWhenDrawnWithMap * drawn[id]!) as UphillSide),
    )
  }

  const frame = regionFrame(extent)
  const contourAt = new Int32Array(frame.columns * frame.rows).fill(NONE)
  lines.forEach((line, id) =>
    traceLine(frame, line.points, i => {
      if (contourAt[i] === NONE) contourAt[i] = id
    }),
  )
  const mappedArea = mappedAreaMask(features, frame)
  lines.forEach((line, id) => {
    if (!line.isClosed) extendEndsToFrame(frame, contourAt, mappedArea, line.points, id)
  })
  const { regionAt, regionCount } = labelRegions(frame, contourAt)
  const sides = lines.map(line => sideRegions(frame, regionAt, line.points))
  const levels = solveRegionLevels(
    regionCount,
    sides,
    evidence,
    waterRegions(frame, regionAt, features),
    summitsAndFloors(lines, sides, evidence),
  )

  return Int8Array.from(lines, (_, id): UphillSide => {
    if (evidence[id] !== UPHILL_UNKNOWN) return evidence[id] as UphillSide
    const { left, right } = sides[id]!
    if (left === NONE || right === NONE) return UPHILL_UNKNOWN
    const leftLevel = levels.level[left]!
    const rightLevel = levels.level[right]!
    const isComparable =
      !Number.isNaN(leftLevel) &&
      !Number.isNaN(rightLevel) &&
      levels.component[left] === levels.component[right] &&
      leftLevel !== rightLevel
    if (!isComparable) return UPHILL_UNKNOWN
    return leftLevel > rightLevel ? LEFT_IS_UPHILL : RIGHT_IS_UPHILL
  })
}

function regionFrame([minX, minY, maxX, maxY]: LocalExtent): GridFrame {
  return {
    minX,
    minY,
    cellSizeMeters: REGION_CELL_SIZE_METERS,
    columns: Math.max(1, Math.ceil((maxX - minX) / REGION_CELL_SIZE_METERS)),
    rows: Math.max(1, Math.ceil((maxY - minY) / REGION_CELL_SIZE_METERS)),
  }
}

function extendEndsToFrame(
  frame: GridFrame,
  contourAt: Int32Array,
  mappedArea: Uint8Array,
  points: readonly LocalPoint[],
  id: number,
) {
  if (points.length < 2) return
  const extend = (end: LocalPoint, inward: LocalPoint) => {
    const length = Math.hypot(end[0] - inward[0], end[1] - inward[1])
    if (length === 0) return
    const stepX = ((end[0] - inward[0]) / length) * frame.cellSizeMeters
    const stepY = ((end[1] - inward[1]) / length) * frame.cellSizeMeters
    const cells: number[] = []
    let hasLeftMappedArea = false
    for (let step = 1; ; step++) {
      const index = cellIndexOf(frame, [
        end[0] + stepX * step,
        end[1] + stepY * step,
      ] as const as LocalPoint)
      if (index === null) break
      if (contourAt[index] !== NONE && contourAt[index] !== id) break
      if (mappedArea[index]) {
        if (hasLeftMappedArea) break
        if (step * frame.cellSizeMeters > MAPPED_EDGE_MAX_DISTANCE_FROM_END_METERS) return
      } else {
        hasLeftMappedArea = true
      }
      cells.push(index)
    }
    if (hasLeftMappedArea) cells.forEach(i => (contourAt[i] = id))
  }
  extend(points[0]!, points[1]!)
  extend(points[points.length - 1]!, points[points.length - 2]!)
}

// The innermost region of a closed contour is a summit or the floor of a depression: the land
// falls away from a summit and rises from a floor, as it rises from water.
function summitsAndFloors(
  lines: readonly ContourLine[],
  sides: readonly { left: number; right: number }[],
  evidence: Int8Array,
): Seed[] {
  const linesAround = new Map<number, number>()
  for (const { left, right } of sides) {
    if (left === NONE) continue
    linesAround.set(left, (linesAround.get(left) ?? 0) + 1)
    linesAround.set(right, (linesAround.get(right) ?? 0) + 1)
  }
  return lines.flatMap((line, id): Seed[] => {
    const { left, right } = sides[id]!
    if (!line.isClosed || left === NONE || evidence[id] === UPHILL_UNKNOWN) return []
    const insideIsLeft = signedArea(line.points) > 0
    const inside = insideIsLeft ? left : right
    if (linesAround.get(inside) !== 1) return []
    const insideIsUphill = evidence[id] === (insideIsLeft ? LEFT_IS_UPHILL : RIGHT_IS_UPHILL)
    return [{ region: inside, slope: insideIsUphill ? DESCENDING : CLIMBING }]
  })
}

function labelRegions(frame: GridFrame, contourAt: Int32Array) {
  const regionAt = new Int32Array(contourAt.length).fill(NONE)
  let nextRegion = 0
  const stack: number[] = []
  for (let seed = 0; seed < regionAt.length; seed++) {
    if (contourAt[seed] !== NONE || regionAt[seed] !== NONE) continue
    const region = nextRegion++
    regionAt[seed] = region
    stack.push(seed)
    while (stack.length > 0) {
      const cell = stack.pop()!
      const column = cell % frame.columns
      const neighbours = [
        column > 0 ? cell - 1 : NONE,
        column < frame.columns - 1 ? cell + 1 : NONE,
        cell >= frame.columns ? cell - frame.columns : NONE,
        cell + frame.columns < regionAt.length ? cell + frame.columns : NONE,
      ]
      for (const next of neighbours) {
        if (next === NONE || contourAt[next] !== NONE || regionAt[next] !== NONE) continue
        regionAt[next] = region
        stack.push(next)
      }
    }
  }
  return { regionAt, regionCount: nextRegion }
}

function sideRegions(
  frame: GridFrame,
  regionAt: Int32Array,
  points: readonly LocalPoint[],
): { left: number; right: number } {
  const leftVotes = new Map<number, number>()
  const rightVotes = new Map<number, number>()
  const offset = SIDE_SAMPLE_OFFSET_CELLS * frame.cellSizeMeters
  const vote = (votes: Map<number, number>, x: number, y: number) => {
    const index = cellIndexOf(frame, [x, y] as const as LocalPoint)
    const region = index === null ? NONE : regionAt[index]!
    if (region !== NONE) votes.set(region, (votes.get(region) ?? 0) + 1)
  }
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!
    const [bx, by] = points[i]!
    const length = Math.hypot(bx - ax, by - ay)
    if (length === 0) continue
    const normalX = -(by - ay) / length
    const normalY = (bx - ax) / length
    const samples = Math.max(1, Math.round(length / SIDE_SAMPLE_SPACING_METERS))
    for (let s = 0; s < samples; s++) {
      const t = (s + 0.5) / samples
      const x = ax + (bx - ax) * t
      const y = ay + (by - ay) * t
      vote(leftVotes, x + normalX * offset, y + normalY * offset)
      vote(rightVotes, x - normalX * offset, y - normalY * offset)
    }
  }
  const left = mostVoted(leftVotes)
  const right = mostVoted(rightVotes)
  return left === right ? { left: NONE, right: NONE } : { left, right }
}

function mostVoted(votes: ReadonlyMap<number, number>): number {
  let best = NONE
  let bestCount = 0
  for (const [region, count] of votes) {
    if (count > bestCount) {
      best = region
      bestCount = count
    }
  }
  return best
}

// The uphill side of a line drawn the map's way, from the ticks and closed contours, each read
// against its own line's drawing direction; null when nothing tells.
function uphillSideOfDrawing(
  lines: readonly ContourLine[],
  drawn: Int8Array,
  tickVotes: Int32Array,
  evidence: Int8Array,
): typeof LEFT_IS_UPHILL | typeof RIGHT_IS_UPHILL | null {
  let vote = 0
  lines.forEach((line, id) => {
    if (tickVotes[id]! !== 0) {
      vote += Math.sign(tickVotes[id]!) * drawn[id]! * SLOPE_TICK_WEIGHT_AGAINST_RINGS
    } else if (line.isClosed) {
      vote += evidence[id]! * drawn[id]!
    }
  })
  return vote > 0 ? LEFT_IS_UPHILL : vote < 0 ? RIGHT_IS_UPHILL : null
}

function slopeTickVotes(lines: readonly ContourLine[], features: readonly MapFeature[]) {
  const tickVotes = new Int32Array(lines.length)
  for (const feature of features) {
    if (feature.isomCode !== SLOPE_TICK_ISOM_CODE || feature.geometry.type !== 'Point') continue
    const tick = feature.geometry.coordinates
    const nearest = nearestSegment(lines, tick)
    if (!nearest || nearest.distance > SLOPE_TICK_MAX_DISTANCE_FROM_CONTOUR_METERS) continue
    const radians = (feature.symbolRotationDegreesCounterClockwise * Math.PI) / 180
    const downhillX = -Math.sin(radians)
    const downhillY = Math.cos(radians)
    const [a, b] = nearest.segment
    const pointsLeft = (b[0] - a[0]) * downhillY - (b[1] - a[1]) * downhillX > 0
    tickVotes[nearest.line]! += pointsLeft ? RIGHT_IS_UPHILL : LEFT_IS_UPHILL
  }
  return tickVotes
}

function uphillEvidence(lines: readonly ContourLine[], tickVotes: Int32Array): Int8Array {
  return Int8Array.from(lines, (line, id): UphillSide => {
    if (tickVotes[id]! !== 0) return Math.sign(tickVotes[id]!) as UphillSide
    if (!line.isClosed) return UPHILL_UNKNOWN
    return signedArea(line.points) > 0 ? LEFT_IS_UPHILL : RIGHT_IS_UPHILL
  })
}

function nearestSegment(lines: readonly ContourLine[], point: LocalPoint) {
  let best: { line: number; segment: [LocalPoint, LocalPoint]; distance: number } | null = null
  lines.forEach(({ points }, line) => {
    for (let i = 1; i < points.length; i++) {
      const distance = distanceToSegment(point, points[i - 1]!, points[i]!)
      if (!best || distance < best.distance) {
        best = { line, segment: [points[i - 1]!, points[i]!], distance }
      }
    }
  })
  return best as { line: number; segment: [LocalPoint, LocalPoint]; distance: number } | null
}

function signedArea(points: readonly LocalPoint[]): number {
  let twiceArea = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    twiceArea += x1 * y2 - x2 * y1
  }
  return twiceArea / 2
}

function waterRegions(
  frame: GridFrame,
  regionAt: Int32Array,
  features: readonly MapFeature[],
): Set<number> {
  const regions = new Set<number>()
  for (const { isomCode, geometry } of features) {
    if (isomCode === null || !WATER_ISOM_CODES.has(isomCode) || geometry.type !== 'Polygon') {
      continue
    }
    fillPolygon(frame, geometry.coordinates, i => {
      if (regionAt[i] !== NONE) regions.add(regionAt[i]!)
    })
  }
  return regions
}

function solveRegionLevels(
  regionCount: number,
  sides: readonly { left: number; right: number }[],
  evidence: Int8Array,
  lowestRegions: ReadonlySet<number>,
  summitsAndFloors: readonly Seed[],
) {
  const edges: Edge[][] = Array.from({ length: regionCount }, () => [])
  sides.forEach(({ left, right }, line) => {
    if (left === NONE || right === NONE) return
    const leftMinusRight = evidence[line] === UPHILL_UNKNOWN ? null : evidence[line]!
    edges[left]!.push({
      line,
      to: right,
      levelChange: leftMinusRight === null ? null : -leftMinusRight,
    })
    edges[right]!.push({ line, to: left, levelChange: leftMinusRight })
  })

  const level = new Float64Array(regionCount).fill(Number.NaN)
  const guesses = new Float64Array(regionCount).fill(Number.POSITIVE_INFINITY)
  const entrySlope = new Int8Array(regionCount)
  const component = new Int32Array(regionCount).fill(NONE)
  const queue: number[] = []

  const relaxFrom = (seedComponent: number) => {
    while (queue.length > 0) {
      const region = queue.shift()!
      for (const edge of edges[region]!) {
        const isGuess = edge.levelChange === null
        const change = edge.levelChange ?? entrySlope[region]!
        if (change === 0) continue
        const cost = guesses[region]! + (isGuess ? 1 : 0)
        if (cost >= guesses[edge.to]!) continue
        guesses[edge.to] = cost
        level[edge.to] = level[region]! + change
        entrySlope[edge.to] = change
        component[edge.to] = seedComponent
        if (isGuess) queue.push(edge.to)
        else queue.unshift(edge.to)
      }
    }
  }

  const seed = (region: number, slope: number, seedComponent: number) => {
    level[region] = 0
    guesses[region] = 0
    entrySlope[region] = slope
    component[region] = seedComponent
    queue.push(region)
  }

  let nextComponent = 0
  if (lowestRegions.size > 0) {
    lowestRegions.forEach(region => seed(region, CLIMBING, nextComponent))
    relaxFrom(nextComponent++)
  }
  for (const { region, slope } of summitsAndFloors) {
    if (component[region] !== NONE) continue
    seed(region, slope, nextComponent)
    relaxFrom(nextComponent++)
  }
  for (let region = 0; region < regionCount; region++) {
    if (component[region] !== NONE || edges[region]!.length === 0) continue
    seed(region, 0, nextComponent)
    relaxFrom(nextComponent++)
  }
  return { level, component }
}
