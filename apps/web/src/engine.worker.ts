import * as Comlink from 'comlink'
import type { LocalPoint, MapAnnotation, MapFeature, MapInfo } from '@ratamestari/core'
import {
  addControl,
  buildTerrain,
  withContourInterval,
  checkSetCourse,
  insertControlAt,
  recheckCourse,
  setFinish,
  startCourse,
  evaluateLeg,
  findControlSites,
  findRoute,
  nearestSite,
  findPeripheralInformation,
  isInPeripheralBlock,
  layOutOverprint,
  overprintDetailOf,
  NO_OVERPRINT_DETAIL,
  type OverprintDetailIndex,
  type OverprintLayout,
  fitCourseToFrame,
  fitCourseToPaper,
  fixControl,
  insertControl,
  moveStart,
  removeControl,
  suggestChanges,
  type CompassDirection,
  type CourseSuggestion,
  type StartWish,
  moveControl,
  papersFor,
  peripheralLayout,
  setCourseOnPaperSteps,
  siteForPoint,
  type CourseLocks,
  type CourseSpec,
  type PrintArea,
  type PaperChoice,
  type PrintFrame,
  type ReplacementPreference,
  type ControlSiteCandidate,
  type Course,
  type Search,
  type SearchProgress,
  type LegEvaluation,
  type PeripheralInformation,
  type Terrain,
} from '@ratamestari/engine'
import {
  describeControl,
  importedCourseStops,
  readCourseData,
  type ImportedCourseData,
} from '@ratamestari/iof'
import { loadOcadMap, type IsomCodeOverrides, type OcadMap } from '@ratamestari/map-import-ocad'
import {
  classFromCourseName,
  courseRequestSchema,
  courseTargetForPurpose,
  trainingRulesFor,
  printScaleFor,
  DEFAULT_CONTOUR_INTERVAL_METERS,
  type CourseClass,
  type CourseRequest,
  type PrintScaleChoice,
} from '@ratamestari/rules'
import type { CostGridSnapshot } from './cost-map-image'
import { legEndsAround, type ControlPreview, type PreviewLeg } from './leg-routes'

let map: OcadMap | null = null
let mapInfo: MapInfo | null = null
let terrain: Terrain | null = null
let sites: readonly ControlSiteCandidate[] = []
let overprintDetail: OverprintDetailIndex = NO_OVERPRINT_DETAIL
let peripheral: PeripheralInformation | null = null
let lastSetting: { spec: CourseSpec; paper: PaperChoice } | null = null
let imported: ImportedCourseData | null = null
let stopRequested = false
let contourIntervalByUser: number | null = null

export interface ContourInterval {
  readonly meters: number
  readonly readFromMap: number | null
  readonly isSetByUser: boolean
}

function contourIntervalInUse(): ContourInterval {
  const readFromMap = peripheral?.contourIntervalMetres ?? null
  return {
    meters: contourIntervalByUser ?? readFromMap ?? DEFAULT_CONTOUR_INTERVAL_METERS.value,
    readFromMap,
    isSetByUser: contourIntervalByUser !== null,
  }
}

// The search pauses regularly; giving the event loop a turn there lets a stop message through.
const SLICE_MILLISECONDS = 50

async function runSliced(search: Search, onProgress: (progress: SearchProgress) => void) {
  stopRequested = false
  let sliceStarted = performance.now()
  for (let step = search.next(); ; step = search.next(stopRequested)) {
    if (step.done) return step.value
    if (step.value) onProgress(step.value)
    if (performance.now() - sliceStarted > SLICE_MILLISECONDS) {
      await new Promise(resolve => setTimeout(resolve, 0))
      sliceStarted = performance.now()
    }
  }
}

export interface ImportedCourseSummary {
  readonly name: string
  readonly guessedClass: CourseClass | null
  readonly controlCount: number
  readonly lengthMeters: number | null
}

export interface CheckedCourse {
  readonly course: Course
  readonly controlCodes: readonly string[]
  readonly fileLengthMeters: number | null
  readonly groundMismatchMetres: number | null
}

function specFor(
  request: CourseRequest,
  competitionCentre: LocalPoint,
  seed: number,
  paceSecondsPerKm: number,
  printScaleChoice: PrintScaleChoice,
  startDistanceFromFinishMeters: readonly [number, number] | null = null,
): CourseSpec | null {
  const validRequest = courseRequestSchema.parse(request)
  const target = courseTargetForPurpose(validRequest)
  if (!target) return null
  return {
    target,
    training: trainingRulesFor(validRequest),
    format: validRequest.format,
    printScale: printScaleFor(printScaleChoice, validRequest.format),
    competitionCentre,
    seed,
    paceSecondsPerKm,
    peripheralSize: peripheral && peripheralLayout(peripheral.blocks),
    startDistanceFromFinishMeters,
  }
}

function fittedAsSet(
  course: Course,
  terrain: Terrain,
  { spec, paper }: NonNullable<typeof lastSetting>,
) {
  return spec.printFrame
    ? fitCourseToFrame(terrain, course, spec.printFrame, spec.peripheralSize)
    : fitCourseToPaper(terrain, course, papersFor(paper), spec.printScale, spec.peripheralSize)
}

function editedCourse(course: Course, edit: (spec: CourseSpec) => Course | null): Course | null {
  if (!terrain || !lastSetting) throw new Error('Set a course before editing it')
  const { spec } = lastSetting
  const edited = edit({ ...spec, ...(course.printArea && { printArea: course.printArea }) })
  return edited && fittedAsSet(edited, terrain, lastSetting)
}

function useFeatures(
  features: readonly MapFeature[],
  annotations: readonly MapAnnotation[],
  info: MapInfo,
) {
  terrain = buildTerrain(features, info.extent)
  overprintDetail = overprintDetailOf(features)
  peripheral = findPeripheralInformation(annotations, terrain, info.scale)
  terrain = withContourInterval(terrain, contourIntervalInUse().meters)
  const inMargin = isInPeripheralBlock.bind(null, peripheral)
  sites = findControlSites(features, terrain).filter(
    site => describeControl(site) !== null && !inMargin(site.position),
  )
}

const engine = {
  async loadMap(
    bytes: Uint8Array,
    corrections: IsomCodeOverrides,
    contourIntervalMeters: number | null,
  ): Promise<void> {
    map = await loadOcadMap(bytes)
    mapInfo = map.info
    contourIntervalByUser = contourIntervalMeters
    engine.applySymbolCorrections(corrections)
  },

  // For maps read outside the worker, such as from a PDF (D22).
  loadFeatures(
    features: readonly MapFeature[],
    info: MapInfo,
    contourIntervalMeters: number | null,
  ): void {
    map = null
    contourIntervalByUser = contourIntervalMeters
    mapInfo = info
    useFeatures(features, [], info)
  },

  applySymbolCorrections(corrections: IsomCodeOverrides): void {
    if (!map) throw new Error('No map loaded in the engine')
    useFeatures(map.features(corrections), map.annotations(corrections), map.info)
  },

  overprintLayout(course: Course): OverprintLayout {
    return layOutOverprint(course, overprintDetail)
  },

  contourInterval(): ContourInterval {
    return contourIntervalInUse()
  },

  // Null goes back to the interval read from the map, or the standard one.
  setContourInterval(meters: number | null): ContourInterval {
    if (!terrain) throw new Error('No map loaded in the engine')
    contourIntervalByUser = meters
    const interval = contourIntervalInUse()
    terrain = withContourInterval(terrain, interval.meters)
    return interval
  },

  peripheralInformation(): PeripheralInformation {
    if (!peripheral) throw new Error('No map loaded in the engine')
    return peripheral
  },

  evaluateLeg(from: LocalPoint, to: LocalPoint, paceSecondsPerKm: number): LegEvaluation | null {
    if (!terrain) throw new Error('No map loaded in the engine')
    return evaluateLeg(terrain, from, to, { paceSecondsPerKm })
  },

  // The control snaps to a site as a tapped one does. Only the fastest routes, so the preview can
  // follow the pointer; the alternatives come from evaluateLeg once the pointer rests.
  previewControl(
    at: LocalPoint,
    neighbours: readonly LocalPoint[],
    paceSecondsPerKm: number,
  ): ControlPreview | null {
    if (!terrain) throw new Error('No map loaded in the engine')
    const position = nearestSite(sites, at)?.position ?? at
    const legs: PreviewLeg[] = []
    for (const [from, to] of legEndsAround(position, neighbours)) {
      const fastest = findRoute(terrain.grid, from, to, { paceSecondsPerKm })
      if (!fastest) return null
      legs.push({ fastest, alternatives: [], hasLookedForAlternatives: false })
    }
    return { position, legs }
  },

  generateCourse(
    request: CourseRequest,
    competitionCentre: LocalPoint,
    seed: number,
    paceSecondsPerKm: number,
    paper: PaperChoice,
    printScaleChoice: PrintScaleChoice,
    printFrame: PrintFrame | null,
    onProgress: (progress: SearchProgress) => void,
    startDistanceFromFinishMeters: readonly [number, number] | null = null,
    // Kept controls, set again on the paper of the course they were kept from; or a planned leg
    // to keep, whose ends snap to control sites as a click does.
    kept:
      | { readonly locks: CourseLocks; readonly printArea: PrintArea | null }
      | { readonly legEnds: readonly [LocalPoint, LocalPoint] }
      | null = null,
  ): Promise<Course | null> {
    if (!terrain) throw new Error('No map loaded in the engine')
    const automatic = specFor(
      request,
      competitionCentre,
      seed,
      paceSecondsPerKm,
      printScaleChoice,
      startDistanceFromFinishMeters,
    )
    if (!automatic) return Promise.resolve(null)
    const framed = printFrame
      ? { ...automatic, printFrame, printScale: printFrame.scale }
      : automatic
    const spec: CourseSpec = !kept
      ? framed
      : 'legEnds' in kept
        ? {
            ...framed,
            locks: {
              start: null,
              controls: kept.legEnds.map(end => siteForPoint(sites, framed, end)),
              keptLegs: [false, true, false],
            },
          }
        : {
            ...framed,
            locks: kept.locks,
            ...(kept.printArea && !printFrame
              ? { printArea: kept.printArea, printScale: kept.printArea.scale }
              : {}),
          }
    lastSetting = { spec, paper }
    return runSliced(setCourseOnPaperSteps(terrain, sites, spec, paper), onProgress)
  },

  // generateCourse then resolves with the best course found so far.
  stopSearch(): void {
    stopRequested = true
  },

  importCourses(xml: string): readonly ImportedCourseSummary[] {
    imported = readCourseData(xml)
    return imported.courses.map(course => ({
      name: course.name,
      guessedClass: classFromCourseName(course.name),
      controlCount: course.controlIds.filter(id => imported!.controls.get(id)?.type === 'Control')
        .length,
      lengthMeters: course.lengthMeters,
    }))
  },

  // The setter's course is checked, measured and described; fixes stay suggestions (D15).
  checkImportedCourse(
    courseIndex: number,
    request: CourseRequest,
    paceSecondsPerKm: number,
    paper: PaperChoice,
    printScaleChoice: PrintScaleChoice,
  ): CheckedCourse | null {
    if (!terrain || !mapInfo) throw new Error('No map loaded in the engine')
    const course = imported?.courses[courseIndex]
    if (!imported || !course) throw new Error('Open a course file first')
    const stops = importedCourseStops(imported, course, mapInfo.scale, mapInfo.georef)
    if (!stops) return null
    const spec = specFor(request, stops.finish, 0, paceSecondsPerKm, printScaleChoice)
    if (!spec) return null
    lastSetting = { spec, paper }
    const checked = checkSetCourse(terrain, sites, spec, stops)
    return {
      course: fitCourseToPaper(
        terrain,
        checked,
        papersFor(paper),
        spec.printScale,
        spec.peripheralSize,
      ),
      controlCodes: stops.controlCodes,
      fileLengthMeters: course.lengthMeters,
      groundMismatchMetres: stops.groundMismatchMetres,
    }
  },

  refitToPaper(
    course: Course,
    paper: PaperChoice,
    printScaleChoice: PrintScaleChoice,
  ): Course | null {
    if (!terrain || !lastSetting) throw new Error('Set a course before changing its paper')
    const { printFrame: _placedByHand, ...automatic } = lastSetting.spec
    const spec = {
      ...automatic,
      printScale: printScaleFor(printScaleChoice, lastSetting.spec.format),
    }
    lastSetting = { spec, paper }
    return fitCourseToPaper(terrain, course, papersFor(paper), spec.printScale)
  },

  // The course stays as it is; controls the new frame leaves outside become findings.
  refitToFrame(course: Course, printFrame: PrintFrame): Course {
    if (!terrain || !lastSetting) throw new Error('Set a course before moving its paper')
    lastSetting = {
      spec: { ...lastSetting.spec, printFrame, printScale: printFrame.scale },
      paper: printFrame.paper,
    }
    return fittedAsSet(course, terrain, lastSetting)
  },

  moveControl(course: Course, stopIndex: number, to: LocalPoint): Course | null {
    return editedCourse(course, spec => moveControl(terrain!, sites, spec, course, stopIndex, to))
  },

  fixControl(
    course: Course,
    controlNumber: number,
    preference: ReplacementPreference = 'best',
    direction: CompassDirection | null = null,
  ): Course | null {
    return editedCourse(course, spec =>
      fixControl(terrain!, sites, spec, course, controlNumber, preference, direction),
    )
  },

  removeControl(course: Course, controlNumber: number): Course | null {
    return editedCourse(course, spec => removeControl(terrain!, sites, spec, course, controlNumber))
  },

  insertControl(course: Course, afterStop: number): Course | null {
    return editedCourse(course, spec => insertControl(terrain!, sites, spec, course, afterStop))
  },

  moveStart(course: Course, wish: StartWish): Course | null {
    return editedCourse(course, spec => moveStart(terrain!, sites, spec, course, wish))
  },

  suggestChanges(course: Course): CourseSuggestion[] {
    if (!terrain || !lastSetting) throw new Error('Set a course before asking for changes')
    const { spec } = lastSetting
    const suggestions = suggestChanges(
      terrain,
      sites,
      {
        ...spec,
        ...(course.printArea && { printArea: course.printArea }),
      },
      course,
    )
    return suggestions.flatMap(suggestion => {
      const fitted = editedCourse(course, () => suggestion.course)
      return fitted ? [{ ...suggestion, course: fitted }] : []
    })
  },

  // A course set by hand starts with the start the user placed and the finish at the centre.
  startCourseByHand(
    request: CourseRequest,
    competitionCentre: LocalPoint,
    paceSecondsPerKm: number,
    paper: PaperChoice,
    printScaleChoice: PrintScaleChoice,
    printFrame: PrintFrame | null,
    start: LocalPoint,
  ): Course | null {
    if (!terrain) throw new Error('No map loaded in the engine')
    const automatic = specFor(request, competitionCentre, 0, paceSecondsPerKm, printScaleChoice)
    if (!automatic) return null
    const spec = printFrame ? { ...automatic, printFrame, printScale: printFrame.scale } : automatic
    lastSetting = { spec, paper }
    return fittedAsSet(
      startCourse(terrain, sites, spec, start, competitionCentre),
      terrain,
      lastSetting,
    )
  },

  addControl(course: Course, at: LocalPoint): Course | null {
    return editedCourse(course, spec => addControl(terrain!, sites, spec, course, at))
  },

  insertControlAt(course: Course, afterStopIndex: number, at: LocalPoint): Course | null {
    return editedCourse(course, spec =>
      insertControlAt(terrain!, sites, spec, course, afterStopIndex, at),
    )
  },

  moveFinish(course: Course, to: LocalPoint): Course | null {
    return editedCourse(course, spec => setFinish(terrain!, sites, spec, course, to))
  },

  // A course being set by hand is checked again as the class the user switches to.
  recheckAs(
    course: Course,
    request: CourseRequest,
    paceSecondsPerKm: number,
    printScaleChoice: PrintScaleChoice,
  ): Course | null {
    if (!lastSetting) throw new Error('Set a course before editing it')
    const spec = specFor(
      request,
      lastSetting.spec.competitionCentre,
      lastSetting.spec.seed,
      paceSecondsPerKm,
      printScaleChoice,
    )
    if (!spec) return null
    const { printFrame } = lastSetting.spec
    lastSetting = {
      ...lastSetting,
      spec: printFrame ? { ...spec, printFrame, printScale: printFrame.scale } : spec,
    }
    return editedCourse(course, editSpec => recheckCourse(terrain!, sites, editSpec, course))
  },

  controlSites(): readonly ControlSiteCandidate[] {
    return sites
  },

  costGrid(): CostGridSnapshot {
    if (!terrain) throw new Error('No map loaded in the engine')
    const { minX, minY, cellSizeMeters, columns, rows, speed } = terrain.grid
    return { frame: { minX, minY, cellSizeMeters, columns, rows }, speed }
  },
}

export type EngineApi = typeof engine

Comlink.expose(engine)
