import type {
        AuditEntry,
        BackendImpl,
        HMIConfig,
        Machine,
        Recipe,
        RuntimeFlags,
        SessionInfo,
        Snapshot,
        UserSummary,
        ValidateResult,
} from "./backend";
import { validateMachineRaw } from "../lib/hmi-validate";
import { ADMIN_RANK, OPERATOR_RANK, levelRank } from "../lib/levels";

const SESSION_KEY = "hmi.session";
const USERS_KEY = "hmi.users";
const AUDIT_KEY = "hmi.audit";
const FAILS_KEY = "hmi.loginFails";
const machineKey = (id: string) => `hmi.machine.${id}`;
const recipesKey = (id: string) => `hmi.recipes.${id}`;

const ANON: SessionInfo = { authenticated: false };
const AUDIT_CAP = 200;
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 60_000;

type StoredUser = { username: string; level: string; salt: string; hash: string };
type UsersFile = { version?: number; algorithm?: string; iterations?: number; users: StoredUser[] };

function readJSON<T>(key: string, fallback: T): T {
        try {
                const raw = localStorage.getItem(key);
                if (raw) return JSON.parse(raw) as T;
        } catch {
                return fallback;
        }
        return fallback;
}

function writeJSON(key: string, value: unknown) {
        try {
                localStorage.setItem(key, JSON.stringify(value));
        } catch {
                return;
        }
}

function readSessionFile(): SessionInfo {
        return readJSON<SessionInfo>(SESSION_KEY, ANON);
}

function writeSessionFile(next: SessionInfo) {
        try {
                if (next.authenticated) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
                else localStorage.removeItem(SESSION_KEY);
        } catch {
                return;
        }
}

type Fails = Record<string, { count: number; until: number }>;
const readFails = (): Fails => readJSON<Fails>(FAILS_KEY, {});
const writeFails = (f: Fails) => writeJSON(FAILS_KEY, f);

async function pbkdf2(password: string, saltB64: string, iterations: number): Promise<string> {
        const enc = new TextEncoder();
        const raw = atob(saltB64);
        const salt = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) salt[i] = raw.charCodeAt(i);
        const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
        const bytes = new Uint8Array(bits);
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin);
}

export function previewBackend(): BackendImpl {
        let configPromise: Promise<HMIConfig> | null = null;
        let session: SessionInfo | null = null;

        const loadConfig = (): Promise<HMIConfig> =>
                (configPromise ??= (async () => {
                        const cfg = (await fetch("/hmi-config/machines.json").then((r) => r.json())) as HMIConfig;
                        cfg.machines = (cfg.machines ?? []).map((m) => readJSON<Machine | null>(machineKey(m.id), null) ?? m);
                        return cfg;
                })());

        const findTagDef = async (address: string) => {
                const cfg = await loadConfig();
                for (const m of cfg.machines ?? []) {
                        const t = m.tags.find((x) => x.address === address);
                        if (t) return t;
                }
                return null;
        };

        const readSession = (): SessionInfo => {
                if (session) return session;
                session = readSessionFile();
                return session;
        };

        const writeSession = (next: SessionInfo) => {
                session = next;
                writeSessionFile(next);
        };

        const requireLevel = async (rank: number, levelName: string): Promise<void> => {
                const cfg = await loadConfig();
                if (!cfg.security?.requireLogin) return;
                const current = readSession();
                if (levelRank(current.level) < rank) {
                        throw new Error(`el nivel "${current.level ?? "(sin sesión)"}" no puede realizar esta operación (se requiere ${levelName})`);
                }
        };

        const pushAudit = (e: Omit<AuditEntry, "ts" | "user" | "level"> & { ts?: number; user?: string; level?: string }) => {
                const s = readSession();
                const entry: AuditEntry = {
                        ts: e.ts ?? Date.now(),
                        user: e.user ?? (s.authenticated ? (s.username ?? "(sin sesión)") : "(sin sesión)"),
                        level: e.level ?? (s.authenticated ? (s.level ?? "") : ""),
                        machine: e.machine,
                        label: e.label,
                        address: e.address,
                        old: e.old,
                        new: e.new,
                        error: e.error,
                };
                const list = readJSON<AuditEntry[]>(AUDIT_KEY, []);
                list.push(entry);
                writeJSON(AUDIT_KEY, list.length > AUDIT_CAP ? list.slice(-AUDIT_CAP) : list);
        };

        const describeAddress = async (address: string): Promise<{ machine: string; label: string }> => {
                try {
                        const cfg = await loadConfig();
                        for (const m of cfg.machines ?? []) {
                                const t = m.tags.find((x) => x.address === address);
                                if (t) return { machine: m.name, label: t.label };
                        }
                } catch {
                        return { machine: "", label: "" };
                }
                return { machine: "", label: "" };
        };

        const snapshotFrom = async (): Promise<Snapshot> => {
                try {
                        const res = await fetch("/eip/state");
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return (await res.json()) as Snapshot;
                } catch (e) {
                        return { connected: false, ts: Date.now(), values: {}, error: `PLC no responde: ${e}` };
                }
        };

        const loadUsers = async (): Promise<UsersFile> => {
                const cached = readJSON<UsersFile | null>(USERS_KEY, null);
                if (cached?.users?.length) return cached;
                const res = await fetch("/hmi-config/users.json");
                if (!res.ok) throw new Error("No hay usuarios configurados en el preview");
                const file = (await res.json()) as UsersFile;
                writeJSON(USERS_KEY, file);
                return file;
        };

        const saveUsers = (file: UsersFile) => writeJSON(USERS_KEY, file);

        const validateUserInput = (username: string, password: string, level: string) => {
                if (!username.trim()) throw new Error("el usuario no puede estar vacío");
                if (!["viewer", "operator", "admin"].includes(level)) throw new Error(`nivel "${level}" desconocido (viewer | operator | admin)`);
                if (password && password.length < 6) throw new Error("la contraseña debe tener al menos 6 caracteres");
        };

        const loadRecipes = async (machineId: string): Promise<Recipe[]> => {
                const cached = readJSON<Recipe[] | null>(recipesKey(machineId), null);
                if (cached) return cached;
                let list: Recipe[] = [];
                try {
                        const res = await fetch(`/hmi-config/recipes/${machineId}.json`);
                        if (res.ok) {
                                const data = await res.json();
                                if (Array.isArray(data)) list = data as Recipe[];
                        }
                } catch {
                        list = [];
                }
                writeJSON(recipesKey(machineId), list);
                return list;
        };

        return {
                async getMachines(): Promise<HMIConfig> {
                        return loadConfig();
                },

                getSnapshot: snapshotFrom,

                async writeTag(address: string, value: unknown): Promise<Snapshot> {
                        const cfg = await loadConfig();
                        const denied = cfg.security?.requireLogin && levelRank(readSession().level) < OPERATOR_RANK;
                        if (denied) {
                                const err = new Error("inicia sesión como operador para escribir en el PLC");
                                pushAudit({ machine: "", label: "", address, old: "", new: String(value), error: err.message });
                                throw err;
                        }

                        const tag = await findTagDef(address);
                        const res = await fetch("/eip/write", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ address, dataType: tag?.dataType ?? "float32", value }),
                        });
                        const body = (await res.json()) as { error?: string; ok?: boolean };
                        const { machine, label } = await describeAddress(address);
                        if (!res.ok || !body.ok) {
                                const message = body.error ?? `HTTP ${res.status}`;
                                pushAudit({ machine, label, address, old: "", new: String(value), error: message });
                                throw new Error(message);
                        }
                        const snap = await snapshotFrom();
                        pushAudit({ machine, label, address, old: String(snap.values?.[address] ?? ""), new: String(value) });
                        return snap;
                },

                onSnapshot(cb: (s: Snapshot) => void): () => void {
                        let source: EventSource | null = null;
                        let stopped = false;
                        let timer = 0;
                        let failures = 0;

                        const fallbackPoll = () => {
                                if (stopped) return;
                                void snapshotFrom().then((snap) => {
                                        cb(snap);
                                        failures = snap.connected ? 0 : Math.min(failures + 1, 4);
                                        timer = window.setTimeout(fallbackPoll, snap.connected ? 500 : Math.min(500 * 2 ** (failures - 1), 5000));
                                });
                        };

                        const open = () => {
                                if (stopped) return;
                                try {
                                        source = new EventSource("/eip/stream");
                                        source.onmessage = (ev) => {
                                                try {
                                                        cb(JSON.parse(ev.data) as Snapshot);
                                                } catch {
                                                        return;
                                                }
                                        };
                                        source.onerror = () => {
                                                if (source?.readyState === EventSource.CLOSED) {
                                                        source.close();
                                                        fallbackPoll();
                                                }
                                        };
                                } catch {
                                        fallbackPoll();
                                }
                        };

                        open();
                        return () => {
                                stopped = true;
                                window.clearTimeout(timer);
                                source?.close();
                        };
                },

                getSession(): Promise<SessionInfo> {
                        return Promise.resolve(readSession());
                },

                async login(username: string, password: string): Promise<SessionInfo> {
                        const trimmed = username.trim();
                        const now = Date.now();
                        const fails = readFails();
                        const blocked = fails[trimmed];
                        if (blocked) {
                                if (blocked.until > now) {
                                        throw new Error(
                                                `cuenta bloqueada tras ${MAX_LOGIN_FAILURES} intentos fallidos: reintenta en ${Math.ceil((blocked.until - now) / 1000)} s`,
                                        );
                                }
                                if (blocked.until > 0) {
                                        delete fails[trimmed];
                                        writeFails(fails);
                                }
                        }

                        const file = await loadUsers();
                        const fail = (message: string): never => {
                                const f = fails[trimmed] ?? { count: 0, until: 0 };
                                f.count += 1;
                                if (f.count >= MAX_LOGIN_FAILURES) {
                                        fails[trimmed] = { count: 0, until: now + LOCKOUT_MS };
                                        writeFails(fails);
                                        throw new Error(
                                                `cuenta bloqueada tras ${MAX_LOGIN_FAILURES} intentos fallidos: reintenta en ${LOCKOUT_MS / 1000} s`,
                                        );
                                }
                                fails[trimmed] = f;
                                writeFails(fails);
                                throw new Error(message);
                        };

                        const user = file.users?.find((u) => u.username === trimmed);
                        if (!user) fail("usuario o contraseña incorrectos");
                        const hash = await pbkdf2(password, user!.salt, file.iterations ?? 100000);
                        if (hash !== user!.hash) fail("usuario o contraseña incorrectos");

                        delete fails[trimmed];
                        writeFails(fails);
                        const next: SessionInfo = { authenticated: true, username: user!.username, level: user!.level, since: Date.now() };
                        writeSession(next);
                        return next;
                },

                async logout(): Promise<void> {
                        writeSession(ANON);
                },

                async getAudit(): Promise<AuditEntry[]> {
                        const list = readJSON<AuditEntry[]>(AUDIT_KEY, []);
                        return list.reverse();
                },

                async listUsers(): Promise<UserSummary[]> {
                        await requireLevel(ADMIN_RANK, "admin");
                        const file = await loadUsers();
                        return file.users.map((u) => ({ username: u.username, level: u.level }));
                },

                async setUser(username: string, password: string, level: string): Promise<void> {
                        await requireLevel(ADMIN_RANK, "admin");
                        const trimmed = username.trim();
                        validateUserInput(trimmed, password, level);
                        const file = await loadUsers();
                        const existing = file.users.find((u) => u.username === trimmed);
                        if (existing && !password) {
                                const oldLevel = existing.level;
                                existing.level = level;
                                saveUsers(file);
                                pushAudit({ machine: "usuarios", label: `usuario: ${trimmed}`, address: "", old: oldLevel, new: level });
                                return;
                        }
                        if (!existing && !password) throw new Error("la contraseña no puede estar vacía");
                        const saltBytes = new Uint8Array(16);
                        crypto.getRandomValues(saltBytes);
                        let saltBin = "";
                        for (const b of saltBytes) saltBin += String.fromCharCode(b);
                        const salt = btoa(saltBin);
                        const hash = await pbkdf2(password, salt, file.iterations ?? 100000);
                        const entry: StoredUser = { username: trimmed, level, salt, hash };
                        const oldLevel = existing?.level ?? "";
                        if (existing) Object.assign(existing, entry);
                        else file.users.push(entry);
                        saveUsers(file);
                        pushAudit({ machine: "usuarios", label: `usuario: ${trimmed}`, address: "", old: oldLevel, new: level });
                },

                async deleteUser(username: string): Promise<void> {
                        await requireLevel(ADMIN_RANK, "admin");
                        const file = await loadUsers();
                        const idx = file.users.findIndex((u) => u.username === username);
                        if (idx < 0) throw new Error(`el usuario "${username}" no existe`);
                        if (readSession().username === username) throw new Error("no se puede eliminar el usuario con la sesión activa");
                        const target = file.users[idx];
                        if (target.level === "admin" && !file.users.some((u, i) => i !== idx && u.level === "admin")) {
                                throw new Error("no se puede eliminar el último administrador");
                        }
                        file.users.splice(idx, 1);
                        saveUsers(file);
                        pushAudit({ machine: "usuarios", label: `eliminar usuario: ${username}`, address: "", old: target.level, new: "" });
                },

                async saveMachineConfig(id: string, raw: string): Promise<ValidateResult> {
                        await requireLevel(ADMIN_RANK, "admin");
                        const res = validateMachineRaw(id, raw);
                        if (res.errors.length > 0) {
                                pushAudit({
                                        machine: "configuración",
                                        label: `guardado rechazado: ${id}`,
                                        address: `hmi-config/machines/${id}.json`,
                                        old: "",
                                        new: "",
                                        error: res.errors.join("; "),
                                });
                                return { ...res, saved: false };
                        }
                        writeJSON(machineKey(id), JSON.parse(raw) as Machine);
                        configPromise = null;
                        pushAudit({ machine: "configuración", label: `máquina: ${id}`, address: `hmi-config/machines/${id}.json`, old: "", new: "" });
                        return { ...res, saved: true };
                },

                async getRecipes(machineId: string): Promise<Recipe[]> {
                        return loadRecipes(machineId);
                },

                async saveRecipe(machineId: string, recipe: Recipe): Promise<Recipe[]> {
                        await requireLevel(OPERATOR_RANK, "operator");
                        const cfg = await loadConfig();
                        const machine = (cfg.machines ?? []).find((m) => m.id === machineId);
                        if (!machine) throw new Error(`la máquina "${machineId}" no existe`);
                        const name = (recipe.name ?? "").trim();
                        if (!name) throw new Error("la receta necesita un nombre");
                        if (name.length > 40) throw new Error("el nombre de la receta no puede superar 40 caracteres");
                        const values = recipe.values ?? {};
                        if (Object.keys(values).length === 0) throw new Error("la receta no tiene valores");
                        for (const [addr, v] of Object.entries(values)) {
                                const tag = machine.tags.find((t) => t.address === addr || t.name === addr);
                                if (!tag) throw new Error(`la tag "${addr}" no existe en ${machineId}`);
                                if (tag.access !== "rw") throw new Error(`la tag "${tag.label}" (${addr}) es de solo lectura`);
                                if (typeof v === "boolean" && tag.dataType !== "bool") throw new Error(`valor no válido para ${tag.label}`);
                                if (typeof v === "number" && tag.dataType === "bool") throw new Error(`valor no válido para ${tag.label}`);
                        }

                        const list = await loadRecipes(machineId);
                        const normalized: Recipe = { name, values, updated: Date.now() };
                        const idx = list.findIndex((r) => (r.name ?? "").toLowerCase() === name.toLowerCase());
                        if (idx >= 0) list[idx] = normalized;
                        else {
                                if (list.length >= 50) throw new Error("máximo de 50 recetas por máquina");
                                list.push(normalized);
                        }
                        writeJSON(recipesKey(machineId), list);
                        pushAudit({
                                machine: machine.name,
                                label: `receta: ${name}`,
                                address: `hmi-config/recipes/${machineId}.json`,
                                old: "",
                                new: `${Object.keys(values).length} tags`,
                        });
                        return list;
                },

                async deleteRecipe(machineId: string, name: string): Promise<Recipe[]> {
                        await requireLevel(OPERATOR_RANK, "operator");
                        const cfg = await loadConfig();
                        const machine = (cfg.machines ?? []).find((m) => m.id === machineId);
                        if (!machine) throw new Error(`la máquina "${machineId}" no existe`);
                        const list = await loadRecipes(machineId);
                        const out = list.filter((r) => (r.name ?? "").toLowerCase() !== name.trim().toLowerCase());
                        if (out.length === list.length) throw new Error(`la receta "${name}" no existe`);
                        writeJSON(recipesKey(machineId), out);
                        pushAudit({
                                machine: machine.name,
                                label: `borrar receta: ${name}`,
                                address: `hmi-config/recipes/${machineId}.json`,
                                old: name,
                                new: "",
                        });
                        return out;
                },

                getRuntimeFlags(): Promise<RuntimeFlags> {
                        const param = new URLSearchParams(location.search).get("onlymouse");
                        const onlyMouse = param !== null && param !== "0" && param !== "false";
                        return Promise.resolve({ onlyMouse });
                },
        };
}
