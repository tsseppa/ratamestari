import { createContext, useContext, useMemo } from 'react'
import { en } from './en'
import { fi } from './fi'

export type { FindingLimits, FindingText, StopName } from './en'
export type Messages = typeof en

export interface Language {
  readonly locale: string
  readonly messages: Messages
}

export const ENGLISH: Language = { locale: 'en', messages: en }
export const FINNISH: Language = { locale: 'fi', messages: fi }

export const LANGUAGES = { en: ENGLISH, fi: FINNISH } as const
export type LanguageCode = keyof typeof LANGUAGES

const LanguageContext = createContext<Language>(ENGLISH)
export const LanguageProvider = LanguageContext.Provider

export const useMessages = (): Messages => useContext(LanguageContext).messages

export function useFormat(): Format {
  const language = useContext(LanguageContext)
  return useMemo(() => formatFor(language), [language])
}

export interface Format {
  readonly kilometres: (meters: number) => string
  readonly metres: (meters: number) => string
  readonly distance: (meters: number) => string
  readonly share: (fraction: number) => string
  readonly bearing: (degrees: number) => string
  readonly scale: (denominator: number) => string
  readonly duration: (seconds: number) => string
  readonly timeDifference: (seconds: number) => string
  // The unit written after a number typed into a field, with its space.
  readonly minutesSuffix: string
  readonly metresSuffix: string
}

const SECONDS_PER_MINUTE = 60
const METRES_SHOWN_UP_TO = 1000
const NARROW_NO_BREAK_SPACE = '\u202f'

export function formatFor({ locale, messages }: Language): Format {
  const kilometres = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'kilometer',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const metres = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'meter',
    maximumFractionDigits: 0,
  })
  const share = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  const wholeNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const degrees = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'degree',
    unitDisplay: 'narrow',
    maximumFractionDigits: 0,
  })
  const duration = (seconds: number) => {
    const total = Math.round(seconds)
    const minutes = Math.floor(total / SECONDS_PER_MINUTE)
    return `${wholeNumber.format(minutes)}:${String(total % SECONDS_PER_MINUTE).padStart(2, '0')}`
  }
  const unitSuffix = (unit: string) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' })
      .formatToParts(1)
      .filter(part => part.type === 'literal' || part.type === 'unit')
      .map(part => part.value)
      .join('')
  const formatKilometres = (meters: number) => kilometres.format(meters / 1000)
  const formatMetres = (meters: number) => metres.format(meters)
  return {
    kilometres: formatKilometres,
    metres: formatMetres,
    distance: meters =>
      meters < METRES_SHOWN_UP_TO ? formatMetres(meters) : formatKilometres(meters),
    share: fraction => share.format(fraction),
    bearing: value => degrees.format(value),
    // Map scales keep the ISOM style "1:15 000" whatever the language's thousands separator.
    scale: denominator =>
      `1:${String(Math.round(denominator)).replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NO_BREAK_SPACE)}`,
    duration,
    timeDifference: seconds =>
      Math.round(seconds) < SECONDS_PER_MINUTE
        ? messages.units.seconds(wholeNumber.format(Math.round(seconds)))
        : duration(seconds),
    minutesSuffix: unitSuffix('minute'),
    metresSuffix: unitSuffix('meter'),
  }
}
