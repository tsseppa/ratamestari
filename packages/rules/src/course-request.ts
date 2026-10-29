import { z } from 'zod'
import { citedSchema, lajisaannot, ratamestarikirja } from './source'
import {
  ageClassSchema,
  eventLevelSchema,
  formatSchema,
  sexSchema,
  winningTimeFor,
  type AgeClass,
  type WinningTime,
} from './winning-time'

export const skillLetterSchema = z.enum(['E', 'A', 'B', 'C'])
export const coursePurposeSchema = z.enum(['competition', 'training'])

export type CoursePurpose = z.infer<typeof coursePurposeSchema>

// Without a purpose the course is for competition. A training course may ask for its own winning
// time; without one it keeps the class's time at the event level (D25).
export const courseRequestSchema = z.object({
  eventLevel: eventLevelSchema,
  format: formatSchema,
  sex: sexSchema,
  ageClass: ageClassSchema,
  skillLetter: skillLetterSchema.default('A'),
  purpose: coursePurposeSchema.optional(),
  trainingMinutes: z.number().positive().optional(),
})

export const skillColourSchema = z.enum([
  'white',
  'yellow',
  'orange',
  'red',
  'purple',
  'blue',
  'black',
])

export type CourseClass = Pick<CourseRequest, 'sex' | 'ageClass' | 'skillLetter'>

const CLASS_IN_COURSE_NAME = /(?:^|[^A-Za-z])([HDMWN])\s?(\d{1,2})\s?([EABC])?(?![A-Za-z0-9])/i
const SEX_LETTERS: Readonly<Record<string, 'H' | 'D'>> = { H: 'H', M: 'H', D: 'D', W: 'D', N: 'D' }

// Course setters name courses after their class ("H21", "D16A", "M45"); a guess the user confirms.
export function classFromCourseName(name: string): CourseClass | null {
  const match = CLASS_IN_COURSE_NAME.exec(name)
  if (!match) return null
  const [, sexLetter = '', age = '', letter = 'A'] = match
  const sex = sexSchema.safeParse(SEX_LETTERS[sexLetter.toUpperCase()])
  const ageClass = ageClassSchema.safeParse(Number(age))
  const skillLetter = skillLetterSchema.safeParse(letter.toUpperCase())
  if (!sex.success || !ageClass.success || !skillLetter.success) return null
  return { sex: sex.data, ageClass: ageClass.data, skillLetter: skillLetter.data }
}

export type SkillLetter = z.infer<typeof skillLetterSchema>
export type CourseRequest = z.infer<typeof courseRequestSchema>
export type SkillColour = z.infer<typeof skillColourSchema>

export const courseTargetSchema = citedSchema.extend({
  winningTime: z.object({
    minMinutes: z.number().positive(),
    maxMinutes: z.number().positive(),
    targetMinutes: z.number().positive(),
  }),
  skillColour: skillColourSchema,
  siteDifficulty: z.tuple([z.int().min(1).max(5), z.int().min(1).max(5)]),
})

export type CourseTarget = z.infer<typeof courseTargetSchema>

const COLOUR_ORDER = skillColourSchema.options

const MAIN_CLASS_COLOUR: Readonly<Record<AgeClass, SkillColour>> = {
  10: 'white',
  12: 'yellow',
  13: 'yellow',
  14: 'orange',
  15: 'red',
  16: 'purple',
  18: 'blue',
  20: 'black',
  21: 'black',
  35: 'blue',
  40: 'blue',
  45: 'blue',
  50: 'blue',
  55: 'blue',
  60: 'blue',
  65: 'blue',
  70: 'blue',
  75: 'blue',
  80: 'blue',
  85: 'blue',
  90: 'blue',
}

export const SITE_DIFFICULTY_BY_COLOUR: Readonly<Record<SkillColour, readonly [number, number]>> = {
  white: [1, 1],
  yellow: [1, 2],
  orange: [2, 3],
  red: [2, 3],
  purple: [3, 4],
  blue: [3, 5],
  black: [3, 5],
}

const LOWER_CLASS_WINNING_TIME_SHARE = 0.75
const B_CLASS_COLOUR_STEPS_EASIER = 2

function skillColourFor(ageClass: AgeClass, skillLetter: SkillLetter): SkillColour {
  const main = MAIN_CLASS_COLOUR[ageClass]
  if (skillLetter === 'C') return 'yellow'
  if (skillLetter !== 'B') return main
  const index = Math.max(0, COLOUR_ORDER.indexOf(main) - B_CLASS_COLOUR_STEPS_EASIER)
  return COLOUR_ORDER[index]!
}

function scaled(time: WinningTime, share: number) {
  return {
    minMinutes: time.minMinutes * share,
    maxMinutes: time.maxMinutes * share,
    targetMinutes: time.targetMinutes * share,
  }
}

export function courseTargetFor(request: CourseRequest): CourseTarget | null {
  const winningTime = winningTimeFor(request.eventLevel, request.format, request.ageClass)
  if (!winningTime) return null
  const isLowerClass = request.skillLetter === 'B' || request.skillLetter === 'C'
  const skillColour = skillColourFor(request.ageClass, request.skillLetter)
  return {
    winningTime: scaled(winningTime, isLowerClass ? LOWER_CLASS_WINNING_TIME_SHARE : 1),
    skillColour,
    siteDifficulty: [...SITE_DIFFICULTY_BY_COLOUR[skillColour]],
    sources: [
      ...winningTime.sources,
      ...(isLowerClass ? [lajisaannot('11.251')] : []),
      lajisaannot('9.21'),
      ratamestarikirja('11'),
      ratamestarikirja('1.3.3'),
    ],
    interpretation: true,
  }
}
