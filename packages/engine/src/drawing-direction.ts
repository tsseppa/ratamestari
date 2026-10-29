import type { ContourLine } from './relief'

// Contours traced from an elevation model, as on Karttapullautin maps, are all drawn with the same
// side uphill, so neighbouring contours run the same way. On hand-drawn maps they run either way.
const SAMPLE_SPACING_METERS = 5
const NEIGHBOUR_MAX_DISTANCE_METERS = 25
const PARALLEL_MIN_COSINE = 0.8
const CONSISTENT_MIN_SHARE = 0.8
const MIN_PARALLEL_NEIGHBOURS = 200
export const DRAWN_WITH_MAP = 1
export const DRAWN_AGAINST_MAP = -1

interface Sample {
  readonly x: number
  readonly y: number
  readonly dx: number
  readonly dy: number
  readonly line: number
}

// For a map whose contours keep one drawing direction, whether each line follows it; null when
// the map has no such rule. A line edited by hand may be drawn against the rest.
export function drawingDirectionsOf(lines: readonly ContourLine[]): Int8Array | null {
  const samples = lines.flatMap((line, id) => samplesAlong(line, id))
  const buckets = new Map<string, number[]>()
  const keyOf = (x: number, y: number) =>
    `${Math.floor(x / NEIGHBOUR_MAX_DISTANCE_METERS)},${Math.floor(y / NEIGHBOUR_MAX_DISTANCE_METERS)}`
  samples.forEach((sample, i) => {
    const key = keyOf(sample.x, sample.y)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(i)
    else buckets.set(key, [i])
  })

  const sameWay = new Int32Array(lines.length)
  const otherWay = new Int32Array(lines.length)
  for (const sample of samples) {
    const neighbour = nearestOnOtherLine(sample, samples, buckets)
    if (!neighbour) continue
    const cosine = sample.dx * neighbour.dx + sample.dy * neighbour.dy
    if (cosine >= PARALLEL_MIN_COSINE) sameWay[sample.line]!++
    else if (cosine <= -PARALLEL_MIN_COSINE) otherWay[sample.line]!++
  }

  const same = sameWay.reduce((sum, count) => sum + count, 0)
  const other = otherWay.reduce((sum, count) => sum + count, 0)
  if (same + other < MIN_PARALLEL_NEIGHBOURS || same / (same + other) < CONSISTENT_MIN_SHARE) {
    return null
  }
  return Int8Array.from(lines, (_, id) =>
    otherWay[id]! > sameWay[id]! ? DRAWN_AGAINST_MAP : DRAWN_WITH_MAP,
  )
}

function samplesAlong({ points }: ContourLine, line: number): Sample[] {
  const samples: Sample[] = []
  let untilNext = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!
    const [bx, by] = points[i]!
    const length = Math.hypot(bx - ax, by - ay)
    if (length === 0) continue
    const dx = (bx - ax) / length
    const dy = (by - ay) / length
    for (; untilNext < length; untilNext += SAMPLE_SPACING_METERS) {
      samples.push({ x: ax + dx * untilNext, y: ay + dy * untilNext, dx, dy, line })
    }
    untilNext -= length
  }
  return samples
}

function nearestOnOtherLine(
  sample: Sample,
  samples: readonly Sample[],
  buckets: ReadonlyMap<string, readonly number[]>,
): Sample | null {
  const column = Math.floor(sample.x / NEIGHBOUR_MAX_DISTANCE_METERS)
  const row = Math.floor(sample.y / NEIGHBOUR_MAX_DISTANCE_METERS)
  let nearest: Sample | null = null
  let nearestDistance = NEIGHBOUR_MAX_DISTANCE_METERS
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      for (const i of buckets.get(`${column + dc},${row + dr}`) ?? []) {
        const other = samples[i]!
        if (other.line === sample.line) continue
        const distance = Math.hypot(other.x - sample.x, other.y - sample.y)
        if (distance < nearestDistance) {
          nearest = other
          nearestDistance = distance
        }
      }
    }
  }
  return nearest
}
