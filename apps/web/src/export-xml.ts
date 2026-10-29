import type { MapInfo } from '@ratamestari/core'
import type { Course } from '@ratamestari/engine'
import { courseDataXml, type DescriptionSheet } from '@ratamestari/iof'
import type { CourseRequest } from '@ratamestari/rules'
import { courseNameOf } from './course-labels'
import type { Messages } from './i18n'
import { saveFile } from './save-file'

export function downloadCourseXml(
  course: Course,
  sheet: DescriptionSheet,
  request: CourseRequest,
  map: MapInfo,
  labels: Messages['labels'],
) {
  const xml = courseDataXml({
    eventName: `${request.purpose === 'training' ? labels.trainingCourse : labels.eventLevels[request.eventLevel]}, ${labels.formats[request.format]}`,
    className: courseNameOf(request, labels.trainingCourse),
    course,
    sheet,
    map,
    createdAt: new Date(),
  })
  saveFile(
    new Blob([xml], { type: 'application/xml' }),
    `${sheet.courseName}-${request.format}.xml`,
  )
}
