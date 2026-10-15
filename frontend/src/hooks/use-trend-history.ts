import { useEffect, useRef, useState } from "preact/hooks";
import type { Snapshot } from "../api/backend";
import type { TrendPoint } from "../lib/trends";

const MAX_POINTS = 120;

export function useTrendHistory(snapshot: Snapshot): Map<string, TrendPoint[]> {
        const historyRef = useRef<Map<string, TrendPoint[]>>(new Map());
        const lastTsRef = useRef(0);
        const [, setTick] = useState(0);

        useEffect(() => {
                if (!snapshot.ts || snapshot.ts === lastTsRef.current) return;
                lastTsRef.current = snapshot.ts;

                const map = historyRef.current;
                for (const [address, value] of Object.entries(snapshot.values ?? {})) {
                        if (typeof value !== "number" || !Number.isFinite(value)) continue;
                        const serie = map.get(address);
                        const point: TrendPoint = { t: snapshot.ts, v: value };
                        if (serie) {
                                serie.push(point);
                                if (serie.length > MAX_POINTS) serie.splice(0, serie.length - MAX_POINTS);
                        } else {
                                map.set(address, [point]);
                        }
                }
                setTick((t) => (t + 1) % 100000);
        }, [snapshot]);

        return historyRef.current;
}
