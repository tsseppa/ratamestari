import { z } from 'zod'
import { citedSchema, isom, ratamestarikirja } from './source'

export const courseOverprintRuleSchema = citedSchema.extend({
  baseScale: z.number().positive(),
  startTriangleSideMillimetres: z.number().positive(),
  controlCircleDiameterMillimetres: z.number().positive(),
  controlNumberHeightMillimetres: z.number().positive(),
  courseLineWidthMillimetres: z.number().positive(),
  courseLineGapMillimetres: z.number().nonnegative(),
  finishInnerDiameterMillimetres: z.number().positive(),
  finishOuterDiameterMillimetres: z.number().positive(),
  colour: z.string(),
})

export type CourseOverprintRule = z.infer<typeof courseOverprintRuleSchema>

export const COURSE_OVERPRINT: CourseOverprintRule = {
  baseScale: 15000,
  startTriangleSideMillimetres: 6,
  controlCircleDiameterMillimetres: 5,
  controlNumberHeightMillimetres: 4,
  courseLineWidthMillimetres: 0.35,
  courseLineGapMillimetres: 0.5,
  finishInnerDiameterMillimetres: 4,
  finishOuterDiameterMillimetres: 6,
  colour: 'rgb(190, 30, 180)',
  sources: [
    isom('§3.7'),
    isom('sym. 701'),
    isom('sym. 703'),
    isom('sym. 704'),
    isom('sym. 705'),
    isom('sym. 706'),
    ratamestarikirja('6.3'),
  ],
  interpretation: false,
}

export const overprintMillimetresAt = (millimetresAtBaseScale: number, printScale: number) =>
  (millimetresAtBaseScale * COURSE_OVERPRINT.baseScale) / printScale

// Course symbols keep their ground size at any print scale (ISOM 2017-2 §3.7).
export const overprintGroundMetres = (millimetresAtBaseScale: number) =>
  (millimetresAtBaseScale * COURSE_OVERPRINT.baseScale) / 1000

export const overprintLayoutRuleSchema = citedSchema.extend({
  numberGapMillimetres: z.number().nonnegative(),
  numberPositions: z.int().min(4),
  numberRings: z.int().min(1),
  numberRingStepMillimetres: z.number().positive(),
  numberWidthShareOfHeightPerDigit: z.number().positive(),
  numberInkHeightShareOfFontSize: z.number().positive(),
  cutClearanceMillimetres: z.number().nonnegative(),
  maxCircleCuts: z.int().nonnegative(),
  maxCircleCutShare: z.number().min(0).max(1),
  maxLegCuts: z.int().nonnegative(),
  maxLegCutShare: z.number().min(0).max(1),
  minLinePieceMillimetres: z.number().nonnegative(),
  outsideOfBendPreference: z.number().nonnegative(),
})

export type OverprintLayoutRule = z.infer<typeof overprintLayoutRuleSchema>

export const OVERPRINT_LAYOUT: OverprintLayoutRule = {
  numberGapMillimetres: 0.5,
  numberPositions: 16,
  // Farther rings only when every position nearer the circle is ruled out.
  numberRings: 3,
  numberRingStepMillimetres: 1,
  // Arial digits are about 0.56 of the font size wide, and their ink about 0.72 of it tall.
  numberWidthShareOfHeightPerDigit: 0.56,
  numberInkHeightShareOfFontSize: 0.72,
  // White between a cut end and the symbol it uncovers (RMK 6.2), above the 0.15 mm minimum gap.
  cutClearanceMillimetres: 0.25,
  maxCircleCuts: 3,
  maxCircleCutShare: 0.25,
  // Foot orienteering needs few line cuts (RMK 6.3), and many make the line read as dashed.
  maxLegCuts: 2,
  maxLegCutShare: 0.15,
  minLinePieceMillimetres: 1.5,
  outsideOfBendPreference: 1,
  sources: [
    isom('§2.11.3'),
    isom('sym. 703'),
    isom('sym. 704'),
    isom('sym. 705'),
    ratamestarikirja('6.2'),
    ratamestarikirja('6.3'),
    ratamestarikirja('6.4'),
  ],
  interpretation: true,
}

export const overprintDetailSchema = citedSchema.extend({
  codes: z.array(z.string().regex(/^[1-7]\d{2}$/)).min(1),
  shape: z.enum(['point', 'line']),
  // A point symbol's diameter, or a line symbol's width with its tags, at the base scale.
  sizeMillimetres: z.number().positive(),
  // Whether control circles and course lines are cut to leave it showing.
  cutsCourse: z.boolean(),
  // How much a control number covering it costs, relative to other map detail.
  numberWeight: z.number().nonnegative(),
})

export type OverprintDetail = z.infer<typeof overprintDetailSchema>

const detail = (
  codes: readonly string[],
  shape: OverprintDetail['shape'],
  sizeMillimetres: number,
  cutsCourse: boolean,
  numberWeight: number,
  sources: OverprintDetail['sources'],
): OverprintDetail => ({
  codes: [...codes],
  shape,
  sizeMillimetres,
  cutsCourse,
  numberWeight,
  sources,
  interpretation: true,
})

// Map detail the overprint should leave showing (ISOM 2017-2 sym. 703–705, RMK 6.2–6.4). Point
// features and cliffs matter for finding a control, so circles and lines are cut for them; numbers
// also keep off paths (RMK 6.3) and, less strongly, off other detail. Sizes from the ISOM symbols.
export const OVERPRINT_DETAIL: readonly OverprintDetail[] = [
  detail(['109', '110'], 'point', 0.8, true, 3, [isom('sym. 109'), isom('sym. 110')]),
  detail(['111', '112'], 'point', 0.8, true, 3, [isom('sym. 111'), isom('sym. 112')]),
  detail(['115'], 'point', 0.9, true, 3, [isom('sym. 115')]),
  detail(['203'], 'point', 0.8, true, 3, [isom('sym. 203')]),
  detail(['204'], 'point', 0.4, true, 3, [isom('sym. 204'), ratamestarikirja('6.2')]),
  detail(['205'], 'point', 0.6, true, 3, [isom('sym. 205'), ratamestarikirja('6.2')]),
  detail(['207'], 'point', 0.8, true, 3, [isom('sym. 207')]),
  detail(['303', '311', '312', '313'], 'point', 0.9, true, 3, [
    isom('sym. 303'),
    isom('sym. 311'),
    isom('sym. 312'),
    isom('sym. 313'),
  ]),
  detail(['524', '525', '526', '527', '530', '531'], 'point', 1, true, 3, [
    isom('sym. 524'),
    isom('sym. 525'),
    isom('sym. 526'),
    isom('sym. 527'),
    isom('sym. 530'),
    isom('sym. 531'),
  ]),
  detail(['201'], 'line', 0.8, true, 3, [isom('sym. 201'), ratamestarikirja('6.2')]),
  detail(['202'], 'line', 0.6, true, 2, [isom('sym. 202'), ratamestarikirja('6.2')]),
  detail(['502', '503', '504', '505', '506', '507'], 'line', 0.35, false, 3, [
    isom('sym. 502'),
    isom('sym. 505'),
    ratamestarikirja('6.3'),
  ]),
  detail(['304', '305', '306'], 'line', 0.3, false, 1.5, [isom('sym. 304'), isom('sym. 305')]),
  detail(['513', '514', '515', '516', '517', '518'], 'line', 0.6, false, 1.5, [
    isom('sym. 513'),
    isom('sym. 516'),
  ]),
  detail(['101', '102', '103'], 'line', 0.25, false, 0.3, [isom('§3.7')]),
]
