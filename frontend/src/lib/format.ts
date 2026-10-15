import type { Snapshot, TagDef } from "../api/backend";

export function readValue(snapshot: Snapshot, address: string): unknown {
        return snapshot.values?.[address];
}

export function asNumber(value: unknown): number | null {
        return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asBool(value: unknown): boolean {
        return value === true || value === 1 || value === "1";
}

export function formatValue(tag: Pick<TagDef, "dataType" | "unit">, value: unknown): string {
        if (value === undefined || value === null) return "—";

        if (tag.dataType === "bool") return asBool(value) ? "ON" : "OFF";

        if (typeof value !== "number") return String(value);

        const rounded = tag.dataType === "int16" || tag.dataType === "int32" ? Math.round(value) : value;
        const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
        return tag.unit ? `${text} ${tag.unit}` : text;
}

export function formatTime(ts: number): string {
        if (!ts) return "—";
        const d = new Date(ts);
        const p = (n: number) => String(n).padStart(2, "0");
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
