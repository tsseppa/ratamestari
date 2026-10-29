import { describe, expect, it } from 'vitest'
import type { MapFeature } from '@ratamestari/core'
import { TRAINING_DEFAULTS } from '@ratamestari/rules'
import { contourDetailQuality } from '../src/contour-detail'
import { buildTerrain } from '../src/terrain'
import { controlSite, feature, line, SQUARE_KILOMETRE } from './fixtures'

const rule = TRAINING_DEFAULTS.contour.controlPicking.contourDetail

const terrainOf = (features: MapFeature[]) =>
  buildTerrain(features, SQUARE_KILOMETRE, { restrictToMappedArea: false })

const zigzagContour = (isomCode: string, startX: number, y: number) =>
  feature(
    isomCode,
    line(
      ...Array.from({ length: 11 }, (_, i): [number, number] => [
        startX + i * 20,
        y + (i % 2) * 20,
      ]),
    ),
  )

const straightContour = (startX: number, y: number) =>
  feature('101', line([startX, y], [startX + 200, y]))

const arc = (
  centreX: number,
  centreY: number,
  radius: number,
  fromDegrees: number,
  toDegrees: number,
) =>
  line(
    ...Array.from({ length: 31 }, (_, i): [number, number] => {
      const angle = ((fromDegrees + ((toDegrees - fromDegrees) * i) / 30) * Math.PI) / 180
      return [centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)]
    }),
  )

describe('contourDetailQuality', () => {
  it('rates a site among bending contours above one among straight parallel contours', () => {
    const terrain = terrainOf([
      ...[100, 160, 220].map(y => zigzagContour('101', 100, y)),
      ...[100, 160, 220].map(y => straightContour(600, y)),
    ])
    const [bendy, straight] = contourDetailQuality(
      [controlSite(200, 170), controlSite(700, 170)],
      terrain,
      rule,
    )
    expect(bendy).toBeGreaterThan(0.5)
    expect(straight).toBe(0)
  })

  it('counts index contours and form lines as relief detail', () => {
    const sites = [controlSite(200, 110), controlSite(700, 110)]
    for (const code of ['102', '103']) {
      const terrain = terrainOf([zigzagContour(code, 100, 100), zigzagContour(code, 600, 100)])
      const quality = contourDetailQuality(sites, terrain, rule)
      expect(quality[0], code).toBeGreaterThan(0)
      expect(quality[1], code).toBeGreaterThan(0)
    }
  })

  it('ignores lines that are not relief', () => {
    const terrain = terrainOf([zigzagContour('505', 100, 100)])
    expect(contourDetailQuality([controlSite(200, 110)], terrain, rule)[0]).toBe(0)
  })

  it('adds nothing for turns gentler than the noise limit', () => {
    const terrain = terrainOf([
      feature('101', arc(300, 300, 400, 200, 250)),
      feature('101', line([700, 700], [800, 700], [800, 800])),
    ])
    const [gentle, sharp] = contourDetailQuality(
      [
        controlSite(
          300 + 400 * Math.cos((225 * Math.PI) / 180),
          300 + 400 * Math.sin((225 * Math.PI) / 180),
        ),
        controlSite(800, 700),
      ],
      terrain,
      rule,
    )
    expect(gentle).toBe(0)
    expect(sharp).toBeGreaterThan(0)
  })

  it('scores a sharp corner only when its turn exceeds the noise limit', () => {
    const corner = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180
      return terrainOf([
        feature(
          '101',
          line(
            [400, 500],
            [500, 500],
            [500 + 100 * Math.cos(radians), 500 + 100 * Math.sin(radians)],
          ),
        ),
      ])
    }
    const site = [controlSite(500, 500)]
    expect(contourDetailQuality(site, corner(rule.minBendDegrees / 2), rule)[0]).toBe(0)
    expect(contourDetailQuality(site, corner(rule.minBendDegrees * 2), rule)[0]).toBeGreaterThan(0)
  })

  it('scales scores to between 0 and 1', () => {
    const terrain = terrainOf([
      ...[100, 140, 180, 220].map(y => zigzagContour('101', 100, y)),
      zigzagContour('103', 600, 600),
    ])
    const sites = [controlSite(200, 160), controlSite(700, 610), controlSite(900, 100)]
    const quality = contourDetailQuality(sites, terrain, rule)
    for (const score of quality) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
    expect(quality[0]).toBe(1)
  })

  it('scores nothing on a map without relief lines', () => {
    const quality = contourDetailQuality([controlSite(500, 500)], terrainOf([]), rule)
    expect(quality[0]).toBe(0)
  })
})
