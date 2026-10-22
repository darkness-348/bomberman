from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, Float, Boolean, JSON
from .database import Base

class Player(Base):
    __tablename__ = "players"

    id = Column(String(64), primary_key=True, index=True)
    nickname = Column(String(64), nullable=False)
    color = Column(String(32), default="white")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)
    last_ip = Column(String(45), nullable=True)
    total_matches = Column(Integer, default=0)
    total_wins = Column(Integer, default=0)
    total_bombs_dropped = Column(Integer, default=0)
    total_blocks_destroyed = Column(Integer, default=0)

class GameRoom(Base):
    __tablename__ = "game_rooms"

    id = Column(String(32), primary_key=True, index=True)
    name = Column(String(64), nullable=False)
    host_id = Column(String(64), nullable=False)
    status = Column(String(32), default="WAITING")  # WAITING, PLAYING, FINISHED
    max_players = Column(Integer, default=4)
    map_theme = Column(String(32), default="classic")
    created_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    winner_id = Column(String(64), nullable=True)

class SecurityAuditEvent(Base):
    """
    Security Audit Event Table for Server Monitoring and Cybersecurity Auditing
    Enables SOC/SIEM-level inspection of all gameplay events, anti-cheat alerts,
    and server telemetry.
    """
    __tablename__ = "security_audit_events"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    event_type = Column(String(64), index=True) 
    # AUTH_CONNECT, MOVE_VALIDATED, BOMB_PLACED, BLOCK_DESTROYED,
    # ANOMALOUS_SPEED_DETECTED, RATE_LIMIT_VIOLATION, OUT_OF_BOUNDS_PREVENTED,
    # ILLEGAL_ACTION, DISCONNECTED, INTEGRITY_CHECK
    severity = Column(String(16), default="INFO", index=True)  # INFO, WARNING, CRITICAL
    client_ip = Column(String(45), default="unknown", index=True)
    player_id = Column(String(64), nullable=True, index=True)
    room_id = Column(String(32), nullable=True, index=True)
    details = Column(JSON, default=dict)

class ServerMetricSnapshot(Base):
    """
    Server telemetry logs for performance and capacity monitoring
    """
    __tablename__ = "server_telemetry_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    cpu_percent = Column(Float, default=0.0)
    ram_percent = Column(Float, default=0.0)
    active_websockets = Column(Integer, default=0)
    active_rooms = Column(Integer, default=0)
    total_security_events = Column(Integer, default=0)
    anomalies_detected = Column(Integer, default=0)

class GameItem(Base):
    """
    Objetos y power-ups generados autoritativamente por el servidor.
    Permite registrar y auditar el ciclo de vida de cada objeto (aparición y recolección).
    """
    __tablename__ = "game_items"

    id = Column(String(64), primary_key=True, index=True)
    room_id = Column(String(32), index=True)
    item_type = Column(String(32), index=True)  # bonus_bomb, bonus_flame, bonus_speed, bonus_shield, bonus_life
    x = Column(Integer)
    y = Column(Integer)
    spawn_method = Column(String(32), default="BLOCK_DROP")  # BLOCK_DROP, SERVER_AIRDROP
    spawned_at = Column(DateTime, default=datetime.utcnow, index=True)
    collected_by = Column(String(64), nullable=True, index=True)
    collected_at = Column(DateTime, nullable=True)
    is_collected = Column(Boolean, default=False, index=True)

