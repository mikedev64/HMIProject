# HMInot — HMI estilo PanelView (Wails + Preact)

Prototipo de HMI industrial al estilo de un PanelView de Rockwell: un lienzo 2D
muestra las máquinas de la línea, al pasar el ratón aparece un popup con los
datos en vivo del PLC y al hacer clic la máquina se centra y escala abriendo un
panel lateral de edición de sus tags.

No hay PLC físico: el backend Go hace **polling por HTTP** a un simulador Node
(`plc-simulator/`) y reenvía cada snapshot al frontend mediante el evento Wails
`plc:update`.

## Estructura

```
app.go / plc.go            Backend Go: mapa HMI, polling del PLC, bindings Wails
hmi-config/machines.json   Mapa HMI <-> PLC: máquinas, tags, direcciones, accesos
plc-simulator/             Simulador de PLC por HTTP (Node, sin dependencias)
frontend/                  App Preact (Vite)
  src/                     Canvas 2D, popup hover, panel lateral de edición
  packages/interface-components/  Librería interna de componentes + Storybook
  packages/wailjs-bindings/       Bindings Wails (AUTOGENERADOS, no editar)
```

### El mapa HMI

`hmi-config/machines.json` es el corazón del sistema. Cada tag declara:

- `address`: dirección de memoria del PLC (`N7:0` enteros, `F8:0` floats, `B3/1` bits…)
- `dataType` (`int16`, `int32`, `float32`, `bool`), `unit`, `min`/`max`, `group`
- `access`: `rw` (editable desde el HMI) o `ro` (solo lectura)
- `sim`: cómo evoluciona el valor en el simulador (`static`, `sine`, `follow`, `counter`, `boolRandom`, `boolToggle`)

El backend Go y el simulador leen el mismo archivo, así que siempre están de
acuerdo. El HMI solo puede escribir direcciones declaradas como `rw`.

## Ejecución

### 1. Simulador de PLC

```bash
node plc-simulator/server.js     # http://127.0.0.1:4100
```

### 2. App de escritorio (Wails)

```bash
wails dev                        # desarrollo con hot reload
wails build                      # compilado en modo producción
```

> **Nota:** Wails v2.16 detecta la versión de WebKit en tiempo de build. En
> sistemas donde solo exista `webkit2gtk-4.1` (y no `webkit2gtk-4.0`), `wails
> dev/build` falla en pkg-config; el código Go se puede verificar con
> `go build -tags webkit2_41 ./...`.

### 3. Solo frontend (modo preview, sin binario Go)

```bash
cd frontend && pnpm dev          # http://localhost:5173
```

Si no hay runtime de Wails, la app entra en **modo preview**: sirve el mapa
`hmi-config/machines.json` desde Vite y hace el polling directamente al
simulador. Útil para desarrollar la UI sin compilar la app de escritorio (en
la ventana superior aparece el aviso `PREVIEW · SIN WAILS`).

## Bindings Wails

Los bindings (`frontend/packages/wailjs-bindings/wailsjs/**`) se regeneran con:

```bash
wails generate module
```

**No editar a mano** esos archivos: son autogenerados. El glue de la librería
(`index.js` / `index.d.ts`) sí es manual y exporta los métodos bound:
`GetMachines`, `GetSnapshot`, `WriteTag`, `Greet`.

## Librería de componentes

`frontend/packages/interface-components` contiene los componentes reutilizables
(Button, Badge, List/ListItem, Panel, Field, NumberInput, Switch, Popover) con
el patrón contenedor/hijo (la selección de cada `List` vive en su contexto y
no se pisan entre sí). La app principal y Storybook consumen el mismo código:

```bash
pnpm --filter interface-components storybook          # http://localhost:6006
pnpm --filter interface-components build-storybook    # storybook-static/
```

## Verificación

```bash
# Backend Go (tag webkit2_41 solo es necesario sin webkit2gtk-4.0)
go build -tags webkit2_41 ./... && go vet ./...

# Frontend y librería
cd frontend && pnpm build
pnpm --filter interface-components build
pnpm --filter interface-components build-storybook

# Smoke test end-to-end (necesita simulador + pnpm dev en marcha):
#   node plc-simulator/server.js      (terminal 1)
#   cd frontend && pnpm dev           (terminal 2)
node frontend/packages/interface-components/smoke.mjs
```

El smoke test recorre el flujo real en un navegador headless: hover con popup,
clic para centrar y editar, escritura de tags `rw` (entero, float y switch),
bloqueo de tags `ro`, cierre con Escape y comprobación de los valores en el
PLC simulado.
