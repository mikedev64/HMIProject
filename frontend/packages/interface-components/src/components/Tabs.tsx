import { createContext } from "preact";
import { useContext, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import "./Tabs.css";

/**
 * Pestañas (tabs) con el mismo patrón contenedor/hijo que <List>:
 *  - <Tabs> gestiona la pestaña activa (controlado con value+onselect o
 *    no controlado con defaultvalue).
 *  - <Tab> consume el contexto y se auto-selecciona al hacer clic.
 * El contenido de cada pestaña lo decide el consumidor (renderizado
 * condicional), manteniendo el componente libre de dependencias.
 */

interface TabsContextValue {
        selected: string | null;
        select: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
        value?: string | null;
        defaultvalue?: string | null;
        onselect?: (value: string) => void;
        ariaLabel?: string;
        children?: ComponentChildren;
}

export function Tabs({ value, defaultvalue = null, onselect, ariaLabel, children }: TabsProps) {
        const [internal, setInternal] = useState<string | null>(defaultvalue);
        const controlled = value !== undefined;
        const selected = controlled ? value : internal;

        const select = (v: string) => {
                if (!controlled) setInternal(v);
                onselect?.(v);
        };

        return (
                <TabsContext.Provider value={{ selected, select }}>
                        <div class="hmi-tabs" role="tablist" aria-label={ariaLabel}>
                                {children}
                        </div>
                </TabsContext.Provider>
        );
}

export interface TabProps {
        value: string;
        disabled?: boolean;
        title?: string;
        /** Contador/aviso opcional mostrado junto a la etiqueta. */
        badge?: string;
        onClick?: (e: MouseEvent) => void;
        children?: ComponentChildren;
}

export function Tab({ value, disabled = false, title, badge, onClick, children }: TabProps) {
        const ctx = useContext(TabsContext);
        const isSelected = ctx?.selected === value;

        const handleClick = (e: MouseEvent) => {
                if (disabled) return;
                ctx?.select(value);
                onClick?.(e);
        };

        return (
                <button
                        type="button"
                        role="tab"
                        class={`hmi-tab${isSelected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                        aria-selected={isSelected}
                        aria-disabled={disabled}
                        title={title}
                        onClick={handleClick}
                >
                        <span>{children}</span>
                        {badge !== undefined && <span class="hmi-tab__badge">{badge}</span>}
                </button>
        );
}
