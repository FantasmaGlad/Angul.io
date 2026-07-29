const MUSIC_VOLUME_KEY = 'angulio_music_volume';
const SFX_VOLUME_KEY = 'angulio_sfx_volume';

class AudioManager {
  private musicAudio: HTMLAudioElement | null = null;
  private currentMusicUrl: string | null = null;
  private musicVol: number;
  private sfxVol: number;

  constructor() {
    this.musicVol = this.loadStoredVolume(MUSIC_VOLUME_KEY, 0.5);
    this.sfxVol = this.loadStoredVolume(SFX_VOLUME_KEY, 0.7);
  }

  private loadStoredVolume(key: string, defaultValue: number): number {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val >= 0 && val <= 1) return val;
      }
    } catch {}
    return defaultValue;
  }

  public getMusicVolume(): number {
    return this.musicVol;
  }

  public getSfxVolume(): number {
    return this.sfxVol;
  }

  public setMusicVolume(vol: number): void {
    this.musicVol = Math.max(0, Math.min(1, vol));
    try {
      localStorage.setItem(MUSIC_VOLUME_KEY, this.musicVol.toString());
    } catch {}

    if (this.musicAudio) {
      this.musicAudio.volume = this.musicVol;
    }
  }

  public setSfxVolume(vol: number): void {
    this.sfxVol = Math.max(0, Math.min(1, vol));
    try {
      localStorage.setItem(SFX_VOLUME_KEY, this.sfxVol.toString());
    } catch {}
  }

  public playMusic(url: string, loop = true): void {
    if (this.currentMusicUrl === url && this.musicAudio && !this.musicAudio.paused) {
      return;
    }

    this.stopMusic();

    this.currentMusicUrl = url;
    const audio = new Audio(url);
    audio.loop = loop;
    audio.volume = this.musicVol;

    audio.play().catch(() => {
      // Autoplay restreint par le navigateur : déverrouillage automatique au premier clic/touche
      const unlock = () => {
        if (this.musicAudio === audio && audio.paused) {
          void audio.play().catch(() => {});
        }
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    });

    this.musicAudio = audio;
  }

  public stopMusic(): void {
    if (this.musicAudio) {
      this.musicAudio.pause();
      this.musicAudio.currentTime = 0;
      this.musicAudio = null;
    }
    this.currentMusicUrl = null;
  }
}

export const audioManager = new AudioManager();
