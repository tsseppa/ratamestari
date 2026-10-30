import { CONTROL_FEATURE_MATCH_METRES, type Finding } from '@ratamestari/engine'
import {
  ACUTE_ANGLE,
  CONTROL_CIRCLE,
  CONTROL_SITE_DIFFICULTY,
  FOREST_CONTROL_SPACING,
  isom,
  lajisaannot,
  type Source,
} from '@ratamestari/rules'

export type Severity = 'error' | 'warning' | 'note'

export interface FindingDescription {
  readonly severity: Severity
  readonly text: string
  readonly basis: string
  readonly fixableControl: number | null
}

// Bases that are our own checks rather than a rule; the app shows them in the user's language.
export const OUR_CHECK = 'our check'
export const OUR_CHECK_NO_ROUTES = `${OUR_CHECK} (no marked routes yet)`
const WINNING_TIME_SOURCES = [lajisaannot('11.25'), lajisaannot('19.41'), lajisaannot('19.44')]
const citations = (sources: readonly Source[]) =>
  sources.map(({ document, section }) => `${document} ${section}`).join(', ')

export function describeFinding(finding: Finding, controlCount: number): FindingDescription {
  const name = (stop: number) =>
    stop === 0 ? 'the start' : stop === controlCount + 1 ? 'the finish' : `control ${stop}`
  const leg = (from: number, to: number) => `the line ${name(from)}–${name(to)}`
  const [a = 0, b = 0, c = 0, d = 0] = finding.stops
  const controls = finding.stops.filter(stop => stop >= 1 && stop <= controlCount)
  const fixableControl = controls.at(-1) ?? null
  const describe = (severity: Severity, text: string, basis: string) => ({
    severity,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    basis,
    fixableControl,
  })
  switch (finding.kind) {
    case 'spacing':
      return describe(
        'error',
        `${name(a)} and ${name(b)} are too close together`,
        citations(FOREST_CONTROL_SPACING.sources),
      )
    case 'acuteAngleWarnings':
      return describe(
        'warning',
        `sharp angle under ${ACUTE_ANGLE.warningBelowDegrees}° at ${name(a)}`,
        citations(ACUTE_ANGLE.sources),
      )
    case 'acuteAngleNotes':
      return describe(
        'note',
        `angle under ${ACUTE_ANGLE.noteBelowDegrees}° at ${name(a)}`,
        citations(ACUTE_ANGLE.sources),
      )
    case 'difficultyOutsideRange':
      return describe(
        'warning',
        `${name(a)} does not match the class's technical difficulty`,
        citations(CONTROL_SITE_DIFFICULTY.sources),
      )
    case 'courseLineCrossings':
      return describe('warning', `${leg(a, b)} crosses ${leg(c, d)}`, OUR_CHECK)
    case 'courseLinesThroughControls':
      return describe(
        'warning',
        `${leg(a, b)} passes through the circle of ${name(c)}`,
        citations(CONTROL_CIRCLE.sources),
      )
    case 'courseLinesOutsideMap':
      return describe('error', `${leg(a, b)} leaves the mapped area`, OUR_CHECK_NO_ROUTES)
    case 'courseLinesOverDescriptions':
      return describe('error', `${leg(a, b)} runs under the description box`, 'D7')
    case 'stopsOutsidePrintArea':
      return describe('error', `${name(a)} is outside the print area`, 'D7')
    case 'overlappingCircles':
      return describe(
        'error',
        `the circles of ${name(a)} and ${name(b)} overlap`,
        citations(CONTROL_CIRCLE.sources),
      )
    case 'winningTimeOutsideRange':
      return describe(
        'error',
        "the course cannot reach the class's winning-time range; the terrain within reach of the competition centre, or inside the chosen print area, may be too small for this class",
        citations(WINNING_TIME_SOURCES),
      )
    case 'controlsWithoutFeature':
      return describe(
        'warning',
        `no map feature found within ${CONTROL_FEATURE_MATCH_METRES} m of ${name(a)}; check the position`,
        OUR_CHECK,
      )
    case 'finalLegTooLong':
      return describe('note', `the last leg into the finish is long`, OUR_CHECK)
    // Fixed by moving the number, not by replacing the control.
    case 'numberOverCircle':
      return {
        ...describe(
          'error',
          `the number of ${name(a)} covers ${a === b ? 'its own circle' : b >= 1 && b <= controlCount ? `the circle of ${name(b)}` : name(b)}`,
          citations([isom('sym. 704')]),
        ),
        fixableControl: null,
      }
  }
}
