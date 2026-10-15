import { csvStamp, downloadCsv } from "./csv";

export interface TrendPoint {
        t: number;
        v: number;
}

const cell = (v: string) => '"' + v.split('"').join('""') + '"';

export function exportTrendCsv(
        machineId: string,
        history: Map<string, TrendPoint[]>,
        addresses: { address: string; label: string; unit?: string }[],
) {
        const relevant = addresses.filter((a) => (history.get(a.address)?.length ?? 0) > 0);
        if (relevant.length === 0) return false;

        const byTime = new Map<number, Record<string, number>>();
        for (const a of relevant) {
                for (const p of history.get(a.address) ?? []) {
                        const row = byTime.get(p.t) ?? {};
                        row[a.address] = p.v;
                        byTime.set(p.t, row);
                }
        }
        const times = [...byTime.keys()].sort((x, y) => x - y);

        const header = ["fecha_hora", ...relevant.map((a) => a.label + (a.unit ? ` (${a.unit})` : ""))].join(";");
        const lines = times.map((t) => {
                const row = byTime.get(t) ?? {};
                return [new Date(t).toISOString(), ...relevant.map((a) => (row[a.address] !== undefined ? String(row[a.address]) : ""))].join(";");
        });

        downloadCsv(`hmi-trend-${machineId}-${csvStamp(Date.now())}.csv`, [header, ...lines].join("\r\n"));
        return true;
}
