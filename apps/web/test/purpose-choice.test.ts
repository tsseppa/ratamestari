import { describe, expect, it } from 'vitest'
import { TRAINING_DEFAULTS, type CourseRequest } from '@ratamestari/rules'
import {
  purposeOf,
  trainingMinutesFrom,
  trainingMinutesOf,
  withPurpose,
} from '../src/purpose-choice'

const REQUEST: CourseRequest = {
  eventLevel: 'finnishChampionship',
  format: 'long',
  sex: 'H',
  ageClass: 21,
  skillLetter: 'A',
}

describe('purposeOf', () => {
  it('reads a request without a purpose as a race', () => {
    expect(purposeOf(REQUEST)).toBe('competition')
    expect(purposeOf({ ...REQUEST, purpose: 'training' })).toBe('training')
  })
})

describe('withPurpose', () => {
  it("keeps the race's class and the training's minutes when switching back and forth", () => {
    const training = withPurpose({ ...REQUEST, trainingMinutes: 50 }, 'training')
    const race = withPurpose(training, 'competition')
    expect(race).toEqual({ ...REQUEST, trainingMinutes: 50, purpose: 'competition' })
    expect(withPurpose(race, 'training').trainingMinutes).toBe(50)
  })
})

describe('trainingMinutesOf', () => {
  it('uses the training default for the distance until the user sets their own', () => {
    expect(trainingMinutesOf({ ...REQUEST, format: 'middle' })).toBe(
      TRAINING_DEFAULTS.contour.middle.winningTime.targetMinutes,
    )
    expect(trainingMinutesOf({ ...REQUEST, trainingMinutes: 50 })).toBe(50)
  })
})

describe('trainingMinutesFrom', () => {
  it('reads a positive number of minutes', () => {
    expect(trainingMinutesFrom('50')).toBe(50)
    expect(trainingMinutesFrom('42.5')).toBe(42.5)
  })

  it('reads nothing from an empty, zero or non-numeric field', () => {
    for (const typed of ['', ' ', '0', '-5', 'abc']) expect(trainingMinutesFrom(typed)).toBeNull()
  })
})
