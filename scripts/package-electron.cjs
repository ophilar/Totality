process.env.DEBUG = [process.env.DEBUG, 'electron-builder*'].filter(Boolean).join(',')

const { build } = require('electron-builder')

async function packageApplication() {
  try {
    const artifacts = await build()
    for (const artifact of artifacts ?? []) console.info(`[Packaging] Created artifact: ${artifact}`)
  } catch (error) {
  let current = error
  let causeIndex = 0
  while (current instanceof Error) {
    const detail = {
      name: current.name,
      message: current.message,
      code: 'code' in current ? current.code : undefined,
      errno: 'errno' in current ? current.errno : undefined,
      syscall: 'syscall' in current ? current.syscall : undefined,
      hostname: 'hostname' in current ? current.hostname : undefined,
    }
    console.error(`[Packaging] Failure cause ${++causeIndex}:`, JSON.stringify(detail))
    if (current.stack) console.error(current.stack)
    current = current.cause
  }
  if (causeIndex === 0) console.error('[Packaging] Build failed with a non-Error rejection:', error)
  process.exitCode = 1
}
}

void packageApplication()
