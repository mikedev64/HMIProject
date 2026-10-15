import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Gauge } from "../components/Gauge";

const meta: Meta<typeof Gauge> = {
        title: "HMI/Gauge",
        component: Gauge,
        tags: ["autodocs"],
        argTypes: {
                size: { control: "select", options: ["sm", "md"] },
        },
};

export default meta;
type Story = StoryObj<typeof Gauge>;

export const Normal: Story = {
        args: { value: 118.3, min: 0, max: 300, label: "Temperatura actual", unit: "°C", size: "md" },
};

export const Warn: Story = {
        args: { value: 235, min: 0, max: 300, label: "Temperatura", unit: "°C", warnAt: 200, dangerAt: 260 },
};

export const Danger: Story = {
        args: { value: 8.4, min: 0, max: 10, label: "Presión de descarga", unit: "bar", dangerAt: 8 },
};

export const Small: Story = {
        args: { value: 1500, min: 0, max: 3000, label: "Velocidad", unit: "rpm", size: "sm" },
};

export const SinValor: Story = {
        args: { value: null, min: 0, max: 100, label: "Caudal", unit: "L/min" },
};
