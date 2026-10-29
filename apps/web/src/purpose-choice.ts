import { TRAINING_DEFAULTS, type CoursePurpose, type CourseRequest } from '@ratamestari/rules'

// A request without a purpose is for a race, as before training existed (D25).
export const purposeOf = (request: CourseRequest): CoursePurpose => request.purpose ?? 'competition'

// The class, level and training minutes all stay in the request, so switching back and forth
// keeps what the user chose for each.
export const withPurpose = (request: CourseRequest, purpose: CoursePurpose): CourseRequest => ({
  ...request,
  purpose,
})

export const trainingMinutesOf = (request: CourseRequest): number =>
  request.trainingMinutes ?? TRAINING_DEFAULTS.contour[request.format].winningTime.targetMinutes

export function trainingMinutesFrom(typed: string): number | null {
  const minutes = Number(typed)
  return typed.trim() !== '' && Number.isFinite(minutes) && minutes > 0 ? minutes : null
}
