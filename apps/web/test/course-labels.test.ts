import { describe, expect, it } from 'vitest'
import type { CourseRequest } from '@ratamestari/rules'
import { courseNameOf } from '../src/course-labels'

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
