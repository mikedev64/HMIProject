import { useRef, useState } from "preact/hooks";
import { useKeypad } from "./Keypad";
import "./NumberInput.css";

export interface NumberInputProps {
        value: number | null;
        min?: number;
        max?: number;
        step?: number;
        disabled?: boolean;
        /** Etiqueta/unidad del tag: se muestran en el pad numérico. */
        label?: string;
        unit?: string;
        /** Se dispara al confirmar (blur o Enter), no en cada tecla. */
        oncommit: (value: number) => void;
}

/**
 * Entrada numérica estilo HMI: acepta tecleo libre mientras se edita,
 * confirma con Enter o al perder el foco, y respeta min/max/step.
 *
 * Nota: el borrador se actualiza con `onInput` (evento nativo `input`) y el
 * commit lee el valor del propio input, no del estado. Así el control no
 * depende del render anterior ni del evento `change` (que Preact asocia al
 * nativo `change`, disparado solo al perder el foco).
 */
export function NumberInput({ value, min, max, step = 1, disabled = false, label, unit, oncommit }: NumberInputProps) {
        const [draft, setDraft] = useState<string | null>(null);
        // Evita el doble commit: Enter ya confirma y después hace blur().
        const skipBlur = useRef(false);

        // Modo táctil (KeypadProvider enabled): tocar el campo abre el pad
        // numérico en pantalla, como en un PanelView sin teclado físico.
        // Con --onlymouse el provider está deshabilitado y se usa el teclado
        // nativo de escritorio (inputMode "decimal").
        const keypad = useKeypad();
        const padActive = keypad.enabled && !disabled;

        const display = draft ?? (value === null || value === undefined ? "" : String(value));

        const commitRaw = (raw: string) => {
                setDraft(null);
                const text = raw.trim().replace(",", ".");
                if (text === "") return;
                const parsed = Number(text);
                if (Number.isNaN(parsed)) return;
                let next = parsed;
                if (min !== undefined) next = Math.max(min, next);
                if (max !== undefined) next = Math.min(max, next);
                if (step >= 1) next = Math.round(next);
                if (next !== value) oncommit(next);
        };

        const nudge = (dir: 1 | -1) => {
                if (disabled) return;
                const base = value ?? 0;
                let next = base + dir * step;
                if (min !== undefined) next = Math.max(min, next);
                if (max !== undefined) next = Math.min(max, next);
                if (step >= 1) next = Math.round(next);
                setDraft(null);
                if (next !== value) oncommit(next);
        };

        return (
                <div class={`hmi-number${disabled ? " is-disabled" : ""}`}>
                        <button type="button" class="hmi-number__btn" disabled={disabled} onClick={() => nudge(-1)} aria-label="Disminuir">
                                −
                        </button>
                        <input
                                class="hmi-number__input"
                                type="text"
                                inputMode={padActive ? "none" : "decimal"}
                                readOnly={padActive}
                                value={display}
                                disabled={disabled}
                                onClick={(e) => {
                                        if (!padActive) return;
                                        keypad.open({ label, unit, value, min, max, step, oncommit });
                                        e.currentTarget.blur(); // el edita el pad, no el input
                                }}
                                onInput={(e) => setDraft(e.currentTarget.value)}
                                onBlur={(e) => {
                                        if (skipBlur.current) {
                                                skipBlur.current = false;
                                                return;
                                        }
                                        commitRaw(e.currentTarget.value);
                                }}
                                onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                                skipBlur.current = true;
                                                commitRaw(e.currentTarget.value);
                                                e.currentTarget.blur();
                                        } else if (e.key === "ArrowUp") {
                                                e.preventDefault();
                                                nudge(1);
                                        } else if (e.key === "ArrowDown") {
                                                e.preventDefault();
                                                nudge(-1);
                                        }
                                }}
                        />
                        <button type="button" class="hmi-number__btn" disabled={disabled} onClick={() => nudge(1)} aria-label="Aumentar">
                                +
                        </button>
                </div>
        );
}
