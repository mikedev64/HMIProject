import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
import { NumericKeypad } from "./NumericKeypad";

/** Datos necesarios para abrir el pad sobre una tag concreta. */
export interface KeypadSpec {
        label?: string;
        unit?: string;
        value: number | null;
        min?: number;
        max?: number;
        step?: number;
        /** Se llama con el valor validado; el provider cierra el pad solo. */
        oncommit?: (value: number) => void;
}

export interface KeypadContextValue {
        /** false (por defecto): el pad no se abre solo (modo --onlymouse). */
        enabled: boolean;
        isOpen: boolean;
        open: (spec: KeypadSpec) => void;
        close: () => void;
}

const KeypadContext = createContext<KeypadContextValue>({
        enabled: false,
        isOpen: false,
        open: () => {},
        close: () => {},
});

export interface KeypadProviderProps {
        /** Activa la apertura automática del pad (modo táctil). */
        enabled?: boolean;
        children?: ComponentChildren;
}

/**
 * Servicio global del pad numérico.
 *
 * Colócalo en la raíz de la app con enabled={!onlyMouse}: los NumberInput del
 * árbol abrirán el keypad al tocarlos y cualquier componente puede llamar a
 * useKeypad().open(...) (p.ej. los botones "pad" de un faceplate).
 *
 * Sin provider el contexto por defecto tiene enabled:false, así que los
 * componentes siguen con el comportamiento de escritorio nativo.
 */
export function KeypadProvider({ enabled = false, children }: KeypadProviderProps) {
        const [spec, setSpec] = useState<KeypadSpec | null>(null);

        const open = useCallback((next: KeypadSpec) => setSpec(next), []);
        const close = useCallback(() => setSpec(null), []);

        const commit = useCallback(
                (v: number) => {
                        spec?.oncommit?.(v);
                        setSpec(null);
                },
                [spec],
        );

        const value = useMemo<KeypadContextValue>(() => ({ enabled, isOpen: spec !== null, open, close }), [enabled, spec, open, close]);

        return (
                <KeypadContext.Provider value={value}>
                        {children}
                        {spec && (
                                <NumericKeypad
                                        open
                                        label={spec.label}
                                        unit={spec.unit}
                                        value={spec.value}
                                        min={spec.min}
                                        max={spec.max}
                                        step={spec.step}
                                        oncommit={commit}
                                        onclose={close}
                                />
                        )}
                </KeypadContext.Provider>
        );
}

/** Acceso al servicio de pad. Seguro sin provider (enabled=false). */
export function useKeypad(): KeypadContextValue {
        return useContext(KeypadContext);
}
