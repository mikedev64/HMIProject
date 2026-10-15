import type { Machine, TagDef } from "../api/backend";
import { levelRank, OPERATOR_RANK } from "./levels";

export type ControlKind = "switch" | "number" | "display" | "button" | "pad" | "lamp";

export interface WriteAction {
        tag: string;
        value: unknown;
        release?: unknown;
}

export interface ControlDef {
        kind: ControlKind | string;
        tag?: string;
        label?: string;
        tone?: string;
        variant?: string;
        momentary?: boolean;
        write?: WriteAction;
        minLevel?: string;
}

export interface SectionDef {
        title?: string;
        columns?: number;
        items?: ControlDef[];
}

export interface BlockDef {
        type: "groups" | "sections" | "process" | "trend" | "alarms" | "recipes" | string;
        sections?: SectionDef[];
        tags?: string[];
        points?: number;
}

export interface TabDef {
        id: string;
        title: string;
        blocks: BlockDef[];
}

export function defaultTabs(): TabDef[] {
        return [
                { id: "control", title: "Control", blocks: [{ type: "groups" }] },
                { id: "proceso", title: "Proceso", blocks: [{ type: "process" }] },
                { id: "tendencia", title: "Tendencia", blocks: [{ type: "trend" }] },
                { id: "alarmas", title: "Alarmas", blocks: [{ type: "alarms" }] },
        ];
}

export function machineTabs(machine: Machine): TabDef[] {
        const raw = (machine as { hmi?: { tabs?: unknown } }).hmi?.tabs;
        if (!Array.isArray(raw) || raw.length === 0) return defaultTabs();

        const tabs: TabDef[] = [];
        for (const [i, t] of raw.entries()) {
                const tab = t as Partial<TabDef> | null;
                if (!tab || typeof tab !== "object") continue;
                const blocks = Array.isArray(tab.blocks) ? tab.blocks.filter((b): b is BlockDef => Boolean(b && typeof b.type === "string")) : [];
                tabs.push({
                        id: typeof tab.id === "string" && tab.id ? tab.id : `tab-${i}`,
                        title: typeof tab.title === "string" && tab.title ? tab.title : `Pestaña ${i + 1}`,
                        blocks,
                });
        }
        return tabs.length > 0 ? tabs : defaultTabs();
}

export function findTag(machine: Machine, key?: string): TagDef | undefined {
        if (!key) return undefined;
        return machine.tags.find((t) => t.name === key || t.address === key);
}

function controlWritesAddress(machine: Machine, ctrl: ControlDef, address: string): boolean {
        if (ctrl.kind === "button") return ctrl.write ? findTag(machine, ctrl.write.tag)?.address === address : false;
        if (ctrl.kind === "switch" || ctrl.kind === "number" || ctrl.kind === "pad") {
                return findTag(machine, ctrl.tag)?.address === address;
        }
        return false;
}

export function requiredRankForAddress(machine: Machine, address: string): number {
        let rank = OPERATOR_RANK;
        for (const tab of machine.hmi?.tabs ?? []) {
                for (const block of tab.blocks ?? []) {
                        for (const section of block.sections ?? []) {
                                for (const ctrl of section.items ?? []) {
                                        if (!controlWritesAddress(machine, ctrl, address)) continue;
                                        rank = Math.max(rank, levelRank(ctrl.minLevel));
                                }
                        }
                }
        }
        return rank;
}

export function paintedAddresses(machine: Machine, tab: TabDef): Set<string> {
        const painted = new Set<string>();
        for (const block of tab.blocks) {
                if (block.type !== "sections") continue;
                for (const section of block.sections ?? []) {
                        for (const item of section.items ?? []) {
                                const tag = findTag(machine, item.tag);
                                if (tag) painted.add(tag.address);
                                else if (item.tag) painted.add(item.tag);
                        }
                }
        }
        return painted;
}
