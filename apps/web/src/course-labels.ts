import type { CourseRequest } from '@ratamestari/rules'

const MAIN_CLASS_LETTER = 'A'

export const courseNameOf = (request: CourseRequest, trainingName: string) =>
  request.purpose === 'training'
    ? trainingName
    : `${request.sex}${request.ageClass}${request.skillLetter === MAIN_CLASS_LETTER ? '' : request.skillLetter}`
