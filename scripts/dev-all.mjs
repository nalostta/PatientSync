import { spawn } from 'node:child_process'

const processes = [
  spawn('npm', ['run', 'api'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit' }),
]

function shutdown(signal) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal)
    }
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
  setTimeout(() => process.exit(0), 100)
})

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
  setTimeout(() => process.exit(0), 100)
})

processes.forEach(child => {
  child.on('exit', code => {
    if (code && code !== 0) {
      shutdown('SIGTERM')
      process.exit(code)
    }
  })
})
