import { z } from 'zod'
import { courseTargetFor, type CourseRequest, type CourseTarget } from './course-request'
import { TECHNICAL_AREAS, technicalAreaRuleSchema } from './course-quality'
import { citedSchema, ratamestariDefaults } from './source'
import type { Format } from './winning-time'

export const coursePurposeSchema = z.enum(['competition', 'training'])
export const trainingKindSchema = z.enum(['contour'])

export type CoursePurpose = z.infer<typeof coursePurposeSchema>
export type TrainingKind = z.infer<typeof trainingKindSchema>

const difficultySchema = z.int().min(1).max(5)

// Training has no IOF or SSL values, so these are our defaults and the user may change any of
// them (D25). Null keeps the class's competition value.
export const trainingRulesSchema = citedSchema.extend({
  kind: trainingKindSchema,
  winningTime: z
    .object({
      minMinutes: z.number().positive(),
      maxMinutes: z.number().positive(),
      targetMinutes: z.number().positive(),
    })
    .nullable(),
  siteDifficulty: z.tuple([difficultySchema, difficultySchema]).nullable(),
  technicalAreas: technicalAreaRuleSchema,
  findingsAsAdvice: z.boolean(),
})

export type TrainingRules = z.infer<typeof trainingRulesSchema>

const CONTOUR_TRAINING_SOURCES = [ratamestariDefaults('D25')]

// Contour maps have few features apart from the relief, so an area counts as technical with
// fewer and weaker sites than on a fully mapped competition map.
const CONTOUR_TECHNICAL_AREA_QUALITY_SHARE = 0.75

const contourTrainingDefaults = (format: Format): TrainingRules => {
  const competition = TECHNICAL_AREAS[format]
  return {
    kind: 'contour',
    winningTime: null,
    siteDifficulty: null,
    technicalAreas: {
      ...competition,
      minQuality: competition.minQuality * CONTOUR_TECHNICAL_AREA_QUALITY_SHARE,
      sources: CONTOUR_TRAINING_SOURCES,
      interpretation: true,
    },
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

// The share a training course may be shorter or longer than the time the user asked for.
const TRAINING_WINNING_TIME_TOLERANCE = 0.1

export function trainingWinningTimeFor(targetMinutes: number): TrainingRules['winningTime'] {
  return {
    minMinutes: targetMinutes * (1 - TRAINING_WINNING_TIME_TOLERANCE),
    maxMinutes: targetMinutes * (1 + TRAINING_WINNING_TIME_TOLERANCE),
    targetMinutes,
  }
}

export function trainingTargetFor(
  request: CourseRequest,
  rules: TrainingRules,
): CourseTarget | null {
  const competition = courseTargetFor(request)
  if (!competition) return null
  const sources = [...competition.sources, ...rules.sources]
  return {
    ...competition,
    winningTime: rules.winningTime ?? competition.winningTime,
    siteDifficulty: rules.siteDifficulty ?? competition.siteDifficulty,
    sources,
    interpretation: true,
  }
}
