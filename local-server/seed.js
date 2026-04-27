export function createSeedData() {
  const now = new Date().toISOString()

  return {
    version: 1,
    sessions: {},
    defaultSession: {
      doctorId: '',
      patientId: 'pat-1007',
      shiftId: 'shift-day-1',
      updatedAt: now,
    },
    doctors: [
      {
        id: 'D1',
        name: 'Dr. Mike',
        role: 'Attending',
        shift: 'Day',
      },
      {
        id: 'D2',
        name: 'Dr. Manthan',
        role: 'Resident',
        shift: 'Evening',
      },
    ],
    patients: [
      {
        id: 'pat-1007',
        patientId: 'P-1007',
        name: 'Jane Brooks',
        birthDate: '1974-08-14',
        room: '402',
        status: 'Observation after hypotensive episode',
        symptoms: ['dizziness', 'nausea', 'low blood pressure'],
        team: ['Dr. Mike', 'Dr. Manthan', 'Nurse Team B', 'Pharmacy'],
        healthSummary:
          'Admitted for recurrent dizziness with intermittent hypotension. No chest pain reported. Monitoring response to fluids and medication review.',
        concerns: ['Watch systolic BP trend', 'Medication interaction review pending'],
      },
      {
        id: 'pat-1008',
        patientId: 'P-1008',
        name: 'Robert Ellis',
        birthDate: '1962-02-03',
        room: '405',
        status: 'Post-op pain management',
        symptoms: ['abdominal pain', 'reduced appetite'],
        team: ['Dr. Manthan', 'Surgery Consult', 'Nurse Team A'],
        healthSummary:
          'Post-operative recovery with pain control adjustments. Ambulation encouraged. Monitor oral intake and incision site.',
        concerns: ['Pain score remains elevated after movement'],
      },
    ],
    notes: [
      {
        id: 'note-seed-1',
        patientId: 'pat-1007',
        doctorId: 'D2',
        type: 'note',
        text: 'Patient reported dizziness improved after fluids but still feels weak when standing.',
        createdAt: now,
      },
    ],
    directives: [
      {
        id: 'dir-seed-1',
        patientId: 'pat-1007',
        doctorId: 'D1',
        action: 'Recheck orthostatic vitals.',
        assignee: 'Nurse Team B',
        dueTime: 'in 1 hour',
        escalation: 'Notify resident if systolic BP is below 90.',
        acknowledgedBy: null,
        status: 'pending_ack',
        createdAt: now,
      },
    ],
    handoffSummaries: [
      {
        id: 'handoff-seed-1',
        patientId: 'pat-1007',
        doctorId: 'D2',
        summary:
          'Continue BP monitoring, confirm medication review, and reassess dizziness before ambulation.',
        createdAt: now,
      },
    ],
    voiceQueue: [],
    auditEvents: [
      {
        id: 'audit-seed-1',
        eventType: 'seed_created',
        createdAt: now,
      },
    ],
  }
}
