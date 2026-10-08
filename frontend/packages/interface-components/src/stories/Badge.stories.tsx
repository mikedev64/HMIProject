import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Badge } from "../components/Badge";

const meta: Meta<typeof Badge> = {
        title: "HMI/Badge",
        component: Badge,
        tags: ["autodocs"],
        argTypes: {
                tone: { control: "select", options: ["neutral", "ok", "warn", "danger", "info"] },
                dot: { control: "boolean" },
        },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Neutral: Story = {
        args: { tone: "neutral", children: "RO" },
};

export const Ok: Story = {
        args: { tone: "ok", dot: true, children: "En línea" },
};

export const Warn: Story = {
        args: { tone: "warn", dot: true, children: "Advertencia" },
};

export const Danger: Story = {
        args: { tone: "danger", dot: true, children: "Alarma" },
};

export const Info: Story = {
        args: { tone: "info", children: "RW" },
};
