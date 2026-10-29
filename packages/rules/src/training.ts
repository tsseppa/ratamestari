import { z } from 'zod'
import {
  courseTargetFor,
  SITE_DIFFICULTY_BY_COLOUR,
  skillColourSchema,
  trainingStyleSchema,
  type CourseRequest,
  type CourseTarget,
  type TrainingStyle,
} from './course-request'
import {
  CROWDING,
  crowdingRuleSchema,
  FORMAT_QUALITY,
  FORMAT_TEMPLATES,
  formatQualityProfileSchema,
  formatTemplateSchema,
  SCORE_WEIGHTS,
  scoreWeightsSchema,
  TECHNICAL_AREAS,
  technicalAreaRuleSchema,
} from './course-quality'
import { citedSchema, ratamestariDefaults } from './source'
import { formatSchema, type Format } from './winning-time'

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

// The shape of a training course of one style (D26). It replaces the competition format's tables;
// the format it starts from still sets the rest of the search.
export const trainingStyleProfileSchema = citedSchema.extend({
  baseFormat: formatSchema,
  template: formatTemplateSchema,
  quality: formatQualityProfileSchema,
  weights: scoreWeightsSchema,
  crowding: crowdingRuleSchema,
  // Legs may cross each other; a line through a control circle is still avoided (D26).
  allowsCrossingLegs: z.boolean(),
  // The control count follows from the winning time and these leg times.
  shortLegMinutes: z.number().positive(),
  longLegMinutes: z.number().positive(),
  longLegShareOfTime: z.number().min(0).max(1),
})

export type TrainingStyleProfile = z.infer<typeof trainingStyleProfileSchema>

// Training has no IOF or SSL values, so these are our defaults and the user may change any of
// them (D25). A training course has no class: its time and difficulty are its own.
export const trainingRulesSchema = citedSchema.extend({
  kind: trainingKindSchema,
  style: trainingStyleSchema,
  styleProfile: trainingStyleProfileSchema,
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
const STYLE_SOURCES = [ratamestariDefaults('D26')]

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

const TRAINING_MINUTES: Readonly<Record<TrainingStyle, number>> = {
  controlPicking: 45,
  longLegs: 60,
}

// Control picking: only short legs, and a small bend at most controls so that the runner takes a
// new direction at each one (D26).
const CONTROL_PICKING_LEG_METRES: [number, number] = [50, 250]
const CONTROL_PICKING: TrainingStyleProfile = {
  baseFormat: 'middle',
  template: {
    ...FORMAT_TEMPLATES.middle,
    technicalSections: [1, 3],
    connectingLegShare: [0.02, 0.1],
    connectingLegMetres: [250, 1500],
    connectingTotalShare: [0, 0.25],
    technicalLegMetres: CONTROL_PICKING_LEG_METRES,
    sources: STYLE_SOURCES,
    interpretation: true,
  },
  quality: {
    ...FORMAT_QUALITY.middle,
    legLengths: {
      binEdgesMetres: FORMAT_QUALITY.middle.legLengths.binEdgesMetres,
      shares: [0.55, 0.45, 0, 0, 0, 0, 0],
      sources: STYLE_SOURCES,
      interpretation: true,
    },
    directionChangeRateTarget: 0.8,
    directionChangeMinDegrees: 20,
    sources: STYLE_SOURCES,
    interpretation: true,
  },
  // Training may cross its own legs and come back near its controls to use a small good area.
  weights: {
    ...SCORE_WEIGHTS.middle,
    courseLineCrossing: 0,
    closeness: 0,
    sources: STYLE_SOURCES,
    interpretation: true,
  },
  // Short legs put controls closer together than a competition allows.
  crowding: {
    radiusMetres: 100,
    maxControls: 4,
    sources: STYLE_SOURCES,
    interpretation: true,
  },
  allowsCrossingLegs: true,
  shortLegMinutes: 1.5,
  longLegMinutes: 1.5,
  longLegShareOfTime: 0,
  sources: STYLE_SOURCES,
  interpretation: true,
}

// Long legs keep the long-distance shape until their own leg pattern is built (D26).
const LONG_LEGS: TrainingStyleProfile = {
  baseFormat: 'long',
  template: FORMAT_TEMPLATES.long,
  quality: FORMAT_QUALITY.long,
  weights: {
    ...SCORE_WEIGHTS.long,
    courseLineCrossing: 0,
    closeness: 0,
    sources: STYLE_SOURCES,
    interpretation: true,
  },
  crowding: CROWDING.long,
  allowsCrossingLegs: true,
  shortLegMinutes: 1.5,
  longLegMinutes: 10,
  longLegShareOfTime: 0.75,
  sources: STYLE_SOURCES,
  interpretation: true,
}

export const TRAINING_STYLES: Readonly<Record<TrainingStyle, TrainingStyleProfile>> = {
  controlPicking: CONTROL_PICKING,
  longLegs: LONG_LEGS,
}

const contourTrainingDefaults = (style: TrainingStyle): TrainingRules => {
  const styleProfile = TRAINING_STYLES[style]
  const competition = TECHNICAL_AREAS[styleProfile.baseFormat]
  return {
    kind: 'contour',
    style,
    styleProfile,
    winningTime: trainingWinningTimeFor(TRAINING_MINUTES[style]),
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
    sources: [...CONTOUR_TRAINING_SOURCES, ...STYLE_SOURCES],
    interpretation: true,
  }
}

export const TRAINING_DEFAULTS: Readonly<
  Record<TrainingKind, Readonly<Record<TrainingStyle, TrainingRules>>>
> = {
  contour: {
    controlPicking: contourTrainingDefaults('controlPicking'),
    longLegs: contourTrainingDefaults('longLegs'),
  },
}

export const DEFAULT_TRAINING_STYLE: TrainingStyle = 'controlPicking'

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
  const defaults = TRAINING_DEFAULTS.contour[request.trainingStyle ?? DEFAULT_TRAINING_STYLE]
  return request.trainingMinutes === undefined
    ? defaults
    : { ...defaults, winningTime: trainingWinningTimeFor(request.trainingMinutes) }
}

export function courseTargetForPurpose(request: CourseRequest): CourseTarget | null {
  const training = trainingRulesFor(request)
  return training ? trainingTargetFor(training) : courseTargetFor(request)
}

// The competition format whose tables the search uses: a training style's own base format.
export const courseFormatOf = (request: CourseRequest): Format =>
  request.purpose === 'training'
    ? TRAINING_STYLES[request.trainingStyle ?? DEFAULT_TRAINING_STYLE].baseFormat
    : request.format

// How many controls a training course aims for: its time on each kind of leg over that leg's time.
export function expectedTrainingLegCount(rules: TrainingRules): number {
  const { shortLegMinutes, longLegMinutes, longLegShareOfTime } = rules.styleProfile
  const minutes = rules.winningTime.targetMinutes
  return Math.round(
    (minutes * longLegShareOfTime) / longLegMinutes +
      (minutes * (1 - longLegShareOfTime)) / shortLegMinutes,
  )
}
