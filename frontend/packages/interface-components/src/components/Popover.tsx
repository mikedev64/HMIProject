import type { ComponentChildren } from "preact";
import "./Popover.css";

export interface PopoverProps {
        open: boolean;
        /** Posición en píxeles relativa al contenedor (position: relative). */
        x: number;
        y: number;
        children?: ComponentChildren;
}

/**
 * Popover flotante anclado a una posición del contenedor (usado por el
 * canvas para mostrar la ficha informativa al pasar el ratón).
 */
export function Popover({ open, x, y, children }: PopoverProps) {
        if (!open) return null;
        return (
                <div class="hmi-popover" style={{ left: `${x}px`, top: `${y}px` }} role="tooltip">
                        {children}
                </div>
        );
}
