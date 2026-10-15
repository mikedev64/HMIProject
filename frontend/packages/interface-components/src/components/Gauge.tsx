import "./Gauge.css";

export interface GaugeProps {
        /** Valor actual; null (o NaN) muestra «—» y el arco a cero. */
        value: number | null;
        min: number;
        max: number;
        label?: string;
        unit?: string;
        size?: "sm" | "md";
        /** A partir de este valor (unidades de la tag) el arco pasa a ámbar. */
        warnAt?: number;
        /** A partir de este valor el arco pasa a rojo. */
        dangerAt?: number;
        /** Decimales del valor central (por defecto: 0 si todo es entero, si no 1). */
        decimals?: number;
}

/** Arco de 240° abierto hacia abajo (estilo PanelView): de 150° a 30°. */
const ARC = "M 15.36 70 A 40 40 0 1 1 84.64 70";

function clamp01(x: number): number {
        return Math.min(1, Math.max(0, x));
}

function format(n: number, digits: number): string {
        return n.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Indicador circular (gauge) para variables de proceso: arco de fondo + arco
 * de valor con transición suave, colores por umbral (warn/danger) y valor en
 * el centro. Pensado para la pestaña «Proceso» del panel de máquina.
 */
export function Gauge({ value, min, max, label, unit, size = "md", warnAt, dangerAt, decimals }: GaugeProps) {
        const span = max - min || 1;
        const n = value !== null && Number.isFinite(value) ? value : null;
        const fraction = n === null ? 0 : clamp01((n - min) / span);
        const tone = n === null ? "idle" : dangerAt !== undefined && n >= dangerAt ? "danger" : warnAt !== undefined && n >= warnAt ? "warn" : "ok";
        const digits = decimals ?? (n !== null && Number.isInteger(n) && Number.isInteger(min) && Number.isInteger(max) ? 0 : 1);
        const text = n === null ? "—" : format(n, digits);

        return (
                <figure class={`hmi-gauge hmi-gauge--${size} hmi-gauge--${tone}`}>
                        <svg viewBox="0 0 100 76" role="img" aria-label={`${label ?? "Indicador"}: ${text} ${unit ?? ""}`}>
                                <path class="hmi-gauge__track" d={ARC} />
                                <path class="hmi-gauge__fill" d={ARC} pathLength={100} strokeDasharray={`${(fraction * 100).toFixed(2)} 100`} />
                                <text class="hmi-gauge__value" x="50" y="50" textAnchor="middle">
                                        {text}
                                </text>
                                {unit && (
                                        <text class="hmi-gauge__unit" x="50" y="63" textAnchor="middle">
                                                {unit}
                                        </text>
                                )}
                        </svg>
                        {label && <figcaption class="hmi-gauge__label">{label}</figcaption>}
                </figure>
        );
}
