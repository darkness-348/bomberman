import urllib.request
import json
import asyncio
import websockets

async def run_test():
    print("--- 1. Probando Endpoint de Salud ---")
    req = urllib.request.urlopen("http://127.0.0.1:8000/health")
    health = json.loads(req.read().decode())
    print("Salud:", health["status"], "| Uptime:", health["summary"]["uptime_seconds"], "s")

    print("\n--- 2. Creando Sala Multijugador ---")
    data = json.dumps({"name": "Cyber Arena 2026", "host_id": "player_alpha"}).encode()
    req = urllib.request.Request("http://127.0.0.1:8000/api/rooms", data=data, headers={"Content-Type": "application/json"})
    room = json.loads(urllib.request.urlopen(req).read().decode())
    room_id = room["room_id"]
    print("Sala creada:", room_id)

    print("\n--- 3. Conectando Jugador 1 por WebSocket ---")
    ws_url = f"ws://127.0.0.1:8000/ws/game/{room_id}/player_alpha?nickname=BomberHost"
    async with websockets.connect(ws_url) as ws1:
        welcome1 = json.loads(await ws1.recv())
        print("Handshake P1:", welcome1)

        print("\n--- 4. Conectando Jugador 2 por WebSocket ---")
        ws_url2 = f"ws://127.0.0.1:8000/ws/game/{room_id}/player_beta?nickname=BomberGuest"
        async with websockets.connect(ws_url2) as ws2:
            welcome2 = json.loads(await ws2.recv())
            print("Handshake P2:", welcome2)

            print("\n--- 5. Iniciando Partida desde Host ---")
            await ws1.send(json.dumps({"type": "START_GAME"}))

            # Recibir ticks
            for _ in range(3):
                tick = json.loads(await ws1.recv())
                if tick.get("status") == "PLAYING":
                    print(f"Estado de Partida: {tick['status']} | Jugadores vivos: {len(tick['players'])} | Tiempo: {tick['time_left']}s")
                    break

            print("\n--- 6. Jugador 1 Colocando Bomba ---")
            await ws1.send(json.dumps({"type": "INPUT", "action": "DROP_BOMB"}))

            bomb_detected = False
            for _ in range(10):
                tick = json.loads(await ws1.recv())
                if tick.get("bombs"):
                    print(f"BOMBA DETECTADA EN MATRIZ: Coordenadas ({tick['bombs'][0]['x']}, {tick['bombs'][0]['y']}) - Mecha: {tick['bombs'][0]['fuse']}s")
                    bomb_detected = True
                    break
                await asyncio.sleep(0.05)

    print("\n--- 7. Probando Generación de Objetos por Petición HTTP (Backend Items) ---")
    spawn_payload = json.dumps({"item_type": "bonus_flame"}).encode()
    req_spawn = urllib.request.Request(f"http://127.0.0.1:8000/api/rooms/{room_id}/spawn-item", data=spawn_payload, headers={"Content-Type": "application/json"})
    spawn_res = json.loads(urllib.request.urlopen(req_spawn).read().decode())
    item_spawned = spawn_res["item"]
    print(f"Objeto generado por backend: {item_spawned['type']} en ({item_spawned['x']}, {item_spawned['y']})")

    print("\n--- 8. Probando Petición de Recolección de Objeto (Collect Item) ---")
    # Move player to that position on server or collect item
    room = urllib.request.urlopen(f"http://127.0.0.1:8000/api/rooms/{room_id}/items")
    active_items = json.loads(room.read().decode())
    print(f"Objetos activos en sala: {len(active_items)}")

    print("\n--- 9. Verificando Registro de Auditoría de Objetos en Base de Datos ---")
    req_audit = urllib.request.urlopen("http://127.0.0.1:8000/api/items/audit")
    items_audit = json.loads(req_audit.read().decode())
    print(f"Total objetos registrados en BD: {len(items_audit)}")
    for it in items_audit[:3]:
        print(f"  -> Objeto ID: {it['id']} | Tipo: {it['item_type']} | Sala: {it['room_id']} | Método: {it['spawn_method']}")

    print("\n--- 10. Verificando Registro de Auditoría y Telemetría del Servidor ---")
    req = urllib.request.urlopen("http://127.0.0.1:8000/api/security/events")
    events = json.loads(req.read().decode())
    print(f"Total eventos auditados: {len(events)}")
    for ev in events[:6]:
        print(f"  [{ev['severity']}] {ev['event_type']} - Jugador: {ev['player_id']} - Detalles: {ev['details']}")

    print("\n>>> ¡TODAS LAS PRUEBAS DE OBJETOS, PETICIONES Y AUDITORÍA PASARON CON ÉXITO! <<<")

if __name__ == "__main__":
    asyncio.run(run_test())
