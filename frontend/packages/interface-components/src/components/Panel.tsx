import type { ComponentChildren } from "preact";
import "./Panel.css";

export interface PanelProps {
        title?: string;
        subtitle?: string;
        /** Botón de cierre (p.ej. "Dejar máquina"). Si no se pasa, no se pinta. */
        onClose?: () => void;
        closeLabel?: string;
        children?: ComponentChildren;
        footer?: ComponentChildren;
}

/** Panel lateral derecho: contenedor del editor de datos de una máquina. */
export function Panel({ title, subtitle, onClose, closeLabel = "Cerrar", children, footer }: PanelProps) {
        return (
                <aside class="hmi-panel">
                        <header class="hmi-panel__header">
                                <div class="hmi-panel__titles">
                                        {title && <h2 class="hmi-panel__title">{title}</h2>}
                                        {subtitle && <span class="hmi-panel__subtitle">{subtitle}</span>}
                                </div>
                                {onClose && (
                                        <button type="button" class="hmi-panel__close" onClick={onClose} title={closeLabel} aria-label={closeLabel}>
                                                ✕
                                        </button>
                                )}
                        </header>
                        <div class="hmi-panel__body">{children}</div>
                        {footer && <footer class="hmi-panel__footer">{footer}</footer>}
                </aside>
        );
}
