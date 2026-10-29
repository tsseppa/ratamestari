import { describe, expect, it } from 'vitest'
import { courseTargetFor, type CourseRequest } from '@ratamestari/rules'
import {
  purposeChoiceOf,
  TRAINING_CHOICE,
  trainingMinutesFrom,
  withPurposeChoice,
} from '../src/purpose-choice'

const REQUEST: CourseRequest = {
  eventLevel: 'finnishChampionship',
  format: 'long',
  sex: 'H',
  ageClass: 21,
  skillLetter: 'A',
}

describe('purposeChoiceOf', () => {
  it('shows the event level for competition and the training choice for training', () => {
    expect(purposeChoiceOf(REQUEST)).toBe('finnishChampionship')
    expect(purposeChoiceOf({ ...REQUEST, purpose: 'training' })).toBe(TRAINING_CHOICE)
  })
})

describe('withPurposeChoice', () => {
  it("starts training from the class's winning time, keeping level, distance and class", () => {
    const minutes = Math.round(courseTargetFor(REQUEST)!.winningTime.targetMinutes)
    expect(withPurposeChoice(REQUEST, TRAINING_CHOICE)).toEqual({
      ...REQUEST,
      purpose: 'training',
      trainingMinutes: minutes,
    })
  })

  it('returns to competition at the chosen level', () => {
    const training: CourseRequest = { ...REQUEST, purpose: 'training', trainingMinutes: 50 }
    expect(withPurposeChoice(training, 'national')).toMatchObject({
      purpose: 'competition',
      eventLevel: 'national',
    })
  })

  it('refuses a level the rules do not know', () => {
    expect(() => withPurposeChoice(REQUEST, 'world')).toThrow()
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
