// Retro sound effects using Web Audio API - subtle and elegant

class SoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;
  private volume: number = 0.15; // Subtle volume

  constructor() {
    // Initialize audio context on first user interaction (browser requirement)
    if (typeof window !== 'undefined') {
      this.audioContext = null; // Lazy initialization
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  // Retro beep sound (like old computer)
  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume: number = this.volume): void {
    if (!this.enabled) return;
    
    try {
      const ctx = this.getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = type;
      
      // Envelope for smooth sound
      const now = ctx.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
      
      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch (e) {
      // Silently fail if audio context unavailable
    }
  }

  // Retro click sound
  playClick(): void {
    this.playTone(800, 0.05, 'square', 0.1);
  }

  // Retro select sound
  playSelect(): void {
    this.playTone(600, 0.08, 'sine', 0.12);
    setTimeout(() => this.playTone(800, 0.06, 'sine', 0.1), 30);
  }

  // Retro generation start sound
  playGenerationStart(): void {
    // Ascending retro beep
    this.playTone(400, 0.1, 'sine', 0.15);
    setTimeout(() => this.playTone(600, 0.1, 'sine', 0.12), 50);
    setTimeout(() => this.playTone(800, 0.1, 'sine', 0.1), 100);
  }

  // Retro generation complete sound
  playGenerationComplete(): void {
    // Pleasant completion chime
    this.playTone(523, 0.15, 'sine', 0.18); // C
    setTimeout(() => this.playTone(659, 0.15, 'sine', 0.15), 80); // E
    setTimeout(() => this.playTone(784, 0.2, 'sine', 0.12), 160); // G
  }

  // Retro error sound
  playError(): void {
    this.playTone(200, 0.2, 'sawtooth', 0.12);
  }

  // Retro hover sound (very subtle)
  playHover(): void {
    this.playTone(1000, 0.03, 'sine', 0.05);
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
