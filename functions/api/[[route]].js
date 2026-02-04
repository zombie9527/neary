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
    const signal = await c.req.json() // { from, type, sdp/ice }
    const kv = c.env.KV

    const key = `${SIGNALS_PREFIX}${roomId}:${toDeviceId}`
    const existingSignalsStr = await kv.get(key)
    const signals = existingSignalsStr ? JSON.parse(existingSignalsStr) : []

    signals.push(signal)
    await kv.put(key, JSON.stringify(signals), { expirationTtl: 600 }) // Signals expire quickly

    return c.json({ success: true })
})

app.get('/signals/:roomId/:deviceId', async (c) => {
    const { roomId, deviceId } = c.req.param()
    const kv = c.env.KV

    const key = `${SIGNALS_PREFIX}${roomId}:${deviceId}`
    const signalsStr = await kv.get(key)

    if (signalsStr) {
        await kv.delete(key) // Consume signals
        return c.json(JSON.parse(signalsStr))
    }

    return c.json([])
})

export const onRequest = handle(app)
