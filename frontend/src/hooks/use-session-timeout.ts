import { useEffect } from "preact/hooks";
import type { SessionInfo } from "../api/backend";

const CHECK_MS = 30_000;

export function useSessionTimeout(session: SessionInfo, timeoutMin: number, onExpire: () => void) {
        useEffect(() => {
                if (!session.authenticated || timeoutMin <= 0) return;
                const timer = window.setInterval(() => {
                        if (session.since && Date.now() - session.since > timeoutMin * 60_000) onExpire();
                }, CHECK_MS);
                return () => window.clearInterval(timer);
        }, [session, timeoutMin, onExpire]);
}
