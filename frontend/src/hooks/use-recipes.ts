import { useCallback, useEffect, useState } from "preact/hooks";
import type { Backend, Recipe } from "../api/backend";

export function useRecipes(backend: Backend, machineId: string | undefined) {
        const [recipes, setRecipes] = useState<Recipe[]>([]);

        const refresh = useCallback(async () => {
                if (!machineId) {
                        setRecipes([]);
                        return;
                }
                try {
                        setRecipes(await backend.getRecipes(machineId));
                } catch {
                        setRecipes([]);
                }
        }, [backend, machineId]);

        useEffect(() => {
                void refresh();
        }, [refresh]);

        return { recipes, refresh };
}
