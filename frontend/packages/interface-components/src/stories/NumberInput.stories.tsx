import type { Meta, StoryObj } from "@storybook/preact-vite";
import { useState } from "preact/hooks";
import { NumberInput } from "../components/NumberInput";

const meta: Meta<typeof NumberInput> = {
        title: "HMI/NumberInput",
        component: NumberInput,
        tags: ["autodocs"],
        argTypes: {
                disabled: { control: "boolean" },
        },
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Default: Story = {
        render: () => {
                const [v, setV] = useState(120);
                return (
                        <div style={{ width: 220, background: "var(--hmi-surface)", padding: 16, borderRadius: 8 }}>
                                <NumberInput value={v} min={0} max={250} oncommit={setV} />
                                <p style={{ color: "var(--hmi-text-faint)", fontSize: 12, marginTop: 8 }}>Valor: {v}</p>
                        </div>
                );
        },
};

export const WithStep: Story = {
        render: () => {
                const [v, setV] = useState(1500);
                return (
                        <div style={{ width: 220, background: "var(--hmi-surface)", padding: 16, borderRadius: 8 }}>
                                <NumberInput value={v} min={0} max={3000} step={100} oncommit={setV} />
                                <p style={{ color: "var(--hmi-text-faint)", fontSize: 12, marginTop: 8 }}>Valor: {v} rpm</p>
                        </div>
                );
        },
};

export const Disabled: Story = {
        render: () => (
                <div style={{ width: 220, background: "var(--hmi-surface)", padding: 16, borderRadius: 8 }}>
                        <NumberInput value={42} disabled oncommit={() => {}} />
                </div>
        ),
};
