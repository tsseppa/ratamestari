import { useExperimentalFeatures } from './experimental'
import { useState } from 'react'
import { contourIntervalFrom } from './contour-interval'
import type { ContourInterval } from './engine.worker'
import { useFormat, useMessages } from './i18n'

export type MapOpening =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly fileName: string }
  | { readonly status: 'error'; readonly message: string }

interface MapStartProps {
  opening: MapOpening
  isDraggingOver: boolean
  onChooseFile: () => void
}

export function MapStart({ opening, isDraggingOver, onChooseFile }: MapStartProps) {
  const m = useMessages().workspace
  const isExperimental = useExperimentalFeatures()
  return (
    <div className={isDraggingOver ? 'map-start is-dragging-over' : 'map-start'}>
      <div className="map-start-content">
        <svg
          width="72"
          height="72"
          viewBox="0 0 72 72"
          aria-hidden="true"
          className="map-start-mark"
        >
          <polygon points="36,8 64,58 8,58" />
        </svg>
        {opening.status === 'loading' ? (
          <>
            <h2>{m.opening(opening.fileName)}</h2>
            <p>{m.openingHint}</p>
          </>
        ) : (
          <>
            <h2>{isDraggingOver ? m.dropToOpen : m.openMap}</h2>
            <p>{isExperimental ? m.openMapHintWithPdf : m.openMapHint}</p>
            <button type="button" className="map-start-choose" onClick={onChooseFile}>
              {m.chooseFile}
            </button>
            {opening.status === 'error' && (
              <p className="error" role="alert">
                {m.openFailed(opening.message)}
              </p>
            )}
          </>
        )}
        <p className="map-start-privacy">{m.privacy}</p>
      </div>
    </div>
  )
}

interface PanelHeaderProps {
  onOpenSettings: () => void
}

export function PanelHeader({ onOpenSettings }: PanelHeaderProps) {
  const m = useMessages().workspace
  return (
    <div className="panel-header">
      <h1>
        <a href="../" className="panel-wordmark">
          <svg width="20" height="20" viewBox="0 0 26 26" aria-hidden="true">
            <circle cx="13" cy="13" r="10" fill="none" stroke="currentColor" strokeWidth="2.8" />
            <circle cx="13" cy="13" r="2.4" fill="currentColor" />
          </svg>
          Ratamestari
        </a>
      </h1>
      <button
        type="button"
        className="panel-settings"
        aria-label={m.settings}
        onClick={onOpenSettings}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </svg>
      </button>
    </div>
  )
}

interface PanelLineProps {
  label: string
  value: string
  isPending?: boolean
  action?: { readonly label: string; readonly onClick: () => void } | undefined
}

export function PanelLine({ label, value, isPending = false, action }: PanelLineProps) {
  return (
    <div className={isPending ? 'panel-line is-pending' : 'panel-line'}>
      <span className="panel-line-label">{label}</span>
      <span className="panel-line-value">
        <span>{value}</span>
        {action && (
          <button type="button" className="panel-line-action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </span>
    </div>
  )
}

interface ContourIntervalLineProps {
  readonly interval: ContourInterval
  readonly onChange: (meters: number | null) => void
}

// Changed on leaving the field, as the course on the map is checked again with every change.
export function ContourIntervalLine({ interval, onChange }: ContourIntervalLineProps) {
  const m = useMessages().workspace
  const format = useFormat()
  const [typed, setTyped] = useState<string | null>(null)
  const commit = () => {
    const meters = typed === null ? null : contourIntervalFrom(typed)
    setTyped(null)
    if (meters !== null && meters !== interval.meters) onChange(meters)
  }
  const source = interval.isSetByUser
    ? m.contourIntervalSetByYou
    : interval.readFromMap === null
      ? m.contourIntervalStandard(format.contourInterval(interval.meters))
      : m.contourIntervalFromMap
  return (
    <div className="panel-line">
      <span className="panel-line-label">{m.contourIntervalLine}</span>
      <span className="panel-line-value">
        {typed === null ? (
          <span>{format.contourInterval(interval.meters)}</span>
        ) : (
          <span>
            <input
              className="request-token"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              aria-label={m.contourIntervalLine}
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setTyped(null)
              }}
            />
            {format.metresSuffix}
          </span>
        )}
        <span className="panel-line-actions">
          {typed === null && (
            <button
              type="button"
              className="panel-line-action"
              onClick={() => setTyped(String(interval.meters))}
            >
              {m.changeContourInterval}
            </button>
          )}
          {interval.isSetByUser && typed === null && (
            <button type="button" className="panel-line-action" onClick={() => onChange(null)}>
              {m.contourIntervalReset}
            </button>
          )}
          <InfoToggle glyph={m.infoGlyph} label={m.contourIntervalInfo} text={source} />
        </span>
      </span>
    </div>
  )
}

// Touch screens have no hover, so a tap keeps the text open as well.
function InfoToggle({ glyph, label, text }: { glyph: string; label: string; text: string }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <span className="info-toggle">
      <button
        type="button"
        className="info-toggle-button"
        aria-label={label}
        aria-expanded={isOpen}
        title={text}
        onClick={() => setIsOpen(open => !open)}
      >
        {glyph}
      </button>
      {isOpen && (
        <span className="info-toggle-text" role="note">
          {text}
        </span>
      )}
    </span>
  )
}
