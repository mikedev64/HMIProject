import { useRef, useState } from "preact/hooks";
import "./NumberInput.css";

export interface NumberInputProps {
        value: number | null;
        min?: number;
        max?: number;
        step?: number;
        disabled?: boolean;
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
export function NumberInput({ value, min, max, step = 1, disabled = false, oncommit }: NumberInputProps) {
        const [draft, setDraft] = useState<string | null>(null);
        // Evita el doble commit: Enter ya confirma y después hace blur().
        const skipBlur = useRef(false);

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
                                inputMode="decimal"
                                value={display}
                                disabled={disabled}
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
