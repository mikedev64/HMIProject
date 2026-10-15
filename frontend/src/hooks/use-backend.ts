import { useEffect } from "preact/hooks";
import type { Backend } from "../api/backend";
import { backend } from "../api/backend";

export function useBackend(): Backend {
        useEffect(() => {
                if (backend.kind !== "preview") return;
                const update = () => {
                        document.documentElement.classList.toggle("preview", !new URLSearchParams(location.search).has("live"));
                };
                update();
                window.addEventListener("hashchange", update);
                return () => window.removeEventListener("hashchange", update);
        }, []);

        return backend;
}
