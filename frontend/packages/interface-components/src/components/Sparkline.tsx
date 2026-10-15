import { useState } from "preact/hooks";
import "./Sparkline.css";

export interface SparklineProps {
        /** Serie histórica de valores (se dibujan los últimos `points`). */
        data: readonly number[];
        /** Timestamps (ms) paralelos a `data`, para el cursor. */
        times?: readonly number[];
        /** Número visible de puntos (por defecto, todos los que haya). */
        points?: number;
        width?: number;
        height?: number;
        label?: string;
        unit?: string;
        /** Límites del eje (por defecto, min/max de la serie visible). */
        min?: number;
        max?: number;
}

/**
 * Mini-gráfico de tendencia (sparkline) para la pestaña «Tendencia»: polyline
 * + área bajo la curva + punto final resaltado. Al pasar el ratón (o el dedo)
 * muestra un CURSOR con el valor y la hora de esa muestra. Si hay menos de
 * dos puntos válidos muestra un estado vacío en lugar de un gráfico engañoso.
 */
export function Sparkline({ data, times, points, width = 240, height = 48, label, unit, min, max }: SparklineProps) {
        const [hover, setHover] = useState<number | null>(null);

        const visible = points !== undefined && points > 0 && data.length > points ? data.slice(-points) : data;
        const visibleTimes =
                times && times.length === data.length ? (visible.length === data.length ? times : times.slice(-visible.length)) : undefined;
        const series = visible;
        const last = series.length > 0 ? series[series.length - 1] : null;
        const hasData = series.length >= 2 && last !== null && Number.isFinite(last);

        let lo = min ?? (hasData ? Math.min(...series) : 0);
        let hi = max ?? (hasData ? Math.max(...series) : 1);
        if (hi - lo < 1e-9) {
                lo -= 1;
                hi += 1;
        }
        const pad = (hi - lo) * 0.08;
        lo -= pad;
        hi += pad;

        const n = series.length;
        const coords = series.map((v, i) => {
                const x = n === 1 ? width / 2 : 1 + (i / (n - 1)) * (width - 2);
                const y = height - 1 - ((v - lo) / (hi - lo)) * (height - 2);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const line = coords.length > 0 ? `M ${coords.join(" L ")}` : "";
        const area = coords.length > 0 ? `${line} L ${width - 1},${height} L 1,${height} Z` : "";
        const lastXY = coords.length > 0 ? coords[coords.length - 1].split(",") : ["0", "0"];
        const digits = last !== null && Number.isInteger(last) ? 0 : 1;

        // Cursor: índice bajo el puntero → posición + valor + hora.
        const hoverIdx = hover !== null && hasData && hover >= 0 && hover < n ? hover : null;
        const hoverXY = hoverIdx !== null ? coords[hoverIdx].split(",") : null;
        const hoverValue = hoverIdx !== null ? series[hoverIdx] : null;
        const hoverTime = hoverIdx !== null && visibleTimes ? visibleTimes[hoverIdx] : null;

        /** Hora local HH:MM:SS con dos dígitos (padding manual, sin ICU). */
        const padTime = (ts: number) => {
                const d = new Date(ts);
                const p = (n: number) => String(n).padStart(2, "0");
                return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        };

        const trackPointer = (clientX: number, el: SVGSVGElement) => {
                if (!hasData || n < 2) return;
                const rect = el.getBoundingClientRect();
                const rel = (clientX - rect.left) / Math.max(1, rect.width);
                setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
        };

        return (
                <div class="hmi-sparkline">
                        {(label || hasData) && (
                                <div class="hmi-sparkline__head">
                                        <span class="hmi-sparkline__label">{label}</span>
                                        <strong class="hmi-sparkline__value">
                                                {hoverValue !== null
                                                        ? hoverValue.toLocaleString("es-ES", {
                                                                  minimumFractionDigits: digits,
                                                                  maximumFractionDigits: digits,
                                                          })
                                                        : hasData && last !== null
                                                          ? last.toLocaleString("es-ES", {
                                                                    minimumFractionDigits: digits,
                                                                    maximumFractionDigits: digits,
                                                            })
                                                          : "—"}
                                                {unit ? ` ${unit}` : ""}
                                        </strong>
                                </div>
                        )}
                        {hasData ? (
                                <>
                                        <svg
                                                width={width}
                                                height={height}
                                                viewBox={`0 0 ${width} ${height}`}
                                                role="img"
                                                aria-label={`Tendencia de ${label ?? "variable"}`}
                                                onPointerMove={(e) => trackPointer(e.clientX, e.currentTarget)}
                                                onPointerLeave={() => setHover(null)}
                                        >
                                                <path class="hmi-sparkline__area" d={area} />
                                                <path class="hmi-sparkline__line" d={line} />
                                                {hoverIdx !== null && hoverXY && (
                                                        <>
                                                                <line
                                                                        class="hmi-sparkline__cursor"
                                                                        x1={hoverXY[0]}
                                                                        y1={0}
                                                                        x2={hoverXY[0]}
                                                                        y2={height}
                                                                />
                                                                <circle
                                                                        class="hmi-sparkline__dot hmi-sparkline__dot--hover"
                                                                        cx={hoverXY[0]}
                                                                        cy={hoverXY[1]}
                                                                        r={3.5}
                                                                />
                                                        </>
                                                )}
                                                <circle class="hmi-sparkline__dot" cx={lastXY[0]} cy={lastXY[1]} r="2.5" />
                                        </svg>
                                        <div class={`hmi-sparkline__tip${hoverTime !== null ? "" : " is-hidden"}`}>
                                                {" "}
                                                {hoverTime !== null ? padTime(hoverTime) : " "}
                                        </div>
                                </>
                        ) : (
                                <div class="hmi-sparkline__empty">Sin datos suficientes</div>
                        )}
                </div>
        );
}
