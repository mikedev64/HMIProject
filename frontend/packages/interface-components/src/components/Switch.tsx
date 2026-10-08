import "./Switch.css";

export interface SwitchProps {
        checked: boolean;
        disabled?: boolean;
        label?: string;
        oncommit: (checked: boolean) => void;
}

/** Interruptor binario para tags bool (p.ej. "Motor en marcha"). */
export function Switch({ checked, disabled = false, label, oncommit }: SwitchProps) {
        return (
                <button
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        aria-label={label}
                        title={label}
                        class={`hmi-switch${checked ? " is-on" : ""}`}
                        disabled={disabled}
                        onClick={() => !disabled && oncommit(!checked)}
                >
                        <span class="hmi-switch__track">
                                <span class="hmi-switch__thumb" />
                        </span>
                        {label && <span class="hmi-switch__label">{label}</span>}
                </button>
        );
}
