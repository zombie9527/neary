import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'

const app = new Hono().basePath('/api')

// Signaling logic using KV for relay
// KEYS:
// room:signals:<roomId>:<toDeviceId> -> Array of signals for a specific device
// room:host:<roomId> -> DeviceId of the host

const SIGNALS_PREFIX = 'room:signals:'
const HOST_PREFIX = 'room:host:'

// Host management
app.get('/join/:roomId/:deviceId', async (c) => {
    const { roomId, deviceId } = c.req.param()
    const kv = c.env.KV

    const hostKey = `${HOST_PREFIX}${roomId}`
    let hostId = await kv.get(hostKey)

    const isHost = !hostId || hostId === deviceId
    if (isHost && !hostId) {
        await kv.put(hostKey, deviceId, { expirationTtl: 3600 })
        hostId = deviceId
    }

    return c.json({ isHost, hostId })
})

// Signal relay
app.post('/signal/:roomId/:toDeviceId', async (c) => {
    const { roomId, toDeviceId } = c.req.param()
    const signal = await c.req.json() // { from, type, data }
    const kv = c.env.KV

    // Use a unique key per signal to avoid race conditions
    const sigId = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
    const key = `${SIGNALS_PREFIX}${roomId}:${toDeviceId}:${sigId}`

    await kv.put(key, JSON.stringify(signal), { expirationTtl: 300 }) // 5 min TTL is plenty

    return c.json({ success: true })
})

app.get('/signals/:roomId/:deviceId', async (c) => {
    const { roomId, deviceId } = c.req.param()
    const kv = c.env.KV

    const prefix = `${SIGNALS_PREFIX}${roomId}:${deviceId}:`

    // List all signal keys for this device
    const list = await kv.list({ prefix })
    const signals = []

    // Fetch and collect signals
    for (const key of list.keys) {
        const val = await kv.get(key.name)
        if (val) {
            signals.push(JSON.parse(val))
            // Consume signal
            await kv.delete(key.name)
        }
    }

    return c.json(signals)
})

export const onRequest = handle(app)
