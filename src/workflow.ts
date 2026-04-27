import type { ClinicalDraft, LocalState, MissingField } from './types'

const directiveHints = [
  'ask',
  'tell',
  'order',
  'give',
  'start',
  'stop',
  'check',
  'recheck',
  'draw',
  'call',
  'notify',
  'schedule',
  'consult',
  'monitor',
  'repeat',
  'obtain',
  'administer',
]

const assigneeHints = [
  'nurse team a',
  'nurse team b',
  'nurse',
  'resident',
  'pharmacy',
  'lab',
  'cardiology',
  'respiratory therapy',
  'medical team',
  'team',
  'patient',
]

export function activeDoctor(state: LocalState) {
  return state.doctors.find(doctor => doctor.id === state.session.doctorId) ?? state.doctors[0]
}

export function hasActiveDoctor(state: LocalState) {
  return state.doctors.some(doctor => doctor.id === state.session.doctorId)
}

export function doctorIdFromSpeech(transcript: string) {
  const normalized = transcript
    .trim()
    .toLowerCase()
    .replace(/\bdoctor\b/g, '')
    .replace(/\bdr\b/g, '')
    .replace(/\bd\s*one\b/g, 'd1')
    .replace(/\bd\s*won\b/g, 'd1')
    .replace(/\bd\s*two\b/g, 'd2')
    .replace(/\bd\s*too\b/g, 'd2')
    .replace(/\bdee\s*one\b/g, 'd1')
    .replace(/\bdee\s*two\b/g, 'd2')
    .replace(/[^a-z0-9]/g, '')

  if (normalized.includes('d1') || normalized.includes('mike')) {
    return 'D1'
  }

  if (normalized.includes('d2') || normalized.includes('manthan')) {
    return 'D2'
  }

  return null
}

export function activePatient(state: LocalState) {
  return state.patients.find(patient => patient.id === state.session.patientId) ?? state.patients[0]
}

export function parseTranscript(
  transcript: string,
  doctorId: string,
  patientId: string,
): ClinicalDraft {
  const normalized = transcript.trim()
  const lower = normalized.toLowerCase()
  const isHandoff = lower.includes('handoff') || lower.includes('shift summary')
  const isDirective = directiveHints.some(hint => lower.includes(hint))
  const kind = isHandoff ? 'handoff' : isDirective ? 'directive' : 'note'

  return {
    kind,
    doctorId,
    patientId,
    sourceTranscript: normalized,
    text: normalized,
    action: normalized,
    assignee: kind === 'directive' ? extractAssignee(lower) : '',
    dueTime: kind === 'directive' ? extractDueTime(lower) : '',
    escalation: kind === 'directive' ? extractEscalation(normalized) : '',
  }
}

export function missingFields(draft: ClinicalDraft): MissingField[] {
  if (draft.kind !== 'directive') {
    return []
  }

  const missing: MissingField[] = []

  if (!draft.assignee.trim()) {
    missing.push('assignee')
  }
  if (!draft.dueTime.trim()) {
    missing.push('dueTime')
  }
  if (!draft.escalation.trim()) {
    missing.push('escalation')
  }

  return missing
}

export function applyFieldAnswer(
  draft: ClinicalDraft,
  field: MissingField,
  answer: string,
): ClinicalDraft {
  return {
    ...draft,
    [field]: answer.trim(),
  }
}

export function fieldPrompt(field: MissingField) {
  switch (field) {
    case 'assignee':
      return 'Who is responsible for carrying this out?'
    case 'dueTime':
      return 'When should this be completed or reassessed?'
    case 'escalation':
      return 'What escalation rule should the team follow?'
  }
}

function extractAssignee(lowerTranscript: string) {
  const found = assigneeHints.find(hint => lowerTranscript.includes(hint))
  return found ? titleCase(found) : ''
}

function extractDueTime(lowerTranscript: string) {
  const match =
    lowerTranscript.match(/\b(stat|now|today|tonight|tomorrow)\b/) ??
    lowerTranscript.match(/\bin\s+\d+\s+(minute|minutes|hour|hours)\b/) ??
    lowerTranscript.match(/\bby\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/)

  return match?.[0] ?? ''
}

function extractEscalation(transcript: string) {
  const match =
    transcript.match(/\b(no escalation needed|no escalation required)\b/i) ??
    transcript.match(/\b(notify|call|page|escalate).+?\bif\b.+/i) ??
    transcript.match(/\bif\b.+/i)

  return match?.[0]?.trim() ?? ''
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, char => char.toUpperCase())
}
