import {
  localExtent,
  localPoint,
  type LocalExtent,
  type LocalPoint,
  type MapFeature,
} from '@ratamestari/core'
import {
  COURSE_OVERPRINT,
  OVERPRINT_DETAIL,
  OVERPRINT_LAYOUT,
  overprintGroundMetres as mm,
  type OverprintDetail,
} from '@ratamestari/rules'
import type { Course, Finding } from './course-search'
import { distanceToSegment } from './polyline'
import { reservedBoxesOf } from './print-area'

// An omitted part of a circle, in radians counter-clockwise from east (map north is up).
export interface Arc {
  readonly from: number
  readonly to: number
}

export type LinePiece = readonly [LocalPoint, LocalPoint]

// Where the overprint goes, in ground metres, so the map, the print and the renders all agree.
export interface OverprintLayout {
  // The centre of each control's number, one per control in course order.
  readonly numberCentres: readonly LocalPoint[]
  // The arcs left out of each control's circle.
  readonly circleCuts: readonly (readonly Arc[])[]
  // The drawn pieces of each leg, from the start to the finish.
  readonly legPieces: readonly (readonly LinePiece[])[]
  // Numbers that cover a circle, the start or the finish: [control, stop it covers].
  readonly findings: readonly Finding[]
}

interface DetailItem {
  readonly feature: number
  readonly from: LocalPoint
  readonly to: LocalPoint
  readonly radius: number
  readonly cutsCourse: boolean
  readonly numberWeight: number
}

export interface OverprintDetailIndex {
  near(extent: LocalExtent): readonly DetailItem[]
}

export const NO_OVERPRINT_DETAIL: OverprintDetailIndex = { near: () => [] }

const CELL_METRES = 50
const LINE_SAMPLE_METRES = 2
const FULL_TURN = 2 * Math.PI
const CONFLICT = 1000
const AMBIGUOUS = 500
// Covering a circle is worse than touching a line, so a crowded number gives way to the line.
const COVERS_STOP = 10 * CONFLICT
// Above any map detail a number may cover, so a farther ring is used only when the nearer is
// ruled out.
const FARTHER_RING = 100
// A number must be clearly nearer its own circle than any other, by this share of the radius.
const OWN_CIRCLE_MARGIN_SHARE = 0.5

const lineHalfWidth = mm(COURSE_OVERPRINT.courseLineWidthMillimetres) / 2
const controlRadius = mm(COURSE_OVERPRINT.controlCircleDiameterMillimetres) / 2
const startRadius = mm(COURSE_OVERPRINT.startTriangleSideMillimetres) / Math.sqrt(3)
const finishRadius = mm(COURSE_OVERPRINT.finishOuterDiameterMillimetres) / 2
const lineGap = mm(COURSE_OVERPRINT.courseLineGapMillimetres)
const clearance = mm(OVERPRINT_LAYOUT.cutClearanceMillimetres)

const distanceBetween = (a: LocalPoint, b: LocalPoint) => Math.hypot(b[0] - a[0], b[1] - a[1])

export function overprintDetailOf(features: readonly MapFeature[]): OverprintDetailIndex {
  const rules = new Map<string, OverprintDetail>()
  OVERPRINT_DETAIL.forEach(rule => rule.codes.forEach(code => rules.set(code, rule)))
  const cells = new Map<string, DetailItem[]>()
  const add = (item: DetailItem) => {
    const [minX, minY, maxX, maxY] = itemExtent(item)
    for (let cx = Math.floor(minX / CELL_METRES); cx <= Math.floor(maxX / CELL_METRES); cx++) {
      for (let cy = Math.floor(minY / CELL_METRES); cy <= Math.floor(maxY / CELL_METRES); cy++) {
        const key = `${cx},${cy}`
        const cell = cells.get(key)
        if (cell) cell.push(item)
        else cells.set(key, [item])
      }
    }
  }

  features.forEach((feature, index) => {
    const rule = feature.isomCode ? rules.get(feature.isomCode.slice(0, 3)) : undefined
    if (!rule) return
    const base = {
      feature: index,
      radius: mm(rule.sizeMillimetres) / 2,
      cutsCourse: rule.cutsCourse,
      numberWeight: rule.numberWeight,
    }
    const { geometry } = feature
    if (geometry.type === 'Point') {
      add({ ...base, from: geometry.coordinates, to: geometry.coordinates })
      return
    }
    if (rule.shape === 'point') return
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) add({ ...base, from: line[i - 1]!, to: line[i]! })
    }
  })

  return {
    near([minX, minY, maxX, maxY]) {
      const found = new Set<DetailItem>()
      for (let cx = Math.floor(minX / CELL_METRES); cx <= Math.floor(maxX / CELL_METRES); cx++) {
        for (let cy = Math.floor(minY / CELL_METRES); cy <= Math.floor(maxY / CELL_METRES); cy++) {
          cells.get(`${cx},${cy}`)?.forEach(item => found.add(item))
        }
      }
      return [...found]
    },
  }
}

function itemExtent({ from, to, radius }: DetailItem): LocalExtent {
  return around(
    [
      Math.min(from[0], to[0]),
      Math.min(from[1], to[1]),
      Math.max(from[0], to[0]),
      Math.max(from[1], to[1]),
    ],
    radius,
  )
}

const around = (
  [minX, minY, maxX, maxY]: readonly [number, number, number, number],
  margin: number,
): LocalExtent =>
  [minX - margin, minY - margin, maxX + margin, maxY + margin] as const as LocalExtent

const isPoint = (item: DetailItem) => item.from[0] === item.to[0] && item.from[1] === item.to[1]

export function layOutOverprint(
  course: Course,
  detail: OverprintDetailIndex = NO_OVERPRINT_DETAIL,
): OverprintLayout {
  const stops = [course.start.position, ...course.controls.map(c => c.position), course.finish]
  const radii = [startRadius, ...course.controls.map(() => controlRadius), finishRadius]
  const legPieces = stops.slice(1).map((to, i) => {
    const from = stops[i]!
    const leg = trimmedLeg(from, to, radii[i]! + lineGap, radii[i + 1]! + lineGap)
    return leg ? cutLeg(leg, detail) : []
  })
  const circleCuts = course.controls.map(control => cutCircle(control.position, detail))
  const numberCentres = placeNumbers(stops, legPieces, course, detail)
  return {
    numberCentres,
    circleCuts,
    legPieces,
    findings: numbersOverStops(stops, numberCentres),
  }
}

export function withNumberAt(course: Course, controlNumber: number, at: LocalPoint): Course {
  const centre = course.controls[controlNumber - 1]?.position
  if (!centre) return course
  const offsets = course.controls.map((_, i) => course.numberOffsets?.[i] ?? null)
  offsets[controlNumber - 1] = [at[0] - centre[0], at[1] - centre[1]]
  return { ...course, numberOffsets: offsets }
}

// The engine sets an edited course afresh; this keeps the numbers placed by hand with their
// controls, found by site so that renumbering does not lose them. A moved control keeps its
// number beside it.
export function numberOffsetsCarried(
  before: Course,
  after: Course,
  movedControlNumber: number | null = null,
): Course {
  const offsets = before.numberOffsets
  if (!offsets?.some(offset => offset)) return after
  const key = ({ id, position }: Course['controls'][number]) =>
    `${id}@${position[0]},${position[1]}`
  const byKey = new Map(
    before.controls.flatMap((site, i) => (offsets[i] ? [[key(site), offsets[i]!] as const] : [])),
  )
  const isSameCount = before.controls.length === after.controls.length
  const carried = after.controls.map((site, i) =>
    isSameCount && i === (movedControlNumber ?? 0) - 1
      ? (offsets[i] ?? null)
      : (byKey.get(key(site)) ?? null),
  )
  return carried.some(offset => offset) ? { ...after, numberOffsets: carried } : after
}

const fontSize = mm(COURSE_OVERPRINT.controlNumberHeightMillimetres)
const inkHalfHeight = (OVERPRINT_LAYOUT.numberInkHeightShareOfFontSize * fontSize) / 2

const numberHalfWidth = (controlNumber: number) =>
  (String(controlNumber).length * OVERPRINT_LAYOUT.numberWidthShareOfHeightPerDigit * fontSize) / 2

function numberExtent(controlNumber: number, centre: LocalPoint): LocalExtent {
  const halfWidth = numberHalfWidth(controlNumber)
  return localExtent(
    centre[0] - halfWidth,
    centre[1] - inkHalfHeight,
    centre[0] + halfWidth,
    centre[1] + inkHalfHeight,
  )
}

const stopRadiiOf = (stops: readonly LocalPoint[]) =>
  stops.map((_, i) =>
    i === 0 ? startRadius : i === stops.length - 1 ? finishRadius : controlRadius,
  )

function numbersOverStops(
  stops: readonly LocalPoint[],
  numberCentres: readonly LocalPoint[],
): Finding[] {
  const radii = stopRadiiOf(stops)
  return numberCentres.flatMap((centre, i) => {
    const extent = numberExtent(i + 1, centre)
    return stops.flatMap((stop, s) =>
      distanceToBox(stop, extent) < radii[s]! + lineHalfWidth
        ? [{ kind: 'numberOverCircle' as const, stops: [i + 1, s] }]
        : [],
    )
  })
}

function trimmedLeg(from: LocalPoint, to: LocalPoint, trimStart: number, trimEnd: number) {
  const length = distanceBetween(from, to)
  if (length <= trimStart + trimEnd) return null
  const ux = (to[0] - from[0]) / length
  const uy = (to[1] - from[1]) / length
  return [
    localPoint(from[0] + ux * trimStart, from[1] + uy * trimStart),
    localPoint(to[0] - ux * trimEnd, to[1] - uy * trimEnd),
  ] as const
}

type Interval = readonly [number, number]

function cutLeg([from, to]: LinePiece, detail: OverprintDetailIndex): LinePiece[] {
  const length = distanceBetween(from, to)
  const ux = (to[0] - from[0]) / length
  const uy = (to[1] - from[1]) / length
  const box = around(
    [
      Math.min(from[0], to[0]),
      Math.min(from[1], to[1]),
      Math.max(from[0], to[0]),
      Math.max(from[1], to[1]),
    ],
    clearance + lineHalfWidth,
  )
  const candidates: { interval: Interval; weight: number }[] = []
  for (const item of detail.near(box)) {
    if (!item.cutsCourse || !isPoint(item)) continue
    const offset = distanceToSegment(item.from, from, to)
    if (offset >= item.radius + lineHalfWidth) continue
    const reach = item.radius + lineHalfWidth + clearance
    const along = (item.from[0] - from[0]) * ux + (item.from[1] - from[1]) * uy
    const half = Math.sqrt(reach * reach - offset * offset)
    candidates.push({ interval: [along - half, along + half], weight: item.numberWeight })
  }
  candidates.sort((a, b) => b.weight - a.weight)

  const maxCut = OVERPRINT_LAYOUT.maxLegCutShare * length
  const minPiece = mm(OVERPRINT_LAYOUT.minLinePieceMillimetres)
  let cuts: Interval[] = []
  for (const { interval } of candidates) {
    const tried = mergeIntervals([...cuts, interval], length)
    const cutLength = tried.reduce((sum, [a, b]) => sum + b - a, 0)
    const pieces = piecesBetween(tried, length)
    const isAllowed =
      tried.length <= OVERPRINT_LAYOUT.maxLegCuts &&
      cutLength <= maxCut &&
      pieces.every(([a, b]) => b - a >= minPiece)
    if (isAllowed) cuts = tried
  }
  const at = (t: number) => localPoint(from[0] + ux * t, from[1] + uy * t)
  return piecesBetween(cuts, length).map(([a, b]) => [at(a), at(b)] as const)
}

function mergeIntervals(intervals: readonly Interval[], length: number): Interval[] {
  const clipped = intervals
    .map(([a, b]) => [Math.max(0, a), Math.min(length, b)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [a, b] of clipped) {
    const last = merged.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged
}

function piecesBetween(cuts: readonly Interval[], length: number): Interval[] {
  const pieces: Interval[] = []
  let start = 0
  for (const [a, b] of cuts) {
    if (a > start) pieces.push([start, a])
    start = b
  }
  if (start < length) pieces.push([start, length])
  return pieces
}

function cutCircle(centre: LocalPoint, detail: OverprintDetailIndex): Arc[] {
  const reachOf = (item: DetailItem) => item.radius + lineHalfWidth + clearance
  const box = around(
    [centre[0], centre[1], centre[0], centre[1]],
    controlRadius + lineHalfWidth + clearance,
  )
  const candidates: { arc: Arc; weight: number }[] = []
  // Cut only where the symbol touches the circle's ink, but leave white beyond it.
  const arcAround = (point: LocalPoint, touch: number, reach: number): Arc | null => {
    const d = distanceBetween(point, centre)
    if (d === 0 || Math.abs(d - controlRadius) >= touch) return null
    const cosine = (controlRadius ** 2 + d ** 2 - reach ** 2) / (2 * controlRadius * d)
    const half = Math.acos(Math.max(-1, Math.min(1, cosine)))
    const direction = Math.atan2(point[1] - centre[1], point[0] - centre[0])
    return { from: direction - half, to: direction + half }
  }
  for (const item of detail.near(box)) {
    if (!item.cutsCourse) continue
    const reach = reachOf(item)
    const length = distanceBetween(item.from, item.to)
    const samples = Math.max(1, Math.ceil(length / LINE_SAMPLE_METRES))
    const arcs: Arc[] = []
    for (let s = 0; s <= samples; s++) {
      const t = s / samples
      const point = localPoint(
        item.from[0] + (item.to[0] - item.from[0]) * t,
        item.from[1] + (item.to[1] - item.from[1]) * t,
      )
      const arc = arcAround(point, item.radius + lineHalfWidth, reach)
      if (arc) arcs.push(arc)
      if (length === 0) break
    }
    for (const arc of mergeArcs(arcs)) candidates.push({ arc, weight: item.numberWeight })
  }
  candidates.sort((a, b) => b.weight - a.weight || arcLength(a.arc) - arcLength(b.arc))

  let cuts: Arc[] = []
  for (const { arc } of candidates) {
    const tried = mergeArcs([...cuts, arc])
    const share = tried.reduce((sum, a) => sum + arcLength(a), 0) / FULL_TURN
    if (
      tried.length <= OVERPRINT_LAYOUT.maxCircleCuts &&
      share <= OVERPRINT_LAYOUT.maxCircleCutShare
    )
      cuts = tried
  }
  return cuts
}

const arcLength = (arc: Arc) => arc.to - arc.from

const normalised = (angle: number) => ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN

// Arcs that overlap become one, also across east. Each starts in [0, 2π) and may end past 2π.
export function mergeArcs(arcs: readonly Arc[]): Arc[] {
  const pieces: [number, number][] = []
  for (const arc of arcs) {
    const from = normalised(arc.from)
    const to = from + Math.min(FULL_TURN, arcLength(arc))
    if (to <= FULL_TURN) pieces.push([from, to])
    else pieces.push([from, FULL_TURN], [0, to - FULL_TURN])
  }
  pieces.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [from, to] of pieces) {
    const last = merged.at(-1)
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  const first = merged[0]
  const last = merged.at(-1)
  if (first && last && merged.length > 1 && first[0] === 0 && last[1] === FULL_TURN) {
    merged.shift()
    last[1] = FULL_TURN + first[1]
  }
  return merged.map(([from, to]) => ({ from, to: Math.min(to, from + FULL_TURN) }))
}

// The parts of a circle that are drawn: everything between its cuts, or null for the whole circle.
export function drawnArcs(cuts: readonly Arc[]): Arc[] | null {
  if (cuts.length === 0) return null
  const sorted = [...cuts].sort((a, b) => a.from - b.from)
  return sorted.map((cut, i) => {
    const next = sorted[i + 1]
    return { from: cut.to, to: next ? next.from : sorted[0]!.from + FULL_TURN }
  })
}

interface NumberBox {
  readonly centre: LocalPoint
  readonly extent: LocalExtent
}

function placeNumbers(
  stops: readonly LocalPoint[],
  legPieces: readonly (readonly LinePiece[])[],
  course: Course,
  detail: OverprintDetailIndex,
): LocalPoint[] {
  const controls = stops.slice(1, -1)
  const numberGap = mm(OVERPRINT_LAYOUT.numberGapMillimetres)
  const ringStep = mm(OVERPRINT_LAYOUT.numberRingStepMillimetres)
  const pieces = legPieces.flat()
  const stopRadii = stopRadiiOf(stops)
  const area = course.printArea
  const reserved = area ? reservedBoxesOf(area) : []
  const boxAt = (control: number, centre: LocalPoint): NumberBox => ({
    centre,
    extent: numberExtent(control + 1, centre),
  })

  const candidatesOf = (control: number): { box: NumberBox; ring: number }[] => {
    const centre = controls[control]!
    const halfWidth = numberHalfWidth(control + 1)
    return Array.from({ length: OVERPRINT_LAYOUT.numberRings }, (_, ring) =>
      Array.from({ length: OVERPRINT_LAYOUT.numberPositions }, (_, j) => {
        const angle = (FULL_TURN * j) / OVERPRINT_LAYOUT.numberPositions
        const [dx, dy] = [Math.cos(angle), Math.sin(angle)]
        const reach =
          controlRadius +
          lineHalfWidth +
          numberGap +
          ring * ringStep +
          halfWidth * Math.abs(dx) +
          inkHalfHeight * Math.abs(dy)
        return {
          box: boxAt(control, localPoint(centre[0] + dx * reach, centre[1] + dy * reach)),
          ring,
        }
      }),
    ).flat()
  }

  const fixedCost = (control: number, box: NumberBox): number => {
    const own = controls[control]!
    let cost = 0
    if (pieces.some(([a, b]) => segmentNearBox(a, b, box.extent, lineHalfWidth))) cost += CONFLICT
    stops.forEach((stop, i) => {
      if (i === control + 1) return
      if (distanceToBox(stop, box.extent) < stopRadii[i]! + lineHalfWidth) cost += COVERS_STOP
    })
    if (area && !insideExtent(box.extent, area.extent)) cost += CONFLICT
    if (reserved.some(extent => boxesOverlap(box.extent, extent))) cost += CONFLICT
    const ownDistance = distanceBetween(box.centre, own)
    const margin = OWN_CIRCLE_MARGIN_SHARE * controlRadius
    if (
      controls.some(
        (other, i) => i !== control && distanceBetween(box.centre, other) < ownDistance + margin,
      )
    )
      cost += AMBIGUOUS
    const covered = new Map<number, number>()
    for (const item of detail.near(box.extent)) {
      if (distanceSegmentToBox(item.from, item.to, box.extent) < item.radius)
        covered.set(item.feature, item.numberWeight)
    }
    for (const weight of covered.values()) cost += weight
    return cost + OVERPRINT_LAYOUT.outsideOfBendPreference * bendCost(control, box.centre)
  }

  const bendCost = (control: number, at: LocalPoint): number => {
    const centre = controls[control]!
    const unit = (p: LocalPoint) => {
      const d = distanceBetween(p, centre) || 1
      return [(p[0] - centre[0]) / d, (p[1] - centre[1]) / d] as const
    }
    const [ax, ay] = unit(stops[control]!)
    const [bx, by] = unit(stops[control + 2]!)
    const outside = [-(ax + bx), -(ay + by)] as const
    const outsideLength = Math.hypot(...outside)
    if (outsideLength < 1e-9) return 0
    const [px, py] = unit(at)
    return (1 - (px * outside[0] + py * outside[1]) / outsideLength) / 2
  }

  const options = controls.map((_, control) =>
    candidatesOf(control).map(({ box, ring }) => ({
      box,
      cost: fixedCost(control, box) + ring * FARTHER_RING,
    })),
  )
  const handPlaced = controls.map((centre, control) => {
    const offset = course.numberOffsets?.[control]
    return offset ? boxAt(control, localPoint(centre[0] + offset[0], centre[1] + offset[1])) : null
  })
  const placed: (NumberBox | null)[] = [...handPlaced]
  const costWithOthers = (control: number, option: { box: NumberBox; cost: number }) =>
    option.cost +
    placed.reduce(
      (sum, other, i) =>
        sum +
        (i !== control && other && boxesOverlap(option.box.extent, other.extent) ? CONFLICT : 0),
      0,
    )
  const best = (control: number) =>
    options[control]!.reduce((a, b) =>
      costWithOthers(control, b) < costWithOthers(control, a) ? b : a,
    )

  const mostConstrainedFirst = controls
    .map((_, control) => control)
    .filter(control => !handPlaced[control])
    .sort(
      (a, b) =>
        options[a]!.filter(o => o.cost < CONFLICT).length -
        options[b]!.filter(o => o.cost < CONFLICT).length,
    )
  for (const control of mostConstrainedFirst) placed[control] = best(control).box
  for (const control of mostConstrainedFirst) placed[control] = best(control).box
  return placed.map(box => box!.centre)
}

function segmentNearBox(a: LocalPoint, b: LocalPoint, box: LocalExtent, margin: number): boolean {
  return distanceSegmentToBox(a, b, box) < margin
}

function distanceToBox(point: LocalPoint, [minX, minY, maxX, maxY]: LocalExtent): number {
  const dx = Math.max(minX - point[0], 0, point[0] - maxX)
  const dy = Math.max(minY - point[1], 0, point[1] - maxY)
  return Math.hypot(dx, dy)
}

function distanceSegmentToBox(a: LocalPoint, b: LocalPoint, box: LocalExtent): number {
  if (segmentCrossesBox(a, b, box)) return 0
  const [minX, minY, maxX, maxY] = box
  const corners = [
    localPoint(minX, minY),
    localPoint(maxX, minY),
    localPoint(maxX, maxY),
    localPoint(minX, maxY),
  ]
  return Math.min(
    distanceToBox(a, box),
    distanceToBox(b, box),
    ...corners.map(corner => distanceToSegment(corner, a, b)),
  )
}

// Liang–Barsky clipping: does any part of the segment lie inside the box?
function segmentCrossesBox(a: LocalPoint, b: LocalPoint, [minX, minY, maxX, maxY]: LocalExtent) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let enter = 0
  let leave = 1
  const sides: readonly (readonly [number, number])[] = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ]
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) enter = Math.max(enter, t)
    else leave = Math.min(leave, t)
    if (enter > leave) return false
  }
  return true
}

const boxesOverlap = (a: LocalExtent, b: LocalExtent) =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

const insideExtent = (inner: LocalExtent, outer: LocalExtent) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
