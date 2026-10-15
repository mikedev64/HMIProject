import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import "./Button.css";

export interface ButtonProps {
        variant?: "primary" | "secondary" | "ghost" | "danger";
        size?: "sm" | "md";
        type?: "button" | "submit";
        disabled?: boolean;
        title?: string;
        onClick?: (e: MouseEvent) => void;
        /** Se dispara al PULSAR (pointerdown): pushbuttons momentáneos estilo PanelView. */
        onpress?: (e: PointerEvent) => void;
        /** Se dispara al SOLTAR (pointerup/leave/cancel) si antes hubo press. */
        onrelease?: (e: PointerEvent) => void;
        children?: ComponentChildren;
}

export function Button({
        variant = "secondary",
        size = "md",
        type = "button",
        disabled = false,
        title,
        onClick,
        onpress,
        onrelease,
        children,
}: ButtonProps) {
        // tracked (ref: sobrevive a los re-renders que dispara la escritura)
        // distingue un press propio de un pointerup ajeno. Funciona igual con
        // ratón y con touch: usamos pointer events, no mouse events.
        const tracked = useRef(false);
        return (
                <button
                        type={type}
                        class={`hmi-btn hmi-btn--${variant} hmi-btn--${size}`}
                        disabled={disabled}
                        title={title}
                        onClick={onClick}
                        onPointerDown={(e) => {
                                if (disabled || !onpress) return;
                                tracked.current = true;
                                onpress(e);
                        }}
                        onPointerUp={(e) => {
                                if (!tracked.current || !onrelease) return;
                                tracked.current = false;
                                onrelease(e);
                        }}
                        onPointerLeave={(e) => {
                                if (!tracked.current || !onrelease) return;
                                tracked.current = false;
                                onrelease(e);
                        }}
                        onPointerCancel={(e) => {
                                if (!tracked.current || !onrelease) return;
                                tracked.current = false;
                                onrelease(e);
                        }}
                >
                        {children}
                </button>
        );
}
