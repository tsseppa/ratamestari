import { z } from 'zod'
import {
  courseTargetFor,
  SITE_DIFFICULTY_BY_COLOUR,
  skillColourSchema,
  type CourseRequest,
  type CourseTarget,
} from './course-request'
import { TECHNICAL_AREAS, technicalAreaRuleSchema } from './course-quality'
import { citedSchema, ratamestariDefaults } from './source'
import type { Format } from './winning-time'

export const trainingKindSchema = z.enum(['contour'])

export type TrainingKind = z.infer<typeof trainingKindSchema>

// How much the contours bend around a site, the measure of good terrain on a contour map (D25).
export const contourDetailRuleSchema = z.object({
  // The contour's direction is compared this far before and after each point.
  bendSpanMeters: z.number().positive(),
  // Turns gentler than this are noise in the line, not a form a runner can read.
  minBendDegrees: z.number().min(0).max(180),
  neighbourhoodRadiusMeters: z.number().positive(),
})

export type ContourDetailRule = z.infer<typeof contourDetailRuleSchema>

// Training has no IOF or SSL values, so these are our defaults and the user may change any of
// them (D25). A training course has no class: its time and difficulty are its own.
export const trainingRulesSchema = citedSchema.extend({
  kind: trainingKindSchema,
  winningTime: z.object({
    minMinutes: z.number().positive(),
    maxMinutes: z.number().positive(),
    targetMinutes: z.number().positive(),
  }),
  // Control difficulty as an orienteering course colour, e.g. a black course.
  skillColour: skillColourSchema,
  technicalAreas: technicalAreaRuleSchema,
  contourDetail: contourDetailRuleSchema,
  findingsAsAdvice: z.boolean(),
})

export type TrainingRules = z.infer<typeof trainingRulesSchema>

const CONTOUR_TRAINING_SOURCES = [ratamestariDefaults('D25')]

// Contour maps have few features apart from the relief, so an area counts as technical with
// fewer and weaker sites than on a fully mapped competition map.
const CONTOUR_TECHNICAL_AREA_QUALITY_SHARE = 0.75

// The share a training course may be shorter or longer than the time the user asked for.
const TRAINING_WINNING_TIME_TOLERANCE = 0.1

export function trainingWinningTimeFor(targetMinutes: number) {
  return {
    minMinutes: targetMinutes * (1 - TRAINING_WINNING_TIME_TOLERANCE),
    maxMinutes: targetMinutes * (1 + TRAINING_WINNING_TIME_TOLERANCE),
    targetMinutes,
  }
}

const CONTOUR_TRAINING_MINUTES: Readonly<Record<Format, number>> = { long: 60, middle: 35 }

const contourTrainingDefaults = (format: Format): TrainingRules => {
  const competition = TECHNICAL_AREAS[format]
  return {
    kind: 'contour',
    winningTime: trainingWinningTimeFor(CONTOUR_TRAINING_MINUTES[format]),
    // A contour map's controls are relief features, nearly all demanding to find.
    skillColour: 'black',
    technicalAreas: {
      ...competition,
      minQuality: competition.minQuality * CONTOUR_TECHNICAL_AREA_QUALITY_SHARE,
      sources: CONTOUR_TRAINING_SOURCES,
      interpretation: true,
    },
    contourDetail: { bendSpanMeters: 15, minBendDegrees: 30, neighbourhoodRadiusMeters: 150 },
    findingsAsAdvice: true,
    sources: CONTOUR_TRAINING_SOURCES,
    interpretation: true,
  }
}

export const TRAINING_DEFAULTS: Readonly<
  Record<TrainingKind, Readonly<Record<Format, TrainingRules>>>
> = {
  contour: { long: contourTrainingDefaults('long'), middle: contourTrainingDefaults('middle') },
}

export function trainingTargetFor(rules: TrainingRules): CourseTarget {
  return {
    winningTime: rules.winningTime,
    skillColour: rules.skillColour,
    siteDifficulty: [...SITE_DIFFICULTY_BY_COLOUR[rules.skillColour]],
    sources: rules.sources,
    interpretation: true,
  }
}

export function trainingRulesFor(request: CourseRequest): TrainingRules | null {
  if (request.purpose !== 'training') return null
  const defaults = TRAINING_DEFAULTS.contour[request.format]
  return request.trainingMinutes === undefined
    ? defaults
    : { ...defaults, winningTime: trainingWinningTimeFor(request.trainingMinutes) }
}

export function courseTargetForPurpose(request: CourseRequest): CourseTarget | null {
  const training = trainingRulesFor(request)
  return training ? trainingTargetFor(training) : courseTargetFor(request)
}
