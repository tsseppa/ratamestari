import type { CompassDirection, Course, Finding } from '@ratamestari/engine'
import type { SearchPhase } from '../search-progress'

export type StopName = number | 'start' | 'finish'

// Rule values a finding's text may quote, from the rules config.
export interface FindingLimits {
  readonly sharpAngleDegrees: number
  readonly angleNoteDegrees: number
  readonly featureMatchMetres: number
}

// The stops a rule finding names (control numbers, 0 = start) and the finish's stop number.
export type FindingText = (
  stops: readonly number[],
  finishStop: number,
  limits: FindingLimits,
) => string

const stopWord = (stop: StopName) => (typeof stop === 'number' ? String(stop) : stop)

const stopNamed = (stop: number, finishStop: number) =>
  stop === 0 ? 'the start' : stop === finishStop ? 'the finish' : `control ${stop}`
const lineNamed = (from: number, to: number, finishStop: number) =>
  `the line ${stopNamed(from, finishStop)}–${stopNamed(to, finishStop)}`

const findingTexts: Record<Finding['kind'], FindingText> = {
  spacing: ([a = 0, b = 0], f) =>
    `${stopNamed(a, f)} and ${stopNamed(b, f)} are too close together`,
  acuteAngleWarnings: ([a = 0], f, { sharpAngleDegrees }) =>
    `sharp angle under ${sharpAngleDegrees}° at ${stopNamed(a, f)}`,
  acuteAngleNotes: ([a = 0], f, { angleNoteDegrees }) =>
    `angle under ${angleNoteDegrees}° at ${stopNamed(a, f)}`,
  difficultyOutsideRange: ([a = 0], f) =>
    `${stopNamed(a, f)} does not match the class's technical difficulty`,
  courseLineCrossings: ([a = 0, b = 0, c = 0, d = 0], f) =>
    `${lineNamed(a, b, f)} crosses ${lineNamed(c, d, f)}`,
  courseLinesThroughControls: ([a = 0, b = 0, c = 0], f) =>
    `${lineNamed(a, b, f)} passes through the circle of ${stopNamed(c, f)}`,
  courseLinesOutsideMap: ([a = 0, b = 0], f) => `${lineNamed(a, b, f)} leaves the mapped area`,
  courseLinesOverDescriptions: ([a = 0, b = 0], f) =>
    `${lineNamed(a, b, f)} runs under the description box`,
  stopsOutsidePrintArea: ([a = 0], f) => `${stopNamed(a, f)} is outside the print area`,
  overlappingCircles: ([a = 0, b = 0], f) =>
    `the circles of ${stopNamed(a, f)} and ${stopNamed(b, f)} overlap`,
  winningTimeOutsideRange: () =>
    "the course cannot reach the class's winning-time range; the terrain within reach of the competition centre, or inside the chosen print area, may be too small for this class",
  controlsWithoutFeature: ([a = 0], f, { featureMatchMetres }) =>
    `no map feature found within ${featureMatchMetres} m of ${stopNamed(a, f)}; check the position`,
  finalLegTooLong: () => 'the last leg into the finish is long',
}

export const en = {
  leg: {
    title: (from: StopName, to: StopName) =>
      from === 'start' ? `Start to ${stopWord(to)}` : `Leg ${from} to ${stopWord(to)}`,
    straightLine: (distance: string) => `${distance} in a straight line`,
    previous: 'Previous leg',
    next: 'Next leg',
    wholeCourse: 'Whole course',
    route: 'Route',
    length: 'Length',
    time: 'Time',
    routeLetters: ['A', 'B', 'C'],
    slowerBy: (difference: string) => `+${difference}`,
    fastestClimb: (climb: string) => `The fastest route climbs about ${climb}.`,
    routeChoice: (letter: string, difference: string) =>
      `A real route choice: ${letter} goes a different way and is only ${difference} slower.`,
    noRouteChoice: (share: string) => `No clearly different route within ${share} of the fastest.`,
    findingRoutes: 'Finding routes…',
    unreachable: 'No route: a control is in an impassable or forbidden area.',
    fromSymbols: "Routes are worked out from the map's symbols, not from GPS tracks.",
    selectHint: 'Tap a leg or a control on the map to see its routes.',
  },
  workspace: {
    settings: 'Settings',
    showMore: 'Show more of the panel',
    showLess: 'Show less of the panel',
    openMap: 'Open an OCAD map',
    openMapHint: 'Drop a .ocd file anywhere in this window, or choose one.',
    pdfWithoutMap: 'No map was found in this PDF.',
    pdfIsPicture:
      'This PDF holds the map as a picture, such as a scan, not as a drawing. Only drawn maps, as exported from OCAD or Condes, can be read for now.',
    printedCourse: 'Course printed on the map',
    openMapHintWithPdf:
      'Drop a .ocd file or a PDF of the map anywhere in this window, or choose one.',
    dropToOpen: 'Drop the map to open it',
    chooseFile: 'Choose map file',
    opening: (fileName: string) => `Opening ${fileName}…`,
    openingHint: 'Reading the map and drawing it. Large maps take a few seconds.',
    openFailed: (reason: string) => `This file could not be opened: ${reason}`,
    privacy: 'The map is read in this browser and never uploaded.',
    sampleCredit:
      'Sample map: Leirikangas, Hamina. © Vehkalahden Veikot, for trying Ratamestari only.',
    sampleFailed: (reason: string) => `The sample map could not be loaded: ${reason}`,
    mapLine: 'Map',
    contourIntervalLine: 'Contour interval',
    changeContourInterval: 'Change',
    infoGlyph: '?',
    contourIntervalInfo: 'Where the contour interval comes from',
    contourIntervalFromMap: 'Read from the map. Climb and routes are measured with it.',
    contourIntervalStandard: (interval: string) =>
      `The map does not say, so the standard ${interval} is used. Change it if the map is drawn otherwise.`,
    contourIntervalSetByYou: 'Set by you for this map. Climb and routes are measured with it.',
    contourIntervalReset: 'Reset',
    noMap: 'No map open yet',
    openingLine: (fileName: string) => `Opening ${fileName}…`,
    mapValue: (fileName: string, scale: string) => `${fileName}, ${scale}`,
    changeMap: 'Change',
    centreLine: 'Competition centre',
    afterMap: 'Comes after the map',
    courseLine: 'Course',
    afterCentre: 'Comes after the centre',
    guides: 'How-to guides',
    sourceCode: 'Source code',
    version: (version: string) => `Version ${version}`,
    licence: 'AGPL-3.0-or-later',
    ocadReading: 'OCAD reading by',
  },
  settings: {
    title: 'Settings',
    close: 'Close settings',
    assistant: 'Assistant',
    assistantIntro:
      'Optional. Ask for courses and changes in your own words. Everything else works without it.',
    assistantOn: 'The assistant is on. You can write to it in the side panel.',
    apiKey: 'Your Claude API key',
    keyStorage: 'Kept only in this browser and sent only to Anthropic.',
    getKey: 'Get a key',
    turnOn: 'Turn on the assistant',
    turnOff: 'Turn off and forget the key',
    receives: 'It receives',
    receivesText: 'Your messages, course figures, rule results and control descriptions in words.',
    neverReceives: 'It never receives',
    neverReceivesText: 'The map file, coordinates or any geometry.',
    course: 'Course',
    pace: "Winner's pace",
    paceHint: 'Turns course length into winning time.',
    paceUnit: 'min/km',
    paceInvalid: 'Write the pace as minutes and seconds, like 5:00.',
    map: 'Map',
    fileName: 'File',
    scale: 'Scale',
    objects: 'Objects',
    coordinateSystem: 'Coordinate system',
    noCoordinateSystem: 'none',
    image: 'Image',
    imageValue: (width: number, height: number, milliseconds: number) =>
      `${width} × ${height} px, drawn in ${milliseconds} ms`,
    backgroundMaps: 'Background maps',
    licence: 'Ratamestari is AGPL-3.0-or-later.',
    sourceCode: 'Source code',
    version: (version: string) => `Version ${version}`,
    experimental: 'Experimental features',
    experimentalIntro:
      'Features that are still being tuned. Their results can be wrong, so check them before you rely on them.',
    experimentalPdf: 'Open a map from a PDF, and read the course printed on it.',
    experimentalOn: 'Experimental features are on.',
    experimentalOff: 'Experimental features are off.',
    turnOffExperimental: 'Turn off experimental features',
    printScale: 'Print scale of the PDF',
    printScaleHint: 'Guessed from the size of the symbols. Change it if the PDF says otherwise.',
    printScaleFromGeoreference:
      'Read from the coordinates in the PDF. At another scale the map has no coordinates.',
  },
  course: {
    centreLine: 'Competition centre',
    centreChosen: 'Chosen on the map',
    change: 'Change',
    centreQuestion: 'Where is the competition centre?',
    centreHint: 'Click it on the map. The course starts and finishes near it.',
    courseLine: 'Course',
    eventLevel: 'Event level',
    eventLevels: { national: 'National level', finnishChampionship: 'SM level' },
    purposeLine: 'Course type',
    purposes: { competition: 'Race', training: 'Training' },
    trainingKind: 'Kind of training',
    trainingKinds: { contour: 'Contour training' },
    contourTrainingNote:
      'Contour training sends the course to the hillsides with the most contour detail. The winning time is yours to set; the other values are Ratamestari’s defaults, not IOF or SSL rules.',
    trainingMinutes: 'Training winning time in minutes',
    beforeTrainingMinutes: ', ',
    distance: 'Distance',
    formats: { long: 'long distance', middle: 'middle distance' },
    forClass: 'for',
    beforeSkillLevel: ', ',
    className: 'Class',
    sexes: { H: 'Men and boys (H)', D: 'Women and girls (D)' },
    skillLevel: 'Skill level',
    skillLevelOption: (letter: string) => `skill level ${letter}`,
    skillLevels: {
      E: 'Skill level E is set like the A class.',
      A: "Skill level A is the main class: the class's own winning time and difficulty.",
      B: 'Skill level B is easier: two colour levels easier and 75% of the A winning time.',
      C: 'Skill level C is for beginners: yellow difficulty and 75% of the A winning time.',
    },
    length: 'Length',
    climb: 'Climb',
    winningTime: 'Winning time',
    minutes: (minutes: number) => `${minutes} min`,
    target: (time: string) => `target ${time}`,
    controls: 'Controls',
    measuring: 'measuring…',
    noFindings: 'No rule problems found',
    findingCount: (count: number) =>
      count === 1 ? '1 thing to check' : `${count} things to check`,
    severities: { error: 'Error', warning: 'Warning', note: 'Note' },
    fix: 'Fix',
    fixControl: (control: number) => `Fix control ${control}`,
    dragHint:
      'Drag a control, the start or the finish on the map to move it. The rules are checked again.',
    dragHintTouch: 'Tap a leg, then drag one of its controls. The rules are checked again.',
    setCourse: 'Set course',
    setting: 'Setting the course…',
    stop: 'Stop',
    stopHint: 'Stop keeps the best course found so far.',
    searchPhases: {
      areas: 'Finding technical areas…',
      skeleton: 'Planning the course…',
      sections: 'Setting sections…',
      improving: 'Improving…',
      checking: 'Checking rules…',
    } satisfies Record<SearchPhase, string>,
    downloadPdf: 'Download PDF',
    preparingPdf: 'Preparing the PDF…',
    downloadXml: 'IOF XML',
    tryAnother: 'Try another course',
    exportNote:
      'The PDF is the print page with the course and descriptions. IOF XML 3.0 opens in OCAD, Condes and Purple Pen.',
    classReplaced: (level: string, distance: string, from: string, to: string) =>
      `${level} ${distance} has no ${from} class in the rules, so the class is now ${to}.`,
    noCourse:
      'No course could be set from here. Try another competition centre, or another class or distance.',
    generationFailed: (reason: string) => `The course could not be set: ${reason}`,
    moveRefused: 'No control site within 60 m of that spot, so the control stayed where it was.',
    fixRefused: 'The control could not be fixed.',
    pdfFailed: (reason: string) => `The PDF could not be made: ${reason}`,
  },
  check: {
    entry: 'Or check a course you set in OCAD or Purple Pen:',
    openFile: 'open its IOF XML file',
    fileLine: 'Course file',
    close: 'Close',
    coursesLabel: 'Courses in the file',
    checking: 'Checking the course…',
    notOnMap: 'The controls in this file are not on this map.',
    noCourses: 'The file has no courses.',
    readFailed: (reason: string) => `The course file could not be read: ${reason}`,
    openMapFirst: 'Open the map the course was set on first, then the course file.',
    checkedAs: 'Checked as',
    fitsBest: 'Fits best',
    classSentence: (level: string, distance: string, courseClass: string, letter: string) =>
      `${level} ${distance} for ${courseClass}, skill level ${letter}`,
    timeInside: (estimate: string, range: string) =>
      `Winning time about ${estimate}, within the ${range} of this class.`,
    timeOutside: (estimate: string, difference: string, isLonger: boolean, range: string) =>
      `Winning time about ${estimate}, ${difference} ${isLonger ? 'longer' : 'shorter'} than the ${range} of this class.`,
    minuteRange: (shortest: number, longest: number) => `${shortest}–${longest} min`,
    difficultyFits: "Every control is at this class's difficulty.",
    difficultyMisfits: (count: number) =>
      count === 1
        ? "1 control is outside this class's difficulty."
        : `${count} controls are outside this class's difficulty.`,
    alsoFits: (classes: readonly string[]) => `Also fits: ${classes.join('; ')}.`,
    classFromName:
      'The class comes from the course name. The level and distance are deduced from the winning time and control difficulty.',
    classFromCourse:
      "The level, distance and class are deduced from the winning time and control difficulty. The winning time uses the winner's pace in Settings.",
    checkAsOther: 'Check as another class',
    chosenByYou: 'Checked as the class you chose.',
    deduceAgain: 'Deduce the class from the course',
    yourFile: 'Your file',
    measured: 'Measured',
    notGiven: 'not given',
    mismatch: (distance: string) =>
      `The file's ground positions are ${distance} from where its map positions put them on this map. Was the course set on another version of the map?`,
    descriptionsNote:
      'The control descriptions on the map are proposed from the map. IOF XML files carry none.',
    suggest: 'Suggest',
    suggestControl: (control: number) => `Suggest a better spot for control ${control}`,
    suggestion: (control: number) =>
      `A better spot for control ${control} is shown dashed on the map.`,
    noSuggestion: (control: number) => `No better spot was found for control ${control}.`,
    moveHere: 'Move here',
    keepMine: 'Keep mine',
  },
  chat: {
    title: 'Assistant',
    empty:
      'Ask for a course or a change in your own words, like “SM middle distance for D16” or “make leg 5 harder”.',
    inputLabel: 'Message to the assistant',
    placeholder: 'Ask for a course or a change…',
    send: 'Send',
    stop: 'Stop the reply',
  },
  map: {
    toolbar: 'Map tools',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    layers: 'Layers',
    costMap: 'Cost map',
    costMapLegend:
      'Blue is fast (paths, open land), clear is normal forest, orange is slow and darker is slower, red is impassable or out of bounds.',
    sites: 'Candidate control sites',
    courseRoutes: 'Routes on all legs',
    courseRoutesLegend: (share: string) =>
      `Fastest route green; other real routes blue and red, at most ${share} slower.`,
    siteCount: (count: number) => `${count} sites.`,
    difficulty: 'Difficulty from 1 easy to 5 hard:',
    planLeg: 'Plan a leg',
    editControls: 'Edit controls',
    building: 'Reading the terrain…',
    engineError: 'The engine could not read this map.',
  },
  print: {
    scaleLine: (scale: string, contourInterval: string | null) =>
      contourInterval === null ? scale : `${scale} · contour interval ${contourInterval}`,
    adjust: 'Adjust print',
    paper: 'Paper',
    scale: 'Scale',
    automaticPaper: 'Automatic (A4, A3 if needed)',
    automaticPaperShort: 'Automatic paper',
    automaticScale: (scale: string) => `Automatic (${scale})`,
    orientation: { portrait: 'portrait', landscape: 'landscape' },
    onPaper: (paper: string, orientation: string, scale: string) =>
      `${paper} ${orientation}, ${scale}`,
    beforeCourse: (paper: string, scale: string) => `${paper}, ${scale}`,
    refitFailed: 'The course does not fit on that paper at that scale.',
    chooseArea: 'Choose print area',
    moveArea: 'Move print area',
    placedByYou: (summary: string) => `${summary}, placed by you`,
    placingHint: 'Drag the paper to where the course should be.',
    placingHintTouch: 'Press and hold the paper, then drag it to where the course should be.',
    turn: 'Turn',
    turnLabel: 'Turn the paper',
    automaticArea: 'Automatic',
    automaticAreaLabel: 'Let Ratamestari place the paper',
    done: 'Done',
    setAgainInArea: 'Set the course again in this area',
    centreOutside:
      'The competition centre is outside the print area, so the start and finish would be off the paper. Move the paper over the centre, or move the centre.',
  },
  planLeg: {
    open: 'Plan a leg',
    title: 'Plan a leg',
    done: 'Done',
    placeFirst: 'Click the map where the leg starts.',
    placeSecond: 'Now click where it ends.',
    dragHint: 'Drag either control. The routes follow as you drag.',
    straightLine: 'Straight line',
    bearing: 'Bearing',
    setCourseAround: 'Set a course around this leg',
    setCourseAroundHint:
      'The leg is kept, and the course for the chosen class is set around it. Its ends snap to mapped features within 60 m.',
    chooseCentreFirst: 'Choose the competition centre first; the course finishes there.',
  },
  setByHand: {
    title: 'Set it yourself',
    entry: 'Set it yourself',
    placeStart: 'Click the map where the start is. The finish is at the competition centre.',
    placeStartTouch: 'Tap the map where the start is. The finish is at the competition centre.',
    placeNext: (control: number) =>
      `Click the map to add control ${control}. Click a leg line to put a control in it, or a control to select it.`,
    placeNextTouch: (control: number) =>
      `Tap the map to add control ${control}. Tap a leg line to put a control in it, or a control to select it.`,
    snapNote:
      'A control snaps to a mapped feature within 60 m. With none near, it stays where you put it and is flagged.',
    selected: (stop: StopName) =>
      typeof stop === 'number'
        ? `Control ${stop} is selected.`
        : `The ${stop} is selected. Drag it to move it.`,
    selectedControlHint: 'Drag it to move it, or delete it.',
    deleteKeyHint: 'Delete or Backspace also deletes it.',
    deleteControl: (control: number) => `Delete control ${control}`,
    undo: 'Undo',
    done: 'Done',
    noRulesForClass:
      'The rules have no winning time for this class at this level, so the course cannot be checked.',
    addRefused: 'The control could not be added there.',
    deleteRefused: 'The control could not be deleted.',
    finishRefused: 'The finish could not be moved there.',
    previewTitle: 'If you place it here',
    previewFastest: (time: string, length: string) => `Fastest ${time}, ${length}`,
    previewLooking: 'Looking for other routes…',
    previewChoice: (count: number, difference: string) =>
      count === 1
        ? `1 other route, ${difference} slower`
        : `${count} other routes, the best ${difference} slower`,
    previewNoChoice: 'No other route',
  },
  keep: {
    title: 'Keep when trying again',
    leg: 'Keep this leg',
    start: 'Keep the start',
    control: (control: number) => `Keep control ${control}`,
    hint: 'Try another course sets the rest again around what you keep.',
    summary: (controls: number, legs: number) =>
      `Keeps ${controls === 1 ? '1 control' : `${controls} controls`}` +
      (legs === 0 ? '' : ` and ${legs === 1 ? '1 leg' : `${legs} legs`}`) +
      ' when trying again.',
    forget: 'Forget them',
  },
  // Printed on the description box and written into IOF XML files.
  labels: {
    trainingCourse: 'Training',
    eventLevels: {
      national: 'National event',
      finnishChampionship: 'Finnish championship (SM) final',
    },
    formats: { long: 'Long distance', middle: 'Middle distance' },
  },
  findings: {
    texts: findingTexts,
    ourCheck: 'our check',
    ourCheckNoRoutes: 'our check (no marked routes yet)',
  },
  symbols: {
    summary: (count: number, corrected: number) => `Map symbols (${count}, ${corrected} corrected)`,
    intro:
      'How each OCAD symbol is read. Correct a symbol if the club uses it for something else, e.g. a motorway drawn with a road symbol. Corrections are saved for this map in this browser.',
    automatic: (label: string) => `Automatic: ${label}`,
    ignore: 'Ignore this symbol',
    ignored: 'ignored',
  },
  language: {
    label: 'Language',
    ownName: 'English',
    // Shown in the language it switches to.
    switchTo: 'Suomeksi',
  },
  courseRoutes: {
    title: 'Routes',
    findAll: 'Find routes on all legs',
    findAllHint: 'Shows where each leg has a real route choice. Long legs take a moment.',
    finding: (done: number, legs: number) => `Finding routes: ${done} of ${legs} legs`,
    summary: (withChoice: number, legs: number) =>
      `A real route choice on ${withChoice} of ${legs} ${legs === 1 ? 'leg' : 'legs'}`,
    leg: 'Leg',
    legName: (from: StopName, to: StopName) =>
      `${from === 'start' ? 'S' : from}–${to === 'finish' ? 'F' : to}`,
    fastest: 'Fastest',
    choice: 'Route choice',
    alternatives: (count: number, difference: string) =>
      count === 1 ? `1 more, ${difference}` : `${count} more, best ${difference}`,
    none: 'None',
    unreachable: 'No route',
    findingLeg: '…',
    openLeg: (leg: string) => `Show the routes of ${leg} on the map`,
  },
  landing: {
    pageTitle: 'Ratamestari: orienteering course setter',
    nav: {
      label: 'Main',
      how: 'How it works',
      status: 'Status',
      privacy: 'Privacy',
      sourceCode: 'Source code',
      guides: 'Guides',
      openApp: 'Open the app',
    },
    hero: {
      title: 'A first course in minutes, set by the rules.',
      lead: 'Open your OCAD map, choose the competition centre and the class. Ratamestari places the controls, checks them against IOF and SSL rules, writes the control descriptions and fits it all on paper.',
      trySample: 'Try it with a sample map',
      openOwn: 'Open your own map',
      checkOwn: 'Check a course you set',
      privacy: 'Runs in your browser. Your map never leaves your computer.',
    },
    demo: {
      label:
        'Animation: a map opens, the competition centre is chosen, candidate control sites appear, the good technical areas are found, the course planned through them is drawn leg by leg and the control descriptions are written.',
      steps: [
        'Map opened',
        'Competition centre',
        'Control sites',
        'Technical areas',
        'Setting the course',
        'Descriptions and paper',
        'Ready to print',
      ],
      mapCaption: 'Read in your browser, nothing uploaded',
      centreCaption: 'Chosen by you',
      sitesCaption: (count: number) => `${count} candidate sites on map features`,
      areasCaption: (count: number, minutes: number) =>
        `${count} ${count === 1 ? 'technical area' : 'technical areas'} found, ${minutes} min of the course planned there`,
      courseCaption: (length: string, controls: number) =>
        `${length} so far, ${controls} ${controls === 1 ? 'control' : 'controls'} placed`,
      descriptionsCaption: 'IOF descriptions written, course fitted to paper',
      doneCaption: (length: string, climb: string) =>
        `${length} with ${climb} climb, ready to print`,
      credit:
        'A real run of the engine on the sample map: Leirikangas, Hamina. © Vehkalahden Veikot.',
      play: 'Play the demo',
      pause: 'Pause the demo',
    },
    how: {
      title: 'Four steps on one screen.',
      steps: [
        {
          title: 'Open your map',
          text: 'Choose an OCAD file. It is read in the browser and shown as the print page.',
        },
        {
          title: 'Choose the centre',
          text: 'Click where the competition centre is. The finish goes there and the start is placed nearby.',
        },
        {
          title: 'Pick the class',
          text: 'Event level, distance and class. Ratamestari finds the good technical areas, plans the course through them and shows it when it is ready.',
        },
        {
          title: 'Check and print',
          text: 'Look at the routes, drag controls, fix what the rules flag, then save the print PDF and IOF XML.',
        },
      ],
    },
    checks: {
      title: 'Every check names its rule.',
      text: 'Distances, routes and climb are measured from the map, not guessed. Each warning cites the IOF or SSL rule behind it, so you can look it up. Walking the terrain and the final say stay with you and your controller.',
      exampleLabel: 'Example of rule checks',
      exampleTitle: '2 things to check',
      examples: [
        {
          severity: 'error',
          text: 'Controls 7 and 8 look alike and are 26 m apart. They need at least 30 m.',
          basis: 'Lajisäännöt 2026 11.41',
        },
        {
          severity: 'note',
          text: 'Control 4 is on a hill top, which is easy for this level.',
          basis: 'Our reading of the difficulty guidance',
        },
      ],
      error: 'Error',
      note: 'Note',
      fix: 'Fix',
    },
    status: {
      title: "What works, and what doesn't yet.",
      text: 'Ratamestari started as a hackathon prototype in October 2026. Use it to draft courses, not to skip your checks.',
      columns: [
        {
          title: 'Works now',
          items: [
            'OCAD maps, read in the browser',
            'Long and middle distance for SSL classes',
            "Courses planned through the map's best technical areas, with time for every part",
            'Controls placed on real map features, never crowded together',
            'Rule checks that cite their source, with Fix',
            'Checking a course you set in OCAD or Purple Pen',
            'Routes on every leg, fastest to slowest',
            'Planning a leg yourself',
            'Setting a course yourself, control by control',
            'Dragging controls, with the rules checked again',
            'Keeping the controls and legs you like while trying another course',
            'Undo, also for changes made from the chat',
            'Stopping the search and keeping the best course',
            'IOF control descriptions on the map',
            'Control numbers placed clear of the course lines',
            'Automatic fit to A4 or A3',
            'Moving the print area by hand',
            'Print PDF and IOF XML 3.0',
            'Phones and tablets',
            'An optional assistant with your own Claude API key: set, edit and improve courses in plain words',
            'In Finnish',
          ],
        },
        {
          title: 'Coming next',
          items: [
            'Choosing where the paper goes from the course plan',
            'Centre suggestions from the map',
            'Several classes side by side',
            'Open courses, finals and qualifications',
            'OpenOrienteering Mapper files',
          ],
        },
        {
          title: 'Later',
          items: [
            'Sprint distance',
            'Maps as PNG or PDF images',
            'Relay forking',
            'Planning all courses of an event together',
            'The assistant without your own key',
          ],
        },
      ],
    },
    privacy: {
      title: 'Your map stays with you.',
      paragraphs: [
        'There is no server. The map is read, routed and printed in your browser, and nothing is uploaded. The source code is public so anyone can check.',
        'The assistant is optional and everything works without it. With your own Claude API key you can ask in plain words, like "make leg 5 harder". It receives only text and numbers, never the map or coordinates.',
      ],
      exampleLabel: 'Example of a conversation with the assistant',
      exampleQuestion: "Make leg 5 harder, it's just running along the path.",
      exampleAnswer:
        'I moved control 5 from the path bend to a re-entrant 180 m east. Now the leg has a choice: around on the path, or straight over the hill with 35 m of climb. Spacing and length still meet the SSL rules.',
    },
    credits: {
      madeBy: 'Made by',
      author: 'Pouju',
      about: "Ratamestari is open source, and course setters' feedback is very welcome.",
      github: 'GitHub',
      feedback: 'Send feedback',
      items: [
        { title: 'Reading OCAD files', text: 'ocad2geojson by Per Liedman', link: 'ocad2geojson' },
        {
          title: 'Sample map',
          text: 'Leirikangas, Hamina, © Vehkalahden Veikot, included for trying Ratamestari only',
          link: null,
        },
        { title: 'Rules', text: 'IOF and Suomen Suunnistusliitto rule documents', link: null },
        {
          title: 'Visit counts',
          text: 'Umami Cloud counts visits and a few actions, such as setting a course, so we can see whether the app is used. It sets no cookies, collects no personal data and builds no profile of you. Your map and courses are never part of it.',
          link: null,
        },
        {
          title: 'Built with',
          text: 'OpenLayers, React, Vite, pdf-lib, and Claude for the assistant',
          link: null,
        },
      ],
    },
    footer: {
      by: 'Ratamestari by',
      licence: 'AGPL-3.0-or-later',
      sourceCode: 'Source code',
      version: (version: string) => `Version ${version}`,
    },
  },
  guides: {
    pageTitle: 'Guides · Ratamestari',
    title: 'How to use Ratamestari',
    lead: 'Short demos of what you can do in the workspace, played on the sample map. Some of it is one tap away and easy to miss.',
    contents: 'Guides',
    trySample: 'Try it with the sample map',
    backHome: 'Ratamestari home',
    credit:
      'Map © Vehkalahden Veikot. Routes and controls recorded from the engine on the sample map.',
    setCourse: {
      title: 'Set a course',
      intro: 'Open your map, or the sample map, and choose the class and distance in the panel.',
      steps: [
        'Click the competition centre on the map. The finish goes there and the start near it.',
        'Press Set course. The panel shows what the engine is doing; Stop keeps the best course so far.',
        'The course appears with its control descriptions, checked against the rules.',
      ],
      label:
        'Animation: the competition centre is clicked, Set course is pressed and the course appears.',
    },
    legRoutes: {
      title: 'See the route choices of a leg',
      intro: 'Every leg can show its routes, worked out from the map symbols.',
      steps: [
        'Tap a leg line or a control on the map.',
        'The fastest route is drawn green, other real route choices blue and red.',
        'The panel compares length and time. The arrows step to the next leg.',
      ],
      label: 'Animation: a leg is tapped and its routes appear on the map and in the panel.',
    },
    courseRoutes: {
      title: 'Find route choices on every leg',
      intro: 'See at a glance which legs have a real route choice.',
      steps: [
        'With the course on the map, press Find routes on all legs in the panel.',
        'The routes of each leg are drawn as they are found.',
        'Tap a row or a leg on the map. Its routes open above the list, and the list stays.',
      ],
      tip: 'Layers › Routes on all legs turns the drawing on and off.',
      label: 'Animation: routes are found for every leg and listed in the panel.',
    },
    keep: {
      title: 'Keep what you like, try again',
      intro: 'Like part of a course? Keep it, and let the engine set the rest again.',
      steps: [
        'Tap a leg, then press Keep this leg, or keep one of its controls.',
        'Kept controls and legs get a padlock on the map.',
        'Press Try another course. The kept ones stay in place and in order, and the rest is new.',
      ],
      label:
        'Animation: a leg is kept, Try another course is pressed and a new course is set around the kept leg.',
    },
    drag: {
      title: 'Move a control',
      intro: 'You can move any control, the start or the finish by hand.',
      steps: [
        'Press on a control and drag it. On a touch screen, tap its leg first.',
        'Let go: it snaps to the nearest mapped feature within 60 m.',
        'The length, the descriptions and the rule checks update at once.',
      ],
      label: 'Animation: a control is dragged to a new spot and the rules are checked again.',
    },
    setByHand: {
      title: 'Set the course yourself',
      intro: 'Place every control by hand and let Ratamestari check, describe and print it.',
      steps: [
        'Press Set it yourself in the panel, or Edit controls on the map.',
        'Click the start, then each control in order. The finish is at the competition centre.',
        'Click a control to select it, then press Delete to remove it.',
        'Undo, or Ctrl+Z, brings it back.',
      ],
      label:
        'Animation: a start and three controls are placed by hand, one is deleted and the delete is undone.',
    },
    planLeg: {
      title: 'Plan a single leg',
      intro: 'Try out a leg anywhere on the map before it is part of a course.',
      steps: [
        'Press Plan a leg in the map tools.',
        'Click where the leg starts, then where it ends.',
        'Compare the routes. Drag either end and the routes follow.',
        'Press Set a course around this leg: the leg is kept and the course is set around it.',
      ],
      label:
        'Animation: two points are clicked, the routes between them appear, and a course is set around the leg.',
    },
    assistant: {
      title: 'Ask the assistant',
      intro: 'Optional: turn it on in Settings with your own Claude API key.',
      steps: [
        'Write what you want in your own words.',
        'The engine makes the change. The assistant only reads words and numbers, never the map.',
        'It tells you what changed. Ask it to undo if you change your mind.',
      ],
      question: (control: number, direction: string) =>
        `Move control ${control} a bit ${direction}`,
      answer: (control: number, direction: string) =>
        `Done. Control ${control} is now on a site to the ${direction} of the old one. The course length and rule checks are updated in the panel.`,
      directions: {
        N: 'north',
        NE: 'northeast',
        E: 'east',
        SE: 'southeast',
        S: 'south',
        SW: 'southwest',
        W: 'west',
        NW: 'northwest',
      } satisfies Record<CompassDirection, string>,
      label:
        'Animation: the assistant is asked to move a control and the control moves on the map.',
    },
    tips: {
      title: 'More to find',
      items: [
        {
          title: 'Cost map',
          text: 'Layers › Cost map shows how fast each part of the map is to run, the basis of every route.',
        },
        {
          title: 'Candidate control sites',
          text: 'Layers › Candidate control sites shows every site the engine could use, coloured by difficulty.',
        },
        {
          title: 'Fix buttons',
          text: 'A rule problem tied to one control has a Fix button that moves that control to a better site.',
        },
        {
          title: 'Print area and paper',
          text: 'Adjust print, under the map, changes paper, scale and orientation, or lets you drag the print area.',
        },
        {
          title: 'Check a course you set',
          text: 'Open the IOF XML file of a course from OCAD or Purple Pen. It is checked against the rules for its class.',
        },
        {
          title: 'Map symbols',
          text: 'Settings › Map symbols shows how each OCAD symbol is read. Correct one if your club uses it differently.',
        },
        {
          title: 'Another course',
          text: 'Try another course sets a new one with the same settings.',
        },
        {
          title: 'Export',
          text: 'Download PDF gives the print page and a description sheet. IOF XML opens in OCAD, Condes and Purple Pen.',
        },
      ],
    },
  },
  scoreBreakdown: {
    summary: (total: string) => `Quality score ${total} (lower is better)`,
    terms: {
      timeErrorPerPercent: 'Winning time',
      timeOutsideRangePerPercent: 'Outside time range',
      spacing: 'Control spacing',
      acuteAngleWarning: 'Sharp angles',
      acuteAngleNote: 'Angles under 60°',
      difficultyOutsideRange: 'Difficulty',
      courseLineCrossing: 'Crossing lines',
      courseLineThroughControl: 'Lines through circles',
      finalLegPerPercentOverLimit: 'Last leg',
      courseLineOutsideMap: 'Lines off the map',
      courseLineOverDescriptions: 'Lines under descriptions',
      overlappingCircles: 'Overlapping circles',
      areaQuality: 'Terrain quality',
      routeChoicePerKeyLeg: 'Route choice',
      reversals: 'Reversals',
      ring: 'Ring shape',
      legLengths: 'Leg length mix',
      alternation: 'Monotonous legs',
      directionChanges: 'Direction changes',
      firstLeg: 'First leg',
      spread: 'Use of terrain',
      parallelLegs: 'Legs side by side',
      closeness: 'Passing close again',
      crowding: 'Crowded controls',
      legCount: 'Number of legs',
    } satisfies Record<keyof Course['breakdown']['terms'], string>,
  },
  units: {
    seconds: (value: string) => `${value} s`,
  },
}
