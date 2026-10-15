import { useState } from "preact/hooks";
import { Badge, Button } from "interface-components";

export function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
        const [username, setUsername] = useState("");
        const [password, setPassword] = useState("");
        const [error, setError] = useState<string | null>(null);
        const [busy, setBusy] = useState(false);
        const [kbdOpen, setKbdOpen] = useState(false);
        const [focusField, setFocusField] = useState<"user" | "pass">("user");

        const doLogin = async () => {
                if (busy) return;
                setBusy(true);
                setError(null);
                try {
                        await onLogin(username.trim(), password);
                        setPassword("");
                } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                } finally {
                        setBusy(false);
                }
        };

        const submit = async (e: Event) => {
                e.preventDefault();
                await doLogin();
        };

        const press = (key: string) => {
                const set = focusField === "user" ? setUsername : setPassword;
                if (key === "⌫") {
                        set((v) => v.slice(0, -1));
                        return;
                }
                if (key === "⎵") {
                        set((v) => v + " ");
                        return;
                }
                set((v) => v + key);
        };

        return (
                <div class="hm-login">
                        <form class="hm-login__card" onSubmit={submit}>
                                <div class="hm-login__brand">
                                        <span class="hm-brand__mark">◆</span>
                                        <span class="hm-brand__name">HMInot</span>
                                        <span class="hm-brand__sub">PanelView</span>
                                </div>
                                <h1 class="hm-login__title">Acceso al terminal</h1>

                                <label class="hm-login__label" for="hm-user">
                                        Usuario
                                </label>
                                <input
                                        id="hm-user"
                                        class="hm-login__input"
                                        type="text"
                                        autocomplete="username"
                                        autofocus
                                        value={username}
                                        onFocus={() => setFocusField("user")}
                                        onInput={(e) => setUsername(e.currentTarget.value)}
                                />

                                <label class="hm-login__label" for="hm-pass">
                                        Contraseña
                                </label>
                                <input
                                        id="hm-pass"
                                        class="hm-login__input"
                                        type="password"
                                        autocomplete="current-password"
                                        value={password}
                                        onFocus={() => setFocusField("pass")}
                                        onInput={(e) => setPassword(e.currentTarget.value)}
                                />

                                {error && (
                                        <p class="hm-login__error" role="alert">
                                                {error}
                                        </p>
                                )}

                                <Button type="submit" variant="primary" disabled={busy}>
                                        {busy ? "Verificando…" : "Entrar"}
                                </Button>

                                <button type="button" class="hm-login__kbdtoggle" aria-pressed={kbdOpen} onClick={() => setKbdOpen((v) => !v)}>
                                        {kbdOpen ? "▴ Ocultar teclado" : "▾ Teclado en pantalla"}
                                </button>

                                {kbdOpen && (
                                        <div class="hm-kbd" role="group" aria-label="Teclado en pantalla">
                                                {["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"].map((row) => (
                                                        <div class="hm-kbd__row" key={row}>
                                                                {row.split("").map((k) => (
                                                                        <button key={k} type="button" class="hm-kbd__key" onClick={() => press(k)}>
                                                                                {k}
                                                                        </button>
                                                                ))}
                                                        </div>
                                                ))}
                                                <div class="hm-kbd__row">
                                                        <button type="button" class="hm-kbd__key hm-kbd__key--wide" onClick={() => press("⎵")}>
                                                                espacio
                                                        </button>
                                                        <button type="button" class="hm-kbd__key" onClick={() => press("⌫")}>
                                                                ⌫
                                                        </button>
                                                        <button type="button" class="hm-kbd__key hm-kbd__key--ok" onClick={() => void doLogin()}>
                                                                Entrar
                                                        </button>
                                                </div>
                                        </div>
                                )}

                                <p class="hm-login__hint">
                                        <Badge tone="info">PBKDF2</Badge> verificación en el backend
                                </p>
                        </form>
                </div>
        );
}
