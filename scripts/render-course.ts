import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Resvg } from '@resvg/resvg-js'
import { XMLSerializer } from 'xmldom'
import { localPoint, type LocalPoint } from '@ratamestari/core'
import {
  buildTerrain,
  cellCenterOf,
  evaluateLeg,
  findControlSites,
  findPeripheralInformation,
  findTechnicalAreas,
  isUsableInPrintArea,
  planCourse,
  siteQuality,
  isInPeripheralBlock,
  layOutOverprint,
  overprintDetailOf,
  peripheralLayout,
  setCourseOnPaper,
  type PaperChoice,
  type Course,
} from '@ratamestari/engine'
import { courseDataXml, describeControl, descriptionSheet, descriptionText } from '@ratamestari/iof'
import { loadOcadMap } from '@ratamestari/map-import-ocad'
import { printPageSvg } from '@ratamestari/print'
import { svgDocument } from './svg-document'
import { svgToPdf } from './svg-to-pdf'
import {
  courseRequestSchema,
  courseTargetFor,
  PAPER,
  printScaleFor,
  printScaleSchema,
  TECHNICAL_AREAS,
  TRAINING_DEFAULTS,
  coursePurposeSchema,
  trainingTargetFor,
  trainingWinningTimeFor,
  type CourseRequest,
  type Format,
  type TrainingRules,
} from '@ratamestari/rules'

const MAPS_FOLDER = 'maps'
const RENDERS_FOLDER = join(MAPS_FOLDER, 'renders')
const IMAGE_WIDTH_PIXELS = 1800

const { values } = parseArgs({
  options: {
    map: { type: 'string' },
    level: { type: 'string', default: 'finnishChampionship' },
    format: { type: 'string', default: 'long' },
    class: { type: 'string', default: 'H21' },
    letter: { type: 'string', default: 'A' },
    seed: { type: 'string', default: '1' },
    pace: { type: 'string', default: '5:00' },
    centre: { type: 'string' },
    out: { type: 'string' },
    legs: { type: 'boolean', default: false },
    xml: { type: 'string' },
    pdf: { type: 'string' },
    'pdf-without-course': { type: 'string' },
    paper: { type: 'string', default: 'auto' },
    scale: { type: 'string', default: 'auto' },
    areas: { type: 'boolean', default: false },
    skeleton: { type: 'boolean', default: false },
    purpose: { type: 'string', default: 'competition' },
    minutes: { type: 'string' },
  },
})

const mapPath = values.map ?? firstMapIn(MAPS_FOLDER)
const [, sex = 'H', age = '21'] = /^([HD])(\d+)$/.exec(values.class) ?? []
const request: CourseRequest = courseRequestSchema.parse({
  eventLevel: values.level,
  format: values.format,
  sex,
  ageClass: Number(age),
  skillLetter: values.letter,
})
const [paceMinutes = '5', paceSeconds = '00'] = values.pace.split(':')
const paceSecondsPerKm = Number(paceMinutes) * 60 + Number(paceSeconds)
const seed = Number(values.seed)

const map = await loadOcadMap(new Uint8Array(readFileSync(mapPath)))
const features = map.features()
const terrain = buildTerrain(features, map.info.extent)
const overprintDetail = overprintDetailOf(features)
const peripheral = findPeripheralInformation(map.annotations(), terrain, map.info.scale)
const sites = findControlSites(features, terrain).filter(
  site => describeControl(site) !== null && !isInPeripheralBlock(peripheral, site.position),
)
const purpose = coursePurposeSchema.parse(values.purpose)
const training = purpose === 'training' ? trainingRulesFor(request.format) : null
const target = training ? trainingTargetFor(request, training) : courseTargetFor(request)
if (!target) throw new Error('No winning time for this class and event')

const centre = values.centre ? parsePoint(values.centre) : middleOfMappedArea()
const started = performance.now()
const course = setCourseOnPaper(
  terrain,
  sites,
  {
    target,
    format: request.format,
    printScale: printScaleFor(
      values.scale === 'auto' ? 'auto' : printScaleSchema.parse(Number(values.scale)),
      request.format,
    ),
    competitionCentre: centre,
    seed,
    training,
    paceSecondsPerKm,
    peripheralSize: peripheralLayout(peripheral.blocks),
  },
  values.paper as PaperChoice,
)
if (!course) throw new Error('No course found')
const searchSeconds = (performance.now() - started) / 1000

printSummary(course, searchSeconds)
if (course.printArea) {
  const { paper, orientation, scale } = course.printArea
  console.log(`paper: ${paper} ${orientation} 1:${scale}`)
}
if (values.legs) printLegs(course)
const sheet = descriptionSheet(course, {
  title: `${request.format} ${values.class}${values.letter}`,
  courseName: `${values.class}${values.letter}`,
})
printDescriptions()
if (values.xml) {
  const className = `${values.class}${values.letter === 'A' ? '' : values.letter}`
  writeFileSync(
    values.xml,
    courseDataXml({
      eventName: sheet.title,
      className,
      course,
      sheet,
      map: map.info,
      createdAt: new Date(),
    }),
  )
  console.log(`Wrote ${values.xml}`)
}

const outPath =
  values.out ??
  join(RENDERS_FOLDER, `${request.format}-${values.class}${values.letter}-seed${seed}.png`)
mkdirSync(RENDERS_FOLDER, { recursive: true })
writeFileSync(outPath, renderPng(course))
console.log(`Wrote ${outPath}`)
for (const [path, withoutCourse] of [
  [values.pdf, false],
  [values['pdf-without-course'], true],
] as const) {
  if (!path) continue
  writeFileSync(path, await svgToPdf(printPage(course, withoutCourse)))
  console.log(`Wrote ${path}`)
}

function firstMapIn(folder: string): string {
  const name = readdirSync(folder)
    .filter(n => n.toLowerCase().endsWith('.ocd'))
    .sort()[0]
  if (!name) throw new Error(`No .ocd map in ${folder}/`)
  return join(folder, name)
}

function parsePoint(text: string): LocalPoint {
  const [x = 0, y = 0] = text.split(',').map(Number)
  return localPoint(x, y)
}

function trainingRulesFor(format: Format): TrainingRules {
  const defaults = TRAINING_DEFAULTS.contour[format]
  if (!values.minutes) return defaults
  return { ...defaults, winningTime: trainingWinningTimeFor(Number(values.minutes)) }
}

function middleOfMappedArea(): LocalPoint {
  const mapped = [...terrain.mappedArea.keys()].filter(i => terrain.mappedArea[i])
  return cellCenterOf(terrain.grid, mapped[Math.floor(mapped.length / 2)]!)
}

function printSummary(c: Course, seconds: number) {
  const minutes = (s: number) => (s / 60).toFixed(1)
  console.log(
    `${request.format} ${values.class}${values.letter} seed ${seed}: ${c.controls.length} controls, ` +
      `${minutes(c.estimatedSeconds)}/${minutes(c.targetSeconds)} min, ` +
      `${((c.lengthMeters ?? 0) / 1000).toFixed(1)} km, search ${seconds.toFixed(1)} s`,
  )
  console.log(`legs (min): ${c.legSeconds.map(minutes).join(' ')}`)
  console.log(`difficulty: ${c.controlDifficulties.join('')}`)
  console.log(`problems: ${JSON.stringify(c.problems)}`)
  const terms = Object.entries(c.breakdown.terms)
    .filter(([, term]) => Math.abs(term.contribution) >= 0.5)
    .sort(([, a], [, b]) => b.contribution - a.contribution)
  for (const [name, term] of terms) {
    console.log(`  ${term.contribution.toFixed(1).padStart(7)}  ${name}: ${term.note}`)
  }
}

function printDescriptions() {
  const text = (d: Parameters<typeof descriptionText>[0] | null) => (d ? descriptionText(d) : '?')
  console.log(`climb: ${sheet.climbMeters} m`)
  console.log(`  S  ${text(sheet.start)}`)
  for (const row of sheet.controls)
    console.log(`  ${row.number}  ${row.code}  ${text(row.description)}`)
}

function printLegs(c: Course) {
  const stops = [c.start.position, ...c.controls.map(s => s.position), c.finish]
  let routeChoiceLegs = 0
  for (let i = 1; i < stops.length; i++) {
    const leg = evaluateLeg(terrain, stops[i - 1]!, stops[i]!, { paceSecondsPerKm })
    if (!leg) continue
    if (leg.hasRouteChoice) routeChoiceLegs++
    console.log(
      `  leg ${i}: ${Math.round(leg.straightMeters)} m, ratio ${leg.lengthRatio.toFixed(2)}, ` +
        `deviation ${Math.round(leg.maxDeviationMeters)} m, route choice ${leg.hasRouteChoice}`,
    )
  }
  console.log(`route-choice legs: ${routeChoiceLegs}/${stops.length - 1}`)
}

function printPage(c: Course, withoutCourse = false): string {
  const doc = svgDocument()
  const mapSvg = new XMLSerializer().serializeToString(
    map.renderSvg(doc, i => !peripheral.marginObjectIndices.has(i)) as unknown as Node,
  )
  const blocks = peripheral.blocks.map(block => ({
    block,
    svg: new XMLSerializer().serializeToString(
      map.renderSvg(doc, i => block.objectIndices.includes(i)) as unknown as Node,
    ),
  }))
  const scale = c.printArea?.scale ?? map.info.scale
  const contours = peripheral.contourIntervalMetres
  const scaleLine =
    `1:${scale.toLocaleString('fi-FI')}` +
    (contours === null ? '' : ` · contour interval ${contours} m`)
  const page = printPageSvg({
    mapSvg,
    mapScale: map.info.scale,
    course: c,
    overprintLayout: layOutOverprint(c, overprintDetail),
    sheet,
    peripheral: { blocks, scaleLine },
    withoutCourse,
  })
  if (!page) throw new Error('The course has no print area')
  return page.svg
}

function renderPng(c: Course): Buffer {
  const page = printPage(c)
  const closing = page.lastIndexOf('</svg>')
  const overlays = `${values.areas ? areaOverlay(c) : ''}${values.skeleton ? skeletonOverlay(c) : ''}`
  const svg = `${page.slice(0, closing)}${overlays}${page.slice(closing)}`
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: IMAGE_WIDTH_PIXELS },
    background: 'white',
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng()
}

// Technical areas (D19) on the page: hulls with their capacity in minutes.
function areaOverlay(c: Course): string {
  const area = c.printArea
  if (!area) return ''
  const onPaper = sites.filter(site => isUsableInPrintArea(site.position, area))
  const quality = siteQuality(onPaper, terrain, training)
  const areas = findTechnicalAreas(
    onPaper,
    quality,
    training?.technicalAreas ?? TECHNICAL_AREAS[request.format],
    terrain.grid,
    paceSecondsPerKm,
  )
  console.log(
    `areas: ${areas.length} (${areas.map(a => `${Math.round(a.capacitySeconds / 60)} min`).join(', ')})`,
  )
  const margin = PAPER.printMarginMillimetres
  const [minX, , , maxY] = area.extent
  const toPage = ([x, y]: LocalPoint) =>
    `${margin + ((x - minX) * 1000) / area.scale},${margin + ((maxY - y) * 1000) / area.scale}`
  return areas
    .map(({ hull, centre, capacitySeconds, meanQuality }) => {
      const [labelX, labelY] = toPage(centre).split(',')
      return (
        `<polygon points="${hull.map(toPage).join(' ')}" fill="rgb(0,120,255)" fill-opacity="0.15" ` +
        `stroke="rgb(0,90,200)" stroke-width="0.5"/>` +
        `<text x="${labelX}" y="${labelY}" font-size="4" font-family="sans-serif" ` +
        `fill="rgb(0,60,160)" text-anchor="middle">${Math.round(capacitySeconds / 60)} min · ` +
        `q ${meanQuality.toFixed(2)}</text>`
      )
    })
    .join('')
}

// The skeleton (D19) planned on the same paper: visited areas, connecting legs, section budgets.
function skeletonOverlay(c: Course): string {
  const area = c.printArea
  if (!area) return ''
  const planStarted = performance.now()
  const plan = planCourse(terrain, sites, {
    target: target!,
    format: request.format,
    printScale: area.scale,
    competitionCentre: centre,
    seed,
    paceSecondsPerKm,
    printArea: area,
    training,
  })
  const skeleton = plan?.skeleton
  if (!plan || !skeleton) {
    console.log('skeleton: none')
    return ''
  }
  const { pool } = plan.context
  const minutes = (seconds: number) => Math.round(seconds / 60)
  console.log(
    `skeleton: ${skeleton.sections.length} sections, ${skeleton.connectingLegs.length} connecting legs, ` +
      `estimated ${minutes(skeleton.estimatedSeconds)} min, score ${skeleton.score.toFixed(1)}, ` +
      `planned in ${((performance.now() - planStarted) / 1000).toFixed(1)} s`,
  )
  for (const leg of skeleton.connectingLegs) {
    const [from, to] = [pool[leg.from]!.position, pool[leg.to]!.position]
    console.log(
      `  connecting leg ${Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]))} m, ` +
        `${minutes(leg.seconds)} min, route choice ${leg.routeChoice.toFixed(2)}`,
    )
  }
  const margin = PAPER.printMarginMillimetres
  const [minX, , , maxY] = area.extent
  const toPage = ([x, y]: LocalPoint): [number, number] => [
    margin + ((x - minX) * 1000) / area.scale,
    margin + ((maxY - y) * 1000) / area.scale,
  ]
  const label = (point: LocalPoint, text: string) => {
    const [x, y] = toPage(point)
    return `<text x="${x}" y="${y}" font-size="5" font-family="sans-serif" font-weight="bold" fill="rgb(200,80,0)" text-anchor="middle">${text}</text>`
  }
  const hulls = skeleton.sections.flatMap((section, k) => {
    if (section.area === null) {
      return [label(pool[section.entry]!.position, `run-in ${minutes(section.budgetSeconds)} min`)]
    }
    const technical = plan.areas[section.area]!
    return [
      `<polygon points="${technical.hull.map(p => toPage(p).join(',')).join(' ')}" fill="rgb(255,140,0)" fill-opacity="0.12" stroke="rgb(220,100,0)" stroke-width="0.6"/>`,
      label(technical.centre, `S${k + 1} ${minutes(section.budgetSeconds)} min`),
    ]
  })
  const legs = skeleton.connectingLegs.map(leg => {
    const [x1, y1] = toPage(pool[leg.from]!.position)
    const [x2, y2] = toPage(pool[leg.to]!.position)
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgb(220,100,0)" stroke-width="1.2" stroke-dasharray="3,2"/>`
  })
  const [sx, sy] = toPage(pool[skeleton.start]!.position)
  const start = `<circle cx="${sx}" cy="${sy}" r="3" fill="none" stroke="rgb(220,100,0)" stroke-width="1"/>`
  return [...hulls, ...legs, start].join('')
}
