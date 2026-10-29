import {
  CROWDING,
  FORMAT_QUALITY,
  FORMAT_TEMPLATES,
  SCORE_WEIGHTS,
  type FormatQualityProfile,
  type FormatTemplate,
  type TrainingStyleProfile,
} from '@ratamestari/rules'
import type { CourseSpec } from './course-search'

export type CourseProfile = Pick<
  TrainingStyleProfile,
  'template' | 'quality' | 'weights' | 'crowding' | 'allowsCrossingLegs'
>

type ProfileSource = Pick<CourseSpec, 'format' | 'training'>

// A training course takes its shape from its style (D26), a competition course from its format.
export const courseProfileOf = (spec: ProfileSource): CourseProfile =>
  spec.training?.styleProfile ?? {
    template: FORMAT_TEMPLATES[spec.format],
    quality: FORMAT_QUALITY[spec.format],
    weights: SCORE_WEIGHTS[spec.format],
    crowding: CROWDING[spec.format],
    allowsCrossingLegs: false,
  }

export const templateOf = (spec: ProfileSource): FormatTemplate => courseProfileOf(spec).template

export const qualityProfileOf = (spec: ProfileSource): FormatQualityProfile =>
  courseProfileOf(spec).quality
