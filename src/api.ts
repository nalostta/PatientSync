import type { ClinicalDraft, LocalState, VoiceQueueItem } from './types'

const clientId = getClientId()

function getClientId() {
  const storageKey = 'clinical-p0-client-id'
  const existing = window.localStorage.getItem(storageKey)

  if (existing) {
    return existing
  }

  const created =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`

  window.localStorage.setItem(storageKey, created)
  return created
}

export function currentClientId() {
  return clientId
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export function getState() {
  return request<LocalState>(`/api/state?clientId=${encodeURIComponent(clientId)}`)
}

export function updateSession(doctorId: string, patientId: string) {
  return request<LocalState>('/api/session', {
    method: 'POST',
    body: JSON.stringify({ clientId, doctorId, patientId }),
  })
}

export function queueVoiceTranscript(transcript: string) {
  return request<LocalState>('/api/voice-queue', {
    method: 'POST',
    body: JSON.stringify({ transcript }),
  })
}

export function consumeVoiceTranscript() {
  return request<{ item: VoiceQueueItem | null; state: LocalState }>('/api/voice-next', {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  })
}

export function saveDraft(draft: ClinicalDraft) {
  return request<LocalState>('/api/records', {
    method: 'POST',
    body: JSON.stringify({ ...draft, clientId }),
  })
}

export function transcribeAudio(input: {
  doctorId: string
  patientId: string
  audioPcmBase64: string
  byteCount: number
  durationMs: number
}) {
  return request<{ transcript: string; state: LocalState }>('/api/transcribe-audio', {
    method: 'POST',
    body: JSON.stringify({ ...input, clientId }),
  })
}

export function saveAudioNote(input: {
  doctorId: string
  patientId: string
  transcript: string
  byteCount: number
  durationMs: number
}) {
  return request<LocalState>('/api/audio-note', {
    method: 'POST',
    body: JSON.stringify({ ...input, clientId }),
  })
}

export function resetLocalDb() {
  return request<LocalState>(`/api/reset?clientId=${encodeURIComponent(clientId)}`, {
    method: 'POST',
  })
}
