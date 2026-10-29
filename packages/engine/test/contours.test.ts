import { describe, expect, it } from 'vitest'
import { localPoint, type LocalPoint } from '@ratamestari/core'
import { buildContourIndex, countContourCrossings, type ContourCrossings } from '../src/contours'
import { feature, line, point, rectangle, SQUARE_KILOMETRE } from './fixtures'

const CELL_SIZE_METERS = 5
const TICK_POINTS_NORTH = 0
const TICK_POINTS_SOUTH = 180

const contoursAt = (...ys: number[]) => ys.map(y => feature('101', line([0, y], [1000, y])))
const seaInTheSouth = feature('301', rectangle(0, 0, 1000, 50))

const squareRing = (halfWidth: number, clockwise = false) => {
  const corners: [number, number][] = [
    [500 - halfWidth, 500 - halfWidth],
    [500 + halfWidth, 500 - halfWidth],
    [500 + halfWidth, 500 + halfWidth],
    [500 - halfWidth, 500 + halfWidth],
  ]
  const ordered = clockwise ? corners.reverse() : corners
  return feature('101', line(...ordered, ordered[0]!))
}

const tickOnRing = (halfWidth: number, rotation: number) =>
  feature('101', point(500, 500 - halfWidth), rotation)

const route = (...points: [number, number][]): LocalPoint[] =>
  points.map(([x, y]) => localPoint(x, y))

const crossings = (
  features: Parameters<typeof buildContourIndex>[0],
  path: LocalPoint[],
): ContourCrossings =>
  countContourCrossings(buildContourIndex(features, SQUARE_KILOMETRE), path, CELL_SIZE_METERS)

const southToCenter = route([500, 60], [500, 500])
const southToNorth = route([500, 60], [500, 990])

describe('countContourCrossings', () => {
  it('counts crossings as unknown when nothing shows which way is up', () => {
    expect(crossings(contoursAt(200, 400, 600), southToNorth)).toEqual({
      up: 0,
      down: 0,
      unknown: 3,
    })
  })

  it('climbs away from sea or lakes', () => {
    expect(crossings([seaInTheSouth, ...contoursAt(200, 400, 600)], southToNorth)).toEqual({
      up: 3,
      down: 0,
      unknown: 0,
    })
    expect(
      crossings([seaInTheSouth, ...contoursAt(200, 400, 600)], route([500, 990], [500, 60])),
    ).toEqual({ up: 0, down: 3, unknown: 0 })
  })

  it('treats closed contours without slope ticks as knolls, drawn either way round', () => {
    const knoll = [squareRing(100), squareRing(200, true), squareRing(300)]
    expect(crossings(knoll, southToCenter)).toEqual({ up: 3, down: 0, unknown: 0 })
    expect(crossings(knoll, route([500, 500], [500, 60]))).toEqual({ up: 0, down: 3, unknown: 0 })
  })

  it('reads depressions from slope ticks pointing inwards', () => {
    const depression = [100, 200, 300].flatMap(h => [
      squareRing(h),
      tickOnRing(h, TICK_POINTS_NORTH),
    ])
    expect(crossings(depression, southToCenter)).toEqual({ up: 0, down: 3, unknown: 0 })
  })

  it('reads knolls from slope ticks pointing outwards', () => {
    const knoll = [100, 200].flatMap(h => [squareRing(h), tickOnRing(h, TICK_POINTS_SOUTH)])
    expect(crossings(knoll, southToCenter)).toEqual({ up: 2, down: 0, unknown: 0 })
  })

  it('continues the slope across unmarked contours', () => {
    expect(crossings([seaInTheSouth, ...contoursAt(200, 300, 500, 600)], southToNorth)).toEqual({
      up: 4,
      down: 0,
      unknown: 0,
    })
  })

  it('reads the slope where contours stop short of the map frame', () => {
    const forest = feature('405', rectangle(150, 0, 850, 1000))
    const sea = feature('301', rectangle(150, 0, 850, 50))
    const shortContours = [200, 400, 600].map(y => feature('101', line([200, y], [800, y])))
    expect(crossings([forest, sea, ...shortContours], southToNorth)).toEqual({
      up: 3,
      down: 0,
      unknown: 0,
    })
  })

  it('descends from knoll tops when the map has no water', () => {
    const knollOnTheSlope = [...contoursAt(200, 400), squareRing(100)]
    expect(crossings(knollOnTheSlope, southToCenter)).toEqual({ up: 3, down: 0, unknown: 0 })
  })

  it('turns downhill after a ridge where slope ticks say so', () => {
    const ridge = [
      seaInTheSouth,
      ...contoursAt(200, 300, 500, 600),
      feature('101', point(250, 500), TICK_POINTS_NORTH),
      feature('101', point(250, 600), TICK_POINTS_NORTH),
    ]
    expect(crossings(ridge, southToNorth)).toEqual({ up: 2, down: 2, unknown: 0 })
  })

  it('counts index contours but not form lines', () => {
    const lines = [
      feature('102', line([0, 200], [1000, 200])),
      feature('103', line([0, 400], [1000, 400])),
    ]
    const { up, down, unknown } = crossings(lines, southToNorth)
    expect(up + down + unknown).toBe(1)
  })

  it('ignores grid zigzag along a contour', () => {
    const zigzag = route(
      [100, 399],
      [110, 401],
      [120, 399],
      [130, 401],
      [140, 399],
      [150, 401],
      [160, 399],
    )
    expect(crossings(contoursAt(400), zigzag)).toEqual({ up: 0, down: 0, unknown: 0 })
  })

  it('ignores slope ticks drawn as short lines', () => {
    const tickLine = feature('101', line([495, 400], [505, 400]))
    expect(crossings([tickLine], southToNorth)).toEqual({ up: 0, down: 0, unknown: 0 })
  })

  it('finds crossings across bucket boundaries on long segments', () => {
    const { up, down, unknown } = crossings(contoursAt(1, 499, 999), route([0, 0], [1000, 1000]))
    expect(up + down + unknown).toBe(3)
  })
})
