import { useCallback, useEffect, useState } from "preact/hooks";

export function useFullscreen() {
        const [fullscreen, setFullscreen] = useState(false);

        useEffect(() => {
                const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
                document.addEventListener("fullscreenchange", onChange);
                return () => document.removeEventListener("fullscreenchange", onChange);
        }, []);

        const toggle = useCallback(() => {
                const op = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
                op.catch(() => {});
        }, []);

        return { fullscreen, toggle };
}
