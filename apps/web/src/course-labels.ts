import { DEFAULT_TRAINING_STYLE, type CourseRequest } from '@ratamestari/rules'
import type { Messages } from './i18n'

const MAIN_CLASS_LETTER = 'A'

export const courseNameOf = (request: CourseRequest, trainingName: string) =>
  request.purpose === 'training'
    ? trainingName
    : `${request.sex}${request.ageClass}${request.skillLetter === MAIN_CLASS_LETTER ? '' : request.skillLetter}`

const trainingStyleOf = (request: CourseRequest) => request.trainingStyle ?? DEFAULT_TRAINING_STYLE

// A training course is named by its style (D26), a race by its format.
export const courseKindOf = (
  request: CourseRequest,
  labels: Pick<Messages['labels'], 'formats' | 'trainingStyles'>,
) =>
  request.purpose === 'training'
    ? labels.trainingStyles[trainingStyleOf(request)]
    : labels.formats[request.format]

export const courseKindFileKeyOf = (request: CourseRequest): string =>
  request.purpose === 'training' ? trainingStyleOf(request) : request.format
