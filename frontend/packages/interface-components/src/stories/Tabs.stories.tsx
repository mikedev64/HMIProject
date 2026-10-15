import type { Meta, StoryObj } from "@storybook/preact-vite";
import { useState } from "preact/hooks";
import { Tab, Tabs } from "../components/Tabs";

const meta: Meta<typeof Tabs> = {
        title: "HMI/Tabs",
        component: Tabs,
        tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

function Demo({ defaultvalue }: { defaultvalue?: string }) {
        const [tab, setTab] = useState<string | null>(defaultvalue ?? "control");
        return (
                <div style={{ width: 360, background: "var(--hmi-surface)", border: "1px solid var(--hmi-border)" }}>
                        <Tabs value={tab} onselect={setTab} ariaLabel="Vistas del panel">
                                <Tab value="control">Control</Tab>
                                <Tab value="proceso">Proceso</Tab>
                                <Tab value="alarmas" badge="2">
                                        Alarmas
                                </Tab>
                        </Tabs>
                        <div style={{ padding: 12, fontSize: 12, color: "var(--hmi-text-dim)" }}>Pestaña activa: {tab}</div>
                </div>
        );
}

export const Controlado: Story = { render: () => <Demo defaultvalue="control" /> };

export const ConBadge: Story = { render: () => <Demo defaultvalue="alarmas" /> };
