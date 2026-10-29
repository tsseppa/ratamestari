import { describe, expect, it } from 'vitest'
import { TECHNICAL_AREAS } from '../src/course-quality'
import { courseRequestSchema, courseTargetFor, type CourseRequest } from '../src/course-request'
import {
  TRAINING_DEFAULTS,
  trainingRulesSchema,
  trainingTargetFor,
  trainingWinningTimeFor,
} from '../src/training'

const request: CourseRequest = courseRequestSchema.parse({
  eventLevel: 'national',
  format: 'long',
  sex: 'H',
  ageClass: 21,
})

describe('TRAINING_DEFAULTS', () => {
  it('are valid training rules flagged as our own interpretation', () => {
    for (const byFormat of Object.values(TRAINING_DEFAULTS)) {
      for (const rules of Object.values(byFormat)) {
        expect(trainingRulesSchema.parse(rules)).toEqual(rules)
        expect(rules.interpretation).toBe(true)
        expect(rules.sources.map(source => source.document)).toEqual(['Ratamestari defaults'])
      }
    }
  })

  it('accept weaker technical areas on contour maps than competition does', () => {
    for (const format of ['long', 'middle'] as const) {
      expect(TRAINING_DEFAULTS.contour[format].technicalAreas.minQuality).toBeLessThan(
        TECHNICAL_AREAS[format].minQuality,
      )
    }
  })
})

describe('trainingTargetFor', () => {
  it("keeps the class's competition target where the training rules leave it", () => {
    const target = trainingTargetFor(request, TRAINING_DEFAULTS.contour.long)
    const competition = courseTargetFor(request)!
    expect(target?.winningTime).toEqual(competition.winningTime)
    expect(target?.siteDifficulty).toEqual(competition.siteDifficulty)
  })

  it("uses the user's own winning time and difficulty range", () => {
    const rules = {
      ...TRAINING_DEFAULTS.contour.long,
      winningTime: { minMinutes: 40, maxMinutes: 50, targetMinutes: 45 },
      siteDifficulty: [2, 4] as [number, number],
    }
    const target = trainingTargetFor(request, rules)
    expect(target?.winningTime).toEqual(rules.winningTime)
    expect(target?.siteDifficulty).toEqual([2, 4])
  })

  it('cites the training defaults next to the competition sources', () => {
    const target = trainingTargetFor(request, TRAINING_DEFAULTS.contour.long)
    expect(target?.sources.map(source => source.document)).toContain('Ratamestari defaults')
  })
})

describe('trainingWinningTimeFor', () => {
  it('aims at the time asked for, with a window around it', () => {
    const time = trainingWinningTimeFor(60)!
    expect(time.targetMinutes).toBe(60)
    expect(time.minMinutes).toBeLessThan(60)
    expect(time.maxMinutes).toBeGreaterThan(60)
  })
})
