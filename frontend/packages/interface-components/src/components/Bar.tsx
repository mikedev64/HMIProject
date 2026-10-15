import "./Bar.css";

export interface BarProps {
        /** Valor actual; null muestra «—» y la barra vacía. */
        value: number | null;
        min: number;
        max: number;
        label?: string;
        unit?: string;
        /** Muestra el valor numérico a la derecha (por defecto sí). */
        showValue?: boolean;
        /** Muestra la escala min/max bajo la barra (por defecto sí). */
        showScale?: boolean;
        /** Consigna/setpoint dibujado como marca vertical. */
        mark?: number;
        /** A partir de este valor la barra pasa a ámbar. */
        warnAt?: number;
        /** A partir de este valor la barra pasa a rojo. */
        dangerAt?: number;
        /** Versión compacta (sin cabecera ni escala por defecto). */
        compact?: boolean;
}

function clamp01(x: number): number {
        return Math.min(1, Math.max(0, x));
}

function format(n: number, digits: number): string {
        return n.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Barra de nivel horizontal para rangos (nivel, velocidad, presión…):
 * relleno proporcional, colores por umbral, marca opcional de setpoint y
 * escala min/max. Útil bajo cada campo numérico del panel de control.
 */
export function Bar({ value, min, max, label, unit, showValue = true, showScale = true, mark, warnAt, dangerAt, compact = false }: BarProps) {
        const span = max - min || 1;
        const n = value !== null && Number.isFinite(value) ? value : null;
        const pct = n === null ? 0 : clamp01((n - min) / span) * 100;
        const tone = n === null ? "idle" : dangerAt !== undefined && n >= dangerAt ? "danger" : warnAt !== undefined && n >= warnAt ? "warn" : "ok";
        const digits = n !== null && Number.isInteger(n) && Number.isInteger(min) && Number.isInteger(max) ? 0 : 1;
        const markPct = mark !== undefined ? clamp01((mark - min) / span) * 100 : null;
        const showHead = !compact && (Boolean(label) || showValue);
        const showFoot = !compact && showScale;

        return (
                <div class={`hmi-bar${compact ? " hmi-bar--compact" : ""}`}>
                        {showHead && (
                                <div class="hmi-bar__head">
                                        <span class="hmi-bar__label">{label}</span>
                                        <strong class="hmi-bar__value">
                                                {n === null ? "—" : format(n, digits)}
                                                {unit ? ` ${unit}` : ""}
                                        </strong>
                                </div>
                        )}
                        <div
                                class="hmi-bar__track"
                                role="meter"
                                aria-valuemin={min}
                                aria-valuemax={max}
                                aria-valuenow={n ?? undefined}
                                aria-label={label}
                        >
                                <div class={`hmi-bar__fill hmi-bar__fill--${tone}`} style={{ width: `${pct.toFixed(2)}%` }} />
                                {markPct !== null && <span class="hmi-bar__mark" style={{ left: `${markPct.toFixed(2)}%` }} />}
                        </div>
                        {showFoot && (
                                <div class="hmi-bar__scale">
                                        <span>{format(min, 0)}</span>
                                        <span>
                                                {format(max, 0)}
                                                {unit ? ` ${unit}` : ""}
                                        </span>
                                </div>
                        )}
                </div>
        );
}
