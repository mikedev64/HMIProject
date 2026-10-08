import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Popover } from "../components/Popover";
import { Badge } from "../components/Badge";

const meta: Meta<typeof Popover> = {
        title: "HMI/Popover",
        component: Popover,
        tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const HoverCard: Story = {
        render: () => (
                <div style={{ position: "relative", width: 340, height: 200, background: "var(--hmi-bg)", borderRadius: 8 }}>
                        <Popover open x={40} y={30}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                        <strong>Mezcladora 01</strong>
                                        <Badge tone="ok" dot>
                                                Marcha
                                        </Badge>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "3px 12px" }}>
                                        <span style={{ color: "var(--hmi-text-faint)" }}>Temp. actual</span>
                                        <span style={{ fontFamily: "var(--hmi-mono)" }}>118.4 °C</span>
                                        <span style={{ color: "var(--hmi-text-faint)" }}>Velocidad</span>
                                        <span style={{ fontFamily: "var(--hmi-mono)" }}>1492 rpm</span>
                                </div>
                        </Popover>
                </div>
        ),
};

export const Closed: Story = {
        args: { open: false, x: 0, y: 0 },
};
