import type { Meta, StoryObj } from "@storybook/preact-vite";
import { useState } from "preact/hooks";
import { KeypadProvider } from "../components/Keypad";
import { NumericKeypad } from "../components/NumericKeypad";
import { NumberInput } from "../components/NumberInput";

const meta: Meta<typeof NumericKeypad> = {
        title: "HMI/NumericKeypad",
        component: NumericKeypad,
        tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof NumericKeypad>;

export const Abierto: Story = {
        render: () => {
                const [v, setV] = useState<number | null>(120);
                const [open, setOpen] = useState(true);
                return (
                        <div style={{ width: 240, background: "var(--hmi-surface)", padding: 16, borderRadius: 8 }}>
                                <button type="button" class="hmi-btn hmi-btn--secondary hmi-btn--sm" onClick={() => setOpen(true)}>
                                        Abrir pad
                                </button>
                                <p style={{ color: "var(--hmi-text-faint)", fontSize: 12, marginTop: 8 }}>Valor: {v ?? "—"} °C</p>
                                <NumericKeypad
                                        open={open}
                                        label="Setpoint temperatura"
                                        unit="°C"
                                        value={v}
                                        min={0}
                                        max={250}
                                        step={1}
                                        oncommit={(next) => {
                                                setV(next);
                                                setOpen(false);
                                        }}
                                        onclose={() => setOpen(false)}
                                />
                        </div>
                );
        },
};

export const EnCampoConProvider: Story = {
        render: () => {
                const [v, setV] = useState<number | null>(4.5);
                return (
                        // enabled={!onlyMouse} en la app real: aquí siempre activo.
                        <KeypadProvider enabled>
                                <div style={{ width: 260, background: "var(--hmi-surface)", padding: 16, borderRadius: 8 }}>
                                        <NumberInput label="Presión setpoint" unit="bar" value={v} min={0} max={10} step={0.1} oncommit={setV} />
                                        <p style={{ color: "var(--hmi-text-faint)", fontSize: 12, marginTop: 8 }}>
                                                Toca el campo: abre el pad numérico. Valor: {v ?? "—"} bar
                                        </p>
                                </div>
                        </KeypadProvider>
                );
        },
};
