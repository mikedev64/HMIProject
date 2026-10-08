import type { ComponentChildren } from "preact";
import "./Button.css";

export interface ButtonProps {
        variant?: "primary" | "secondary" | "ghost" | "danger";
        size?: "sm" | "md";
        type?: "button" | "submit";
        disabled?: boolean;
        title?: string;
        onClick?: (e: MouseEvent) => void;
        children?: ComponentChildren;
}

export function Button({
        variant = "secondary",
        size = "md",
        type = "button",
        disabled = false,
        title,
        onClick,
        children,
}: ButtonProps) {
        return (
                <button
                        type={type}
                        class={`hmi-btn hmi-btn--${variant} hmi-btn--${size}`}
                        disabled={disabled}
                        title={title}
                        onClick={onClick}
                >
                        {children}
                </button>
        );
}
