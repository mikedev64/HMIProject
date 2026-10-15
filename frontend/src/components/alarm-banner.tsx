import { Badge, Button } from "interface-components";
import type { AlarmEvent } from "../lib/alarms";
import { formatTime } from "../lib/format";

export interface AlarmBannerProps {
        events: AlarmEvent[];
        maxItems?: number;
        canAck?: boolean;
        onAck: (id: number) => void;
        onAckAll: () => void;
}

export function AlarmBanner({ events, maxItems = 4, canAck = true, onAck, onAckAll }: AlarmBannerProps) {
        const pending = events.filter((e) => e.clearedTs === null && e.ackedTs === null);
        if (pending.length === 0) return null;

        const shown = pending.slice(0, Math.max(1, maxItems));
        const rest = pending.length - shown.length;

        return (
                <div class="hm-banner-alarm" role="status">
                        <span class="hm-banner-alarm__title">
                                <Badge tone="danger" dot>
                                        {pending.length} ALARMA{pending.length === 1 ? "" : "S"}
                                </Badge>
                        </span>

                        <ul class="hm-banner-alarm__list">
                                {shown.map((e) => (
                                        <li key={e.id} class="hm-banner-alarm__item">
                                                <span class="hm-alarms__dot" />
                                                <strong>{e.machineName}</strong>
                                                <span>{e.label}</span>
                                                <time>{formatTime(e.ts)}</time>{" "}
                                                <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        title="Reconocer alarma"
                                                        disabled={!canAck}
                                                        onClick={() => onAck(e.id)}
                                                >
                                                        ✓
                                                </Button>
                                        </li>
                                ))}
                                {rest > 0 && <li class="hm-banner-alarm__item hm-banner-alarm__more">+{rest} más…</li>}
                        </ul>

                        <Button size="sm" variant="danger" disabled={!canAck} onClick={onAckAll}>
                                Reconocer todo
                        </Button>
                </div>
        );
}
