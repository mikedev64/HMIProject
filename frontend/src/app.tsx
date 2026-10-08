import { useEffect, useMemo, useState } from "preact/hooks";
import { Badge, Field, List, ListItem, NumberInput, Panel, Switch } from "interface-components";
import type { HMIConfig, Snapshot, TagDef } from "./backend";
import { EMPTY_SNAPSHOT, getMachines, getSnapshot, isPreviewMode, onSnapshot, writeTag } from "./backend";
import { MachineCanvas } from "./machine-canvas";
import { asBool, asNumber, formatTime } from "./format";

/*
 * HMI estilo PanelView:
 *
 *  - El canvas (machine-canvas) dibuja las máquinas y gestiona hover/foco.
 *  - Al hacer clic en una máquina se abre este panel lateral con sus tags
 *    mapeados: rw se edita (Switch/NumberInput), ro se muestra bloqueado.
 *  - Los datos llegan de la capa backend (evento Wails "plc:update" o
 *    polling directo en modo preview).
 */

interface Notice {
        tone: "ok" | "error";
        text: string;
}

export function App() {
        const [config, setConfig] = useState<HMIConfig | null>(null);
        const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
        const [focusedId, setFocusedId] = useState<string | null>(null);
        const [loadError, setLoadError] = useState<string | null>(null);
        const [notice, setNotice] = useState<Notice | null>(null);

        useEffect(() => {
                let cancelled = false;
                getMachines()
                        .then((cfg) => {
                                if (!cancelled) setConfig(cfg);
                        })
                        .catch((e) => setLoadError(e?.message ? String(e.message) : String(e)));

                const unsubscribe = onSnapshot((snap) => setSnapshot(snap));
                getSnapshot()
                        .then((snap) => setSnapshot(snap))
                        .catch(() => {});

                return () => {
                        cancelled = true;
                        unsubscribe();
                };
        }, []);

        // Escape deja la máquina (equivale al botón ✕ del panel).
        useEffect(() => {
                const onKey = (e: KeyboardEvent) => {
                        if (e.key === "Escape") setFocusedId(null);
                };
                window.addEventListener("keydown", onKey);
                return () => window.removeEventListener("keydown", onKey);
        }, []);

        // El aviso de escritura es por máquina enfocada.
        useEffect(() => setNotice(null), [focusedId]);

        const machines = config?.machines ?? [];
        const focused = machines.find((m) => m.id === focusedId) ?? null;

        const write = async (tag: TagDef, value: number | boolean) => {
                setNotice(null);
                try {
                        const snap = await writeTag(tag.address, value);
                        setSnapshot(snap);
                        setNotice({ tone: "ok", text: `${tag.address} ← ${String(value)}` });
                } catch (e) {
                        const message = e instanceof Error ? e.message : String(e);
                        setNotice({ tone: "error", text: message });
                }
        };

        if (loadError) {
                return (
                        <div class="hm-state">
                                <Badge tone="danger">ERROR</Badge>
                                <p>No se pudo cargar el mapa HMI: {loadError}</p>
                        </div>
                );
        }

        if (!config) {
                return (
                        <div class="hm-state">
                                <p>Cargando mapa HMI…</p>
                        </div>
                );
        }

        return (
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
                                        onselect={(id) => setFocusedId((current) => (current === id ? null : id))}
                                >
                                        {machines.map((m) => (
                                                <ListItem key={m.id} value={m.id} title={m.name}>
                                                        {m.name}
                                                </ListItem>
                                        ))}
                                </List>

                                <div class="hm-plc">
                                        {isPreviewMode && <Badge tone="warn">PREVIEW · SIN WAILS</Badge>}
                                        <Badge tone={snapshot.connected ? "ok" : "danger"} dot title={snapshot.error}>
                                                {config.plc.name}
                                        </Badge>
                                        <span class="hm-plc__ts">{formatTime(snapshot.ts)}</span>
                                </div>
                        </header>

                        {!snapshot.connected && (
                                <div class="hm-banner">
                                        {snapshot.ts === 0
                                                ? "Conectando con el PLC…"
                                                : `Sin conexión con el PLC: ${snapshot.error ?? "sin respuesta"} · ¿está el simulador en marcha?`}
                                </div>
                        )}

                        <div class="hm-body">
                                <MachineCanvas machines={machines} snapshot={snapshot} focusedId={focusedId} onFocus={setFocusedId} />

                                {focused && (
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
                                                <TagGroups machine={focused} snapshot={snapshot} onWrite={write} />
                                        </Panel>
                                )}
                        </div>
                </div>
        );
}

function TagGroups({
        machine,
        snapshot,
        onWrite,
}: {
        machine: HMIConfig["machines"][number];
        snapshot: Snapshot;
        onWrite: (tag: TagDef, value: number | boolean) => void;
}) {
        // Los tags se agrupan por su "group" del mapa, respetando el orden.
        const groups = useMemo(() => {
                const map = new Map<string, TagDef[]>();
                for (const tag of machine.tags) {
                        const key = tag.group ?? "General";
                        const list = map.get(key);
                        if (list) list.push(tag);
                        else map.set(key, [tag]);
                }
                return [...map.entries()];
        }, [machine]);

        return (
                <>
                        {groups.map(([name, tags]) => (
                                <section class="hm-group" key={name}>
                                        <h3 class="hm-group__title">{name}</h3>
                                        {tags.map((tag) => {
                                                const raw = snapshot.values?.[tag.address];
                                                const readOnly = tag.access !== "rw";
                                                return (
                                                        <Field
                                                                key={tag.address}
                                                                label={tag.label}
                                                                address={tag.address}
                                                                unit={tag.unit}
                                                                access={readOnly ? "ro" : "rw"}
                                                                hint={readOnly ? "Solo lectura" : undefined}
                                                                disabled={readOnly}
                                                        >
                                                                {tag.dataType === "bool" ? (
                                                                        <Switch
                                                                                checked={asBool(raw)}
                                                                                disabled={readOnly}
                                                                                oncommit={(v) => onWrite(tag, v)}
                                                                        />
                                                                ) : tag.dataType === "string" ? (
                                                                        <span class="hm-readonly">{String(raw ?? "—")}</span>
                                                                ) : (
                                                                        <NumberInput
                                                                                value={asNumber(raw)}
                                                                                min={tag.min}
                                                                                max={tag.max}
                                                                                step={tag.dataType === "int16" || tag.dataType === "int32" ? 1 : 0.1}
                                                                                disabled={readOnly}
                                                                                oncommit={(v) => onWrite(tag, v)}
                                                                        />
                                                                )}
                                                        </Field>
                                                );
                                        })}
                                </section>
                        ))}
                </>
        );
}
