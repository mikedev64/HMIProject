import { useEffect, useState } from "preact/hooks";
import { Badge, Button } from "interface-components";
import type { HMIConfig, UserSummary } from "../api/backend";
import { backend } from "../api/backend";
import type { ValidateResult } from "../lib/hmi-validate";
import { validateMachineRaw } from "../lib/hmi-validate";
import type { Notice } from "../lib/notice";
import { errorMessage } from "../lib/levels";

export interface ConfigWorkspaceProps {
        config: HMIConfig;
        onClose: () => void;
        onConfigSaved: () => void;
}

export function ConfigWorkspace({ config, onClose, onConfigSaved }: ConfigWorkspaceProps) {
        const [tab, setTab] = useState<"machines" | "users">("machines");

        return (
                <div class="hm-config" role="dialog" aria-modal="true" aria-label="Configuración">
                        <div class="hm-config__card">
                                <header class="hm-config__head">
                                        <strong class="hm-config__title">⚙ Configuración</strong>
                                        <nav class="hm-config__tabs">
                                                <button
                                                        type="button"
                                                        class={`hm-config__tab${tab === "machines" ? " is-active" : ""}`}
                                                        onClick={() => setTab("machines")}
                                                >
                                                        Máquinas
                                                </button>
                                                <button
                                                        type="button"
                                                        class={`hm-config__tab${tab === "users" ? " is-active" : ""}`}
                                                        onClick={() => setTab("users")}
                                                >
                                                        Usuarios
                                                </button>
                                        </nav>
                                        <button type="button" class="hm-config__close" onClick={onClose} aria-label="Cerrar configuración">
                                                ✕
                                        </button>
                                </header>

                                <div class="hm-config__body">
                                        {tab === "machines" ? <MachinesEditor config={config} onSaved={onConfigSaved} /> : <UsersAdmin />}
                                </div>
                        </div>
                </div>
        );
}

function MachinesEditor({ config, onSaved }: { config: HMIConfig; onSaved: () => void }) {
        const machines = config.machines ?? [];
        const [selectedId, setSelectedId] = useState(machines[0]?.id ?? "");
        const machine = machines.find((m) => m.id === selectedId) ?? machines[0];
        const [text, setText] = useState("");
        const [result, setResult] = useState<ValidateResult | null>(null);
        const [notice, setNotice] = useState<Notice | null>(null);
        const [dirty, setDirty] = useState(false);

        useEffect(() => {
                if (!machine) return;
                setText(JSON.stringify(machine, null, 2));
                setResult(null);
                setDirty(false);
        }, [machine?.id]);

        if (!machine) return <p class="hm-empty">No hay máquinas configuradas.</p>;

        const validate = (): ValidateResult => {
                const res = validateMachineRaw(machine.id, text);
                setResult(res);
                return res;
        };

        const save = async () => {
                const res = validate();
                if (res.errors.length > 0) {
                        setNotice({ tone: "error", text: "Corrige los errores antes de guardar" });
                        return;
                }
                setNotice(null);
                try {
                        const saved = await backend.saveMachineConfig(machine.id, text);
                        setResult(saved);
                        if (!saved.saved) {
                                setNotice({ tone: "error", text: "El backend rechazó la configuración" });
                                return;
                        }
                        setDirty(false);
                        setNotice({
                                tone: "ok",
                                text: `Configuración de ${machine.name} guardada${saved.warnings.length ? ` (${saved.warnings.length} avisos)` : ""}`,
                        });
                        onSaved();
                } catch (e) {
                        setNotice({ tone: "error", text: errorMessage(e) });
                }
        };

        const download = () => {
                const blob = new Blob([text], { type: "application/json;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${machine.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
        };

        return (
                <div class="hm-cfgeditor">
                        <aside class="hm-cfgeditor__list">
                                {machines.map((m) => (
                                        <button
                                                key={m.id}
                                                type="button"
                                                class={`hm-cfgeditor__machine${m.id === machine.id ? " is-active" : ""}`}
                                                onClick={() => setSelectedId(m.id)}
                                        >
                                                {m.name}
                                                <code>{m.id}.json</code>
                                        </button>
                                ))}
                        </aside>

                        <section class="hm-cfgeditor__main">
                                <div class="hm-cfgeditor__toolbar">
                                        <strong>{machine.name}</strong>
                                        <code>hmi-config/machines/{machine.id}.json</code>
                                        <span class="hm-cfgeditor__spacer" />
                                        <Button size="sm" variant="ghost" onClick={() => void validate()}>
                                                Validar
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={download}>
                                                ⤓ JSON
                                        </Button>
                                        <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                        setText(JSON.stringify(machine, null, 2));
                                                        setResult(null);
                                                        setNotice(null);
                                                        setDirty(false);
                                                }}
                                        >
                                                Descartar
                                        </Button>
                                        <Button size="sm" variant="primary" onClick={() => void save()}>
                                                Guardar
                                        </Button>
                                </div>

                                <textarea
                                        class="hm-cfgeditor__code"
                                        spellcheck={false}
                                        value={text}
                                        onInput={(e) => {
                                                setText(e.currentTarget.value);
                                                setDirty(true);
                                        }}
                                />

                                <div class="hm-cfgeditor__issues">
                                        {notice && <p class={`hm-notice hm-notice--${notice.tone}`}>{notice.text}</p>}
                                        {dirty && !notice && (
                                                <p class="hm-cfgeditor__hint">
                                                        Cambios sin guardar · «Validar» comprueba el JSON, «Guardar» lo escribe en disco.
                                                </p>
                                        )}
                                        {result && (
                                                <>
                                                        {result.errors.length === 0 && result.warnings.length === 0 && (
                                                                <p class="hm-cfgeditor__hint">✓ Sin errores ni avisos</p>
                                                        )}
                                                        {result.errors.map((e, i) => (
                                                                <p key={`e${i}`} class="hm-cfgeditor__issue is-error">
                                                                        <Badge tone="danger">ERROR</Badge> {e}
                                                                </p>
                                                        ))}
                                                        {result.warnings.map((w, i) => (
                                                                <p key={`w${i}`} class="hm-cfgeditor__issue is-warn">
                                                                        <Badge tone="warn">AVISO</Badge> {w}
                                                                </p>
                                                        ))}
                                                </>
                                        )}
                                </div>
                        </section>
                </div>
        );
}

const LEVELS = ["viewer", "operator", "admin"];

function UsersAdmin() {
        const [users, setUsers] = useState<UserSummary[]>([]);
        const [notice, setNotice] = useState<Notice | null>(null);
        const [newUser, setNewUser] = useState({ username: "", password: "", level: "operator" });

        const refresh = (): Promise<void> =>
                backend
                        .listUsers()
                        .then(setUsers)
                        .catch((e) => {
                                setNotice({ tone: "error", text: errorMessage(e) });
                        });
        useEffect(() => {
                void refresh();
        }, []);

        const onError = (text: string) => setNotice({ tone: "error", text });

        const run = async (fn: () => Promise<unknown>, okText: string) => {
                setNotice(null);
                try {
                        await fn();
                        setNotice({ tone: "ok", text: okText });
                        refresh();
                } catch (e) {
                        setNotice({ tone: "error", text: errorMessage(e) });
                }
        };

        return (
                <div class="hm-users">
                        <p class="hm-cfgeditor__hint">
                                Los hashes PBKDF2 viven en <code>hmi-config/users.json</code> y la verificación ocurre en el backend Go. Contraseñas:
                                mínimo 6 caracteres.
                        </p>

                        <table class="hm-users__table">
                                <thead>
                                        <tr>
                                                <th>Usuario</th>
                                                <th>Nivel</th>
                                                <th>Nueva contraseña</th>
                                                <th />
                                        </tr>
                                </thead>
                                <tbody>
                                        {users.map((u) => (
                                                <UserRow key={u.username} user={u} onError={onError} onChange={() => void refresh()} />
                                        ))}
                                </tbody>
                        </table>

                        <div class="hm-users__new">
                                <input
                                        class="hm-recipes__input"
                                        type="text"
                                        placeholder="usuario"
                                        value={newUser.username}
                                        onInput={(e) => setNewUser({ ...newUser, username: e.currentTarget.value })}
                                />
                                <input
                                        class="hm-recipes__input"
                                        type="password"
                                        placeholder="contraseña"
                                        value={newUser.password}
                                        onInput={(e) => setNewUser({ ...newUser, password: e.currentTarget.value })}
                                />
                                <select
                                        class="hm-users__select"
                                        value={newUser.level}
                                        onChange={(e) => setNewUser({ ...newUser, level: e.currentTarget.value })}
                                >
                                        {LEVELS.map((l) => (
                                                <option key={l} value={l}>
                                                        {l}
                                                </option>
                                        ))}
                                </select>
                                <Button
                                        size="sm"
                                        variant="primary"
                                        disabled={!newUser.username.trim() || !newUser.password}
                                        onClick={() =>
                                                void run(async () => {
                                                        await backend.setUser(newUser.username.trim(), newUser.password, newUser.level);
                                                        setNewUser({ username: "", password: "", level: "operator" });
                                                }, `Usuario «${newUser.username}» creado`)
                                        }
                                >
                                        Añadir usuario
                                </Button>
                        </div>

                        {notice && <p class={`hm-notice hm-notice--${notice.tone}`}>{notice.text}</p>}
                </div>
        );
}

function UserRow({ user, onError, onChange }: { user: UserSummary; onError: (msg: string) => void; onChange: () => void }) {
        const [level, setLevel] = useState(user.level);
        const [password, setPassword] = useState("");
        const [busy, setBusy] = useState(false);

        const apply = async (fn: () => Promise<unknown>) => {
                setBusy(true);
                try {
                        await fn();
                        onChange();
                } catch (e) {
                        onError(errorMessage(e));
                } finally {
                        setBusy(false);
                }
        };

        return (
                <tr>
                        <td>
                                <strong>{user.username}</strong>
                        </td>
                        <td>
                                <select class="hm-users__select" value={level} onChange={(e) => setLevel(e.currentTarget.value)}>
                                        {LEVELS.map((l) => (
                                                <option key={l} value={l}>
                                                        {l}
                                                </option>
                                        ))}
                                </select>
                        </td>
                        <td>
                                <input
                                        class="hm-recipes__input"
                                        type="password"
                                        placeholder="(sin cambio)"
                                        value={password}
                                        onInput={(e) => setPassword(e.currentTarget.value)}
                                />
                        </td>
                        <td class="hm-users__actions">
                                <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={busy}
                                        onClick={() => {
                                                const pass = password;
                                                void apply(async () => {
                                                        await backend.setUser(user.username, pass, level);
                                                        setPassword("");
                                                });
                                        }}
                                >
                                        Guardar
                                </Button>
                                <Button
                                        size="sm"
                                        variant="ghost"
                                        title="Eliminar usuario"
                                        disabled={busy}
                                        onClick={() => void apply(() => backend.deleteUser(user.username))}
                                >
                                        ✕
                                </Button>
                        </td>
                </tr>
        );
}
