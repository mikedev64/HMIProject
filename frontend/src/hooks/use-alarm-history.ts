import { useEffect, useRef, useState } from "preact/hooks";
import type { Machine, Snapshot } from "../api/backend";
import type { AlarmEvent } from "../lib/alarms";
import { asBool } from "../lib/format";

let idSeed = 1;

const MAX_EVENTS = 100;
const MAX_PERSISTED = 200;
const HISTORY_KEY = "hmi.alarmHistory";

function loadPersisted(): AlarmEvent[] {
        try {
                const raw = localStorage.getItem(HISTORY_KEY);
                if (raw) {
                        const list = JSON.parse(raw) as AlarmEvent[];
                        if (Array.isArray(list)) return list;
                }
        } catch {
                return [];
        }
        return [];
}

export function useAlarmHistory(snapshot: Snapshot, machines: Machine[]) {
        const [events, setEvents] = useState<AlarmEvent[]>(() => {
                const persisted = loadPersisted();
                if (persisted.length > 0) idSeed = Math.max(idSeed, ...persisted.map((e) => e.id + 1));
                return persisted;
        });
        const prevRef = useRef<Map<string, boolean>>(new Map());
        const idRef = useRef(idSeed);

        useEffect(() => {
                try {
                        localStorage.setItem(HISTORY_KEY, JSON.stringify(events.slice(0, MAX_PERSISTED)));
                } catch {
                        return;
                }
        }, [events]);

        useEffect(() => {
                if (machines.length === 0) return;

                const next = new Map<string, boolean>();
                const risen: { machine: Machine; address: string; label: string }[] = [];
                const fallen: string[] = [];

                for (const m of machines) {
                        const address = m.statusTags?.alarm;
                        if (!address) continue;
                        const active = asBool(snapshot.values?.[address]);
                        next.set(address, active);
                        const was = prevRef.current.get(address);
                        if (active && was !== true) {
                                const tag = m.tags.find((t) => t.address === address);
                                risen.push({ machine: m, address, label: tag?.label ?? address });
                        }
                        if (!active && was === true) fallen.push(address);
                }

                prevRef.current = next;
                if (risen.length === 0 && fallen.length === 0) return;

                const now = Date.now();
                const created: AlarmEvent[] = risen.map((r) => ({
                        id: idRef.current++,
                        machineId: r.machine.id,
                        machineName: r.machine.name,
                        label: r.label,
                        address: r.address,
                        ts: now,
                        clearedTs: null,
                        ackedTs: null,
                }));

                setEvents((current) => {
                        let list = current;
                        if (fallen.length > 0) {
                                list = list.map((e) => {
                                        if (e.clearedTs !== null || !fallen.includes(e.address)) return e;
                                        const isLastOpen = !list
                                                .slice(list.indexOf(e) + 1)
                                                .some((x) => x.address === e.address && x.clearedTs === null);
                                        return isLastOpen ? { ...e, clearedTs: now } : e;
                                });
                        }
                        if (created.length > 0) list = [...created, ...list];
                        if (list.length > MAX_EVENTS) list = list.slice(0, MAX_EVENTS);
                        return list;
                });
        }, [snapshot, machines]);

        const activeCount = events.reduce((acc, e) => acc + (e.clearedTs === null ? 1 : 0), 0);

        const clear = () => setEvents((current) => current.filter((e) => e.clearedTs === null));

        const ack = (id: number) =>
                setEvents((current) => current.map((e) => (e.id === id && e.ackedTs === null ? { ...e, ackedTs: Date.now() } : e)));

        const ackAll = () => {
                const now = Date.now();
                setEvents((current) => current.map((e) => (e.clearedTs === null && e.ackedTs === null ? { ...e, ackedTs: now } : e)));
        };

        return { events, activeCount, clear, ack, ackAll };
}
