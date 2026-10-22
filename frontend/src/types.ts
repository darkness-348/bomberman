export interface PlayerData {
  id: string;
  nickname: string;
  slot: number;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  is_moving: boolean;
  color: string;
  lives: number;
  alive: boolean;
  max_bombs: number;
  active_bombs: number;
  flame_range: number;
  speed: number;
  has_shield: boolean;
  score: number;
  ready: boolean;
}

export interface BombData {
  id: string;
  owner_id: string;
  x: number;
  y: number;
  fuse: number;
  progress: number;
}

export interface ExplosionData {
  x: number;
  y: number;
  is_center: boolean;
  progress: number;
}

export interface GameItemData {
  id: string;
  room_id: string;
  type: string;
  x: number;
  y: number;
  spawn_method: string;
  spawned_at: number;
}

export interface GameStateMessage {
  type: 'TICK';
  tick: number;
  status: 'WAITING' | 'PLAYING' | 'FINISHED';
  time_left: number;
  winner: string | null;
  players: PlayerData[];
  map: number[][];
  bombs: BombData[];
  explosions: ExplosionData[];
  items?: GameItemData[];
}

export interface SecurityEvent {
  id: number;
  timestamp: string;
  event_type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  client_ip: string;
  player_id?: string;
  room_id?: string;
  details: Record<string, any>;
}

export interface ServerTelemetry {
  uptime_seconds: number;
  active_monitors: number;
  total_packets: number;
  total_incidents: number;
  system: {
    cpu_percent: number;
    ram_percent: number;
    ram_used_mb: number;
    ram_total_mb: number;
  };
  status: 'NORMAL' | 'INVESTIGATING' | 'ALERT';
}
