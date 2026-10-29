import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { contourIntervalFrom } from '../src/contour-interval'
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

describe('ContourIntervalLine', () => {
  it('shows the interval and says where it came from', () => {
    const fromMap = render(2.5, 2.5, false)
    expect(fromMap).toMatch(new RegExp(`aria-label="${m.contourIntervalLine}"[^>]*value="2.5"`))
    expect(fromMap).toContain(m.contourIntervalFromMap)
    expect(render(5, null, false)).toContain(m.contourIntervalStandard('5 m'))
    expect(render(2, 5, true)).toContain(m.contourIntervalSetByYou)
  })

  it("offers the map's own interval back only after the user has set one", () => {
    expect(render(2.5, 2.5, false)).not.toContain(m.contourIntervalReset)
    expect(render(2, 5, true)).toContain(m.contourIntervalReset)
  })
})
