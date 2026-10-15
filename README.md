# HMInot — HMI estilo PanelView (Wails + Preact)

Prototipo de HMI industrial al estilo de un PanelView de Rockwell: arranca con
**pantalla de acceso** (perfiles por contraseña verificados en el backend Go),
un lienzo 2D **navegable** (zoom con límites + pan) muestra las máquinas de la
línea, al pasar el ratón aparece un popup con los datos en vivo del PLC y al
hacer clic la máquina abre su **faceplate parametrizado**: pestañas, bloques,
botones, lámparas, displays y pad numérico salen del fichero de configuración
de esa misma máquina. Bajo el topbar corre el **banner global de alarmas**.

No hay PLC físico: el backend Go mantiene una **sesión EtherNet/IP (CIP)** con
un simulador Node (`plc-simulator/`) — igual que un PanelView con un PLC
Allen-Bradley — y reenvía cada snapshot al frontend mediante el evento Wails
`plc:update`.

## Estructura

```
app.go / plc.go / eip.go / auth.go / flags.go / audit.go / config_edit.go /
recipes.go                 Backend Go: config, sesión EIP, auditoría, editor
                          de máquinas y recetas
eip_test.go                Tests del protocolo EIP (+ interoperabilidad Node)
docs/espejo/               Espejo COMENTADO del código Go (fuera del build)
hmi-config/                Configuración (versión 2):
  app.json                 PLC (endpoint eip://), banner y seguridad
  machines/<id>.json       UN archivo por máquina: tags + bloque "hmi" (UI)
  recipes/<id>.json        Recetas de setpoints por máquina
  users.json               Perfiles por contraseña (PBKDF2-HMAC-SHA256)
  audit.csv                Registro de auditoría de escrituras (se crea solo)
plc-simulator/             Simulador de PLC EtherNet/IP (Node, sin deps):
  server.js                Núcleo + interfaz HTTP de diagnóstico (:4100)
  eip.js                   Servidor EIP/CIP (:44818, el canal de datos real)
  eip-codec.js             Tipos CIP (BOOL/INT/DINT/REAL)
frontend/                  App Preact (Vite)
  src/                     Canvas, faceplates, login, banner, alarmas, CSV
  eip-bridge.mjs           Puente EIP para el modo preview (Node)
  packages/interface-components/  Librería interna de componentes + Storybook
  packages/wailjs-bindings/       Bindings Wails (AUTOGENERADOS, no editar)
```

### Configuración por máquina (tags + faceplate en un solo archivo)

Cada máquina tiene **su propio fichero** `hmi-config/machines/<id>.json` que
agrupa toda su información:

- **Mapa de E/S**: cada tag declara `address` (dirección del PLC: `N7:0`
  enteros, `F8:0` floats, `B3/1` bits…), `dataType` (`int16`, `int32`,
  `float32`, `bool`), `unit`, `min`/`max`, `group`, `access` (`rw` editable /
  `ro` solo lectura) y `sim` (cómo evoluciona en el simulador: `static`,
  `sine`, `follow`, `counter`, `boolRandom`, `boolToggle`).
- **Interfaz (bloque `hmi`)**: pestañas → bloques → secciones → controles:
  - bloques: `sections` (rejillas de controles), `groups` (tags por `group`,
    excluyendo las ya pintadas), `process` (gauge + barras), `trend`
    (sparklines) y `alarms` (alarmas de la máquina).
  - controles: `switch`, `number`, `display`, `button` (con `write`
    {tag, value, release} y `momentary` para pushbuttons), `pad` (pad
    numérico) y `lamp` (lámpara con `tone`).

Una máquina sin bloque `hmi` sigue funcionando: se le aplican las pestañas
por defecto (grupos + proceso + tendencia + alarmas).

El backend Go y el simulador leen la misma configuración, así que siempre
están de acuerdo (el orden de las tags define también el layout del assembly
EtherNet/IP). El HMI solo puede escribir direcciones declaradas `rw`.

### Comunicación con el PLC: EtherNet/IP + CIP

La capa de datos imita la de un PanelView con un PLC ControlLogix por
EtherNet/IP sobre TCP/44818 (no HTTP):

1. **RegisterSession** (0x0065): el HMI abre una sesión EIP y recibe un
   manejador de sesión.
2. **Forward Open** (0x54, al Connection Manager clase 6/instancia 1):
   negocia una conexión de clase 3 pidiendo un **RPI** (Requested Packet
   Interval) y recibe los **connection ID** (O→T y T→O) y el nº de serie.
3. **Mensajería implícita** (la de producción): el PLC produce paquetes
   **SendUnitData** (0x0070) T→O cada RPI con un **nº de secuencia** de 16
   bits y el *assembly* 100 (todas las tags del mapa, en orden fijo, con sus
   tipos CIP). El HMI los consume, decodifica y detecta huecos de secuencia
   (paquetes perdidos). Ya no hay polling: el dato «llega».
4. **Mensajería explícita** (la de servicio): **Read Tag** (0x4C) y
   **Write Tag** (0x4D) sobre SendRRData (0x006F), direccionando cada tag por
   su símbolo (segmento ANSI extendido 0x91), como hace Logix. Las
   escrituras del HMI son servicios explícitos con espera de respuesta.
5. **Forward Close** (0x4E) al desconectar.

El frontend muestra el estado de la conexión en el chip **EIP** del topbar
(nº de secuencia a la vista; RPI, sesión y connection IDs en el tooltip).
Los tipos CIP viajan por el cable: BOOL (0xC1), INT (0xC3), DINT (0xC4) y
REAL (0xCA). El endpoint se configura en `app.json` (`plc.endpoint`, por
defecto `eip://127.0.0.1:44818`).

La interfaz HTTP del simulador (`:4100/tags`, `:4100/health`) sigue viva
solo como **diagnóstico** (como la página de estado de un PLC físico); el
canal de datos del HMI es el socket EIP.

### Perfiles y sesión

`hmi-config/users.json` define los usuarios con hash **PBKDF2-HMAC-SHA256**
(100000 iteraciones, salt de 16 bytes). Al arrancar hay que iniciar sesión
(siempre que `security.requireLogin` sea `true`, por defecto) y la
verificación ocurre en el **backend Go** (`Login`, nivel `viewer` <
`operator` < `admin`): sin nivel `operator` no se puede escribir en el PLC.
Semilla incluida de ejemplo:

| Usuario    | Contraseña     | Perfil    |
| ---------- | -------------- | --------- |
| `admin`    | `admin123`     | admin     |
| `operador` | `operador123`  | operator  |
| `consulta` | `consulta123`  | viewer    |

## Funcionalidades

- **Faceplates parametrizados**: el panel lateral de cada máquina se renderiza
  desde SU fichero de configuración (bloque `hmi`): el programador decide
  pestañas, bloques y controles (botones de mando, displays, lámparas,
  pad numérico…) sin tocar código.
- **Pad numérico** (`NumericKeypad` + `KeypadProvider`): se abre al tocar un
  campo numérico o un control `pad`, salvo que la app arranque con el flag
  `--onlymouse` (modo solo ratón: entonces manda el teclado físico). La
  librería acepta eventos **pointer/touch** en todos sus controles.
- **Perfiles por contraseña**: pantalla de acceso al arrancar (con teclado en
  pantalla), verificación PBKDF2 en el backend Go, niveles viewer/operator/
  admin, bloqueo de la cuenta tras 5 intentos fallidos y cierre de sesión
  desde el topbar.
- **Nivel mínimo por control** (`minLevel` en la config): p.ej. un botón de
  mantenimiento con `"minLevel": "admin"`; el backend aplica el mismo criterio
  en `WriteTag` (máximo entre operator y el minLevel de los controles que
  escriben esa tag).
- **Recetas por máquina** (bloque `recipes`): guardar/cargar/borrar
  conjuntos de setpoints (`hmi-config/recipes/<id>.json`), solo tags rw.
- **Auditoría de escrituras**: quién escribió qué tag, valor anterior/nuevo y
  cuándo, con los intentos denegados incluidos (anillo en memoria +
  `hmi-config/audit.csv`); visible en el popover «Auditoría» (solo admin).
- **Editor de configuración** (solo admin, botón «⚙ Config»): edita el JSON
  de cada máquina con validación en vivo (errores bloquean el guardado,
  avisos no), guarda con recarga en caliente y gestiona los usuarios
  (alta/baja, nivel y contraseña).
- **Histórico de alarmas persistente**: el registro sobrevive a un reinicio
  (localStorage, últimos 200 eventos).
- **Tendencia mejorada**: cursor con valor y hora por muestra + exportación
  CSV con `fecha_hora` por fila.
- **Reconocimiento de alarmas en el PLC**: «Reconocer» escribe un pulso en
  `statusTags.ack` (si la máquina lo define) además del ack local del HMI.
- **Backoff de reconexión**: si el PLC falla, el reintento de la sesión EIP
  sube x2 por fallo (tope 5 s) hasta que vuelve a responder.
- **Banner global de alarmas**: franja bajo el topbar con las alarmas activas
  aún no reconocidas (`ui.alarmBanner.enabled/maxItems` en `app.json`), con
  ack individual y «Reconocer todo».
- **Canvas navegable con límites**: la rueda del ratón hace zoom hacia el
  cursor (0,05×–6×), arrastrar desplaza la vista (sin perder el mundo de
  vista), los botones `+ / −` hacen zoom al centro y `⌂` vuelve a la vista
  general. Al tomar el control manual, la cámara deja de animarse sola hasta
  cambiar de foco o pulsar reset.
- **Hover y foco**: popup con datos en vivo bajo el cursor; clic para centrar
  la máquina y abrir el panel (Escape o ✕ para salir).
- **Panel en pestañas** (definidas en la config de cada máquina):
  - `Control` — secciones de controles + tags agrupados (Switch/NumberInput).
  - `Proceso` — gauge + barras con umbrales visuales (80 %/92 % del rango).
  - `Tendencia` — sparklines con el histórico reciente (120 muestras por tag).
  - `Alarmas` — historial de alarmas de la máquina, con LED parpadeante.
- **Registro global de alarmas** en el topbar: badge con las activas y
  popover con las últimas (detección de flanco de subida por `statusTags.alarm`).
- **Exportar snapshot a CSV** con un clic (todas las máquinas y tags, con BOM
  para que Excel abra bien los acentos).
- **Pantalla completa** con un clic (botón del topbar).
- **Modo preview** sin binario Go: el dev server de Vite actúa como el
  «runtime del PanelView» y mantiene la misma sesión EIP (`PREVIEW · SIN WAILS`).

## Ejecución

### 1. Simulador de PLC

```bash
node plc-simulator/server.js     # EIP/CIP en :44818 + diagnóstico HTTP en :4100
```

### 2. App de escritorio (Wails)

```bash
wails dev                        # desarrollo con hot reload
wails build                      # compilado en modo producción
wails dev -- -onlymouse          # modo solo ratón: sin pad numérico
```

El flag `--onlymouse` desactiva el pad numérico en pantalla (los campos usan
el teclado físico). Sin él, el keypad táctil queda activo. En modo preview
(sin binario Go) se simula con la query string `?onlymouse`.

> **Nota:** Wails v2.16 detecta la versión de WebKit en tiempo de build. En
> sistemas donde solo exista `webkit2gtk-4.1` (y no `webkit2gtk-4.0`), `wails
> dev/build` falla en pkg-config; el código Go se puede verificar con
> `go build -tags webkit2_41 ./...`.

### 3. Solo frontend (modo preview, sin binario Go)

```bash
cd frontend && pnpm dev          # http://localhost:5173
```

Si no hay runtime de Wails, la app entra en **modo preview**: sirve la
configuración (`app.json` + `machines/*.json` + `users.json`) desde Vite y,
como el navegador no puede abrir un socket TCP, el dev server mantiene la
**misma sesión EtherNet/IP** contra el simulador (`frontend/eip-bridge.mjs`) y
la expone por HTTP/SSE (`/eip/state`, `/eip/write`, `/eip/stream`). El login se
verifica aquí con WebCrypto/PBKDF2 usando el mismo `users.json` y el mismo
algoritmo que Go, así que el flujo de sesión y de datos es testeable sin
compilar la app de escritorio (en la ventana superior aparece el aviso
`PREVIEW · SIN WAILS`).

## Bindings Wails

Los bindings (`frontend/packages/wailjs-bindings/wailsjs/**`) se regeneran con:

```bash
wails generate module
```

**No editar a mano** esos archivos: son autogenerados. El glue de la librería
(`index.js` / `index.d.ts`) sí es manual y exporta los métodos bound:
`GetMachines`, `GetSnapshot`, `WriteTag`, `Login`, `Logout`, `GetSession`,
`GetRuntimeFlags`, `Greet`.

## Código Go comentado (`docs/espejo/`)

`docs/espejo/` es un **espejo** de `app.go`, `plc.go` y `main.go` con comentarios
que explican cada parte del backend: uso de **referencias** (`&valor` →
punteros `*T`), receptores con puntero, struct tags `json`, `//go:embed`,
blank imports, `defer`, goroutines y canales, `sync.RWMutex`, type assertions
con comma-ok, method values (`app.startup` sin paréntesis), maps/slices con
semántica de referencia, errores con `%w`, etc.

Los ficheros llevan la etiqueta `//go:build ignore`, por lo que quedan
**excluidos del build** (son documentación viva). Cómo type-checkearlos y
avisos de deriva: ver `docs/espejo/README.md`.

## Librería de componentes

`frontend/packages/interface-components` contiene los componentes reutilizables
(Button con `onpress`/`onrelease` para pushbuttons, Badge, List/ListItem,
Panel, Field, NumberInput, Switch, Popover, **Gauge, Bar, Sparkline, Tabs**,
y el **pad numérico**: `NumericKeypad` + `KeypadProvider`/`useKeypad`) con
el patrón contenedor/hijo (la selección de cada `List` vive en su contexto y
no se pisan entre sí). Todos los controles usan **pointer events**, así que
aceptan ratón y touch. La app principal y Storybook consumen el mismo código:

```bash
pnpm --filter interface-components storybook          # http://localhost:6006
pnpm --filter interface-components build-storybook    # storybook-static/
```

## Verificación

```bash
# Backend Go (tag webkit2_41 solo es necesario sin webkit2gtk-4.0)
go build -tags webkit2_41 ./... && go vet ./... && go test -tags webkit2_41 ./...
# (el test de interoperabilidad EIP se omite si el simulador no está en marcha)

# Frontend y librería
cd frontend && pnpm build
pnpm --filter interface-components build
pnpm --filter interface-components build-storybook

# Smoke test end-to-end (necesita simulador + pnpm dev en marcha):
#   node plc-simulator/server.js      (terminal 1)
#   cd frontend && pnpm dev           (terminal 2)
node frontend/packages/interface-components/smoke.mjs
```

El smoke test recorre el flujo real en un navegador headless: **pantalla de
acceso y verificación de sesión**, el **chip de diagnóstico EIP** (la
secuencia avanza con los paquetes implícitos), hover con popup, clic para
centrar y editar, escritura de tags `rw` (entero, float y switch; las
escrituras viajan como **Write Tag** CIP), bloqueo de tags `ro`, cierre con
Escape, **zoom con límites (0,05×–6×), pan con arrastre y reset**, las
**pestañas del faceplate definidas en la config** (secciones de controles,
gauge, barras y sparklines), el **pad numérico**, el **banner de alarmas con
ack**, la **descarga del CSV** y el **registro de alarmas**, además de
comprobar los valores escritos en el PLC simulado.
