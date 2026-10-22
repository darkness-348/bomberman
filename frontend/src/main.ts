import './style.css';
import type { GameStateMessage, PlayerData } from './types';
import { audioManager } from './audio';
import { GameRenderer } from './renderer';
import { SecuritySOCMonitor } from './monitor';

// Configuration
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8000'
  : `${window.location.protocol}//${window.location.host}`;

const WS_BASE = API_BASE.replace('http://', 'ws://').replace('https://', 'wss://');

class BombermanApp {
  private playerId: string;
  private nickname: string;
  private selectedColor: string = '#ffffff';
  private currentRoomId: string | null = null;
  private isHost: boolean = false;
  private gameWs: WebSocket | null = null;
  private gameState: GameStateMessage | null = null;
  private renderer: GameRenderer | null = null;
  private socMonitor: SecuritySOCMonitor | null = null;

  // Key tracking
  private keysPressed: Set<string> = new Set();
  private lastMoveVector: { dx: number; dy: number; dir: string } = { dx: 0, dy: 0, dir: 'down' };
  private moveInterval: number | null = null;

  // Audio & Animation states
  private prevBombsCount: number = 0;
  private prevExplosionsCount: number = 0;
  private prevLives: number = 3;
  private lastTickTime: number = performance.now();
  private spectatingMode: boolean = false;
  private prevItemsCount: number = 0;

  constructor() {
    this.playerId = localStorage.getItem('bm_player_id') || `p_${Math.random().toString(36).substring(2, 8)}`;
    localStorage.setItem('bm_player_id', this.playerId);
    this.nickname = localStorage.getItem('bm_nickname') || `Bomber_${Math.floor(Math.random() * 900 + 100)}`;

    this.renderBaseLayout();
    this.setupGlobalControls();
    this.initSOC();
    this.showLobby();
  }

  private renderBaseLayout() {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <header class="app-header">
        <div class="logo-container">
          <img src="/assets/img/bomberman-logo.png" alt="Bomberman" class="logo-img" />
          <div class="logo-title">
            <h1>Bomberman 2D Multiplayer</h1>
            <div class="logo-subtitle">Edición Arcade Multijugador 2D</div>
          </div>
        </div>

        <div class="header-controls">
          <span class="server-badge" id="header-conn-status">🟢 En Línea</span>
          <button class="btn-icon" id="btn-toggle-sfx">🔊 SFX</button>
          <button class="btn-icon" id="btn-toggle-bgm">🎵 Música</button>
          <button class="btn-icon btn-soc" id="btn-open-soc">📊 Monitor de Servidor</button>
        </div>
      </header>

      <main class="main-content" id="main-view"></main>

      <div class="soc-container" id="soc-monitor-container"></div>
      <div class="toast-container" id="toast-container"></div>
    `;
  }

  private setupGlobalControls() {
    // Audio toggles
    document.getElementById('btn-toggle-sfx')?.addEventListener('click', (e) => {
      audioManager.initOnUserAction();
      const muted = audioManager.toggleSfx();
      (e.currentTarget as HTMLElement).textContent = muted ? '🔇 SFX (Mute)' : '🔊 SFX';
    });

    document.getElementById('btn-toggle-bgm')?.addEventListener('click', (e) => {
      audioManager.initOnUserAction();
      const muted = audioManager.toggleBgm();
      (e.currentTarget as HTMLElement).textContent = muted ? '🔈 Música (Off)' : '🎵 Música';
    });

    // SOC Monitor Open
    document.getElementById('btn-open-soc')?.addEventListener('click', () => {
      audioManager.initOnUserAction();
      this.socMonitor?.toggle();
    });

    // Global keyboard listeners
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      audioManager.initOnUserAction();
      this.keysPressed.add(e.key.toLowerCase());
      if (e.key === ' ' || e.code === 'Space') {
        this.dropBomb();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.key.toLowerCase());
    });
  }

  private initSOC() {
    const socContainer = document.getElementById('soc-monitor-container')!;
    this.socMonitor = new SecuritySOCMonitor(socContainer, `${WS_BASE}/ws/security-monitor`);
  }

  public showToast(message: string) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // --- LOBBY VIEW ---
  public async showLobby() {
    this.currentRoomId = null;
    this.disconnectGameWs();

    const mainView = document.getElementById('main-view')!;
    mainView.innerHTML = `
      <div class="lobby-layout">
        <!-- Profile Card -->
        <div class="card">
          <h3>🎮 Perfil del Jugador</h3>
          <div class="form-group">
            <label>Tu Apodo (Nickname)</label>
            <input type="text" class="input-text" id="nickname-input" value="${this.nickname}" maxlength="16" />
          </div>

          <div class="form-group">
            <label>Color de Bomberman</label>
            <div class="color-picker" id="color-picker-group">
              <div class="color-option selected" data-color="#ffffff" style="background: #ffffff;"></div>
              <div class="color-option" data-color="#ef233c" style="background: #ef233c;"></div>
              <div class="color-option" data-color="#3a86ff" style="background: #3a86ff;"></div>
              <div class="color-option" data-color="#06d6a0" style="background: #06d6a0;"></div>
              <div class="color-option" data-color="#ffbe0b" style="background: #ffbe0b;"></div>
              <div class="color-option" data-color="#2b2d42" style="background: #2b2d42;"></div>
            </div>
          </div>

          <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--surface-border);">
            <h3>🚀 Crear Nueva Sala</h3>
            <div class="form-group">
              <label>Nombre de la Sala</label>
              <input type="text" class="input-text" id="new-room-name" value="Sala de Combate" />
            </div>
            <button class="btn-primary" id="btn-create-room">Crear & Entrar a Sala</button>
          </div>
        </div>

        <!-- Rooms Browser & Direct Join -->
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <h3>🌐 Salas Disponibles en Servidor</h3>
            <button class="btn-icon" id="btn-refresh-rooms">🔄 Actualizar</button>
          </div>

          <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <input type="text" class="input-text" id="join-code-input" placeholder="Ingresa Código de Sala (ej: ROOM-12345)" />
            <button class="btn-secondary" style="width: auto; white-space: nowrap;" id="btn-join-code">Unirse por Código</button>
          </div>

          <div class="rooms-grid" id="rooms-list-container">
            <div style="color: #94a3b8; font-size: 0.9rem;">Cargando salas activas...</div>
          </div>
        </div>
      </div>
    `;

    // Nickname change
    document.getElementById('nickname-input')?.addEventListener('input', (e) => {
      this.nickname = (e.target as HTMLInputElement).value || 'Bomber';
      localStorage.setItem('bm_nickname', this.nickname);
    });

    // Color picker
    const colors = document.querySelectorAll('.color-option');
    colors.forEach((col) => {
      col.addEventListener('click', (e) => {
        colors.forEach((c) => c.classList.remove('selected'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('selected');
        this.selectedColor = target.getAttribute('data-color') || '#ffffff';
      });
    });

    // Create Room
    document.getElementById('btn-create-room')?.addEventListener('click', async () => {
      audioManager.initOnUserAction();
      const roomName = (document.getElementById('new-room-name') as HTMLInputElement).value || 'Sala Bomberman';
      try {
        const res = await fetch(`${API_BASE}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: roomName, host_id: this.playerId })
        });
        const data = await res.json();
        this.joinRoom(data.room_id, true);
      } catch (e) {
        this.showToast('Error conectando con el servidor al crear sala');
      }
    });

    // Join by Code
    document.getElementById('btn-join-code')?.addEventListener('click', () => {
      audioManager.initOnUserAction();
      const code = (document.getElementById('join-code-input') as HTMLInputElement).value.trim();
      if (code) {
        this.joinRoom(code, false);
      } else {
        this.showToast('Ingresa un código de sala válido');
      }
    });

    // Refresh Rooms
    document.getElementById('btn-refresh-rooms')?.addEventListener('click', () => this.fetchRooms());
    this.fetchRooms();
  }

  private async fetchRooms() {
    const container = document.getElementById('rooms-list-container');
    if (!container) return;

    try {
      const res = await fetch(`${API_BASE}/api/rooms`);
      const rooms = await res.json();

      if (rooms.length === 0) {
        container.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: #64748b; background: rgba(0,0,0,0.2); border-radius: 8px;">
            No hay salas activas en este momento. ¡Sé el primero en crear una!
          </div>
        `;
        return;
      }

      container.innerHTML = rooms
        .map(
          (r: any) => `
            <div class="room-card-item">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong style="color: #fff;">${r.name}</strong>
                  <span class="room-code-tag">${r.id}</span>
                </div>
                <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 6px;">
                  👥 ${r.players_count} / 4 Jugadores • Estado: <span style="color: ${r.status === 'PLAYING' ? '#ffbe0b' : '#06d6a0'}">${r.status}</span>
                </div>
              </div>
              <button class="btn-secondary join-room-btn" data-id="${r.id}" style="padding: 6px 12px; font-size: 0.85rem;">
                Entrar a Partida
              </button>
            </div>
          `
        )
        .join('');

      container.querySelectorAll('.join-room-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          audioManager.initOnUserAction();
          const rId = (e.currentTarget as HTMLElement).getAttribute('data-id');
          if (rId) this.joinRoom(rId, false);
        });
      });
    } catch (e) {
      container.innerHTML = `<div style="color: #ef4444;">Error consultando salas del servidor.</div>`;
    }
  }

  // --- JOIN ROOM / WAITING LOBBY ---
  public joinRoom(roomId: string, isHost: boolean) {
    this.currentRoomId = roomId;
    this.isHost = isHost;
    this.connectGameWs(roomId);
    this.showRoomLobby();
  }

  private connectGameWs(roomId: string) {
    this.disconnectGameWs();

    const wsUrl = `${WS_BASE}/ws/game/${roomId}/${this.playerId}?nickname=${encodeURIComponent(this.nickname)}&color=${encodeURIComponent(this.selectedColor)}`;
    this.gameWs = new WebSocket(wsUrl);

    this.gameWs.onopen = () => {
      this.showToast(`Conectado a sala ${roomId}`);
    };

    this.gameWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'JOIN_SUCCESS') {
          this.isHost = msg.is_host;
        } else if (msg.type === 'TICK') {
          this.handleGameTick(msg as GameStateMessage);
        }
      } catch (err) {
        console.warn('Game WS parse error:', err);
      }
    };

    this.gameWs.onclose = () => {
      this.showToast('Desconectado de la partida');
    };

    // Movement tick loop at ~30Hz
    if (this.moveInterval) clearInterval(this.moveInterval);
    this.moveInterval = window.setInterval(() => this.processMovementInput(), 33);
  }

  private disconnectGameWs() {
    if (this.moveInterval) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
    if (this.gameWs) {
      this.gameWs.close();
      this.gameWs = null;
    }
  }

  private showRoomLobby() {
    const mainView = document.getElementById('main-view')!;
    mainView.innerHTML = `
      <div class="card room-lobby-view">
        <div class="lobby-header-bar">
          <div>
            <h3>SALA DE ESPERA: <span style="color: var(--secondary); font-family: var(--font-mono);">${this.currentRoomId}</span></h3>
            <p style="font-size: 0.8rem; color: #94a3b8;">Comparte este código con tus amigos para jugar en red local o servidor</p>
          </div>
          <button class="btn-icon" id="btn-copy-code">📋 Copiar Código</button>
        </div>

        <div class="players-slots-grid" id="slots-grid-container">
          <!-- Rendered dynamically on TICK -->
          <div class="player-slot-card"><p>Esperando conexión...</p></div>
        </div>

        <div style="display: flex; gap: 14px; margin-top: 20px;">
          <button class="btn-secondary" id="btn-leave-room" style="width: 30%;">Salir al Menú</button>
          <button class="btn-primary" id="btn-start-game" style="width: 70%;" ${!this.isHost ? 'disabled style="opacity: 0.5;"' : ''}>
            ${this.isHost ? '▶ INICIAR PARTIDA AHORA' : 'Esperando que el Host inicie...'}
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-copy-code')?.addEventListener('click', () => {
      if (this.currentRoomId) {
        navigator.clipboard.writeText(this.currentRoomId);
        this.showToast('¡Código copiado al portapapeles!');
      }
    });

    document.getElementById('btn-leave-room')?.addEventListener('click', () => {
      this.showLobby();
    });

    document.getElementById('btn-start-game')?.addEventListener('click', () => {
      if (this.isHost && this.gameWs && this.gameWs.readyState === WebSocket.OPEN) {
        audioManager.initOnUserAction();
        this.gameWs.send(JSON.stringify({ type: 'START_GAME' }));
      }
    });
  }

  // --- GAME ARENA VIEW ---
  private showGameArena() {
    this.spectatingMode = false;
    const mainView = document.getElementById('main-view')!;
    mainView.innerHTML = `
      <div class="game-view-container">
        <!-- HUD Bar -->
        <div class="game-hud-bar">
          <div class="hud-stats-group">
            <div class="hud-stat-pill" id="hud-lives">❤️ 3 Vidas</div>
            <div class="hud-stat-pill" id="hud-bombs">💣 1/1 Bombas</div>
            <div class="hud-stat-pill" id="hud-flame">🔥 Alcance: 2</div>
            <div class="hud-stat-pill" id="hud-speed">⚡ Velocidad: 3.6</div>
            <div class="hud-stat-pill" id="hud-score">🏆 0 Puntos</div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="match-timer-badge" id="hud-timer">⏱️ 03:00</div>
            <button class="btn-icon" id="btn-request-supply" style="background: rgba(0, 245, 212, 0.15); border-color: var(--secondary); color: #00f5d4;">📦 Pedir Suministro</button>
            <button class="btn-icon" id="btn-hud-exit" style="background: rgba(239, 35, 60, 0.2); border-color: var(--danger); color: #ff8591;">🚪 Salir</button>
          </div>
        </div>

        <!-- Canvas Arena Frame -->
        <div class="canvas-frame">
          <canvas id="game-canvas" width="720" height="624"></canvas>

          <!-- Player Eliminated Modal -->
          <div class="game-over-modal" id="player-dead-overlay" style="display: none;">
            <h2 style="color: #ef4444;">💀 ¡HAS SIDO ELIMINADO!</h2>
            <p style="color: #cbd5e1; font-size: 1.05rem;">Te has quedado sin vidas en esta ronda.</p>
            <div style="display: flex; gap: 14px; margin-top: 14px;">
              <button class="btn-primary" id="btn-dead-exit" style="background: linear-gradient(135deg, #ef233c, #9d0208); width: auto; padding: 12px 28px;">🚪 Salir al Menú</button>
              <button class="btn-secondary" id="btn-dead-spectate" style="width: auto; padding: 12px 28px;">👀 Observar Partida</button>
            </div>
          </div>

          <!-- Match Over / Victory Modal -->
          <div class="game-over-modal" id="game-over-overlay" style="display: none;">
            <h2 id="winner-banner-text">¡VICTORIA!</h2>
            <p id="winner-sub-text" style="color: #cbd5e1; font-size: 1.1rem;"></p>
            <div style="display: flex; gap: 14px; margin-top: 14px;">
              <button class="btn-primary" id="btn-play-again" style="width: auto; padding: 12px 28px;">Volver a la Sala</button>
              <button class="btn-secondary" id="btn-return-lobby" style="width: auto; padding: 12px 28px;">Menú Principal</button>
            </div>
          </div>
        </div>

        <!-- Controls Hint Bar -->
        <div class="game-controls-hint">
          <span><span class="key-badge">W</span> <span class="key-badge">A</span> <span class="key-badge">S</span> <span class="key-badge">D</span> o <span class="key-badge">FLECHAS</span> : Moverse</span>
          <span><span class="key-badge">ESPACIO</span> : Colocar Bomba</span>
          <span><span class="key-badge">ESC</span> : Monitor</span>
        </div>
      </div>
    `;

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new GameRenderer(canvas);
    this.renderer.resize(720, 624);

    document.getElementById('btn-request-supply')?.addEventListener('click', async () => {
      audioManager.initOnUserAction();
      if (!this.currentRoomId) return;
      try {
        const pool = ['bonus_bomb', 'bonus_flame', 'bonus_speed', 'bonus_shield', 'bonus_life'];
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        const res = await fetch(`${API_BASE}/api/rooms/${this.currentRoomId}/spawn-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_type: chosen })
        });
        const data = await res.json();
        if (data.status === 'item_spawned') {
          this.showToast(`📦 Objeto generado por el servidor: ${data.item.type}`);
        }
      } catch (e) {
        this.showToast('Error enviando petición de objeto al servidor');
      }
    });

    document.getElementById('btn-hud-exit')?.addEventListener('click', () => {
      this.showLobby();
    });

    document.getElementById('btn-dead-exit')?.addEventListener('click', () => {
      this.showLobby();
    });

    document.getElementById('btn-dead-spectate')?.addEventListener('click', () => {
      this.spectatingMode = true;
      const deadOverlay = document.getElementById('player-dead-overlay');
      if (deadOverlay) deadOverlay.style.display = 'none';
      this.showToast('Modo observador activado. Puedes salir en cualquier momento usando el botón de Salir.');
    });

    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this.showRoomLobby();
    });

    document.getElementById('btn-return-lobby')?.addEventListener('click', () => {
      this.showLobby();
    });

    // Start requestAnimationFrame render loop - keeps running while canvas is mounted
    const animate = () => {
      const now = performance.now();
      const dt = (now - this.lastTickTime) / 1000;
      this.lastTickTime = now;

      if (this.renderer && this.gameState) {
        this.renderer.updateParticles(dt);
        this.renderer.render(
          this.gameState.map,
          this.gameState.bombs,
          this.gameState.explosions,
          this.gameState.players,
          this.playerId
        );
      }

      if (document.getElementById('game-canvas')) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  // --- INPUT HANDLING ---
  private processMovementInput() {
    if (!this.gameWs || this.gameWs.readyState !== WebSocket.OPEN) return;
    if (!this.gameState || this.gameState.status !== 'PLAYING') return;

    let dx = 0;
    let dy = 0;
    let dir = this.lastMoveVector.dir;

    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup')) {
      dy -= 1;
      dir = 'up';
    }
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown')) {
      dy += 1;
      dir = 'down';
    }
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft')) {
      dx -= 1;
      dir = 'left';
    }
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) {
      dx += 1;
      dir = 'right';
    }

    // Only send when vector or moving state changed or while continuously moving
    if (dx !== 0 || dy !== 0 || this.lastMoveVector.dx !== 0 || this.lastMoveVector.dy !== 0) {
      this.lastMoveVector = { dx, dy, dir };
      this.gameWs.send(
        JSON.stringify({
          type: 'INPUT',
          action: 'MOVE',
          dx,
          dy,
          direction: dir
        })
      );

      // Check if stepping on an item tile and trigger explicit REST request to backend
      if (this.currentRoomId && this.gameState && this.gameState.map) {
        const myP = this.gameState.players.find((p) => p.id === this.playerId);
        if (myP && myP.alive) {
          const tx = Math.round(myP.x);
          const ty = Math.round(myP.y);
          if (this.gameState.map[ty] && this.gameState.map[ty][tx] >= 3 && this.gameState.map[ty][tx] <= 7) {
            fetch(`${API_BASE}/api/rooms/${this.currentRoomId}/collect-item`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ player_id: this.playerId, x: tx, y: ty })
            }).catch(() => {});
          }
        }
      }
    }
  }

  private dropBomb() {
    if (!this.gameWs || this.gameWs.readyState !== WebSocket.OPEN) return;
    if (!this.gameState || this.gameState.status !== 'PLAYING') return;

    audioManager.play('bomb_drop');
    this.gameWs.send(
      JSON.stringify({
        type: 'INPUT',
        action: 'DROP_BOMB'
      })
    );
  }

  // --- STATE TICK HANDLER ---
  private handleGameTick(state: GameStateMessage) {
    this.gameState = state;

    // 1. If currently in room lobby and game switches to PLAYING
    const isInGameView = !!document.getElementById('game-canvas');

    if (state.status === 'PLAYING' && !isInGameView) {
      this.showGameArena();
    } else if (state.status === 'WAITING' && !isInGameView) {
      // Update slots in waiting room
      this.updateLobbySlots(state.players);
    }

    // 2. Audio & Particle effects triggers
    if (state.bombs.length < this.prevBombsCount) {
      audioManager.play('explosion');
    }
    this.prevBombsCount = state.bombs.length;

    // Check newly spawned explosions for particles
    if (state.explosions.length > this.prevExplosionsCount && this.renderer) {
      for (const exp of state.explosions) {
        if (exp.progress < 0.2) {
          this.renderer.spawnExplosionParticles(exp.x, exp.y);
        }
      }
    }
    this.prevExplosionsCount = state.explosions.length;

    // Check items spawned from backend
    if (state.items && state.items.length > this.prevItemsCount) {
      const newlySpawned = state.items.slice(this.prevItemsCount);
      const airdrop = newlySpawned.find((it) => it.spawn_method === 'SERVER_AIRDROP');
      if (airdrop) {
        this.showToast(`📦 ¡Suministro del Servidor generado en (${airdrop.x}, ${airdrop.y})!`);
      }
    }
    this.prevItemsCount = state.items ? state.items.length : 0;

    // My player stats update in HUD
    const myPlayer = state.players.find((p) => p.id === this.playerId);
    if (myPlayer) {
      if (myPlayer.lives < this.prevLives) {
        if (myPlayer.lives <= 0) {
          audioManager.play('death');
          this.showToast('¡Has sido eliminado!');
        } else {
          audioManager.play('hurt');
        }
      }
      this.prevLives = myPlayer.lives;
      this.updateHUD(myPlayer, state.time_left);

      // If eliminated and not spectating and match is not finished yet
      const deadOverlay = document.getElementById('player-dead-overlay');
      if (deadOverlay) {
        if (!myPlayer.alive && !this.spectatingMode && state.status !== 'FINISHED') {
          deadOverlay.style.display = 'flex';
        } else {
          deadOverlay.style.display = 'none';
        }
      }
    }

    // 3. Victory / Game Over Overlay
    const overlay = document.getElementById('game-over-overlay');
    if (overlay) {
      if (state.status === 'FINISHED') {
        const deadOverlay = document.getElementById('player-dead-overlay');
        if (deadOverlay) deadOverlay.style.display = 'none';

        overlay.style.display = 'flex';
        const winTitle = document.getElementById('winner-banner-text')!;
        const winSub = document.getElementById('winner-sub-text')!;
        if (state.winner && state.winner !== 'NOBODY (MUTUAL DESTRUCTION)' && state.winner !== 'EMPATE (MUTUA DESTRUCCIÓN)' && state.winner !== 'FIN DE PARTIDA') {
          audioManager.play('win');
          winTitle.textContent = `👑 ¡${state.winner.toUpperCase()} ES EL GANADOR!`;
          winSub.textContent = '¡Excelente partida! Puedes volver a la sala para una revancha.';
        } else {
          winTitle.textContent = '💥 ¡PARTIDA FINALIZADA!';
          winSub.textContent = state.winner === 'FIN DE PARTIDA' ? 'Has sido eliminado de la partida.' : 'Ningún jugador sobrevivió en la arena.';
        }
      } else {
        overlay.style.display = 'none';
      }
    }
  }

  private updateLobbySlots(players: PlayerData[]) {
    const container = document.getElementById('slots-grid-container');
    if (!container) return;

    container.innerHTML = players
      .map(
        (p) => `
        <div class="player-slot-card occupied">
          <div class="player-avatar-preview" style="background: ${p.color || '#fff'};">
            ${p.nickname ? p.nickname.charAt(0).toUpperCase() : 'B'}
          </div>
          <div>
            <div style="font-weight: 700; color: #fff;">${p.nickname} ${p.id === this.playerId ? '★ (Tú)' : ''}</div>
            <div style="font-size: 0.75rem; color: #94a3b8;">Slot ${p.slot + 1} • Color: ${p.color}</div>
          </div>
        </div>
      `
      )
      .join('');
  }

  private updateHUD(player: PlayerData, timeLeft: number) {
    const livesEl = document.getElementById('hud-lives');
    const bombsEl = document.getElementById('hud-bombs');
    const flameEl = document.getElementById('hud-flame');
    const speedEl = document.getElementById('hud-speed');
    const scoreEl = document.getElementById('hud-score');
    const timerEl = document.getElementById('hud-timer');

    if (livesEl) {
      let hearts = '';
      for (let i = 0; i < player.lives; i++) hearts += '❤️';
      livesEl.textContent = `${hearts || '💀'} ${player.lives} Vidas`;
      if (player.has_shield) livesEl.textContent += ' 🛡️ [ESCUDO]';
    }

    if (bombsEl) bombsEl.textContent = `💣 ${player.max_bombs - player.active_bombs}/${player.max_bombs} Bombas`;
    if (flameEl) flameEl.textContent = `🔥 Alcance: ${player.flame_range}`;
    if (speedEl) speedEl.textContent = `⚡ Vel: ${player.speed.toFixed(1)}`;
    if (scoreEl) scoreEl.textContent = `🏆 ${player.score} Pts`;

    if (timerEl) {
      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      timerEl.textContent = `⏱️ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      if (timeLeft <= 30) {
        timerEl.style.color = '#ef233c';
      }
    }
  }
}

// Start application
new BombermanApp();
