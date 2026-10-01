import { WasmEngine } from './dist/wasm-engine.mjs'
const e = new WasmEngine({ enableLogs: false, callbacks: {} })
const timer = setTimeout(() => process.exit(2),25000)
try {
 await e.initialize()
 await e.initVoipStack('1000000000:1@s.whatsapp.net','1000000000@s.whatsapp.net','1000000000@lid')
 await e.waitForVoipStackReady()
 if (!e.supportsIncomingCalls()) throw new Error('Native accept/reject methods missing')
 console.log('Native stack ready; accept and reject entry points available')
 clearTimeout(timer);e.destroy();process.exit(0)
} catch(err) { console.error(err.message);e.destroy();process.exit(1) }
