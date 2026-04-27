export type ClinicalRecordKind = 'directive' | 'note' | 'handoff'

export type MissingField = 'assignee' | 'dueTime' | 'escalation'

export type Doctor = {
  id: string
  name: string
  role: string
  shift: string
}

export type Patient = {
  id: string
  patientId: string
  name: string
  birthDate: string
  room: string
  status: string
  symptoms: string[]
  team: string[]
  healthSummary: string
  concerns: string[]
}

export type Session = {
  doctorId: string
  patientId: string
  shiftId: string
  updatedAt: string
}

export type NoteRecord = {
  id: string
  patientId: string
  doctorId: string
  type: 'note'
  text: string
  createdAt: string
}

export type DirectiveRecord = {
  id: string
  patientId: string
  doctorId: string
  action: string
  assignee: string
  dueTime: string
  escalation: string
  acknowledgedBy: string | null
  status: string
  createdAt: string
}

export type HandoffRecord = {
  id: string
  patientId: string
  doctorId: string
  summary: string
  createdAt: string
}

export type VoiceQueueItem = {
  id: string
  transcript: string
  createdAt: string
}

export type AuditEvent = {
  id: string
  eventType: string
  payload?: Record<string, unknown>
  createdAt: string
}

export type LocalState = {
  session: Session
  sessions?: Record<string, Session>
  doctors: Doctor[]
  patients: Patient[]
  notes: NoteRecord[]
  directives: DirectiveRecord[]
  handoffSummaries: HandoffRecord[]
  voiceQueue: VoiceQueueItem[]
  auditEvents: AuditEvent[]
}

export type ClinicalDraft = {
  kind: ClinicalRecordKind
  doctorId: string
  patientId: string
  sourceTranscript: string
  text: string
  action: string
  assignee: string
  dueTime: string
  escalation: string
}
