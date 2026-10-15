# Espejo comentado del código Go

Estos ficheros son **copia textual del backend de la raíz** (`app.go`, `plc.go`,
`main.go`) con comentarios adicionales que explican:

- qué hace cada parte del código,
- el uso de **referencias** (`&valor` → punteros `*T`) y **punteros** (receptores
  `*App`, campos `*plcClient`, opcionales `*float64`),
- **truquis de la sintaxis de Go** que aparecen en el proyecto: `//go:embed`,
  blank imports (`_ "embed"`), `defer`, goroutines (`go f()`), canales
  (`<-ticker.C`), `sync.RWMutex`, struct tags `json:"..."`, type assertions
  (`v.(bool)` con comma-ok), method values (`app.startup` sin paréntesis),
  literales compuestos, múltiples retornos `(T, error)`, errores con `%w`,
  maps/slices con semántica de referencia, etc.

## Ficheros

| Fichero             | Qué cubre                                                        |
| ------------------- | ---------------------------------------------------------------- |
| `app.go` espejo     | Modelo del mapa HMI, embed de config, App+mutex, snapshot EIP, bindings, `WriteTag`, `coerceValue` |
| `plc.go` espejo     | Sesión EIP con el PLC: `plcClient` que envuelve `eipClient`, layout del assembly, backoff |
| `main.go` espejo    | Arranque de Wails: embed del frontend, callbacks, `Bind`          |
| `audit.go` espejo   | Registro de auditoría: mutex, anillo en memoria, CSV con `encoding/csv`, type switch |
| `config_edit.go` espejo | Editor de config: regex compilada, conjuntos `map[string]bool`, closures, punteros opcionales |
| `recipes.go` espejo | Recetas: `map[string]any`, variable global testeable, `errors.Is`/`%w`, escritura atómica |

> **Nuevo:** `eip.go` (cliente EtherNet/IP/CIP: cabeceras de 24 B, sesión,
> Forward Open, mensajería implícita con nº de secuencia y servicios
> explícitos Read/Write Tag) aún no tiene espejo; su test comentado vive en
> `eip_test.go`.

## Config congelada (v1) en `hmi-config/machines.json`

La configuración real pasó a la **versión 2** (`hmi-config/app.json` +
`hmi-config/machines/<id>.json` + `hmi-config/users.json`), pero este espejo
sigue embebiendo el mapa **v1 congelado** en `docs/espejo/hmi-config/machines.json`
para poder type-checkearse por sí solo. Es una copia histórica: **no es la
configuración que usa la app** (la que manda está en `hmi-config/` de la raíz).

## Por qué no compilan «solos»

Cada fichero empieza con:

```go
//go:build ignore
```

Esa etiqueta **excluye** los ficheros de cualquier build (`go build ./...`,
`go vet ./...`, Wails): son documentación viva, no código que se ejecuta. Así
puedes duplicar tipos (`App`, `TagDef`, …) sin romper el paquete principal.

## Verificar que el espejo sigue siendo fiel

Además de compararlo con el original, se puede type-checkear así (añade la
etiqueta temporalmente y le pone los assets que embebe):

```bash
sed -i '1,2d' docs/espejo/*.go
mkdir -p docs/espejo/frontend/dist && touch docs/espejo/frontend/dist/.keep
cp -r hmi-config docs/espejo/
go vet -tags webkit2_41 ./docs/espejo   # debe salir en 0
rm -rf docs/espejo/frontend docs/espejo/hmi-config
git checkout -- docs/espejo             # o volver a pegar //go:build ignore
```

> **Aviso de deriva:** este directorio mezcla dos cosas a propósito:
> `app.go` y `main.go` son la **instantánea histórica v1** (embeben el mapa
> congelado `docs/espejo/hmi-config/machines.json`, ver «Config congelada»
> más abajo), mientras que `plc.go`, `audit.go`, `config_edit.go` y
> `recipes.go` reflejan el **código actual** (la comunicación con el PLC pasó
> a **EtherNet/IP**: `plc.go` documenta la sesión EIP, no el cliente HTTP
> antiguo). Si tocas la raíz, recopia el cambio en el espejo correspondiente.
> `eip.go` (cliente EtherNet/IP) aún no tiene espejo; su test comentado vive
> en `eip_test.go`.
