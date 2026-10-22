import type { PlayerData, BombData, ExplosionData } from './types';

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tileSize: number = 48;
  private images: Map<string, HTMLImageElement> = new Map();
  private animTick: number = 0;
  private particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    color: string;
    size: number;
  }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.loadAssets();
  }

  private loadAssets() {
    const assetsToLoad: Record<string, string> = {
      floor: '/assets/textures/000-floor.png',
      hard_wall: '/assets/textures/001-durable_wall.png',
      soft_wall: '/assets/textures/002-destructible_wall.png',
      player_down: '/assets/textures/player/008-playerBott.png',
      player_face: '/assets/textures/player/009-playerFace.png',
      player_side: '/assets/textures/player/010-playerSide.png',
      player_up: '/assets/textures/player/011-playerTop.png',
      bomb: '/assets/textures/bomb/005-bombFace.png',
      bonus_bomb: '/assets/textures/bonus/013-bonus_bomb.png',
      bonus_flame: '/assets/textures/bonus/014-bonus_flame.png',
      bonus_speed: '/assets/textures/bonus/015-bonus_speed.png',
      bonus_shield: '/assets/textures/bonus/020-bonus_shield.png',
      bonus_life: '/assets/textures/bonus/012-bonus_life.png',
    };

    for (const [key, src] of Object.entries(assetsToLoad)) {
      const img = new Image();
      img.src = src;
      img.onerror = () => {
        console.warn(`Failed loading image: ${src}`);
      };
      this.images.set(key, img);
    }
  }

  public resize(width: number = 720, height: number = 624) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.tileSize = width / 15;
  }

  public spawnExplosionParticles(tileX: number, tileY: number) {
    const cx = (tileX + 0.5) * this.tileSize;
    const cy = (tileY + 0.5) * this.tileSize;
    const colors = ['#ff4800', '#ff9900', '#ffee55', '#ffffff'];

    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 80 + 30;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 3
      });
    }
  }

  public updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size = Math.max(0.5, p.size * 0.96);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  public render(
    map: number[][],
    bombs: BombData[],
    explosions: ExplosionData[],
    players: PlayerData[],
    myPlayerId: string | null
  ) {
    this.animTick += 0.05;
    const ctx = this.ctx;
    const ts = this.tileSize;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!map || map.length === 0) return;

    // 1. Draw Map (Floor, Hard Walls, Soft Walls, Power-ups)
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        const cell = map[y][x];
        const px = x * ts;
        const py = y * ts;

        // Draw Floor Tile
        const floorImg = this.images.get('floor');
        if (floorImg && floorImg.complete && floorImg.naturalWidth > 0) {
          ctx.drawImage(floorImg, px, py, ts, ts);
        } else {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#2d6a4f' : '#23533e';
          ctx.fillRect(px, py, ts, ts);
        }

        // Draw Cell Object
        if (cell === 1) {
          // Hard Wall
          const img = this.images.get('hard_wall');
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, px, py, ts, ts);
          } else {
            ctx.fillStyle = '#495057';
            ctx.fillRect(px, py, ts, ts);
            ctx.strokeStyle = '#212529';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, ts, ts);
          }
        } else if (cell === 2) {
          // Soft Wall
          const img = this.images.get('soft_wall');
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, px, py, ts, ts);
          } else {
            ctx.fillStyle = '#b07d62';
            ctx.fillRect(px + 2, py + 2, ts - 4, ts - 4);
          }
        } else if (cell >= 3 && cell <= 7) {
          // Power-up with gentle floating bounce & halo
          const bounce = Math.sin(this.animTick * 3 + x + y) * 3;
          let bonusKey = 'bonus_bomb';
          let haloColor = '#ffbe0b';

          if (cell === 3) { bonusKey = 'bonus_bomb'; haloColor = '#ff0055'; }
          else if (cell === 4) { bonusKey = 'bonus_flame'; haloColor = '#ff7b00'; }
          else if (cell === 5) { bonusKey = 'bonus_speed'; haloColor = '#00f5d4'; }
          else if (cell === 6) { bonusKey = 'bonus_shield'; haloColor = '#7b2cbf'; }
          else if (cell === 7) { bonusKey = 'bonus_life'; haloColor = '#e63946'; }

          // Halo glow
          ctx.save();
          ctx.shadowColor = haloColor;
          ctx.shadowBlur = 10;
          const bImg = this.images.get(bonusKey);
          if (bImg && bImg.complete && bImg.naturalWidth > 0) {
            ctx.drawImage(bImg, px + 6, py + 6 + bounce, ts - 12, ts - 12);
          } else {
            ctx.fillStyle = haloColor;
            ctx.beginPath();
            ctx.arc(px + ts / 2, py + ts / 2 + bounce, ts / 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }

    // 2. Draw Bombs
    for (const b of bombs) {
      const bx = b.x * ts;
      const by = b.y * ts;
      // Heartbeat pulse calculation
      const pulse = 1.0 + Math.sin(this.animTick * 8) * 0.08 * (1.0 + b.progress);

      ctx.save();
      ctx.translate(bx + ts / 2, by + ts / 2);
      ctx.scale(pulse, pulse);

      const bombImg = this.images.get('bomb');
      if (bombImg && bombImg.complete && bombImg.naturalWidth > 0) {
        ctx.drawImage(bombImg, -ts / 2 + 4, -ts / 2 + 4, ts - 8, ts - 8);
      } else {
        ctx.fillStyle = '#111111';
        ctx.beginPath();
        ctx.arc(0, 0, ts / 2.3, 0, Math.PI * 2);
        ctx.fill();
        // Fuse spark
        ctx.fillStyle = '#ff2200';
        ctx.beginPath();
        ctx.arc(0, -ts / 2.5, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Remaining fuse arc
      ctx.strokeStyle = '#ffdd00';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, ts / 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.progress));
      ctx.stroke();

      ctx.restore();
    }

    // 3. Draw Explosions
    for (const exp of explosions) {
      const ex = exp.x * ts;
      const ey = exp.y * ts;
      const alpha = Math.max(0.2, 1.0 - exp.progress);

      ctx.save();
      ctx.globalAlpha = alpha;

      // Radial blast fire gradient
      const grad = ctx.createRadialGradient(
        ex + ts / 2, ey + ts / 2, 4,
        ex + ts / 2, ey + ts / 2, ts / 1.8
      );
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#ffea00');
      grad.addColorStop(0.7, '#ff5400');
      grad.addColorStop(1, 'rgba(255, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex + ts / 2, ey + ts / 2, ts * 0.7, 0, Math.PI * 2);
      ctx.fill();

      // Core flame diamond
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(ex + ts * 0.25, ey + ts * 0.25, ts * 0.5, ts * 0.5);

      ctx.restore();
    }

    // 4. Draw Particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. Draw Players
    for (const p of players) {
      const px = p.x * ts;
      const py = p.y * ts;

      ctx.save();

      if (!p.alive) {
        // Tombstone / Skull for eliminated player
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#6c757d';
        ctx.fillRect(px + ts * 0.2, py + ts * 0.3, ts * 0.6, ts * 0.6);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('RIP', px + ts / 2, py + ts * 0.65);
        ctx.restore();
        continue;
      }

      // Base footprint ring matching player color
      ctx.fillStyle = p.color || '#3a86ff';
      ctx.beginPath();
      ctx.ellipse(px + ts / 2, py + ts * 0.85, ts * 0.35, ts * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();

      // Select sprite based on direction
      let spriteKey = 'player_down';
      let flipX = false;

      if (p.direction === 'up') spriteKey = 'player_up';
      else if (p.direction === 'left') { spriteKey = 'player_side'; flipX = true; }
      else if (p.direction === 'right') { spriteKey = 'player_side'; flipX = false; }
      else spriteKey = 'player_down';

      const playerImg = this.images.get(spriteKey);

      // Walking bounce
      const walkBounce = p.is_moving ? Math.sin(this.animTick * 12) * 2 : 0;

      if (flipX) {
        ctx.translate(px + ts, py);
        ctx.scale(-1, 1);
        if (playerImg && playerImg.complete && playerImg.naturalWidth > 0) {
          ctx.drawImage(playerImg, 2, 2 + walkBounce, ts - 4, ts - 4);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(4, 4, ts - 8, ts - 8);
        }
        ctx.scale(-1, 1);
        ctx.translate(-(px + ts), -py);
      } else {
        if (playerImg && playerImg.complete && playerImg.naturalWidth > 0) {
          ctx.drawImage(playerImg, px + 2, py + 2 + walkBounce, ts - 4, ts - 4);
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(px + 4, py + 4, ts - 8, ts - 8);
        }
      }

      // Shield bubble
      if (p.has_shield) {
        ctx.save();
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#00f5d4';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(px + ts / 2, py + ts / 2, ts * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Nickname & Health Badge
      const isMe = p.id === myPlayerId;
      ctx.font = isMe ? 'bold 11px Inter, sans-serif' : '10px Inter, sans-serif';
      ctx.textAlign = 'center';

      // Badge background pill
      const nameText = isMe ? `★ ${p.nickname}` : p.nickname;
      const textWidth = ctx.measureText(nameText).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.beginPath();
      ctx.roundRect(px + ts / 2 - textWidth / 2 - 4, py - 18, textWidth + 8, 14, 4);
      ctx.fill();

      ctx.fillStyle = isMe ? '#ffd166' : '#ffffff';
      ctx.fillText(nameText, px + ts / 2, py - 7);

      // Lives Hearts
      let hearts = '';
      for (let h = 0; h < p.lives; h++) hearts += '❤️';
      ctx.font = '8px sans-serif';
      ctx.fillText(hearts, px + ts / 2, py - 20);

      ctx.restore();
    }
  }
}
