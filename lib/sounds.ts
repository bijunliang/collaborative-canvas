// Organic sound effects using Web Audio API - soft, satisfying, hand-drawn vibe

class SoundManager {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  private volume: number = 0.45;
  private playCount = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      this.audioContext = null;
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.45;
      this.masterGain.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  private async ensureContextReady(): Promise<void> {
    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  // Soft tone with gentle attack/decay for organic feel
  private playTone(
    frequency: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume: number = this.volume,
    attack = 0.015,
    decay = 0.08
  ): void {
    if (!this.enabled) return;
    try {
      const ctx = this.getAudioContext();
      const dest = this.masterGain || ctx.destination;
      // First 2 tones: use 50% volume to avoid loud burst when AudioContext first initializes
      const effectiveVolume = this.playCount >= 2 ? volume : volume * 0.5;
      this.playCount++;
      this.ensureContextReady().then(() => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(dest);
        oscillator.frequency.value = frequency;
        oscillator.type = type;
        const now = ctx.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(effectiveVolume, now + attack);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
        oscillator.start(now);
        oscillator.stop(now + duration);
      }).catch(() => {});
    } catch (_) {}
  }

  // Soft tap - like pencil on paper, warm and round
  playClick(): void {
    this.playTone(380, 0.08, 'sine', 0.12, 0.008, 0.1);
  }

  private lastSelectTime = 0;
  private SELECT_DEBOUNCE_MS = 100;

  // Two-note confirmation - gentle and satisfying (debounced to avoid double play)
  playSelect(): void {
    const now = Date.now();
    if (now - this.lastSelectTime < this.SELECT_DEBOUNCE_MS) return;
    this.lastSelectTime = now;
    this.playTone(420, 0.07, 'sine', 0.1, 0.01, 0.09);
    setTimeout(() => this.playTone(520, 0.1, 'sine', 0.09, 0.01, 0.12), 45);
  }

  // Ascending "starting" - soft, hopeful
  playGenerationStart(): void {
    this.playTone(330, 0.12, 'sine', 0.12, 0.02, 0.15);
    setTimeout(() => this.playTone(440, 0.12, 'sine', 0.1, 0.02, 0.15), 60);
    setTimeout(() => this.playTone(554, 0.14, 'sine', 0.08, 0.02, 0.18), 130);
  }

  // Pleasant completion - soft major chord
  playGenerationComplete(): void {
    this.playTone(523, 0.2, 'sine', 0.14, 0.02, 0.25); // C
    setTimeout(() => this.playTone(659, 0.2, 'sine', 0.12, 0.02, 0.25), 60);  // E
    setTimeout(() => this.playTone(784, 0.25, 'sine', 0.1, 0.02, 0.3), 120);  // G
  }

  // Soft "nope" - not harsh
  playError(): void {
    this.playTone(220, 0.18, 'sine', 0.1, 0.02, 0.2);
  }

  // Whisper-quiet feedback
  playHover(): void {
    this.playTone(600, 0.04, 'sine', 0.04, 0.005, 0.05);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }
}

// Singleton instance
export const soundManager = new SoundManager();
