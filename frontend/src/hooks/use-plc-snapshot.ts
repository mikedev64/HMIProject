import { useEffect, useRef, useState } from "preact/hooks";
import type { Backend, Snapshot } from "../api/backend";
import { EMPTY_SNAPSHOT } from "../api/backend";

const EMIT_GAP_MS = 100;
const MIN_DELTA = 1e-6;

export function usePlcSnapshot(backend: Backend) {
        const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
        const lastEmitRef = useRef(0);
        const lastSnapRef = useRef<Snapshot | null>(null);

        useEffect(() => {
                let alive = true;
                let emitTimer = 0;

                void backend
                        .getSnapshot()
                        .then((s) => alive && setSnapshot(s))
                        .catch(() => {});

                const emit = () => {
                        window.clearTimeout(emitTimer);
                        emitTimer = 0;
                        const next = lastSnapRef.current;
                        if (!next) return;
                        lastEmitRef.current = Date.now();
                        setSnapshot(next);
                };

                const push = (next: Snapshot) => {
                        const prev = lastSnapRef.current;
                        if (prev && prev.connected === next.connected && prev.ts === next.ts && prev.error === next.error) {
                                let changed = false;
                                const keys = new Set([...Object.keys(prev.values ?? {}), ...Object.keys(next.values ?? {})]);
                                for (const k of keys) {
                                        const a = prev.values?.[k];
                                        const b = next.values?.[k];
                                        const delta = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) : a === b ? 0 : Infinity;
                                        if (delta > MIN_DELTA) {
                                                changed = true;
                                                break;
                                        }
                                }
                                if (!changed) return;
                        }
                        lastSnapRef.current = next;
                        const wait = Math.max(0, EMIT_GAP_MS - (Date.now() - lastEmitRef.current));
                        if (wait === 0 && !emitTimer) emit();
                        else if (!emitTimer) emitTimer = window.setTimeout(emit, wait);
                };

                lastSnapRef.current = null;
                const stop = backend.onSnapshot(push);
                return () => {
                        alive = false;
                        window.clearTimeout(emitTimer);
                        stop();
                };
        }, [backend]);

        return { snapshot, setSnapshot };
}
