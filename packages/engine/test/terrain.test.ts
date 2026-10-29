import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTOUR_INTERVAL_METERS } from '@ratamestari/rules'
import { buildTerrain, withMapContourInterval } from '../src/terrain'
import { feature, line, SQUARE_KILOMETRE } from './fixtures'

const terrainDrawnWith = (contourIntervalMeters: number) =>
  buildTerrain([feature('101', line([0, 500], [1000, 500]))], SQUARE_KILOMETRE, {
    contourIntervalMeters,
    restrictToMappedArea: false,
  })

describe('withMapContourInterval', () => {
  it('uses the contour interval read from the map', () => {
    const terrain = withMapContourInterval(terrainDrawnWith(7), { contourIntervalMetres: 2.5 })
    expect(terrain.contourIntervalMeters).toBe(2.5)
  })

  it('falls back on the standard interval when the map does not say', () => {
    const other = DEFAULT_CONTOUR_INTERVAL_METERS.value + 1
    const terrain = withMapContourInterval(terrainDrawnWith(other), { contourIntervalMetres: null })
    expect(terrain.contourIntervalMeters).toBe(DEFAULT_CONTOUR_INTERVAL_METERS.value)
  })
})
