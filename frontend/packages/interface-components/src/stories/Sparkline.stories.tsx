import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Sparkline } from "../components/Sparkline";

const serie = Array.from({ length: 40 }, (_, i) => 60 + Math.sin(i / 4) * 8 + (i % 7 === 0 ? 3 : 0));

const meta: Meta<typeof Sparkline> = {
        title: "HMI/Sparkline",
        component: Sparkline,
        tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Sparkline>;

export const Tendencia: Story = {
        args: { data: serie, label: "Nivel de tanque", unit: "%" },
};

export const Ventana: Story = {
        args: { data: serie, points: 16, label: "Nivel (últimos 16)", unit: "%" },
};

export const ValoresAltos: Story = {
        args: { data: serie.map((v) => v * 20), label: "Velocidad", unit: "rpm", width: 300 },
};

export const SinDatos: Story = {
        args: { data: [], label: "Caudal", unit: "L/min" },
};
