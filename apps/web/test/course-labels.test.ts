import { describe, expect, it } from 'vitest'
import type { CourseRequest } from '@ratamestari/rules'
import { courseKindFileKeyOf, courseKindOf, courseNameOf } from '../src/course-labels'
import { en } from '../src/i18n/en'

const REQUEST: CourseRequest = {
  eventLevel: 'national',
  format: 'long',
  sex: 'D',
  ageClass: 16,
  skillLetter: 'A',
}

describe('courseNameOf', () => {
  it('names a race course after its class, with the letter only below the main class', () => {
    expect(courseNameOf(REQUEST, 'Training')).toBe('D16')
    expect(courseNameOf({ ...REQUEST, skillLetter: 'B' }, 'Training')).toBe('D16B')
  })

  it('names a training course by the training name, since it has no class', () => {
    expect(courseNameOf({ ...REQUEST, purpose: 'training' }, 'Training')).toBe('Training')
  })
})

describe('courseKindOf', () => {
  const labels = en.labels

  it('names a race by its format', () => {
    expect(courseKindOf(REQUEST, labels)).toBe(labels.formats.long)
    expect(courseKindOf({ ...REQUEST, format: 'middle' }, labels)).toBe(labels.formats.middle)
  })

  it('names a training course by its style, not its format', () => {
    const training = { ...REQUEST, purpose: 'training' as const }
    expect(courseKindOf({ ...training, trainingStyle: 'longLegs' }, labels)).toBe(
      labels.trainingStyles.longLegs,
    )
    expect(courseKindOf(training, labels)).toBe(labels.trainingStyles.controlPicking)
  })
})

describe('courseKindFileKeyOf', () => {
  it('gives the format of a race and the style of a training course', () => {
    expect(courseKindFileKeyOf(REQUEST)).toBe('long')
    expect(
      courseKindFileKeyOf({ ...REQUEST, purpose: 'training', trainingStyle: 'longLegs' }),
    ).toBe('longLegs')
    expect(courseKindFileKeyOf({ ...REQUEST, purpose: 'training' })).toBe('controlPicking')
  })
})
