import asyncio
import os
import json
import time
import random
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import init_db, get_db
from .models import SecurityAuditEvent, ServerMetricSnapshot, GameItem
from .security_monitor import security_monitor
from .game_engine import game_manager, MAP_WIDTH, MAP_HEIGHT

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB (Postgres or fallback SQLite)
    security_monitor._loop = asyncio.get_running_loop()
    init_db()
    security_monitor.log_event(
        event_type="SERVER_STARTUP",
        severity="INFO",
        details={"service": "bomberman-backend", "engine": "authoritative-grid"}
    )
    yield
    security_monitor.log_event(
        event_type="SERVER_SHUTDOWN",
        severity="INFO",
        details={"status": "graceful"}
    )

app = FastAPI(
    title="Bomberman 2D Multiplayer - Game Server & Telemetry Monitor",
    version="1.0.0",
    description="Backend multijugador para Bomberman 2D con telemetría de servidor y validación de reglas en tiempo real.",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CreateRoomRequest(BaseModel):
    name: str
    host_id: str
    room_id: Optional[str] = None

class SimulateIncidentRequest(BaseModel):
    incident_type: str = "SPEED_HACK_SUSPECT"
    severity: str = "WARNING"
    details: Optional[dict] = None

class SpawnItemRequest(BaseModel):
    item_type: Optional[str] = "bonus_bomb"
    x: Optional[int] = None
    y: Optional[int] = None

class CollectItemRequest(BaseModel):
    player_id: str
    x: int
    y: int

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "bomberman-authoritative-server",
        "timestamp": time.time(),
        "summary": security_monitor.get_summary()
    }

@app.get("/api/rooms")
async def list_rooms():
    return game_manager.list_rooms()

@app.post("/api/rooms")
async def create_room(req: CreateRoomRequest):
    room_id = req.room_id or f"ROOM-{int(time.time() * 1000) % 100000}"
    room = game_manager.get_or_create_room(room_id, req.name, req.host_id)
    security_monitor.log_event(
        event_type="ROOM_CREATED",
        severity="INFO",
        room_id=room_id,
        player_id=req.host_id,
        details={"room_name": req.name}
    )
    return {"room_id": room.id, "name": room.name, "host_id": room.host_id}

@app.get("/api/rooms/{room_id}/items")
async def get_room_items(room_id: str):
    room = game_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return list(room.items.values())

@app.post("/api/rooms/{room_id}/spawn-item")
async def spawn_item_endpoint(room_id: str, req: SpawnItemRequest):
    room = game_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    item_type = req.item_type or "bonus_bomb"
    if req.x is not None and req.y is not None:
        tx, ty = req.x, req.y
    else:
        empty_tiles = [
            (x, y)
            for y in range(1, MAP_HEIGHT - 1)
            for x in range(1, MAP_WIDTH - 1)
            if room.grid[y][x] == 0 and f"{x}_{y}" not in room.bombs and f"{x}_{y}" not in room.items
        ]
        if not empty_tiles:
            raise HTTPException(status_code=400, detail="No empty tile available")
        tx, ty = random.choice(empty_tiles)

    item = room.spawn_item(tx, ty, item_type, spawn_method="REST_API_REQUEST")
    return {"status": "item_spawned", "item": item}

@app.post("/api/rooms/{room_id}/collect-item")
async def collect_item_endpoint(room_id: str, req: CollectItemRequest):
    room = game_manager.get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    result = room.collect_item(req.player_id, req.x, req.y)
    if not result:
        return {"status": "rejected_or_empty", "details": "No item on tile or invalid distance"}
    return {"status": "collected", "item": result}

@app.get("/api/items/audit")
def get_items_audit(limit: int = 50, db: Session = Depends(get_db)):
    items = db.query(GameItem).order_by(GameItem.spawned_at.desc()).limit(limit).all()
    return [
        {
            "id": i.id,
            "room_id": i.room_id,
            "item_type": i.item_type,
            "x": i.x,
            "y": i.y,
            "spawn_method": i.spawn_method,
            "spawned_at": i.spawned_at.isoformat() if i.spawned_at else None,
            "is_collected": i.is_collected,
            "collected_by": i.collected_by,
            "collected_at": i.collected_at.isoformat() if i.collected_at else None
        }
        for i in items
    ]

@app.get("/api/security/events")
def get_security_events(limit: int = 50, severity: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(SecurityAuditEvent).order_by(SecurityAuditEvent.timestamp.desc())
    if severity:
        query = query.filter(SecurityAuditEvent.severity == severity.upper())
    events = query.limit(limit).all()
    return [
        {
            "id": e.id,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
            "event_type": e.event_type,
            "severity": e.severity,
            "client_ip": e.client_ip,
            "player_id": e.player_id,
            "room_id": e.room_id,
            "details": e.details
        }
        for e in events
    ]

@app.get("/api/security/stats")
async def get_security_stats():
    return security_monitor.get_summary()

@app.post("/api/security/simulate-incident")
async def simulate_security_incident(req: SimulateIncidentRequest):
    """
    Endpoint para demostraciones académicas y pruebas de SIEM/SOC:
    Dispara un evento de ciberseguridad simulado.
    """
    security_monitor.log_event(
        event_type=req.incident_type,
        severity=req.severity,
        client_ip="192.168.1.105",
        player_id="test_intruder_42",
        details=req.details or {"description": "Simulación de inyección de paquetes anómalos para prueba de monitoreo"}
    )
    return {"status": "incident_dispatched", "type": req.incident_type}

# --- Game WebSocket ---
@app.websocket("/ws/game/{room_id}/{player_id}")
async def game_websocket(websocket: WebSocket, room_id: str, player_id: str):
    await websocket.accept()
    client_ip = websocket.client.host if websocket.client else "unknown"

    room = game_manager.get_or_create_room(room_id, f"Sala {room_id}", player_id)

    # Initial join handshake
    nickname = websocket.query_params.get("nickname", f"Player_{player_id[:4]}")
    color = websocket.query_params.get("color")
    player = room.add_player(player_id, nickname, websocket, client_ip)
    if color:
        player.color = color

    # Send room welcome packet
    await websocket.send_json({
        "type": "JOIN_SUCCESS",
        "player_id": player_id,
        "room_id": room_id,
        "slot": player.slot,
        "color": player.color,
        "is_host": (room.host_id == player_id)
    })

    try:
        while True:
            text_data = await websocket.receive_text()
            try:
                data = json.loads(text_data)
            except json.JSONDecodeError:
                security_monitor.log_event(
                    event_type="MALFORMED_PACKET",
                    severity="WARNING",
                    client_ip=client_ip,
                    player_id=player_id,
                    room_id=room_id,
                    details={"raw": text_data[:100]}
                )
                continue

            msg_type = data.get("type")

            if msg_type == "INPUT":
                await room.handle_input(player_id, data)
            elif msg_type == "START_GAME":
                if room.host_id == player_id:
                    room.start_game()
                else:
                    security_monitor.log_event(
                        event_type="UNAUTHORIZED_COMMAND",
                        severity="WARNING",
                        client_ip=client_ip,
                        player_id=player_id,
                        room_id=room_id,
                        details={"attempted": "START_GAME", "reason": "not_host"}
                    )
            elif msg_type == "READY":
                player.ready = not player.ready
            elif msg_type == "PING":
                await websocket.send_json({"type": "PONG", "client_time": data.get("client_time")})

    except WebSocketDisconnect:
        room.remove_player(player_id)
    except Exception as e:
        room.remove_player(player_id)

# --- Real-Time Cybersecurity SOC Monitor WebSocket ---
@app.websocket("/ws/security-monitor")
async def security_monitor_websocket(websocket: WebSocket):
    await security_monitor.register_monitor(websocket)
    try:
        while True:
            # Keep-alive loop or incoming telemetry queries
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        security_monitor.unregister_monitor(websocket)
    except Exception:
        security_monitor.unregister_monitor(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
