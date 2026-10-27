# 💣 Bomberman 2D Multiplayer - Servidor Autoritativo & Monitoreo de Ciberseguridad (SOC)

Fangame de **Bomberman 2D multijugador en tiempo real**, desarrollado con arquitectura de **servidor autoritativo**, **FastAPI**, **WebSockets**, **TypeScript** y base de datos **PostgreSQL**, diseñado especialmente para proyectos finales de **Monitoreo de Servidores y Seguridad Informática**.

---

## 🛡️ Enfoque en Seguridad Informática y Monitoreo de Servidores

En los juegos multijugador convencionales, permitir que el cliente decida su posición o coloque bombas sin validación abre la puerta a vulnerabilidades graves (*Speed-Hacks*, *Wall-Hacks*, *Packet Flooding*, inyección de coordenadas falsas).

Este proyecto implementa un **Servidor Autoritativo con Inspección de Paquetes y Centro de Operaciones de Seguridad (SOC/SIEM)** integrado:

1. **Arquitectura Autoritativa (Zero Trust Client)**:
   - Los clientes únicamente envían intenciones de movimiento y pulsaciones (`INPUT`).
   - El backend en **FastAPI** calcula la física a 30Hz, verifica colisiones con la matriz del mapa y valida las reglas del juego.
2. **Sistema Anti-Trampas (Anti-Cheat Validation)**:
   - **Detección de Speed-Hack / Salto Anómalo**: Si la distancia recorrida excede la velocidad autorizada por el servidor en la ventana temporal, el servidor revoca la posición y registra un evento de severidad `WARNING`.
   - **Prevención de Traspaso de Muros (Out-of-Bounds / Wall-Pass)**: El servidor impide pisar bloques destructibles o indestructibles.
   - **Control de Cooldown y Capacidad de Bombas**: Previene spam de bombas ilegales.
3. **Limitación de Tasa y Mitigación de DoS (Rate Limiter)**:
   - Monitorea la frecuencia de paquetes por segundo de cada WebSocket (`> 45 pkts/seg` activa mitigación y alerta de seguridad).
4. **Auditoría Persistente en Base de Datos (PostgreSQL)**:
   - Todo evento (`AUTH_CONNECT`, `MOVE_VALIDATED`, `BOMB_PLACED`, `RATE_LIMIT_VIOLATION`, `OUT_OF_BOUNDS_PREVENTED`, `DISCONNECTED`) se almacena en la tabla `security_audit_events` con IP, marca temporal, severidad (`INFO`, `WARNING`, `CRITICAL`) y payload JSON forense.
5. **Dashboard SOC en Tiempo Real**:
   - Panel visual interactivo con métricas en vivo: Uso de CPU, Memoria RAM, sockets activos, tasa de paquetes, incidentes y visor forense de registros con opción de **Exportar Auditoría a JSON**.
   - Herramientas de simulación para pruebas en vivo ante evaluadores y docentes.

---

## 🎮 Características del Juego

- **Multijugador en Salas**: Creación de salas personalizadas, unirse por código de sala (`ROOM-XXXXX`), lobby con slots para hasta 4 jugadores y selección de color de avatar.
- **Gráficos y Animaciones 2D**: Sprites clásicos de Bomberman extraídos de `timnicolas/bomberman-assets` (animaciones direccionales al caminar, pulso elástico de bombas antes de detonar, fuego de explosión dinámico, partículas y efectos de destrucción).
- **Mecánica Clásica de Bomberman**:
  - Reacción en cadena de bombas.
  - Bloques destruibles con probabilidad de caída de Power-Ups.
  - Power-Ups incluidos: **+1 Capacidad de Bomba**, **+1 Alcance de Fuego**, **+Velocidad**, **🛡️ Escudo de Inmunidad Temporal**, **❤️ Vida Extra**.
- **Motor de Audio Integrado**: Efectos de sonido para soltar bomba, detonaciones superpuestas, recolección de бонуses, daño recibido, eliminación y música arcade de fondo.

---

## 🗄️ Base de Datos PostgreSQL

Por requerimiento, la base de datos corre en el puerto estándar: **`5432`**.

### Esquema Principal (`bomberman_db`):
- `players`: Perfil del jugador, IP de origen, partidas y victorias.
- `game_rooms`: Salas activas e historial de partidas.
- `game_items`: Registro del ciclo de vida de cada objeto generado en el servidor (`item_id`, tipo, coordenadas, método de aparición `BLOCK_DROP` o `SERVER_AIRDROP`, estado y jugador que lo recolectó).
- `security_audit_events`: Registro forense de seguridad informática y telemetría de eventos.
- `server_telemetry_snapshots`: Métricas periódicas de carga de servidor (CPU, RAM, conexiones).

---

## 📦 Generación de Objetos y Peticiones al Backend

Para cumplir con el monitoreo continuo de tráfico HTTP y base de datos, el backend genera y audita los objetos del juego tanto de forma pasiva como activa:

1. **Aparición por Destrucción de Bloques**: Al romperse una pared blanda, el servidor genera un objeto con ID único y lo registra en la tabla `game_items`.
2. **Suministro Dinámico del Servidor (Server Airdrop)**: Cada 20 segundos de partida, el servidor selecciona automáticamente una casilla libre y genera un suministro aéreo, notificando a los jugadores y registrando el evento `OBJECT_GENERATED`.
3. **Petición HTTP bajo demanda (`POST /api/rooms/{room_id}/spawn-item`)**: En la barra del juego se encuentra el botón **`📦 Pedir Suministro`**, que realiza una petición POST directa al backend para solicitar un objeto en la arena.
4. **Validación de Recolección (`POST /api/rooms/{room_id}/collect-item`)**: Al pasar sobre un objeto, el cliente envía la petición de recolección para que el backend valide la cercanía, actualice los stats del jugador y registre en BD `is_collected = True` y `collected_by`.
5. **Auditoría de Objetos (`GET /api/items/audit`)**: Endpoint para consultar el historial completo de objetos generados y recolectados con fines de auditoría forense.

> **Nota de Resiliencia**: Si PostgreSQL no está activo en el entorno local de pruebas, el backend activa automáticamente un fallback a SQLite local (`bomberman.db`) sin interrumpir la ejecución. Al desplegar en Docker, se conecta directamente al contenedor de PostgreSQL 16.

---

## 🚀 Despliegue con Docker (Listo para Servidor)

El proyecto incluye configuración completa de producción con `docker-compose.yml`.

### Requisitos:
- Docker y Docker Compose instalados en el servidor.

### Ejecución:
```bash
docker-compose up --build
```

### Servicios expuestos:
- **Frontend Web**: `http://localhost:3000`
- **Backend FastAPI & WebSockets**: `http://localhost:8000` (Documentación Swagger en `/docs`)
- **Base de Datos PostgreSQL**: `localhost:5432` (`bomberman_db`)

Para detener el servicio:
```bash
docker-compose down
```

---

## 💻 Ejecución Manual en Desarrollo Local

Si deseas ejecutar sin Docker en tu máquina:

### 1. Backend (FastAPI + Python 3.12+)
```bash
# Instalar dependencias
pip install -r backend/requirements.txt

# Iniciar servidor autoritativo
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend (Vite + TypeScript)
```bash
cd frontend

# Instalar paquetes
npm install

# Iniciar servidor de desarrollo
npm run dev
```
Abre en tu navegador: `http://localhost:5173`

---

## 🕹️ Controles del Juego

### 📱 En Celulares y Tablets (Controles Táctiles Integrados):
- **Cruceta Virtual (D-Pad)**: Toca o desliza el pulgar sobre la cruceta táctil en pantalla (▲ ▼ ◀ ▶) para mover a tu Bomberman con precisión milimétrica.
- **Botón de Bomba (💣)**: Botón arcade circular grande con vibración háptica al plantar bombas.
- **Botón de Suministro (📦)**: Solicita objetos o ventajas al servidor con un solo toque.
- **Botón de Controles (🎮 en el HUD)**: Permite alternar o forzar la visibilidad del mando táctil en pantalla cuando desees.
- **Interfaz 100% Responsive**: Ajuste automático para celulares en orientación vertical u horizontal, pantallas táctiles y tablets.

### 💻 En Computadora (Teclado):
| Tecla | Acción |
|---|---|
| **W / Flecha Arriba** | Moverse hacia Arriba |
| **S / Flecha Abajo** | Moverse hacia Abajo |
| **A / Flecha Izquierda** | Moverse hacia la Izquierda |
| **D / Flecha Derecha** | Moverse hacia la Derecha |
| **Barra Espaciadora** | Colocar Bomba |
| **Botón SOC (Cabecera)** | Abrir Panel de Ciberseguridad y Monitoreo |

---

## 🧪 Pruebas Automatizadas de Integración

Se incluye un script de prueba integral que valida la salud del servidor, la creación de salas, la conexión de múltiples jugadores mediante WebSockets, la colocación de bombas y el registro de auditoría en la base de datos:

```bash
python test_game.py
```
