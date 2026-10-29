import { z } from 'zod'
import { citedSchema, iofRules, isom, ratamestarikirja } from './source'
import type { Format } from './winning-time'

export const courseShapeRuleSchema = citedSchema.extend({
  reversalDegrees: z.number().positive(),
  reversalReferenceLegMetres: z.number().positive(),
  directionChangeDegrees: z.number().positive(),
  alternationLengthRatio: z.number().min(1),
  alternationRunLength: z.int().min(2),
  firstLegTowardsFinishDegrees: z.number().positive(),
  doglegLengthMetres: z.number().positive(),
  doglegWidthMetres: z.number().positive(),
  doglegHardOverlap: z.number().min(0).max(1),
  ringMinTurns: z.int().min(1),
  ringFreeConsistency: z.number().min(0).max(1),
  parallelMaxDegrees: z.number().positive(),
  parallelMaxSeparationMetres: z.number().positive(),
  parallelMinLegMetres: z.number().positive(),
  nearPassMetres: z.number().positive(),
  revisitMetres: z.number().positive(),
  revisitMinOrderGap: z.int().min(2),
})

export type CourseShapeRule = z.infer<typeof courseShapeRuleSchema>

export const COURSE_SHAPE: CourseShapeRule = {
  reversalDegrees: 150,
  reversalReferenceLegMetres: 500,
  directionChangeDegrees: 60,
  alternationLengthRatio: 1.3,
  alternationRunLength: 3,
  firstLegTowardsFinishDegrees: 30,
  doglegLengthMetres: 75,
  doglegWidthMetres: 15,
  doglegHardOverlap: 0.6,
  ringMinTurns: 8,
  ringFreeConsistency: 0.6,
  parallelMaxDegrees: 30,
  parallelMaxSeparationMetres: 300,
  parallelMinLegMetres: 300,
  nearPassMetres: 100,
  revisitMetres: 200,
  revisitMinOrderGap: 3,
  sources: [
    iofRules('App. 2 §3.4.1'),
    iofRules('App. 2 §3.5.4'),
    ratamestarikirja('1.3.1'),
    ratamestarikirja('1.4.3'),
    ratamestarikirja('4.5.S'),
  ],
  interpretation: true,
}

export const courseLineCrossingRuleSchema = citedSchema.extend({
  fullyBadWithinMetres: z.number().positive(),
  harmlessBeyondMetres: z.number().positive(),
  baseSeverity: z.number().min(0).max(1),
  acceptableSeverity: z.number().min(0).max(1),
})

// Course setter guidance (2026-10-24): crossings are bad near controls or at a shallow angle; far
// from controls at nearly a right angle they are acceptable and can let a course use good terrain
// in a small area. Too many crossings are still bad.
export const COURSE_LINE_CROSSING: z.infer<typeof courseLineCrossingRuleSchema> = {
  fullyBadWithinMetres: 75,
  harmlessBeyondMetres: 300,
  baseSeverity: 0.2,
  acceptableSeverity: 0.5,
  sources: [isom('sym. 703'), isom('sym. 705')],
  interpretation: true,
}

export const legLengthTargetSchema = citedSchema.extend({
  binEdgesMetres: z.array(z.number().nonnegative()).min(2),
  shares: z.array(z.number().nonnegative()),
})

export const formatQualityProfileSchema = citedSchema.extend({
  legLengths: legLengthTargetSchema,
  directionChangeRateTarget: z.number().min(0).max(1),
  // The least turn at a control that counts as a change of direction, if not COURSE_SHAPE's.
  directionChangeMinDegrees: z.number().min(0).max(180).optional(),
  spreadTarget: z.number().min(0).max(1),
})

export type LegLengthTarget = z.infer<typeof legLengthTargetSchema>
export type FormatQualityProfile = z.infer<typeof formatQualityProfileSchema>

const LEG_BIN_EDGES_METRES = [0, 150, 300, 500, 800, 1200, 2000, 3500]

export const FORMAT_QUALITY: Readonly<Record<Format, FormatQualityProfile>> = {
  long: {
    legLengths: {
      binEdgesMetres: LEG_BIN_EDGES_METRES,
      shares: [0.05, 0.2, 0.25, 0.2, 0.13, 0.12, 0.05],
      sources: [iofRules('App. 2 §3.4.1'), ratamestarikirja('2.S.1')],
      interpretation: true,
    },
    directionChangeRateTarget: 0.6,
    spreadTarget: 0.3,
    sources: [ratamestarikirja('2.S.1'), iofRules('App. 2 §3.4.1')],
    interpretation: true,
  },
  middle: {
    legLengths: {
      binEdgesMetres: LEG_BIN_EDGES_METRES,
      // Calibrated on the human middle courses in maps/ (benchmark 2026-10-24): about one leg
      // under 150 m per course, median leg 330 m. RMK 2.S.2: legs are short on average.
      shares: [0.08, 0.35, 0.4, 0.1, 0.07, 0, 0],
      sources: [iofRules('App. 2 §3.4.1'), ratamestarikirja('2.S.2')],
      interpretation: true,
    },
    directionChangeRateTarget: 0.75,
    spreadTarget: 0.15,
    sources: [ratamestarikirja('2.S.2'), iofRules('App. 2 §3.4.1')],
    interpretation: true,
  },
}

export const crowdingRuleSchema = citedSchema.extend({
  radiusMetres: z.number().positive(),
  maxControls: z.int().min(1),
})

export type CrowdingRule = z.infer<typeof crowdingRuleSchema>

// Pairwise spacing allows ten controls 80 m apart. A course setter spreads controls over the
// terrain instead, and a cluster is hard to read on the map (RMK 1.4.3, RMK 2.S.1, RMK 2.S.2).
export const CROWDING: Readonly<Record<Format, CrowdingRule>> = {
  long: {
    radiusMetres: 300,
    maxControls: 3,
    sources: [ratamestarikirja('1.4.3'), ratamestarikirja('2.S.1')],
    interpretation: true,
  },
  middle: {
    radiusMetres: 150,
    maxControls: 3,
    sources: [ratamestarikirja('1.4.3'), ratamestarikirja('2.S.2')],
    interpretation: true,
  },
}

export const technicalAreaRuleSchema = citedSchema.extend({
  minQuality: z.number().min(0).max(1),
  clusterRadiusMetres: z.number().positive(),
  minPoints: z.int().min(2),
  minAreaSquareMetres: z.number().positive(),
  maxAreaSquareMetres: z.number().positive(),
  capacityLegMetres: z.number().positive(),
})

export type TechnicalAreaRule = z.infer<typeof technicalAreaRuleSchema>

// A course setter first finds the good technical areas, then joins them (RMK 1.2.6.S). Middle
// distance needs 1.5-2 km² of good terrain (RMK 2.S.2); long distance visits several smaller
// areas. Starting values for the section planner (D19), to be tuned on the club maps.
export const TECHNICAL_AREAS: Readonly<Record<Format, TechnicalAreaRule>> = {
  long: {
    minQuality: 0.6,
    clusterRadiusMetres: 175,
    minPoints: 4,
    minAreaSquareMetres: 80_000,
    maxAreaSquareMetres: 1_000_000,
    capacityLegMetres: 250,
    sources: [ratamestarikirja('1.2.6.S'), ratamestarikirja('2.S.1')],
    interpretation: true,
  },
  middle: {
    minQuality: 0.4,
    clusterRadiusMetres: 110,
    minPoints: 4,
    minAreaSquareMetres: 50_000,
    maxAreaSquareMetres: 2_000_000,
    capacityLegMetres: 150,
    sources: [ratamestarikirja('1.2.6.S'), ratamestarikirja('2.S.2')],
    interpretation: true,
  },
}

const rangeSchema = z.tuple([z.number().nonnegative(), z.number().nonnegative()])
const countRangeSchema = z.tuple([z.int().min(0), z.int().min(0)])

export const formatTemplateSchema = citedSchema.extend({
  technicalSections: countRangeSchema,
  // Share of the winning time each connecting leg takes, and its straight length.
  connectingLegShare: rangeSchema,
  connectingLegMetres: rangeSchema,
  connectingTotalShare: rangeSchema,
  technicalLegMetres: rangeSchema,
  runInMaxShare: z.number().positive(),
  // Middle distance: the main section's least share of the free time, and how far from the
  // finish (share of the winning time) its area may start.
  mainSectionMinShare: z.number().min(0).max(1),
  mainAreaReachShare: z.number().positive(),
  // An area holding less course than this share of the winning time is not worth a section.
  minAreaCapacityShare: z.number().min(0).max(1),
})

export type FormatTemplate = z.infer<typeof formatTemplateSchema>

// How a course of each format is built from technical sections and the legs that join them
// (D19, section-planning-spec 5.2). Ranges; the skeleton search picks inside them.
export const FORMAT_TEMPLATES: Readonly<Record<Format, FormatTemplate>> = {
  long: {
    technicalSections: [3, 5],
    connectingLegShare: [0.06, 0.12],
    connectingLegMetres: [800, 2500],
    connectingTotalShare: [0.3, 0.5],
    technicalLegMetres: [150, 800],
    runInMaxShare: 0.08,
    mainSectionMinShare: 0,
    mainAreaReachShare: 0.5,
    minAreaCapacityShare: 0.08,
    sources: [ratamestarikirja('1.2.6.S'), ratamestarikirja('2.S.1'), iofRules('App. 2 §3.4.1')],
    interpretation: true,
  },
  middle: {
    technicalSections: [1, 2],
    connectingLegShare: [0.06, 0.1],
    connectingLegMetres: [500, 1200],
    connectingTotalShare: [0, 0.1],
    technicalLegMetres: [60, 500],
    runInMaxShare: 0.08,
    mainSectionMinShare: 0.5,
    mainAreaReachShare: 0.4,
    minAreaCapacityShare: 0.15,
    sources: [ratamestarikirja('2.S.2')],
    interpretation: true,
  },
}

export const skeletonSearchSchema = citedSchema.extend({
  beamWidth: z.int().min(1),
  refined: z.int().min(1),
  endpointCandidates: z.int().min(1),
  // Weights of the skeleton score; lower scores are better.
  weights: z.object({
    timeShortfallPerPercent: z.number().nonnegative(),
    areaQuality: z.number().nonnegative(),
    connectingLegOutOfBand: z.number().nonnegative(),
    connectingShareOutOfRange: z.number().nonnegative(),
    sharpTurn: z.number().nonnegative(),
    crossing: z.number().nonnegative(),
    spread: z.number().nonnegative(),
    routeChoice: z.number().nonnegative(),
  }),
})

export const SKELETON_SEARCH: z.infer<typeof skeletonSearchSchema> = {
  beamWidth: 40,
  refined: 5,
  endpointCandidates: 8,
  weights: {
    timeShortfallPerPercent: 2,
    areaQuality: 20,
    connectingLegOutOfBand: 10,
    connectingShareOutOfRange: 1,
    sharpTurn: 15,
    crossing: 30,
    spread: 20,
    routeChoice: 8,
  },
  sources: [ratamestarikirja('1.2.6.S'), iofRules('App. 2 §3.4.1')],
  interpretation: true,
}

export const sectionFillSchema = citedSchema.extend({
  beamWidth: z.int().min(1),
  expansions: z.int().min(1),
  budgetTolerance: z.number().min(0).max(1),
  // Sites within this distance of a technical area's hull may hold its controls.
  areaBufferMetres: z.number().nonnegative(),
  // Rebuilding a few controls during improvement needs a much smaller search.
  rebuild: z.object({ beamWidth: z.int().min(1), expansions: z.int().min(1) }),
  weights: z.object({
    quality: z.number().nonnegative(),
    difficultyOutsideRange: z.number().nonnegative(),
    legMix: z.number().nonnegative(),
    pacing: z.number().nonnegative(),
    straightOn: z.number().nonnegative(),
    budgetErrorPerPercent: z.number().nonnegative(),
    // Per share of the budget past 60%, for a state whose last control cannot close cleanly.
    unclosable: z.number().nonnegative(),
    // A leg passing close to the section's exit, and a last leg that crosses the course.
    exitCorridor: z.number().nonnegative(),
    crossingClose: z.number().nonnegative(),
    noise: z.number().nonnegative(),
  }),
})

// The beam search that sets each section from its entry to its exit within its budget (D19,
// section-planning-spec 5.4). Starting values, to be tuned on the club maps.
export const SECTION_FILL: z.infer<typeof sectionFillSchema> = {
  beamWidth: 40,
  expansions: 10,
  budgetTolerance: 0.03,
  areaBufferMetres: 100,
  rebuild: { beamWidth: 12, expansions: 4 },
  weights: {
    quality: 3,
    difficultyOutsideRange: 2,
    legMix: 3,
    pacing: 4,
    straightOn: 1,
    budgetErrorPerPercent: 0.3,
    unclosable: 25,
    exitCorridor: 2,
    crossingClose: 10,
    noise: 0.3,
  },
  sources: [ratamestarikirja('1.2.6.S'), ratamestarikirja('2.S.2')],
  interpretation: true,
}

export const scoreWeightsSchema = citedSchema.extend({
  timeErrorPerPercent: z.number().nonnegative(),
  timeOutsideRangePerPercent: z.number().nonnegative(),
  spacing: z.number().nonnegative(),
  acuteAngleWarning: z.number().nonnegative(),
  acuteAngleNote: z.number().nonnegative(),
  difficultyOutsideRange: z.number().nonnegative(),
  courseLineCrossing: z.number().nonnegative(),
  courseLineThroughControl: z.number().nonnegative(),
  finalLegPerPercentOverLimit: z.number().nonnegative(),
  courseLineOutsideMap: z.number().nonnegative(),
  courseLineOverDescriptions: z.number().nonnegative(),
  overlappingCircles: z.number().nonnegative(),
  areaQuality: z.number().nonnegative(),
  routeChoicePerKeyLeg: z.number().nonnegative(),
  reversals: z.number().nonnegative(),
  ring: z.number().nonnegative(),
  legLengths: z.number().nonnegative(),
  alternation: z.number().nonnegative(),
  directionChanges: z.number().nonnegative(),
  firstLeg: z.number().nonnegative(),
  spread: z.number().nonnegative(),
  parallelLegs: z.number().nonnegative(),
  closeness: z.number().nonnegative(),
  crowding: z.number().nonnegative(),
  legCount: z.number().nonnegative(),
})

export type ScoreWeights = z.infer<typeof scoreWeightsSchema>
export type ScoreTermName = Exclude<keyof ScoreWeights, 'sources' | 'interpretation'>

// Hard rules outweigh anything the quality terms or the winning time can earn, so the search
// never trades them away, not even to reach a winning time the terrain cannot hold.
const RULE_PENALTIES = {
  timeErrorPerPercent: 2,
  timeOutsideRangePerPercent: 20,
  spacing: 1000,
  acuteAngleWarning: 500,
  acuteAngleNote: 5,
  difficultyOutsideRange: 4,
  courseLineCrossing: 30,
  courseLineThroughControl: 40,
  finalLegPerPercentOverLimit: 20,
  courseLineOutsideMap: 1000,
  courseLineOverDescriptions: 1000,
  overlappingCircles: 1000,
}

const WEIGHT_SOURCES = [
  iofRules('App. 2 §3.4.1'),
  ratamestarikirja('1.2.6.S'),
  ratamestarikirja('2.S.1'),
  ratamestarikirja('2.S.2'),
]

export const SCORE_WEIGHTS: Readonly<Record<Format, ScoreWeights>> = {
  long: {
    ...RULE_PENALTIES,
    areaQuality: 20,
    routeChoicePerKeyLeg: 8,
    reversals: 15,
    ring: 25,
    legLengths: 60,
    alternation: 20,
    directionChanges: 20,
    firstLeg: 5,
    spread: 20,
    parallelLegs: 30,
    closeness: 20,
    crowding: 40,
    legCount: 40,
    sources: WEIGHT_SOURCES,
    interpretation: true,
  },
  middle: {
    ...RULE_PENALTIES,
    areaQuality: 40,
    routeChoicePerKeyLeg: 0,
    reversals: 10,
    ring: 15,
    legLengths: 60,
    alternation: 20,
    directionChanges: 40,
    firstLeg: 5,
    spread: 10,
    parallelLegs: 20,
    // Middle distance is compact by nature (RMK 2.S.2), so coming back near a control is common.
    closeness: 5,
    crowding: 40,
    legCount: 30,
    sources: WEIGHT_SOURCES,
    interpretation: true,
  },
}
