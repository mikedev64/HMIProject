import { useEffect, useRef, useState } from "preact/hooks";
import "./NumericKeypad.css";

export interface NumericKeypadProps {
        /** Abre/cierra el pad (controlado por el consumidor o por KeypadProvider). */
        open: boolean;
        /** Etiqueta del tag que se edita (cabecera del pad). */
        label?: string;
        /** Unidad de ingeniería (°C, bar, rpm…). */
        unit?: string;
        value: number | null;
        min?: number;
        max?: number;
        /** Si step >= 1 el pad trabaja en enteros (sin punto decimal). */
        step?: number;
        /** Confirma el valor ya validado/clampado y el pad se cierra. */
        oncommit: (value: number) => void;
        onclose: () => void;
}

/**
 * Pad numérico estilo PanelView.
 *
 * En un terminal real no hay teclado físico: tocar un valor numérico abre el
 * keypad en pantalla y el operador teclea dígitos + Enter. Aquí el pad está
 * disponible siempre, pero su apertura automática desde NumberInput solo
 * ocurre cuando KeypadProvider está "enabled" (modo táctil; ver flag
 * --onlymouse en el backend Go).
 *
 * Teclado físico soportado: dígitos, ".", Backspace (borrar), Enter (✓),
 * Escape (✕). Los escuchamos en fase CAPTURE a nivel window, así tenemos
 * prioridad sobre cualquier otro manejador de la app sin importar el orden
 * de registro.
 */
export function NumericKeypad({ open, label, unit, value, min, max, step = 1, oncommit, onclose }: NumericKeypadProps) {
        const [draft, setDraft] = useState("");
        // Espejo SÍNCRONO del borrador: los manejadores de teclado (fase
        // capture a nivel window) pueden llegar antes del re-render, así que
        // commit() debe leer el último valor tecleado, no el del closure.
        const draftRef = useRef("");
        const applyDraft = (next: string | ((d: string) => string)) => {
                const text = typeof next === "function" ? next(draftRef.current) : next;
                draftRef.current = text;
                setDraft(text);
        };
        // true = el siguiente dígito reemplaza el valor actual (estilo HMI).
        const fresh = useRef(true);
        const [invalid, setInvalid] = useState(false);

        // El valor solo se copia al ABRIR: si el PLC actualiza la tag mientras
        // el operador teclea, no le borramos el borrador.
        const valueRef = useRef(value);
        valueRef.current = value;
        const wasOpen = useRef(false);
        useEffect(() => {
                if (open && !wasOpen.current) {
                        const v = valueRef.current;
                        const text = v === null || v === undefined ? "" : String(v);
                        applyDraft(text);
                        setInvalid(false);
                        fresh.current = true;
                }
                wasOpen.current = open;
        }, [open]);

        const integer = step >= 1;

        const press = (key: string) => {
                setInvalid(false);
                if (key === "C") {
                        applyDraft("");
                        fresh.current = false;
                        return;
                }
                if (key === "⌫") {
                        fresh.current = false;
                        applyDraft((d) => d.slice(0, -1));
                        return;
                }
                if (key === "±") {
                        fresh.current = false;
                        applyDraft((d) => (d.startsWith("-") ? d.slice(1) : d.length > 0 ? `-${d}` : "-"));
                        return;
                }
                if (key === ".") {
                        if (integer) return;
                        fresh.current = false;
                        applyDraft((d) => (d.includes(".") ? d : d === "" || d === "-" ? `${d}0.` : `${d}.`));
                        return;
                }
                // Dígitos: el primero reemplaza (como en un PanelView).
                if (fresh.current) {
                        fresh.current = false;
                        applyDraft(key);
                        return;
                }
                applyDraft((d) => (d.length >= 12 ? d : d + key));
        };

        const commit = () => {
                const text = draftRef.current.trim().replace(",", ".");
                if (text === "" || text === "-" || text === "." || text === "-.") {
                        onclose();
                        return;
                }
                let next = Number(text);
                if (Number.isNaN(next)) {
                        setInvalid(true);
                        return;
                }
                if (min !== undefined) next = Math.max(min, next);
                if (max !== undefined) next = Math.min(max, next);
                if (integer) next = Math.round(next);
                oncommit(next);
        };

        // Teclado físico (fase capture: siempre primero).
        useEffect(() => {
                if (!open) return;
                const onKey = (e: KeyboardEvent) => {
                        if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopImmediatePropagation();
                                commit();
                        } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopImmediatePropagation();
                                onclose();
                        } else if (e.key === "Backspace") {
                                e.preventDefault();
                                press("⌫");
                        } else if (/^[0-9]$/.test(e.key)) {
                                e.preventDefault();
                                press(e.key);
                        } else if (e.key === "." || e.key === ",") {
                                e.preventDefault();
                                press(".");
                        }
                };
                window.addEventListener("keydown", onKey, true);
                return () => window.removeEventListener("keydown", onKey, true);
        }, [open, draft, integer, min, max]);

        if (!open) return null;

        const rangeHint =
                min !== undefined || max !== undefined ? `${min ?? "−∞"} … ${max ?? "+∞"}${unit ? ` ${unit}` : ""}` : unit ? unit : undefined;

        const keys: { k: string; cls?: string; disabled?: boolean; aria?: string }[] = [
                { k: "7" },
                { k: "8" },
                { k: "9" },
                { k: "⌫", cls: "is-edit", aria: "Borrar" },
                { k: "4" },
                { k: "5" },
                { k: "6" },
                { k: "C", cls: "is-edit", aria: "Limpiar" },
                { k: "1" },
                { k: "2" },
                { k: "3" },
                { k: "±", cls: "is-edit", disabled: min !== undefined && min >= 0, aria: "Cambiar signo" },
                { k: ".", cls: "is-edit", disabled: integer, aria: "Decimal" },
                { k: "0" },
                { k: "✕", cls: "is-cancel", aria: "Cancelar" },
                { k: "✓", cls: "is-ok", aria: "Aceptar" },
        ];

        return (
                <div class="hmi-keypad__backdrop" onClick={onclose}>
                        <div
                                class={`hmi-keypad${invalid ? " is-invalid" : ""}`}
                                role="dialog"
                                aria-modal="true"
                                aria-label={label ?? "Entrada numérica"}
                                onClick={(e) => e.stopPropagation()} // el clic dentro no cierra
                        >
                                <header class="hmi-keypad__head">
                                        <span class="hmi-keypad__label">{label ?? "Valor"}</span>
                                        {rangeHint && <span class="hmi-keypad__range">{rangeHint}</span>}
                                </header>
                                <div class="hmi-keypad__display" aria-live="polite">
                                        {draft !== "" ? draft : <span class="hmi-keypad__placeholder">—</span>}
                                        {unit && <span class="hmi-keypad__unit">{unit}</span>}
                                </div>
                                {invalid && <div class="hmi-keypad__error">Valor no válido</div>}
                                <div class="hmi-keypad__pad">
                                        {keys.map((key) => (
                                                <button
                                                        key={key.k}
                                                        type="button"
                                                        class={`hmi-keypad__key${key.cls ? ` ${key.cls}` : ""}`}
                                                        disabled={key.disabled}
                                                        aria-label={key.aria}
                                                        onClick={() => (key.k === "✓" ? commit() : key.k === "✕" ? onclose() : press(key.k))}
                                                >
                                                        {key.k}
                                                </button>
                                        ))}
                                </div>
                        </div>
                </div>
        );
}
