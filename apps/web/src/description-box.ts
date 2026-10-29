import { localExtent, type LocalExtent, type MapInfo } from '@ratamestari/core'
import { placeDescriptionBox, type Course } from '@ratamestari/engine'
import { descriptionSheet, renderDescriptionSheet, type DescriptionSheet } from '@ratamestari/iof'
import type { CourseRequest } from '@ratamestari/rules'
import { courseNameOf } from './course-labels'
import type { Messages } from './i18n'

export interface DescriptionBox {
  readonly sheet: DescriptionSheet
  readonly url: string
  readonly extent: LocalExtent
}

const DISPLAY_PIXELS_PER_MILLIMETRE = 12
const MARGIN_MILLIMETRES = 5

const paperMillimetresToMeters = (millimetres: number, scale: number) =>
  (millimetres * scale) / 1000

export function descriptionBoxFor(
  course: Course,
  request: CourseRequest,
  map: MapInfo,
  labels: Messages['labels'],
): DescriptionBox {
  const sheet = descriptionSheet(course, {
    title: labels.formats[request.format],
    courseName: courseNameOf(request, labels.trainingCourse),
  })
  const rendered = renderDescriptionSheet(sheet, {
    pixelsPerMillimetre: DISPLAY_PIXELS_PER_MILLIMETRE,
  })
  const printScale = course.printArea?.scale ?? map.scale
  const width = paperMillimetresToMeters(rendered.widthMillimetres, printScale)
  const height = paperMillimetresToMeters(rendered.heightMillimetres, printScale)
  const extent = course.printArea
    ? placeDescriptionBox(course.printArea, width, height)
    : besideMap(map, width, height)
  return {
    sheet,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`,
    extent,
  }
}

function besideMap(map: MapInfo, width: number, height: number): LocalExtent {
  const [minX, , , maxY] = map.extent
  const margin = paperMillimetresToMeters(MARGIN_MILLIMETRES, map.scale)
  return localExtent(minX + margin, maxY - margin - height, minX + margin + width, maxY - margin)
}
