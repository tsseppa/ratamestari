import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { Resvg } from '@resvg/resvg-js'
import { svgDocument } from './svg-document'
import { XMLSerializer } from 'xmldom'
import type { LocalPoint } from '@ratamestari/core'
import {
  buildTerrain,
  compassDirection,
  evaluateLeg,
  fixControl,
  isSameSite,
  moveControl,
  simplify,
  layOutOverprint,
  overprintDetailOf,
  cellCenterOf,
  findControlSites,
  findPeripheralInformation,
  isInPeripheralBlock,
  isUsableInPrintArea,
  peripheralLayout,
  planCourse,
  setCourseOnPaper,
  withMapContourInterval,
  type ControlSiteCandidate,
} from '@ratamestari/engine'
import { describeControl, descriptionSheet, renderDescriptionSheet } from '@ratamestari/iof'
import { loadOcadMap } from '@ratamestari/map-import-ocad'
import { printPageSvg } from '@ratamestari/print'
import { en } from '../apps/web/src/i18n/en'
import {
  COURSE_OVERPRINT,
  courseTargetFor,
  overprintMillimetresAt,
  PAPER,
  printScaleFor,
  type CourseRequest,
} from '@ratamestari/rules'

// Records a real engine run on the sample map for the landing page's hero: the course and a
// spread of candidate sites in page units, and the print page without the course as background.

const { values } = parseArgs({
  options: {
    map: { type: 'string', default: 'apps/web/public/sample/sample.ocd' },
    out: { type: 'string', default: 'apps/web/src/landing/sample-run.json' },
    background: { type: 'string', default: 'apps/web/src/landing/sample-page.png' },
    descriptions: { type: 'string', default: 'apps/web/src/landing/sample-descriptions.svg' },
    preview: { type: 'string', default: 'apps/web/public/social-preview.png' },
    guides: { type: 'string', default: 'apps/web/src/guides/guide-run.json' },
    seed: { type: 'string', default: '2' },
  },
})

// D14 (orange) rather than a beginners' class: an orange course has point features such as
// boulders and knolls, which show the engine better than the white course's vegetation corners
// (SSL difficulty levels: white follows linear features).
const REQUEST: CourseRequest = {
  eventLevel: 'national',
  format: 'middle',
  sex: 'D',
  ageClass: 14,
  skillLetter: 'A',
}
const PACE_SECONDS_PER_KM = 300
const ROUTE_SIMPLIFY_METERS = 2
const DRAG_METERS = [70, 160] as const
const PLANNED_LEG_METERS = [300, 550] as const
const PLANNED_LEG_SITE_STEP = 7
const PLANNED_LEG_PAGE_INSET_SHARE = 0.2
const PAGE_UNITS_PER_MILLIMETRE = 600 / 210
const SHOWN_SITES = 60
const BACKGROUND_WIDTH_PIXELS = 1200
const CROP_PADDING_MILLIMETRES = 4
const DESCRIPTION_HEADING_ROWS = 2
const PREVIEW_SIZE_PIXELS = [1200, 630] as const
const PREVIEW_MAP_WIDTH_PIXELS = 700
const PREVIEW_TERRAIN_MARGIN_MILLIMETRES = 4
const PREVIEW_COURSE_MARGIN_MILLIMETRES = 8
// Resvg reads no WOFF2, so the card falls back to a system sans when the app font is not installed.
const PREVIEW_FONT = 'Atkinson Hyperlegible Next, DejaVu Sans, Arial, sans-serif'
// Brand colours from apps/web/src/tokens.css.
const PREVIEW_COLOURS = {
  ink: '#000000',
  inkSoft: '#4d4d4d',
  paper: '#eceeea',
  overprint: '#a3238e',
}

const map = await loadOcadMap(new Uint8Array(readFileSync(values.map)))
const features = map.features()
const terrainAtStandardInterval = buildTerrain(features, map.info.extent)
const peripheral = findPeripheralInformation(
  map.annotations(),
  terrainAtStandardInterval,
  map.info.scale,
)
const terrain = withMapContourInterval(terrainAtStandardInterval, peripheral)
const sites = findControlSites(features, terrain).filter(
  site => describeControl(site) !== null && !isInPeripheralBlock(peripheral, site.position),
)
const mapped = [...terrain.mappedArea.keys()].filter(i => terrain.mappedArea[i])
const centre = cellCenterOf(terrain.grid, mapped[Math.floor(mapped.length / 2)]!)

const spec = {
  target: courseTargetFor(REQUEST)!,
  format: REQUEST.format,
  printScale: printScaleFor('auto', REQUEST.format),
  competitionCentre: centre,
  seed: Number(values.seed),
  paceSecondsPerKm: PACE_SECONDS_PER_KM,
  peripheralSize: peripheralLayout(peripheral.blocks),
}
const course = setCourseOnPaper(terrain, sites, spec, 'auto')
const area = course?.printArea
if (!course || !area) throw new Error('No course found on the sample map')
// The planner's view on the same paper, for the hero's "technical areas" step: the areas the
// skeleton visits, with their time budgets (D19).
const plan = planCourse(terrain, sites, { ...spec, printScale: area.scale, printArea: area })
const visited = (plan?.skeleton?.sections ?? []).flatMap(section =>
  section.area === null
    ? []
    : [{ area: plan!.areas[section.area]!, seconds: section.budgetSeconds }],
)

const sheet = descriptionSheet(course, {
  title: 'Middle distance',
  courseName: `${REQUEST.sex}${REQUEST.ageClass}`,
})
const margin = PAPER.printMarginMillimetres
const [minX, , , maxY] = area.extent
const toPageMillimetres = ([x, y]: LocalPoint): [number, number] => [
  margin + ((x - minX) * 1000) / area.scale,
  margin + ((maxY - y) * 1000) / area.scale,
]

// The sample fills only part of the paper, so the hero shows the box around the terrain and the
// course: the candidate sites and the course, with the page only cropped. The description box is
// saved on its own, since on the paper it sits in an empty corner far from the sample terrain.
const onPage = sites.filter(site => isUsableInPrintArea(site.position, area))
const described = renderDescriptionSheet(sheet)
const stops = [
  toPageMillimetres(course.start.position),
  ...course.controls.map(site => toPageMillimetres(site.position)),
  toPageMillimetres(course.finish),
]
const drawn = [...onPage.map(site => toPageMillimetres(site.position)), ...stops]
const [shortSide, longSide] = PAPER.sizesMillimetres[area.paper]
const [pageWidth, pageHeight] =
  area.orientation === 'portrait' ? [shortSide, longSide] : [longSide, shortSide]
const crop = {
  left: Math.max(0, Math.min(...drawn.map(([x]) => x)) - CROP_PADDING_MILLIMETRES),
  top: Math.max(0, Math.min(...drawn.map(([, y]) => y)) - CROP_PADDING_MILLIMETRES),
  right: Math.min(pageWidth, Math.max(...drawn.map(([x]) => x)) + CROP_PADDING_MILLIMETRES),
  bottom: Math.min(pageHeight, Math.max(...drawn.map(([, y]) => y)) + CROP_PADDING_MILLIMETRES),
}
const toPage = (point: LocalPoint) => {
  const [x, y] = toPageMillimetres(point)
  return [
    round((x - crop.left) * PAGE_UNITS_PER_MILLIMETRE),
    round((y - crop.top) * PAGE_UNITS_PER_MILLIMETRE),
  ] as const
}

const every = Math.max(1, Math.floor(onPage.length / SHOWN_SITES))
const symbolOnPage = (millimetres: number) =>
  overprintMillimetresAt(millimetres, area.scale) * PAGE_UNITS_PER_MILLIMETRE
const run = {
  page: [crop.right - crop.left, crop.bottom - crop.top].map(side =>
    round(side * PAGE_UNITS_PER_MILLIMETRE),
  ),
  centre: toPage(course.finish),
  sites: onPage.filter((_, i) => i % every === 0).map(site => toPage(site.position)),
  start: toPage(course.start.position),
  controls: course.controls.map(site => toPage(site.position)),
  numbers: layOutOverprint(course, overprintDetailOf(features)).numberCentres.map(toPage),
  areas: visited.map(({ area: technical, seconds }) => ({
    hull: technical.hull.map(toPage),
    minutes: Math.round(seconds / 60),
  })),
  finish: toPage(course.finish),
  descriptions: {
    width: round(described.widthMillimetres * PAGE_UNITS_PER_MILLIMETRE),
    height: round(described.heightMillimetres * PAGE_UNITS_PER_MILLIMETRE),
    rows: DESCRIPTION_HEADING_ROWS + 1 + sheet.controls.length + 1,
  },
  // ISOM course symbols at the print scale, so the hero draws them as the print does.
  symbols: {
    lineWidth: round(symbolOnPage(COURSE_OVERPRINT.courseLineWidthMillimetres)),
    controlRadius: round(symbolOnPage(COURSE_OVERPRINT.controlCircleDiameterMillimetres) / 2),
    startRadius: round(symbolOnPage(COURSE_OVERPRINT.startTriangleSideMillimetres) / Math.sqrt(3)),
    finishInnerRadius: round(symbolOnPage(COURSE_OVERPRINT.finishInnerDiameterMillimetres) / 2),
    finishOuterRadius: round(symbolOnPage(COURSE_OVERPRINT.finishOuterDiameterMillimetres) / 2),
    numberHeight: round(symbolOnPage(COURSE_OVERPRINT.controlNumberHeightMillimetres)),
    gap: round(symbolOnPage(COURSE_OVERPRINT.courseLineGapMillimetres)),
  },
  siteCount: onPage.length,
  lengthMeters: Math.round(course.lengthMeters ?? 0),
  climbMeters: Math.round(course.climbMeters ?? 0),
}
writeFileSync(values.out, `${JSON.stringify(run, null, 2)}\n`)
writeFileSync(values.descriptions, described.svg)
writeFileSync(values.guides, `${JSON.stringify(guideRun(), null, 2)}\n`)
execFileSync(
  process.execPath,
  [
    createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs'),
    '--write',
    values.out,
    values.guides,
  ],
  { stdio: 'ignore' },
)

const document = svgDocument()
const svgOf = (includesObject: (objectIndex: number) => boolean) =>
  new XMLSerializer().serializeToString(map.renderSvg(document, includesObject) as unknown as Node)
const pageInput = {
  mapSvg: svgOf(i => !peripheral.marginObjectIndices.has(i)),
  mapScale: map.info.scale,
  course,
  sheet,
  peripheral: {
    blocks: peripheral.blocks.map(block => ({
      block,
      svg: svgOf(i => block.objectIndices.includes(i)),
    })),
    scaleLine:
      `1:${area.scale.toLocaleString('en')}` +
      (peripheral.contourIntervalMetres === null
        ? ''
        : ` · contour interval ${peripheral.contourIntervalMetres} m`),
  },
}
writeFileSync(
  values.background,
  pngOf(printPageSvg({ ...pageInput, withoutCourse: true })!.svg, crop, BACKGROUND_WIDTH_PIXELS),
)

// The link preview (og:image) is a card: the app's name and promise beside the course on the map.
const [previewWidth, previewHeight] = PREVIEW_SIZE_PIXELS
// The map side shows the sample terrain (where the sites are) around the course, so the card has
// no empty paper beside the map.
const terrainPoints = onPage.map(site => toPageMillimetres(site.position))
const terrainBox = {
  left: Math.min(...terrainPoints.map(([x]) => x)) - PREVIEW_TERRAIN_MARGIN_MILLIMETRES,
  top: Math.min(...terrainPoints.map(([, y]) => y)) - PREVIEW_TERRAIN_MARGIN_MILLIMETRES,
  right: Math.max(...terrainPoints.map(([x]) => x)) + PREVIEW_TERRAIN_MARGIN_MILLIMETRES,
  bottom: Math.max(...terrainPoints.map(([, y]) => y)) + PREVIEW_TERRAIN_MARGIN_MILLIMETRES,
}
const mapCropHeight = Math.min(
  terrainBox.bottom - terrainBox.top,
  ((terrainBox.right - terrainBox.left) * previewHeight) / PREVIEW_MAP_WIDTH_PIXELS,
)
const mapCropWidth = (mapCropHeight * PREVIEW_MAP_WIDTH_PIXELS) / previewHeight
const centreOf = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2
const clamped = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const shownLeft = Math.min(
  terrainBox.left,
  ...stops.map(([x]) => x - PREVIEW_COURSE_MARGIN_MILLIMETRES),
)
const shownRight = Math.max(
  terrainBox.right,
  ...stops.map(([x]) => x + PREVIEW_COURSE_MARGIN_MILLIMETRES),
)
const mapLeft = clamped(
  centreOf(stops.map(([x]) => x)) - mapCropWidth / 2,
  shownLeft,
  shownRight - mapCropWidth,
)
const mapTop = clamped(
  centreOf(stops.map(([, y]) => y)) - mapCropHeight / 2,
  Math.min(terrainBox.top, ...stops.map(([, y]) => y - PREVIEW_COURSE_MARGIN_MILLIMETRES)),
  Math.max(terrainBox.bottom, ...stops.map(([, y]) => y + PREVIEW_COURSE_MARGIN_MILLIMETRES)) -
    mapCropHeight,
)
const previewMap = pngOf(
  printPageSvg(pageInput)!.svg,
  { left: mapLeft, top: mapTop, right: mapLeft + mapCropWidth, bottom: mapTop + mapCropHeight },
  PREVIEW_MAP_WIDTH_PIXELS,
)
writeFileSync(values.preview, previewCard(previewMap))
console.log(
  `Wrote ${values.out}, ${values.descriptions}, ${values.background} and ${values.preview}: ` +
    `${run.controls.length} controls, ` +
    `${(run.lengthMeters / 1000).toFixed(1)} km, ${run.siteCount} sites on the page`,
)

// What the guides page replays on the same page: the routes of one leg and of every leg, a dragged
// control, a planned leg and a control the assistant moved, all from the engine.
function guideRun() {
  const route = (points: readonly LocalPoint[]) =>
    simplify(points, ROUTE_SIMPLIFY_METERS).map(toPage)
  const routesOf = (from: LocalPoint, to: LocalPoint) => {
    const leg = evaluateLeg(terrain, from, to, { paceSecondsPerKm: PACE_SECONDS_PER_KM })
    if (!leg) return null
    return {
      straightMeters: Math.round(leg.straightMeters),
      bearingDegrees: Math.round(leg.bearingDegrees),
      routes: [
        leg.fastest,
        ...[...leg.alternatives].sort((a, b) => a.timeSeconds - b.timeSeconds),
      ].map(each => ({
        points: route(each.points),
        lengthMeters: Math.round(each.lengthMeters),
        timeSeconds: Math.round(each.timeSeconds),
      })),
    }
  }
  const courseStops = [
    course!.start.position,
    ...course!.controls.map(c => c.position),
    course!.finish,
  ]
  const legs = courseStops.slice(1).map((to, i) => routesOf(courseStops[i]!, to))
  const shownLeg = legs.reduce(
    (best, leg, i) =>
      (leg?.routes.length ?? 0) > (legs[best]?.routes.length ?? 0) ||
      ((leg?.routes.length ?? 0) === (legs[best]?.routes.length ?? 0) &&
        (leg?.straightMeters ?? 0) > (legs[best]?.straightMeters ?? 0))
        ? i
        : best,
    0,
  )

  const inCourse = new Set([course!.start.id, ...course!.controls.map(c => c.id)])
  const isShown = (position: LocalPoint, insetShare = 0) => {
    const [x, y] = toPage(position)
    const [width, height] = [run.page[0]!, run.page[1]!]
    return (
      x > width * insetShare &&
      y > height * insetShare &&
      x < width * (1 - insetShare) &&
      y < height * (1 - insetShare)
    )
  }
  const editSpec = { ...spec, printScale: area!.scale, printArea: area! }
  const dragged = Math.max(1, Math.floor(course!.controls.length / 3))
  const draggedFrom = course!.controls[dragged - 1]!.position
  const dragTarget = onPage
    .filter(site => !inCourse.has(site.id) && isShown(site.position))
    .map(site => ({
      site,
      meters: Math.hypot(site.position[0] - draggedFrom[0], site.position[1] - draggedFrom[1]),
    }))
    .filter(({ meters }) => meters >= DRAG_METERS[0] && meters <= DRAG_METERS[1])
    .sort((a, b) => a.meters - b.meters)[0]?.site
  const afterDrag =
    dragTarget && moveControl(terrain, sites, editSpec, course!, dragged, dragTarget.position)

  const asked = Math.max(1, Math.floor((course!.controls.length * 2) / 3))
  const askedFrom = course!.controls[asked - 1]!
  const moves = (['N', 'E', 'S', 'W'] as const).flatMap(direction => {
    const moved = fixControl(terrain, sites, editSpec, course!, asked, 'best', direction)
    const site = moved.controls[asked - 1]!
    return site.id !== askedFrom.id && isShown(site.position)
      ? [{ direction: compassDirection(askedFrom.position, site.position), to: site.position }]
      : []
  })

  const plannable = onPage.filter(
    site => !inCourse.has(site.id) && isShown(site.position, PLANNED_LEG_PAGE_INSET_SHARE),
  )
  let planned:
    | ({
        from: LocalPoint
        to: LocalPoint
        sites: [ControlSiteCandidate, ControlSiteCandidate]
      } & NonNullable<ReturnType<typeof routesOf>>)
    | null = null
  for (let i = 0; i < plannable.length && !planned; i += PLANNED_LEG_SITE_STEP) {
    for (let j = i + 1; j < plannable.length && !planned; j += PLANNED_LEG_SITE_STEP) {
      const from = plannable[i]!.position
      const to = plannable[j]!.position
      const meters = Math.hypot(to[0] - from[0], to[1] - from[1])
      if (meters < PLANNED_LEG_METERS[0] || meters > PLANNED_LEG_METERS[1]) continue
      const routes = routesOf(from, to)
      if (routes && routes.routes.length > 1)
        planned = { from, to, sites: [plannable[i]!, plannable[j]!], ...routes }
    }
  }

  // A course set around the planned leg (D15), on the same page as the rest so the guide can show it.
  const aroundPlanned =
    planned &&
    setCourseOnPaper(
      terrain,
      sites,
      {
        ...editSpec,
        locks: { start: null, controls: planned.sites, keptLegs: [false, true, false] },
      },
      'auto',
    )
  const around = aroundPlanned &&
    [aroundPlanned.start, ...aroundPlanned.controls].every(site => isShown(site.position)) && {
      start: toPage(aroundPlanned.start.position),
      controls: aroundPlanned.controls.map(site => toPage(site.position)),
      numbers: layOutOverprint(aroundPlanned, overprintDetailOf(features)).numberCentres.map(
        toPage,
      ),
      keptStops: planned!.sites.map(
        site => aroundPlanned.controls.findIndex(other => isSameSite(other, site)) + 1,
      ),
    }

  // The shown leg kept, with both its controls, and the course set again around it (D15).
  const keptControls = [shownLeg, shownLeg + 1].filter(
    stop => stop >= 1 && stop <= course!.controls.length,
  )
  const keptSites = keptControls.map(stop => course!.controls[stop - 1]!)
  const again =
    keptSites.length === 2
      ? setCourseOnPaper(
          terrain,
          sites,
          {
            ...editSpec,
            seed: spec.seed + 1,
            locks: { start: null, controls: keptSites, keptLegs: [false, true, false] },
          },
          'auto',
        )
      : null
  const keptAgain = again && {
    leg: shownLeg,
    start: toPage(again.start.position),
    controls: again.controls.map(site => toPage(site.position)),
    numbers: layOutOverprint(again, overprintDetailOf(features)).numberCentres.map(toPage),
    keptStops: keptSites.map(
      site => again.controls.findIndex(other => isSameSite(other, site)) + 1,
    ),
  }

  return {
    keep: keptAgain,
    leg: { index: shownLeg, ...legs[shownLeg]! },
    courseRoutes: legs.map(leg => leg?.routes ?? []),
    findings: course!.findings.length,
    drag:
      afterDrag && dragTarget
        ? { control: dragged, to: toPage(dragTarget.position), findings: afterDrag.findings.length }
        : null,
    assistant: moves[0]
      ? { control: asked, direction: moves[0].direction, to: toPage(moves[0].to) }
      : null,
    plannedLeg: planned && {
      straightMeters: planned.straightMeters,
      bearingDegrees: planned.bearingDegrees,
      routes: planned.routes,
      from: toPage(planned.from),
      to: toPage(planned.to),
      around: around || null,
    },
  }
}

function pngOf(
  pageSvg: string,
  box: { left: number; top: number; right: number; bottom: number },
  widthPixels: number,
) {
  const width = box.right - box.left
  const height = box.bottom - box.top
  const croppedSvg = pageSvg.replace(
    /width="[\d.]+mm" height="[\d.]+mm" viewBox="[^"]*"/,
    `width="${width}mm" height="${height}mm" viewBox="${box.left} ${box.top} ${width} ${height}"`,
  )
  return new Resvg(croppedSvg, {
    fitTo: { mode: 'width', value: widthPixels },
    background: 'white',
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng()
}

function previewCard(mapPng: Buffer) {
  const textWidth = previewWidth - PREVIEW_MAP_WIDTH_PIXELS
  const { ink, inkSoft, paper, overprint } = PREVIEW_COLOURS
  const titleLines = wrapped(en.landing.hero.title, 26)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${previewWidth}" height="${previewHeight}">
  <rect width="${previewWidth}" height="${previewHeight}" fill="${paper}"/>
  <image x="${textWidth}" y="0" width="${PREVIEW_MAP_WIDTH_PIXELS}" height="${previewHeight}"
    href="data:image/png;base64,${mapPng.toString('base64')}"/>
  <g fill="none" stroke="${overprint}" stroke-width="6">
    <path d="M64 136 L92 88 L120 136 Z"/>
    <circle cx="168" cy="118" r="22"/>
    <circle cx="232" cy="118" r="22"/>
    <circle cx="232" cy="118" r="14"/>
  </g>
  <text font-family="${PREVIEW_FONT}" fill="${ink}">
    <tspan x="60" y="248" font-size="64" font-weight="800" letter-spacing="-1.5">Ratamestari</tspan>
    ${titleLines
      .map(
        (line, i) =>
          `<tspan x="60" y="${316 + i * 40}" font-size="30" fill="${inkSoft}">${line}</tspan>`,
      )
      .join('')}
    <tspan x="60" y="560" font-size="22" font-weight="700" fill="${overprint}">pouju.github.io/ratamestari</tspan>
  </text>
  <text x="${previewWidth - 16}" y="${previewHeight - 14}" text-anchor="end"
    font-family="${PREVIEW_FONT}" font-size="15" fill="${inkSoft}">Map © Vehkalahden Veikot</text>
</svg>`
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' } })
    .render()
    .asPng()
}

function wrapped(text: string, maxCharacters: number) {
  return text.split(' ').reduce<string[]>((lines, word) => {
    const last = lines.at(-1)
    if (last !== undefined && `${last} ${word}`.length <= maxCharacters) {
      lines[lines.length - 1] = `${last} ${word}`
    } else {
      lines.push(word)
    }
    return lines
  }, [])
}

function round(value: number) {
  return Math.round(value * 10) / 10
}
