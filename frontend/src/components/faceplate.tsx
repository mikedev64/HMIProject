import { useMemo, useState } from "preact/hooks";
import { Badge, Bar, Button, Field, Gauge, NumberInput, Sparkline, Switch, useKeypad } from "interface-components";
import type { Machine, Recipe, Snapshot, TagDef } from "../api/backend";
import { backend } from "../api/backend";
import type { AlarmEvent } from "../lib/alarms";
import { asBool, asNumber, formatTime, formatValue } from "../lib/format";
import type { BlockDef, ControlDef, TabDef } from "../lib/hmi-spec";
import { findTag, paintedAddresses, requiredRankForAddress } from "../lib/hmi-spec";
import { levelRank } from "../lib/levels";
import type { Notice } from "../lib/notice";
import type { TrendPoint } from "../lib/trends";
import { exportTrendCsv } from "../lib/trends";
import { useRecipes } from "../hooks/use-recipes";

export interface FaceplateProps {
        machine: Machine;
        tab: TabDef;
        snapshot: Snapshot;
        history: Map<string, TrendPoint[]>;
        events: AlarmEvent[];
        canWrite: boolean;
        level?: string;
        requireLogin: boolean;
        onWrite: (tag: TagDef, value: number | boolean) => void;
}

export function Faceplate({ machine, tab, snapshot, history, events, canWrite, level, requireLogin, onWrite }: FaceplateProps) {
        const excluded = useMemo(() => {
                const set = paintedAddresses(machine, tab);
                for (const block of tab.blocks) for (const key of block.tags ?? []) set.add(key);
                return set;
        }, [machine, tab]);

        const writeOk = (address: string): boolean => {
                if (!canWrite) return false;
                if (!requireLogin) return true;
                return levelRank(level) >= requiredRankForAddress(machine, address);
        };

        if (tab.blocks.length === 0) return <p class="hm-empty">Esta pestaña no define bloques.</p>;

        return (
                <>
                        {tab.blocks.map((block, i) => (
                                <Block
                                        key={`${block.type}-${i}`}
                                        block={block}
                                        machine={machine}
                                        snapshot={snapshot}
                                        history={history}
                                        events={events}
                                        canWrite={canWrite}
                                        onWrite={onWrite}
                                        excluded={excluded}
                                        writeOk={writeOk}
                                />
                        ))}
                </>
        );
}

type BlockProps = Omit<FaceplateProps, "tab" | "level" | "requireLogin"> & {
        block: BlockDef;
        excluded: Set<string>;
        writeOk: (address: string) => boolean;
};

function Block({ block, machine, snapshot, history, events, canWrite, onWrite, excluded, writeOk }: BlockProps) {
        switch (block.type) {
                case "sections":
                        return <SectionsBlock block={block} machine={machine} snapshot={snapshot} writeOk={writeOk} onWrite={onWrite} />;
                case "groups":
                        return <TagGroups machine={machine} snapshot={snapshot} onWrite={onWrite} excluded={excluded} writeOk={writeOk} />;
                case "process":
                        return <ProcessView machine={machine} snapshot={snapshot} />;
                case "trend":
                        return <TrendView machine={machine} history={history} points={block.points} />;
                case "alarms":
                        return <MachineAlarms machine={machine} events={events} />;
                case "recipes":
                        return <RecipesBlock machine={machine} snapshot={snapshot} canWrite={canWrite} onWrite={onWrite} />;
                default:
                        return <p class="hm-empty">Bloque desconocido: {block.type}</p>;
        }
}

function SectionsBlock({
        block,
        machine,
        snapshot,
        writeOk,
        onWrite,
}: {
        block: BlockDef;
        machine: Machine;
        snapshot: Snapshot;
        writeOk: (address: string) => boolean;
        onWrite: (tag: TagDef, value: number | boolean) => void;
}) {
        const sections = block.sections ?? [];
        if (sections.length === 0) return null;

        return (
                <>
                        {sections.map((section, i) => (
                                <section class="hm-group" key={section.title ?? i}>
                                        {section.title && <h3 class="hm-group__title">{section.title}</h3>}
                                        <div
                                                class="hm-section__grid"
                                                style={{ gridTemplateColumns: `repeat(${section.columns ?? 1}, minmax(0, 1fr))` }}
                                        >
                                                {(section.items ?? []).map((ctrl, j) => (
                                                        <Control
                                                                key={`${ctrl.kind}-${ctrl.tag ?? j}`}
                                                                ctrl={ctrl}
                                                                machine={machine}
                                                                snapshot={snapshot}
                                                                writeOk={writeOk}
                                                                onWrite={onWrite}
                                                        />
                                                ))}
                                        </div>
                                </section>
                        ))}
                </>
        );
}

function Control({
        ctrl,
        machine,
        snapshot,
        writeOk,
        onWrite,
}: {
        ctrl: ControlDef;
        machine: Machine;
        snapshot: Snapshot;
        writeOk: (address: string) => boolean;
        onWrite: (tag: TagDef, value: number | boolean) => void;
}) {
        const keypad = useKeypad();

        const tag = findTag(machine, ctrl.tag);
        const missing = (
                <p class="hm-empty">
                        Tag sin mapear: <code>{ctrl.tag ?? "?"}</code>
                </p>
        );
        if (!tag && ctrl.kind !== "button") return missing;

        const raw = tag ? snapshot.values?.[tag.address] : undefined;
        const readOnly = tag ? tag.access !== "rw" : true;
        const ok = tag ? writeOk(tag.address) : false;
        const hint = readOnly ? "Solo lectura" : !ok ? "Nivel insuficiente" : undefined;
        const label = ctrl.label ?? tag?.label ?? ctrl.tag ?? "";

        switch (ctrl.kind) {
                case "switch": {
                        if (!tag) return missing;
                        return (
                                <Field
                                        label={label}
                                        address={tag.address}
                                        unit={tag.unit}
                                        access={readOnly ? "ro" : "rw"}
                                        hint={hint}
                                        disabled={readOnly || !ok}
                                >
                                        <Switch checked={asBool(raw)} label={label} disabled={readOnly || !ok} oncommit={(v) => onWrite(tag, v)} />
                                </Field>
                        );
                }

                case "number": {
                        if (!tag) return missing;
                        return (
                                <Field
                                        label={label}
                                        address={tag.address}
                                        unit={tag.unit}
                                        access={readOnly ? "ro" : "rw"}
                                        hint={hint}
                                        disabled={readOnly || !ok}
                                >
                                        <NumberInput
                                                value={asNumber(raw)}
                                                min={tag.min}
                                                max={tag.max}
                                                step={tag.dataType === "int16" || tag.dataType === "int32" ? 1 : 0.1}
                                                label={tag.label}
                                                unit={tag.unit}
                                                disabled={readOnly || !ok}
                                                oncommit={(v) => onWrite(tag, v)}
                                        />
                                </Field>
                        );
                }

                case "display": {
                        if (!tag) return missing;
                        return (
                                <Field label={label} address={tag.address} unit={tag.unit} access="ro" hint="Solo lectura" disabled>
                                        <span class="hm-readout">{formatValue(tag, raw)}</span>
                                </Field>
                        );
                }

                case "button": {
                        const action = ctrl.write;
                        if (!action) return <p class="hm-empty">Botón sin acción write: {label}</p>;
                        const target = findTag(machine, action.tag);
                        if (!target) {
                                return (
                                        <p class="hm-empty">
                                                Tag sin mapear: <code>{action.tag}</code>
                                        </p>
                                );
                        }
                        const enabled = writeOk(target.address);
                        const fire = (value: unknown) => {
                                if (typeof value === "number" || typeof value === "boolean") onWrite(target, value);
                        };
                        const variant = (ctrl.variant ?? "secondary") as "primary" | "secondary" | "ghost" | "danger";
                        const title = enabled ? label : `${label} · nivel insuficiente`;
                        if (ctrl.momentary) {
                                return (
                                        <Button
                                                variant={variant}
                                                disabled={!enabled}
                                                title={title}
                                                onpress={() => fire(action.value)}
                                                onrelease={() => action.release !== undefined && fire(action.release)}
                                        >
                                                {label}
                                        </Button>
                                );
                        }
                        return (
                                <Button variant={variant} disabled={!enabled} title={title} onClick={() => fire(action.value)}>
                                        {label}
                                </Button>
                        );
                }

                case "pad": {
                        if (!tag) return missing;
                        if (keypad.enabled && ok && !readOnly) {
                                return (
                                        <Field label={label} address={tag.address} unit={tag.unit} access="rw">
                                                <button
                                                        type="button"
                                                        class="hm-padbtn"
                                                        onClick={() =>
                                                                keypad.open({
                                                                        label: tag.label,
                                                                        unit: tag.unit,
                                                                        value: asNumber(raw),
                                                                        min: tag.min,
                                                                        max: tag.max,
                                                                        step: tag.dataType === "int16" || tag.dataType === "int32" ? 1 : 0.1,
                                                                        oncommit: (v) => onWrite(tag, v),
                                                                })
                                                        }
                                                >
                                                        <span class="hm-padbtn__value">{formatValue(tag, raw)}</span>
                                                        <span class="hm-padbtn__icon" aria-hidden="true">
                                                                ⌨
                                                        </span>
                                                </button>
                                        </Field>
                                );
                        }
                        return (
                                <Field
                                        label={label}
                                        address={tag.address}
                                        unit={tag.unit}
                                        access={readOnly ? "ro" : "rw"}
                                        hint={hint}
                                        disabled={readOnly || !ok}
                                >
                                        <NumberInput
                                                value={asNumber(raw)}
                                                min={tag.min}
                                                max={tag.max}
                                                step={tag.dataType === "int16" || tag.dataType === "int32" ? 1 : 0.1}
                                                label={tag.label}
                                                unit={tag.unit}
                                                disabled={readOnly || !ok}
                                                oncommit={(v) => onWrite(tag, v)}
                                        />
                                </Field>
                        );
                }

                case "lamp": {
                        if (!tag) return missing;
                        const on = asBool(raw);
                        const tone = ctrl.tone ?? "ok";
                        return (
                                <div class={`hm-lamp hm-lamp--${tone}${on ? " is-on" : ""}`}>
                                        <span class="hm-lamp__led" />
                                        <span class="hm-lamp__label">{label}</span>
                                </div>
                        );
                }

                default:
                        return <p class="hm-empty">Control desconocido: {ctrl.kind}</p>;
        }
}

type RangedTag = TagDef & { min: number; max: number };

const isRanged = (t: TagDef): t is RangedTag => t.min !== undefined && t.max !== undefined;

function thresholds(t: RangedTag) {
        return { warnAt: t.min + (t.max - t.min) * 0.8, dangerAt: t.min + (t.max - t.min) * 0.92 };
}

function TagGroups({
        machine,
        snapshot,
        onWrite,
        excluded,
        writeOk,
}: {
        machine: Machine;
        snapshot: Snapshot;
        onWrite: (tag: TagDef, value: number | boolean) => void;
        excluded: Set<string>;
        writeOk: (address: string) => boolean;
}) {
        const groups = useMemo(() => {
                const map = new Map<string, TagDef[]>();
                for (const tag of machine.tags) {
                        if (excluded.has(tag.address)) continue;
                        const key = tag.group ?? "General";
                        const list = map.get(key);
                        if (list) list.push(tag);
                        else map.set(key, [tag]);
                }
                return [...map.entries()];
        }, [machine, excluded]);

        if (groups.length === 0) return <p class="hm-empty">Todos los tags ya están representados en la interfaz.</p>;

        return (
                <>
                        {groups.map(([name, tags]) => (
                                <section class="hm-group" key={name}>
                                        <h3 class="hm-group__title">{name}</h3>
                                        {tags.map((tag) => {
                                                const raw = snapshot.values?.[tag.address];
                                                const readOnly = tag.access !== "rw";
                                                const ok = writeOk(tag.address);
                                                const hint = readOnly ? "Solo lectura" : !ok ? "Nivel insuficiente" : undefined;
                                                return (
                                                        <Field
                                                                key={tag.address}
                                                                label={tag.label}
                                                                address={tag.address}
                                                                unit={tag.unit}
                                                                access={readOnly ? "ro" : "rw"}
                                                                hint={hint}
                                                                disabled={readOnly || !ok}
                                                        >
                                                                {tag.dataType === "bool" ? (
                                                                        <Switch
                                                                                checked={asBool(raw)}
                                                                                disabled={readOnly || !ok}
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
                                                                                label={tag.label}
                                                                                unit={tag.unit}
                                                                                disabled={readOnly || !ok}
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

function ProcessView({ machine, snapshot }: { machine: Machine; snapshot: Snapshot }) {
        const ranged = machine.tags.filter(isRanged);
        if (ranged.length === 0) return <p class="hm-empty">Esta máquina no define tags con rango.</p>;

        const primary = ranged.find((t) => t.dataType === "float32") ?? ranged[0];
        const rest = ranged.filter((t) => t.address !== primary.address);

        return (
                <section class="hm-proc">
                        <div class="hm-proc__hero">
                                <Gauge
                                        value={asNumber(snapshot.values?.[primary.address])}
                                        min={primary.min}
                                        max={primary.max}
                                        label={primary.label}
                                        unit={primary.unit}
                                        {...thresholds(primary)}
                                />
                        </div>
                        {rest.map((t) => (
                                <Bar
                                        key={t.address}
                                        value={asNumber(snapshot.values?.[t.address])}
                                        min={t.min}
                                        max={t.max}
                                        label={t.label}
                                        unit={t.unit}
                                        {...thresholds(t)}
                                />
                        ))}
                </section>
        );
}

function TrendView({ machine, history, points = 60 }: { machine: Machine; history: Map<string, TrendPoint[]>; points?: number }) {
        const numeric = machine.tags.filter((t) => t.dataType !== "bool" && t.dataType !== "string");
        if (numeric.length === 0) return <p class="hm-empty">Esta máquina no tiene tags numéricas.</p>;

        const samples = Math.max(0, ...numeric.map((t) => history.get(t.address)?.length ?? 0));

        return (
                <>
                        <div class="hm-trend__toolbar">
                                <Button
                                        size="sm"
                                        variant="ghost"
                                        title="Exportar la tendencia con fecha y hora por muestra"
                                        onClick={() => exportTrendCsv(machine.id, history, numeric)}
                                >
                                        ⤓ CSV tendencia
                                </Button>
                                <span class="hm-cfgeditor__hint">{samples} muestras · pasa el cursor por el gráfico para ver valor y hora</span>
                        </div>
                        <section class="hm-trend">
                                {numeric.map((t) => (
                                        <Sparkline
                                                key={t.address}
                                                data={(history.get(t.address) ?? []).map((p) => p.v)}
                                                times={(history.get(t.address) ?? []).map((p) => p.t)}
                                                points={points}
                                                label={t.label}
                                                unit={t.unit}
                                                width={304}
                                        />
                                ))}
                        </section>
                </>
        );
}

export function MachineAlarms({ machine, events }: { machine: Machine; events: AlarmEvent[] }) {
        const mine = events.filter((e) => e.machineId === machine.id);
        if (mine.length === 0) return <p class="hm-empty">Sin alarmas registradas en {machine.name}.</p>;

        return (
                <ul class="hm-alarms">
                        {mine.map((e) => {
                                const active = e.clearedTs === null;
                                return (
                                        <li key={e.id} class={`hm-alarms__item${active ? " is-active" : ""}`}>
                                                <span class="hm-alarms__dot" />
                                                <span class="hm-alarms__body">
                                                        <strong>{e.label}</strong>
                                                        <span class="hm-alarms__meta">
                                                                <code>{e.address}</code> · {formatTime(e.ts)}
                                                        </span>
                                                </span>
                                                <Badge tone={active ? "danger" : "neutral"}>
                                                        {active ? "ACTIVA" : `✓ ${formatTime(e.clearedTs ?? 0)}`}
                                                </Badge>
                                        </li>
                                );
                        })}
                </ul>
        );
}

function RecipesBlock({
        machine,
        snapshot,
        canWrite,
        onWrite,
}: {
        machine: Machine;
        snapshot: Snapshot;
        canWrite: boolean;
        onWrite: (tag: TagDef, value: number | boolean) => void;
}) {
        const { recipes, refresh } = useRecipes(backend, machine.id);
        const [name, setName] = useState("");
        const [notice, setNotice] = useState<Notice | null>(null);
        const [busy, setBusy] = useState(false);

        const collect = (): Record<string, unknown> => {
                const values: Record<string, unknown> = {};
                for (const t of machine.tags) {
                        if (t.access !== "rw" || t.dataType === "bool" || t.dataType === "string") continue;
                        const v = snapshot.values?.[t.address];
                        if (typeof v === "number" && Number.isFinite(v)) values[t.address] = v;
                }
                return values;
        };

        const save = async () => {
                const title = name.trim();
                if (!title) return;
                const values = collect();
                if (Object.keys(values).length === 0) {
                        setNotice({ tone: "error", text: "Esta máquina no tiene setpoints numéricos rw que guardar" });
                        return;
                }
                setBusy(true);
                try {
                        await backend.saveRecipe(machine.id, { name: title, values });
                        await refresh();
                        setName("");
                        setNotice({ tone: "ok", text: `Receta «${title}» guardada (${Object.keys(values).length} setpoints)` });
                } catch (e) {
                        setNotice({ tone: "error", text: e instanceof Error ? e.message : String(e) });
                } finally {
                        setBusy(false);
                }
        };

        const apply = async (recipe: Recipe) => {
                setBusy(true);
                setNotice(null);
                try {
                        const entries = Object.entries(recipe.values ?? {});
                        for (const [address, value] of entries) {
                                const tag = findTag(machine, address);
                                if (!tag) throw new Error(`tag sin mapear: ${address}`);
                                if (tag.access !== "rw") throw new Error(`solo lectura: ${tag.label}`);
                                if (typeof value !== "number" && typeof value !== "boolean") continue;
                                onWrite(tag, value);
                                await new Promise((r) => setTimeout(r, 120));
                        }
                        setNotice({ tone: "ok", text: `Receta «${recipe.name}» cargada (${entries.length} tags)` });
                } catch (e) {
                        setNotice({ tone: "error", text: e instanceof Error ? e.message : String(e) });
                } finally {
                        setBusy(false);
                }
        };

        const remove = async (recipe: Recipe) => {
                setBusy(true);
                setNotice(null);
                try {
                        await backend.deleteRecipe(machine.id, recipe.name);
                        await refresh();
                        setNotice({ tone: "ok", text: `Receta «${recipe.name}» eliminada` });
                } catch (e) {
                        setNotice({ tone: "error", text: e instanceof Error ? e.message : String(e) });
                } finally {
                        setBusy(false);
                }
        };

        return (
                <section class="hm-group hm-recipes">
                        <h3 class="hm-group__title">Recetas</h3>
                        {recipes.length === 0 ? (
                                <p class="hm-empty">Sin recetas guardadas para {machine.name}.</p>
                        ) : (
                                <ul class="hm-recipes__list">
                                        {recipes.map((r) => (
                                                <li key={r.name} class="hm-recipes__item">
                                                        <span class="hm-recipes__name">{r.name}</span>
                                                        <span class="hm-recipes__meta">{Object.keys(r.values ?? {}).length} setpoints</span>
                                                        <Button
                                                                size="sm"
                                                                variant="primary"
                                                                disabled={!canWrite || busy}
                                                                onClick={() => void apply(r)}
                                                        >
                                                                Cargar
                                                        </Button>
                                                        <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                disabled={!canWrite || busy}
                                                                title="Eliminar receta"
                                                                onClick={() => void remove(r)}
                                                        >
                                                                ✕
                                                        </Button>
                                                </li>
                                        ))}
                                </ul>
                        )}
                        <div class="hm-recipes__save">
                                <input
                                        class="hm-recipes__input"
                                        type="text"
                                        placeholder="Nombre de la nueva receta"
                                        value={name}
                                        disabled={!canWrite}
                                        onInput={(e) => setName(e.currentTarget.value)}
                                        onKeyDown={(e) => {
                                                if (e.key === "Enter") void save();
                                        }}
                                />
                                <Button size="sm" variant="secondary" disabled={!canWrite || busy || !name.trim()} onClick={() => void save()}>
                                        Guardar actuales
                                </Button>
                        </div>
                        {!canWrite && <p class="hm-empty">Tu perfil no puede guardar ni cargar recetas (requiere operador).</p>}
                        {notice && <span class={`hm-notice hm-notice--${notice.tone}`}>{notice.text}</span>}
                </section>
        );
}
