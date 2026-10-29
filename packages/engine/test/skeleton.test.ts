import { describe, expect, it } from 'vitest'
import { localExtent, localPoint, type MapFeature } from '@ratamestari/core'
import { courseTargetFor, TRAINING_DEFAULTS } from '@ratamestari/rules'
import { findControlSites } from '../src/control-sites'
import { planCourse, type CourseSpec } from '../src/course-search'
import { buildTerrain } from '../src/terrain'
import { feature, point } from './fixtures'

const SETUP_TIMEOUT_MS = 60_000

function boulderField(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  step: number,
): MapFeature[] {
  const boulders: MapFeature[] = []
  for (let x = minX; x <= maxX; x += step) {
    for (let y = minY; y <= maxY; y += step) boulders.push(feature('204', point(x, y)))
  }
  return boulders
}

const middleTarget = courseTargetFor({
  eventLevel: 'national',
  format: 'middle',
  sex: 'H',
  ageClass: 21,
  skillLetter: 'A',
})!

const spec = (overrides: Partial<CourseSpec> = {}): CourseSpec => ({
  target: middleTarget,
  format: 'middle',
  printScale: 10000,
  competitionCentre: localPoint(1500, 1500),
  seed: 1,
  ...overrides,
})

describe('planSkeleton', { timeout: SETUP_TIMEOUT_MS }, () => {
  // Two dense patches west and east of the centre, sparse terrain between and around them.
  const features = [
    ...boulderField(300, 900, 1200, 2100, 40),
    ...boulderField(1800, 900, 2700, 2100, 40),
    ...boulderField(100, 100, 2900, 2900, 400),
  ]
  const terrain = buildTerrain(features, localExtent(0, 0, 3000, 3000))
  const sites = findControlSites(features, terrain)

  it('chains the sections from the start through the connecting legs to the finish', () => {
    const plan = planCourse(terrain, sites, spec())!
    const skeleton = plan.skeleton!
    expect(plan.areas.length).toBeGreaterThanOrEqual(2)
    expect(skeleton.sections[0]!.entry).toBe(skeleton.start)
    expect(skeleton.sections.at(-1)!.exit).toBe('finish')
    skeleton.connectingLegs.forEach((leg, k) => {
      expect(skeleton.sections[k]!.exit).toBe(leg.from)
      expect(skeleton.sections[k + 1]!.entry).toBe(leg.to)
    })
  })

  it('gives every section a budget, together close to the winning time', () => {
    const skeleton = planCourse(terrain, sites, spec())!.skeleton!
    const target = middleTarget.winningTime.targetMinutes * 60
    expect(skeleton.sections.every(section => section.budgetSeconds > 0)).toBe(true)
    expect(Math.abs(skeleton.estimatedSeconds - target) / target).toBeLessThan(0.15)
  })

  it('repeats the same skeleton for the same seed', () => {
    const again = planCourse(terrain, sites, spec())!.skeleton!
    const first = planCourse(terrain, sites, spec())!.skeleton!
    expect(again).toEqual(first)
  })

  it("finds technical areas by the training rules' area rule", () => {
    const training = TRAINING_DEFAULTS.contour.middle
    const unreachable = { ...training.technicalAreas, minPoints: sites.length + 1 }
    const plan = planCourse(
      terrain,
      sites,
      spec({ training: { ...training, technicalAreas: unreachable } }),
    )
    expect(plan!.areas).toEqual([])
  })

  it('falls back to one section over the whole pool when the map has no technical areas', () => {
    const sparse = boulderField(100, 100, 2900, 2900, 400)
    const sparseTerrain = buildTerrain(sparse, localExtent(0, 0, 3000, 3000))
    const plan = planCourse(sparseTerrain, findControlSites(sparse, sparseTerrain), spec())!
    expect(plan.areas).toEqual([])
    expect(plan.skeleton!.sections).toHaveLength(1)
    expect(plan.skeleton!.sections[0]).toMatchObject({ area: null, exit: 'finish' })
  })
})
