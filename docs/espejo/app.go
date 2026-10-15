//go:build ignore

// ============================================================================
// ESPEJO COMENTADO DE app.go  (código idéntico al de la raíz del repo)
//
// Este fichero existe SOLO como documentación: la etiqueta
// //go:build ignore le dice a Go que lo excluya del build, así que duplicar
// aquí tipos como App o TagDef no rompe nada. Léelo en tu editor (resaltado
// de sintaxis de Go) junto a la explicación de referencias, punteros y
// "truquis" de la sintaxis que usa el backend real.
// ============================================================================
package main

import (
	// context: objeto que transporta la "vida útil" de una operación
	// (cancelación, deadlines, valores compartidos). Wails crea uno al arrancar
	// y nos lo entrega en OnStartup; guardarlo en App nos permite después
	// emitir eventos hacia la webview desde cualquier goroutine.
	"context"

	// _ "embed": "blank import" — el guion bajo dice al compilador que NO
	// necesitamos ningún identificador del paquete, pero lo importamos igual
	// por su EFECTO SECUNDARIO: habilita la directiva //go:embed de más
	// abajo. Sin esta línea, //go:embed no compila.
	_ "embed"
	// encoding/json: Marshal (Go -> JSON) y Unmarshal (JSON -> Go) por reflexión.
	"encoding/json"
	// fmt: formateo (Printf/Sprintf) y construcción de errores (Errorf).
	"fmt"
	// os + filepath: ficheros del sistema operativo y rutas multiplataforma
	// (filepath.Clean normaliza separadores y ".." peligrosos).
	"os"
	"path/filepath"
	// sync: primitivas de concurrencia (aquí, sync.RWMutex).
	"sync"
	// time: relojes, tickers y duraciones.
	"time"

	// runtime de Wails: EventsEmit publica un evento hacia la webview JS.
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// DIRECTIVA DE COMPILACIÓN (no es un comentario normal: empieza por //go:, y
// el compilador la procesa). Copia el fichero hmi-config/machines.json dentro
// del binario al ejecutar `go build` (la ruta es relativa al fichero fuente,
// por eso hay que compilar desde la raíz del módulo).
//
// []byte = slice de bytes. TRUCO DE SEMÁNTICA: un slice NO es los datos, es
// una cabecera de 3 palabras (puntero al array, longitud, capacidad). Pasar
// un slice a una función NO copia los bytes: ambas partes apuntan al MISMO
// array. Por eso loadConfig() puede usar embeddedConfig como "fallback" sin
// coste y sin riesgo de mutarlo (aquí solo se reemplaza la referencia).
//
//go:embed hmi-config/machines.json
var embeddedConfig []byte

// ---------------------------------------------------------------------------
// Modelo del mapa HMI <-> PLC
//
// Un PanelView no "habla con máquinas": habla con TAGS mapeados a direcciones
// de memoria del PLC (N7:0 = archivo de enteros, F8:0 = floats, B3/1 = bits,
// etc.). El HMI hace polling de esas direcciones y permite escribir solo en
// las que el proyecto define como legibles-escritables.
//
// hmi-config/machines.json es ese mapa: qué tags existen, en qué dirección,
// qué tipo tienen, si son editables (rw) o solo lectura (ro), rangos, unidad,
// imagen de la máquina, etc. El simulador Node y este backend leen el mismo
// archivo, así que la simulación y el HMI siempre están de acuerdo.
// ---------------------------------------------------------------------------

// Access es un TIPO NOMBRADO (type Nombre TipoBase): crea un tipo nuevo a
// partir de string. Ventajas: el compilador evita confundirlo con cualquier
// string, el código se auto-documenta y los métodos se pueden añadir después.
// Los campos de tipo Access en TagDef ya no aceptan strings suelos sin
// convertirlos.
type Access string

// Constantes tipadas en bloque. Aquí no se usa `iota` porque los valores son
// literales claros ("ro"/"rw"); notar que cada constante repite el tipo.
const (
	AccessReadOnly  Access = "ro"
	AccessReadWrite Access = "rw"
)

// TagDef describe una variable del mapa HMI. Dos conceptos clave viven en
// esta struct:
//
//  1. STRUCT TAGS (`json:"..."`): string literal en BACKTICKS (no hay que
//     escapar comillas) adjunto a cada campo. El compilador los ignora: son
//     METADATOS que encoding/json lee por reflexión (reflect):
//     json:"min"            -> nombre del campo en el JSON
//     json:"min,omitempty"  -> al serializar, si el valor es cero/vacío se
//     OMITE (no sale "min": 0 sobrando)
//     json:"min,omitempty" también hace que Unmarshal acepte el campo
//     ausente sin queja (opcionalidad).
//
//  2. PUNTEROS OPCIONALES: Min/Max son *float64 (puntero a float64), no
//     float64. En JSON, "ausente" y "0" son indistinguibles con un valor
//     plano; con puntero el significado es binario:
//     tag.Min == nil  -> no definido (la tag no tiene límite inferior)
//     tag.Min != nil  -> definido; para usarlo hay que DESREFERENCIAR con
//     *tag.Min ("seguir el puntero hasta el float64").
//     Es el patrón idiomático de Go para campos opcionales numéricos.
type TagDef struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	Address  string   `json:"address"`
	DataType string   `json:"dataType"`
	Access   Access   `json:"access"`
	Unit     string   `json:"unit,omitempty"`
	Min      *float64 `json:"min,omitempty"`
	Max      *float64 `json:"max,omitempty"`
	Group    string   `json:"group,omitempty"`
	// `any` es el alias moderno de interface{}: "cualquier tipo" (string,
	// bool, float64...). Imprescindible para valores del JSON cuyo tipo exacto
	// solo se conoce en tiempo de ejecución (luego se "afirma" el tipo con
	// value.(bool) / value.(float64) dentro de coerceValue).
	Default any `json:"default,omitempty"`
}

type StatusTags struct {
	Run   string `json:"run,omitempty"`
	Alarm string `json:"alarm,omitempty"`
}

type Size struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Machine struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Type       string     `json:"type"`
	Image      string     `json:"image"`
	Size       Size       `json:"size"`
	StatusTags StatusTags `json:"statusTags,omitempty"`
	Tags       []TagDef   `json:"tags"`
}

type PlcInfo struct {
	Name           string `json:"name"`
	Endpoint       string `json:"endpoint"`
	PollIntervalMs int    `json:"pollIntervalMs"`
}

type HMIConfig struct {
	Version  int       `json:"version"`
	Plc      PlcInfo   `json:"plc"`
	Machines []Machine `json:"machines"`
}

// Snapshot es lo que el frontend recibe en cada ciclo de polling.
//
// map[string]any = mapa (hash) de string a cualquier valor: la "memoria del
// PLC" address -> valor. OJO con la SEMÁNTICA DE REFERENCIA de los maps (y
// de los slices): al copiar la struct Snapshot (`snap := a.snapshot`) los
// campos básicos (bool, int64) se copian, pero el mapa NO se duplica: ambas
// structs siguen apuntando al MISMO mapa subyacente. Cambios en una se ven
// en la otra. Si hiciera falta aislar de verdad, habría que copiarlo a mano
// ("deep copy") bucleando por las claves.
type Snapshot struct {
	Connected bool           `json:"connected"`
	Error     string         `json:"error,omitempty"`
	Ts        int64          `json:"ts"`
	Values    map[string]any `json:"values"`
}

// App: estado global del backend. Todos sus campos van en minúscula (sin
// exportar) a propósito: desde JavaScript solo se ve lo que expongan los
// métodos exportados (GetMachines, GetSnapshot, WriteTag...), nunca el
// interior de la struct.
//
// Convive con varias GOROUTINES a la vez (la del polling, las llamadas de
// los bindings JS, la del evento), de ahí el mutex:
//
//	ctx    context.Context -> cable con la webview; nil hasta startup().
//	config HMIConfig       -> mapa HMI ya cargado; es una struct con slices
//	                          dentro, leerla no copia las máquinas (solo la
//	                          cabecera de los slices).
//	plc    *plcClient      -> PUNTERO: `*T` significa "dirección de un T".
//	                          No copiamos el struct (contiene un *http.Client
//	                          que no debe duplicarse) y todos los lectores
//	                          comparten la misma instancia.
//	mu     sync.RWMutex    -> cerradura reentrante de lectura/escritura:
//	                          * Lock()/Unlock()   -> escrituras (exclusivas)
//	                          * RLock()/RUnlock() -> lecturas (concurrentes
//	                            entre sí, exclusivas frente a escrituras)
//	snapshot Snapshot      -> último estado del PLC, siempre protegido por mu.
type App struct {
	ctx    context.Context
	config HMIConfig
	plc    *plcClient

	mu       sync.RWMutex
	snapshot Snapshot
}

// NewApp crea la instancia única de App. Devuelve *App (puntero) porque:
//   - los métodos se declaran con receptor pointer `func (a *App) ...`;
//   - el MISMO objeto tiene que compartir main.go (wails.Run + OnStartup),
//     el pollLoop y los bindings JS. Con valor copiado, cada uso tendría su
//     propio estado y los cambios no se verían entre sí.
//
// &App{} toma la dirección del literal (struct vacío: ctx=nil, values=nil...).
func NewApp() *App {
	return &App{}
}

// startup se invoca desde main.go (OnStartup: app.startup) cuando la app
// arranca. El context viene "de fuera" (lo inyecta Wails): en Go el contexto
// se pasa SIEMPRE como primer parámetro, nunca se cuelga de una variable
// global.
//
// RECEPTOR DE PUNTERO `(a *App)`: el método recibe la DIRECCIÓN de la App,
// de modo que `a.ctx = ctx` modifica la instancia original. Con receptor por
// valor `(a App)` estaríamos escribiendo en una COPIA descartable y el
// contexto se perdería al salir del método. Regla: receptor puntero si el
// método muta estado o si la struct pesa y no queremos copiarla.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx // guardamos el "cable" para runtime.EventsEmit más adelante

	// PATRÓN IDIOMÁTICO `if err := f(); err != nil`: declara err acotado al
	// ámbito del if (no contamina la función) y comprueba en la misma línea.
	// %v formatea cualquier valor con su representación por defecto.
	if err := a.loadConfig(); err != nil {
		fmt.Printf("Error cargando mapa HMI: %v\n", err)
		return // sin config no hay pollLoop: la app queda en modo "vacío"
	}

	a.plc = newPlcClient(a.config.Plc.Endpoint) // puntero a un cliente nuevo
	a.snapshot = Snapshot{
		Connected: false,
		Values:    map[string]any{}, // mapa NO nil: listo para escribir en él
	}

	// GOROUTINE: `go f()` arranca f en una rutina ligera del runtime (pila
	// inicial de ~2 KB, multiplexada sobre threads del SO) y CONTINÚA sin
	// esperar. Sin esto, el bucle infinito del polling bloquearía startup y la
	// ventana jamás se mostraría. lifecycle: vive mientras viva la app.
	go a.pollLoop()
}

// loadConfig lee hmi-config/machines.json; si no está en disco (app compilada
// en otra máquina) usa la copia embebida en el binario.
//
// TRUCOS QUE APARECEN AQUÍ:
//   - `data := embeddedConfig` copia la CABECERA del slice (ptr/len/cap), no
//     los bytes: data y embeddedConfig comparten el contenido de fondo.
//   - `if _, err := os.Stat(...)`: el guion bajo descarta el primer valor
//     (FileInfo) porque solo nos interesa si hubo error (err==nil => existe).
//   - El `if raw, err := ...` anidado CREA OTRO err que solo vive dentro de
//     ese if (shadowing): el err del if exterior no se contamina, y al salir
//     del bloque vuelve a valer lo de antes.
//   - filepath.Clean: normaliza separadores (Windows/Unix) y colapsa "..";
//     aquí la ruta es fija, es higiene defensiva.
//   - `json.Unmarshal(data, &a.config)`: EL EJEMPLO CLÁSICO DE REFERENCIA EN
//     GO. No existe la keyword `ref`; para escribir dentro de un valor se
//     pasa su DIRECCIÓN con `&` (address-of), cuyo tipo es *HMIConfig.
//     Unmarshal necesita MUTAR nuestra struct: si le pasáramos `a.config`
//     (valor) recibiría una copia, la llenaría y el cambio se perdería en el
//     camino de vuelta. Con `&` sigue el puntero hasta el original.
func (a *App) loadConfig() error {
	data := embeddedConfig // por defecto: la copia embebida en el binario

	if _, err := os.Stat("hmi-config/machines.json"); err == nil {
		if raw, err := os.ReadFile(filepath.Clean("hmi-config/machines.json")); err == nil {
			data = raw // prioridad al fichero en disco (permite editar sin recompilar)
		}
		// Si ReadFile falla (permisos, etc.) se usa silenciosamente lo embebido.
	}

	// Unmarshal recorre el JSON por reflexión y rellena/CREA los maps y
	// slices que hagan falta dentro de a.config.
	return json.Unmarshal(data, &a.config)
}

// pollLoop hace polling al PLC cada pollIntervalMs y emite un evento con el
// nuevo snapshot. Así el frontend siempre ve valores frescos sin tener que
// preguntar: el backend es el único que habla con el PLC.
//
// CORUTINAS Y CANALES (la pareja concurrencia de Go):
//   - time.NewTicker(d) crea un "metrónomo" que envía struct{} (estructura
//     vacía = "un tic, sin datos") por su CANAL C cada periodo. Un canal es
//     una cola segura para comunicar goroutines: quien recibe bloquea hasta
//     que hay dato.
//   - `<-ticker.C` es una RECEPCIÓN DE CANAL: suspende esta goroutine hasta
//     el siguiente tic. `for { poll; <-C }` = bucle periódico sin timers
//     manuales y sin drift (mejor que time.Sleep, que acumula retraso).
//   - `defer ticker.Stop()` registra la llamada para ejecutarla al SALIR de
//     la función (los defers corren en LIFO y sus argumentos se evalúan ya).
//     Aquí el for{} no sale nunca, pero se deja por higiene: si algún día se
//     añade condición de salida, el ticker no queda fugado. Dato curioso: los
//     tickers NO se cierran con close() (solo Stop); close es para canales
//     que uno produce.
//   - time.Duration es int64 en nanosegundos: la conversión explícita
//     `time.Duration(interval) * time.Millisecond` evita ambiguidades de
//     unidades (Go no tiene tipos "cantidad con unidad" mágicos).
func (a *App) pollLoop() {
	interval := a.config.Plc.PollIntervalMs
	if interval <= 0 {
		interval = 500 // default defensivo si el JSON no trae pollIntervalMs
	}
	ticker := time.NewTicker(time.Duration(interval) * time.Millisecond)
	defer ticker.Stop()

	for {
		a.pollOnce() // lectura inmediata al arrancar (sin esperar el 1er tic)
		<-ticker.C   // bloquea hasta el siguiente tic
	}
}

// pollOnce lee todas las tags y publica el snapshot. Secuencia de
// concurrencia, en orden:
//
//  1. La llamada HTTP ocurre FUERA del mutex: puede tardar hasta el timeout
//     de 2 s; retener la cerradura mientras tanto dejaría colgados a
//     GetSnapshot/WriteTag (y los llamadores JS).
//  2. Lock ... Unlock = sección crítica corta: únicamente donde se MUTA el
//     estado compartido. Ojo: no basta con que el mutex esté en la struct;
//     TODOS los accesos deben pasar por él (por eso GetSnapshot usa RLock).
//  3. `snap := a.snapshot` copia la struct Snapshot (barato) — pero el mapa
//     Values queda compartido (ver comentario del tipo Snapshot).
//  4. El EventsEmit va FUERA del mutex: serializa JSON y habla con la
//     webview; hacerlo con la cerradura puesta ralentizaría todo el backend.
//     Regla práctica: "mantén la cerradura el menor tiempo posible".
//  5. `if a.ctx != nil` — comprobación de NIL: antes de startup el puntero no
//     apunta a nada; Go te deja escribir la línea, pero runtime.EventsEmit haría
//     panic al dereferenciar un ctx nulo.
//  6. `err.Error()` — método de la interface error: convierte el error en
//     string para guardarlo en el snapshot y mostrarlo en el HMI.
func (a *App) pollOnce() {
	values, ts, err := a.plc.readAll()
	// VARIOS RETORNOS (resultado, error): el estilo de Go en vez de excepciones.
	// err == nil => éxito; si no, values/ts son los valores cero (nil, 0).

	a.mu.Lock()
	if err != nil {
		a.snapshot.Connected = false
		a.snapshot.Error = err.Error()
	} else {
		a.snapshot.Connected = true
		a.snapshot.Error = ""
		a.snapshot.Values = values // cambiamos la referencia al mapa nuevo
		a.snapshot.Ts = ts
	}
	snap := a.snapshot
	a.mu.Unlock() // aquí preferible a defer: el bloque es lineal y corto

	if a.ctx != nil {
		// Emite el evento "plc:update" hacia la webview; el frontend lo
		// escucha con EventsOn("plc:update", cb). El payload viaja serializado.
		runtime.EventsEmit(a.ctx, "plc:update", snap)
	}
}

// GetMachines devuelve el mapa HMI (máquinas + tags + metadatos). Es estático:
// se carga del JSON de configuración.
//
// EXPORTACIÓN HACIA JAVASCRIPT: Wails "ate" (bind) los métodos EXPORTADOS
// (inician con mayúscula) de la struct en Bind (ver main.go). En la webview
// se invocan así, devolviendo una Promise:
//
//	go.main.App.GetMachines()  ->  Promise<HMIConfig>
//
// Los campos en minúscula (ctx, config, mu...) no son accesibles desde JS:
// el encapsulamiento de Go es la capa de seguridad de esta API.
func (a *App) GetMachines() HMIConfig {
	return a.config // copia barata de la struct (los slices siguen compartidos)
}

// GetSnapshot devuelve el último estado conocido del PLC.
//
// RLock/RUnlock: LEER también exige cerradura. Otra goroutine podría estar
// reemplazando snapshot.mValues justo entonces; leer a medias es una DATA
// RACE (Go la detecta con `go test -race` / `go run -race`). RLock permite
// varias lecturas simultáneas, pero ninguna convive con un Lock() en curso.
//
// TRUCO `defer`: registra RUnlock() para que se ejecute al salir de la
// función, pase lo que pase (return intermedio, panic...). Se coloca EN LA
// PRIMERA línea tras el Lock para que sea imposible olvidar liberar. Los
// defers se ejecutan en orden LIFO y sus argumentos se evalúan en el momento
// del defer (aquí no hay argumentos con valor, solo el receptor).
func (a *App) GetSnapshot() Snapshot {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.snapshot // devuelve una COPIA de la struct (el mapa, compartido)
}

// WriteTag escribe un valor en una dirección del PLC.
// Valida contra el mapa: la tag debe existir y ser editable (rw).
//
// FIRMA `(Snapshot, error)`: dos retornos; en Go el error es el "return" de
// manejo de fallos (no hay try/catch). Convención estricta: comprobar err
// ANTES de usar el valor, y devolver siempre algo útil en el error — aquí,
// a.GetSnapshot(), para que el frontend reciba un snapshot coherente aunque
// la escritura falle.
//
// Notas de sintaxis dentro:
//   - `tag, machine, err := ...` := declara las TRES variables a la vez
//     (si alguna existiera, := exige que al menos una sea nueva).
//   - `fmt.Errorf("... %q (%s)", ...)`: %q = string entrecomillado y
//     escapado; %s = string plano.
//   - `fmt.Errorf("PLC rechazó la escritura: %w", err)`: %w es el "error
//     wrapping": envuelve el error original para que errors.Is/As puedan
//     recorrer la cadena de causas, mientras el mensaje queda legible.
func (a *App) WriteTag(address string, value any) (Snapshot, error) {
	tag, machine, err := a.findTag(address)
	if err != nil {
		return a.GetSnapshot(), err
	}

	if tag.Access != AccessReadWrite {
		return a.GetSnapshot(), fmt.Errorf("la tag %q (%s) es de solo lectura", tag.Label, address)
	}

	coerced, err := coerceValue(tag, value)
	if err != nil {
		return a.GetSnapshot(), err
	}

	stored, err := a.plc.writeTag(address, coerced)
	if err != nil {
		return a.GetSnapshot(), fmt.Errorf("PLC rechazó la escritura: %w", err)
	}

	// ACTUALIZACIÓN OPTIMISTA de la caché local: en vez de esperar al
	// siguiente ciclo de polling, guardamos el valor que devolvió el PLC y
	// emitimos ya el snapshot — la UI responde "en el mismo frame".
	a.mu.Lock()
	if a.snapshot.Values == nil {
		// MAP nil: LEER de un mapa sin inicializar está permitido (devuelve el
		// valor cero), pero ESCRIBIR en él PANICHA. Siempre se comprueba o se
		// inicializa al arrancar (startup ya pone map[string]any{}).
		a.snapshot.Values = map[string]any{}
	}
	a.snapshot.Values[address] = stored
	a.snapshot.Connected = true
	a.snapshot.Error = ""
	snap := a.snapshot
	a.mu.Unlock()

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "plc:update", snap)
	}
	// %s = string, %v = "cualquier cosa" (aquí el valor dinámico stored).
	// `nil` como segundo retorno = "sin error" (la interface error nula).
	fmt.Printf("[write] %s / %s -> %v\n", machine.Name, tag.Label, stored)
	return snap, nil
}

// findTag recorre el mapa HMI en busca de una dirección. Patrones:
//   - `for _, m := range slice` recorre un slice; `_` descarta el índice (si
//     hiciera falta, sería `for i, m := range`).
//   - En el caso de error se devuelven los VALORES CERO (TagDef{}, Machine{}):
//     Go exige retornar algo siempre; el error indica al llamador que ignore
//     el resto. TagDef{} es el literal vacío de la struct (campos a sus
//     valores por defecto: "", nil, 0).
func (a *App) findTag(address string) (TagDef, Machine, error) {
	for _, m := range a.config.Machines {
		for _, t := range m.Tags {
			if t.Address == address {
				return t, m, nil
			}
		}
	}
	return TagDef{}, Machine{}, fmt.Errorf("dirección %q no está en el mapa HMI", address)
}

// coerceValue valida y convierte según el tipo de dato del mapa, aplicando
// los mismos límites que define el PanelView para cada tag.
//
// SINTAXIS DE GO QUE APARECE AQUÍ:
//   - `switch tag.DataType { case "bool": ... }` — switch sobre strings.
//     Go NO hace fall-through implícito (cada case "cae" solo) y no necesita
//     `break` al final.
//   - TYPE ASSERTION con "comma-ok": `b, ok := value.(bool)` extrae el valor
//     concreto que esconde una interface. ok=false si el tipo no coincide
//     (b queda en su cero). La forma corta `value.(bool)` SIN ok PANICARÍA
//     si el tipo no es el esperado: úsese solo si el tipo está garantizado.
//   - `value.(int)` — los llamadores Go pueden mandar enteros literales
//     (el JSON, en cambio, siempre da float64: por eso el if anidado).
//   - `float64(int32(f + 0.5))` — redondeo "a pelo": sumar 0.5 y truncar la
//     parte decimal redondea hacia arriba en positivos (con negativos este
//     truco simplificado no funciona bien; aquí los rangos del mapa son >=0).
//   - `*tag.Min` / `*tag.Max` — desreferenciar los punteros opcionales, solo
//     después de comprobar `tag.Min != nil` (dereferenciar nil = panic).
//   - `default:` deja pasar sin validar los tipos no contemplados (strings).
func coerceValue(tag TagDef, value any) (any, error) {
	switch tag.DataType {
	case "bool":
		b, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("se esperaba un booleano para %q", tag.Label)
		}
		return b, nil
	case "int16", "int32":
		f, ok := value.(float64) // JSON numérico llega como float64
		if !ok {
			if i, isInt := value.(int); isInt {
				f = float64(i)
			} else {
				return nil, fmt.Errorf("se esperaba un entero para %q", tag.Label)
			}
		}
		n := float64(int32(f + 0.5))
		if tag.Min != nil && n < *tag.Min {
			return nil, fmt.Errorf("valor %v menor que el mínimo %v (%s)", n, *tag.Min, tag.Label)
		}
		if tag.Max != nil && n > *tag.Max {
			return nil, fmt.Errorf("valor %v mayor que el máximo %v (%s)", n, *tag.Max, tag.Label)
		}
		return n, nil
	case "float32", "float64":
		f, ok := value.(float64)
		if !ok {
			return nil, fmt.Errorf("se esperaba un número para %q", tag.Label)
		}
		if tag.Min != nil && f < *tag.Min {
			return nil, fmt.Errorf("valor %v menor que el mínimo %v (%s)", f, *tag.Min, tag.Label)
		}
		if tag.Max != nil && f > *tag.Max {
			return nil, fmt.Errorf("valor %v mayor que el máximo %v (%s)", f, *tag.Max, tag.Label)
		}
		return f, nil
	default:
		return value, nil
	}
}

// Greet mantiene el método de ejemplo de la plantilla.
// Sprintf = "string printf": formatea y devuelve un string NUEVO (en lugar de
// imprimir). %s = argumento como string.
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
