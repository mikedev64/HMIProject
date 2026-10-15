import { useCallback, useEffect, useState } from "preact/hooks";
import type { Backend, HMIConfig } from "../api/backend";
import { errorMessage } from "../lib/levels";

export function useConfig(backend: Backend) {
        const [config, setConfig] = useState<HMIConfig | null>(null);
        const [error, setError] = useState<string | null>(null);

        const refresh = useCallback(async () => {
                try {
                        setConfig(await backend.getMachines());
                        setError(null);
                } catch (e) {
                        setError(errorMessage(e));
                }
        }, [backend]);

        useEffect(() => {
                void refresh();
        }, [refresh]);

        return { config, error, refresh };
}
