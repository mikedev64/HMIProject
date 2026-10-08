import { createContext } from "preact";
import { useContext, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import "./List.css";

/**
 * Patrón contenedor/hijo:
 *  - <List> es el contenedor: gestiona el estado de selección.
 *  - <ListItem> es el elemento: consume el contexto del contenedor más
 *    cercano. Cada List mantiene su propia selección de forma aislada,
 *    por lo que varios selectores en la misma pantalla no se pisan.
 *
 * Soporta modo controlado (value + onselect) y no controlado (defaultvalue).
 */

interface ListContextValue {
        selected: string | null;
        select: (value: string) => void;
}

const ListContext = createContext<ListContextValue | null>(null);

export interface ListProps {
        value?: string | null;
        defaultvalue?: string | null;
        orientation?: "vertical" | "horizontal";
        onselect?: (value: string) => void;
        ariaLabel?: string;
        children?: ComponentChildren;
}

export function List({
        value,
        defaultvalue = null,
        orientation = "vertical",
        onselect,
        ariaLabel,
        children,
}: ListProps) {
        const [internal, setInternal] = useState<string | null>(defaultvalue);
        const controlled = value !== undefined;
        const selected = controlled ? value : internal;

        const select = (v: string) => {
                if (!controlled) setInternal(v);
                onselect?.(v);
        };

        return (
                <ListContext.Provider value={{ selected, select }}>
                        <ul
                                class={`hmi-list hmi-list--${orientation}`}
                                role="listbox"
                                aria-label={ariaLabel}
                        >
                                {children}
                        </ul>
                </ListContext.Provider>
        );
}

export interface ListItemProps {
        value: string;
        disabled?: boolean;
        selected?: boolean;
        title?: string;
        onClick?: (e: MouseEvent) => void;
        children?: ComponentChildren;
}

export function ListItem({ value, disabled = false, selected, title, onClick, children }: ListItemProps) {
        const ctx = useContext(ListContext);
        const isSelected = selected ?? ctx?.selected === value;

        const handleClick = (e: MouseEvent) => {
                if (disabled) return;
                ctx?.select(value);
                onClick?.(e);
        };

        return (
                <li
                        class={`hmi-list-item${isSelected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={disabled}
                        title={title}
                        onClick={handleClick}
                >
                        {children}
                </li>
        );
}
