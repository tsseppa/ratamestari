import { describe, expect, it } from 'vitest'
import { localPoint, type LocalPoint, type MapFeature } from '@ratamestari/core'
import { COURSE_OVERPRINT, OVERPRINT_LAYOUT, overprintGroundMetres } from '@ratamestari/rules'
import type { Course } from '../src/course-search'
import {
  drawnArcs,
  layOutOverprint,
  mergeArcs,
  numberOffsetsCarried,
  overprintDetailOf,
  withNumberAt,
} from '../src/overprint-layout'
import { distanceToSegment } from '../src/polyline'

const radius = overprintGroundMetres(COURSE_OVERPRINT.controlCircleDiameterMillimetres) / 2
const fontSize = overprintGroundMetres(COURSE_OVERPRINT.controlNumberHeightMillimetres)

const courseThrough = (...points: LocalPoint[]) =>
  ({
    start: { position: points[0] },
    controls: points.slice(1, -1).map((position, i) => ({ id: `site-${i}`, position })),
    finish: points.at(-1),
    printArea: null,
  }) as unknown as Course

const point = (isomCode: string, at: LocalPoint): MapFeature => ({
  symbolNumber: Number(isomCode) * 1000,
  isomCode,
  symbolRotationDegreesCounterClockwise: 0,
  geometry: { type: 'Point', coordinates: at },
})

const line = (isomCode: string, ...coordinates: LocalPoint[]): MapFeature => ({
  symbolNumber: Number(isomCode) * 1000,
  isomCode,
  symbolRotationDegreesCounterClockwise: 0,
  geometry: { type: 'LineString', coordinates },
})

describe('overprint layout', () => {
  const control = localPoint(0, 0)

  it('draws whole circles and one line per leg when nothing is under them', () => {
    const layout = layOutOverprint(courseThrough(localPoint(-600, 0), control, localPoint(600, 0)))
    expect(layout.circleCuts).toEqual([[]])
    expect(layout.legPieces.map(pieces => pieces.length)).toEqual([1, 1])
  })

  it('keeps a number off the course lines', () => {
    const next = localPoint(400, 400)
    const course = courseThrough(localPoint(-600, 0), control, next, localPoint(900, 0))
    const [number] = layOutOverprint(course).numberCentres
    expect(distanceToSegment(number!, control, next)).toBeGreaterThan(fontSize / 2)
    expect(distanceToSegment(number!, localPoint(-600, 0), control)).toBeGreaterThan(fontSize / 2)
  })

  it('places a number nearer its own circle than any other', () => {
    const course = courseThrough(
      localPoint(-600, 0),
      control,
      localPoint(110, 0),
      localPoint(110, 600),
    )
    const [first, second] = layOutOverprint(course).numberCentres
    const own = (n: LocalPoint, c: LocalPoint) => Math.hypot(n[0] - c[0], n[1] - c[1])
    expect(own(first!, control)).toBeLessThan(own(first!, localPoint(110, 0)))
    expect(own(second!, localPoint(110, 0))).toBeLessThan(own(second!, control))
  })

  it('moves a number off a path', () => {
    const course = courseThrough(localPoint(-600, -600), control, localPoint(600, -600))
    const pathAt = (y: number) => line('505', localPoint(-200, y), localPoint(200, y))
    const free = layOutOverprint(course).numberCentres[0]!
    const detail = overprintDetailOf([pathAt(free[1])])
    const moved = layOutOverprint(course, detail).numberCentres[0]!
    expect(Math.abs(moved[1] - free[1])).toBeGreaterThan(fontSize / 2)
  })

  it('cuts a circle where it passes over a boulder', () => {
    const detail = overprintDetailOf([point('204', localPoint(radius, 0))])
    const course = courseThrough(localPoint(0, -600), control, localPoint(0, 600))
    const [cuts] = layOutOverprint(course, detail).circleCuts
    expect(cuts).toHaveLength(1)
    const [cut] = cuts!
    expect(cut!.from < 0.01 || cut!.from > 6).toBe(true)
    expect(cut!.to - cut!.from).toBeLessThan(Math.PI / 4)
  })

  it('keeps a cut circle recognisable', () => {
    const boulders = Array.from({ length: 12 }, (_, i) => {
      const angle = (i * Math.PI) / 6
      return point('205', localPoint(radius * Math.cos(angle), radius * Math.sin(angle)))
    })
    const course = courseThrough(localPoint(0, -600), control, localPoint(0, 600))
    const [cuts] = layOutOverprint(course, overprintDetailOf(boulders)).circleCuts
    const share = cuts!.reduce((sum, arc) => sum + arc.to - arc.from, 0) / (2 * Math.PI)
    expect(cuts!.length).toBeLessThanOrEqual(OVERPRINT_LAYOUT.maxCircleCuts)
    expect(share).toBeLessThanOrEqual(OVERPRINT_LAYOUT.maxCircleCutShare)
    expect(cuts!.length).toBeGreaterThan(0)
  })

  it('does not cut a circle for a path', () => {
    const detail = overprintDetailOf([
      line('505', localPoint(-100, radius), localPoint(100, radius)),
    ])
    const course = courseThrough(localPoint(0, -600), control, localPoint(600, 0))
    expect(layOutOverprint(course, detail).circleCuts).toEqual([[]])
  })

  it('cuts a course line over a boulder, leaving no short pieces', () => {
    const course = courseThrough(localPoint(-600, 0), localPoint(0, 0), localPoint(600, 0))
    const middle = overprintDetailOf([point('204', localPoint(-300, 0))])
    expect(layOutOverprint(course, middle).legPieces[0]).toHaveLength(2)
    const nearEnd = overprintDetailOf([point('204', localPoint(-600 + 45, 0))])
    expect(layOutOverprint(course, nearEnd).legPieces[0]).toHaveLength(1)
  })
})

describe('merging arcs', () => {
  it('joins arcs that overlap across east', () => {
    const merged = mergeArcs([
      { from: -0.2, to: 0.1 },
      { from: 0.05, to: 0.3 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.to - merged[0]!.from).toBeCloseTo(0.5)
  })

  it('keeps separate arcs apart', () => {
    expect(
      mergeArcs([
        { from: 1, to: 1.2 },
        { from: 3, to: 3.1 },
      ]),
    ).toHaveLength(2)
  })
})

describe('drawn arcs', () => {
  it('draws the whole circle without cuts', () => {
    expect(drawnArcs([])).toBeNull()
  })

  it('draws what lies between the cuts, round past east', () => {
    const drawn = drawnArcs([
      { from: 3, to: 3.5 },
      { from: 1, to: 1.5 },
    ])!
    expect(drawn).toEqual([
      { from: 1.5, to: 3 },
      { from: 3.5, to: 1 + 2 * Math.PI },
    ])
  })
})

describe('control numbers on circles', () => {
  it('moves a number farther out when every place next to its circle covers another', () => {
    const cluster = [
      [14, 231],
      [252, 71],
      [177, 310],
      [97, 182],
      [270, 245],
      [203, 203],
      [50, 84],
      [1, 322],
      [122, 3],
      [140, 99],
    ].map(([x = 0, y = 0]) => localPoint(x, y))
    const course = courseThrough(localPoint(-300, -300), ...cluster, localPoint(800, 800))
    expect(layOutOverprint(course).findings).toEqual([])
  })

  it('leaves a number placed by hand where it was put', () => {
    const course = courseThrough(localPoint(-600, 0), localPoint(0, 0), localPoint(600, 0))
    const placed = withNumberAt(course, 1, localPoint(0, 300))
    expect(layOutOverprint(placed).numberCentres[0]).toEqual(localPoint(0, 300))
  })

  it('finds a number placed by hand on its own circle or another', () => {
    const course = courseThrough(
      localPoint(-600, 0),
      localPoint(0, 0),
      localPoint(300, 0),
      localPoint(600, 0),
    )
    const onOwn = withNumberAt(course, 1, localPoint(10, 0))
    expect(layOutOverprint(onOwn).findings).toEqual([{ kind: 'numberOverCircle', stops: [1, 1] }])
    const onNext = withNumberAt(course, 1, localPoint(300, 0))
    expect(layOutOverprint(onNext).findings).toEqual([{ kind: 'numberOverCircle', stops: [1, 2] }])
  })

  it('keeps a number placed by hand with its control when the controls are renumbered', () => {
    const [a, b, c] = [localPoint(0, 0), localPoint(300, 0), localPoint(600, 0)]
    const before = withNumberAt(
      courseThrough(localPoint(-600, 0), a, b, c, localPoint(900, 0)),
      2,
      localPoint(300, 80),
    )
    const { numberOffsets: _setAfresh, ...edited } = before
    const after = { ...edited, controls: edited.controls.slice(1) }
    expect(numberOffsetsCarried(before, after).numberOffsets).toEqual([[0, 80], null])
  })

  it('moves a number placed by hand along with its control', () => {
    const before = withNumberAt(
      courseThrough(localPoint(-600, 0), localPoint(0, 0), localPoint(600, 0)),
      1,
      localPoint(0, 80),
    )
    const moved = courseThrough(localPoint(-600, 0), localPoint(50, 50), localPoint(600, 0))
    const after = numberOffsetsCarried(before, moved, 1)
    expect(after.numberOffsets).toEqual([[0, 80]])
    expect(layOutOverprint(after).numberCentres[0]).toEqual(localPoint(50, 130))
  })

  it('finds a number placed by hand on the start or the finish', () => {
    const course = courseThrough(localPoint(-600, 0), localPoint(0, 0), localPoint(600, 0))
    const onStart = withNumberAt(course, 1, localPoint(-600, 0))
    expect(layOutOverprint(onStart).findings).toEqual([{ kind: 'numberOverCircle', stops: [1, 0] }])
    const onFinish = withNumberAt(course, 1, localPoint(600, 0))
    expect(layOutOverprint(onFinish).findings).toEqual([
      { kind: 'numberOverCircle', stops: [1, 2] },
    ])
  })

  it('returns the course unchanged when no number was placed by hand', () => {
    const before = courseThrough(localPoint(-600, 0), localPoint(0, 0), localPoint(600, 0))
    const after = courseThrough(localPoint(-600, 0), localPoint(50, 50), localPoint(600, 0))
    expect(numberOffsetsCarried(before, after)).toBe(after)
  })

  it('drops the offset of a control replaced by a different site', () => {
    const before = withNumberAt(
      courseThrough(localPoint(-600, 0), localPoint(0, 0), localPoint(600, 0)),
      1,
      localPoint(0, 80),
    )
    const replaced = courseThrough(localPoint(-600, 0), localPoint(200, 100), localPoint(600, 0))
    const after = numberOffsetsCarried(before, replaced)
    expect(after).toBe(replaced)
    expect(after.numberOffsets).toBeUndefined()
  })
})
