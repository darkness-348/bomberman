import asyncio
import time
from datetime import datetime
import random
import math
from typing import Dict, List, Optional, Any, Set
from fastapi import WebSocket
from .security_monitor import security_monitor
from .database import get_db_session
from .models import GameItem

MAP_WIDTH = 15
MAP_HEIGHT = 13
TILE_EMPTY = 0
TILE_HARD_WALL = 1
TILE_SOFT_WALL = 2
TILE_POWERUP_BOMB = 3
TILE_POWERUP_FLAME = 4
TILE_POWERUP_SPEED = 5
TILE_POWERUP_SHIELD = 6
TILE_POWERUP_LIFE = 7

ITEM_NAME_TO_TILE = {
    "bonus_bomb": TILE_POWERUP_BOMB,
    "bonus_flame": TILE_POWERUP_FLAME,
    "bonus_speed": TILE_POWERUP_SPEED,
    "bonus_shield": TILE_POWERUP_SHIELD,
    "bonus_life": TILE_POWERUP_LIFE,
}
TILE_TO_ITEM_NAME = {v: k for k, v in ITEM_NAME_TO_TILE.items()}

SPAWN_POINTS = [
    (1, 1),
    (MAP_WIDTH - 2, 1),
    (1, MAP_HEIGHT - 2),
    (MAP_WIDTH - 2, MAP_HEIGHT - 2),
]

PLAYER_COLORS = ["#ffffff", "#2b2d42", "#ef233c", "#3a86ff", "#06d6a0", "#ffbe0b"]

def generate_map() -> List[List[int]]:
    """
    Generates an authentic Bomberman grid:
    - Border walls around perimeter
    - Indestructible pillars at every odd x, y
    - Destructible blocks randomly placed, leaving spawns clear
    """
    grid = [[TILE_EMPTY for _ in range(MAP_WIDTH)] for _ in range(MAP_HEIGHT)]

    # Hard walls around border
    for y in range(MAP_HEIGHT):
        for x in range(MAP_WIDTH):
            if x == 0 or x == MAP_WIDTH - 1 or y == 0 or y == MAP_HEIGHT - 1:
                grid[y][x] = TILE_HARD_WALL
            elif x % 2 == 0 and y % 2 == 0:
                grid[y][x] = TILE_HARD_WALL

    # Safe spawn regions (3 tiles around each spawn)
    safe_tiles = set()
    for sx, sy in SPAWN_POINTS:
        safe_tiles.add((sx, sy))
        safe_tiles.add((sx + 1, sy))
        safe_tiles.add((sx - 1, sy))
        safe_tiles.add((sx, sy + 1))
        safe_tiles.add((sx, sy - 1))

    # Place soft walls
    for y in range(MAP_HEIGHT):
        for x in range(MAP_WIDTH):
            if grid[y][x] == TILE_EMPTY and (x, y) not in safe_tiles:
                if random.random() < 0.68:  # 68% chance of soft wall
                    grid[y][x] = TILE_SOFT_WALL

    return grid


class PlayerState:
    def __init__(self, player_id: str, nickname: str, slot: int, client_ip: str = "127.0.0.1"):
        self.id = player_id
        self.nickname = nickname
        self.slot = slot
        self.client_ip = client_ip
        spawn_x, spawn_y = SPAWN_POINTS[slot % len(SPAWN_POINTS)]
        self.x: float = float(spawn_x)
        self.y: float = float(spawn_y)
        self.vx: float = 0.0
        self.vy: float = 0.0
        self.direction: str = "down"
        self.is_moving: bool = False
        self.color: str = PLAYER_COLORS[slot % len(PLAYER_COLORS)]
        self.lives: int = 3
        self.alive: bool = True
        self.max_bombs: int = 1
        self.active_bombs: int = 0
        self.flame_range: int = 2
        self.speed: float = 3.6  # tiles per second
        self.has_shield: bool = False
        self.shield_timer: float = 0.0
        self.score: int = 0
        self.last_bomb_drop: float = 0.0
        self.last_move_packet: float = time.time()
        self.total_moves: int = 0
        self.ready: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "nickname": self.nickname,
            "slot": self.slot,
            "x": round(self.x, 3),
            "y": round(self.y, 3),
            "direction": self.direction,
            "is_moving": self.is_moving,
            "color": self.color,
            "lives": self.lives,
            "alive": self.alive,
            "max_bombs": self.max_bombs,
            "active_bombs": self.active_bombs,
            "flame_range": self.flame_range,
            "speed": round(self.speed, 2),
            "has_shield": self.has_shield,
            "score": self.score,
            "ready": self.ready
        }


class Bomb:
    def __init__(self, bomb_id: str, owner_id: str, x: int, y: int, flame_range: int, fuse: float = 3.0):
        self.id = bomb_id
        self.owner_id = owner_id
        self.x = x
        self.y = y
        self.flame_range = flame_range
        self.fuse = fuse
        self.max_fuse = fuse
        self.created_at = time.time()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "owner_id": self.owner_id,
            "x": self.x,
            "y": self.y,
            "fuse": max(0.0, round(self.fuse, 2)),
            "progress": round(1.0 - (self.fuse / self.max_fuse), 2)
        }


class ExplosionCell:
    def __init__(self, x: int, y: int, is_center: bool = False, duration: float = 0.65):
        self.x = x
        self.y = y
        self.is_center = is_center
        self.duration = duration
        self.max_duration = duration

    def to_dict(self) -> dict:
        return {
            "x": self.x,
            "y": self.y,
            "is_center": self.is_center,
            "progress": round(1.0 - (self.duration / self.max_duration), 2)
        }


class GameRoomInstance:
    """
    Authoritative server-side Game Room.
    Handles tick loops, physics collisions, bomb chain reactions, anti-cheat audits,
    and WebSocket broadcasting.
    """
    def __init__(self, room_id: str, name: str, host_id: str):
        self.id = room_id
        self.name = name
        self.host_id = host_id
        self.status = "WAITING"  # WAITING, PLAYING, FINISHED
        self.grid = generate_map()
        self.players: Dict[str, PlayerState] = {}
        self.websockets: Dict[str, WebSocket] = {}
        self.bombs: Dict[str, Bomb] = {}
        self.explosions: List[ExplosionCell] = []
        self.items: Dict[str, dict] = {}
        self.airdrop_timer: float = 20.0
        self.match_time_left: float = 180.0  # 3 minutes
        self.winner: Optional[str] = None
        self.tick_counter: int = 0
        self.loop_task: Optional[asyncio.Task] = None
        self.last_tick_time: float = time.time()

    def spawn_item(self, tx: int, ty: int, item_type: str, spawn_method: str = "BLOCK_DROP") -> dict:
        if tx < 1 or tx >= MAP_WIDTH - 1 or ty < 1 or ty >= MAP_HEIGHT - 1:
            return {}
        if self.grid[ty][tx] == TILE_HARD_WALL:
            return {}

        tile_code = ITEM_NAME_TO_TILE.get(item_type, TILE_POWERUP_BOMB)
        self.grid[ty][tx] = tile_code
        item_id = f"item_{self.id}_{tx}_{ty}_{int(time.time() * 1000)}"

        item_data = {
            "id": item_id,
            "room_id": self.id,
            "type": item_type,
            "x": tx,
            "y": ty,
            "spawn_method": spawn_method,
            "spawned_at": time.time()
        }
        self.items[f"{tx}_{ty}"] = item_data

        security_monitor.log_event(
            event_type="OBJECT_GENERATED",
            severity="INFO",
            room_id=self.id,
            details={
                "item_id": item_id,
                "item_type": item_type,
                "tile": [tx, ty],
                "spawn_method": spawn_method
            }
        )

        asyncio.create_task(self._persist_spawned_item(item_id, item_type, tx, ty, spawn_method))
        return item_data

    async def _persist_spawned_item(self, item_id: str, item_type: str, x: int, y: int, spawn_method: str):
        try:
            db = get_db_session()
            try:
                new_item = GameItem(
                    id=item_id,
                    room_id=self.id,
                    item_type=item_type,
                    x=x,
                    y=y,
                    spawn_method=spawn_method,
                    is_collected=False
                )
                db.add(new_item)
                db.commit()
            finally:
                db.close()
        except Exception:
            pass

    def collect_item(self, player_id: str, tx: int, ty: int) -> Optional[dict]:
        player = self.players.get(player_id)
        if not player or not player.alive:
            return None

        item_key = f"{tx}_{ty}"
        item_obj = self.items.get(item_key)
        cell_item = self.grid[ty][tx]

        if not item_obj and cell_item not in ITEM_NAME_TO_TILE.values():
            return None

        # Distance validation
        dist = math.hypot(player.x - tx, player.y - ty)
        if dist > 1.25:
            security_monitor.log_event(
                event_type="UNAUTHORIZED_COLLECTION_ATTEMPT",
                severity="WARNING",
                client_ip=player.client_ip,
                player_id=player_id,
                room_id=self.id,
                details={"player_pos": [round(player.x, 2), round(player.y, 2)], "item_pos": [tx, ty], "dist": round(dist, 2)}
            )
            return None

        item_type = item_obj["type"] if item_obj else TILE_TO_ITEM_NAME.get(cell_item, "bonus_bomb")
        item_id = item_obj["id"] if item_obj else f"item_{self.id}_{tx}_{ty}"

        # Clear tile and items registry
        self.grid[ty][tx] = TILE_EMPTY
        if item_key in self.items:
            del self.items[item_key]

        # Apply bonus
        if item_type == "bonus_bomb":
            player.max_bombs = min(6, player.max_bombs + 1)
        elif item_type == "bonus_flame":
            player.flame_range = min(7, player.flame_range + 1)
        elif item_type == "bonus_speed":
            player.speed = min(5.8, player.speed + 0.5)
        elif item_type == "bonus_shield":
            player.has_shield = True
            player.shield_timer = 15.0
        elif item_type == "bonus_life":
            player.lives = min(5, player.lives + 1)

        player.score += 150

        security_monitor.log_event(
            event_type="OBJECT_COLLECTED",
            severity="INFO",
            client_ip=player.client_ip,
            player_id=player_id,
            room_id=self.id,
            details={"item_id": item_id, "item_type": item_type, "tile": [tx, ty], "score": player.score}
        )

        asyncio.create_task(self._persist_collected_item(item_id, player_id))
        return {"item_id": item_id, "item_type": item_type, "tile": [tx, ty], "score": player.score}

    async def _persist_collected_item(self, item_id: str, player_id: str):
        try:
            db = get_db_session()
            try:
                db_item = db.query(GameItem).filter(GameItem.id == item_id).first()
                if db_item:
                    db_item.is_collected = True
                    db_item.collected_by = player_id
                    db_item.collected_at = datetime.utcnow()
                    db.commit()
            finally:
                db.close()
        except Exception:
            pass

    def add_player(self, player_id: str, nickname: str, ws: WebSocket, client_ip: str) -> PlayerState:
        slot = len(self.players)
        player = PlayerState(player_id, nickname, slot, client_ip)
        self.players[player_id] = player
        self.websockets[player_id] = ws

        security_monitor.log_event(
            event_type="AUTH_CONNECT",
            severity="INFO",
            client_ip=client_ip,
            player_id=player_id,
            room_id=self.id,
            details={"action": "joined_room", "nickname": nickname, "slot": slot}
        )
        return player

    def remove_player(self, player_id: str):
        if player_id in self.websockets:
            del self.websockets[player_id]
        if player_id in self.players:
            p = self.players[player_id]
            security_monitor.log_event(
                event_type="DISCONNECTED",
                severity="INFO",
                client_ip=p.client_ip,
                player_id=player_id,
                room_id=self.id,
                details={"action": "left_room", "nickname": p.nickname}
            )
            del self.players[player_id]

        if not self.players and self.loop_task:
            self.loop_task.cancel()
            self.loop_task = None

    def start_game(self):
        if self.status == "PLAYING":
            return
        self.status = "PLAYING"
        self.grid = generate_map()
        self.bombs.clear()
        self.explosions.clear()
        self.items.clear()
        self.airdrop_timer = 20.0
        self.match_time_left = 180.0
        self.winner = None

        # Reset player stats & positions
        for idx, (pid, p) in enumerate(self.players.items()):
            sx, sy = SPAWN_POINTS[idx % len(SPAWN_POINTS)]
            p.x = float(sx)
            p.y = float(sy)
            p.vx = 0.0
            p.vy = 0.0
            p.lives = 3
            p.alive = True
            p.max_bombs = 1
            p.active_bombs = 0
            p.flame_range = 2
            p.speed = 3.6
            p.has_shield = False
            p.score = 0

        security_monitor.log_event(
            event_type="ROOM_STATE_CHANGE",
            severity="INFO",
            player_id=self.host_id,
            room_id=self.id,
            details={"action": "game_started", "players_count": len(self.players)}
        )

        if not self.loop_task or self.loop_task.done():
            self.loop_task = asyncio.create_task(self.game_loop())

    async def handle_input(self, player_id: str, payload: dict):
        player = self.players.get(player_id)
        if not player or not player.alive or self.status != "PLAYING":
            return

        # Cybersecurity rate-limiting check per client
        if not security_monitor.record_packet(player_id):
            return

        action = payload.get("action")
        if action == "MOVE":
            dx = float(payload.get("dx", 0.0))
            dy = float(payload.get("dy", 0.0))
            direction = str(payload.get("direction", player.direction))

            # Normalize movement vector
            length = math.sqrt(dx * dx + dy * dy)
            if length > 0.001:
                player.vx = (dx / length) * player.speed
                player.vy = (dy / length) * player.speed
                player.is_moving = True
                player.direction = direction
            else:
                player.vx = 0.0
                player.vy = 0.0
                player.is_moving = False

            player.total_moves += 1
            # Sample audit log every 40 moves to trace player telemetry
            if player.total_moves % 40 == 0:
                security_monitor.log_event(
                    event_type="MOVE_VALIDATED",
                    severity="INFO",
                    client_ip=player.client_ip,
                    player_id=player_id,
                    room_id=self.id,
                    details={"x": round(player.x, 2), "y": round(player.y, 2), "speed": player.speed}
                )

        elif action == "DROP_BOMB":
            now = time.time()
            # Anti-cheat check: bomb cooldown
            if now - player.last_bomb_drop < 0.25:
                security_monitor.log_event(
                    event_type="RATE_LIMIT_VIOLATION",
                    severity="WARNING",
                    client_ip=player.client_ip,
                    player_id=player_id,
                    room_id=self.id,
                    details={"violation": "bomb_drop_spam", "delta": now - player.last_bomb_drop}
                )
                return

            if player.active_bombs >= player.max_bombs:
                return

            bx = int(round(player.x))
            by = int(round(player.y))

            # Ensure inside map boundaries
            if bx < 1 or bx >= MAP_WIDTH - 1 or by < 1 or by >= MAP_HEIGHT - 1:
                return

            # Check if bomb already on this tile
            bomb_key = f"{bx}_{by}"
            if bomb_key in self.bombs:
                return

            player.last_bomb_drop = now
            player.active_bombs += 1
            new_bomb = Bomb(
                bomb_id=f"bomb_{self.id}_{self.tick_counter}_{bx}_{by}",
                owner_id=player_id,
                x=bx,
                y=by,
                flame_range=player.flame_range
            )
            self.bombs[bomb_key] = new_bomb

            security_monitor.log_event(
                event_type="BOMB_PLACED",
                severity="INFO",
                client_ip=player.client_ip,
                player_id=player_id,
                room_id=self.id,
                details={"tile": [bx, by], "range": player.flame_range}
            )

    def is_tile_solid(self, tx: int, ty: int, for_player: Optional[PlayerState] = None) -> bool:
        if tx < 0 or tx >= MAP_WIDTH or ty < 0 or ty >= MAP_HEIGHT:
            return True
        cell = self.grid[ty][tx]
        if cell in [TILE_HARD_WALL, TILE_SOFT_WALL]:
            return True

        # Check bombs (if player is not already standing on it)
        bomb_key = f"{tx}_{ty}"
        if bomb_key in self.bombs:
            if for_player:
                # If player is currently occupying the bomb's tile center, allow exiting
                if int(round(for_player.x)) == tx and int(round(for_player.y)) == ty:
                    return False
            return True
        return False

    def update_player_physics(self, player: PlayerState, dt: float):
        if not player.alive or not player.is_moving:
            return

        target_x = player.x + player.vx * dt
        target_y = player.y + player.vy * dt

        # Bounding box collision size
        radius = 0.38

        # --- Collision on X axis ---
        can_move_x = True
        test_y_points = [player.y - radius, player.y, player.y + radius]
        check_x = target_x + (radius if player.vx > 0 else -radius)
        tx = int(math.floor(check_x + 0.5))

        for test_y in test_y_points:
            ty = int(math.floor(test_y + 0.5))
            if self.is_tile_solid(tx, ty, player):
                can_move_x = False
                break

        if can_move_x:
            player.x = target_x
        else:
            # Corner sliding assist along Y axis
            nearest_center_y = round(player.y)
            diff = nearest_center_y - player.y
            if abs(diff) > 0.05:
                player.y += math.copysign(min(abs(diff), player.speed * dt * 0.7), diff)

        # --- Collision on Y axis ---
        can_move_y = True
        test_x_points = [player.x - radius, player.x, player.x + radius]
        check_y = target_y + (radius if player.vy > 0 else -radius)
        ty = int(math.floor(check_y + 0.5))

        for test_x in test_x_points:
            tx = int(math.floor(test_x + 0.5))
            if self.is_tile_solid(tx, ty, player):
                can_move_y = False
                break

        if can_move_y:
            player.y = target_y
        else:
            # Corner sliding assist along X axis
            nearest_center_x = round(player.x)
            diff = nearest_center_x - player.x
            if abs(diff) > 0.05:
                player.x += math.copysign(min(abs(diff), player.speed * dt * 0.7), diff)

        # Anti-cheat bounds check
        if player.x < 1.0 or player.x > MAP_WIDTH - 2.0 or player.y < 1.0 or player.y > MAP_HEIGHT - 2.0:
            security_monitor.log_event(
                event_type="OUT_OF_BOUNDS_PREVENTED",
                severity="WARNING",
                client_ip=player.client_ip,
                player_id=player.id,
                room_id=self.id,
                details={"position": [player.x, player.y]}
            )
            player.x = max(1.0, min(float(MAP_WIDTH - 2), player.x))
            player.y = max(1.0, min(float(MAP_HEIGHT - 2), player.y))

        # Check pickup of powerups using authoritative collect_item
        curr_tx = int(round(player.x))
        curr_ty = int(round(player.y))
        cell_item = self.grid[curr_ty][curr_tx]
        if cell_item in ITEM_NAME_TO_TILE.values() or f"{curr_tx}_{curr_ty}" in self.items:
            self.collect_item(player.id, curr_tx, curr_ty)

    def trigger_explosion(self, bomb: Bomb):
        owner = self.players.get(bomb.owner_id)
        if owner and owner.active_bombs > 0:
            owner.active_bombs -= 1

        # Center of explosion
        exploded_cells = [(bomb.x, bomb.y, True)]
        directions = [(0, -1), (0, 1), (-1, 0), (1, 0)]

        for dx, dy in directions:
            for dist in range(1, bomb.flame_range + 1):
                tx = bomb.x + dx * dist
                ty = bomb.y + dy * dist

                if tx < 0 or tx >= MAP_WIDTH or ty < 0 or ty >= MAP_HEIGHT:
                    break

                cell = self.grid[ty][tx]
                if cell == TILE_HARD_WALL:
                    # Blocked by unbreakable wall
                    break

                if cell == TILE_SOFT_WALL:
                    # Destroys soft wall
                    exploded_cells.append((tx, ty, False))
                    # Chance to generate power-up item object on backend
                    roll = random.random()
                    if roll < 0.12:
                        self.spawn_item(tx, ty, "bonus_bomb", "BLOCK_DROP")
                    elif roll < 0.24:
                        self.spawn_item(tx, ty, "bonus_flame", "BLOCK_DROP")
                    elif roll < 0.33:
                        self.spawn_item(tx, ty, "bonus_speed", "BLOCK_DROP")
                    elif roll < 0.40:
                        self.spawn_item(tx, ty, "bonus_shield", "BLOCK_DROP")
                    elif roll < 0.45:
                        self.spawn_item(tx, ty, "bonus_life", "BLOCK_DROP")
                    else:
                        self.grid[ty][tx] = TILE_EMPTY

                    if owner:
                        owner.score += 50
                    break

                # If another bomb is here: chain explode it immediately
                chain_key = f"{tx}_{ty}"
                if chain_key in self.bombs and chain_key != f"{bomb.x}_{bomb.y}":
                    other_bomb = self.bombs[chain_key]
                    other_bomb.fuse = 0.0

                exploded_cells.append((tx, ty, False))

        for cx, cy, is_center in exploded_cells:
            self.explosions.append(ExplosionCell(cx, cy, is_center))

    def check_explosion_damage(self):
        for exp in self.explosions:
            for pid, player in self.players.items():
                if not player.alive:
                    continue
                # Distance to explosion center
                dist = math.sqrt((player.x - exp.x) ** 2 + (player.y - exp.y) ** 2)
                if dist < 0.65:
                    if player.has_shield:
                        player.has_shield = False
                        security_monitor.log_event(
                            event_type="SHIELD_ABSORBED_HIT",
                            severity="INFO",
                            client_ip=player.client_ip,
                            player_id=pid,
                            room_id=self.id,
                            details={"tile": [exp.x, exp.y]}
                        )
                    else:
                        player.lives -= 1
                        if player.lives <= 0:
                            player.alive = False
                            security_monitor.log_event(
                                event_type="PLAYER_ELIMINATED",
                                severity="INFO",
                                client_ip=player.client_ip,
                                player_id=pid,
                                room_id=self.id,
                                details={"killer_bomb_owner": "explosion", "tile": [exp.x, exp.y]}
                            )
                        else:
                            security_monitor.log_event(
                                event_type="PLAYER_HURT",
                                severity="INFO",
                                client_ip=player.client_ip,
                                player_id=pid,
                                room_id=self.id,
                                details={"lives_left": player.lives}
                            )

    async def game_loop(self):
        tick_rate = 30.0  # 30 ticks per sec
        tick_interval = 1.0 / tick_rate
        self.last_tick_time = time.time()

        try:
            while self.status == "PLAYING" and self.players:
                loop_start = time.time()
                dt = min(0.05, max(0.005, loop_start - self.last_tick_time))
                self.last_tick_time = loop_start
                self.tick_counter += 1

                # Update match timer
                self.match_time_left -= dt
                if self.match_time_left <= 0:
                    self.status = "FINISHED"
                    self.winner = "DRAW / TIME OUT"

                # Update players
                for player in self.players.values():
                    if player.has_shield and player.shield_timer > 0:
                        player.shield_timer -= dt
                        if player.shield_timer <= 0:
                            player.has_shield = False

                    self.update_player_physics(player, dt)

                # Update bombs
                exploded_bombs = []
                for b_key, bomb in list(self.bombs.items()):
                    bomb.fuse -= dt
                    if bomb.fuse <= 0:
                        exploded_bombs.append(bomb)
                        del self.bombs[b_key]

                for bomb in exploded_bombs:
                    self.trigger_explosion(bomb)

                # Update explosions
                active_exp = []
                for exp in self.explosions:
                    exp.duration -= dt
                    if exp.duration > 0:
                        active_exp.append(exp)
                self.explosions = active_exp

                # Check damage
                if self.explosions:
                    self.check_explosion_damage()

                # Check victory condition
                alive_players = [p for p in self.players.values() if p.alive]
                if len(self.players) == 1 and len(alive_players) == 0:
                    self.status = "FINISHED"
                    self.winner = "FIN DE PARTIDA"
                    security_monitor.log_event(
                        event_type="MATCH_FINISHED",
                        severity="INFO",
                        room_id=self.id,
                        details={"winner": self.winner}
                    )
                elif len(self.players) > 1 and len(alive_players) <= 1:
                    self.status = "FINISHED"
                    self.winner = alive_players[0].nickname if alive_players else "EMPATE (MUTUA DESTRUCCIÓN)"
                    security_monitor.log_event(
                        event_type="MATCH_FINISHED",
                        severity="INFO",
                        room_id=self.id,
                        details={"winner": self.winner}
                    )

                # Dynamic backend server airdrop
                self.airdrop_timer -= dt
                if self.airdrop_timer <= 0:
                    self.airdrop_timer = 20.0
                    empty_tiles = [
                        (x, y)
                        for y in range(1, MAP_HEIGHT - 1)
                        for x in range(1, MAP_WIDTH - 1)
                        if self.grid[y][x] == TILE_EMPTY and f"{x}_{y}" not in self.bombs and f"{x}_{y}" not in self.items
                    ]
                    if empty_tiles:
                        rx, ry = random.choice(empty_tiles)
                        bonus_pool = ["bonus_bomb", "bonus_flame", "bonus_speed", "bonus_shield", "bonus_life"]
                        chosen = random.choice(bonus_pool)
                        self.spawn_item(rx, ry, chosen, spawn_method="SERVER_AIRDROP")

                # Broadcast state
                await self.broadcast_state()

                elapsed = time.time() - loop_start
                sleep_time = max(0.001, tick_interval - elapsed)
                await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            pass

    async def broadcast_state(self):
        if not self.websockets:
            return

        state = {
            "type": "TICK",
            "tick": self.tick_counter,
            "status": self.status,
            "time_left": int(max(0, self.match_time_left)),
            "winner": self.winner,
            "players": [p.to_dict() for p in self.players.values()],
            "map": self.grid,
            "bombs": [b.to_dict() for b in self.bombs.values()],
            "explosions": [e.to_dict() for e in self.explosions],
            "items": list(self.items.values())
        }

        dead_connections = []
        for pid, ws in self.websockets.items():
            try:
                await ws.send_json(state)
            except Exception:
                dead_connections.append(pid)

        for pid in dead_connections:
            self.remove_player(pid)


class GameManager:
    def __init__(self):
        self.rooms: Dict[str, GameRoomInstance] = {}

    def get_or_create_room(self, room_id: str, name: str, host_id: str) -> GameRoomInstance:
        if room_id not in self.rooms:
            self.rooms[room_id] = GameRoomInstance(room_id, name, host_id)
        return self.rooms[room_id]

    def get_room(self, room_id: str) -> Optional[GameRoomInstance]:
        return self.rooms.get(room_id)

    def list_rooms(self) -> list:
        return [
            {
                "id": r.id,
                "name": r.name,
                "players_count": len(r.players),
                "status": r.status,
                "host_id": r.host_id
            }
            for r in self.rooms.values()
        ]

game_manager = GameManager()
