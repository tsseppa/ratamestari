import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { localPoint, type LocalPoint } from '@ratamestari/core'
import {
  centreOfExtent,
  hasRoomForCentre,
  printFrameAround,
  type ControlSiteCandidate,
  type Course,
  type Orientation,
  type OverprintLayout,
  type PaperChoice,
  type SearchProgress,
} from '@ratamestari/engine'
import {
  printScaleFor,
  type CourseRequest,
  type IsomCode,
  type PrintScaleChoice,
} from '@ratamestari/rules'
import {
  createCourseTools,
  type CourseWorkspace,
  type GenerateOptions,
  type UiNameKey,
} from '@ratamestari/agent'
import {
  formatOcadSymbolNumber,
  isomCodeForOcadSymbol,
  loadOcadMap,
} from '@ratamestari/map-import-ocad'
import type { PdfMapPage } from '@ratamestari/map-import-pdf'
import { renderCostMap, type CostMapImage } from './cost-map-image'
import { ChatPanel } from './ChatPanel'
import { useAssistantKey } from './assistant-key'
import { SettingsSheet } from './SettingsSheet'
import { ContourIntervalLine, MapStart, PanelHeader, PanelLine } from './WorkspaceStart'
import { loadContourInterval, saveContourInterval } from './contour-interval'
import { atLeastHalf, SheetHandle, sheetStyle, type SheetSize } from './SheetHandle'
import { CoursePanel, hasCoarsePointer } from './CoursePanel'
import { CourseRoutesPanel } from './CourseRoutesPanel'
import { createLegRouteCache, useCourseRoutes } from './course-routes'
import { createRouteQueue, SUPERSEDED } from './route-queue'
import { descriptionBoxFor } from './description-box'
import { downloadCourseXml } from './export-xml'
import { savePrintPdf } from './print-pdf'
import { useExperimentalFeatures } from './experimental'
import {
  isPdfFile,
  pdfLoadedMap,
  PDF_PRINT_SCALES,
  printedCourseXml,
  readPdfMapFile,
  type LoadedMap,
} from './pdf-map'
import { SymbolPanel } from './SymbolPanel'
import {
  loadCorrections,
  mapKeyOf,
  saveCorrections,
  type SymbolCorrections,
} from './symbol-corrections'
import { track } from './analytics'
import { courseNameOf } from './course-labels'
import { createEngine, progressCallback } from './engine'
import type { CheckedCourse, ContourInterval, ImportedCourseSummary } from './engine.worker'
import type { CourseFileCheck } from './CheckPanel'
import { withOfferedClass } from './class-choice'
import { deduceClass, type DeducedClass } from './course-fit'
import { formatDuration, parsePace } from './format'
import { LegRoutesPanel, PlanLegPanel } from './LegRoutesPanel'
import {
  EMPTY_PLANNED_LEG,
  isSamePreview,
  legEnds,
  legEndsAround,
  plannedEnds,
  type ControlPreview,
  type LegRoutesState,
  type PlannedLeg,
} from './leg-routes'
import { useFormat, useMessages, type Messages } from './i18n'
import { useLanguageChoice } from './i18n/language-root'
import { MapView } from './MapView'
import { EditControlsTool, LayersMenu, PlanLegTool, PrintFrameBar, PrintLabel } from './MapTools'
import {
  forgetStops,
  isLegKept,
  isStopKept,
  keepStopsAndLegs,
  keptAroundLeg,
  keptCount,
  keptIndices,
  keptMarksOf,
  locksFor,
  NOTHING_KEPT,
  toggleLeg,
  toggleStop,
  withMovedStop,
  type Kept,
} from './kept'
import { SetByHandPanel } from './SetByHandPanel'
import { handEditFor, isControlStop, neighboursOf, withUndoStep } from './set-by-hand'
import type { CourseHit } from './course-overprint'
import { rasterizeSvg, type MapImage } from './rasterize'
import type { SearchStatus } from './search-progress'
import {
  APP_VERSION,
  OCAD2GEOJSON_URL,
  RELEASE_URL,
  SAMPLE_MAP,
  SAMPLE_QUERY,
  SOURCE_CODE_URL,
  SUBPAGE_PATHS,
} from './config'

type LoadState =
  | { status: 'empty' }
  | { status: 'loading'; fileName: string }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      fileName: string
      map: LoadedMap
      pdf: { page: PdfMapPage; printScale: number } | null
      image: MapImage
      ms: number
    }

type EngineState = 'idle' | 'loading' | 'ready' | 'error'

const DEFAULT_REQUEST: CourseRequest = {
  eventLevel: 'finnishChampionship',
  format: 'long',
  sex: 'H',
  ageClass: 21,
  skillLetter: 'A',
}

const DEFAULT_WINNER_PACE = '5:00'

interface PlacedFrame {
  readonly centre: LocalPoint
  readonly orientation: Orientation
}

const isSameRequest = (a: CourseRequest, b: CourseRequest) =>
  a.eventLevel === b.eventLevel &&
  a.format === b.format &&
  a.sex === b.sex &&
  a.ageClass === b.ageClass &&
  a.skillLetter === b.skillLetter &&
  (a.purpose ?? 'competition') === (b.purpose ?? 'competition') &&
  a.trainingMinutes === b.trainingMinutes

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

function frameFor(
  placed: PlacedFrame | null,
  paper: PaperChoice,
  printScale: PrintScaleChoice,
  request: CourseRequest,
) {
  if (!placed || paper === 'auto') return null
  const scale = printScaleFor(printScale, request.format)
  return printFrameAround(placed.centre, paper, placed.orientation, scale)
}

// The alternatives are worth a moment's wait; they come once the pointer rests this long.
const PREVIEW_REST_MS = 150

// Only the final course is shown, revealed when the search ends.

export function App() {
  const [engine] = useState(createEngine)
  const [state, setState] = useState<LoadState>({ status: 'empty' })
  const [engineState, setEngineState] = useState<EngineState>('idle')
  const [plannedLeg, setPlannedLeg] = useState<PlannedLeg | null>(null)
  const [planRoutes, setPlanRoutes] = useState<LegRoutesState>({ status: 'finding' })
  const [routeQueue] = useState(createRouteQueue)
  const [routeCache] = useState(createLegRouteCache)
  const [showCourseRoutes, setShowCourseRoutes] = useState(false)
  const [isRouteListWanted, setIsRouteListWanted] = useState(false)
  const [preview, setPreview] = useState<ControlPreview | null>(null)
  const latestPreview = useRef(0)
  const previewRest = useRef<number | undefined>(undefined)
  const [selectedLeg, setSelectedLeg] = useState<number | null>(null)
  const [kept, setKeptState] = useState<Kept>(NOTHING_KEPT)
  // The assistant keeps controls and sets the course in one turn, before React renders again.
  const keptRef = useRef(kept)
  const setKept = (next: Kept | ((current: Kept) => Kept)) => {
    keptRef.current = typeof next === 'function' ? next(keptRef.current) : next
    setKeptState(keptRef.current)
  }
  const [legRoutes, setLegRoutes] = useState<LegRoutesState>({ status: 'finding' })
  const latestLegRoutesRequest = useRef(0)
  const messages = useMessages()
  const format = useFormat()
  const { code: locale } = useLanguageChoice()
  const [showCostMap, setShowCostMap] = useState(false)
  const [costMap, setCostMap] = useState<CostMapImage | null>(null)
  const [showSites, setShowSites] = useState(false)
  const [sites, setSites] = useState<readonly ControlSiteCandidate[] | null>(null)
  const [competitionCentre, setCompetitionCentre] = useState<LocalPoint | null>(null)
  const [startWish, setStartWish] = useState<readonly [number, number] | null>(null)
  const [isSampleMap, setIsSampleMap] = useState(false)
  const [drawCourseKey, setDrawCourseKey] = useState(0)
  const [isSampleCoursePending, setIsSampleCoursePending] = useState(false)
  const isExperimental = useExperimentalFeatures()
  const [printedCourseFile, setPrintedCourseFile] = useState<File | null>(null)
  const hasAskedForSample = useRef(false)
  const [isPickingCentre, setIsPickingCentre] = useState(false)
  const [request, setRequest] = useState<CourseRequest>(DEFAULT_REQUEST)
  const [seed, setSeed] = useState(1)
  const [course, setCourse] = useState<Course | null>(null)
  const [overprint, setOverprint] = useState<{
    course: Course
    layout: OverprintLayout
  } | null>(null)
  const [search, setSearch] = useState<SearchStatus | null>(null)
  const isGenerating = search !== null
  const [paceText, setPaceText] = useState(DEFAULT_WINNER_PACE)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const assistantKey = useAssistantKey()
  const fileInput = useRef<HTMLInputElement>(null)
  const courseFileInput = useRef<HTMLInputElement>(null)
  const [courseFile, setCourseFile] = useState<{
    fileName: string
    courses: readonly ImportedCourseSummary[]
    selected: number
    status: CourseFileCheck['status']
    checked: CheckedCourse | null
    deduced: DeducedClass | null
  } | null>(null)
  const latestCheck = useRef(0)
  const [suggestion, setSuggestion] = useState<{
    controlNumber: number
    course: Course | null
  } | null>(null)
  const sheet = useRef<HTMLElement>(null)
  const [sheetSize, setSheetSize] = useState<SheetSize>('peek')
  const [paper, setPaper] = useState<PaperChoice>('auto')
  const [printScale, setPrintScale] = useState<PrintScaleChoice>('auto')
  const [placedFrame, setPlacedFrame] = useState<PlacedFrame | null>(null)
  const [isPlacingFrame, setIsPlacingFrame] = useState(false)
  const [isPreparingPdf, setIsPreparingPdf] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isSettingByHand, setIsSettingByHand] = useState(false)
  const [selectedStop, setSelectedStop] = useState<number | null>(null)
  const [undoHistory, setUndoHistory] = useState<readonly (Course | null)[]>([])
  const [mapKey, setMapKey] = useState<string | null>(null)
  const [corrections, setCorrections] = useState<SymbolCorrections>(new Map())
  const [contourInterval, setContourInterval] = useState<ContourInterval | null>(null)
  const [editMessage, setEditMessage] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
  const paceSecondsPerKm = parsePace(paceText)
  const winnerPace = paceSecondsPerKm ?? parsePace(DEFAULT_WINNER_PACE)!
  const winnerPaceRef = useRef(winnerPace)
  winnerPaceRef.current = winnerPace
  const legRoutesOfCourse = useCourseRoutes(
    engine,
    routeQueue,
    routeCache,
    isGenerating ? null : course,
    winnerPace,
    engineState === 'ready' && (showCourseRoutes || isRouteListWanted),
  )
  const courseRoutesOnMap = useMemo(
    () =>
      showCourseRoutes && legRoutesOfCourse
        ? legRoutesOfCourse.flatMap((state, leg) =>
            state.status === 'evaluated' && leg !== selectedLeg ? [state.leg] : [],
          )
        : null,
    [showCourseRoutes, legRoutesOfCourse, selectedLeg],
  )

  async function openSampleMap() {
    try {
      const response = await fetch(SAMPLE_MAP.path)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const file = new File([await response.arrayBuffer()], SAMPLE_MAP.fileName)
      setIsSampleCoursePending(true)
      await openFile(file, 'sample')
      setIsSampleMap(true)
    } catch (e) {
      setIsSampleCoursePending(false)
      setState({ status: 'error', message: messages.workspace.sampleFailed(errorMessage(e)) })
    }
  }

  useEffect(() => {
    if (hasAskedForSample.current) return
    hasAskedForSample.current = true
    if (new URLSearchParams(window.location.search).has(SAMPLE_QUERY)) void openSampleMap()
  })

  useEffect(() => {
    if (!isSampleCoursePending || engineState !== 'ready' || state.status !== 'ready') return
    setIsSampleCoursePending(false)
    const centre = localPoint(...SAMPLE_MAP.centre)
    setCompetitionCentre(centre)
    void generateCourse(SAMPLE_MAP.request, seed, paceSecondsPerKm, centre)
  })

  async function changeContourInterval(meters: number | null) {
    setContourInterval(await engine.setContourInterval(meters))
    if (mapKey) saveContourInterval(mapKey, meters)
    if (course && !courseFile)
      void editCourse(
        current => engine.recheckAs(current, request, winnerPace, printScale),
        messages.setByHand.noRulesForClass,
      )
  }

  async function openFile(file: File, map: 'sample' | 'own' = 'own') {
    track('map-opened', { map })
    setIsSampleMap(false)
    clearWorkspace(file.name)
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (isExperimental && isPdfFile(file)) {
      await openPdfMap(file.name, bytes)
      return
    }
    const key = await mapKeyOf(bytes)
    const storedCorrections = loadCorrections(key)
    setMapKey(key)
    setCorrections(storedCorrections)
    engine
      .loadMap(bytes, storedCorrections, loadContourInterval(key))
      .then(() => engine.contourInterval())
      .then(interval => {
        setContourInterval(interval)
        setEngineState('ready')
      })
      .catch(() => setEngineState('error'))
    try {
      const t0 = performance.now()
      const map = await loadOcadMap(bytes)
      const image = await rasterizeSvg(map.renderSvg(document), map.info.extent)
      setState({
        status: 'ready',
        fileName: file.name,
        map,
        pdf: null,
        image,
        ms: performance.now() - t0,
      })
    } catch (e) {
      setState({ status: 'error', message: errorMessage(e) })
    }
  }

  function clearWorkspace(fileName: string) {
    setCourseFile(null)
    setPrintedCourseFile(null)
    setSuggestion(null)
    setState({ status: 'loading', fileName })
    setEngineState('loading')
    setCostMap(null)
    setSites(null)
    setCourse(null)
    setSelectedLeg(null)
    setPlannedLeg(null)
    setCompetitionCentre(null)
    setStartWish(null)
    setContourInterval(null)
    setPlacedFrame(null)
    setIsPlacingFrame(false)
    stopSettingByHand()
    setUndoHistory([])
  }

  // Experimental (D22, D24): the map and the course printed on it, read from a PDF page.
  async function openPdfMap(fileName: string, bytes: Uint8Array) {
    setMapKey(null)
    setCorrections(new Map())
    try {
      const t0 = performance.now()
      const reading = await readPdfMapFile(bytes)
      if (reading.kind === 'picture') throw new Error(messages.workspace.pdfIsPicture)
      if (reading.kind === 'nothing') throw new Error(messages.workspace.pdfWithoutMap)
      await showPdfPage(fileName, reading.page, reading.page.suggestedPrintScale, t0)
    } catch (e) {
      setEngineState('error')
      setState({ status: 'error', message: errorMessage(e) })
    }
  }

  async function showPdfPage(
    fileName: string,
    page: PdfMapPage,
    printScale: number,
    t0 = performance.now(),
  ) {
    const map = await pdfLoadedMap(page, printScale)
    setEngineState('loading')
    engine
      .loadFeatures(page.features(printScale), map.info)
      .then(() => setEngineState('ready'))
      .catch(() => setEngineState('error'))
    const image = await rasterizeSvg(map.renderSvg(document), map.info.extent)
    setState({
      status: 'ready',
      fileName,
      map,
      pdf: { page, printScale },
      image,
      ms: performance.now() - t0,
    })
    const xml = printedCourseXml(page, printScale, {
      eventName: fileName,
      courseName: messages.workspace.printedCourse,
    })
    if (xml) setPrintedCourseFile(new File([xml], fileName.replace(/\.pdf$/i, '.xml')))
  }

  async function changePdfPrintScale(printScale: number) {
    if (state.status !== 'ready' || !state.pdf) return
    clearWorkspace(state.fileName)
    await showPdfPage(state.fileName, state.pdf.page, printScale)
  }

  useEffect(() => {
    if (!printedCourseFile || engineState !== 'ready' || state.status !== 'ready') return
    setPrintedCourseFile(null)
    void openCourseFile(printedCourseFile)
  })

  useEffect(() => {
    const ends = plannedLeg && plannedEnds(plannedLeg)
    if (engineState !== 'ready' || !ends) return
    void routeQueue
      .request('planned leg', 'selected', () =>
        engine.evaluateLeg(ends[0], ends[1], winnerPaceRef.current),
      )
      .then(leg => {
        if (leg === SUPERSEDED) return
        setPlanRoutes(leg ? { status: 'evaluated', leg } : { status: 'unreachable' })
      })
  }, [engine, engineState, routeQueue, plannedLeg, winnerPace])

  useEffect(() => {
    if (engineState === 'loading') routeCache.clear()
  }, [engineState, routeCache])

  useEffect(() => {
    if (isSettingByHand) return
    window.clearTimeout(previewRest.current)
    latestPreview.current++
    setPreview(null)
  }, [isSettingByHand])

  useEffect(() => {
    if (engineState !== 'ready' || !course || selectedLeg === null) return
    const ends = legEnds(course, selectedLeg)
    if (!ends) {
      setSelectedLeg(null)
      return
    }
    const request = ++latestLegRoutesRequest.current
    setLegRoutes(routeCache.get(...ends, winnerPace) ?? { status: 'finding' })
    void routeCache
      .find(engine, routeQueue, 'selected', 'selected leg', ends, winnerPace)
      .then(state => {
        if (state && request === latestLegRoutesRequest.current) setLegRoutes(state)
      })
  }, [engine, engineState, routeQueue, routeCache, course, selectedLeg, winnerPace])

  useEffect(() => {
    if (!course || isGenerating || engineState !== 'ready') return
    let isCurrent = true
    void engine.overprintLayout(course).then(layout => {
      if (isCurrent) setOverprint({ course, layout })
    })
    return () => {
      isCurrent = false
    }
  }, [engine, engineState, course, isGenerating])
  const overprintLayout = overprint && overprint.course === course ? overprint.layout : null
  const keptMarks = useMemo(
    () =>
      course && !isGenerating ? keptMarksOf(kept, course, overprintLayout?.numberCentres) : [],
    [kept, course, isGenerating, overprintLayout],
  )

  useEffect(() => {
    if (!showCostMap || costMap || engineState !== 'ready') return
    void engine.costGrid().then(renderCostMap).then(setCostMap)
  }, [engine, engineState, showCostMap, costMap])

  useEffect(() => {
    if (!showSites || sites || engineState !== 'ready') return
    void engine.controlSites().then(setSites)
  }, [engine, engineState, showSites, sites])

  // Kept controls belong to one finish and one map; a new centre or map starts afresh.
  useEffect(() => setKept(NOTHING_KEPT), [competitionCentre])

  async function generateCourse(
    nextRequest: CourseRequest,
    nextSeed: number,
    pace: number | null,
    centre = competitionCentre,
    wish = startWish,
    aroundLeg: readonly [LocalPoint, LocalPoint] | null = null,
  ): Promise<Course | null> {
    if (!centre || pace === null) return null
    const locks = !aroundLeg && course ? locksFor(keptRef.current, course) : null
    const frame = frameFor(placedFrame, paper, printScale, nextRequest)
    if (frame && !hasRoomForCentre(frame, centre)) {
      setEditMessage(messages.print.centreOutside)
      return null
    }
    setRequest(nextRequest)
    setSeed(nextSeed)
    setCourse(null)
    setSearch({ startedAt: Date.now() })
    setPlannedLeg(null)
    setSelectedLeg(null)
    setEditMessage(null)
    stopSettingByHand()
    setUndoHistory([])
    try {
      const result = await engine.generateCourse(
        nextRequest,
        centre,
        nextSeed,
        pace,
        paper,
        printScale,
        frame,
        progressCallback<SearchProgress>(({ phase }) =>
          setSearch(current => current && { ...current, phase }),
        ),
        wish,
        aroundLeg ? { legEnds: aroundLeg } : locks && { locks, printArea: course!.printArea },
      )
      setCourse(result)
      if (result && aroundLeg) setKept(keptAroundLeg(result, aroundLeg))
      if (result) {
        setDrawCourseKey(key => key + 1)
        track('course-set', {
          map: isSampleMap ? 'sample' : 'own',
          level: nextRequest.purpose === 'training' ? 'training' : nextRequest.eventLevel,
          format: nextRequest.format,
          courseClass: courseNameOf(nextRequest, 'training'),
          keptControls: aroundLeg ? 2 : (locks?.controls.length ?? 0),
        })
      } else setEditMessage(messages.course.noCourse)
      return result
    } catch (e) {
      setEditMessage(messages.course.generationFailed(errorMessage(e)))
      return null
    } finally {
      setSearch(null)
    }
  }

  function generateFromChat(nextRequest: CourseRequest, options: GenerateOptions) {
    const pace = options.winnerPaceSecondsPerKm ?? paceSecondsPerKm
    if (options.winnerPaceSecondsPerKm !== undefined)
      setPaceText(formatDuration(options.winnerPaceSecondsPerKm))
    const wish =
      options.startDistanceFromFinishMeters === undefined
        ? startWish
        : options.startDistanceFromFinishMeters
    setStartWish(wish)
    return generateCourse(nextRequest, options.option ?? seed, pace, competitionCentre, wish)
  }

  async function editedFromChat(edit: Promise<Course | null>) {
    const before = course
    const edited = await edit
    if (edited) {
      setUndoHistory(history => withUndoStep(history, before))
      setCourse(edited)
    }
    return edited
  }

  const latestWorkspace = useRef<CourseWorkspace | null>(null)
  latestWorkspace.current = {
    status: () => ({
      ui: { language: locale, names: uiNamesOf(messages) },
      mapLoaded: state.status === 'ready' && engineState === 'ready',
      mapScale: state.status === 'ready' ? state.map.info.scale : null,
      hasCompetitionCentre: competitionCentre !== null,
      request,
      winnerPaceSecondsPerKm: paceSecondsPerKm,
      startDistanceFromFinishMeters: startWish,
      course,
      selectedLeg,
      undoSteps: undoHistory.length,
      kept: course ? keptIndices(keptRef.current, course) : { stops: [], legs: [] },
    }),
    generateCourse: generateFromChat,
    showRequest: setRequest,
    replaceControl: (current, controlNumber, preference, direction) =>
      editedFromChat(engine.fixControl(current, controlNumber, preference, direction ?? null)),
    removeControl: (current, controlNumber) =>
      editedFromChat(engine.removeControl(current, controlNumber)),
    insertControl: (current, afterStop) => editedFromChat(engine.insertControl(current, afterStop)),
    moveStart: (current, wish) => editedFromChat(engine.moveStart(current, wish)),
    suggestChanges: current => engine.suggestChanges(current),
    applyCourse: next => {
      setUndoHistory(history => withUndoStep(history, course))
      setCourse(next)
    },
    undo,
    keep: (stops, legs) => {
      if (course) setKept(current => keepStopsAndLegs(current, course, stops, legs))
    },
    forgetKept: stops => {
      if (course) setKept(current => (stops ? forgetStops(current, course, stops) : NOTHING_KEPT))
    },
    mapSymbols: () =>
      state.status === 'ready'
        ? state.map.symbols().map(symbol => ({
            symbol: formatOcadSymbolNumber(symbol.number),
            name: symbol.name,
            objects: symbol.objectCount,
            isomCode: corrections.has(symbol.number)
              ? corrections.get(symbol.number)!
              : isomCodeForOcadSymbol(symbol.number),
            corrected: corrections.has(symbol.number),
          }))
        : [],
    correctSymbol: async (label, isomCode) => {
      if (state.status !== 'ready') return
      const symbol = state.map.symbols().find(s => formatOcadSymbolNumber(s.number) === label)
      if (symbol) await correctSymbol(symbol.number, isomCode)
    },
  }
  const [chatTools] = useState(() =>
    createCourseTools({
      status: () => latestWorkspace.current!.status(),
      generateCourse: (nextRequest, options) =>
        latestWorkspace.current!.generateCourse(nextRequest, options),
      showRequest: nextRequest => latestWorkspace.current!.showRequest(nextRequest),
      replaceControl: (current, controlNumber, preference, direction) =>
        latestWorkspace.current!.replaceControl(current, controlNumber, preference, direction),
      removeControl: (current, controlNumber) =>
        latestWorkspace.current!.removeControl(current, controlNumber),
      insertControl: (current, afterStop) =>
        latestWorkspace.current!.insertControl(current, afterStop),
      moveStart: (current, wish) => latestWorkspace.current!.moveStart(current, wish),
      suggestChanges: current => latestWorkspace.current!.suggestChanges(current),
      applyCourse: next => latestWorkspace.current!.applyCourse(next),
      undo: () => latestWorkspace.current!.undo(),
      keep: (stops, legs) => latestWorkspace.current!.keep(stops, legs),
      forgetKept: stops => latestWorkspace.current!.forgetKept(stops),
      mapSymbols: () => latestWorkspace.current!.mapSymbols(),
      correctSymbol: (symbol, isomCode) => latestWorkspace.current!.correctSymbol(symbol, isomCode),
    }),
  )

  async function editCourse(edit: (current: Course) => Promise<Course | null>, refused: string) {
    if (!course || isEditing) return
    setIsEditing(true)
    setSuggestion(null)
    setEditMessage(null)
    const before = course
    try {
      const edited = await edit(before)
      setCourse(edited ?? { ...before })
      if (!edited) setEditMessage(refused)
    } catch (e) {
      setCourse({ ...before })
      setEditMessage(errorMessage(e))
    } finally {
      setIsEditing(false)
    }
  }

  // Edits the user makes on the map can be undone one by one, back to the empty map.
  async function editByHand(
    edit: (current: Course | null) => Promise<Course | null>,
    refused: string,
  ) {
    if (isEditing) return
    setIsEditing(true)
    setSuggestion(null)
    setEditMessage(null)
    const before = course
    try {
      const edited = await edit(before)
      if (edited) {
        setUndoHistory(history => withUndoStep(history, before))
        setCourse(edited)
      } else {
        setCourse(before && { ...before })
        setEditMessage(refused)
      }
      return edited
    } catch (e) {
      setCourse(before && { ...before })
      setEditMessage(errorMessage(e))
      return null
    } finally {
      setIsEditing(false)
    }
  }

  function undo(): { course: Course | null } | null {
    const previous = undoHistory.at(-1)
    if (previous === undefined || isEditing) return null
    setUndoHistory(history => history.slice(0, -1))
    setSelectedStop(null)
    setSelectedLeg(null)
    setCourse(previous)
    return { course: previous }
  }

  function startSettingByHand() {
    track('set-by-hand-started')
    setPlannedLeg(null)
    setSelectedLeg(null)
    setSelectedStop(null)
    setIsPickingCentre(false)
    setIsSettingByHand(true)
  }

  function stopSettingByHand() {
    setIsSettingByHand(false)
    setSelectedStop(null)
  }

  function tapCourse(hit: CourseHit | null, at: LocalPoint) {
    if (isEditing) return
    const edit = handEditFor(course, selectedStop, hit, at)
    const { setByHand } = messages
    switch (edit.kind) {
      case 'select':
        setSelectedStop(edit.stop)
        return
      case 'start':
        if (!competitionCentre) return
        if (isCentreOutsideFrame) {
          setEditMessage(messages.print.centreOutside)
          return
        }
        void editByHand(
          () =>
            engine.startCourseByHand(
              request,
              competitionCentre,
              winnerPace,
              paper,
              printScale,
              printFrame,
              edit.at,
            ),
          setByHand.noRulesForClass,
        )
        return
      case 'add':
        void editByHand(current => engine.addControl(current!, edit.at), setByHand.addRefused).then(
          edited => edited && previewPlacedControl(edited, edited.controls.length, false),
        )
        return
      case 'insert':
        void editByHand(
          current => engine.insertControlAt(current!, edit.afterStop, edit.at),
          setByHand.addRefused,
        ).then(edited => edited && previewPlacedControl(edited, edit.afterStop + 1, true))
    }
  }

  // Follows the pointer with the fastest routes of the legs a control there would make, and adds
  // the alternatives once the pointer rests.
  function previewAt(hover: { readonly hit: CourseHit | null; readonly at: LocalPoint } | null) {
    window.clearTimeout(previewRest.current)
    const request = ++latestPreview.current
    const neighbours =
      hover && !isEditing
        ? neighboursOf(course, handEditFor(course, selectedStop, hover.hit, hover.at))
        : null
    if (!hover || !neighbours) {
      routeQueue.cancel('preview')
      setPreview(null)
      return
    }
    void routeQueue
      .request('preview', 'preview', () => engine.previewControl(hover.at, neighbours, winnerPace))
      .then(found => {
        if (found === SUPERSEDED || request !== latestPreview.current) return
        if (!found) {
          setPreview(null)
          return
        }
        setPreview(current =>
          current &&
          isSamePreview(current, found) &&
          current.legs.every(leg => leg.hasLookedForAlternatives)
            ? current
            : found,
        )
        previewRest.current = window.setTimeout(
          () => void showAlternatives(found.position, neighbours, request),
          PREVIEW_REST_MS,
        )
      })
  }

  async function showAlternatives(
    position: LocalPoint,
    neighbours: readonly LocalPoint[],
    request: number,
  ) {
    const states = await Promise.all(
      legEndsAround(position, neighbours).map((ends, i) =>
        routeCache.find(engine, routeQueue, 'preview', `preview leg ${i}`, ends, winnerPace),
      ),
    )
    if (request !== latestPreview.current) return
    const legs = states.flatMap(state =>
      state?.status === 'evaluated'
        ? [
            {
              fastest: state.leg.fastest,
              alternatives: state.leg.alternatives,
              hasLookedForAlternatives: true,
            },
          ]
        : [],
    )
    if (legs.length === states.length) setPreview({ position, legs })
  }

  // Shows the routes into a control just placed. On touch there is no pointer to follow, so this
  // is the only preview; with a mouse it lasts until the pointer moves.
  function previewPlacedControl(edited: Course, stop: number, hasLegAfter: boolean) {
    window.clearTimeout(previewRest.current)
    const request = ++latestPreview.current
    const stops = [edited.start.position, ...edited.controls.map(c => c.position), edited.finish]
    const position = stops[stop]
    const before = stops[stop - 1]
    const after = stops[stop + 1]
    if (!position || !before || !after) return
    void showAlternatives(position, hasLegAfter ? [before, after] : [before], request)
  }

  function deleteSelectedControl(stop: number) {
    setSelectedStop(null)
    void editByHand(
      current => engine.removeControl(current!, stop),
      messages.setByHand.deleteRefused,
    )
  }

  async function moveStop(stopIndex: number, to: LocalPoint) {
    const before = course
    const isFinish = before !== null && stopIndex === before.controls.length + 1
    const moved = await editByHand(
      current =>
        isFinish ? engine.moveFinish(current!, to) : engine.moveControl(current!, stopIndex, to),
      isFinish ? messages.setByHand.finishRefused : messages.course.moveRefused,
    )
    if (moved && before) setKept(current => withMovedStop(current, before, moved, stopIndex))
  }

  const keyActions = useRef({ deleteSelectedControl, undo })
  keyActions.current = { deleteSelectedControl, undo }
  const deletableStop = isSettingByHand && isControlStop(course, selectedStop) ? selectedStop : null
  useEffect(() => {
    if (!isSettingByHand) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && deletableStop !== null) {
        event.preventDefault()
        keyActions.current.deleteSelectedControl(deletableStop)
      } else if (event.key === 'z' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault()
        keyActions.current.undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSettingByHand, deletableStop])

  async function correctSymbol(symbolNumber: number, isomCode: IsomCode | null | undefined) {
    const next = new Map(corrections)
    if (isomCode === undefined) next.delete(symbolNumber)
    else next.set(symbolNumber, isomCode)
    setCorrections(next)
    if (mapKey) saveCorrections(mapKey, next)
    setEngineState('loading')
    setCourse(null)
    stopSettingByHand()
    setUndoHistory([])
    setCostMap(null)
    setSites(null)
    try {
      await engine.applySymbolCorrections(next)
      setEngineState('ready')
    } catch {
      setEngineState('error')
    }
  }

  function startPlanningLeg() {
    stopSettingByHand()
    setSheetSize(atLeastHalf)
    setSelectedLeg(null)
    setPlanRoutes({ status: 'finding' })
    setPlannedLeg(EMPTY_PLANNED_LEG)
  }

  // A course already set stays as it is; the paper and description box are fitted again.
  function changePrint(
    nextPaper: PaperChoice,
    nextScale: PrintScaleChoice,
    nextFrame = nextPaper === 'auto' ? null : placedFrame,
  ) {
    setPaper(nextPaper)
    setPrintScale(nextScale)
    setPlacedFrame(nextFrame)
    if (!nextFrame) setIsPlacingFrame(false)
    if (!course) return
    const frame = frameFor(nextFrame, nextPaper, nextScale, request)
    void editCourse(
      current =>
        frame
          ? engine.refitToFrame(current, frame)
          : engine.refitToPaper(current, nextPaper, nextScale),
      messages.print.refitFailed,
    )
  }

  function startPlacingFrame() {
    if (state.status !== 'ready') return
    const area = course?.printArea
    const startFrame = placedFrame ?? {
      centre: area
        ? centreOfExtent(area.extent)
        : (competitionCentre ?? centreOfExtent(state.map.info.extent)),
      orientation: area?.orientation ?? 'portrait',
    }
    setIsPlacingFrame(true)
    setPlannedLeg(null)
    changePrint(area?.paper ?? (paper === 'auto' ? 'A4' : paper), printScale, startFrame)
  }

  // The list of all legs stays beside an open leg, so the leg can be compared with the rest.
  const courseRoutesList = course && !isSettingByHand && !isGenerating && (
    <CourseRoutesPanel
      course={course}
      legs={legRoutesOfCourse}
      selectedLeg={selectedLeg}
      onFindAll={findRoutesOnAllLegs}
      onSelectLeg={selectLeg}
    />
  )

  function findRoutesOnAllLegs() {
    setIsRouteListWanted(true)
    setShowCourseRoutes(true)
  }

  function selectLeg(leg: number | null) {
    if (leg !== null) setSheetSize(atLeastHalf)
    setPlannedLeg(null)
    setSelectedLeg(leg)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setIsDraggingOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.name.toLowerCase().endsWith('.xml')) void openCourseFile(file)
    else void openFile(file)
  }

  async function openCourseFile(file: File) {
    if (state.status !== 'ready' || engineState !== 'ready') {
      setEditMessage(messages.check.openMapFirst)
      return
    }
    setEditMessage(null)
    try {
      const courses = await engine.importCourses(await file.text())
      if (courses.length === 0) {
        setEditMessage(messages.check.noCourses)
        return
      }
      setPlannedLeg(null)
      setIsPickingCentre(false)
      stopSettingByHand()
      setUndoHistory([])
      setCourseFile({
        fileName: file.name,
        courses,
        selected: 0,
        status: 'checking',
        checked: null,
        deduced: null,
      })
      track('course-file-checked')
      await checkCourse(courses, 0, request, 'deduce')
    } catch (e) {
      setEditMessage(messages.check.readFailed(errorMessage(e)))
    }
  }

  async function checkCourse(
    courses: readonly ImportedCourseSummary[],
    index: number,
    baseRequest: CourseRequest,
    classChoice: 'deduce' | 'asGiven',
  ) {
    const fromName = courses[index]?.guessedClass ?? null
    let nextRequest =
      classChoice === 'deduce'
        ? withOfferedClass({ ...baseRequest, ...fromName }).request
        : baseRequest
    const check = ++latestCheck.current
    setSuggestion(null)
    setSelectedLeg(null)
    setCourseFile(file => file && { ...file, selected: index, status: 'checking' })
    const checkAs = (asRequest: CourseRequest) =>
      engine.checkImportedCourse(index, asRequest, winnerPace, paper, printScale)
    let checked = await checkAs(nextRequest)
    // The winning time and control difficulties are measured the same whatever the class, so one
    // check tells which level, distance and class the course fits; it is then checked as that.
    const deduced =
      checked && classChoice === 'deduce'
        ? deduceClass(checked.course, fromName, nextRequest.sex)
        : null
    if (deduced && !isSameRequest(deduced.best.request, nextRequest)) {
      nextRequest = deduced.best.request
      checked = await checkAs(nextRequest)
    }
    if (check !== latestCheck.current) return
    setRequest(nextRequest)
    setCourseFile(
      file =>
        file && {
          ...file,
          selected: index,
          status: checked ? 'checked' : 'notOnMap',
          checked,
          deduced,
        },
    )
    setCourse(checked?.course ?? null)
    if (checked) {
      setCompetitionCentre(checked.course.finish)
      setDrawCourseKey(key => key + 1)
    }
  }

  function closeCourseFile() {
    latestCheck.current++
    setCourseFile(null)
    setSuggestion(null)
    setSelectedLeg(null)
    setCourse(null)
    setCompetitionCentre(null)
    stopSettingByHand()
    setUndoHistory([])
  }

  async function suggestFix(controlNumber: number) {
    if (!course) return
    const suggested = await engine.fixControl(course, controlNumber)
    setSuggestion({ controlNumber, course: suggested })
  }

  const fileCheck: CourseFileCheck | null = courseFile && {
    fileName: courseFile.fileName,
    courseNames: courseFile.courses.map(c => c.name),
    selected: courseFile.selected,
    classFromName: courseFile.courses[courseFile.selected]?.guessedClass != null,
    deduced: courseFile.deduced,
    status: courseFile.status,
    fileLengthMeters:
      courseFile.checked?.fileLengthMeters ??
      courseFile.courses[courseFile.selected]?.lengthMeters ??
      null,
    fileControlCount: courseFile.courses[courseFile.selected]?.controlCount ?? 0,
    groundMismatchMetres: courseFile.checked?.groundMismatchMetres ?? null,
  }
  const suggestedControl = suggestion?.course?.controls[suggestion.controlNumber - 1]
  const currentControl = suggestion && course?.controls[suggestion.controlNumber - 1]
  const suggestedMove =
    suggestedControl && currentControl
      ? { from: currentControl.position, to: suggestedControl.position }
      : null

  const chooseMapFile = () => fileInput.current?.click()

  const georef = state.status === 'ready' ? state.map.info.georef : null
  const mapInfo = state.status === 'ready' ? state.map.info : null
  const isChoosingCentre =
    plannedLeg === null &&
    !isSettingByHand &&
    (isPickingCentre || (state.status === 'ready' && competitionCentre === null))

  const printFrame = useMemo(
    () => frameFor(placedFrame, paper, printScale, request),
    [placedFrame, paper, printScale, request],
  )
  const isCentreOutsideFrame =
    printFrame !== null &&
    competitionCentre !== null &&
    !hasRoomForCentre(printFrame, competitionCentre)

  const descriptionBox = useMemo(
    () => (course && mapInfo ? descriptionBoxFor(course, request, mapInfo, messages.labels) : null),
    [course, request, mapInfo, messages.labels],
  )

  return (
    <div
      className="workspace"
      onDragOver={e => {
        e.preventDefault()
        if (!isDraggingOver) setIsDraggingOver(true)
      }}
      onDragLeave={e => {
        if (e.relatedTarget === null) setIsDraggingOver(false)
      }}
      onDrop={onDrop}
    >
      <input
        ref={courseFileInput}
        type="file"
        accept=".xml"
        hidden
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void openCourseFile(file)
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept={isExperimental ? '.ocd,.pdf' : '.ocd'}
        hidden
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void openFile(file)
        }}
      />
      <main>
        {state.status === 'ready' ? (
          <MapView
            info={state.map.info}
            image={state.image}
            routes={
              selectedLeg !== null
                ? legRoutes.status === 'evaluated'
                  ? legRoutes.leg
                  : null
                : plannedLeg && plannedEnds(plannedLeg) && planRoutes.status === 'evaluated'
                  ? planRoutes.leg
                  : null
            }
            courseRoutes={courseRoutesOnMap}
            preview={isSettingByHand ? preview : null}
            onPointerOver={hover => isSettingByHand && previewAt(hover)}
            selectedLeg={selectedLeg}
            onLegSelected={selectLeg}
            keptMarks={keptMarks}
            costMap={showCostMap ? costMap : null}
            sites={showSites ? sites : null}
            course={course}
            overprintLayout={overprintLayout}
            printFrame={printFrame?.extent ?? course?.printArea?.extent ?? null}
            isPlacingFrame={isPlacingFrame && !isGenerating && !isEditing}
            onFrameMoved={centre =>
              placedFrame && changePrint(paper, printScale, { ...placedFrame, centre })
            }
            descriptionBox={descriptionBox}
            competitionCentre={competitionCentre}
            isPickingCentre={isChoosingCentre}
            plannedLeg={plannedLeg}
            onPlannedLegChanged={setPlannedLeg}
            onCentrePicked={centre => {
              setCompetitionCentre(centre)
              setIsPickingCentre(false)
            }}
            canEditCourse={course !== null && !isGenerating && !isEditing}
            isSettingByHand={isSettingByHand}
            selectedStop={isSettingByHand ? selectedStop : null}
            onCourseTapped={tapCourse}
            tools={
              <>
                <LayersMenu
                  showCostMap={showCostMap}
                  onShowCostMap={setShowCostMap}
                  showSites={showSites}
                  onShowSites={setShowSites}
                  siteCount={sites?.length ?? null}
                  showCourseRoutes={showCourseRoutes}
                  onShowCourseRoutes={setShowCourseRoutes}
                />
                <PlanLegTool
                  isActive={plannedLeg !== null}
                  isDisabled={engineState !== 'ready'}
                  onToggle={() => (plannedLeg ? setPlannedLeg(null) : startPlanningLeg())}
                />
                <EditControlsTool
                  isActive={isSettingByHand}
                  isDisabled={
                    engineState !== 'ready' ||
                    isGenerating ||
                    (course === null && competitionCentre === null)
                  }
                  onToggle={() => (isSettingByHand ? stopSettingByHand() : startSettingByHand())}
                />
              </>
            }
            suggestedMove={suggestedMove}
            drawCourseKey={drawCourseKey}
            footer={
              isPlacingFrame && placedFrame ? (
                <PrintFrameBar
                  isBusy={isGenerating || isEditing}
                  canSetAgain={
                    course !== null &&
                    course.problems.stopsOutsidePrintArea > 0 &&
                    !isCentreOutsideFrame
                  }
                  onTurn={() =>
                    changePrint(paper, printScale, {
                      ...placedFrame,
                      orientation:
                        placedFrame.orientation === 'portrait' ? 'landscape' : 'portrait',
                    })
                  }
                  onAutomatic={() => changePrint('auto', printScale)}
                  onSetAgain={() => void generateCourse(request, seed, paceSecondsPerKm)}
                  onDone={() => setIsPlacingFrame(false)}
                />
              ) : (
                <PrintLabel
                  course={course}
                  frame={printFrame}
                  onChooseArea={startPlacingFrame}
                  format={request.format}
                  paper={paper}
                  printScale={printScale}
                  isDisabled={isGenerating || isEditing}
                  onPaperChange={next => changePrint(next, printScale)}
                  onPrintScaleChange={next => changePrint(paper, next)}
                />
              )
            }
            onStopMoved={(stop, to) => void moveStop(stop, to)}
          />
        ) : (
          <MapStart opening={state} isDraggingOver={isDraggingOver} onChooseFile={chooseMapFile} />
        )}
      </main>

      <aside ref={sheet} style={sheetStyle(sheetSize)}>
        <SheetHandle size={sheetSize} onSizeChange={setSheetSize} sheet={sheet} />
        <PanelHeader onOpenSettings={() => setIsSettingsOpen(true)} />
        {course && selectedLeg !== null && (
          <LegRoutesPanel
            course={course}
            leg={selectedLeg}
            routes={legRoutes}
            onSelectLeg={selectLeg}
            keeping={{
              leg: isLegKept(kept, course, selectedLeg),
              from: isStopKept(kept, course, selectedLeg),
              to: isStopKept(kept, course, selectedLeg + 1),
            }}
            onToggleLegKept={() => setKept(current => toggleLeg(current, course, selectedLeg))}
            onToggleStopKept={stop => setKept(current => toggleStop(current, course, stop))}
          />
        )}
        {selectedLeg !== null && courseRoutesList}
        {isSettingByHand && (
          <SetByHandPanel
            course={course}
            selectedStop={selectedStop}
            preview={preview}
            canUndo={undoHistory.length > 0}
            isEditing={isEditing}
            onDelete={deleteSelectedControl}
            onUndo={undo}
            onDone={stopSettingByHand}
          />
        )}
        {plannedLeg && (
          <PlanLegPanel
            plan={plannedLeg}
            routes={planRoutes}
            onDone={() => setPlannedLeg(null)}
            onSetCourseAround={
              competitionCentre && paceSecondsPerKm !== null && !isGenerating
                ? () => {
                    const ends = plannedEnds(plannedLeg)
                    if (ends)
                      void generateCourse(
                        request,
                        seed,
                        paceSecondsPerKm,
                        competitionCentre,
                        startWish,
                        ends,
                      )
                  }
                : null
            }
          />
        )}
        <PanelLine
          label={messages.workspace.mapLine}
          value={
            state.status === 'ready'
              ? messages.workspace.mapValue(state.fileName, format.scale(state.map.info.scale))
              : state.status === 'loading'
                ? messages.workspace.openingLine(state.fileName)
                : messages.workspace.noMap
          }
          action={
            state.status === 'ready'
              ? { label: messages.workspace.changeMap, onClick: chooseMapFile }
              : undefined
          }
        />
        {state.status === 'ready' && engineState === 'ready' && contourInterval && (
          <ContourIntervalLine
            key={`${mapKey}-${contourInterval.meters}`}
            interval={contourInterval}
            onChange={meters => void changeContourInterval(meters)}
          />
        )}
        {isSampleMap && <p className="note">{messages.workspace.sampleCredit}</p>}
        {engineState === 'loading' && <p className="note">{messages.map.building}</p>}
        {engineState === 'error' && <p className="error">{messages.map.engineError}</p>}
        {state.status !== 'ready' && (
          <>
            <PanelLine
              label={messages.workspace.centreLine}
              value={messages.workspace.afterMap}
              isPending
            />
            <PanelLine
              label={messages.workspace.courseLine}
              value={messages.workspace.afterCentre}
              isPending
            />
          </>
        )}

        {state.status === 'ready' && (
          <CoursePanel
            request={request}
            onRequestChange={next => {
              if (courseFile) {
                void checkCourse(courseFile.courses, courseFile.selected, next, 'asGiven')
                return
              }
              setRequest(next)
              if (isSettingByHand && course)
                void editCourse(
                  current => engine.recheckAs(current, next, winnerPace, printScale),
                  messages.setByHand.noRulesForClass,
                )
            }}
            isAssistantOn={assistantKey.apiKey !== ''}
            hasCentre={competitionCentre !== null}
            isPickingCentre={isChoosingCentre}
            onMoveCentre={() => {
              stopSettingByHand()
              setIsPickingCentre(true)
            }}
            canSetCourse={
              engineState === 'ready' &&
              competitionCentre !== null &&
              !isCentreOutsideFrame &&
              paceSecondsPerKm !== null &&
              !isGenerating
            }
            search={search}
            onSetCourse={() => void generateCourse(request, seed, paceSecondsPerKm)}
            onSetByHand={startSettingByHand}
            onStop={() => void engine.stopSearch()}
            onTryAnother={() => void generateCourse(request, seed + 1, paceSecondsPerKm)}
            kept={course && keptCount(kept, course)}
            onForgetKept={() => setKept(NOTHING_KEPT)}
            course={course}
            isEditing={isEditing || isGenerating}
            isPreparingPdf={isPreparingPdf}
            check={fileCheck}
            onOpenCourseFile={() => courseFileInput.current?.click()}
            onSelectCheckedCourse={index =>
              courseFile && void checkCourse(courseFile.courses, index, request, 'deduce')
            }
            onDeduceClass={() =>
              courseFile &&
              void checkCourse(courseFile.courses, courseFile.selected, request, 'deduce')
            }
            onCloseCheck={closeCourseFile}
            suggestion={
              suggestion && {
                controlNumber: suggestion.controlNumber,
                isFound: suggestion.course !== null,
              }
            }
            onAcceptSuggestion={() => {
              if (suggestion?.course) setCourse(suggestion.course)
              setSuggestion(null)
            }}
            onDismissSuggestion={() => setSuggestion(null)}
            onFixControl={controlNumber =>
              courseFile
                ? void suggestFix(controlNumber)
                : void editCourse(
                    current => engine.fixControl(current, controlNumber),
                    messages.course.fixRefused,
                  )
            }
            onDownloadPdf={() => {
              if (!course || !descriptionBox || state.status !== 'ready') return
              setIsPreparingPdf(true)
              track('pdf-downloaded')
              setPrintError(null)
              const { map } = state
              engine
                .peripheralInformation()
                .then(peripheral => {
                  const contours = peripheral.contourIntervalMetres
                  const scaleLine = messages.print.scaleLine(
                    format.scale(course.printArea?.scale ?? map.info.scale),
                    contours === null ? null : format.contourInterval(contours),
                  )
                  return savePrintPdf(
                    map,
                    course,
                    overprintLayout,
                    descriptionBox.sheet,
                    `${courseNameOf(request, messages.labels.trainingCourse)}-${request.format}.pdf`,
                    peripheral,
                    scaleLine,
                  )
                })
                .catch(e => setPrintError(errorMessage(e)))
                .finally(() => setIsPreparingPdf(false))
            }}
            onDownloadXml={() => {
              if (course && descriptionBox && mapInfo) {
                downloadCourseXml(course, descriptionBox.sheet, request, mapInfo, messages.labels)
                track('xml-downloaded')
              }
            }}
          />
        )}

        {assistantKey.apiKey && <ChatPanel apiKey={assistantKey.apiKey} tools={chatTools} />}

        {selectedLeg === null && courseRoutesList && (
          <>
            <p className="note">{messages.leg.selectHint}</p>
            {courseRoutesList}
          </>
        )}

        {isCentreOutsideFrame && <p className="error">{messages.print.centreOutside}</p>}
        {editMessage && <p className="error">{editMessage}</p>}
        {printError && <p className="error">{messages.course.pdfFailed(printError)}</p>}

        {paceSecondsPerKm === null && (
          <p className="error">
            {messages.settings.paceInvalid}{' '}
            <button type="button" className="link" onClick={() => setIsSettingsOpen(true)}>
              {messages.workspace.settings}
            </button>
          </p>
        )}

        <footer className="panel-footer">
          <a href={SUBPAGE_PATHS.guides} target="_blank" rel="noreferrer">
            {messages.workspace.guides}
          </a>
          <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
            {messages.workspace.sourceCode}
          </a>
          <a href={RELEASE_URL} target="_blank" rel="noreferrer">
            {messages.workspace.version(APP_VERSION)}
          </a>
          <span>{messages.workspace.licence}</span>
          <span>
            {messages.workspace.ocadReading}{' '}
            <a href={OCAD2GEOJSON_URL} target="_blank" rel="noreferrer">
              ocad2geojson
            </a>
          </span>
        </footer>
      </aside>

      <SettingsSheet
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        assistantKey={assistantKey}
        paceText={paceText}
        onPaceTextChange={setPaceText}
        isPaceValid={paceSecondsPerKm !== null}
        map={
          state.status === 'ready' && (
            <section className="settings-section" aria-labelledby="settings-map">
              <h3 id="settings-map">{messages.settings.map}</h3>
              <dl className="settings-facts">
                <div>
                  <dt>{messages.settings.fileName}</dt>
                  <dd>{state.fileName}</dd>
                </div>
                <div>
                  <dt>{messages.settings.scale}</dt>
                  <dd>{format.scale(state.map.info.scale)}</dd>
                </div>
                <div>
                  <dt>{messages.settings.objects}</dt>
                  <dd>{state.map.objectCount}</dd>
                </div>
                <div>
                  <dt>{messages.settings.coordinateSystem}</dt>
                  <dd>{georef ? `EPSG:${georef.epsg}` : messages.settings.noCoordinateSystem}</dd>
                </div>
                <div>
                  <dt>{messages.settings.image}</dt>
                  <dd>
                    {messages.settings.imageValue(
                      state.image.width,
                      state.image.height,
                      Math.round(state.ms),
                    )}
                  </dd>
                </div>
                {state.map.backgroundMapPaths.length > 0 && (
                  <div>
                    <dt>{messages.settings.backgroundMaps}</dt>
                    <dd>{state.map.backgroundMapPaths.join(', ')}</dd>
                  </div>
                )}
              </dl>
              {state.pdf ? (
                <div className="settings-row">
                  <div>
                    <label htmlFor="settings-print-scale">{messages.settings.printScale}</label>
                    <p className="settings-soft">
                      {state.pdf.page.geoReference
                        ? messages.settings.printScaleFromGeoreference
                        : messages.settings.printScaleHint}
                    </p>
                  </div>
                  <select
                    id="settings-print-scale"
                    value={state.pdf.printScale}
                    onChange={e => void changePdfPrintScale(Number(e.target.value))}
                  >
                    {[...new Set([...PDF_PRINT_SCALES, state.pdf.page.suggestedPrintScale])]
                      .sort((a, b) => a - b)
                      .map(scale => (
                        <option key={scale} value={scale}>
                          {format.scale(scale)}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <SymbolPanel
                  symbols={state.map.symbols()}
                  corrections={corrections}
                  isApplying={engineState === 'loading'}
                  onCorrect={(symbolNumber, isomCode) => void correctSymbol(symbolNumber, isomCode)}
                />
              )}
            </section>
          )
        }
      />
    </div>
  )
}

// The names the assistant gives the user for the panel steps and buttons, as shown in the app.
const uiNamesOf = (m: Messages): Record<UiNameKey, string> => ({
  mapStep: m.workspace.mapLine,
  centreStep: m.workspace.centreLine,
  courseStep: m.workspace.courseLine,
  setCourse: m.course.setCourse,
  stop: m.course.stop,
  tryAnother: m.course.tryAnother,
  fix: m.course.fix,
  downloadPdf: m.course.downloadPdf,
  downloadXml: m.course.downloadXml,
  setByHand: m.setByHand.entry,
  undo: m.setByHand.undo,
  keepLeg: m.keep.leg,
  planLeg: m.map.planLeg,
  setCourseAround: m.planLeg.setCourseAround,
  settings: m.workspace.settings,
})
