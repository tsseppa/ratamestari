import { describe, expect, it } from 'vitest'
import {
  CROWDING,
  FORMAT_QUALITY,
  FORMAT_TEMPLATES,
  SCORE_WEIGHTS,
  TRAINING_DEFAULTS,
  TRAINING_STYLES,
} from '@ratamestari/rules'
import { courseProfileOf, qualityProfileOf, templateOf } from '../src/course-profile'

describe('courseProfileOf', () => {
  it("gives a competition course its format's tables and no crossing legs", () => {
    for (const format of ['middle', 'long'] as const) {
      expect(courseProfileOf({ format })).toEqual({
        template: FORMAT_TEMPLATES[format],
        quality: FORMAT_QUALITY[format],
        weights: SCORE_WEIGHTS[format],
        crowding: CROWDING[format],
        allowsCrossingLegs: false,
      })
      expect(courseProfileOf({ format, training: null }).allowsCrossingLegs).toBe(false)
    }
  })

  it("gives a training course its style's profile, whatever the format", () => {
    for (const style of ['controlPicking', 'longLegs'] as const) {
      const spec = { format: 'long' as const, training: TRAINING_DEFAULTS.contour[style] }
      expect(courseProfileOf(spec)).toBe(TRAINING_STYLES[style])
      expect(templateOf(spec)).toBe(TRAINING_STYLES[style].template)
      expect(qualityProfileOf(spec)).toBe(TRAINING_STYLES[style].quality)
    }
  })

  it('reads the parts of a competition profile from the format tables', () => {
    expect(templateOf({ format: 'middle' })).toBe(FORMAT_TEMPLATES.middle)
    expect(qualityProfileOf({ format: 'middle' })).toBe(FORMAT_QUALITY.middle)
  })
})
