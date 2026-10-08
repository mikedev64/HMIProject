import type { Meta, StoryObj } from "@storybook/preact-vite";
import { useState } from "preact/hooks";
import { List, ListItem } from "../components/List";

const meta: Meta<typeof List> = {
        title: "HMI/List",
        component: List,
        tags: ["autodocs"],
        argTypes: {
                orientation: { control: "select", options: ["vertical", "horizontal"] },
        },
};

export default meta;
type Story = StoryObj<typeof List>;

export const Vertical: Story = {
        render: () => {
                const [sel, setSel] = useState<string | null>("mixer");
                return (
                        <div style={{ width: 260, background: "var(--hmi-surface)", padding: 12, borderRadius: 8 }}>
                                <List value={sel} onselect={setSel} ariaLabel="Máquinas">
                                        <ListItem value="mixer">Mezcladora 01</ListItem>
                                        <ListItem value="conveyor">Cinta 01</ListItem>
                                        <ListItem value="pump">Bomba 01</ListItem>
                                        <ListItem value="disabled" disabled>
                                                Línea 2 (offline)
                                        </ListItem>
                                </List>
                        </div>
                );
        },
};

/**
 * Dos selectores independientes en la misma pantalla: cada List mantiene
 * su propia selección gracias al patrón contenedor/hijo con contexto.
 */
export const IndependentSelections: Story = {
        render: () => {
                const [group, setGroup] = useState<string | null>("a");
                const [machine, setMachine] = useState<string | null>("mixer");
                return (
                        <div
                                style={{
                                        display: "flex",
                                        gap: 24,
                                        background: "var(--hmi-surface)",
                                        padding: 16,
                                        borderRadius: 8,
                                }}
                        >
                                <div>
                                        <p style={{ color: "var(--hmi-text-faint)", fontSize: 11, margin: "0 0 6px" }}>
                                                GRUPO
                                        </p>
                                        <List value={group} onselect={setGroup} ariaLabel="Grupo">
                                                <ListItem value="a">Grupo A</ListItem>
                                                <ListItem value="b">Grupo B</ListItem>
                                        </List>
                                </div>
                                <div>
                                        <p style={{ color: "var(--hmi-text-faint)", fontSize: 11, margin: "0 0 6px" }}>
                                                MÁQUINA
                                        </p>
                                        <List value={machine} onselect={setMachine} ariaLabel="Máquina">
                                                <ListItem value="mixer">Mezcladora</ListItem>
                                                <ListItem value="pump">Bomba</ListItem>
                                        </List>
                                </div>
                        </div>
                );
        },
};

export const Horizontal: Story = {
        render: () => {
                const [sel, setSel] = useState<string | null>("l1");
                return (
                        <div style={{ background: "var(--hmi-surface)", padding: 12, borderRadius: 8 }}>
                                <List orientation="horizontal" value={sel} onselect={setSel} ariaLabel="Líneas">
                                        <ListItem value="l1">Línea 1</ListItem>
                                        <ListItem value="l2">Línea 2</ListItem>
                                        <ListItem value="l3">Línea 3</ListItem>
                                </List>
                        </div>
                );
        },
};
