import {
  localExtent,
  localPoint,
  type LocalExtent,
  type LocalGeometry,
  type LocalPoint,
  type MapFeature,
} from '@ratamestari/core'
import type { ControlSiteCandidate } from '../src/control-sites'

export const SQUARE_KILOMETRE: LocalExtent = localExtent(0, 0, 1000, 1000)

export const feature = (
  isomCode: string | null,
  geometry: LocalGeometry,
  symbolRotationDegreesCounterClockwise = 0,
): MapFeature => ({
  symbolNumber: 0,
  isomCode,
  symbolRotationDegreesCounterClockwise,
  geometry,
})

export const rectangle = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): LocalGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      localPoint(minX, minY),
      localPoint(maxX, minY),
      localPoint(maxX, maxY),
      localPoint(minX, maxY),
      localPoint(minX, minY),
    ],
  ],
})

export const line = (...points: [number, number][]): LocalGeometry => ({
  type: 'LineString',
  coordinates: points.map(([x, y]): LocalPoint => localPoint(x, y)),
})

export const point = (x: number, y: number): LocalGeometry => ({
  type: 'Point',
  coordinates: localPoint(x, y),
})

export const polygon = (...points: [number, number][]): LocalGeometry => ({
  type: 'Polygon',
  coordinates: [points.map(([x, y]): LocalPoint => localPoint(x, y))],
})

export const controlSite = (
  x: number,
  y: number,
  overrides: Partial<ControlSiteCandidate> = {},
): ControlSiteCandidate => ({
  id: 0,
  position: localPoint(x, y),
  isomCode: '204',
  symbolNumber: 204000,
  placement: 'point',
  contourForm: null,
  distanceToLeadingFeatureMeters: 100,
  leadingFeatureDistance: 'far',
  inSlowTerrain: false,
  technicalDifficulty: 4,
  orientation: null,
  similarFeatureOffsets: [],
  flagSide: null,
  ...overrides,
})
