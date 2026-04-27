import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { consumeVoiceTranscript, getState, saveAudioNote, saveDraft, transcribeAudio, updateSession } from './api'
import {
  activeDoctor,
  activePatient,
  applyFieldAnswer,
  doctorIdFromSpeech,
  fieldPrompt,
  hasActiveDoctor,
  missingFields,
  parseTranscript,
} from './workflow'
import type { ClinicalDraft, LocalState, MissingField } from './types'

const CONTAINER_ID = 1
const CONTAINER_NAME = 'main'

type ScreenMode =
  | 'context'
  | 'identify-doctor'
  | 'identify-recording'
  | 'identify-ready'
  | 'identify-transcribing'
  | 'prompt'
  | 'confirm'
  | 'saved'
  | 'queue-empty'
  | 'recording'
  | 'audio-ready'
  | 'transcribing'
  | 'audio-confirm'
  | 'error'
type Section = 'summary' | 'directives' | 'notes' | 'team'

type GlassesState = {
  mode: ScreenMode
  section: Section
  state: LocalState
  draft: ClinicalDraft | null
  missing: MissingField[]
  message: string
  audio: {
    chunks: Uint8Array[]
    byteCount: number
    startedAt: number
  } | null
}

const sections: Section[] = ['summary', 'directives', 'notes', 'team']

export async function startGlassesWorkflow(
  onStatus: (message: string) => void,
  onSaved: (state: LocalState) => void,
) {
  const state = await getState()
  const runtime: GlassesState = {
    mode: hasActiveDoctor(state) ? 'context' : 'identify-doctor',
    section: 'summary',
    state,
    draft: null,
    missing: [],
    message: 'Press to record audio. Queue a transcript in the panel to test directives.',
    audio: null,
  }

  const bridge = await waitForEvenAppBridge()
  onStatus('Bridge connected. Creating clinical workflow page...')

  const mainText = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 8,
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    content: formatScreen(runtime),
    isEventCapture: 1,
  })

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [mainText],
    }),
  )

  if (result !== 0) {
    throw new Error(`createStartUpPageContainer failed with code ${result}`)
  }

  async function refresh() {
    const content = formatScreen(runtime)
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: CONTAINER_ID,
        containerName: CONTAINER_NAME,
        contentOffset: 0,
        contentLength: content.length,
        content,
      }),
    )
  }

  async function consumeQueuedVoice() {
    const response = await consumeVoiceTranscript()
    runtime.state = response.state

    if (!response.item) {
      runtime.mode = 'queue-empty'
      runtime.message = 'No queued voice transcript. Add one in the local panel.'
      await refresh()
      return null
    }

    return response.item.transcript
  }

  async function startAudioCapture() {
    const started = await bridge.audioControl(true)

    if (!started) {
      throw new Error('Unable to start glasses microphone.')
    }

    runtime.audio = {
      chunks: [],
      byteCount: 0,
      startedAt: Date.now(),
    }
    runtime.mode = 'recording'
    runtime.message = 'Recording from glasses mic. Press again to stop.'
    await refresh()
  }

  async function startDoctorIdCapture() {
    const started = await bridge.audioControl(true)

    if (!started) {
      throw new Error('Unable to start glasses microphone.')
    }

    runtime.audio = {
      chunks: [],
      byteCount: 0,
      startedAt: Date.now(),
    }
    runtime.mode = 'identify-recording'
    runtime.message = 'Listening for Doctor ID. Say D1 or D2, then press.'
    await refresh()
  }

  async function stopAudioCapture() {
    await bridge.audioControl(false)
    if (runtime.mode === 'identify-recording') {
      runtime.mode = 'identify-ready'
      runtime.message = 'Doctor ID audio captured. Press to identify.'
    } else {
      runtime.mode = 'audio-ready'
      runtime.message = 'Audio captured. Press to transcribe before saving.'
    }
    await refresh()
  }

  async function transcribeCapturedAudio() {
    if (!runtime.audio) {
      throw new Error('No captured audio is available.')
    }

    runtime.mode = 'transcribing'
    runtime.message = 'Transcribing audio. Keep this screen open.'
    await refresh()

    const doctor = activeDoctor(runtime.state)
    const patient = activePatient(runtime.state)
    const durationMs = Date.now() - runtime.audio.startedAt
    const response = await transcribeAudio({
      doctorId: doctor.id,
      patientId: patient.id,
      audioPcmBase64: audioChunksToBase64(runtime.audio.chunks),
      byteCount: runtime.audio.byteCount,
      durationMs,
    })
    const transcript = response.transcript
    runtime.state = response.state
    runtime.draft = parseTranscript(transcript, doctor.id, patient.id)
    runtime.draft.kind = 'note'
    runtime.draft.text = transcript
    runtime.mode = 'audio-confirm'
    runtime.message = 'Review transcript. Press to save as note.'
    await refresh()
  }

  async function identifyDoctorFromAudio() {
    if (!runtime.audio) {
      throw new Error('No Doctor ID audio is available.')
    }

    runtime.mode = 'identify-transcribing'
    runtime.message = 'Identifying doctor from voice.'
    await refresh()

    const patient = activePatient(runtime.state)
    const response = await transcribeAudio({
      doctorId: 'D1',
      patientId: patient.id,
      audioPcmBase64: audioChunksToBase64(runtime.audio.chunks),
      byteCount: runtime.audio.byteCount,
      durationMs: Date.now() - runtime.audio.startedAt,
    })
    const doctorId = doctorIdFromSpeech(response.transcript)

    if (!doctorId) {
      runtime.mode = 'identify-doctor'
      runtime.audio = null
      runtime.message = `Heard: "${response.transcript}". Say D1 or D2 clearly.`
      await refresh()
      return
    }

    runtime.state = await updateSession(doctorId, patient.id)
    runtime.mode = 'context'
    runtime.audio = null
    runtime.message = `Doctor set to ${activeDoctor(runtime.state).name}. Press to record note.`
    onSaved(runtime.state)
    await refresh()
  }

  async function handlePress() {
    if (runtime.mode === 'recording') {
      await stopAudioCapture()
      return
    }

    if (runtime.mode === 'identify-doctor') {
      await startDoctorIdCapture()
      return
    }

    if (runtime.mode === 'identify-recording') {
      await stopAudioCapture()
      return
    }

    if (runtime.mode === 'identify-ready') {
      await identifyDoctorFromAudio()
      return
    }

    if (runtime.mode === 'audio-ready') {
      await transcribeCapturedAudio()
      return
    }

    if (runtime.mode === 'audio-confirm' && runtime.draft && runtime.audio) {
      const updated = await saveAudioNote({
        doctorId: runtime.draft.doctorId,
        patientId: runtime.draft.patientId,
        transcript: runtime.draft.text,
        byteCount: runtime.audio.byteCount,
        durationMs: Date.now() - runtime.audio.startedAt,
      })
      runtime.state = updated
      runtime.mode = 'saved'
      runtime.audio = null
      runtime.message = 'Audio note saved locally after confirmation.'
      onSaved(updated)
      await refresh()
      return
    }

    if (runtime.mode === 'confirm' && runtime.draft) {
      const updated = await saveDraft(runtime.draft)
      runtime.state = updated
      runtime.mode = 'saved'
      runtime.message = 'Saved after doctor confirmation.'
      onSaved(updated)
      await refresh()
      return
    }

    if (runtime.mode === 'saved' || runtime.mode === 'queue-empty' || runtime.mode === 'error') {
      runtime.mode = 'context'
      runtime.draft = null
      runtime.missing = []
      runtime.audio = null
      runtime.state = await getState()
      if (!hasActiveDoctor(runtime.state)) {
        runtime.mode = 'identify-doctor'
        runtime.message = 'Say Doctor ID: D1 for Mike or D2 for Manthan.'
        await refresh()
        return
      }
      runtime.message = 'Press to record audio. Queue a transcript in the panel to test directives.'
      await refresh()
      return
    }

    runtime.state = await getState()

    if (runtime.mode === 'context' && runtime.state.voiceQueue.length === 0) {
      await startAudioCapture()
      return
    }

    const transcript = await consumeQueuedVoice()

    if (!transcript) {
      return
    }

    if (runtime.mode === 'prompt' && runtime.draft && runtime.missing[0]) {
      runtime.draft = applyFieldAnswer(runtime.draft, runtime.missing[0], transcript)
    } else {
      const doctor = activeDoctor(runtime.state)
      const patient = activePatient(runtime.state)
      runtime.draft = parseTranscript(transcript, doctor.id, patient.id)
    }

    runtime.missing = missingFields(runtime.draft)
    runtime.mode = runtime.missing.length > 0 ? 'prompt' : 'confirm'
    runtime.message =
      runtime.mode === 'prompt'
        ? 'Missing detail required before confirmation.'
        : 'Press to confirm and save to the local DB.'
    await refresh()
  }

  async function handleScroll(direction: 1 | -1) {
    if (runtime.mode === 'confirm') {
      runtime.mode = 'prompt'
      runtime.missing = ['assignee', 'dueTime', 'escalation'].filter(field => {
        return Boolean(runtime.draft?.[field as MissingField])
      }) as MissingField[]
      runtime.message = 'Queued answers can update directive details before saving.'
      await refresh()
      return
    }

    if (runtime.mode !== 'context') {
      runtime.message =
        runtime.mode === 'audio-confirm'
          ? 'Review transcript. Press to save as note.'
          : runtime.mode === 'audio-ready'
            ? 'Audio captured. Press to transcribe before saving.'
            : runtime.mode === 'recording'
              ? 'Recording from glasses mic. Press again to stop.'
              : runtime.message
      await refresh()
      return
    }

    const index = sections.indexOf(runtime.section)
    const nextIndex = (index + direction + sections.length) % sections.length
    runtime.section = sections[nextIndex]
    runtime.state = await getState()
    await refresh()
  }

  bridge.onEvenHubEvent(async event => {
    if (event.audioEvent && runtime.audio) {
      runtime.audio.chunks.push(event.audioEvent.audioPcm)
      runtime.audio.byteCount += event.audioEvent.audioPcm.byteLength
      return
    }

    const eventType = event.textEvent?.eventType ?? event.sysEvent?.eventType

    try {
      switch (eventType) {
        case OsEventTypeList.CLICK_EVENT:
        case undefined:
          await handlePress()
          return
        case OsEventTypeList.DOUBLE_CLICK_EVENT:
          if (runtime.mode === 'context') {
            await startAudioCapture()
            return
          }

          if (runtime.mode === 'recording' || runtime.mode === 'identify-recording') {
            await stopAudioCapture()
            return
          }

          await bridge.shutDownPageContainer(1)
          return
        case OsEventTypeList.SCROLL_TOP_EVENT:
          await handleScroll(-1)
          return
        case OsEventTypeList.SCROLL_BOTTOM_EVENT:
          await handleScroll(1)
          return
        default:
          return
      }
    } catch (error) {
      runtime.mode = 'error'
      runtime.message = error instanceof Error ? error.message : 'Unknown workflow error.'
      await refresh()
    }
  })

  onStatus('Clinical workflow is ready in the simulator.')
}

function formatScreen(runtime: GlassesState) {
  const doctor = activeDoctor(runtime.state)
  const patient = activePatient(runtime.state)

  const header = [
    `${patient.name} | ${patient.patientId}`,
    `DOB ${patient.birthDate} | Room ${patient.room}`,
    `${doctor.name} (${doctor.shift})`,
    '',
  ]

  switch (runtime.mode) {
    case 'identify-doctor':
      return limit([
        `${patient.name} | ${patient.patientId}`,
        `DOB ${patient.birthDate} | Room ${patient.room}`,
        '',
        'Identify Doctor',
        'Say D1 for Mike.',
        'Say D2 for Manthan.',
        '',
        runtime.message,
        'Press: start listening',
      ])
    case 'identify-recording':
      return limit([
        `${patient.name} | ${patient.patientId}`,
        '',
        'Listening For Doctor ID',
        'Say D1 or D2.',
        '',
        `Bytes captured: ${runtime.audio?.byteCount ?? 0}`,
        'Press: stop',
      ])
    case 'identify-ready':
      return limit([
        `${patient.name} | ${patient.patientId}`,
        '',
        'Doctor ID Captured',
        'Press to transcribe and identify doctor.',
      ])
    case 'identify-transcribing':
      return limit([`${patient.name} | ${patient.patientId}`, '', 'Identifying Doctor', runtime.message])
    case 'prompt':
      return limit([
        ...header,
        'Missing Required Detail',
        runtime.missing[0] ? fieldPrompt(runtime.missing[0]) : 'Review directive details.',
        '',
        'Queue the answer in the local panel.',
        'Press to capture it.',
      ])
    case 'confirm':
      return limit([
        ...header,
        'Confirm Before Saving',
        ...formatDraft(runtime.draft),
        '',
        'Press: save to DB',
        'Swipe: cancel/edit',
      ])
    case 'saved':
    case 'queue-empty':
    case 'error':
      return limit([...header, runtime.message, '', 'Press: return to patient context'])
    case 'recording':
      return limit([
        ...header,
        'Recording Audio Note',
        `Bytes captured: ${runtime.audio?.byteCount ?? 0}`,
        '',
        'Press or double press: stop',
        'Swipe: cancel',
      ])
    case 'audio-ready':
      return limit([
        ...header,
        'Audio Captured',
        `Bytes captured: ${runtime.audio?.byteCount ?? 0}`,
        '',
        'Press: transcribe',
        'Swipe: cancel',
      ])
    case 'transcribing':
      return limit([...header, 'Transcribing Audio', 'Keep the app open.', '', runtime.message])
    case 'audio-confirm':
      return limit([
        ...header,
        'Confirm Audio Note',
        runtime.draft?.text ?? 'No transcript available.',
        '',
        'Press: save note',
        'Swipe: cancel',
      ])
    case 'context':
      return limit([
        ...header,
        ...formatSection(runtime),
        '',
        runtime.message,
        'Press: record audio or consume queued transcript',
        'Double press: record audio',
        'Swipe: change view',
      ])
  }
}

function formatSection(runtime: GlassesState) {
  const patient = activePatient(runtime.state)

  if (runtime.section === 'summary') {
    return [
      'Patient Summary',
      patient.status,
      `Symptoms: ${patient.symptoms.join(', ')}`,
      `Concerns: ${patient.concerns.join('; ')}`,
    ]
  }

  if (runtime.section === 'directives') {
    const directives = runtime.state.directives
      .filter(item => item.patientId === patient.id)
      .slice(-3)
      .reverse()

    return [
      'Active Directives',
      ...directives.map(item => `${item.assignee}: ${item.action} Due ${item.dueTime}`),
      directives.length === 0 ? 'No directives saved locally.' : '',
    ].filter(Boolean)
  }

  if (runtime.section === 'notes') {
    const notes = runtime.state.notes
      .filter(item => item.patientId === patient.id)
      .reverse()
    const doctorName = (doctorId: string) => {
      const doctor = runtime.state.doctors.find(item => item.id === doctorId)
      return doctor ? `${doctor.name} (${doctor.id})` : doctorId
    }

    return [
      `All Notes (${notes.length})`,
      ...notes.map(item => `${doctorName(item.doctorId)}: ${item.text}`),
      notes.length === 0 ? 'No notes.' : '',
    ].filter(Boolean)
  }

  return ['Care Team', ...patient.team, '', 'Health Summary', patient.healthSummary]
}

function formatDraft(draft: ClinicalDraft | null) {
  if (!draft) {
    return ['No active draft.']
  }

  if (draft.kind === 'directive') {
    return [
      'Directive',
      `Action: ${draft.action}`,
      `Owner: ${draft.assignee}`,
      `Timing: ${draft.dueTime}`,
      `Escalate: ${draft.escalation}`,
    ]
  }

  return [draft.kind === 'handoff' ? 'Handoff Update' : 'Note', draft.text]
}

function limit(lines: string[]) {
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 1800)
}

function audioChunksToBase64(chunks: Uint8Array[]) {
  const byteCount = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const merged = new Uint8Array(byteCount)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  let binary = ''
  const blockSize = 0x8000

  for (let index = 0; index < merged.length; index += blockSize) {
    binary += String.fromCharCode(...merged.subarray(index, index + blockSize))
  }

  return btoa(binary)
}
