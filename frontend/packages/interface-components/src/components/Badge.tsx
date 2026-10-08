import type { ComponentChildren } from "preact";
import "./Badge.css";

export interface BadgeProps {
        tone?: "neutral" | "ok" | "warn" | "danger" | "info";
        dot?: boolean;
        title?: string;
        children?: ComponentChildren;
}

export function Badge({ tone = "neutral", dot = false, title, children }: BadgeProps) {
        return (
                <span class={`hmi-badge hmi-badge--${tone}`} title={title}>
                        {dot && <span class="hmi-badge__dot" />}
                        {children}
                </span>
        );
}
