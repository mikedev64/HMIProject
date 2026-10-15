import { useMemo, useState } from "preact/hooks";
import type { HMIConfig, Machine } from "../api/backend";

export interface MachineSelection {
        machines: Machine[];
        selected: Machine | null;
        selectedId: string | null;
        select: (id: string | null) => void;
}

export function useMachines(config: HMIConfig | null): MachineSelection {
        const [selectedId, setSelectedId] = useState<string | null>(null);

        const machines = useMemo(() => config?.machines ?? [], [config]);

        const selected = useMemo(() => {
                if (!machines.length) return null;
                return machines.find((m) => m.id === selectedId) ?? machines[0]!;
        }, [machines, selectedId]);

        return { machines, selected, selectedId: selected?.id ?? null, select: setSelectedId };
}
