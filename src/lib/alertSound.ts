// Tiered in-app alert sound system for Navjyoti HRMS notifications.
// NORMAL: in-app toast only, no sound.
// HIGH: in-app toast + one noticeable alert sound while HRMS is open.
// CRITICAL: persistent in-app alert + repeating alert sound until acknowledged.

let audioContext: AudioContext | null = null
let activeOscillators: OscillatorNode[] = []
let activeTimeouts: number[] = []
let criticalInterval: number | null = null
let soundUnlocked = false

function getAudioContext(): AudioContext | null {
  if (audioContext && audioContext.state !== 'closed') return audioContext
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioContext = new Ctor()
    return audioContext
  } catch {
    return null
  }
}

// Must be called from a user gesture (click/tap) to unlock audio on browsers
export function unlockAlertSound(): boolean {
  const ctx = getAudioContext()
  if (!ctx) return false
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      soundUnlocked = true
    }).catch(() => {})
  } else {
    soundUnlocked = true
  }
  // Play a very short silent blip to fully unlock
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.01)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.02)
  } catch {
    // ignore
  }
  localStorage.setItem('navjyoti_alert_sound_unlocked', 'true')
  return true
}

export function isAlertSoundUnlocked(): boolean {
  return soundUnlocked || localStorage.getItem('navjyoti_alert_sound_unlocked') === 'true'
}

function stopAllSounds() {
  activeOscillators.forEach((osc) => {
    try { osc.stop() } catch { /* already stopped */ }
    try { osc.disconnect() } catch { /* already disconnected */ }
  })
  activeOscillators = []
  activeTimeouts.forEach((t) => clearTimeout(t))
  activeTimeouts = []
  if (criticalInterval !== null) {
    clearInterval(criticalInterval)
    criticalInterval = null
  }
}

// Play a single alert tone — two-note ascending chime
function playAlertTone(volume = 0.25): Promise<void> {
  return new Promise((resolve) => {
    const ctx = getAudioContext()
    if (!ctx || ctx.state === 'suspended') {
      resolve()
      return
    }

    const now = ctx.currentTime
    const notes = [880, 1320] // A5, E6 — noticeable two-note chime
    const noteDuration = 0.18
    const gap = 0.05

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'

      const start = now + i * (noteDuration + gap)
      gain.gain.setValueAtTime(0.001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteDuration)

      osc.start(start)
      osc.stop(start + noteDuration + 0.05)
      activeOscillators.push(osc)

      const timeout = window.setTimeout(() => {
        try { osc.disconnect() } catch { /* */ }
        activeOscillators = activeOscillators.filter((o) => o !== osc)
      }, (start + noteDuration + 0.1) * 1000 - now * 1000)
      activeTimeouts.push(timeout)
    })

    const totalDuration = (notes.length * (noteDuration + gap) + 0.2) * 1000
    const resolveTimeout = window.setTimeout(() => resolve(), totalDuration)
    activeTimeouts.push(resolveTimeout)
  })
}

export type AlertLevel = 'NORMAL' | 'HIGH' | 'CRITICAL'

export interface AlertOptions {
  level: AlertLevel
  soundEnabled: boolean
  title: string
  message: string
  actionUrl?: string
  onAcknowledge?: () => void
}

// Play the appropriate alert for a notification priority
export async function playAlertForPriority(priority: string, soundEnabled: boolean): Promise<void> {
  if (!soundEnabled) return
  if (!isAlertSoundUnlocked()) return

  const level = priorityToLevel(priority)
  if (level === 'NORMAL') return

  if (level === 'HIGH') {
    await playAlertTone(0.25)
  } else if (level === 'CRITICAL') {
    // Play repeating alert until acknowledged
    stopAllSounds()
    await playAlertTone(0.3)
    criticalInterval = window.setInterval(async () => {
      await playAlertTone(0.3)
    }, 3000)
  }
}

export function priorityToLevel(priority: string): AlertLevel {
  if (priority === 'urgent') return 'CRITICAL'
  if (priority === 'high') return 'HIGH'
  return 'NORMAL'
}

export function stopCriticalAlert() {
  stopAllSounds()
}

// Test button handler — plays one alert tone
export async function testAlertSound(): Promise<boolean> {
  if (!isAlertSoundUnlocked()) {
    unlockAlertSound()
  }
  await playAlertTone(0.25)
  return true
}
