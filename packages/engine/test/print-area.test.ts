import { describe, expect, it } from 'vitest'
import { localExtent, localPoint } from '@ratamestari/core'
import { TRAINING_DEFAULTS } from '@ratamestari/rules'
import type { ControlSiteCandidate } from '../src/control-sites'
import {
  descriptionBoxGroundSize,
  fitBoxesToCourse,
  fitPrintAreaToCourse,
  hasRoomForCentre,
  isUsableInPrintArea,
  lineCrossesExtent,
  placeBoxesInFrame,
  placeDescriptionBox,
  planPrintArea,
  printableGroundSize,
  printFrameAround,
  stopsOutsideFrame,
} from '../src/print-area'
import { buildTerrain } from '../src/terrain'
import { SQUARE_KILOMETRE } from './fixtures'

const site = (x: number, y: number, id: number): ControlSiteCandidate => ({
  id,
  position: localPoint(x, y),
  isomCode: '204',
  symbolNumber: 204000,
  placement: 'point',
  contourForm: null,
  distanceToLeadingFeatureMeters: 100,
  leadingFeatureDistance: 'far',
  inSlowTerrain: false,
  technicalDifficulty: 4,
  orientation: null,
  similarFeatureOffsets: [],
  flagSide: 'side',
})

const clusterAround = (cx: number, cy: number, firstId: number) =>
  Array.from({ length: 25 }, (_, i) =>
    site(cx + (i % 5) * 15 - 30, cy + Math.floor(i / 5) * 15 - 30, firstId + i),
  )

const terrain = buildTerrain([], SQUARE_KILOMETRE, { restrictToMappedArea: false })
const SMALL_SCALE_FOR_A_SMALL_MAP = 2000
const centre = localPoint(500, 500)

describe('planPrintArea', () => {
  it('frames the paper around the competition centre, towards the best terrain', () => {
    const sites = [...clusterAround(850, 500, 0), ...clusterAround(150, 900, 25).slice(0, 5)]
    const area = planPrintArea(terrain, sites, {
      paper: 'A4',
      printScale: SMALL_SCALE_FOR_A_SMALL_MAP,
      competitionCentre: centre,
      descriptionRows: 10,
    })!
    const [minX, minY, maxX, maxY] = area.extent
    const { width, height } = printableGroundSize(
      'A4',
      area.orientation,
      SMALL_SCALE_FOR_A_SMALL_MAP,
    )
    expect(maxX - minX).toBeCloseTo(width)
    expect(maxY - minY).toBeCloseTo(height)
    expect(isUsableInPrintArea(localPoint(850, 500), area)).toBe(true)
    expect(minX < 500 && maxX > 500 && minY < 500 && maxY > 500).toBe(true)
  })

  it('puts the description box in a corner away from the good sites and the finish', () => {
    const sites = clusterAround(800, 700, 0)
    const area = planPrintArea(terrain, sites, {
      paper: 'A4',
      printScale: SMALL_SCALE_FOR_A_SMALL_MAP,
      competitionCentre: centre,
      descriptionRows: 10,
    })!
    expect(sites.every(s => isUsableInPrintArea(s.position, area))).toBe(true)
    const [bx0, by0, bx1, by1] = area.descriptionBox
    expect(500 >= bx0 && 500 <= bx1 && 500 >= by0 && 500 <= by1).toBe(false)
  })
})

describe('lineCrossesExtent', () => {
  const box = localExtent(100, 100, 200, 200)
  it('finds lines that pass through or end in the box', () => {
    expect(lineCrossesExtent(localPoint(0, 150), localPoint(300, 150), box)).toBe(true)
    expect(lineCrossesExtent(localPoint(150, 150), localPoint(300, 300), box)).toBe(true)
    expect(lineCrossesExtent(localPoint(0, 0), localPoint(300, 0), box)).toBe(false)
  })
})

describe('placeDescriptionBox', () => {
  it('aligns the box to the paper corner of its reserved space', () => {
    const area = {
      paper: 'A4',
      scale: 10000,
      orientation: 'portrait',
      extent: localExtent(0, 0, 400, 600),
      descriptionBox: localExtent(300, 0, 400, 300),
      peripheralBox: null,
    } as const
    expect(placeDescriptionBox(area, 100, 200)).toEqual([300, 0, 400, 200])
  })
})

describe('fitPrintAreaToCourse', () => {
  const stops = [
    localPoint(300, 300),
    localPoint(500, 450),
    localPoint(420, 250),
    localPoint(320, 320),
  ]
  const request = { papers: ['A4', 'A3'] as const, printScale: 2000, descriptionRows: 8 }

  it('frames the whole course on the smallest paper that holds it', () => {
    const area = fitPrintAreaToCourse(terrain, stops, request)!
    expect(area.paper).toBe('A4')
    expect(stops.every(stop => isUsableInPrintArea(stop, area))).toBe(true)
  })

  it('keeps the description box clear of controls and course lines', () => {
    const area = fitPrintAreaToCourse(terrain, stops, request)!
    stops.forEach((stop, i) => {
      if (i > 0) expect(lineCrossesExtent(stops[i - 1]!, stop, area.descriptionBox)).toBe(false)
    })
  })

  it('reserves a free corner for the peripheral information, clear of the course', () => {
    const peripheralSize = { widthMillimetres: 45, heightMillimetres: 30 }
    const area = fitPrintAreaToCourse(terrain, stops, { ...request, peripheralSize })!
    const box = area.peripheralBox!
    expect(box[2] - box[0]).toBeCloseTo(90)
    expect(box[3] - box[1]).toBeCloseTo(60)
    const [dx0, dy0, dx1, dy1] = area.descriptionBox
    expect(box[0] < dx1 && dx0 < box[2] && box[1] < dy1 && dy0 < box[3]).toBe(false)
    expect(stops.every(stop => isUsableInPrintArea(stop, area))).toBe(true)
    stops.forEach((stop, i) => {
      if (i > 0) expect(lineCrossesExtent(stops[i - 1]!, stop, box)).toBe(false)
    })
  })

  it('moves up to A3 when the course is too big for A4', () => {
    const wide = [...stops, localPoint(850, 300)]
    expect(fitPrintAreaToCourse(terrain, wide, request)!.paper).toBe('A3')
  })

  it('places the paper over the mapped area', () => {
    const mappedNorthHalf = buildTerrain([], SQUARE_KILOMETRE, { restrictToMappedArea: false })
    mappedNorthHalf.mappedArea.forEach((_, i) => {
      const row = Math.floor(i / mappedNorthHalf.grid.columns)
      mappedNorthHalf.mappedArea[i] = row * mappedNorthHalf.grid.cellSizeMeters >= 300 ? 1 : 0
    })
    const area = fitPrintAreaToCourse(mappedNorthHalf, stops, request)!
    const [, minY] = area.extent
    expect(minY).toBeGreaterThan(stops.reduce((low, [, y]) => Math.min(low, y), Infinity) - 100)
  })
})

describe('printFrameAround', () => {
  it('centres a sheet of the chosen paper, orientation and scale on the point', () => {
    const frame = printFrameAround(localPoint(400, 600), 'A4', 'landscape', 2000)
    const { width, height } = printableGroundSize('A4', 'landscape', 2000)
    const [minX, minY, maxX, maxY] = frame.extent
    expect(maxX - minX).toBeCloseTo(width)
    expect(maxY - minY).toBeCloseTo(height)
    expect((minX + maxX) / 2).toBeCloseTo(400)
    expect((minY + maxY) / 2).toBeCloseTo(600)
    expect(width).toBeGreaterThan(height)
  })
})

describe('placeBoxesInFrame', () => {
  const frame = printFrameAround(localPoint(300, 300), 'A4', 'portrait', 2000)

  it('keeps the frame where the user put it and the description box off the centre', () => {
    const area = placeBoxesInFrame(terrain, clusterAround(800, 800, 0), frame, {
      competitionCentre: localPoint(250, 250),
      descriptionRows: 10,
    })!
    expect(area.extent).toEqual(frame.extent)
    expect(area.orientation).toBe('portrait')
    const [bx0, by0, bx1, by1] = area.descriptionBox
    expect(250 >= bx0 - 75 && 250 <= bx1 + 75 && 250 >= by0 - 75 && 250 <= by1 + 75).toBe(false)
  })

  it('refuses a frame that leaves the competition centre outside', () => {
    const outside = localPoint(900, 900)
    expect(hasRoomForCentre(frame, outside)).toBe(false)
    expect(
      placeBoxesInFrame(terrain, [], frame, { competitionCentre: outside, descriptionRows: 10 }),
    ).toBeNull()
  })
})

describe('fitBoxesToCourse', () => {
  const stops = [localPoint(300, 300), localPoint(420, 380), localPoint(330, 450)]

  it('does not move the frame, and puts the description box clear of the course', () => {
    const frame = printFrameAround(localPoint(350, 380), 'A4', 'portrait', 2000)
    const area = fitBoxesToCourse(terrain, stops, frame, { descriptionRows: 6 })!
    expect(area.extent).toEqual(frame.extent)
    stops.forEach((stop, i) => {
      if (i > 0) expect(lineCrossesExtent(stops[i - 1]!, stop, area.descriptionBox)).toBe(false)
    })
    expect(stopsOutsideFrame(stops, area)).toEqual([])
  })

  it('tells which stops a moved frame leaves outside', () => {
    const frame = printFrameAround(localPoint(200, 380), 'A4', 'portrait', 2000)
    const area = fitBoxesToCourse(terrain, stops, frame, { descriptionRows: 6 })!
    expect(stopsOutsideFrame(stops, area)).toEqual([1])
  })
})

describe('description layouts for training', () => {
  const training = TRAINING_DEFAULTS.contour.controlPicking
  const manyControls = 30 + 4
  const frame = printFrameAround(centre, 'A4', 'portrait', SMALL_SCALE_FOR_A_SMALL_MAP)

  it('splits the rows into parts side by side', () => {
    const whole = descriptionBoxGroundSize(manyControls, 2000)
    const split = descriptionBoxGroundSize(manyControls, 2000, { boxMillimetres: 6, parts: 2 })
    expect(split.width).toBeCloseTo(2 * whole.width)
    expect(split.height).toBeCloseTo(whole.height / 2)
  })

  it('keeps one part in standard boxes for a competition', () => {
    const area = fitBoxesToCourse(terrain, [centre], frame, { descriptionRows: manyControls })!
    expect(area.descriptionLayout).toEqual({ boxMillimetres: 6, parts: 1 })
  })

  it('splits a long training description before making its boxes smaller', () => {
    const area = fitBoxesToCourse(terrain, [centre], frame, {
      descriptionRows: manyControls,
      training,
    })!
    expect(area.descriptionLayout).toEqual({ boxMillimetres: 6, parts: 2 })
  })

  it('makes the boxes smaller when the split box would cover the course', () => {
    const nearEveryCorner = [localPoint(500, 600), localPoint(500, 400)]
    const area = fitBoxesToCourse(terrain, nearEveryCorner, frame, {
      descriptionRows: manyControls,
      training,
    })!
    expect(area.descriptionLayout).toEqual({ boxMillimetres: 5, parts: 2 })
  })

  it('fits a long training description in a split layout and keeps the standard one otherwise', () => {
    const stops = [localPoint(300, 300), localPoint(500, 450), localPoint(420, 250)]
    const request = { papers: ['A4'] as const, printScale: 2000, descriptionRows: manyControls }
    const competition = fitPrintAreaToCourse(terrain, stops, request)!
    expect(competition.descriptionLayout).toEqual({ boxMillimetres: 6, parts: 1 })
    const trained = fitPrintAreaToCourse(terrain, stops, { ...request, training })!
    expect(trained.descriptionLayout!.parts).toBeGreaterThan(1)
  })
})
