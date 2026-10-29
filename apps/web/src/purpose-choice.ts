import { courseTargetFor, eventLevelSchema, type CourseRequest } from '@ratamestari/rules'

// The course sentence offers contour training next to the event levels, though the request keeps
// its purpose apart from the level (D25).
export const TRAINING_CHOICE = 'training'

export const purposeChoiceOf = (request: CourseRequest): string =>
  request.purpose === 'training' ? TRAINING_CHOICE : request.eventLevel

export function withPurposeChoice(request: CourseRequest, choice: string): CourseRequest {
  if (choice !== TRAINING_CHOICE)
    return { ...request, purpose: 'competition', eventLevel: eventLevelSchema.parse(choice) }
  const minutes = courseTargetFor(request)?.winningTime.targetMinutes
  return {
    ...request,
    purpose: 'training',
    ...(minutes !== undefined && { trainingMinutes: Math.round(minutes) }),
  }
}

export function trainingMinutesFrom(typed: string): number | null {
  const minutes = Number(typed)
  return typed.trim() !== '' && Number.isFinite(minutes) && minutes > 0 ? minutes : null
}
