# PatientSync

Voice-first clinical communication prototype for Even Realities G2 smart glasses.

## Tagline

Hands-free clinical notes and handoffs, attributed to the right doctor.

## Overview

PatientSync is a local P0 prototype for hospital team communication on Even Realities smart glasses. It lets a doctor identify themselves by voice, view patient context on glasses, dictate notes, transcribe the audio, review the text, and save the note with doctor and patient attribution.

The current version is intentionally local-first so the workflow can be tested on the simulator and physical G2 glasses before moving to a production backend.

## Current P0 Features

- Even Realities G2 glasses app using the Even Hub SDK.
- Voice-based doctor identification:
  - `D1` maps to `Dr. Mike`.
  - `D2` maps to `Dr. Manthan`.
- Independent sessions per glasses/browser client.
- Patient metadata display:
  - name
  - birth date
  - patient ID
  - room
- Patient summary, team, directives, and recent notes views.
- Glasses microphone capture.
- PCM audio converted to WAV server-side.
- OpenAI speech-to-text transcription.
- Doctor review before note save.
- Local JSON database for P0 testing.
- Notes display which doctor created each note.

## Tech Stack

- Smart glasses: Even Realities G2
- SDK: `@evenrealities/even_hub_sdk`
- Frontend: Vite, TypeScript
- Local backend: Node.js HTTP server
- Local database: JSON file
- Speech-to-text: OpenAI audio transcription API
- Testing: Even Hub Simulator and physical G2 glasses

## Requirements

- Node.js 22+
- npm
- Even Realities mobile app
- Even Realities G2 glasses
- OpenAI API key for transcription

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Add your OpenAI key to `.env`:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

Start the local app and API:

```bash
npm run dev
```

The app runs at:

```text
http://localhost:5173
```

On the same Wi-Fi network, the phone/glasses should use the network URL printed by Vite, for example:

```text
http://192.168.x.x:5173
```

## Simulator

Run the glow simulator:

```bash
npm run simulator:glow
```

Run the standard simulator:

```bash
npm run simulator
```

## Physical Glasses Testing

1. Start the dev server:

   ```bash
   npm run dev
   ```

2. Generate a QR code for the Vite network URL:

   ```bash
   npm exec -- evenhub qr --url "http://YOUR_LAN_IP:5173"
   ```

3. Scan the QR code from the Even Realities mobile app.

4. On the glasses:
   - Press to start doctor identification.
   - Say `D1` or `D2`.
   - Press to stop.
   - Press to identify.
   - Press to start a note.
   - Speak the note.
   - Press to stop.
   - Press to transcribe.
   - Review the transcript.
   - Press to save.

## Local Data

The local database is stored at:

```text
data/local-db.json
```

This file is ignored by git.

Reset local data from the web panel or by calling:

```bash
curl -X POST "http://localhost:5173/api/reset"
```

## Packaging

Build and package an `.ehpk`:

```bash
npm run pack
```

## Important P0 Limitations

- This is not production-ready.
- The local JSON database is only for development.
- No hospital SSO or role-based auth yet.
- No EHR/FHIR integration yet.
- No HIPAA-compliant deployment architecture yet.
- Transcription depends on the configured OpenAI API key.
- The app does not make clinical decisions or treatment recommendations.

## Future Production Direction

- Postgres for persistent records.
- Per-device and per-user authenticated sessions.
- Hospital SSO integration.
- Role-based access control.
- Full audit log and retention controls.
- FHIR/EHR integration.
- Realtime team updates through WebSocket or server-sent events.
- Healthcare-compliant deployment and vendor agreements for PHI handling.
