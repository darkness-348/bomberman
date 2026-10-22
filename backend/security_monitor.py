import asyncio
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
from collections import deque
import psutil
from fastapi import WebSocket
from .database import get_db_session
from .models import SecurityAuditEvent, ServerMetricSnapshot

class SecurityMonitorManager:
    """
    Core Cybersecurity & Telemetry Monitoring Service.
    Monitors player packets, detects anomalies (speed hacks, teleport, packet flood,
    illegal bomb spawning), persists audit logs to DB, and streams real-time SOC
    events to the monitoring dashboard.
    """
    def __init__(self):
        self.active_monitors: List[WebSocket] = []
        self.recent_events: deque = deque(maxlen=250)
        self.client_packet_counters: Dict[str, List[float]] = {}
        self.incident_count: int = 0
        self.total_packets_received: int = 0
        self.start_time: float = time.time()
        self._loop = None

    async def register_monitor(self, websocket: WebSocket):
        await websocket.accept()
        self.active_monitors.append(websocket)
        # Send initial snapshot
        summary = self.get_summary()
        await websocket.send_json({
            "type": "INITIAL_SNAPSHOT",
            "summary": summary,
            "recent_events": list(self.recent_events)[-50:]
        })

    def unregister_monitor(self, websocket: WebSocket):
        if websocket in self.active_monitors:
            self.active_monitors.remove(websocket)

    def record_packet(self, client_id: str) -> bool:
        """
        Rate limiting check: returns False if client is exceeding max packets per second (DDoS/Spam)
        """
        self.total_packets_received += 1
        now = time.time()
        timestamps = self.client_packet_counters.get(client_id, [])
        # Keep only timestamps in the last 1.0 second
        timestamps = [t for t in timestamps if now - t <= 1.0]
        timestamps.append(now)
        self.client_packet_counters[client_id] = timestamps

        if len(timestamps) > 45:  # Over 45 packets/sec threshold
            self.log_event(
                event_type="RATE_LIMIT_VIOLATION",
                severity="WARNING",
                client_ip="ws_client",
                player_id=client_id,
                details={
                    "packets_per_sec": len(timestamps),
                    "action": "packet_throttled",
                    "reason": "Exceeded 45 pkts/sec limit"
                }
            )
            return False
        return True

    def log_event(
        self,
        event_type: str,
        severity: str = "INFO",
        client_ip: str = "127.0.0.1",
        player_id: Optional[str] = None,
        room_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        if details is None:
            details = {}

        now = datetime.utcnow()
        if severity in ["WARNING", "CRITICAL"]:
            self.incident_count += 1

        event_payload = {
            "id": len(self.recent_events) + 1,
            "timestamp": now.isoformat(),
            "event_type": event_type,
            "severity": severity,
            "client_ip": client_ip,
            "player_id": player_id,
            "room_id": room_id,
            "details": details
        }
        self.recent_events.append(event_payload)

        # Broadcast asynchronously to live monitors & persist to DB
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._broadcast_event(event_payload))
            loop.create_task(self._persist_event(event_type, severity, client_ip, player_id, room_id, details))
        except RuntimeError:
            if self._loop and self._loop.is_running():
                asyncio.run_coroutine_threadsafe(self._broadcast_event(event_payload), self._loop)
                asyncio.run_coroutine_threadsafe(self._persist_event(event_type, severity, client_ip, player_id, room_id, details), self._loop)

    async def _broadcast_event(self, event_data: dict):
        if not self.active_monitors:
            return
        dead = []
        for ws in self.active_monitors:
            try:
                await ws.send_json({
                    "type": "SECURITY_EVENT",
                    "event": event_data,
                    "summary": self.get_summary()
                })
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unregister_monitor(ws)

    async def _persist_event(self, event_type, severity, client_ip, player_id, room_id, details):
        try:
            db = get_db_session()
            try:
                db_event = SecurityAuditEvent(
                    event_type=event_type,
                    severity=severity,
                    client_ip=client_ip,
                    player_id=player_id,
                    room_id=room_id,
                    details=details
                )
                db.add(db_event)
                db.commit()
            finally:
                db.close()
        except Exception as e:
            pass

    def get_summary(self) -> dict:
        uptime_seconds = int(time.time() - self.start_time)
        cpu_usage = psutil.cpu_percent(interval=None)
        memory = psutil.virtual_memory()

        return {
            "uptime_seconds": uptime_seconds,
            "active_monitors": len(self.active_monitors),
            "total_packets": self.total_packets_received,
            "total_incidents": self.incident_count,
            "system": {
                "cpu_percent": cpu_usage,
                "ram_percent": memory.percent,
                "ram_used_mb": round(memory.used / (1024 * 1024), 1),
                "ram_total_mb": round(memory.total / (1024 * 1024), 1)
            },
            "status": "NORMAL" if self.incident_count == 0 or (time.time() - self.start_time > 10 and self.recent_events and self.recent_events[-1]["severity"] == "INFO") else "INVESTIGATING"
        }

security_monitor = SecurityMonitorManager()
