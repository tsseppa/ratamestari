import { describe, expect, it } from 'vitest'
import { TRAINING_DEFAULTS } from '@ratamestari/rules'
import { siteAreaQuality, siteAreaQualityOf, siteQuality } from '../src/site-quality'
import { contourDetailQuality } from '../src/contour-detail'
import { buildTerrain } from '../src/terrain'
import { controlSite, feature, line, SQUARE_KILOMETRE } from './fixtures'

const site = controlSite

const cluster = (cx: number, cy: number, count: number, overrides = {}) =>
  Array.from({ length: count }, (_, i) =>
    site(cx + (i % 5) * 20, cy + Math.floor(i / 5) * 20, overrides),
  )

describe('siteAreaQuality', () => {
  it('rates sites in dense technical terrain above lone sites', () => {
    const sites = [...cluster(100, 100, 20), site(1000, 1000)]
    const quality = siteAreaQuality(sites)
    expect(quality[0]).toBeGreaterThan(quality[20]! * 5)
  })

  it('values demanding sites more than easy ones', () => {
    const demanding = cluster(100, 100, 15)
    const easy = cluster(1000, 1000, 15, { technicalDifficulty: 1 })
    const quality = siteAreaQuality([...demanding, ...easy])
    expect(quality[0]).toBeGreaterThan(quality[15]!)
  })

  it('values contour detail', () => {
    const boulders = cluster(100, 100, 15)
    const knolls = cluster(1000, 1000, 15, { placement: 'contourKnoll', contourForm: 'knoll' })
    const quality = siteAreaQuality([...boulders, ...knolls])
    expect(quality[15]).toBeGreaterThan(quality[0]!)
  })

  it('halves the value of sites in slow terrain', () => {
    const sites = [...cluster(100, 100, 15), ...cluster(1000, 1000, 15, { inSlowTerrain: true })]
    const quality = siteAreaQuality(sites)
    expect(quality[15]).toBeCloseTo(quality[0]! / 2, 1)
  })

  it('scales to between 0 and 1', () => {
    const quality = siteAreaQuality([...cluster(100, 100, 20), ...cluster(900, 900, 8)])
    expect(Math.max(...quality)).toBeLessThanOrEqual(1)
    expect(Math.min(...quality)).toBeGreaterThan(0)
  })

  it('looks quality up by site even when ids are not positions in the list', () => {
    const filtered = [...cluster(100, 100, 20), site(1000, 1000)].map((s, i) => ({
      ...s,
      id: 500 + i * 7,
    }))
    const qualityOf = siteAreaQualityOf(filtered)
    const byPosition = siteAreaQuality(filtered)
    expect(qualityOf(filtered[0]!)).toBe(byPosition[0])
    expect(qualityOf(filtered[20]!)).toBe(byPosition[20])
    expect(Number.isNaN(qualityOf(filtered[20]!))).toBe(false)
  })
})

describe('siteQuality', () => {
  const zigzag = Array.from({ length: 21 }, (_, i): [number, number] => [
    100 + i * 20,
    i % 2 ? 120 : 100,
  ])
  const terrain = buildTerrain([feature('101', line(...zigzag))], SQUARE_KILOMETRE, {
    restrictToMappedArea: false,
  })
  const sites = [...cluster(100, 100, 20), site(900, 900)]

  it('measures contour detail on contour training', () => {
    const training = TRAINING_DEFAULTS.contour.middle
    expect(siteQuality(sites, terrain, training)).toEqual(
      contourDetailQuality(sites, terrain, training.contourDetail),
    )
  })

  it('measures site density without training rules', () => {
    expect(siteQuality(sites, terrain, null)).toEqual(siteAreaQuality(sites))
    expect(siteQuality(sites, terrain, undefined)).toEqual(siteAreaQuality(sites))
  })
})
