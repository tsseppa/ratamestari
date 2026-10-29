import type { LocalExtent, LocalPoint, MapFeature } from '@ratamestari/core'
import { DEFAULT_CONTOUR_INTERVAL_METERS, isomSymbolRule } from '@ratamestari/rules'
import { buildContourIndex, type ContourIndex } from './contours'
import {
  BLOCKED,
  buildCostGrid,
  contourCellsOf,
  type CostGrid,
  type CostGridOptions,
} from './cost-grid'
import { mappedAreaMask } from './mapped-area'

export interface Terrain {
  readonly grid: CostGrid
  readonly contours: ContourIndex
  readonly contourIntervalMeters: number
  readonly mappedArea: Uint8Array
  // Contours, index contours and form lines: the relief as drawn, for measuring its detail.
  readonly reliefLines: readonly (readonly LocalPoint[])[]
}

const isReliefLine = (isomCode: string | null) =>
  isomCode !== null && isomSymbolRule(isomCode)?.controlSite === 'contourShape'

export interface TerrainOptions extends CostGridOptions {
  readonly contourIntervalMeters?: number
  readonly restrictToMappedArea?: boolean
}

export function buildTerrain(
  features: readonly MapFeature[],
  extent: LocalExtent,
  {
    contourIntervalMeters = DEFAULT_CONTOUR_INTERVAL_METERS.value,
    restrictToMappedArea = true,
    ...gridOptions
  }: TerrainOptions = {},
): Terrain {
  const contours = buildContourIndex(features, extent)
  const flatGrid = buildCostGrid(features, extent, gridOptions)
  const grid: CostGrid = {
    ...flatGrid,
    contours: contourCellsOf(
      flatGrid,
      contours.lines.map(line => line.points),
      contourIntervalMeters,
    ),
  }
  const mappedArea = restrictToMappedArea
    ? mappedAreaMask(features, grid)
    : new Uint8Array(grid.speed.length).fill(1)
  mappedArea.forEach((isMapped, i) => {
    if (!isMapped) grid.speed[i] = BLOCKED
  })
  return {
    grid,
    contours,
    contourIntervalMeters,
    mappedArea,
    reliefLines: features.flatMap(({ isomCode, geometry }) =>
      isReliefLine(isomCode) && geometry.type === 'LineString' ? [geometry.coordinates] : [],
    ),
  }
}
