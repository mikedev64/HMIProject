/*
 * Formateo de valores del PLC para mostrar en la UI (popover, panel, readouts).
 */
import type { Snapshot, TagDef } from "./backend";

/** Lee el valor actual de una dirección en el último snapshot. */
export function readValue(snapshot: Snapshot, address: string): unknown {
        return snapshot.values?.[address];
}

/** Convierte el valor crudo del PLC a number | boolean | null. */
export function asNumber(value: unknown): number | null {
        return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asBool(value: unknown): boolean {
        return value === true || value === 1 || value === "1";
}

/** Formatea un valor con su unidad y el tipo definido en el mapa HMI. */
export function formatValue(tag: Pick<TagDef, "dataType" | "unit">, value: unknown): string {
        if (value === undefined || value === null) return "—";

        if (tag.dataType === "bool") return asBool(value) ? "ON" : "OFF";

        if (typeof value !== "number") return String(value);

        const rounded = tag.dataType === "int16" || tag.dataType === "int32" ? Math.round(value) : value;
        const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
        return tag.unit ? `${text} ${tag.unit}` : text;
}

/** Hora local (HH:MM:SS) de un timestamp en milisegundos. */
export function formatTime(ts: number): string {
        if (!ts) return "—";
        return new Date(ts).toLocaleTimeString("es-ES", { hour12: false });
}
