import { describe, expect, it } from 'vitest'
import { localPoint } from '@ratamestari/core'
import { DRAWN_AGAINST_MAP, DRAWN_WITH_MAP, drawingDirectionsOf } from '../src/drawing-direction'
import type { ContourLine } from '../src/relief'

const eastward = (y: number, length = 1000): ContourLine => ({
  points: [localPoint(0, y), localPoint(length, y)],
  isClosed: false,
})
const westward = (y: number, length = 1000): ContourLine => ({
  points: [localPoint(length, y), localPoint(0, y)],
  isClosed: false,
})

const tenMetresApart = (count: number, from = 100) =>
  Array.from({ length: count }, (_, i) => from + i * 10)

describe('drawingDirectionsOf', () => {
  it('marks every line as drawn with the map when neighbouring contours run the same way', () => {
    const directions = drawingDirectionsOf(tenMetresApart(20).map(y => eastward(y)))
    expect(directions).not.toBeNull()
    expect([...directions!]).toEqual(Array(20).fill(DRAWN_WITH_MAP))
  })

  it('flags a single line drawn against the rest', () => {
    const lines = [
      ...tenMetresApart(10, 100).map(y => eastward(y)),
      westward(205),
      ...tenMetresApart(10, 220).map(y => eastward(y)),
    ]
    const directions = drawingDirectionsOf(lines)
    expect(directions).not.toBeNull()
    expect([...directions!]).toEqual([
      ...Array(10).fill(DRAWN_WITH_MAP),
      DRAWN_AGAINST_MAP,
      ...Array(10).fill(DRAWN_WITH_MAP),
    ])
  })

  it('flags a closed contour drawn the other way round among concentric ones', () => {
    const ring = (halfWidth: number, clockwise: boolean): ContourLine => {
      const corners = [
        localPoint(500 - halfWidth, 500 - halfWidth),
        localPoint(500 + halfWidth, 500 - halfWidth),
        localPoint(500 + halfWidth, 500 + halfWidth),
        localPoint(500 - halfWidth, 500 + halfWidth),
      ]
      const ordered = clockwise ? corners.reverse() : corners
      return { points: [...ordered, ordered[0]!], isClosed: true }
    }
    const lines = [
      ...tenMetresApart(10, 50).map(h => ring(h, false)),
      ring(155, true),
      ...tenMetresApart(10, 170).map(h => ring(h, false)),
    ]
    const directions = drawingDirectionsOf(lines)
    expect(directions?.[10]).toBe(DRAWN_AGAINST_MAP)
    expect([...directions!].filter(direction => direction === DRAWN_WITH_MAP)).toHaveLength(20)
  })

  it('finds no rule when neighbouring contours run either way, as on hand-drawn maps', () => {
    const lines = tenMetresApart(20).map((y, i) => (i % 2 === 0 ? eastward(y) : westward(y)))
    expect(drawingDirectionsOf(lines)).toBeNull()
  })

  it('finds no rule from too few parallel neighbours', () => {
    expect(drawingDirectionsOf([eastward(100, 495), eastward(110, 495)])).toBeNull()
    expect(drawingDirectionsOf([eastward(100, 500), eastward(110, 500)])).not.toBeNull()
  })

  it('does not count contours farther apart than neighbours', () => {
    const farApart = Array.from({ length: 20 }, (_, i) => eastward(100 + i * 30))
    expect(drawingDirectionsOf(farApart)).toBeNull()
  })

  it('finds no rule on a map without contours', () => {
    expect(drawingDirectionsOf([])).toBeNull()
  })
})
