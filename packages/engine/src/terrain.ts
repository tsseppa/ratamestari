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
import type { PeripheralInformation } from './peripheral'

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

export const withMapContourInterval = (
  terrain: Terrain,
  { contourIntervalMetres }: Pick<PeripheralInformation, 'contourIntervalMetres'>,
) => withContourInterval(terrain, contourIntervalMetres ?? DEFAULT_CONTOUR_INTERVAL_METERS.value)

// The interval is often known only after the terrain is built: read from the map's margin texts,
// or set by the user. Only the climb charged per contour depends on it.
export function withContourInterval(terrain: Terrain, contourIntervalMeters: number): Terrain {
  return {
    ...terrain,
    grid: {
      ...terrain.grid,
      contours: contourCellsOf(
        terrain.grid,
        terrain.contours.lines.map(line => line.points),
        contourIntervalMeters,
      ),
    },
    contourIntervalMeters,
  }
}
