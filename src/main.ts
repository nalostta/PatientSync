import './style.css'
import { currentClientId, getState, queueVoiceTranscript, resetLocalDb, updateSession } from './api'
import { startGlassesWorkflow } from './glasses'
import { activeDoctor, activePatient } from './workflow'
import type { LocalState } from './types'

const root = document.querySelector<HTMLDivElement>('#app')

function setStatus(message: string) {
  const status = document.querySelector<HTMLParagraphElement>('#bridge-status')
  if (status) {
    status.textContent = message
  }
  console.log(`[clinical-p0] ${message}`)
}

function render(nextState: LocalState) {
  const doctor = activeDoctor(nextState)
  const patient = activePatient(nextState)
  const patientDirectives = nextState.directives.filter(item => item.patientId === patient.id)
  const patientNotes = nextState.notes.filter(item => item.patientId === patient.id)
  const doctorName = (doctorId: string) => {
    const noteDoctor = nextState.doctors.find(item => item.id === doctorId)
    return noteDoctor ? `${noteDoctor.name} (${noteDoctor.id})` : doctorId
  }

  if (!root) {
    return
  }

  root.innerHTML = `
    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">Local P0</p>
          <h1>Clinical handoff workflow</h1>
          <p class="muted">Client: ${currentClientId().slice(0, 8)} | Active doctor: ${doctor.id || 'not identified'}</p>
        </div>
        <p id="bridge-status">Open the simulator to connect the glasses bridge.</p>
      </header>

      <section class="grid">
        <form class="panel" id="session-form">
          <h2>Active Session</h2>
          <label>
            Doctor
            <select id="doctor-id">
              ${nextState.doctors
                .map(
                  item =>
                    `<option value="${item.id}" ${item.id === doctor.id ? 'selected' : ''}>${item.name} - ${item.shift}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label>
            Patient
            <select id="patient-id">
              ${nextState.patients
                .map(
                  item =>
                    `<option value="${item.id}" ${item.id === patient.id ? 'selected' : ''}>${item.name} - ${item.patientId} - Room ${item.room}</option>`,
                )
                .join('')}
            </select>
          </label>
          <button type="submit">Update session</button>
        </form>

        <section class="panel">
          <h2>Patient Metadata</h2>
          <dl class="meta">
            <div><dt>Name</dt><dd>${patient.name}</dd></div>
            <div><dt>Birth</dt><dd>${patient.birthDate}</dd></div>
            <div><dt>Patient ID</dt><dd>${patient.patientId}</dd></div>
            <div><dt>Room</dt><dd>${patient.room}</dd></div>
          </dl>
          <p>${patient.status}</p>
        </section>

        <form class="panel voice" id="voice-form">
          <h2>Mock Glasses Voice</h2>
          <textarea id="transcript" rows="5" placeholder="Example: Ask nurse to recheck blood pressure in 30 minutes and notify resident if systolic stays below 90."></textarea>
          <button type="submit">Queue transcript</button>
          <p class="muted">${nextState.voiceQueue.length} queued transcript${nextState.voiceQueue.length === 1 ? '' : 's'} waiting for glasses press.</p>
        </form>

        <section class="panel">
          <h2>Current Patient Context</h2>
          <p><strong>Symptoms:</strong> ${patient.symptoms.join(', ')}</p>
          <p><strong>Concerns:</strong> ${patient.concerns.join('; ')}</p>
          <p><strong>Team:</strong> ${patient.team.join(', ')}</p>
        </section>

        <section class="panel wide">
          <h2>Saved Directives</h2>
          ${patientDirectives
            .slice()
            .reverse()
            .map(
              item => `
                <article class="record">
                  <strong>${item.assignee}</strong>
                  <span>${item.action}</span>
                  <small>Due ${item.dueTime}. Escalation: ${item.escalation}</small>
                </article>
              `,
            )
            .join('') || '<p class="muted">No directives for this patient.</p>'}
        </section>

        <section class="panel wide">
          <h2>Notes And Handoff Updates</h2>
          ${patientNotes
            .slice()
            .reverse()
            .map(
              item => `
                <article class="record">
                  <strong>Note by ${doctorName(item.doctorId)}</strong>
                  <span>${item.text}</span>
                  <small>${new Date(item.createdAt).toLocaleString()}</small>
                </article>
              `,
            )
            .join('') || '<p class="muted">No notes for this patient.</p>'}
        </section>
      </section>

      <footer>
        <button type="button" id="reset-db">Reset local DB</button>
        <code>data/local-db.json</code>
      </footer>
    </section>
  `

  bindHandlers()
}

function bindHandlers() {
  document.querySelector<HTMLFormElement>('#session-form')?.addEventListener('submit', async event => {
    event.preventDefault()
    const doctorId = document.querySelector<HTMLSelectElement>('#doctor-id')?.value
    const patientId = document.querySelector<HTMLSelectElement>('#patient-id')?.value

    if (doctorId && patientId) {
      render(await updateSession(doctorId, patientId))
    }
  })

  document.querySelector<HTMLFormElement>('#voice-form')?.addEventListener('submit', async event => {
    event.preventDefault()
    const textarea = document.querySelector<HTMLTextAreaElement>('#transcript')
    const transcript = textarea?.value.trim()

    if (!transcript) {
      return
    }

    render(await queueVoiceTranscript(transcript))
    if (textarea) {
      textarea.value = ''
    }
  })

  document.querySelector<HTMLButtonElement>('#reset-db')?.addEventListener('click', async () => {
    render(await resetLocalDb())
  })
}

async function boot() {
  render(await getState())

  startGlassesWorkflow(setStatus, updatedState => {
    render(updatedState)
    setStatus('Saved locally. The simulator is ready for the next transcript.')
  }).catch(error => {
    setStatus(
      error instanceof Error
        ? `Simulator bridge not connected yet: ${error.message}`
        : 'Simulator bridge not connected yet.',
    )
  })
}

boot().catch(error => {
  if (root) {
    root.innerHTML = `<section class="panel error"><h1>Startup failed</h1><p>${String(error)}</p></section>`
  }
})
