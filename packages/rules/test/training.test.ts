import { describe, expect, it } from 'vitest'
import { TECHNICAL_AREAS } from '../src/course-quality'
import { courseRequestSchema, courseTargetFor, type CourseRequest } from '../src/course-request'
import {
  courseTargetForPurpose,
  TRAINING_DEFAULTS,
  trainingRulesFor,
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

describe('trainingRulesFor', () => {
  it('gives no training rules to a competition request, with or without a purpose', () => {
    expect(trainingRulesFor(request)).toBeNull()
    expect(trainingRulesFor({ ...request, purpose: 'competition' })).toBeNull()
  })

  it("gives contour training the format's defaults and the minutes asked for", () => {
    const rules = trainingRulesFor({ ...request, purpose: 'training', trainingMinutes: 45 })
    expect(rules?.technicalAreas).toEqual(TRAINING_DEFAULTS.contour.long.technicalAreas)
    expect(rules?.winningTime?.targetMinutes).toBe(45)
  })
})

describe('courseTargetForPurpose', () => {
  it('is the competition target unless the request is for training', () => {
    expect(courseTargetForPurpose(request)).toEqual(courseTargetFor(request))
    const training = { ...request, purpose: 'training' as const, trainingMinutes: 45 }
    expect(courseTargetForPurpose(training)?.winningTime.targetMinutes).toBe(45)
  })
})
