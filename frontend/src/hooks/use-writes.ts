import { useCallback, useState } from "preact/hooks";
import type { Backend, Machine, Snapshot } from "../api/backend";
import type { Notice } from "../lib/notice";

export function useWrites(backend: Backend, setSnapshot: (s: Snapshot) => void) {
        const [notice, setNotice] = useState<Notice | null>(null);

        const write = useCallback(
                async (address: string, value: number | boolean) => {
                        setNotice(null);
                        try {
                                const snap = await backend.writeTag(address, value);
                                setSnapshot(snap);
                                setNotice({ tone: "ok", text: `${address} ← ${String(value)}` });
                        } catch (e) {
                                setNotice({ tone: "error", text: e instanceof Error ? e.message : String(e) });
                        }
                },
                [backend, setSnapshot],
        );

        const pulseAck = useCallback(
                async (machineId: string, machines: Machine[], canWrite: boolean) => {
                        const m = machines.find((x) => x.id === machineId);
                        const ackAddress = m?.statusTags?.ack;
                        if (!ackAddress || !canWrite) return;
                        try {
                                const snap = await backend.writeTag(ackAddress, true);
                                setSnapshot(snap);
                                window.setTimeout(() => {
                                        void backend
                                                .writeTag(ackAddress, false)
                                                .then(setSnapshot)
                                                .catch(() => {});
                                }, 300);
                        } catch {
                                setNotice(null);
                        }
                },
                [backend, setSnapshot],
        );

        return { notice, setNotice, write, pulseAck };
}
