import { describe, expect, it } from 'vitest'
import type { LocalPoint, MapFeature } from '@ratamestari/core'
import { isomSymbolRule } from '@ratamestari/rules'
import { loadOcadMap } from '../src/load'
import { localMapExists, readLocalMap } from './local-map'

const pointsOf = ({ geometry }: MapFeature): readonly LocalPoint[] => {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates]
    case 'LineString':
      return geometry.coordinates
    case 'Polygon':
      return geometry.coordinates.flat()
  }
}

const movementKindOf = (feature: MapFeature) =>
  feature.isomCode === null ? undefined : isomSymbolRule(feature.isomCode)?.movement.kind

describe.skipIf(!localMapExists)('OcadMap.features with a local map from git-ignored maps/', () => {
  const bytes = localMapExists ? readLocalMap() : new Uint8Array()

  it('reads nearly every object of a printed symbol as a feature', async () => {
    const map = await loadOcadMap(bytes)
    const printedObjectCount = map
      .symbols()
      .filter(symbol => !symbol.isHidden)
      .reduce((sum, symbol) => sum + symbol.objectCount, 0)
    expect(map.features().length).toBeLessThanOrEqual(printedObjectCount)
    expect(map.features().length).toBeGreaterThanOrEqual(0.99 * printedObjectCount)
  })

  it('places all features inside the map extent', async () => {
    const map = await loadOcadMap(bytes)
    const [minX, minY, maxX, maxY] = map.info.extent
    const toleranceMeters = 1
    const outside = map
      .features()
      .flatMap(pointsOf)
      .filter(
        ([x, y]) =>
          x < minX - toleranceMeters ||
          x > maxX + toleranceMeters ||
          y < minY - toleranceMeters ||
          y > maxY + toleranceMeters,
      )
    expect(outside).toEqual([])
  })

  it('gives most features an ISOM code the rules know', async () => {
    const map = await loadOcadMap(bytes)
    const features = map.features()
    const known = features.filter(f => movementKindOf(f) !== undefined)
    expect(known.length / features.length).toBeGreaterThan(0.5)
    expect(new Set(known.map(movementKindOf))).toContain('runnability')
  })

  it('applies per-map ISOM code corrections without reading the map again', async () => {
    const map = await loadOcadMap(bytes)
    const corrected = map.features()[0]!.symbolNumber
    const features = map.features(new Map([[corrected, '520']]))
    const overridden = features.filter(f => f.symbolNumber === corrected)
    expect(overridden.length).toBeGreaterThan(0)
    for (const feature of overridden) expect(feature.isomCode).toBe('520')
    expect(map.features().find(f => f.symbolNumber === corrected)!.isomCode).not.toBe('520')
  })

  it('can take a symbol out of use', async () => {
    const map = await loadOcadMap(bytes)
    const ignored = map.features()[0]!.symbolNumber
    const features = map.features(new Map([[ignored, null]]))
    expect(features.filter(f => f.symbolNumber === ignored).every(f => f.isomCode === null)).toBe(
      true,
    )
  })

  it('lists the symbols in use with their names and object counts', async () => {
    const map = await loadOcadMap(bytes)
    const symbols = map.symbols()
    expect(symbols.reduce((sum, s) => sum + s.objectCount, 0)).toBe(map.objectCount)
    expect(symbols.some(s => s.name.length > 0)).toBe(true)
  })

  it('reads point symbol rotation in degrees', async () => {
    const map = await loadOcadMap(bytes)
    const rotations = map.features().map(f => f.symbolRotationDegreesCounterClockwise)
    expect(rotations.every(r => r >= 0 && r < 360)).toBe(true)
    expect(rotations.some(r => r !== 0)).toBe(true)
  })

  it('reads features once and reuses them', async () => {
    const map = await loadOcadMap(bytes)
    expect(map.features()).toBe(map.features())
  })
})
