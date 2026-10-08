import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Button } from "../components/Button";

const meta: Meta<typeof Button> = {
        title: "HMI/Button",
        component: Button,
        tags: ["autodocs"],
        argTypes: {
                variant: { control: "select", options: ["primary", "secondary", "ghost", "danger"] },
                size: { control: "select", options: ["sm", "md"] },
        },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
        args: { variant: "primary", children: "Aceptar" },
};

export const Secondary: Story = {
        args: { variant: "secondary", children: "Cancelar" },
};

export const Danger: Story = {
        args: { variant: "danger", children: "Paro de emergencia" },
};

export const Ghost: Story = {
        args: { variant: "ghost", children: "Ayuda" },
};

export const Small: Story = {
        args: { size: "sm", variant: "secondary", children: "Editar" },
};

export const Disabled: Story = {
        args: { variant: "primary", disabled: true, children: "Sin conexión" },
};
