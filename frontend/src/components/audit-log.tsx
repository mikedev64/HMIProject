import { useEffect, useState } from "preact/hooks";
import { Badge } from "interface-components";
import type { AuditEntry } from "../api/backend";
import { backend } from "../api/backend";
import { errorMessage } from "../lib/levels";
import { formatTime } from "../lib/format";

export function AuditLog({ onClose }: { onClose: () => void }) {
        const [entries, setEntries] = useState<AuditEntry[] | null>(null);
        const [error, setError] = useState<string | null>(null);

        useEffect(() => {
                let cancelled = false;
                backend.getAudit()
                        .then((list) => {
                                if (!cancelled) setEntries(list);
                        })
                        .catch((e) => {
                                if (!cancelled) setError(errorMessage(e));
                        });
                return () => {
                        cancelled = true;
                };
        }, []);

        return (
                <div class="hm-alarmlog hm-auditlog">
                        <div class="hm-alarmlog__head">
                                <strong>Registro de auditoría</strong>
                                <span class="hm-alarmlog__actions">
                                        <button type="button" class="hm-alarmlog__close" onClick={onClose} aria-label="Cerrar auditoría">
                                                ✕
                                        </button>
                                </span>
                        </div>

                        {error && <p class="hm-alarmlog__empty">No se pudo cargar: {error}</p>}
                        {entries === null && !error && <p class="hm-alarmlog__empty">Cargando…</p>}
                        {entries !== null && entries.length === 0 && <p class="hm-alarmlog__empty">Sin escrituras registradas todavía.</p>}

                        {entries !== null && entries.length > 0 && (
                                <ul class="hm-alarmlog__list hm-auditlog__list">
                                        {entries.map((e, i) => (
                                                <li key={`${e.ts}-${i}`} class={e.error ? "is-error" : undefined}>
                                                        <span class="hm-auditlog__who">
                                                                <Badge tone={e.error ? "danger" : "info"}>{e.user}</Badge>
                                                                {e.level && <span class="hm-auditlog__level">{e.level}</span>}
                                                        </span>
                                                        <span class="hm-alarmlog__body">
                                                                <strong>
                                                                        {e.machine || "—"} · {e.label || e.address}
                                                                </strong>
                                                                <span class="hm-auditlog__change">
                                                                        <code>{e.address}</code>
                                                                        {e.old !== "" || e.new !== "" ? (
                                                                                <>
                                                                                        {" "}
                                                                                        {e.old || "—"} → <strong>{e.new || "—"}</strong>
                                                                                </>
                                                                        ) : null}
                                                                </span>
                                                                {e.error && <span class="hm-auditlog__error">✗ {e.error}</span>}
                                                        </span>
                                                        <time class="hm-alarmlog__time">{formatTime(e.ts)}</time>
                                                </li>
                                        ))}
                                </ul>
                        )}

                        <div class="hm-alarmlog__foot">Últimos {entries?.length ?? 0} registros (histórico completo en hmi-config/audit.csv)</div>
                </div>
        );
}
