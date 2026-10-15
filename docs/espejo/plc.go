//go:build ignore

// ============================================================================
// ESPEJO COMENTADO DE plc.go  (código idéntico al de la raíz del repo)
// Etiqueta //go:build ignore => Go lo excluye del build: documentación viva.
//
// NOTA: este fichero refleja el plc.go ACTUAL, tras el cambio de
// comunicación a EtherNet/IP. El cliente HTTP antiguo desapareció: la capa de
// datos con el PLC es una sesión EIP (ver eip.go para el protocolo).
// ============================================================================
package main

/*
Cliente del PLC: una sesión EtherNet/IP (CIP), como la de un PanelView.

Antes el HMI hacía polling HTTP de /tags. Ahora la comunicación imita la de
un terminal Allen-Bradley con un PLC ControlLogix:

  - Al arrancar (y tras cada caída): RegisterSession + Forward Open
    (negociando el RPI) contra el puerto EtherNet/IP del PLC.
  - El PLC PRODUCE paquetes implícitos (SendUnitData T->O) cada RPI con el
    assembly de tags; el cliente solo los consume y detecta huecos de
    secuencia. Ya no hay polling: el dato «llega» como en un HMI real.
  - Las escrituras son servicios EXPLÍCITOS (Write Tag 0x4D) con espera de
    respuesta, direccionando la tag por su símbolo.

TRUCOS DE SINTAXIS QUE APARECEN AQUÍ:
  - `strings.TrimPrefix` en cadena: va quitando prefijos hasta dejar solo
    host:puerto, sea cual sea la forma del endpoint configurado.
  - Un MUTEX propio del cliente (`p.mu`) protege `eip` y `layout`: la
    reconexión puede ocurrir desde la goroutine de polling mientras la UI
    escribe, así que el puntero al cliente y el layout se leen bajo lock.
  - Copia defensiva del mapa de valores: `readAll` clona el mapa para que el
    snapshot no comparta memoria con el cliente (evita datos corruptos si el
    cliente sigue escribiendo mientras la UI lee).
*/

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// plcClient es la sesión EIP con el PLC. Envuelve eipClient con la lógica
// de reconexión que necesita el HMI (reintento con backoff y estado para la
// UI). El layout del assembly se inyecta desde el mapa HMI (app.go).
type plcClient struct {
	endpoint string // host:puerto EIP (por ejemplo 127.0.0.1:44818)

	mu     sync.Mutex // protege eip y layout
	eip    *eipClient
	layout []eipTagSlot
	pollMs int
}

// newPlcClient crea el cliente a partir del endpoint EIP del PLC
// (acepta "eip://host:puerto", "host:puerto" o una URL HTTP antigua y extrae
// host:puerto del último segmento).
//
// Nota: devuelve SIEMPRE un puntero (*plcClient): la struct se crea en el
// heap y se comparte entre goroutines, así que no debe copiarse.
func newPlcClient(endpoint string, pollMs int) *plcClient {
	// Varios TrimPrefix encadenados: limpia el esquema y la ruta si las hay.
	addr := strings.TrimPrefix(endpoint, "eip://")
	addr = strings.TrimPrefix(addr, "http://")
	addr = strings.TrimPrefix(addr, "https://")
	if i := strings.Index(addr, "/"); i >= 0 {
		addr = addr[:i] // corta en la primera "/"
	}
	if addr == "" {
		addr = "127.0.0.1:44818" // puerto EtherNet/IP estándar
	}
	return &plcClient{endpoint: addr, pollMs: pollMs}
}

// setLayout fija el orden y los tipos del assembly (se llama al cargar o
// recargar el mapa HMI). Si cambia, la conexión se rehace para que origen y
// destino vuelvan a estar de acuerdo sobre el cable, como en un PanelView
// que reimporta el proyecto.
//
// PATRÓN: invalidación por cierre. Al cambiar el layout cerramos la sesión
// vieja (p.ej. Forward Close) y ponemos `eip = nil`; el siguiente ciclo de
// polling la reabrirá con el nuevo layout.
func (p *plcClient) setLayout(slots []eipTagSlot) {
	p.mu.Lock()
	p.layout = slots
	if p.eip != nil {
		p.eip.close()
		p.eip = nil
	}
	p.mu.Unlock()
}

// ensureConnection garantiza sesión EIP + Forward Open. Devuelve true si la
// conexión está viva; el llamante aplica backoff cuando devuelve false.
//
// DOBLE COMPROBACIÓN bajo lock: se lee `p.eip` (bajo lock), y si ya está
// conectado se devuelve sin reconectar. Si no, se crea el cliente una sola
// vez (guardia `p.eip == nil`) y se conecta FUERA del lock (la conexión TCP
// es lenta; no bloqueamos a los lectores del snapshot mientras espera).
func (p *plcClient) ensureConnection() bool {
	p.mu.Lock()
	if p.eip != nil && p.eip.info().Connected {
		p.mu.Unlock()
		return true
	}
	if p.eip == nil {
		p.eip = newEIPClient(p.endpoint, p.layout, p.pollMs)
	}
	client := p.eip
	p.mu.Unlock()

	if err := client.connect(); err != nil {
		// Reconexión fallida: limpiamos el cliente para reintentar limpio.
		p.mu.Lock()
		if p.eip == client {
			p.eip.close()
			p.eip = nil
		}
		p.mu.Unlock()
		return false
	}
	return true
}

// readAll devuelve los valores del último paquete implícito recibido (la
// «producción» del PLC) más el estado de la conexión EIP para el snapshot.
//
// TRES RETORNOS + error: estilo Go de «resultado + causa». Aquí son cuatro
// (map, ts, info, error): el mapa de valores, la marca de tiempo del último
// paquete, la info de diagnóstico EIP y el error si no hay conexión.
func (p *plcClient) readAll() (map[string]any, int64, eipConnInfo, error) {
	p.mu.Lock()
	client := p.eip
	p.mu.Unlock()
	if client == nil {
		return nil, 0, eipConnInfo{Endpoint: p.endpoint}, fmt.Errorf("sin sesión EIP con el PLC")
	}
	// Leemos el estado del cliente bajo SU mutex (no el nuestro).
	client.mu.Lock()
	values := client.values
	lastRx := client.lastRx
	client.mu.Unlock()
	info := client.info()
	if !info.Connected {
		return values, lastRx.UnixMilli(), info, fmt.Errorf("sin paquetes implícitos del PLC (¿Forward Open caducado?)")
	}
	// COPIA DEFENSIVA del mapa: el snapshot no debe compartir memoria con el
	// cliente (que sigue recibiendo paquetes en su goroutine). Sin la copia,
	// la UI podría leer un mapa a medio escribir (race).
	out := make(map[string]any, len(values))
	for k, v := range values {
		out[k] = v
	}
	return out, lastRx.UnixMilli(), info, nil
}

// writeTag escribe una tag con un Write Tag explícito (servicio CIP 0x4D) y
// devuelve el valor almacenado. El tipo viaja en la propia petición, como
// exige el protocolo CIP.
func (p *plcClient) writeTag(address string, dataType string, value any) (any, error) {
	p.mu.Lock()
	client := p.eip
	p.mu.Unlock()
	if client == nil {
		return nil, fmt.Errorf("sin sesión EIP con el PLC")
	}
	if err := client.writeTag(address, dataType, value); err != nil {
		return nil, err
	}
	// Confirmamos con un Read Tag explícito (el valor real almacenado puede
	// diferir si el PLC redondeó o recortó), como haría un HMI real.
	stored, err := client.readTag(address)
	if err != nil {
		return value, nil // la escritura se aceptó; seguimos con el valor pedido
	}
	return stored, nil
}

// close cierra la sesión EIP (Forward Close + UnregisterSession).
func (p *plcClient) close() {
	p.mu.Lock()
	if p.eip != nil {
		p.eip.close()
		p.eip = nil
	}
	p.mu.Unlock()
}

// unused guard para mantener gofmt estable si se añaden slots en el futuro.
var _ = time.Now
