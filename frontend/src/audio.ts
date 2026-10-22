class AudioManager {
  private sounds: Map<string, HTMLAudioElement> = new Map();
  private bgm: HTMLAudioElement | null = null;
  private sfxMuted: boolean = false;
  private bgmMuted: boolean = false;
  private sfxVolume: number = 0.7;
  private bgmVolume: number = 0.35;
  private initialized: boolean = false;

  constructor() {
    this.preloadSound('bomb_drop', '/assets/sounds/put_bomb.ogg');
    this.preloadSound('explosion', '/assets/sounds/bomb_explosion.ogg');
    this.preloadSound('powerup', '/assets/sounds/bonus.wav');
    this.preloadSound('hurt', '/assets/sounds/player_hurt.wav');
    this.preloadSound('death', '/assets/sounds/player_death.wav');
    this.preloadSound('win', '/assets/sounds/win_music.ogg');
    
    // Background music
    try {
      this.bgm = new Audio('/assets/sounds/menu_loop.ogg');
      this.bgm.loop = true;
      this.bgm.volume = this.bgmVolume;
    } catch (e) {
      console.warn('BGM could not be initialized:', e);
    }
  }

  private preloadSound(name: string, url: string) {
    try {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = this.sfxVolume;
      this.sounds.set(name, audio);
    } catch (e) {
      console.warn(`Failed to preload audio ${name}:`, e);
    }
  }

  public initOnUserAction() {
    if (this.initialized) return;
    this.initialized = true;
    if (this.bgm && !this.bgmMuted) {
      this.bgm.play().catch(() => {});
    }
  }

  public play(name: string) {
    if (this.sfxMuted) return;
    const sound = this.sounds.get(name);
    if (sound) {
      // Clone audio to allow overlapping playback (e.g. rapid explosions)
      const clone = sound.cloneNode() as HTMLAudioElement;
      clone.volume = this.sfxVolume;
      clone.play().catch(() => {});
    }
  }

  public toggleSfx(): boolean {
    this.sfxMuted = !this.sfxMuted;
    return this.sfxMuted;
  }

  public toggleBgm(): boolean {
    this.bgmMuted = !this.bgmMuted;
    if (this.bgm) {
      if (this.bgmMuted) {
        this.bgm.pause();
      } else {
        this.bgm.play().catch(() => {});
      }
    }
    return this.bgmMuted;
  }

  public setSfxVolume(vol: number) {
    this.sfxVolume = Math.max(0, Math.min(1, vol));
  }

  public setBgmVolume(vol: number) {
    this.bgmVolume = Math.max(0, Math.min(1, vol));
    if (this.bgm) {
      this.bgm.volume = this.bgmVolume;
    }
  }

  public isSfxMuted() { return this.sfxMuted; }
  public isBgmMuted() { return this.bgmMuted; }
}

export const audioManager = new AudioManager();
