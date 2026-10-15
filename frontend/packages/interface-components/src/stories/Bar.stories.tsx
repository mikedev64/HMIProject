import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Bar } from "../components/Bar";

const meta: Meta<typeof Bar> = {
        title: "HMI/Bar",
        component: Bar,
        tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Bar>;

export const Nivel: Story = {
        args: { value: 62.4, min: 0, max: 100, label: "Nivel de tanque", unit: "%" },
};

export const ConSetpoint: Story = {
        args: { value: 62.4, min: 0, max: 100, label: "Nivel de tanque", unit: "%", mark: 75 },
};

export const SobreUmbral: Story = {
        args: { value: 265, min: 0, max: 300, label: "Temperatura", unit: "°C", warnAt: 200, dangerAt: 260 },
};

export const Compacta: Story = {
        args: { value: 45, min: 0, max: 100, compact: true, showScale: false, unit: "%" },
};

export const SinValor: Story = {
        args: { value: null, min: 0, max: 300, label: "Caudal", unit: "L/min" },
};
