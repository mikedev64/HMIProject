import type { ComponentChildren } from "preact";
import { Badge } from "./Badge";
import "./Field.css";

export interface FieldProps {
        label: string;
        /** Dirección de memoria PLC (ej. N7:0) — se muestra como ayuda. */
        address?: string;
        unit?: string;
        /** Indica si el tag es editable (rw) o solo lectura (ro). */
        access?: "rw" | "ro";
        hint?: string;
        disabled?: boolean;
        children?: ComponentChildren;
}

/**
 * Fila de edición de un tag: etiqueta + control + metadatos PLC
 * (dirección, unidad, acceso). Es el bloque que se repite en el panel
 * lateral por cada dato de la máquina.
 */
export function Field({ label, address, unit, access, hint, disabled = false, children }: FieldProps) {
        return (
                <div class={`hmi-field${disabled ? " is-disabled" : ""}`}>
                        <div class="hmi-field__head">
                                <label class="hmi-field__label">{label}</label>
                                <span class="hmi-field__meta">
                                        {unit && <span class="hmi-field__unit">{unit}</span>}
                                        {access && (
                                                <Badge tone={access === "rw" ? "info" : "neutral"} title="Acceso del tag">
                                                        {access === "rw" ? "RW" : "RO"}
                                                </Badge>
                                        )}
                                </span>
                        </div>
                        <div class="hmi-field__control">{children}</div>
                        <div class="hmi-field__foot">
                                {address && <code class="hmi-field__address">{address}</code>}
                                {hint && <span class="hmi-field__hint">{hint}</span>}
                        </div>
                </div>
        );
}
