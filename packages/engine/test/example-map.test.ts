import { beforeAll, describe, expect, it } from 'vitest'
import { localPoint, type LocalPoint } from '@ratamestari/core'
import { loadOcadMap } from '@ratamestari/map-import-ocad'
import { isomSymbolRule } from '@ratamestari/rules'
import { BLOCKED, type CostGrid } from '../src/cost-grid'
import { findControlSites } from '../src/control-sites'
import { evaluateLeg } from '../src/leg'
import { cellCenterOf, cellIndexOf } from '../src/raster'
import { findRoute } from '../src/router'
import { secondsFrom } from '../src/time-tree'
import { buildTerrain, type Terrain } from '../src/terrain'
import { localMapExists, readLocalMap } from './local-map'

const LEG_LENGTH_METERS = 2000
const LARGE_MAP_SETUP_TIMEOUT_MS = 60_000
const BARRIER_MOVEMENTS = new Set([
  'impassable',
  'forbidden',
  'forbiddenAlong',
  'forbiddenExceptLevelCrossings',
])

describe.skipIf(!localMapExists)('engine with a local map from git-ignored maps/', () => {
  let terrain: Terrain
  let features: Parameters<typeof findControlSites>[0]
  let grid: CostGrid
  let from: LocalPoint
  let to: LocalPoint

  beforeAll(async () => {
    const map = await loadOcadMap(readLocalMap())
    features = map.features()
    terrain = buildTerrain(features, map.info.extent)
    grid = terrain.grid
    const mapped = [...terrain.mappedArea.keys()].filter(i => terrain.mappedArea[i])
    const middle = mapped
      .map(i => cellCenterOf(grid, i))
      .reduce(
        ([x, y], p) => localPoint(x + p[0] / mapped.length, y + p[1] / mapped.length),
        localPoint(0, 0),
      )
    const sites = findControlSites(features, terrain)
    from = sites.reduce((best, site) =>
      Math.hypot(site.position[0] - middle[0], site.position[1] - middle[1]) <
      Math.hypot(best.position[0] - middle[0], best.position[1] - middle[1])
        ? site
        : best,
    ).position
    const seconds = secondsFrom(grid, from, 240, Number.POSITIVE_INFINITY)
    let bestIndex = 0
    let bestError = Number.POSITIVE_INFINITY
    seconds.forEach((s, i) => {
      if (s === Number.POSITIVE_INFINITY) return
      const [x, y] = cellCenterOf(grid, i)
      const error = Math.abs(Math.hypot(x - from[0], y - from[1]) - LEG_LENGTH_METERS)
      if (error < bestError) {
        bestError = error
        bestIndex = i
      }
    })
    to = cellCenterOf(grid, bestIndex)
  }, LARGE_MAP_SETUP_TIMEOUT_MS)

  // A contour-only map, such as one made with Karttapullautin, may have no barriers at all.
  it('finds the mapped area, with open terrain and any barriers inside it', () => {
    const hasBarriers = features.some(
      ({ isomCode }) =>
        isomCode !== null && BARRIER_MOVEMENTS.has(isomSymbolRule(isomCode)?.movement.kind ?? ''),
    )
    const mappedCells = [...terrain.mappedArea.keys()].filter(i => terrain.mappedArea[i])
    const mappedShare = mappedCells.length / terrain.mappedArea.length
    const blockedShare =
      mappedCells.filter(i => grid.speed[i] === BLOCKED).length / mappedCells.length
    expect(mappedShare).toBeGreaterThan(0.1)
    expect(mappedShare).toBeLessThan(1)
    if (hasBarriers) expect(blockedShare).toBeGreaterThan(0)
    expect(blockedShare).toBeLessThan(0.5)
  })

  it('finds a route across the map', () => {
    const route = findRoute(grid, from, to)!
    const straight = Math.hypot(to[0] - from[0], to[1] - from[1])
    expect(route.lengthMeters).toBeGreaterThanOrEqual(straight)
    expect(route.timeSeconds).toBeGreaterThan(0)
  })

  it('evaluates a leg across the map, including contour crossings', () => {
    const leg = evaluateLeg(terrain, from, to)!
    expect(leg.lengthRatio).toBeGreaterThanOrEqual(1)
    expect(leg.contourCrossings).toBeGreaterThan(0)
  })

  it('finds reachable control sites of several difficulties', () => {
    const sites = findControlSites(features, terrain)
    expect(sites.length).toBeGreaterThan(0)
    expect(new Set(sites.map(s => s.technicalDifficulty)).size).toBeGreaterThan(1)
    expect(sites.every(s => terrain.mappedArea[cellIndexOf(grid, s.position)!] === 1)).toBe(true)
  })
})
