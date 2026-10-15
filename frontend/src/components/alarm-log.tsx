import { Button } from "interface-components";
import type { AlarmEvent } from "../lib/alarms";
import { formatTime } from "../lib/format";

export function AlarmLog({ events, onClose, onClear }: { events: AlarmEvent[]; onClose: () => void; onClear: () => void }) {
        return (
                <div class="hm-alarmlog">
                        <div class="hm-alarmlog__head">
                                <strong>Registro de alarmas</strong>
                                <span class="hm-alarmlog__actions">
                                        <Button size="sm" variant="ghost" onClick={onClear}>
                                                Limpiar
                                        </Button>
                                        <button type="button" class="hm-alarmlog__close" onClick={onClose} aria-label="Cerrar registro">
                                                ✕
                                        </button>
                                </span>
                        </div>
                        {events.length === 0 ? (
                                <p class="hm-alarmlog__empty">Sin alarmas registradas.</p>
                        ) : (
                                <ul class="hm-alarmlog__list">
                                        {events.slice(0, 25).map((e) => {
                                                const active = e.clearedTs === null;
                                                return (
                                                        <li key={e.id} class={active ? "is-active" : undefined}>
                                                                <span class="hm-alarms__dot" />
                                                                <span class="hm-alarmlog__body">
                                                                        <strong>{e.machineName}</strong>
                                                                        <span>{e.label}</span>
                                                                </span>
                                                                <time class="hm-alarmlog__time">{formatTime(e.ts)}</time>
                                                        </li>
                                                );
                                        })}
                                </ul>
                        )}
                </div>
        );
}
