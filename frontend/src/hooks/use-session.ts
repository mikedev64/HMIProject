import { useCallback, useEffect, useState } from "preact/hooks";
import type { Backend, RuntimeFlags, SessionInfo } from "../api/backend";

export interface SessionState {
        session: SessionInfo;
        flags: RuntimeFlags;
        ready: boolean;
        login: (username: string, password: string) => Promise<void>;
        logout: () => Promise<void>;
}

export function useSession(backend: Backend): SessionState {
        const [session, setSession] = useState<SessionInfo>({ authenticated: false });
        const [flags, setFlags] = useState<RuntimeFlags>({ onlyMouse: false });
        const [ready, setReady] = useState(false);

        useEffect(() => {
                let alive = true;
                void backend.getSession().then((s) => {
                        if (!alive) return;
                        setSession(s);
                        setReady(true);
                });
                void backend.getRuntimeFlags().then((f) => alive && setFlags(f));
                return () => {
                        alive = false;
                };
        }, [backend]);

        const login = useCallback(
                async (username: string, password: string) => {
                        const next = await backend.login(username, password);
                        setSession(next);
                },
                [backend],
        );

        const logout = useCallback(async () => {
                await backend.logout();
                setSession({ authenticated: false });
        }, [backend]);

        return { session, flags, ready, login, logout };
}
