import type { Meta, StoryObj } from "@storybook/preact-vite";
import { useState } from "preact/hooks";
import { Switch } from "../components/Switch";

const meta: Meta<typeof Switch> = {
        title: "HMI/Switch",
        component: Switch,
        tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Interactive: Story = {
        render: () => {
                const [on, setOn] = useState(true);
                return (
                        <div style={{ background: "var(--hmi-surface)", padding: 16, borderRadius: 8 }}>
                                <Switch checked={on} label={on ? "Marcha" : "Paro"} oncommit={setOn} />
                        </div>
                );
        },
};

export const Disabled: Story = {
        render: () => (
                <div style={{ background: "var(--hmi-surface)", padding: 16, borderRadius: 8 }}>
                        <Switch checked={false} disabled label="Solo lectura" oncommit={() => {}} />
                </div>
        ),
};
