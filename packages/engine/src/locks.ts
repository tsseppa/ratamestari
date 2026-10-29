import { ACUTE_ANGLE, SECTION_FILL } from '@ratamestari/rules'
import type { LocalPoint } from '@ratamestari/core'
import { FEATURELESS_SITE_ID, type ControlSiteCandidate } from './control-sites'
import { templateOf } from './course-profile'
import type { PlanningContext } from './course-search'
import type { Random } from './random'
import { angleAt, fillSection, type SectionFill } from './section-fill'

// Controls the user keeps when the course is set again (D15).
export interface CourseLocks {
  readonly start: ControlSiteCandidate | null
  // In course order.
  readonly controls: readonly ControlSiteCandidate[]
  // keptLegs[k] keeps the leg into controls[k] from the stop before it (the kept start, or kept
  // control k − 1) with no control between. The last entry keeps the leg into the finish.
  readonly keptLegs: readonly boolean[]
}

// The same locks as pool indices.
export interface LockedStops {
  readonly start: number | null
  readonly controls: readonly number[]
  readonly keptLegs: readonly boolean[]
}

export const hasLocks = (locks: CourseLocks | null | undefined): locks is CourseLocks =>
  !!locks && (locks.start !== null || locks.controls.length > 0)

export const isSameSite = (a: ControlSiteCandidate, b: ControlSiteCandidate) =>
  a.id === b.id &&
  (a.id !== FEATURELESS_SITE_ID ||
    (a.position[0] === b.position[0] && a.position[1] === b.position[1]))

// Kept sites the planner's pool left out (weak terrain, or placed by hand) are added to it.
export function withLockedSites(
  pool: readonly ControlSiteCandidate[],
  locks: CourseLocks,
): { pool: ControlSiteCandidate[]; locked: LockedStops } {
  const extended = [...pool]
  const indexOf = (site: ControlSiteCandidate) => {
    const found = extended.findIndex(other => isSameSite(other, site))
    if (found !== -1) return found
    extended.push(site)
    return extended.length - 1
  }
  return {
    pool: extended,
    locked: {
      start: locks.start && indexOf(locks.start),
      controls: locks.controls.map(indexOf),
      keptLegs: locks.keptLegs,
    },
  }
}

// Segment k runs from stop k to stop k + 1 of [start, ...kept controls, finish].
const isKeptSegment = (locked: LockedStops, k: number) =>
  Boolean(locked.keptLegs[k]) && (k > 0 || locked.start !== null)

// Whether a course keeps every kept control, in order, and nothing between the ends of a kept leg.
export function keepsLocks(locked: LockedStops, order: readonly number[]): boolean {
  const positions = locked.controls.map(control => order.indexOf(control))
  if (positions.some((position, k) => position < 0 || (k > 0 && position <= positions[k - 1]!)))
    return false
  return positions.concat(order.length).every((position, k) => {
    if (!isKeptSegment(locked, k)) return true
    return position === (k === 0 ? -1 : positions[k - 1]!) + 1
  })
}

// Sets the stretches between kept stops with the section fill. The time not taken by kept legs
// is shared by the stretches in proportion to their straight-line length. A free stretch into the
// finish ends at a control near it, so the final leg stays short.
export function fillAroundLocks(
  context: PlanningContext,
  locked: LockedStops,
  startIndex: number,
  finalLegMaxSeconds: number,
  random: Random,
): number[] {
  const { pool, finish, targetSeconds } = context
  const positionOf = (i: number) => pool[i]!.position
  const stops: (number | 'finish')[] = [startIndex, ...locked.controls, 'finish']
  const stopAt = (k: number): LocalPoint => {
    const stop = stops[k]!
    return stop === 'finish' ? finish : positionOf(stop)
  }
  const segments = stops.slice(1).map((_, k) => k)
  // At running pace on flat ground: the straight line may cross impassable terrain.
  const flatSeconds = (a: LocalPoint, b: LocalPoint) =>
    (Math.hypot(b[0] - a[0], b[1] - a[1]) * context.paceSecondsPerKm) / 1000
  const straight = (k: number) => flatSeconds(stopAt(k), stopAt(k + 1))
  const actual = (k: number) => {
    const [from, to] = [stops[k] as number, stops[k + 1]!]
    return to === 'finish' ? context.toFinish[from]! : context.legSeconds(from, to)
  }
  const free = segments.filter(k => !isKeptSegment(locked, k))
  const kept = segments.filter(k => isKeptSegment(locked, k))
  const remaining = Math.max(0, targetSeconds - kept.reduce((sum, k) => sum + actual(k), 0))
  const freeStraight = free.reduce((sum, k) => sum + straight(k), 0)
  const budgetOf = (k: number) =>
    freeStraight > 0 ? (remaining * straight(k)) / freeStraight : remaining / free.length

  const lockedPositions = [startIndex, ...locked.controls].map(positionOf)
  const keptLines = kept.map(k => [stopAt(k), stopAt(k + 1)] as const)
  const filledLines: (readonly [LocalPoint, LocalPoint])[] = []
  const used = new Set([startIndex, ...locked.controls])
  const order: number[] = []
  for (const k of segments) {
    if (k > 0) order.push(locked.controls[k - 1]!)
    if (isKeptSegment(locked, k)) continue
    const homes = stops[k + 1] === 'finish' ? homeControls(k) : []
    // Some controls near the finish leave no clean way in past the legs already set, so a few are
    // tried before settling for the stretch that came nearest its budget.
    let best: { controls: readonly number[]; fill: SectionFill } | null = null
    for (const home of homes.length > 0 ? homes : [null]) {
      const fill = fillStretch(k, home)
      if (!best || (best.fill.short && fill.estimatedSeconds > best.fill.estimatedSeconds)) {
        best = { controls: home === null ? fill.controls : [...fill.controls, home], fill }
      }
      if (!fill.short) break
    }
    const controls = best!.controls
    const filled = [stopAt(k), ...controls.map(positionOf), stopAt(k + 1)]
    filled.slice(1).forEach((stop, j) => filledLines.push([filled[j]!, stop]))
    for (const control of controls) {
      order.push(control)
      used.add(control)
    }
  }
  return order

  function fillStretch(k: number, home: number | null): SectionFill {
    const entry = stops[k] as number
    const exitPosition = home === null ? stopAt(k + 1) : positionOf(home)
    const budget = budgetOf(k) - (home === null ? 0 : context.toFinish[home]!)
    const reach = budget * (1 + SECTION_FILL.budgetTolerance)
    const allowed = pool.flatMap((site, i) =>
      !used.has(i) &&
      i !== home &&
      flatSeconds(stopAt(k), site.position) + flatSeconds(site.position, exitPosition) <= reach
        ? [i]
        : [],
    )
    return fillSection(
      context,
      {
        entry,
        exit: home ?? stops[k + 1]!,
        budgetSeconds: budget,
        allowed,
        legBandMetres: templateOf(context.spec).technicalLegMetres,
        fixedStops: [
          ...lockedPositions.filter((_, j) => j !== k),
          ...order.filter(i => i !== entry).map(positionOf),
        ],
        fixedLegs: [...keptLines, ...filledLines],
        usedSites: used,
        afterExit: home !== null ? finish : k + 2 < stops.length ? stopAt(k + 2) : null,
        beforeEntry:
          k === 0 ? null : positionOf(order.length >= 2 ? order[order.length - 2]! : startIndex),
      },
      random,
    )
  }

  // Free sites within the final leg's limit that the run-in can turn through without a sharp
  // angle, in random order so drafts differ; none when the entry is already that near.
  function homeControls(k: number): number[] {
    const entry = stops[k] as number
    if (context.toFinish[entry]! <= finalLegMaxSeconds) return []
    const from = stopAt(k)
    const candidates = pool.flatMap((site, i) =>
      !used.has(i) &&
      context.toFinish[i]! <= finalLegMaxSeconds &&
      Math.hypot(site.position[0] - finish[0], site.position[1] - finish[1]) >=
        HOME_MIN_METERS_FROM_FINISH &&
      angleAt(from, site.position, finish) >= HOME_MIN_TURN_DEGREES
        ? [i]
        : [],
    )
    const tried: number[] = []
    while (tried.length < HOMES_TRIED && candidates.length > 0) {
      const picked = random.pick(candidates)!
      tried.push(picked)
      candidates.splice(candidates.indexOf(picked), 1)
    }
    return tried
  }
}

const HOMES_TRIED = 4
const HOME_MIN_METERS_FROM_FINISH = 90
const HOME_MIN_TURN_DEGREES = 1.5 * ACUTE_ANGLE.noteBelowDegrees
