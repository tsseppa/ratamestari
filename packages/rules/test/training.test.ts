import { describe, expect, it } from 'vitest'
import { TECHNICAL_AREAS } from '../src/course-quality'
import {
  courseRequestSchema,
  courseTargetFor,
  SITE_DIFFICULTY_BY_COLOUR,
  type CourseRequest,
} from '../src/course-request'
import {
  courseFormatOf,
  courseTargetForPurpose,
  DEFAULT_TRAINING_STYLE,
  expectedTrainingLegCount,
  TRAINING_DEFAULTS,
  TRAINING_STYLES,
  trainingRulesFor,
  trainingRulesSchema,
  trainingStyleProfileSchema,
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
        expect(new Set(rules.sources.map(source => source.document))).toEqual(
          new Set(['Ratamestari defaults']),
        )
      }
    }
  })

  it('accept weaker technical areas on contour maps than competition does', () => {
    for (const rules of Object.values(TRAINING_DEFAULTS.contour)) {
      expect(rules.technicalAreas.minQuality).toBeLessThan(
        TECHNICAL_AREAS[rules.styleProfile.baseFormat].minQuality,
      )
    }
  })
})

describe('TRAINING_STYLES', () => {
  it('are valid style profiles citing our own defaults', () => {
    for (const profile of Object.values(TRAINING_STYLES)) {
      expect(trainingStyleProfileSchema.parse(profile)).toEqual(profile)
      expect(profile.interpretation).toBe(true)
      expect(profile.sources.map(source => source.document)).toEqual(['Ratamestari defaults'])
    }
  })

  it('let the legs of every style cross each other', () => {
    for (const profile of Object.values(TRAINING_STYLES)) {
      expect(profile.allowsCrossingLegs).toBe(true)
    }
  })

  it('keep control picking on short legs between 50 and 250 m', () => {
    const [min, max] = TRAINING_STYLES.controlPicking.template.technicalLegMetres
    expect(min).toBeGreaterThanOrEqual(50)
    expect(max).toBeLessThanOrEqual(250)
    expect(min).toBeLessThan(max)
  })
})

describe('courseFormatOf', () => {
  it("is the race's own format for a competition request", () => {
    expect(courseFormatOf(request)).toBe('long')
    expect(courseFormatOf({ ...request, format: 'middle', purpose: 'competition' })).toBe('middle')
  })

  it("is the style's base format for training, whatever format the request names", () => {
    const training = { ...request, purpose: 'training' as const }
    expect(courseFormatOf({ ...training, trainingStyle: 'controlPicking' })).toBe(
      TRAINING_STYLES.controlPicking.baseFormat,
    )
    expect(courseFormatOf({ ...training, format: 'middle', trainingStyle: 'longLegs' })).toBe(
      TRAINING_STYLES.longLegs.baseFormat,
    )
    expect(courseFormatOf(training)).toBe(TRAINING_STYLES[DEFAULT_TRAINING_STYLE].baseFormat)
  })
})

describe('expectedTrainingLegCount', () => {
  const withMinutes = (style: 'controlPicking' | 'longLegs', minutes: number) =>
    trainingRulesFor({
      ...request,
      purpose: 'training',
      trainingStyle: style,
      trainingMinutes: minutes,
    })!

  it('divides the time of a control picking course into its short legs', () => {
    const rules = withMinutes('controlPicking', 45)
    expect(expectedTrainingLegCount(rules)).toBe(
      Math.round(45 / rules.styleProfile.shortLegMinutes),
    )
    expect(expectedTrainingLegCount(rules)).toBe(30)
  })

  it('spends most of a long legs course on its long legs', () => {
    const rules = withMinutes('longLegs', 60)
    const { shortLegMinutes, longLegMinutes, longLegShareOfTime } = rules.styleProfile
    expect(expectedTrainingLegCount(rules)).toBe(
      Math.round(
        (60 * longLegShareOfTime) / longLegMinutes +
          (60 * (1 - longLegShareOfTime)) / shortLegMinutes,
      ),
    )
    expect(expectedTrainingLegCount(rules)).toBe(15)
  })

  it('grows with the winning time', () => {
    for (const style of ['controlPicking', 'longLegs'] as const) {
      expect(expectedTrainingLegCount(withMinutes(style, 90))).toBeGreaterThan(
        expectedTrainingLegCount(withMinutes(style, 30)),
      )
    }
  })
})

describe('trainingTargetFor', () => {
  it("takes the training's own winning time and the difficulty of its course colour", () => {
    const rules = {
      ...TRAINING_DEFAULTS.contour.controlPicking,
      winningTime: { minMinutes: 40, maxMinutes: 50, targetMinutes: 45 },
      skillColour: 'orange' as const,
    }
    const target = trainingTargetFor(rules)
    expect(target.winningTime).toEqual(rules.winningTime)
    expect(target.skillColour).toBe('orange')
    expect(target.siteDifficulty).toEqual([...SITE_DIFFICULTY_BY_COLOUR.orange])
  })

  it('cites the training defaults', () => {
    const target = trainingTargetFor(TRAINING_DEFAULTS.contour.controlPicking)
    expect(new Set(target.sources.map(source => source.document))).toEqual(
      new Set(['Ratamestari defaults']),
    )
  })
})

describe('trainingWinningTimeFor', () => {
  it('aims at the time asked for, with a window around it', () => {
    const time = trainingWinningTimeFor(60)
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

  it('needs no class: a training request without minutes gets the default time', () => {
    const rules = trainingRulesFor({ ...request, purpose: 'training' })
    expect(rules?.winningTime).toEqual(TRAINING_DEFAULTS.contour.controlPicking.winningTime)
    const juniors = trainingRulesFor({ ...request, purpose: 'training', ageClass: 12 })
    expect(juniors).toEqual(rules)
  })

  it("gives contour training the format's defaults and the minutes asked for", () => {
    const rules = trainingRulesFor({ ...request, purpose: 'training', trainingMinutes: 45 })
    expect(rules?.technicalAreas).toEqual(TRAINING_DEFAULTS.contour.controlPicking.technicalAreas)
    expect(rules?.winningTime?.targetMinutes).toBe(45)
  })
})

describe('trainingRulesFor styles', () => {
  it('gives control picking when no style is asked for', () => {
    expect(DEFAULT_TRAINING_STYLE).toBe('controlPicking')
    const rules = trainingRulesFor({ ...request, purpose: 'training' })
    expect(rules).toEqual(TRAINING_DEFAULTS.contour.controlPicking)
    expect(rules?.style).toBe('controlPicking')
  })

  it('gives each style its own defaults and profile', () => {
    for (const style of ['controlPicking', 'longLegs'] as const) {
      const rules = trainingRulesFor({ ...request, purpose: 'training', trainingStyle: style })
      expect(rules).toEqual(TRAINING_DEFAULTS.contour[style])
      expect(rules?.styleProfile).toBe(TRAINING_STYLES[style])
    }
  })

  it('keeps the style when the minutes are set', () => {
    const rules = trainingRulesFor({
      ...request,
      purpose: 'training',
      trainingStyle: 'longLegs',
      trainingMinutes: 50,
    })
    expect(rules?.style).toBe('longLegs')
    expect(rules?.styleProfile).toBe(TRAINING_STYLES.longLegs)
    expect(rules?.winningTime.targetMinutes).toBe(50)
  })
})

describe('courseTargetForPurpose', () => {
  it('is the competition target unless the request is for training', () => {
    expect(courseTargetForPurpose(request)).toEqual(courseTargetFor(request))
    const training = { ...request, purpose: 'training' as const, trainingMinutes: 45 }
    expect(courseTargetForPurpose(training)?.winningTime.targetMinutes).toBe(45)
  })
})
