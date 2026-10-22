import type { SecurityEvent, ServerTelemetry } from './types';

export class SecuritySOCMonitor {
  private ws: WebSocket | null = null;
  private events: SecurityEvent[] = [];
  private telemetry: ServerTelemetry | null = null;
  private container: HTMLElement;
  private isOpen: boolean = false;
  private filterSeverity: string = 'ALL';
  private wsUrl: string;

  constructor(container: HTMLElement, wsUrl: string) {
    this.container = container;
    this.wsUrl = wsUrl;
    this.connect();
    this.render();
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'INITIAL_SNAPSHOT') {
            this.telemetry = data.summary;
            this.events = data.recent_events || [];
            this.updateView();
          } else if (data.type === 'SECURITY_EVENT') {
            this.telemetry = data.summary;
            if (data.event) {
              this.events.unshift(data.event);
              if (this.events.length > 200) this.events.pop();
            }
            this.updateView();
          }
        } catch (err) {
          console.warn('Failed parsing security socket data:', err);
        }
      };

      this.ws.onclose = () => {
        setTimeout(() => this.connect(), 4000);
      };
    } catch (e) {
      console.warn('Security monitor WS connection failed:', e);
    }
  }

  public toggle() {
    this.isOpen = !this.isOpen;
    this.container.classList.toggle('soc-open', this.isOpen);
    this.updateView();
  }

  public async simulateIncident(type: string, severity: string) {
    try {
      const backendUrl = this.wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws/security-monitor', '');
      await fetch(`${backendUrl}/api/security/simulate-incident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_type: type,
          severity: severity,
          details: {
            simulation_source: 'SOC_TEST_PANEL',
            description: `Ataque simulado de prueba de seguridad: ${type}`,
            target_service: 'Bomberman Server Authoritative Logic'
          }
        })
      });
    } catch (err) {
      console.error('Failed triggering simulated incident:', err);
    }
  }

  public exportAuditLogs() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.events, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `bomberman_security_audit_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  private render() {
    this.container.innerHTML = `
      <div class="soc-modal-backdrop"></div>
      <div class="soc-modal-window">
        <div class="soc-header">
          <div class="soc-title">
            <span class="soc-icon">📊</span>
            <div>
              <h2>CENTRO DE MONITOREO Y TELEMETRÍA DEL SERVIDOR</h2>
              <p>Monitoreo de Tráfico, Recursos del Sistema e Inspección de Eventos en Tiempo Real</p>
            </div>
          </div>
          <div class="soc-header-actions">
            <button class="soc-btn-export" id="soc-export-btn">📥 Exportar Registro JSON</button>
            <button class="soc-btn-close" id="soc-close-btn">✖ Cerrar</button>
          </div>
        </div>

        <div class="soc-body">
          <!-- Telemetry Gauges Cards -->
          <div class="soc-gauges-grid" id="soc-gauges-container">
            <div class="soc-gauge-card">
              <span class="gauge-label">ESTADO DEL SERVIDOR</span>
              <span class="gauge-value status-badge badge-normal" id="soc-status-badge">🟢 NORMAL</span>
              <small>Servidor Activo</small>
            </div>
            <div class="soc-gauge-card">
              <span class="gauge-label">USO DE CPU</span>
              <span class="gauge-value" id="soc-cpu-val">0.0%</span>
              <div class="gauge-bar"><div class="gauge-fill" id="soc-cpu-bar" style="width: 0%"></div></div>
            </div>
            <div class="soc-gauge-card">
              <span class="gauge-label">USO DE MEMORIA RAM</span>
              <span class="gauge-value" id="soc-ram-val">0 MB</span>
              <div class="gauge-bar"><div class="gauge-fill" id="soc-ram-bar" style="width: 0%"></div></div>
            </div>
            <div class="soc-gauge-card">
              <span class="gauge-label">CONEXIONES ACTIVAS</span>
              <span class="gauge-value" id="soc-ws-val">0</span>
              <small>Clientes conectados</small>
            </div>
            <div class="soc-gauge-card">
              <span class="gauge-label">TOTAL PAQUETES PROCESADOS</span>
              <span class="gauge-value" id="soc-pkts-val">0</span>
              <small>Procesados en servidor</small>
            </div>
            <div class="soc-gauge-card">
              <span class="gauge-label">ALERTAS / INCIDENTES</span>
              <span class="gauge-value warning-text" id="soc-incidents-val">0</span>
              <small>Anomalías detectadas</small>
            </div>
          </div>

          <!-- Simulation Tools Bar -->
          <div class="soc-simulation-panel">
            <span class="sim-title">⚡ Pruebas de Carga y Límites de Tráfico:</span>
            <button class="sim-btn" id="sim-flood-btn">🚨 Probar Límite de Paquetes (Rate Limit)</button>
            <button class="sim-btn" id="sim-teleport-btn">⚠️ Probar Validación de Salto Anómalo</button>
            <button class="sim-btn" id="sim-bomb-spam-btn">💣 Probar Límite de Bombas</button>
          </div>

          <!-- Audit Log Section -->
          <div class="soc-log-section">
            <div class="soc-filter-bar">
              <div class="filter-group">
                <span>Filtrar Severidad:</span>
                <button class="filter-chip active" data-sev="ALL">TODOS</button>
                <button class="filter-chip chip-info" data-sev="INFO">INFO</button>
                <button class="filter-chip chip-warning" data-sev="WARNING">WARNING</button>
                <button class="filter-chip chip-critical" data-sev="CRITICAL">CRITICAL</button>
              </div>
              <span class="events-counter" id="soc-events-count">Mostrando 0 eventos</span>
            </div>

            <div class="soc-table-wrapper">
              <table class="soc-table">
                <thead>
                  <tr>
                    <th>HORA</th>
                    <th>SEVERIDAD</th>
                    <th>TIPO DE EVENTO</th>
                    <th>ORIGEN / IP</th>
                    <th>JUGADOR / SALA</th>
                    <th>DETALLES TÉCNICOS</th>
                  </tr>
                </thead>
                <tbody id="soc-events-tbody">
                  <tr><td colspan="6" style="text-align: center; color: #888;">Esperando eventos de auditoría...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind event listeners
    this.container.querySelector('#soc-close-btn')?.addEventListener('click', () => this.toggle());
    this.container.querySelector('.soc-modal-backdrop')?.addEventListener('click', () => this.toggle());
    this.container.querySelector('#soc-export-btn')?.addEventListener('click', () => this.exportAuditLogs());

    // Simulation triggers
    this.container.querySelector('#sim-flood-btn')?.addEventListener('click', () => {
      this.simulateIncident('RATE_LIMIT_VIOLATION', 'WARNING');
    });
    this.container.querySelector('#sim-teleport-btn')?.addEventListener('click', () => {
      this.simulateIncident('ANOMALOUS_SPEED_DETECTED', 'WARNING');
    });
    this.container.querySelector('#sim-bomb-spam-btn')?.addEventListener('click', () => {
      this.simulateIncident('ILLEGAL_BOMB_INJECTION', 'CRITICAL');
    });

    // Filter chips
    const chips = this.container.querySelectorAll('.filter-chip');
    chips.forEach((c) => {
      c.addEventListener('click', (e) => {
        chips.forEach((ch) => ch.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.filterSeverity = target.getAttribute('data-sev') || 'ALL';
        this.updateView();
      });
    });
  }

  public updateView() {
    if (!this.container) return;

    // Update Telemetry
    if (this.telemetry) {
      const statusBadge = this.container.querySelector('#soc-status-badge');
      if (statusBadge) {
        if (this.telemetry.total_incidents > 0) {
          statusBadge.textContent = '⚠️ INCIDENTE DETECTADO';
          statusBadge.className = 'gauge-value status-badge badge-warning';
        } else {
          statusBadge.textContent = '🟢 NORMAL (SEGURO)';
          statusBadge.className = 'gauge-value status-badge badge-normal';
        }
      }

      const cpuVal = this.container.querySelector('#soc-cpu-val');
      const cpuBar = this.container.querySelector('#soc-cpu-bar') as HTMLElement;
      if (cpuVal && cpuBar && this.telemetry.system) {
        cpuVal.textContent = `${this.telemetry.system.cpu_percent}%`;
        cpuBar.style.width = `${Math.min(100, this.telemetry.system.cpu_percent)}%`;
      }

      const ramVal = this.container.querySelector('#soc-ram-val');
      const ramBar = this.container.querySelector('#soc-ram-bar') as HTMLElement;
      if (ramVal && ramBar && this.telemetry.system) {
        ramVal.textContent = `${this.telemetry.system.ram_used_mb} MB (${this.telemetry.system.ram_percent}%)`;
        ramBar.style.width = `${Math.min(100, this.telemetry.system.ram_percent)}%`;
      }

      const wsVal = this.container.querySelector('#soc-ws-val');
      if (wsVal) wsVal.textContent = `${this.telemetry.active_monitors}`;

      const pktsVal = this.container.querySelector('#soc-pkts-val');
      if (pktsVal) pktsVal.textContent = `${this.telemetry.total_packets}`;

      const incVal = this.container.querySelector('#soc-incidents-val');
      if (incVal) incVal.textContent = `${this.telemetry.total_incidents}`;
    }

    // Update Events Table
    const tbody = this.container.querySelector('#soc-events-tbody');
    const counter = this.container.querySelector('#soc-events-count');
    if (!tbody) return;

    const filtered = this.events.filter((ev) => {
      if (this.filterSeverity === 'ALL') return true;
      return ev.severity === this.filterSeverity;
    });

    if (counter) counter.textContent = `Mostrando ${filtered.length} de ${this.events.length} eventos`;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #888; padding: 24px;">No hay eventos con los filtros actuales.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .slice(0, 70)
      .map((ev) => {
        const timeStr = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : 'N/A';
        const sevClass = ev.severity === 'CRITICAL' ? 'sev-critical' : ev.severity === 'WARNING' ? 'sev-warning' : 'sev-info';
        const detailsStr = JSON.stringify(ev.details || {});

        return `
          <tr class="${sevClass}-row">
            <td class="font-mono">${timeStr}</td>
            <td><span class="sev-badge ${sevClass}">${ev.severity}</span></td>
            <td class="event-type-cell">${ev.event_type}</td>
            <td class="font-mono">${ev.client_ip || '127.0.0.1'}</td>
            <td>${ev.player_id || 'Servidor'}${ev.room_id ? ` (${ev.room_id})` : ''}</td>
            <td class="details-cell" title="${detailsStr.replace(/"/g, '&quot;')}">${detailsStr}</td>
          </tr>
        `;
      })
      .join('');
  }
}
