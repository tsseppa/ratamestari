import { describe, expect, it } from 'vitest'
import { describeFinding } from '../src/rule-findings'

describe('describeFinding', () => {
  it('names the controls, start and finish involved and cites the rule', () => {
    expect(describeFinding({ kind: 'spacing', stops: [0, 3] }, 10)).toEqual({
      severity: 'error',
      text: 'The start and control 3 are too close together',
      basis: 'Lajisäännöt 2026 11.41',
      fixableControl: 3,
    })
  })

  it('describes legs by their ends', () => {
    expect(describeFinding({ kind: 'courseLinesOverDescriptions', stops: [10, 11] }, 10).text).toBe(
      'The line control 10–the finish runs under the description box',
    )
  })

  it('says when a check is our own rather than a rule', () => {
    expect(describeFinding({ kind: 'finalLegTooLong', stops: [10, 11] }, 10).basis).toBe(
      'our check',
    )
  })

  it('leaves a number over a circle to be moved rather than fixed', () => {
    expect(describeFinding({ kind: 'numberOverCircle', stops: [3, 4] }, 10)).toEqual({
      severity: 'error',
      text: 'The number of control 3 covers the circle of control 4',
      basis: 'ISOM 2017-2 sym. 704',
      fixableControl: null,
    })
    expect(describeFinding({ kind: 'numberOverCircle', stops: [3, 3] }, 10).text).toBe(
      'The number of control 3 covers its own circle',
    )
  })
})
