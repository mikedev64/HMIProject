import type { HMIConfig, Machine, TagDef } from "../api/backend";

export interface ValidateResult {
        errors: string[];
        warnings: string[];
        saved?: boolean;
}

export interface ConfigIssue {
        severity: "error" | "warn";
        machine: string;
        context: string;
        message: string;
}

export const KNOWN_BLOCK_TYPES = ["groups", "sections", "process", "trend", "alarms", "recipes"];
export const KNOWN_CONTROL_KINDS = ["switch", "number", "display", "button", "pad", "lamp"];
export const KNOWN_DATA_TYPES = ["bool", "int16", "int32", "float32", "string"];
export const KNOWN_LEVELS = ["viewer", "operator", "admin"];

export function findTagInMachine(machine: Machine, key?: string): TagDef | undefined {
        if (!key) return undefined;
        return machine.tags.find((t) => t.name === key || t.address === key);
}

export function validateMachine(machine: Machine, expectedId?: string): ValidateResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (expectedId !== undefined) {
                if (!machine.id) warnings.push(`falta "id": se usará ${expectedId}`);
                else if (machine.id !== expectedId) errors.push(`el id "${machine.id}" no coincide con el fichero (${expectedId}.json)`);
        }
        if (!machine.name?.trim()) errors.push('falta "name" (nombre visible de la máquina)');
        if (!(machine.size?.width > 0) || !(machine.size?.height > 0))
                errors.push("size.width/height deben ser mayores que 0 (si no, la máquina no se dibuja)");
        if (!machine.image) warnings.push('sin "image": se dibujará sin sprite');

        if (!machine.tags?.length) {
                errors.push("la máquina no define tags");
        } else {
                const seen = new Map<string, string>();
                machine.tags.forEach((t, i) => {
                        const where = `tags[${i}]`;
                        if (!t.address?.trim()) {
                                errors.push(`${where}: sin "address"`);
                                return;
                        }
                        const prev = seen.get(t.address);
                        if (prev !== undefined) errors.push(`dirección ${t.address} duplicada (${prev} y ${t.name})`);
                        seen.set(t.address, t.name);
                        if (!t.label?.trim()) warnings.push(`${where} (${t.address}): sin "label"`);
                        if (!KNOWN_DATA_TYPES.includes(t.dataType)) errors.push(`${where} (${t.address}): dataType "${t.dataType}" desconocido`);
                        if (t.access !== "ro" && t.access !== "rw") errors.push(`${where} (${t.address}): access "${t.access}" debe ser ro|rw`);
                        if (t.dataType !== "bool" && (t.min === undefined || t.max === undefined)) {
                                warnings.push(`${where} (${t.address}): sin min/max (gauge y pad no tendrán rango)`);
                        }
                });

                const status = (machine.statusTags ?? {}) as { run?: string; alarm?: string; ack?: string };
                const checkStatus = (role: string, addr: string | undefined, required: boolean) => {
                        if (!addr) {
                                if (required) warnings.push(`statusTags.${role}: sin definir`);
                                return;
                        }
                        if (!seen.has(addr)) errors.push(`statusTags.${role} apunta a ${addr} que no existe en tags`);
                };
                checkStatus("run", status.run, false);
                checkStatus("alarm", status.alarm, true);
                checkStatus("ack", status.ack, false);
                if (!status.ack) warnings.push("sin statusTags.ack: «Reconocer» del banner solo actuará en el HMI");
        }

        if (!machine.hmi?.tabs?.length) {
                warnings.push('sin bloque "hmi": se usarán las pestañas por defecto');
                return { errors, warnings };
        }

        machine.hmi.tabs.forEach((tab, ti) => {
                const tabWhere = `hmi.tabs[${ti}]`;
                if (!tab.id?.trim()) errors.push(`${tabWhere}: sin "id"`);
                if (!tab.title?.trim()) errors.push(`${tabWhere}: sin "title"`);
                if (!tab.blocks?.length) warnings.push(`${tabWhere}: sin bloques (pestaña vacía)`);
                (tab.blocks ?? []).forEach((block, bi) => {
                        const bWhere = `${tabWhere}.blocks[${bi}]`;
                        if (!KNOWN_BLOCK_TYPES.includes(block.type)) {
                                errors.push(`${bWhere}: tipo de bloque "${block.type}" desconocido`);
                                return;
                        }
                        if (block.type === "sections" && !block.sections?.length) warnings.push(`${bWhere}: bloque sections sin secciones`);
                        (block.sections ?? []).forEach((section, si) => {
                                const sWhere = `${bWhere}.sections[${si}]`;
                                if (!section.items?.length) warnings.push(`${sWhere}: sin items`);
                                (section.items ?? []).forEach((ctrl, ii) =>
                                        validateControl(errors, warnings, machine, ctrl, `${sWhere}.items[${ii}]`),
                                );
                        });
                });
        });

        return { errors, warnings };
}

function validateControl(
        errors: string[],
        warnings: string[],
        machine: Machine,
        ctrl: { kind: string; tag?: string; write?: { tag: string }; minLevel?: string },
        where: string,
) {
        if (!KNOWN_CONTROL_KINDS.includes(ctrl.kind)) {
                errors.push(`${where}: control "${ctrl.kind}" desconocido (switch|number|display|button|pad|lamp)`);
                return;
        }
        if (ctrl.minLevel && !KNOWN_LEVELS.includes(ctrl.minLevel))
                errors.push(`${where}: minLevel "${ctrl.minLevel}" desconocido (viewer|operator|admin)`);
        if (ctrl.minLevel === "viewer") {
                const writes =
                        ctrl.kind === "button" ||
                        ((ctrl.kind === "switch" || ctrl.kind === "number" || ctrl.kind === "pad") &&
                                findTagInMachine(machine, ctrl.tag)?.access === "rw");
                if (writes) errors.push(`${where}: minLevel "viewer" no admite controles de escritura (mínimo operator)`);
        }

        const needsTag = ctrl.kind !== "button";
        if (needsTag) {
                if (!ctrl.tag) errors.push(`${where}: sin "tag"`);
                else if (!findTagInMachine(machine, ctrl.tag)) errors.push(`${where}: la tag "${ctrl.tag}" no existe en esta máquina`);
        }
        if (ctrl.kind === "button") {
                if (!ctrl.write) {
                        errors.push(`${where}: botón sin "write"`);
                        return;
                }
                if (!findTagInMachine(machine, ctrl.write.tag)) errors.push(`${where}: write.tag "${ctrl.write.tag}" no existe en esta máquina`);
        }
}

export function validateMachineRaw(id: string, raw: string): ValidateResult {
        let parsed: Machine;
        try {
                parsed = JSON.parse(raw) as Machine;
        } catch (e) {
                return { errors: [`JSON inválido: ${e instanceof Error ? e.message : String(e)}`], warnings: [] };
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return { errors: ["el contenido debe ser un objeto JSON de máquina"], warnings: [] };
        }
        return validateMachine(parsed, id);
}

export function validateConfig(cfg: HMIConfig): ConfigIssue[] {
        const issues: ConfigIssue[] = [];
        for (const m of cfg.machines ?? []) {
                const res = validateMachine(m, m.id);
                for (const message of res.errors) issues.push({ severity: "error", machine: m.name || m.id, context: "estructura", message });
                for (const message of res.warnings) issues.push({ severity: "warn", machine: m.name || m.id, context: "estructura", message });
        }
        if (!cfg.security)
                issues.push({ severity: "warn", machine: "", context: "app.json", message: 'sin bloque "security": se asume requireLogin=false' });
        return issues;
}
