import type { Machine, Snapshot } from "../api/backend";

const CSV_BOM = "\ufeff";

export function downloadCsv(filename: string, csv: string) {
        const blob = new Blob([CSV_BOM + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
}

export function csvStamp(ts: number): string {
        return new Date(ts).toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function exportSnapshotCsv(machines: Machine[], snapshot: Snapshot): number {
        const rows: string[][] = [["maquina", "tag", "direccion", "tipo", "acceso", "valor", "unidad"]];
        for (const m of machines) {
                for (const t of m.tags) {
                        rows.push([m.name, t.label, t.address, t.dataType, t.access, String(snapshot.values?.[t.address] ?? ""), t.unit ?? ""]);
                }
        }
        const csv = rows.map((row) => row.map((cell) => `"${cell.split('"').join('""')}"`).join(";")).join("\r\n");
        downloadCsv(`hmi-snapshot-${csvStamp(snapshot.ts || Date.now())}.csv`, csv);
        return rows.length - 1;
}
