import { describe, expect, it } from 'vitest'
import {
  classFromCourseName,
  courseRequestSchema,
  courseTargetFor,
  courseTargetSchema,
  type CourseRequest,
} from '../src/course-request'

const request = (overrides: Partial<CourseRequest> = {}): CourseRequest =>
  courseRequestSchema.parse({
    eventLevel: 'finnishChampionship',
    format: 'long',
    sex: 'H',
    ageClass: 21,
    ...overrides,
  })

describe('courseRequestSchema', () => {
  it('defaults to the A level', () => {
    expect(request().skillLetter).toBe('A')
  })

  it('rejects classes that do not exist', () => {
    expect(() => courseRequestSchema.parse({ ...request(), ageClass: 22 })).toThrow()
    expect(() => courseRequestSchema.parse({ ...request(), sex: 'M' })).toThrow()
  })

  it('holds no coordinates, since the request comes from the LLM', () => {
    expect(Object.keys(courseRequestSchema.shape)).toEqual([
      'eventLevel',
      'format',
      'sex',
      'ageClass',
      'skillLetter',
      'purpose',
      'trainingMinutes',
      'trainingStyle',
    ])
  })
})

describe('courseTargetFor', () => {
  it('sets an SM long distance H21 course for 90 minutes at the black level', () => {
    const target = courseTargetFor(request())!
    expect(target.winningTime.targetMinutes).toBe(90)
    expect(target.skillColour).toBe('black')
    expect(target.siteDifficulty).toEqual([3, 5])
    expect(() => courseTargetSchema.parse(target)).not.toThrow()
  })

  it('uses the SSL colour levels for young classes', () => {
    const colourOf = (ageClass: CourseRequest['ageClass']) =>
      courseTargetFor(request({ eventLevel: 'national', ageClass }))!.skillColour
    expect(colourOf(10)).toBe('white')
    expect(colourOf(12)).toBe('yellow')
    expect(colourOf(14)).toBe('orange')
    expect(colourOf(16)).toBe('purple')
    expect(colourOf(18)).toBe('blue')
  })

  it('makes B and C classes shorter and easier', () => {
    const a = courseTargetFor(request({ eventLevel: 'national' }))!
    const b = courseTargetFor(request({ eventLevel: 'national', skillLetter: 'B' }))!
    const c = courseTargetFor(request({ eventLevel: 'national', skillLetter: 'C' }))!
    expect(b.winningTime.targetMinutes).toBeLessThan(a.winningTime.targetMinutes)
    expect(b.siteDifficulty[1]).toBeLessThan(a.siteDifficulty[1])
    expect(c.skillColour).toBe('yellow')
    expect(b.sources).toContainEqual({ document: 'Lajisäännöt 2026', section: '11.251' })
  })

  it('returns null when the event has no winning time for the class', () => {
    expect(courseTargetFor(request({ ageClass: 12 }))).toBeNull()
  })
})

describe('classFromCourseName', () => {
  it('reads the class from usual course names', () => {
    expect(classFromCourseName('H21')).toEqual({ sex: 'H', ageClass: 21, skillLetter: 'A' })
    expect(classFromCourseName('D16B')).toEqual({ sex: 'D', ageClass: 16, skillLetter: 'B' })
    expect(classFromCourseName('Rata 3 M45')).toEqual({ sex: 'H', ageClass: 45, skillLetter: 'A' })
    expect(classFromCourseName('W 35')).toEqual({ sex: 'D', ageClass: 35, skillLetter: 'A' })
  })

  it('gives no class when the name holds none', () => {
    expect(classFromCourseName('Rata 3')).toBeNull()
    expect(classFromCourseName('H22')).toBeNull()
    expect(classFromCourseName('Helppo')).toBeNull()
  })
})
