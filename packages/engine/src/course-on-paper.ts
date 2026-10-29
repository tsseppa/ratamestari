import type { LocalPoint } from '@ratamestari/core'
import { DESCRIPTION_BOX, PAPER, type PaperSize } from '@ratamestari/rules'
import type { ControlSiteCandidate } from './control-sites'
import { hasLocks } from './locks'
import {
  expectedControlCount,
  runSearch,
  searchCourseSteps,
  type Course,
  type CourseSpec,
  type Search,
  type SearchProgress,
} from './course-search'
import {
  fitBoxesToCourse,
  fitPrintAreaToCourse,
  lineCrossesExtent,
  placeBoxesInFrame,
  planPrintArea,
  reservedBoxesOf,
  stopsOutsideFrame,
  type PaperBoxSize,
  type PrintArea,
  type PrintFrame,
} from './print-area'
import type { Terrain } from './terrain'

export type PaperChoice = PaperSize | 'auto'

const FITS_WITHIN_SHARE_OF_TARGET = 0.05
const CLEARLY_BETTER_SHARE_OF_TARGET = 0.05

const timeError = (course: Course) =>
  Math.abs(course.estimatedSeconds - course.targetSeconds) / course.targetSeconds

const fitsOnPaper = (course: Course) =>
  timeError(course) <= FITS_WITHIN_SHARE_OF_TARGET &&
  course.problems.courseLinesOverDescriptions === 0

export const papersFor = (paper: PaperChoice): readonly PaperSize[] =>
  paper === 'auto' ? PAPER.preferenceOrder : [paper]

export function setCourseOnPaper(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  paper: PaperChoice,
  onProgress: (progress: SearchProgress) => void = () => {},
): Course | null {
  return runSearch(setCourseOnPaperSteps(terrain, sites, spec, paper), onProgress)
}

export function* setCourseOnPaperSteps(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  paper: PaperChoice,
): Search {
  if (spec.printFrame) return yield* setCourseInFrameSteps(terrain, sites, spec, spec.printFrame)
  const papers = papersFor(paper)
  const keptPositions = hasLocks(spec.locks)
    ? [spec.locks.start, ...spec.locks.controls].flatMap(site => (site ? [site.position] : []))
    : []
  // Kept controls were on this paper; a newly planned print area might leave them off it.
  if (hasLocks(spec.locks) && spec.printArea) {
    const course = yield* searchCourseSteps(terrain, sites, spec)
    return course && fitCourseToPaper(terrain, course, papers, spec.printScale, spec.peripheralSize)
  }
  const state = { stopped: false }
  const attempt = function* (size: PaperSize, showsProgress: boolean): Search {
    const printArea = planPrintArea(terrain, sites, {
      paper: size,
      printScale: spec.printScale,
      competitionCentre: spec.competitionCentre,
      descriptionRows: expectedControlCount(spec.format) + DESCRIPTION_BOX.rowsBesidesControls,
      peripheralSize: spec.peripheralSize ?? null,
      mustHold: keptPositions,
      training: spec.training ?? null,
    })
    if (!printArea) return null
    const search = searchCourseSteps(terrain, sites, { ...spec, printArea })
    for (let step = search.next(); ;) {
      if (step.done) return step.value
      const stop = Boolean(yield showsProgress ? step.value : null)
      if (stop) state.stopped = true
      step = search.next(stop)
    }
  }

  const [first, ...larger] = papers
  let course = first ? yield* attempt(first, true) : null
  for (const size of larger) {
    if (state.stopped || (course && fitsOnPaper(course))) break
    // A larger sheet helps only when the paper, not the terrain, was the limit.
    const alternative = yield* attempt(size, false)
    if (
      alternative &&
      (!course || timeError(alternative) < timeError(course) - CLEARLY_BETTER_SHARE_OF_TARGET)
    ) {
      course = alternative
    }
  }
  if (!course) return null

  return fitCourseToPaper(terrain, course, papers, spec.printScale, spec.peripheralSize)
}

function* setCourseInFrameSteps(
  terrain: Terrain,
  sites: readonly ControlSiteCandidate[],
  spec: CourseSpec,
  frame: PrintFrame,
): Search {
  const printArea = placeBoxesInFrame(terrain, sites, frame, {
    competitionCentre: spec.competitionCentre,
    descriptionRows: expectedControlCount(spec.format) + DESCRIPTION_BOX.rowsBesidesControls,
    peripheralSize: spec.peripheralSize ?? null,
  })
  if (!printArea) return null
  const course = yield* searchCourseSteps(terrain, sites, {
    ...spec,
    printScale: frame.scale,
    printArea,
  })
  return course && fitCourseToFrame(terrain, course, frame, spec.peripheralSize)
}

const stopsOf = (course: Course) => [
  course.start.position,
  ...course.controls.map(site => site.position),
  course.finish,
]

// The paper stays where the user put it; the boxes may move, and the course is checked against it.
export function fitCourseToFrame(
  terrain: Terrain,
  course: Course,
  frame: PrintFrame,
  peripheralSize: PaperBoxSize | null = null,
): Course {
  const stops = stopsOf(course)
  const printArea = fitBoxesToCourse(terrain, stops, frame, {
    descriptionRows: course.controls.length + DESCRIPTION_BOX.rowsBesidesControls,
    peripheralSize,
  })
  if (!printArea) return course
  return withPrintAreaChecked(course, stops, printArea)
}

function withPrintAreaChecked(
  course: Course,
  stops: readonly LocalPoint[],
  printArea: PrintArea,
): Course {
  const legsUnderBoxes = stops.flatMap((stop, i) =>
    i > 0 && reservedBoxesOf(printArea).some(box => lineCrossesExtent(stops[i - 1]!, stop, box))
      ? [[i - 1, i]]
      : [],
  )
  const outside = stopsOutsideFrame(stops, printArea)
  return {
    ...course,
    printArea,
    problems: {
      ...course.problems,
      courseLinesOverDescriptions: legsUnderBoxes.length,
      stopsOutsidePrintArea: outside.length,
    },
    findings: [
      ...course.findings.filter(
        finding =>
          finding.kind !== 'courseLinesOverDescriptions' &&
          finding.kind !== 'stopsOutsidePrintArea',
      ),
      ...legsUnderBoxes.map(legStops => ({
        kind: 'courseLinesOverDescriptions' as const,
        stops: legStops,
      })),
      ...outside.map(stop => ({ kind: 'stopsOutsidePrintArea' as const, stops: [stop] })),
    ],
  }
}

export function fitCourseToPaper(
  terrain: Terrain,
  course: Course,
  papers: readonly PaperSize[],
  printScale: number,
  peripheralSize: PaperBoxSize | null = null,
): Course {
  const stops = stopsOf(course)
  const fitted = fitPrintAreaToCourse(terrain, stops, {
    papers,
    printScale,
    descriptionRows: course.controls.length + DESCRIPTION_BOX.rowsBesidesControls,
    peripheralSize,
  })
  if (!fitted) return course
  return withPrintAreaChecked(course, stops, fitted)
}
