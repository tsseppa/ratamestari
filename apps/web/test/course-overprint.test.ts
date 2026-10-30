import { describe, expect, it } from 'vitest'
import MultiLineString from 'ol/geom/MultiLineString'
import Point from 'ol/geom/Point'
import { localPoint } from '@ratamestari/core'
import { layOutOverprint, type Course, type OverprintLayout } from '@ratamestari/engine'
import {
  courseOverprintFeatures,
  courseHitOf,
  courseOverprintStyle,
  legOfFeature,
} from '../src/course-overprint'

const course = {
  start: { position: localPoint(0, 0) },
  controls: [{ position: localPoint(1000, 0) }],
  finish: localPoint(1000, 1000),
} as unknown as Course

const features = courseOverprintFeatures(course, layOutOverprint(course))
const legLine = (leg: number) =>
  features.find(
    feature => feature.getGeometry() instanceof MultiLineString && legOfFeature(feature) === leg,
  )!
const controlCircle = features.find(
  feature =>
    !(feature.getGeometry() instanceof MultiLineString) &&
    legOfFeature(feature) === 0 &&
    feature.get('stopIndex') === 1,
)!

describe('drawing a course leg by leg', () => {
  const halfway = courseOverprintStyle(null, 0.5)

  it('draws only the share of the leg reached so far', () => {
    const style = halfway(legLine(0), 1)!
    const [, end = []] = (style.getGeometry() as MultiLineString).getCoordinates().at(-1)!
    const [, fullEnd = []] = (legLine(0).getGeometry() as MultiLineString).getCoordinates().at(-1)!
    expect(end[0]).toBeLessThan(fullEnd[0]!)
  })

  it('hides the legs and controls not reached yet', () => {
    expect(halfway(legLine(1), 1)).toBeUndefined()
    expect(halfway(controlCircle, 1)).toBeUndefined()
  })

  it('shows everything once the course is drawn', () => {
    const whole = courseOverprintStyle(null)
    expect(whole(legLine(1), 1)).toBeDefined()
    expect(whole(controlCircle, 1)).toBeDefined()
  })
})

describe('what a tap on the course hits', () => {
  const finishCircles = features.filter(feature => feature.get('stopIndex') === 2)

  it('prefers a control over the leg line next to it', () => {
    expect(courseHitOf([legLine(0), controlCircle])).toEqual({ kind: 'stop', stop: 1 })
    expect(courseHitOf([legLine(1)])).toEqual({ kind: 'leg', leg: 1 })
    expect(courseHitOf([])).toBeNull()
  })

  it('lets the finish be dragged like the start and the controls', () => {
    expect(finishCircles).toHaveLength(1)
  })

  it('draws the selected stop thicker', () => {
    const plain = courseOverprintStyle(null)(controlCircle, 1)!
    const selected = courseOverprintStyle(null, null, 1)(controlCircle, 1)!
    expect(selected.getStroke()!.getWidth()).toBeGreaterThan(plain.getStroke()!.getWidth()!)
  })
})

describe('drawing the overprint layout', () => {
  const plain = layOutOverprint(course)
  const layout: OverprintLayout = {
    numberCentres: [localPoint(1000, -80)],
    findings: [],
    circleCuts: [[{ from: 1, to: 1.5 }]],
    legPieces: [
      [
        [localPoint(60, 0), localPoint(400, 0)],
        [localPoint(450, 0), localPoint(940, 0)],
      ],
      plain.legPieces[1]!,
    ],
  }
  const laidOut = courseOverprintFeatures(course, layout)
  const leg = laidOut.find(
    f => f.getGeometry() instanceof MultiLineString && legOfFeature(f) === 0,
  )!

  it('puts the number where the layout says', () => {
    const number = laidOut.find(f => f.getGeometry() instanceof Point)!
    expect((number.getGeometry() as Point).getCoordinates()).toEqual([1000, -80])
  })

  it('draws a cut circle as the arcs between its cuts', () => {
    const circle = laidOut.find(f => f.get('stopIndex') === 1 && f.get('kind') === 'line')!
    const drawn = courseOverprintStyle(null)(circle, 1)!.getGeometry() as MultiLineString
    expect(drawn.getCoordinates()).toHaveLength(1)
  })

  it('draws a leg cut in two as two pieces, and reveals them in order', () => {
    expect((leg.getGeometry() as MultiLineString).getCoordinates()).toHaveLength(2)
    const early = courseOverprintStyle(null, 0.3)(leg, 1)!.getGeometry() as MultiLineString
    expect(early.getCoordinates()).toHaveLength(1)
  })
})
