//go:build ignore

// ============================================================================
// ESPEJO COMENTADO DE audit.go  (código idéntico al de la raíz del repo)
// Etiqueta //go:build ignore => Go lo excluye del build: es documentación viva
// que puedes abrir en el editor con resaltado de sintaxis de Go.
// ============================================================================
package main

/*
Registro de auditoría de escrituras al PLC (y de acciones sensibles).

TRUCO DE SINTAXIS: el bloque `/* ... *\/` ANTES de los imports es un
comentario libre; en Go los comentarios de paquete/documentación suelen ir
después de `package`, pero aquí va antes y también vale (solo es texto).

Todo lo que el HMI escribe queda registrado con quién lo hizo (sesión activa),
qué tag, valor anterior y nuevo, y cuándo. Sirve para auditar quién movió un
setpoint a las 3 de la mañana:

  - en memoria: anillo con los últimos 1000 registros (rápido para la UI),
  - en disco:   hmi-config/audit.csv en modo append (sobrevive reinicios).
*/

import (
	// encoding/csv: lector/escritor de CSV (writer con Flush).
	"encoding/csv"
	// fmt: errores y Printf de depuración.
	"fmt"
	// os: Open/OpenFile/Stat/MkdirAll (ficheros y directorios).
	"os"
	// path/filepath: Join y Dir (rutas portables entre SO).
	"path/filepath"
	// sync: el MÚTEX que protege el anillo concurrente.
	"sync"
	// time: marcas de tiempo (UnixMilli) y formato RFC3339 para el CSV.
	"time"
)

// Constantes del registro. `auditHeader` documenta las columnas (no se usa
// para escribir: la cabecera real se escribe en `add` con un literal de
// slice, para que el compilador obligue a coincidir los índices).
const (
	auditFilePath   = "hmi-config/audit.csv"
	auditMaxEntries = 1000
	auditHeader     = "fecha_hora,usuario,nivel,maquina,tag,direccion,valor_anterior,valor_nuevo,error"
)

// AuditEntry es una línea del registro de auditoría.
//
// TRUCOS DE SINTAXIS:
//   - Los TAGS `json:"..."` (etiquetas de struct) leen/escriben el nombre del
//     campo en JSON sin tocar el tipo Go. `json:"error,omitempty"` además
//     omite el campo cuando está vacío.
//   - Los campos son `string`/`int64` planos: así serializan limpio a JSON y
//     a columnas del CSV.
type AuditEntry struct {
	Ts      int64  `json:"ts"`
	User    string `json:"user"`
	Level   string `json:"level"`
	Machine string `json:"machine"`
	Label   string `json:"label"`
	Address string `json:"address"`
	Old     string `json:"old"`
	New     string `json:"new"`
	Error   string `json:"error,omitempty"`
}

// auditText convierte un valor de tag a texto para el CSV/JSON.
//
// TYPE SWITCH: `switch t := v.(type)` sobre una interfaz `any` da el valor
// CONCRETO en cada rama. `nil` es una rama válida (interfaz sin valor).
func auditText(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		// %v formatea cualquier valor con su representación por defecto.
		return fmt.Sprintf("%v", t)
	}
}

// auditLog es el anillo en memoria + la ruta del CSV. El campo `mu` es un
// MUTEX que protege `entries`: como el backend puede registrar desde varias
// goroutines (UI + polling), cada acceso a `entries` va bajo `mu.Lock()`.
type auditLog struct {
	mu      sync.Mutex
	entries []AuditEntry // más reciente al final
	path    string
	loaded  bool
}

// load carga el CSV existente (si lo hay) para no perder el histórico.
//
// PATRÓN «guardia de carga»: `loaded` evita recargar más de una vez. El
// Lock/defer Unlock al inicio protege el flag y el slice durante la carga.
func (l *auditLog) load() {
	l.mu.Lock()
	defer l.mu.Unlock() // desbloquea al SALIR, pase lo que pase
	if l.loaded {
		return
	}
	l.loaded = true

	f, err := os.Open(filepath.Clean(l.path))
	if err != nil {
		return // aún no existe: se creará al primer registro
	}
	// `defer f.Close()`: cierra el fichero al salir. Si abrimos y no hay
	// error, SIEMPRE debemos cerrar (si no, fuga de descriptores).
	defer f.Close()

	r := csv.NewReader(f)
	rows, err := r.ReadAll()
	if err != nil || len(rows) == 0 {
		return
	}
	// rows[0] es la cabecera (la comprobamos de forma laxa).
	for i, row := range rows {
		if i == 0 && len(row) > 0 && row[0] == "fecha_hora" {
			continue // salta la cabecera
		}
		if len(row) < 8 {
			continue // fila incompleta
		}
		ts, err := time.Parse(time.RFC3339, row[0])
		if err != nil {
			continue // marca de tiempo ilegible
		}
		e := AuditEntry{
			Ts:      ts.UnixMilli(),
			User:    row[1],
			Level:   row[2],
			Machine: row[3],
			Label:   row[4],
			Address: row[5],
			Old:     row[6],
			New:     row[7],
		}
		if len(row) > 8 {
			e.Error = row[8]
		}
		l.entries = append(l.entries, e)
	}
	// ANILLO: si superamos el tope, nos quedamos con los últimos N.
	// `l.entries[len- N:]` es un SLICE del array (misma memoria, vista
	// corta); Go reutiliza el backing array, es eficiente.
	if len(l.entries) > auditMaxEntries {
		l.entries = l.entries[len(l.entries)-auditMaxEntries:]
	}
}

// add registra una entrada en memoria y la appendea al CSV.
func (l *auditLog) add(e AuditEntry) {
	if e.Ts == 0 {
		e.Ts = time.Now().UnixMilli()
	}
	if e.User == "" {
		e.User = "(sin sesión)"
	}

	l.mu.Lock()
	// ¿Cabecera nueva o fichero nuevo?
	needHeader := false
	if info, err := os.Stat(l.path); err != nil || info.Size() == 0 {
		needHeader = true
	}
	// MkdirAll crea el directorio si no existe (0o755 = permisos octales:
	// el prefijo 0o marca literal octal en Go).
	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		fmt.Printf("[audit] no puedo crear el directorio: %v\n", err)
	}
	// OpenFile con O_APPEND|O_CREATE|O_WRONLY: añade al final, crea si falta,
	// solo escritura. 0o644 = permisos del fichero.
	f, err := os.OpenFile(filepath.Clean(l.path), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		w := csv.NewWriter(f)
		if needHeader {
			// Literal de slice con las columnas: el compilador comprueba la
			// forma; si cambias el CSV, ajustas aquí y ya.
			_ = w.Write([]string{
				"fecha_hora", "usuario", "nivel", "maquina", "tag", "direccion", "valor_anterior", "valor_nuevo", "error",
			})
		}
		_ = w.Write([]string{
			time.UnixMilli(e.Ts).Format(time.RFC3339),
			e.User, e.Level, e.Machine, e.Label, e.Address, e.Old, e.New, e.Error,
		})
		w.Flush() // csv.Writer bufferiza: Flush vuelca al fichero
		f.Close()
	} else {
		fmt.Printf("[audit] no puedo escribir %s: %v\n", l.path, err)
	}

	l.entries = append(l.entries, e)
	if len(l.entries) > auditMaxEntries {
		l.entries = l.entries[len(l.entries)-auditMaxEntries:]
	}
	l.mu.Unlock()
}

// list devuelve los últimos `limit` registros, del más reciente al más antiguo.
//
// Nota de concurrencia: llama a `l.load()` FUERA del Lock (load tiene su
// propio Lock interno; si lo llamáramos ya bloqueados, DEADLOCK — un mutex
// normal no es reentrante).
func (l *auditLog) list(limit int) []AuditEntry {
	l.load()
	l.mu.Lock()
	defer l.mu.Unlock()
	if limit <= 0 || limit > len(l.entries) {
		limit = len(l.entries)
	}
	out := make([]AuditEntry, 0, limit) // make con capacidad preasignada
	for i := len(l.entries) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, l.entries[i])
	}
	return out
}

// GetAudit devuelve el registro de auditoría (más reciente primero).
// Lo usa el frontend en el popover «Auditoría» del topbar.
func (a *App) GetAudit() []AuditEntry {
	if a.audit == nil {
		return []AuditEntry{} // slice vacío (no nil) para JSON: []
	}
	return a.audit.list(200)
}

// auditNow registra la sesión activa como autor de una entrada.
//
// `a.auth != nil` comprueba si el puntero a authService está inicializado: en
// Go un puntero sin inicializar es `nil`, y dereferenciarlo panicaría.
func (a *App) auditWrite(machine, label, address string, oldV, newV any, err error) {
	if a.audit == nil {
		return
	}
	user, level := "(sin sesión)", ""
	if a.auth != nil {
		if s := a.auth.Session(); s.Authenticated {
			user, level = s.Username, s.Level
		}
	}
	e := AuditEntry{
		Ts:      time.Now().UnixMilli(),
		User:    user,
		Level:   level,
		Machine: machine,
		Label:   label,
		Address: address,
		Old:     auditText(oldV),
		New:     auditText(newV),
	}
	if err != nil {
		e.Error = err.Error()
	}
	a.audit.add(e)
}
