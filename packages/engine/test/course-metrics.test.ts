import { describe, expect, it } from 'vitest'
import { localPoint, type LocalPoint } from '@ratamestari/core'
import { FORMAT_QUALITY } from '@ratamestari/rules'
import {
  alternation,
  closeness,
  crowding,
  crowdingCounts,
  legCount,
  parallelLegs,
  convexHullArea,
  crossingSeverity,
  directionChanges,
  firstLegTowardsFinish,
  legLengthDistribution,
  reversals,
  ring,
  routeDoglegs,
  signedTurns,
  spread,
} from '../src/course-metrics'

const course = (...points: [number, number][]): LocalPoint[] =>
  points.map(([x, y]) => localPoint(x, y))

const square = course([0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 10])
const zigzag = course([0, 0], [400, 300], [800, 0], [1200, 300], [1600, 0], [2000, 300])

describe('course metrics', () => {
  it('measures turns at the controls, left positive', () => {
    expect(signedTurns(square).map(Math.round)).toEqual([90, 90, 90])
  })

  it('finds a reversal and weighs it by the shorter leg', () => {
    const shortBack = reversals(course([0, 0], [1000, 0], [900, 5], [900, 500]))
    const longBack = reversals(course([0, 0], [1000, 0], [0, 50], [0, 500]))
    expect(shortBack.value).toBeGreaterThan(0)
    expect(longBack.value).toBeGreaterThan(shortBack.value * 5)
    expect(longBack.note).toBe('turns back at control 1')
    expect(reversals(square).value).toBe(0)
  })

  it('calls a long course that always turns the same way a ring', () => {
    const circle = Array.from({ length: 12 }, (_, i): [number, number] => [
      1000 * Math.cos((i * Math.PI) / 6),
      1000 * Math.sin((i * Math.PI) / 6),
    ])
    expect(ring(course(...circle)).value).toBeCloseTo(1)
    expect(ring(zigzag).value).toBe(0)
  })

  it('accepts a short course that is a small loop', () => {
    expect(ring(square).value).toBe(0)
    expect(ring(square).note).toBe('100% of the turning goes the same way')
  })

  it('rates crossings far from controls at a right angle as mild', () => {
    const stops = course([0, 0], [1000, 0], [500, -500], [500, 500])
    const far = crossingSeverity(stops[0]!, stops[1]!, stops[2]!, stops[3]!, stops)
    const nearControl = crossingSeverity(
      stops[0]!,
      stops[1]!,
      localPoint(950, -300),
      localPoint(950, 300),
      [...stops, localPoint(950, 300)],
    )
    const shallow = crossingSeverity(
      localPoint(0, 0),
      localPoint(1000, 0),
      localPoint(0, -30),
      localPoint(1000, 30),
      course([0, 0], [1000, 0], [0, -1000], [1000, 1000]),
    )
    expect(far).toBeCloseTo(0.2)
    expect(nearControl).toBeGreaterThan(0.8)
    expect(shallow).toBeGreaterThan(0.9)
  })

  it('compares leg lengths with the target distribution', () => {
    const middleTarget = FORMAT_QUALITY.middle.legLengths
    const shortLegs = course([0, 0], [200, 0], [200, 200], [0, 200], [0, 400], [200, 400])
    const longLegs = course([0, 0], [1500, 0], [1500, 1500], [0, 1500])
    expect(legLengthDistribution(shortLegs, middleTarget).value).toBeLessThan(
      legLengthDistribution(longLegs, middleTarget).value,
    )
    expect(legLengthDistribution(shortLegs, middleTarget).note).toBe('100% of legs are 150–300 m')
  })

  it('finds runs of legs of similar length', () => {
    const monotonous = alternation(zigzag)
    expect(monotonous.value).toBeGreaterThan(0.5)
    expect(monotonous.note).toBe('similar lengths in legs 1–5')
    const varied = course([0, 0], [100, 0], [100, 900], [400, 900], [400, 2000])
    expect(alternation(varied).value).toBe(0)
  })

  it('compares the share of real direction changes with the target', () => {
    expect(directionChanges(square, 0.75).value).toBe(0)
    const doubledBack = course([0, 0], [500, 0], [0, 40], [500, 80])
    expect(directionChanges(doubledBack, 0.75).value).toBe(0.75)
    expect(directionChanges(course([0, 0], [500, 0], [1000, 50], [1500, 0]), 0.75).value).toBe(0.75)
  })

  it('counts gentle bends as changes of direction when the threshold is lower', () => {
    const gentle = course([0, 0], [500, 0], [970, 170], [1440, 0], [1910, 170])
    expect(directionChanges(gentle, 0.75).value).toBe(0.75)
    expect(directionChanges(gentle, 0.75, 15).value).toBe(0)
    expect(directionChanges(gentle, 0.75, 15).note).toMatch(/^100% of controls turn 15–/)
  })

  it('notices a first leg heading straight for the finish', () => {
    expect(firstLegTowardsFinish(course([0, 0], [300, 10], [600, 600], [900, 0])).value).toBe(1)
    expect(firstLegTowardsFinish(square).value).toBe(0)
  })

  it('measures how much of the usable terrain the course reaches', () => {
    expect(convexHullArea(square)).toBeCloseTo(1_000_000, -3)
    expect(spread(square, 2_000_000, 0.5).value).toBe(0)
    expect(spread(square, 8_000_000, 0.5).value).toBeCloseTo(0.75, 1)
  })

  it('finds a dogleg where the next route runs back along the incoming one', () => {
    const along = course([0, 0], [100, 0], [200, 0], [300, 0])
    const back = course([300, 0], [200, 5], [150, 5], [100, 300])
    const away = course([300, 0], [300, 200], [300, 400])
    expect(routeDoglegs([along, back]).value).toBeGreaterThan(0.5)
    expect(routeDoglegs([along, back]).note).toMatch(/^routes double back at control 1/)
    expect(routeDoglegs([along, away]).value).toBe(0)
  })

  it('finds legs that run side by side, there and back', () => {
    const outAndBack = course([0, 0], [0, 2000], [150, 2000], [150, 0])
    const apart = course([0, 0], [0, 2000], [1500, 2000], [1500, 0])
    expect(parallelLegs(outAndBack).value).toBeGreaterThan(0.5)
    expect(parallelLegs(outAndBack).note).toBe('side by side: legs 1 and 3')
    expect(parallelLegs(apart).value).toBe(0)
  })

  it('finds controls passed close by again', () => {
    const revisit = course(
      [0, 0],
      [500, 0],
      [1000, 0],
      [1000, 500],
      [500, 500],
      [520, 60],
      [0, 500],
    )
    const result = closeness(revisit)
    expect(result.value).toBeGreaterThan(0.5)
    expect(result.note).toMatch(/control 1/)
    expect(closeness(square).value).toBe(0)
  })

  it('counts how many controls crowd around each control', () => {
    // Five controls within 100 m of each other, then one far away; start and finish don't count.
    const cluster = course(
      [0, 0],
      [1000, 1000],
      [1060, 1000],
      [1000, 1060],
      [1060, 1060],
      [1030, 1030],
      [3000, 3000],
      [1000, 1000],
    )
    expect(crowdingCounts(cluster, 150)).toEqual([5, 5, 5, 5, 5, 1])
    const result = crowding(cluster, 150, 3)
    expect(result.value).toBe(10)
    expect(result.note).toMatch(/control 1, control 2/)
    expect(crowding(square, 300, 3).value).toBe(0)
  })

  it('compares the number of legs with what the leg mix suggests', () => {
    const target = FORMAT_QUALITY.long.legLengths
    const fewLongLegs = course([0, 0], [3000, 0], [3000, 3000], [0, 3000], [0, 100])
    expect(legCount(fewLongLegs, target).value).toBeGreaterThan(0.7)
    expect(legCount(fewLongLegs, target).note).toMatch(
      /^4 legs where the leg mix suggests about \d+$/,
    )
  })
})
