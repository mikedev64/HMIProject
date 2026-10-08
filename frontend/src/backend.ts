/*
 * Capa de datos del HMI.
 *
 * Dentro del webview de Wails usamos los bindings generados (wails generate
 * module): el backend Go es el único que habla con el PLC y nos envía un
 * snapshot en cada ciclo de polling mediante el evento "plc:update".
 *
 * Fuera de Wails (pnpm dev para desarrollo del frontend, sin binario Go)
 * caemos en un modo preview: se sirve hmi-config/machines.json desde Vite y
 * se hace polling directo al simulador Node (plc-simulator). Así se puede
 * trabajar en la UI sin compilar la app de escritorio.
 */
import { GetMachines, GetSnapshot, WriteTag } from "wailjs-bindings";
import { EventsOn } from "wailjs-bindings/runtime";
import type { main } from "wailjs-bindings";

export type HMIConfig = main.HMIConfig;
export type Machine = main.Machine;
export type TagDef = main.TagDef;
export type Snapshot = main.Snapshot;

export const EMPTY_SNAPSHOT: Snapshot = { connected: false, ts: 0, values: {} };

type WailsGlobal = {
        runtime?: { EventsOn?: (name: string, cb: (...data: any) => void) => () => void };
        go?: Record<string, Record<string, Record<string, () => Promise<any>>>>;
};

function hasWailsRuntime(): boolean {
        const w = globalThis as unknown as { window?: WailsGlobal } & WailsGlobal;
        const win = w.window ?? (w as unknown as WailsGlobal);
        return typeof win.runtime?.EventsOn === "function" && typeof win.go?.main?.App?.GetMachines === "function";
}

/** true cuando corremos fuera del binario de Wails (preview con Vite). */
export const isPreviewMode = !hasWailsRuntime();

// --------------------------------------------------------------- preview ---

function previewBackend() {
        let configPromise: Promise<HMIConfig> | null = null;

        const loadConfig = () => (configPromise ??= fetch("/hmi-config/machines.json").then((r) => r.json()));

        const endpoint = async () => (await loadConfig()).plc.endpoint;

        const snapshotFrom = async (): Promise<Snapshot> => {
                try {
                        const res = await fetch(`${await endpoint()}/tags`);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const data = (await res.json()) as { values: Record<string, any>; ts: number };
                        return { connected: true, ts: data.ts, values: data.values };
                } catch (e) {
                        return { connected: false, ts: Date.now(), values: {}, error: `PLC no responde: ${e}` };
                }
        };

        return {
                async getMachines(): Promise<HMIConfig> {
                        return loadConfig();
                },
                getSnapshot: snapshotFrom,
                async writeTag(address: string, value: unknown): Promise<Snapshot> {
                        const base = await endpoint();
                        const res = await fetch(`${base}/write`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ address, value }),
                        });
                        const body = (await res.json()) as { error?: string };
                        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
                        return snapshotFrom();
                },
                onSnapshot(cb: (s: Snapshot) => void): () => void {
                        let timer = 0;
                        let stopped = false;
                        loadConfig()
                                .then((cfg) => {
                                        if (stopped) return;
                                        const tick = async () => cb(await snapshotFrom());
                                        void tick();
                                        timer = window.setInterval(tick, cfg.plc.pollIntervalMs || 500);
                                })
                                .catch((e) => cb({ connected: false, ts: Date.now(), values: {}, error: String(e) }));
                        return () => {
                                stopped = true;
                                window.clearInterval(timer);
                        };
                },
        };
}

// ----------------------------------------------------------------- wails ---

function wailsBackend() {
        return {
                getMachines: () => GetMachines(),
                getSnapshot: () => GetSnapshot(),
                writeTag: (address: string, value: unknown) => WriteTag(address, value),
                onSnapshot(cb: (s: Snapshot) => void): () => void {
                        try {
                                return EventsOn("plc:update", (snap: Snapshot) => cb(snap));
                        } catch {
                                return () => {};
                        }
                },
        };
}

const impl = isPreviewMode ? previewBackend() : wailsBackend();

/** Mapa HMI (máquinas + tags): se carga una sola vez al arrancar. */
export const getMachines = impl.getMachines;
/** Último snapshot conocido del PLC. */
export const getSnapshot = impl.getSnapshot;
/** Escribe una tag rw en el PLC y devuelve el snapshot resultante. */
export const writeTag = impl.writeTag;
/** Suscripción al stream de snapshots. Devuelve el cancelador. */
export const onSnapshot = impl.onSnapshot;
