/*
 * Punto de entrada de la librería interna de componentes HMI.
 * Los consumidores (app principal y Storybook) importan desde aquí.
 */
import "./theme.css";

export { Button } from "./components/Button";
export type { ButtonProps } from "./components/Button";

export { Badge } from "./components/Badge";
export type { BadgeProps } from "./components/Badge";

export { List, ListItem } from "./components/List";
export type { ListProps, ListItemProps } from "./components/List";

export { Panel } from "./components/Panel";
export type { PanelProps } from "./components/Panel";

export { Field } from "./components/Field";
export type { FieldProps } from "./components/Field";

export { NumberInput } from "./components/NumberInput";
export type { NumberInputProps } from "./components/NumberInput";

export { NumericKeypad } from "./components/NumericKeypad";
export type { NumericKeypadProps } from "./components/NumericKeypad";

export { KeypadProvider, useKeypad } from "./components/Keypad";
export type { KeypadProviderProps, KeypadSpec, KeypadContextValue } from "./components/Keypad";

export { Switch } from "./components/Switch";
export type { SwitchProps } from "./components/Switch";

export { Popover } from "./components/Popover";
export type { PopoverProps } from "./components/Popover";

export { Gauge } from "./components/Gauge";
export type { GaugeProps } from "./components/Gauge";

export { Bar } from "./components/Bar";
export type { BarProps } from "./components/Bar";

export { Sparkline } from "./components/Sparkline";
export type { SparklineProps } from "./components/Sparkline";

export { Tabs, Tab } from "./components/Tabs";
export type { TabsProps, TabProps } from "./components/Tabs";
