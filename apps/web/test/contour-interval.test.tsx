import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { contourIntervalFrom, printedContourInterval } from '../src/contour-interval'
import { ENGLISH } from '../src/i18n'
import { ContourIntervalLine } from '../src/WorkspaceStart'

const m = ENGLISH.messages.workspace
const ignore = () => {}

const render = (meters: number, readFromMap: number | null, isSetByUser: boolean) =>
  renderToStaticMarkup(
    <ContourIntervalLine interval={{ meters, readFromMap, isSetByUser }} onChange={ignore} />,
  )

describe('contourIntervalFrom', () => {
  it('reads a positive interval in metres, decimals included', () => {
    expect(contourIntervalFrom('2.5')).toBe(2.5)
    expect(contourIntervalFrom('5')).toBe(5)
  })

  it('reads nothing from an empty, zero or non-numeric field', () => {
    for (const typed of ['', ' ', '0', '-2', 'abc']) expect(contourIntervalFrom(typed)).toBeNull()
  })
})

describe('printedContourInterval', () => {
  it("prints the user's own interval when they have set one", () => {
    expect(printedContourInterval({ meters: 2, readFromMap: 5, isSetByUser: true })).toBe(2)
    expect(printedContourInterval({ meters: 2, readFromMap: null, isSetByUser: true })).toBe(2)
  })

  it('prints the interval read from the map otherwise', () => {
    expect(printedContourInterval({ meters: 2.5, readFromMap: 2.5, isSetByUser: false })).toBe(2.5)
  })

  it('prints nothing when the map does not say, rather than the standard fallback', () => {
    expect(printedContourInterval({ meters: 5, readFromMap: null, isSetByUser: false })).toBeNull()
  })
})

describe('ContourIntervalLine', () => {
  it('shows the interval as text with Change, and keeps where it came from behind the help', () => {
    const fromMap = render(2.5, 2.5, false)
    expect(fromMap).toMatch(/>2\.5\sm</)
    expect(fromMap).not.toContain('<input')
    expect(fromMap).toContain(`>${m.changeContourInterval}</button>`)
    expect(fromMap).toContain(`aria-label="${m.contourIntervalInfo}"`)
    expect(fromMap).toContain(`aria-expanded="false"`)
    expect(fromMap).toContain(`title="${m.contourIntervalFromMap}"`)
    expect(render(5, null, false)).toContain(`title="${m.contourIntervalStandard('5 m')}"`)
    expect(render(2, 5, true)).toContain(`title="${m.contourIntervalSetByYou}"`)
  })

  it("offers the map's own interval back only after the user has set one", () => {
    expect(render(2.5, 2.5, false)).not.toContain(m.contourIntervalReset)
    expect(render(2, 5, true)).toContain(m.contourIntervalReset)
  })
})
