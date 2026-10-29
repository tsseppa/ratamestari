import { describe, expect, it } from 'vitest'
import { localPoint } from '@ratamestari/core'
import { courseLengthMeters, measureCourse, shortestPassableMeters } from '../src/course-length'
import { buildCostGrid } from '../src/cost-grid'
import { buildTerrain, withContourInterval } from '../src/terrain'
import { feature, line, rectangle, SQUARE_KILOMETRE } from './fixtures'

describe('course length (Lajisäännöt 11.22)', () => {
  it('measures the shortest route, ignoring how fast the terrain is', () => {
    const grid = buildCostGrid(
      [feature('410', rectangle(300, 0, 700, 1000)), feature('505', line([0, 900], [1000, 900]))],
      SQUARE_KILOMETRE,
    )
    const meters = shortestPassableMeters(grid, localPoint(100, 500), localPoint(900, 500))
    expect(meters).toBeCloseTo(800, -1)
  })

  it('goes around impassable and forbidden areas', () => {
    const grid = buildCostGrid([feature('520', rectangle(400, 0, 600, 800))], SQUARE_KILOMETRE)
    const meters = shortestPassableMeters(grid, localPoint(100, 500), localPoint(900, 500))
    const overTheTop = 2 * Math.hypot(300, 300) + 200
    expect(meters).toBeGreaterThanOrEqual(overTheTop)
    expect(meters).toBeLessThan(overTheTop * 1.05)
  })

  it('adds up the legs of a course', () => {
    const grid = buildCostGrid([], SQUARE_KILOMETRE)
    const stops = [localPoint(100, 100), localPoint(100, 500), localPoint(500, 500)]
    expect(courseLengthMeters(grid, stops)).toBeCloseTo(800, -1)
  })

  it('measures climb along the legs from the contours crossed uphill', () => {
    const water = feature('301', rectangle(0, 0, 1000, 50))
    const contours = [300, 500, 700].map(y => feature('101', line([0, y], [1000, y])))
    const terrain = buildTerrain([water, ...contours], SQUARE_KILOMETRE, {
      restrictToMappedArea: false,
    })
    const stops = [localPoint(500, 100), localPoint(500, 900), localPoint(600, 100)]
    const measured = measureCourse(terrain, stops)
    expect(measured.climbMeters).toBe(15)
    expect(measured.lengthMeters).toBeGreaterThan(1600)
  })

  it('measures climb by the contour interval the map is drawn with', () => {
    const water = feature('301', rectangle(0, 0, 1000, 50))
    const contours = [300, 500, 700].map(y => feature('101', line([0, y], [1000, y])))
    const terrain = buildTerrain([water, ...contours], SQUARE_KILOMETRE, {
      restrictToMappedArea: false,
    })
    const stops = [localPoint(500, 100), localPoint(500, 900), localPoint(600, 100)]
    const measured = measureCourse(withContourInterval(terrain, 2.5), stops)
    expect(measured.climbMeters).toBe(7.5)
  })
})
