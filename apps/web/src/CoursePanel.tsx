import { describeFinding, OUR_CHECK, OUR_CHECK_NO_ROUTES, type Severity } from '@ratamestari/agent'
import { CONTROL_FEATURE_MATCH_METRES, type Course, type Finding } from '@ratamestari/engine'
import {
  ageClassSchema,
  coursePurposeSchema,
  eventLevelSchema,
  formatSchema,
  sexSchema,
  skillLetterSchema,
  trainingKindSchema,
  trainingStyleSchema,
  DEFAULT_TRAINING_STYLE,
  type CourseRequest,
  ACUTE_ANGLE,
} from '@ratamestari/rules'
import { useEffect, useState } from 'react'
import { offeredAgeClasses, withOfferedClass } from './class-choice'
import { useExperimentalFeatures } from './experimental'
import { useFormat, useMessages } from './i18n'
import { purposeOf, trainingMinutesFrom, trainingMinutesOf, withPurpose } from './purpose-choice'
import type { KeptCount } from './kept'
import { LockIcon } from './LegRoutesPanel'
import {
  CheckComparison,
  CheckHeader,
  DeducedClassView,
  SuggestionBar,
  type CourseFileCheck,
} from './CheckPanel'
import { ScoreBreakdown } from './ScoreBreakdown'
import { PanelLine } from './WorkspaceStart'
import type { SearchStatus } from './search-progress'

const FINDING_LIMITS = {
  sharpAngleDegrees: ACUTE_ANGLE.warningBelowDegrees,
  angleNoteDegrees: ACUTE_ANGLE.noteBelowDegrees,
  featureMatchMetres: CONTROL_FEATURE_MATCH_METRES,
}

interface Props {
  request: CourseRequest
  onRequestChange: (request: CourseRequest) => void
  isAssistantOn: boolean
  hasCentre: boolean
  isPickingCentre: boolean
  onMoveCentre: () => void
  canSetCourse: boolean
  search: SearchStatus | null
  onSetCourse: () => void
  onSetByHand: () => void
  onStop: () => void
  onTryAnother: () => void
  kept: KeptCount | null
  onForgetKept: () => void
  course: Course | null
  // Found on the laid-out overprint rather than by the course search.
  overprintFindings: readonly Finding[]
  isEditing: boolean
  isPreparingPdf: boolean
  onDownloadPdf: () => void
  onDownloadXml: () => void
  onFixControl: (controlNumber: number) => void
  check: CourseFileCheck | null
  onOpenCourseFile: () => void
  onSelectCheckedCourse: (index: number) => void
  onCloseCheck: () => void
  onDeduceClass: () => void
  suggestion: { readonly controlNumber: number; readonly isFound: boolean } | null
  onAcceptSuggestion: () => void
  onDismissSuggestion: () => void
}

export function CoursePanel(props: Props) {
  const { hasCentre, isPickingCentre, onMoveCentre, course, check } = props
  const m = useMessages()
  const isMeasured = course !== null && course.lengthMeters !== null
  const isTraining = purposeOf(props.request) === 'training'
  const offersTraining = useExperimentalFeatures()

  if (check) {
    return (
      <>
        <CheckHeader
          check={check}
          onSelect={props.onSelectCheckedCourse}
          onClose={props.onCloseCheck}
        />
        {check.status !== 'notOnMap' &&
          (check.deduced ? (
            <>
              <DeducedClassView deduced={check.deduced} classFromName={check.classFromName} />
              <details className="check-override">
                <summary>{m.check.checkAsOther}</summary>
                <RequestSentence
                  request={props.request}
                  onRequestChange={props.onRequestChange}
                  label={m.check.checkedAs}
                />
              </details>
            </>
          ) : (
            check.status === 'checked' && (
              <>
                <RequestSentence
                  request={props.request}
                  onRequestChange={props.onRequestChange}
                  label={m.check.checkedAs}
                  note={m.check.chosenByYou}
                />
                <button
                  type="button"
                  className="panel-line-action check-deduce"
                  onClick={props.onDeduceClass}
                >
                  {m.check.deduceAgain}
                </button>
              </>
            )
          ))}
        {course && check.status === 'checked' && (
          <>
            <CheckComparison check={check} course={course} />
            {isMeasured && (
              <Findings
                course={course}
                overprintFindings={props.overprintFindings}
                isEditing={props.isEditing}
                onFix={props.onFixControl}
                fixLabel={m.check.suggest}
                fixLabelFor={m.check.suggestControl}
              />
            )}
            {props.suggestion && (
              <SuggestionBar
                controlNumber={props.suggestion.controlNumber}
                isFound={props.suggestion.isFound}
                onAccept={props.onAcceptSuggestion}
                onDismiss={props.onDismissSuggestion}
              />
            )}
            {isMeasured && <ScoreBreakdown course={course} />}
            <CourseActions {...props} isMeasured={isMeasured} />
          </>
        )}
      </>
    )
  }

  return (
    <>
      {hasCentre && !isPickingCentre ? (
        <PanelLine
          label={m.course.centreLine}
          value={m.course.centreChosen}
          action={{ label: m.course.change, onClick: onMoveCentre }}
        />
      ) : (
        <section className="centre-step" aria-labelledby="centre-step-title">
          <span className="panel-line-label">{m.course.centreLine}</span>
          <h2 id="centre-step-title">{m.course.centreQuestion}</h2>
          <p>{m.course.centreHint}</p>
          <p className="check-entry">
            {m.check.entry}{' '}
            <button type="button" className="panel-line-action" onClick={props.onOpenCourseFile}>
              {m.check.openFile}
            </button>
          </p>
        </section>
      )}

      {hasCentre && !isPickingCentre && (
        <>
          {isTraining ? (
            <TrainingSentence request={props.request} onRequestChange={props.onRequestChange} />
          ) : (
            <RequestSentence
              request={props.request}
              onRequestChange={props.onRequestChange}
              offersTraining={offersTraining}
            />
          )}
          {course && <CourseFigures course={course} />}
          {course && isMeasured && (
            <Findings
              course={course}
              overprintFindings={props.overprintFindings}
              isEditing={props.isEditing}
              onFix={props.onFixControl}
              fixLabel={m.course.fix}
              fixLabelFor={m.course.fixControl}
            />
          )}
          {course && isMeasured && <ScoreBreakdown course={course} />}
          <CourseActions {...props} isMeasured={isMeasured} />
        </>
      )}
    </>
  )
}

export const hasCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

const classValue = (sex: CourseRequest['sex'], age: CourseRequest['ageClass']) => `${sex}${age}`

function TrainingMinutes({
  minutes,
  onChange,
}: {
  minutes: number
  onChange: (minutes: number) => void
}) {
  const m = useMessages().course
  const format = useFormat()
  const [typed, setTyped] = useState(String(minutes))
  return (
    <>
      {m.beforeTrainingMinutes}
      <input
        className="request-token"
        type="number"
        inputMode="numeric"
        min={1}
        aria-label={m.trainingMinutes}
        value={typed}
        onChange={e => {
          setTyped(e.target.value)
          const typedMinutes = trainingMinutesFrom(e.target.value)
          if (typedMinutes !== null) onChange(typedMinutes)
        }}
      />
      {format.minutesSuffix}
    </>
  )
}

// The purpose is the course line's own label, so the two kinds of course take one line.
function PurposeLabel({
  id,
  request,
  onRequestChange,
}: Pick<Props, 'request' | 'onRequestChange'> & { id: string }) {
  const m = useMessages().course
  return (
    <select
      id={id}
      className="panel-line-label purpose-choice"
      aria-label={m.purposeLine}
      value={purposeOf(request)}
      onChange={e =>
        onRequestChange(withPurpose(request, coursePurposeSchema.parse(e.target.value)))
      }
    >
      {coursePurposeSchema.options.map(purpose => (
        <option key={purpose} value={purpose}>
          {m.purposes[purpose]}
        </option>
      ))}
    </select>
  )
}

function TrainingSentence({
  request,
  onRequestChange,
}: Pick<Props, 'request' | 'onRequestChange'>) {
  const m = useMessages().course
  const change = (fields: Partial<CourseRequest>) => onRequestChange({ ...request, ...fields })
  return (
    <section className="request" aria-labelledby="training-title">
      <PurposeLabel id="training-title" request={request} onRequestChange={onRequestChange} />
      <p className="request-sentence">
        <select className="request-token" aria-label={m.trainingKind} value="contour" disabled>
          {trainingKindSchema.options.map(kind => (
            <option key={kind} value={kind}>
              {m.trainingKinds[kind]}
            </option>
          ))}
        </select>{' '}
        <select
          className="request-token"
          aria-label={m.trainingStyle}
          value={request.trainingStyle ?? DEFAULT_TRAINING_STYLE}
          onChange={e => change({ trainingStyle: trainingStyleSchema.parse(e.target.value) })}
        >
          {trainingStyleSchema.options.map(style => (
            <option key={style} value={style}>
              {m.trainingStyles[style]}
            </option>
          ))}
        </select>
        <TrainingMinutes
          key={request.trainingStyle}
          minutes={trainingMinutesOf(request)}
          onChange={trainingMinutes => change({ trainingMinutes })}
        />
      </p>
      <p className="request-note">{m.contourTrainingNote}</p>
    </section>
  )
}

function RequestSentence({
  request,
  onRequestChange,
  label,
  note,
  offersTraining = false,
}: Pick<Props, 'request' | 'onRequestChange'> & {
  label?: string
  note?: string
  offersTraining?: boolean
}) {
  const m = useMessages().course
  const [replacedClass, setReplacedClass] = useState<string | null>(null)
  const change = (fields: Partial<CourseRequest>) => {
    const choice = withOfferedClass({ ...request, ...fields })
    setReplacedClass(
      choice.replacedAgeClass === null
        ? null
        : m.classReplaced(
            m.eventLevels[choice.request.eventLevel],
            m.formats[choice.request.format],
            classValue(choice.request.sex, choice.replacedAgeClass),
            classValue(choice.request.sex, choice.request.ageClass),
          ),
    )
    onRequestChange(choice.request)
  }
  const ages = offeredAgeClasses(request)

  return (
    <section className="request" aria-labelledby="request-title">
      {offersTraining ? (
        <PurposeLabel id="request-title" request={request} onRequestChange={onRequestChange} />
      ) : (
        <span id="request-title" className="panel-line-label">
          {label ?? m.courseLine}
        </span>
      )}
      <p className="request-sentence">
        <select
          className="request-token"
          aria-label={m.eventLevel}
          value={request.eventLevel}
          onChange={e => change({ eventLevel: eventLevelSchema.parse(e.target.value) })}
        >
          {eventLevelSchema.options.map(level => (
            <option key={level} value={level}>
              {m.eventLevels[level]}
            </option>
          ))}
        </select>{' '}
        <select
          className="request-token"
          aria-label={m.distance}
          value={request.format}
          onChange={e => change({ format: formatSchema.parse(e.target.value) })}
        >
          {formatSchema.options.map(format => (
            <option key={format} value={format}>
              {m.formats[format]}
            </option>
          ))}
        </select>{' '}
        {m.forClass}{' '}
        <select
          className="request-token"
          aria-label={m.className}
          value={classValue(request.sex, request.ageClass)}
          onChange={e => {
            const sex = sexSchema.parse(e.target.value.slice(0, 1))
            change({ sex, ageClass: ageClassSchema.parse(Number(e.target.value.slice(1))) })
          }}
        >
          {sexSchema.options.map(sex => (
            <optgroup key={sex} label={m.sexes[sex]}>
              {ages.map(age => (
                <option key={age} value={classValue(sex, age)}>
                  {classValue(sex, age)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {m.beforeSkillLevel}
        <select
          className="request-token"
          aria-label={m.skillLevel}
          value={request.skillLetter}
          onChange={e => change({ skillLetter: skillLetterSchema.parse(e.target.value) })}
        >
          {skillLetterSchema.options.map(letter => (
            <option key={letter} value={letter}>
              {m.skillLevelOption(letter)}
            </option>
          ))}
        </select>
      </p>
      <p className="request-note">{m.skillLevels[request.skillLetter]}</p>
      {note && <p className="request-note">{note}</p>}
      {replacedClass && (
        <p className="request-note" role="status">
          {replacedClass}
        </p>
      )}
    </section>
  )
}

function CourseFigures({ course }: { course: Course }) {
  const m = useMessages().course
  const format = useFormat()
  return (
    <dl className="course-figures">
      <div>
        <dt>{m.length}</dt>
        <dd>
          {course.lengthMeters === null ? m.measuring : format.kilometres(course.lengthMeters)}
        </dd>
      </div>
      <div>
        <dt>{m.climb}</dt>
        <dd>{course.climbMeters === null ? m.measuring : format.metres(course.climbMeters)}</dd>
      </div>
      <div>
        <dt>{m.winningTime}</dt>
        <dd>{m.minutes(Math.round(course.estimatedSeconds / 60))}</dd>
        <dd className="course-figures-note">
          {m.target(m.minutes(Math.round(course.targetSeconds / 60)))}
        </dd>
      </div>
      <div>
        <dt>{m.controls}</dt>
        <dd>{course.controls.length}</dd>
      </div>
    </dl>
  )
}

function Findings({
  course,
  overprintFindings,
  isEditing,
  onFix,
  fixLabel,
  fixLabelFor,
}: {
  course: Course
  overprintFindings: readonly Finding[]
  isEditing: boolean
  onFix: (controlNumber: number) => void
  fixLabel: string
  fixLabelFor: (controlNumber: number) => string
}) {
  const { course: m, findings: texts } = useMessages()
  const finishStop = course.controls.length + 1
  // The severity, rule and Fix target come from the agent package; the words from the catalogue.
  const findings = [...course.findings, ...overprintFindings].map(finding => {
    const described = describeFinding(finding, course.controls.length)
    const text = texts.texts[finding.kind](finding.stops, finishStop, FINDING_LIMITS)
    return {
      ...described,
      text: text.charAt(0).toUpperCase() + text.slice(1),
      basis:
        described.basis === OUR_CHECK
          ? texts.ourCheck
          : described.basis === OUR_CHECK_NO_ROUTES
            ? texts.ourCheckNoRoutes
            : described.basis,
    }
  })

  return (
    <section className="findings" aria-labelledby="findings-title">
      <h2 id="findings-title">
        {findings.length === 0 ? m.noFindings : m.findingCount(findings.length)}
      </h2>
      {findings.length > 0 && (
        <ul>
          {findings.map(({ fixableControl, severity, text, basis }, i) => (
            <li key={i}>
              <SeverityMark severity={severity} label={m.severities[severity]} />
              <div className="findings-text">
                <span>{text}</span>
                <span className="findings-basis">{basis}</span>
              </div>
              {fixableControl !== null && (
                <button
                  type="button"
                  className="findings-fix"
                  disabled={isEditing}
                  aria-label={fixLabelFor(fixableControl)}
                  onClick={() => onFix(fixableControl)}
                >
                  {fixLabel}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="findings-hint">{hasCoarsePointer() ? m.dragHintTouch : m.dragHint}</p>
    </section>
  )
}

function SeverityMark({ severity, label }: { severity: Severity; label: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" role="img" aria-label={label}>
      {severity === 'note' ? (
        <circle cx="9" cy="9" r="7" fill="none" stroke="var(--colour-ink-soft)" strokeWidth="2" />
      ) : (
        <polygon
          points="9,1 17,16 1,16"
          fill={severity === 'error' ? 'var(--colour-contour-brown)' : 'none'}
          stroke="var(--colour-contour-brown)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

function CourseActions({
  course,
  canSetCourse,
  search,
  isEditing,
  isPreparingPdf,
  isMeasured,
  isAssistantOn,
  onSetCourse,
  onSetByHand,
  onStop,
  onTryAnother,
  kept,
  onForgetKept,
  onDownloadPdf,
  onDownloadXml,
  check,
}: Props & { isMeasured: boolean }) {
  const { course: m, setByHand, keep } = useMessages()

  if (search) {
    return (
      <div className={isAssistantOn ? 'course-actions is-quiet' : 'course-actions'}>
        <SearchIndicator search={search} />
        <div className="course-actions-row">
          <button type="button" className="course-primary" onClick={onStop}>
            {m.stop}
          </button>
        </div>
        <p className="course-actions-note">{m.stopHint}</p>
      </div>
    )
  }

  if (!course) {
    return (
      <div className={isAssistantOn ? 'course-actions is-quiet' : 'course-actions'}>
        <div className="course-actions-row">
          <button
            type="button"
            className="course-primary"
            disabled={!canSetCourse}
            onClick={onSetCourse}
          >
            {m.setCourse}
          </button>
          <button
            type="button"
            className="course-secondary"
            disabled={!canSetCourse}
            onClick={onSetByHand}
          >
            {setByHand.entry}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={isAssistantOn ? 'course-actions is-quiet' : 'course-actions'}>
      <div className="course-actions-row">
        <button
          type="button"
          className="course-primary"
          disabled={!isMeasured || isPreparingPdf}
          onClick={onDownloadPdf}
        >
          {isPreparingPdf ? m.preparingPdf : m.downloadPdf}
        </button>
        <button
          type="button"
          className="course-secondary"
          disabled={!isMeasured}
          onClick={onDownloadXml}
        >
          {m.downloadXml}
        </button>
        {!check && (
          <button
            type="button"
            className="course-secondary course-another"
            disabled={!canSetCourse || isEditing}
            onClick={onTryAnother}
          >
            {m.tryAnother}
          </button>
        )}
      </div>
      {!check && kept && kept.controls > 0 && (
        <p className="course-actions-note course-kept">
          <LockIcon isClosed />
          {keep.summary(kept.controls, kept.legs)}{' '}
          <button type="button" className="link" onClick={onForgetKept}>
            {keep.forget}
          </button>
        </p>
      )}
      <p className="course-actions-note">{m.exportNote}</p>
    </div>
  )
}

const ELAPSED_TICK_MS = 1000

function SearchIndicator({ search }: { search: SearchStatus }) {
  const m = useMessages().course
  const format = useFormat()
  const [now, setNow] = useState(search.startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  const elapsedSeconds = Math.max(0, (now - search.startedAt) / 1000)

  return (
    <div className="search-progress">
      <div className="search-progress-line">
        <span className="search-progress-label" role="status">
          {search.phase ? m.searchPhases[search.phase] : m.setting}
        </span>
        <span className="search-progress-elapsed">{format.duration(elapsedSeconds)}</span>
      </div>
      <span className="search-progress-bar" aria-hidden="true" />
    </div>
  )
}
