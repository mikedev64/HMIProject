import { useState } from "preact/hooks";
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
 */
export function NumberInput({ value, min, max, step = 1, disabled = false, oncommit }: NumberInputProps) {
        const [draft, setDraft] = useState<string | null>(null);

        const display = draft ?? (value === null || value === undefined ? "" : String(value));

        const commit = () => {
                if (draft === null) return;
                const parsed = Number(draft.replace(",", "."));
                setDraft(null);
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
                        <button
                                type="button"
                                class="hmi-number__btn"
                                disabled={disabled}
                                onClick={() => nudge(-1)}
                                aria-label="Disminuir"
                        >
                                −
                        </button>
                        <input
                                class="hmi-number__input"
                                type="text"
                                inputMode="decimal"
                                value={display}
                                disabled={disabled}
                                onChange={(e) => setDraft(e.currentTarget.value)}
                                onBlur={commit}
                                onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                                (e.currentTarget as HTMLInputElement).blur();
                                        } else if (e.key === "ArrowUp") {
                                                e.preventDefault();
                                                nudge(1);
                                        } else if (e.key === "ArrowDown") {
                                                e.preventDefault();
                                                nudge(-1);
                                        }
                                }}
                        />
                        <button
                                type="button"
                                class="hmi-number__btn"
                                disabled={disabled}
                                onClick={() => nudge(1)}
                                aria-label="Aumentar"
                        >
                                +
                        </button>
                </div>
        );
}
