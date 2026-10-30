import { DESCRIPTION_BOX } from '@ratamestari/rules'
import { compassClockwiseDegrees, type CompassPoint } from './compass'
import type { ControlDescription } from './describe-control'
import type { DescriptionSheet } from './description-sheet'
import {
  APPEARANCE_PICTOGRAMS,
  DIRECTION_ARROW,
  FEATURE_PICTOGRAMS,
  LOCATION_PICTOGRAMS,
  START_TRIANGLE,
} from './pictograms'

export interface RenderedSheet {
  readonly svg: string
  readonly widthMillimetres: number
  readonly heightMillimetres: number
}

const COLUMNS = DESCRIPTION_BOX.columns
const DEFAULT_BOX_MILLIMETRES = DESCRIPTION_BOX.boxMillimetres
const THIN_LINE = 0.15
const THICK_LINE = 0.45
const PICTOGRAM_STROKE = 6
const PICTOGRAM_SHARE_OF_BOX = 0.8
const ROWS_BETWEEN_THICK_LINES = 3
const HEADING_ROWS = 2

const COLUMN = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7 } as const

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const round = (value: number) => Math.round(value * 1000) / 1000

export interface RenderOptions {
  readonly boxMillimetres?: number
  // Side by side, with the rows running on from the bottom of one part to the top of the next.
  readonly parts?: number
  readonly pixelsPerMillimetre?: number
}

export function renderDescriptionSheet(
  sheet: DescriptionSheet,
  { boxMillimetres = DEFAULT_BOX_MILLIMETRES, parts = 1, pixelsPerMillimetre }: RenderOptions = {},
): RenderedSheet {
  const box = boxMillimetres
  const partWidth = COLUMNS * box
  const descriptionRows = 1 + sheet.controls.length
  const finishRow = HEADING_ROWS + descriptionRows
  const rows = finishRow + 1
  const rowsPerPart = Math.ceil(rows / parts)
  const usedParts = Math.ceil(rows / rowsPerPart)
  const width = usedParts * partWidth
  const height = rowsPerPart * box
  const elements: string[] = []

  const partOf = (row: number) => Math.floor(row / rowsPerPart)
  const xIn = (row: number, x: number) => partOf(row) * partWidth + x
  const yOf = (row: number) => (row % rowsPerPart) * box

  const text = (
    content: string,
    centreX: number,
    row: number,
    { size = 0.55, bold = false }: { size?: number; bold?: boolean } = {},
  ) =>
    elements.push(
      `<text x="${round(xIn(row, centreX))}" y="${round(yOf(row) + 0.5 * box)}" font-size="${round(size * box)}"` +
        ` text-anchor="middle" dominant-baseline="central" stroke="none"${bold ? ' font-weight="bold"' : ''}>` +
        `${escapeXml(content)}</text>`,
    )
  // The line above `row`; a part's own outline is drawn above its first row.
  const hLine = (row: number, thickness: number) => {
    if (row % rowsPerPart === 0) return
    elements.push(
      `<line x1="${round(xIn(row, 0))}" y1="${round(yOf(row))}" x2="${round(xIn(row, partWidth))}" y2="${round(yOf(row))}" stroke-width="${thickness}"/>`,
    )
  }
  const vLine = (column: number, fromRow: number, toRow: number) => {
    for (let row = fromRow; row < toRow; row++) {
      elements.push(
        `<line x1="${round(xIn(row, column * box))}" y1="${round(yOf(row))}" x2="${round(xIn(row, column * box))}" y2="${round(yOf(row) + box)}" stroke-width="${THIN_LINE}"/>`,
      )
    }
  }
  const pictogram = (
    markup: string,
    column: number,
    row: number,
    direction: CompassPoint | null = null,
  ) => {
    const scale = (box * PICTOGRAM_SHARE_OF_BOX) / 100
    const inset = (box * (1 - PICTOGRAM_SHARE_OF_BOX)) / 2
    const rotation = direction
      ? ` transform="rotate(${compassClockwiseDegrees(direction)} 50 50)"`
      : ''
    elements.push(
      `<g transform="translate(${round(xIn(row, column * box + inset))} ${round(yOf(row) + inset)}) scale(${round(scale)})"` +
        ` stroke-width="${PICTOGRAM_STROKE}"><g${rotation}>${markup}</g></g>`,
    )
  }

  const describe = (description: ControlDescription | null, row: number) => {
    if (!description) {
      text('?', (COLUMN.D + 0.5) * box, row)
      return
    }
    if (description.whichOfSimilar) {
      pictogram(DIRECTION_ARROW, COLUMN.C, row, description.whichOfSimilar)
    }
    pictogram(FEATURE_PICTOGRAMS[description.feature], COLUMN.D, row)
    if (description.appearance) {
      pictogram(APPEARANCE_PICTOGRAMS[description.appearance], COLUMN.E, row)
    }
    if (description.location) {
      const { kind, direction } = description.location
      pictogram(LOCATION_PICTOGRAMS[kind], COLUMN.G, row, direction)
    }
  }

  text(sheet.title, partWidth / 2, 0, { bold: true })
  text(sheet.courseName, 1.5 * box, 1, { bold: true })
  text(
    sheet.lengthKilometers === null ? '– km' : `${sheet.lengthKilometers.toFixed(1)} km`,
    4.5 * box,
    1,
  )
  text(sheet.climbMeters === null ? '– m' : `${sheet.climbMeters} m`, 7 * box, 1)

  const startRow = HEADING_ROWS
  pictogram(START_TRIANGLE, COLUMN.A, startRow)
  describe(sheet.start, startRow)

  sheet.controls.forEach((control, i) => {
    const row = startRow + 1 + i
    text(String(control.number), (COLUMN.A + 0.5) * box, row, { bold: true })
    text(String(control.code), (COLUMN.B + 0.5) * box, row, { size: 0.45 })
    describe(control.description, row)
  })

  elements.push(
    `<g transform="translate(${round(xIn(finishRow, 0))} ${round(yOf(finishRow) - finishRow * box)})">` +
      finishSymbol(sheet.finish, finishRow, box, partWidth) +
      `</g>`,
  )

  for (let row = 1; row <= finishRow; row++) {
    const controlRowsAbove = row - startRow - 1
    const isThick =
      row === HEADING_ROWS ||
      row === finishRow ||
      (controlRowsAbove > 0 && controlRowsAbove % ROWS_BETWEEN_THICK_LINES === 0)
    hLine(row, isThick ? THICK_LINE : THIN_LINE)
  }
  vLine(3, 1, HEADING_ROWS)
  vLine(6, 1, HEADING_ROWS)
  for (let column = 1; column < COLUMNS; column++) vLine(column, HEADING_ROWS, finishRow)

  const partRect = (part: number, paint: string) =>
    `<rect x="${round(part * partWidth)}" y="0" width="${round(partWidth)}"` +
    ` height="${round(Math.min(rowsPerPart, rows - part * rowsPerPart) * box)}" ${paint}/>`
  const partIndices = Array.from({ length: usedParts }, (_, part) => part)
  const size = pixelsPerMillimetre
    ? `width="${round(width * pixelsPerMillimetre)}" height="${round(height * pixelsPerMillimetre)}"`
    : `width="${round(width)}mm" height="${round(height)}mm"`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ${size}` +
    ` viewBox="0 0 ${round(width)} ${round(height)}" color="black" fill="black" stroke="currentColor"` +
    ` stroke-linecap="round" stroke-linejoin="round" font-family="Arial, Helvetica, sans-serif">` +
    partIndices.map(part => partRect(part, 'fill="white" stroke="none"')).join('') +
    elements.join('') +
    partIndices.map(part => partRect(part, `fill="none" stroke-width="${THICK_LINE}"`)).join('') +
    `</svg>`
  return { svg, widthMillimetres: width, heightMillimetres: height }
}

function finishSymbol(
  finish: DescriptionSheet['finish'],
  row: number,
  box: number,
  width: number,
): string {
  const y = round((row + 0.5) * box)
  const r = round(box * 0.28)
  const left = round(box * 0.8)
  const right = round(width - box * 0.8)
  const label = `${finish.distanceMeters} m`
  const labelHalfWidth = box * 1.1
  const centre = width / 2
  const dashed = (x1: number, x2: number) =>
    `<line x1="${round(x1)}" y1="${y}" x2="${round(x2)}" y2="${y}" stroke-width="${THIN_LINE * 1.5}" stroke-dasharray="${round(box * 0.4)} ${round(box * 0.2)}"/>`
  const arrowHead = (x: number) =>
    `<path d="M${round(x - box * 0.3)} ${round(y - box * 0.22)} L${round(x)} ${y} L${round(x - box * 0.3)} ${round(y + box * 0.22)}" fill="none" stroke-width="${THIN_LINE * 1.5}"/>`
  const finishCircles =
    `<circle cx="${right}" cy="${y}" r="${r}" fill="none" stroke-width="${THIN_LINE * 1.5}"/>` +
    `<circle cx="${right}" cy="${y}" r="${round(r * 0.65)}" fill="none" stroke-width="${THIN_LINE * 1.5}"/>`
  const startCircle = `<circle cx="${left}" cy="${y}" r="${r}" fill="none" stroke-width="${THIN_LINE * 1.5}"/>`
  const labelText = `<text x="${round(centre)}" y="${y}" font-size="${round(box * 0.5)}" text-anchor="middle" dominant-baseline="central" stroke="none">${label}</text>`
  const beforeFinish = right - r - box * 0.1

  switch (finish.route) {
    case 'tapedAllTheWay':
      return (
        startCircle +
        dashed(left + r, centre - labelHalfWidth) +
        labelText +
        dashed(centre + labelHalfWidth, beforeFinish) +
        arrowHead(beforeFinish) +
        finishCircles
      )
    case 'tapedFromFunnel': {
      const funnelX = left + r + box * 0.6
      return (
        startCircle +
        `<path d="M${round(funnelX - box * 0.3)} ${round(y - box * 0.25)} L${round(funnelX)} ${y} L${round(funnelX - box * 0.3)} ${round(y + box * 0.25)}" fill="none" stroke-width="${THIN_LINE * 1.5}"/>` +
        dashed(funnelX, centre - labelHalfWidth) +
        labelText +
        dashed(centre + labelHalfWidth, beforeFinish) +
        arrowHead(beforeFinish) +
        finishCircles
      )
    }
    case 'notTaped': {
      const openStart = `<path d="M${round(left + box * 0.6)} ${round(y - box * 0.25)} L${round(left + box * 0.25)} ${y} L${round(left + box * 0.6)} ${round(y + box * 0.25)}" fill="none" stroke-width="${THIN_LINE * 1.5}"/>`
      return startCircle + openStart + labelText + arrowHead(beforeFinish) + finishCircles
    }
  }
}
