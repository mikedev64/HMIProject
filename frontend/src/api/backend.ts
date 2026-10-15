import {
        DeleteRecipe,
        DeleteUser,
        GetAudit,
        GetMachines,
        GetRecipes,
        GetRuntimeFlags,
        GetSession,
        GetSnapshot,
        ListUsers,
        Login,
        Logout,
        SaveMachineConfig,
        SaveRecipe,
        SetUser,
        WriteTag,
} from "wailjs-bindings";
import { EventsOn } from "wailjs-bindings/runtime";
import type { main } from "wailjs-bindings";
import { previewBackend } from "./preview";
import { errorMessage } from "../lib/levels";

export type HMIConfig = main.HMIConfig;
export type Machine = main.Machine;
export type TagDef = main.TagDef;
export type Snapshot = main.Snapshot;
export type EIPInfo = {
        connected: boolean;
        session: string;
        o2t: string;
        t2o: string;
        serial: number;
        rpiMs: number;
        seq: number;
        lost: number;
        packetsRx: number;
        packetsTx: number;
        endpoint: string;
};
export type SessionInfo = main.SessionInfo;
export type RuntimeFlags = main.RuntimeFlags;
export type AuditEntry = main.AuditEntry;
export type UserSummary = main.UserSummary;
export type Recipe = main.Recipe;
export type ValidateResult = main.ValidateResult;

export { errorMessage };

export const EMPTY_SNAPSHOT: Snapshot = { connected: false, ts: 0, values: {} };
export const ANON_SESSION: SessionInfo = { authenticated: false };

export interface Backend {
        readonly kind: "wails" | "preview";
        getMachines(): Promise<HMIConfig>;
        getSnapshot(): Promise<Snapshot>;
        writeTag(address: string, value: unknown): Promise<Snapshot>;
        onSnapshot(cb: (s: Snapshot) => void): () => void;
        getSession(): Promise<SessionInfo>;
        login(username: string, password: string): Promise<SessionInfo>;
        logout(): Promise<void>;
        getRuntimeFlags(): Promise<RuntimeFlags>;
        getAudit(): Promise<AuditEntry[]>;
        listUsers(): Promise<UserSummary[]>;
        setUser(username: string, password: string, level: string): Promise<void>;
        deleteUser(username: string): Promise<void>;
        saveMachineConfig(id: string, raw: string): Promise<ValidateResult>;
        getRecipes(machineId: string): Promise<Recipe[]>;
        saveRecipe(machineId: string, recipe: Recipe): Promise<Recipe[]>;
        deleteRecipe(machineId: string, name: string): Promise<Recipe[]>;
}

export type BackendImpl = Omit<Backend, "kind">;

type WailsGlobal = {
        runtime?: { EventsOn?: (name: string, cb: (...data: any) => void) => () => void };
        go?: Record<string, Record<string, Record<string, () => Promise<any>>>>;
};

function hasWailsRuntime(): boolean {
        const w = globalThis as unknown as { window?: WailsGlobal } & WailsGlobal;
        const win = w.window ?? (w as unknown as WailsGlobal);
        return typeof win.runtime?.EventsOn === "function" && typeof win.go?.main?.App?.GetMachines === "function";
}

export const isPreviewMode = !hasWailsRuntime();

function wailsBackend(): BackendImpl {
        return {
                getMachines: () => GetMachines(),
                getSnapshot: () => GetSnapshot(),
                writeTag: (address, value) => WriteTag(address, value),
                onSnapshot(cb) {
                        try {
                                return EventsOn("plc:update", (snap: Snapshot) => cb(snap));
                        } catch {
                                return () => {};
                        }
                },
                getSession: () => GetSession(),
                login: (username, password) => Login(username, password),
                logout: () => Logout(),
                getRuntimeFlags: () => GetRuntimeFlags(),
                getAudit: () => GetAudit(),
                listUsers: () => ListUsers(),
                setUser: (username, password, level) => SetUser(username, password, level),
                deleteUser: (username) => DeleteUser(username),
                saveMachineConfig: (id, raw) => SaveMachineConfig(id, raw),
                getRecipes: (machineId) => GetRecipes(machineId),
                saveRecipe: (machineId, recipe) => SaveRecipe(machineId, recipe),
                deleteRecipe: (machineId, name) => DeleteRecipe(machineId, name),
        };
}

function wrap<P extends unknown[], R>(fn: (...args: P) => Promise<R>): (...args: P) => Promise<R> {
        return (...args: P) => fn(...args).catch((e) => Promise.reject(new Error(errorMessage(e))));
}

function bind(impl: BackendImpl): BackendImpl {
        return {
                getMachines: wrap(impl.getMachines),
                getSnapshot: wrap(impl.getSnapshot),
                writeTag: wrap(impl.writeTag),
                onSnapshot: impl.onSnapshot,
                getSession: wrap(impl.getSession),
                login: wrap(impl.login),
                logout: wrap(impl.logout),
                getRuntimeFlags: wrap(impl.getRuntimeFlags),
                getAudit: wrap(impl.getAudit),
                listUsers: wrap(impl.listUsers),
                setUser: wrap(impl.setUser),
                deleteUser: wrap(impl.deleteUser),
                saveMachineConfig: wrap(impl.saveMachineConfig),
                getRecipes: wrap(impl.getRecipes),
                saveRecipe: wrap(impl.saveRecipe),
                deleteRecipe: wrap(impl.deleteRecipe),
        };
}

const impl = bind(isPreviewMode ? previewBackend() : wailsBackend());

export const backend: Backend = { kind: isPreviewMode ? "preview" : "wails", ...impl };
