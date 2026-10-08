import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { NumberInput } from "../components/NumberInput";
import { Switch } from "../components/Switch";
import { useState } from "preact/hooks";

const meta: Meta<typeof Panel> = {
        title: "HMI/Panel",
        component: Panel,
        tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Panel>;

export const MachineEditor: Story = {
        render: () => {
                const [temp, setTemp] = useState(120);
                const [running, setRunning] = useState(true);
                return (
                        <div style={{ height: 420, display: "flex" }}>
                                <div style={{ flex: 1, background: "var(--hmi-bg)" }} />
                                <Panel
                                        title="Mezcladora 01"
                                        subtitle="mezcladora-01 · PLC-LINEA-01"
                                        onClose={() => {}}
                                        closeLabel="Dejar máquina"
                                        footer={<span>Última lectura: hace 0.2 s</span>}
                                >
                                        <Field label="Setpoint temperatura" address="N7:0" unit="°C" access="rw">
                                                <NumberInput value={temp} min={0} max={250} oncommit={setTemp} />
                                        </Field>
                                        <Field label="Motor en marcha" address="B3/1" access="rw">
                                                <Switch checked={running} label={running ? "Marcha" : "Paro"} oncommit={setRunning} />
                                        </Field>
                                        <Field label="Temperatura actual" address="F8:0" unit="°C" access="ro" disabled>
                                                <input class="hmi-number__input" value="118.4" disabled readOnly />
                                        </Field>
                                </Panel>
                        </div>
                );
        },
};
