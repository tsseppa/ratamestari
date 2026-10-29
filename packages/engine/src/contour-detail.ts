import type { LocalPoint } from '@ratamestari/core'
import type { ContourDetailRule } from '@ratamestari/rules'
import type { ControlSiteCandidate } from './control-sites'
import { cellCenterOf } from './raster'
import type { Terrain } from './terrain'

const SAMPLE_SPACING_METERS = 5
const BUCKET_SIZE_METERS = 25
const NORMALISING_PERCENTILE = 0.9

// Degrees of contour turn beyond the noise limit, summed per bucket of ground.
function bendBuckets(lines: Terrain['reliefLines'], rule: ContourDetailRule) {
  const buckets = new Map<string, number>()
  const span = Math.max(1, Math.round(rule.bendSpanMeters / SAMPLE_SPACING_METERS))
  for (const line of lines) {
    const samples = resample(line, SAMPLE_SPACING_METERS)
    for (let i = span; i + span < samples.length; i++) {
      const turn = turnDegrees(samples[i - span]!, samples[i]!, samples[i + span]!)
      if (turn <= rule.minBendDegrees) continue
      const [x, y] = samples[i]!
      const key = bucketKey(Math.floor(x / BUCKET_SIZE_METERS), Math.floor(y / BUCKET_SIZE_METERS))
      buckets.set(key, (buckets.get(key) ?? 0) + turn - rule.minBendDegrees)
    }
  }
  return buckets
}

// Scaled against the mapped terrain, not the sites: sites crowd into the most detailed hillside,
// which would make every other hillside look poor.
export function contourDetailQuality(
  sites: readonly ControlSiteCandidate[],
  terrain: Terrain,
  rule: ContourDetailRule,
): Float32Array {
  const buckets = bendBuckets(terrain.reliefLines, rule)
  const reach = Math.ceil(rule.neighbourhoodRadiusMeters / BUCKET_SIZE_METERS)
  const detailAround = ([x, y]: LocalPoint) => {
    const column = Math.floor(x / BUCKET_SIZE_METERS)
    const row = Math.floor(y / BUCKET_SIZE_METERS)
    let total = 0
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const centreX = (column + dx + 0.5) * BUCKET_SIZE_METERS
        const centreY = (row + dy + 0.5) * BUCKET_SIZE_METERS
        if (Math.hypot(centreX - x, centreY - y) > rule.neighbourhoodRadiusMeters) continue
        total += buckets.get(bucketKey(column + dx, row + dy)) ?? 0
      }
    }
    return total
  }
  const terrainDetail = mappedSamples(terrain)
    .map(detailAround)
    .sort((a, b) => a - b)
  const reference =
    terrainDetail[Math.floor(NORMALISING_PERCENTILE * (terrainDetail.length - 1))] || 1
  return Float32Array.from(sites, site => Math.min(1, detailAround(site.position) / reference))
}

function mappedSamples({ grid, mappedArea }: Terrain): LocalPoint[] {
  const samples: LocalPoint[] = []
  const step = Math.max(1, Math.round(BUCKET_SIZE_METERS / grid.cellSizeMeters))
  for (let row = 0; row < grid.rows; row += step) {
    for (let column = 0; column < grid.columns; column += step) {
      if (!mappedArea[row * grid.columns + column]) continue
      samples.push(cellCenterOf(grid, row * grid.columns + column))
    }
  }
  return samples
}

const bucketKey = (column: number, row: number) => `${column},${row}`

function resample(points: readonly LocalPoint[], spacing: number): LocalPoint[] {
  const samples: LocalPoint[] = []
  let carried = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!
    const [bx, by] = points[i]!
    const length = Math.hypot(bx - ax, by - ay)
    let along = carried
    for (; along < length; along += spacing) {
      const t = along / length
      samples.push([ax + (bx - ax) * t, ay + (by - ay) * t] as const as LocalPoint)
    }
    carried = along - length
  }
  return samples
}

function turnDegrees(before: LocalPoint, at: LocalPoint, after: LocalPoint): number {
  const headingIn = Math.atan2(at[1] - before[1], at[0] - before[0])
  const headingOut = Math.atan2(after[1] - at[1], after[0] - at[0])
  const turn = Math.abs(headingOut - headingIn) % (2 * Math.PI)
  return ((turn > Math.PI ? 2 * Math.PI - turn : turn) * 180) / Math.PI
}
