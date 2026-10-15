import { useEffect, useState } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import { Badge, Button, KeypadProvider, List, ListItem, Panel, Tab, Tabs } from "interface-components";
import { isPreviewMode } from "./api/backend";
import { ADMIN_RANK, OPERATOR_RANK, levelLabel, levelRank } from "./lib/levels";
import { machineTabs } from "./lib/hmi-spec";
import { formatTime } from "./lib/format";
import { exportSnapshotCsv } from "./lib/csv";
import { useBackend } from "./hooks/use-backend";
import { useConfig } from "./hooks/use-config";
import { useMachines } from "./hooks/use-machines";
import { usePlcSnapshot } from "./hooks/use-plc-snapshot";
import { useSession } from "./hooks/use-session";
import { useSessionTimeout } from "./hooks/use-session-timeout";
import { useAlarmHistory } from "./hooks/use-alarm-history";
import { useTrendHistory } from "./hooks/use-trend-history";
import { useWrites } from "./hooks/use-writes";
import { useFullscreen } from "./hooks/use-fullscreen";
import { MachineCanvas } from "./components/machine-canvas";
import { Faceplate } from "./components/faceplate";
import { AlarmBanner } from "./components/alarm-banner";
import { AlarmLog } from "./components/alarm-log";
import { LoginScreen } from "./components/login";
import { AuditLog } from "./components/audit-log";
import { ConfigWorkspace } from "./components/config-editor";

export function App() {
        return (
                <LocationProvider>
                        <Router>
                                <Route path="/" component={HmiApp} />
                                <Route path="/login" component={HmiApp} />
                                <Route default component={NotFound} />
                        </Router>
                </LocationProvider>
        );
}

function NotFound() {
        const { route } = useLocation();
        useEffect(() => {
                route("/", true);
        }, [route]);
        return null;
}

function HmiApp() {
        const backend = useBackend();
        const { path, route } = useLocation();
        const { config, error: loadError, refresh: reloadConfig } = useConfig(backend);
        const { session, flags, ready, login, logout } = useSession(backend);
        const { machines, selected: focused, selectedId: focusedId, select: setFocusedId } = useMachines(config);
        const { snapshot, setSnapshot } = usePlcSnapshot(backend);
        const { events: alarmEvents, activeCount, clear: clearAlarms, ack: ackAlarm, ackAll: ackAllAlarms } = useAlarmHistory(snapshot, machines);
        const trendHistory = useTrendHistory(snapshot);
        const { notice, setNotice, write, pulseAck } = useWrites(backend, setSnapshot);
        const { fullscreen, toggle: toggleFullscreen } = useFullscreen();

        const [panelTab, setPanelTab] = useState<string>("control");
        const [alarmLogOpen, setAlarmLogOpen] = useState(false);
        const [auditOpen, setAuditOpen] = useState(false);
        const [configOpen, setConfigOpen] = useState(false);

        const requireLogin = config?.security?.requireLogin !== false;
        const canWrite = !requireLogin || levelRank(session.level) >= OPERATOR_RANK;
        const isAdmin = !requireLogin || levelRank(session.level) >= ADMIN_RANK;
        const gate = Boolean(config) && ready && requireLogin && !session.authenticated;

        useEffect(() => {
                if (!config || !ready) return;
                if (gate && path !== "/login") route("/login", true);
                else if (!gate && path === "/login") route("/", true);
        }, [config, ready, gate, path, route]);

        useSessionTimeout(session, config?.security?.sessionTimeoutMin ?? 0, logout);

        useEffect(() => {
                const onKey = (e: KeyboardEvent) => {
                        if (e.key !== "Escape") return;
                        if (configOpen) setConfigOpen(false);
                        else if (auditOpen) setAuditOpen(false);
                        else if (alarmLogOpen) setAlarmLogOpen(false);
                        else setFocusedId(null);
                };
                window.addEventListener("keydown", onKey);
                return () => window.removeEventListener("keydown", onKey);
        }, [configOpen, auditOpen, alarmLogOpen]);

        useEffect(() => {
                setNotice(null);
                setPanelTab(focused ? (machineTabs(focused)[0]?.id ?? "control") : "control");
        }, [focusedId]);

        const handleAck = (id: number) => {
                const ev = alarmEvents.find((e) => e.id === id);
                ackAlarm(id);
                if (ev && ev.clearedTs === null) void pulseAck(ev.machineId, machines, canWrite);
        };

        const handleAckAll = () => {
                const machineIds = new Set(alarmEvents.filter((e) => e.clearedTs === null && e.ackedTs === null).map((e) => e.machineId));
                ackAllAlarms();
                for (const machineId of machineIds) void pulseAck(machineId, machines, canWrite);
        };

        const tabs = focused ? machineTabs(focused) : [];
        const activeTab = tabs.find((t) => t.id === panelTab) ?? tabs[0];
        const focusedAlarmCount = focused ? alarmEvents.filter((e) => e.machineId === focused.id && e.clearedTs === null).length : 0;

        const exportSnapshot = () => {
                const count = exportSnapshotCsv(machines, snapshot);
                setNotice({ tone: "ok", text: `CSV exportado (${count} tags)` });
        };

        const handleLogout = () => {
                setAlarmLogOpen(false);
                setAuditOpen(false);
                setConfigOpen(false);
                setFocusedId(null);
                void logout();
        };

        if (loadError) {
                return (
                        <div class="hm-state">
                                <Badge tone="danger">ERROR</Badge>
                                <p>No se pudo cargar el mapa HMI: {loadError}</p>
                        </div>
                );
        }

        if (gate) {
                return (
                        <div class="hm-root hm-root--locked">
                                <LoginScreen onLogin={login} />
                        </div>
                );
        }

        if (!config || !ready) {
                return (
                        <div class="hm-state">
                                <p>Cargando mapa HMI…</p>
                        </div>
                );
        }

        const bannerCfg = config.ui?.alarmBanner;

        return (
                <KeypadProvider enabled={!flags.onlyMouse}>
                        <div class="hm-root">
                                <header class="hm-top">
                                        <div class="hm-brand">
                                                <span class="hm-brand__mark">◆</span>
                                                <span class="hm-brand__name">HMInot</span>
                                                <span class="hm-brand__sub">PanelView</span>
                                        </div>

                                        <List
                                                orientation="horizontal"
                                                ariaLabel="Máquinas"
                                                value={focusedId ?? ""}
                                                onselect={(id) => setFocusedId(focusedId === id ? null : id)}
                                        >
                                                {machines.map((m) => (
                                                        <ListItem key={m.id} value={m.id} title={m.name}>
                                                                {m.name}
                                                        </ListItem>
                                                ))}
                                        </List>

                                        <div class="hm-tools">
                                                <Button size="sm" variant="ghost" title="Pantalla completa" onClick={toggleFullscreen}>
                                                        {fullscreen ? "⤢" : "⛶"}
                                                </Button>
                                                <Button size="sm" variant="ghost" title="Exportar snapshot a CSV" onClick={exportSnapshot}>
                                                        ⤓ CSV
                                                </Button>
                                                <button
                                                        type="button"
                                                        class="hm-alarmlog__btn"
                                                        title="Registro de alarmas"
                                                        aria-pressed={alarmLogOpen}
                                                        onClick={() => setAlarmLogOpen((v) => !v)}
                                                >
                                                        <Badge tone={activeCount > 0 ? "danger" : "neutral"} dot>
                                                                {activeCount > 0 ? `${activeCount} ALARMAS` : "SIN ALARMAS"}
                                                        </Badge>
                                                </button>
                                                {isAdmin && (
                                                        <>
                                                                <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        title="Registro de auditoría: quién escribió qué (solo admin)"
                                                                        aria-pressed={auditOpen}
                                                                        onClick={() => setAuditOpen((v) => !v)}
                                                                >
                                                                        ≡ Auditoría
                                                                </Button>
                                                                <Button
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        title="Configuración de máquinas y usuarios (solo admin)"
                                                                        aria-pressed={configOpen}
                                                                        onClick={() => setConfigOpen(true)}
                                                                >
                                                                        ⚙ Config
                                                                </Button>
                                                        </>
                                                )}
                                        </div>

                                        <div class="hm-user" title={`Perfil: ${levelLabel(session.level)}`}>
                                                <Badge tone="info">{levelLabel(session.level)}</Badge>
                                                <span class="hm-user__name">{session.username}</span>
                                                <Button size="sm" variant="ghost" title="Cerrar sesión" onClick={handleLogout}>
                                                        Salir
                                                </Button>
                                        </div>

                                        <div class="hm-plc">
                                                {isPreviewMode && <Badge tone="warn">PREVIEW · SIN WAILS</Badge>}
                                                <Badge tone={snapshot.connected ? "ok" : "danger"} dot title={snapshot.error}>
                                                        {config.plc.name}
                                                </Badge>
                                                {snapshot.eip && (
                                                        <span
                                                                class={`hm-eip${snapshot.eip.connected ? "" : " is-down"}`}
                                                                title={`Sesión EtherNet/IP ${snapshot.eip.endpoint} · RPI ${snapshot.eip.rpiMs} ms · sesión ${snapshot.eip.session} · conn O→T ${snapshot.eip.o2t} / T→O ${snapshot.eip.t2o} · serie ${snapshot.eip.serial} · recibidos ↓${snapshot.eip.packetsRx} ↑${snapshot.eip.packetsTx}${snapshot.eip.lost > 0 ? ` · perdidos ${snapshot.eip.lost}` : ""}`}
                                                        >
                                                                <span class="hm-eip__dot" />
                                                                EIP · <span class="hm-eip__seq">seq {snapshot.eip.seq}</span>
                                                                {snapshot.eip.lost > 0 && <span class="hm-eip__lost">+{snapshot.eip.lost}</span>}
                                                        </span>
                                                )}
                                        </div>
                                </header>

                                {alarmLogOpen && <AlarmLog events={alarmEvents} onClose={() => setAlarmLogOpen(false)} onClear={clearAlarms} />}
                                {auditOpen && isAdmin && <AuditLog onClose={() => setAuditOpen(false)} />}

                                {bannerCfg?.enabled !== false && (
                                        <AlarmBanner
                                                events={alarmEvents}
                                                maxItems={bannerCfg?.maxItems}
                                                canAck={canWrite}
                                                onAck={handleAck}
                                                onAckAll={handleAckAll}
                                        />
                                )}

                                {!snapshot.connected && (
                                        <div class="hm-banner">
                                                {snapshot.ts === 0
                                                        ? "Conectando con el PLC…"
                                                        : `Sin conexión con el PLC: ${snapshot.error ?? "sin respuesta"} · ¿está el simulador en marcha?`}
                                        </div>
                                )}

                                <div class="hm-body">
                                        <MachineCanvas machines={machines} snapshot={snapshot} focusedId={focusedId} onFocus={setFocusedId} />

                                        {focused && activeTab && (
                                                <Panel
                                                        title={focused.name}
                                                        subtitle={`${focused.type} · ${focused.id}`}
                                                        closeLabel="Dejar máquina"
                                                        onClose={() => setFocusedId(null)}
                                                        footer={
                                                                notice ? (
                                                                        <span class={`hm-notice hm-notice--${notice.tone}`}>{notice.text}</span>
                                                                ) : snapshot.connected ? (
                                                                        `PLC en línea · lectura ${formatTime(snapshot.ts)}`
                                                                ) : (
                                                                        <span class="hm-notice hm-notice--error">Sin conexión con el PLC</span>
                                                                )
                                                        }
                                                >
                                                        <Tabs value={panelTab} onselect={setPanelTab} ariaLabel="Vistas de la máquina">
                                                                {tabs.map((t) => (
                                                                        <Tab
                                                                                key={t.id}
                                                                                value={t.id}
                                                                                badge={
                                                                                        t.id === "alarmas" && focusedAlarmCount > 0
                                                                                                ? String(focusedAlarmCount)
                                                                                                : undefined
                                                                                }
                                                                        >
                                                                                {t.title}
                                                                        </Tab>
                                                                ))}
                                                        </Tabs>
                                                        <div class="hm-panel__content">
                                                                <Faceplate
                                                                        machine={focused}
                                                                        tab={activeTab}
                                                                        snapshot={snapshot}
                                                                        history={trendHistory}
                                                                        events={alarmEvents}
                                                                        canWrite={canWrite}
                                                                        level={session.level}
                                                                        requireLogin={requireLogin}
                                                                        onWrite={(tag, value) => void write(tag.address, value)}
                                                                />
                                                        </div>
                                                </Panel>
                                        )}
                                </div>

                                {configOpen && isAdmin && (
                                        <ConfigWorkspace config={config} onClose={() => setConfigOpen(false)} onConfigSaved={reloadConfig} />
                                )}
                        </div>
                </KeypadProvider>
        );
}
