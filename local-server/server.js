import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createSeedData } from './seed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const dataDir = join(__dirname, '..', 'data')
const dbPath = join(dataDir, 'local-db.json')
const port = Number(process.env.PORT ?? 8787)
const audioSampleRate = 16000
const audioChannels = 1
const audioBitsPerSample = 16

await loadLocalEnv()

async function loadLocalEnv() {
  const envPath = join(rootDir, '.env')

  try {
    const content = await readFile(envPath, 'utf8')

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      const separatorIndex = trimmed.indexOf('=')

      if (separatorIndex === -1) {
        continue
      }

      const key = trimmed.slice(0, separatorIndex).trim()
      const rawValue = trimmed.slice(separatorIndex + 1).trim()
      const value = rawValue.replace(/^["']|["']$/g, '')

      if (key && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

async function ensureDb() {
  await mkdir(dataDir, { recursive: true })

  try {
    await readFile(dbPath, 'utf8')
  } catch {
    await writeDb(createSeedData())
  }
}

async function readDb() {
  await ensureDb()
  return normalizeDb(JSON.parse(await readFile(dbPath, 'utf8')))
}

async function writeDb(db) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`)
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function audit(db, eventType, payload = {}) {
  db.auditEvents.push({
    id: randomUUID(),
    eventType,
    payload,
    createdAt: new Date().toISOString(),
  })
}

function defaultSession(db) {
  return {
    ...(db.defaultSession ?? {
      doctorId: '',
      patientId: db.patients?.[0]?.id ?? '',
      shiftId: 'shift-day-1',
      updatedAt: new Date().toISOString(),
    }),
  }
}

function normalizeDb(db) {
  if (!db.sessions) {
    db.sessions = {}
  }

  if (!db.defaultSession) {
    db.defaultSession = db.session ?? defaultSession(db)
  }

  delete db.session
  return db
}

function clientIdFromRequest(req, url, body = {}) {
  const fromBody = typeof body.clientId === 'string' ? body.clientId.trim() : ''
  const fromQuery = url.searchParams.get('clientId')?.trim() ?? ''
  const fromHeader = req.headers['x-client-id']

  return fromBody || fromQuery || (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) || 'default-client'
}

function ensureClientSession(db, clientId) {
  if (!db.sessions[clientId]) {
    db.sessions[clientId] = {
      ...defaultSession(db),
      updatedAt: new Date().toISOString(),
    }
  }

  return db.sessions[clientId]
}

function snapshot(db, clientId = 'default-client') {
  const session = ensureClientSession(db, clientId)

  return {
    session,
    sessions: db.sessions,
    doctors: db.doctors,
    patients: db.patients,
    notes: db.notes,
    directives: db.directives,
    handoffSummaries: db.handoffSummaries,
    voiceQueue: db.voiceQueue,
    auditEvents: db.auditEvents,
  }
}

function validateSession(db, doctorId, patientId) {
  const doctor = db.doctors.find(item => item.id === doctorId)
  const patient = db.patients.find(item => item.id === patientId)

  if (!doctor || !patient) {
    return null
  }

  return { doctor, patient }
}

function validatePatient(db, patientId) {
  return db.patients.find(item => item.id === patientId) ?? null
}

function wavFromPcm(pcmBuffer) {
  const header = Buffer.alloc(44)
  const byteRate = audioSampleRate * audioChannels * (audioBitsPerSample / 8)
  const blockAlign = audioChannels * (audioBitsPerSample / 8)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcmBuffer.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(audioChannels, 22)
  header.writeUInt32LE(audioSampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(audioBitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcmBuffer.length, 40)

  return Buffer.concat([header, pcmBuffer])
}

async function transcribePcmWithOpenAI(pcmBase64) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to your shell, restart npm run dev, then retry audio notes.')
  }

  const pcmBuffer = Buffer.from(pcmBase64, 'base64')

  if (pcmBuffer.length === 0) {
    throw new Error('No audio bytes were received from the glasses.')
  }

  const wavBuffer = wavFromPcm(pcmBuffer)
  const form = new FormData()
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe')
  form.append(
    'prompt',
    'Clinical note dictated by a doctor. Preserve medical terms, medication names, timings, and escalation instructions.',
  )
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'g2-note.wav')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Transcription failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  const text = String(data.text ?? '').trim()

  if (!text) {
    throw new Error('Transcription returned empty text.')
  }

  return text
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  try {
    const db = await readDb()

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const clientId = clientIdFromRequest(req, url)
      sendJson(res, 200, snapshot(db, clientId))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      const body = await readBody(req)
      const clientId = clientIdFromRequest(req, url, body)
      const doctor = db.doctors.find(item => item.id === body.doctorId)
      const patient = validatePatient(db, body.patientId)

      if (!doctor || !patient) {
        sendJson(res, 400, { error: 'Invalid doctor or patient.' })
        return
      }

      db.sessions[clientId] = {
        ...ensureClientSession(db, clientId),
        doctorId: body.doctorId,
        patientId: body.patientId,
        updatedAt: new Date().toISOString(),
      }
      audit(db, 'session_updated', { clientId, session: db.sessions[clientId] })
      await writeDb(db)
      sendJson(res, 200, snapshot(db, clientId))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/voice-queue') {
      const body = await readBody(req)
      const transcript = String(body.transcript ?? '').trim()

      if (!transcript) {
        sendJson(res, 400, { error: 'Transcript is required.' })
        return
      }

      const item = {
        id: randomUUID(),
        transcript,
        createdAt: new Date().toISOString(),
      }

      db.voiceQueue.push(item)
      audit(db, 'voice_transcript_queued', { transcript })
      await writeDb(db)
      sendJson(res, 200, snapshot(db, clientIdFromRequest(req, url, body)))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/voice-next') {
      const body = await readBody(req)
      const clientId = clientIdFromRequest(req, url, body)
      const item = db.voiceQueue.shift() ?? null
      audit(db, 'voice_transcript_consumed', { clientId, transcriptId: item?.id ?? null })
      await writeDb(db)
      sendJson(res, 200, { item, state: snapshot(db, clientId) })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/transcribe-audio') {
      const body = await readBody(req)
      const clientId = clientIdFromRequest(req, url, body)
      const patient = validatePatient(db, body.patientId)

      if (!patient) {
        sendJson(res, 400, { error: 'Invalid patient.' })
        return
      }

      const transcript = await transcribePcmWithOpenAI(String(body.audioPcmBase64 ?? ''))
      audit(db, 'audio_transcribed', {
        clientId,
        doctorId: body.doctorId,
        patientId: body.patientId,
        byteCount: Number(body.byteCount ?? 0),
        durationMs: Number(body.durationMs ?? 0),
      })
      await writeDb(db)
      sendJson(res, 200, { transcript, state: snapshot(db, clientId) })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/audio-note') {
      const body = await readBody(req)
      const clientId = clientIdFromRequest(req, url, body)
      const validated = validateSession(db, body.doctorId, body.patientId)

      if (!validated) {
        sendJson(res, 400, { error: 'Invalid doctor or patient.' })
        return
      }

      const byteCount = Number(body.byteCount ?? 0)
      const durationMs = Number(body.durationMs ?? 0)
      const text = String(body.transcript ?? '').trim()

      if (!text) {
        sendJson(res, 400, { error: 'Transcript text is required for local audio notes.' })
        return
      }

      const id = randomUUID()
      db.notes.push({
        id,
        patientId: body.patientId,
        doctorId: body.doctorId,
        type: 'note',
        text,
        audioMeta: {
          byteCount,
          durationMs,
          source: 'g2-microphone-local',
        },
        createdAt: new Date().toISOString(),
      })
      audit(db, 'audio_note_saved', {
        clientId,
        id,
        doctorId: body.doctorId,
        patientId: body.patientId,
        byteCount,
        durationMs,
      })
      await writeDb(db)
      sendJson(res, 200, snapshot(db, clientId))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/records') {
      const body = await readBody(req)
      const clientId = clientIdFromRequest(req, url, body)
      const validated = validateSession(db, body.doctorId, body.patientId)

      if (!validated) {
        sendJson(res, 400, { error: 'Invalid doctor or patient.' })
        return
      }

      const createdAt = new Date().toISOString()
      const id = randomUUID()

      if (body.kind === 'directive') {
        db.directives.push({
          id,
          patientId: body.patientId,
          doctorId: body.doctorId,
          action: body.action,
          assignee: body.assignee,
          dueTime: body.dueTime,
          escalation: body.escalation,
          acknowledgedBy: null,
          status: 'pending_ack',
          createdAt,
        })
      } else if (body.kind === 'handoff') {
        db.handoffSummaries.push({
          id,
          patientId: body.patientId,
          doctorId: body.doctorId,
          summary: body.text,
          createdAt,
        })
      } else {
        db.notes.push({
          id,
          patientId: body.patientId,
          doctorId: body.doctorId,
          type: 'note',
          text: body.text,
          createdAt,
        })
      }

      audit(db, 'record_confirmed_and_saved', {
        clientId,
        id,
        kind: body.kind,
        doctorId: body.doctorId,
        patientId: body.patientId,
      })
      await writeDb(db)
      sendJson(res, 200, snapshot(db, clientId))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const fresh = createSeedData()
      await writeDb(fresh)
      sendJson(res, 200, snapshot(fresh, clientIdFromRequest(req, url)))
      return
    }

    sendJson(res, 404, { error: 'Not found.' })
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unknown server error.',
    })
  }
}

await ensureDb()

createServer(handleRequest).listen(port, () => {
  console.log(`Local clinical API listening on http://localhost:${port}`)
  console.log(`JSON database: ${dbPath}`)
})
