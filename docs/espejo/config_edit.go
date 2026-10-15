//go:build ignore

// ============================================================================
// ESPEJO COMENTADO DE config_edit.go  (código idéntico al de la raíz del repo)
// Etiqueta //go:build ignore => Go lo excluye del build: documentación viva.
// ============================================================================
package main

/*
Editor de configuración por máquina (solo admin).

Permite guardar hmi-config/machines/<id>.json desde la propia aplicación con
validación previa: los ERRORES bloquean el guardado (JSON roto, direcciones
duplicadas, controles que apuntan a tags inexistentes…) y los AVISOS no
(espacios por defecto, tags de estado ausentes…). Al guardar se recarga la
configuración en caliente y el HMI pinta los cambios sin reiniciar.

TRUCOS DE SINTAXIS QUE APARECEN AQUÍ:
  - regexp.MustCompile: regex compilada en una VARIABLE GLOBAL (se compila una
    vez al cargar el paquete; MustCompile panicaría si el patrón es inválido,
    lo que es correcto: un patrón malo es un error de programación).
  - map[string]bool como CONJUNTO: en Go no hay sets; un mapa a `bool` donde
    el valor es `true` cumple ese rol (búsqueda O(1) con coma-ok).
  - CIERRES (closures): la función `checkStatus` captura `res` y `m` del
    ámbito exterior y se llama como una función normal.
  - Punteros a optional: `*float64` para min/max ausentes (nil = sin límite).
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// ValidateResult es el informe de validación que ve el editor.
type ValidateResult struct {
	Errors   []string `json:"errors"`   // bloquean el guardado
	Warnings []string `json:"warnings"` // solo informativos
	Saved    bool     `json:"saved"`    // ¿se escribió el fichero?
}

// idPattern evita path traversal en los identificadores de máquina/receta.
// `regexp.MustCompile` se ejecuta al cargar el paquete y guarda el resultado:
// no se re-compila en cada llamada.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// CONJUNTOS como map[string]bool: presencia = clave; el valor true solo
// documenta que la clave «está». Se comprueba con coma-ok: `knownDataType[t]`.
var (
	knownBlockTypes  = map[string]bool{"groups": true, "sections": true, "process": true, "trend": true, "alarms": true, "recipes": true}
	knownControlKind = map[string]bool{"switch": true, "number": true, "display": true, "button": true, "pad": true, "lamp": true}
	knownDataType    = map[string]bool{"bool": true, "int16": true, "int32": true, "float32": true, "string": true}
	knownLevel       = map[string]bool{LevelViewer: true, LevelOperator: true, LevelAdmin: true}
)

// validID comprueba que el id sea seguro como nombre de fichero.
// `&&` cortocircuita: si `id == ""` ya no evalúa el regex.
func validID(id string) bool {
	return id != "" && idPattern.MatchString(id) && !strings.Contains(id, "..")
}

// findTagInMachine resuelve un control por nombre o por dirección.
// Devuelve (valor, bool) con coma-ok: el segundo retorno indica si existía.
// Si no existiera, el cero de TagDef sería un tag falso, así que el bool
// evita usar un valor inválido.
func findTagInMachine(m Machine, key string) (TagDef, bool) {
	for _, t := range m.Tags {
		if t.Name == key || t.Address == key {
			return t, true
		}
	}
	return TagDef{}, false
}

// validateMachine parsea y valida el JSON de una máquina.
// Devuelve errores (bloquean) y avisos (informativos).
func validateMachine(id string, raw []byte) (Machine, ValidateResult) {
	res := ValidateResult{}
	var m Machine

	// `&m` pasa la DIRECCIÓN para que Unmarshal escriba en nuestra variable.
	if err := json.Unmarshal(raw, &m); err != nil {
		res.Errors = append(res.Errors, "JSON inválido: "+err.Error())
		return m, res // m queda a cero: no confiable
	}

	// Identidad y mapa base.
	if m.ID == "" {
		m.ID = id
		res.Warnings = append(res.Warnings, "falta \"id\": se usará "+id)
	} else if m.ID != id {
		res.Errors = append(res.Errors, fmt.Sprintf("el id %q no coincide con el fichero (%s.json)", m.ID, id))
	}
	if strings.TrimSpace(m.Name) == "" {
		res.Errors = append(res.Errors, "falta \"name\" (nombre visible de la máquina)")
	}
	if m.Size.Width <= 0 || m.Size.Height <= 0 {
		res.Errors = append(res.Errors, "size.width/height deben ser mayores que 0 (si no, la máquina no se dibuja)")
	}
	if m.Image == "" {
		res.Warnings = append(res.Warnings, "sin \"image\": se dibujará sin sprite")
	}

	// Tags: esenciales y sin direcciones repetidas.
	if len(m.Tags) == 0 {
		res.Errors = append(res.Errors, "la máquina no define tags")
	}
	seen := map[string]string{} // dirección -> nombre (para detectar duplicados)
	for i, t := range m.Tags {
		where := fmt.Sprintf("tags[%d]", i)
		if strings.TrimSpace(t.Address) == "" {
			res.Errors = append(res.Errors, where+": sin \"address\"")
			continue
		}
		if prev, dup := seen[t.Address]; dup {
			res.Errors = append(res.Errors, fmt.Sprintf("dirección %s duplicada (%s y %s)", t.Address, prev, t.Name))
		}
		seen[t.Address] = t.Name
		if strings.TrimSpace(t.Label) == "" {
			res.Warnings = append(res.Warnings, fmt.Sprintf("%s (%s): sin \"label\"", where, t.Address))
		}
		if !knownDataType[t.DataType] {
			res.Errors = append(res.Errors, fmt.Sprintf("%s (%s): dataType %q desconocido", where, t.Address, t.DataType))
		}
		if t.Access != AccessReadOnly && t.Access != AccessReadWrite {
			res.Errors = append(res.Errors, fmt.Sprintf("%s (%s): access %q debe ser ro|rw", where, t.Address, t.Access))
		}
		// Opcionales *float64: nil = sin límite (solo tiene sentido en
		// tipos numéricos).
		if t.DataType != "bool" && (t.Min == nil || t.Max == nil) {
			res.Warnings = append(res.Warnings, fmt.Sprintf("%s (%s): sin min/max (gauge y pad no tendrán rango)", where, t.Address))
		}
	}

	// Tags de estado (canvas, alarmas, banner). CIERRE que captura `res` y
	// `seen` del ámbito de validateMachine.
	checkStatus := func(role, addr string, required bool) {
		if addr == "" {
			if required {
				res.Warnings = append(res.Warnings, "statusTags."+role+": sin definir")
			}
			return
		}
		if _, ok := seen[addr]; !ok {
			res.Errors = append(res.Errors, "statusTags."+role+" apunta a "+addr+" que no existe en tags")
		}
	}
	checkStatus("run", m.StatusTags.Run, false)
	checkStatus("alarm", m.StatusTags.Alarm, true)
	checkStatus("ack", m.StatusTags.Ack, false)
	if m.StatusTags.Ack == "" {
		res.Warnings = append(res.Warnings, "sin statusTags.ack: «Reconocer» del banner solo actuará en el HMI")
	}

	// Interfaz (faceplates parametrizados). `m.HMI == nil` detecta el puntero
	// opcional sin inicializar.
	if m.HMI == nil || len(m.HMI.Tabs) == 0 {
		res.Warnings = append(res.Warnings, "sin bloque \"hmi\": se usarán las pestañas por defecto")
		return m, res
	}

	// Bucles anidados con `range` sobre slices de structs.
	for ti, tab := range m.HMI.Tabs {
		tabWhere := fmt.Sprintf("hmi.tabs[%d]", ti)
		if strings.TrimSpace(tab.ID) == "" {
			res.Errors = append(res.Errors, tabWhere+": sin \"id\"")
		}
		if strings.TrimSpace(tab.Title) == "" {
			res.Errors = append(res.Errors, tabWhere+": sin \"title\"")
		}
		if len(tab.Blocks) == 0 {
			res.Warnings = append(res.Warnings, tabWhere+": sin bloques (pestaña vacía)")
		}
		for bi, block := range tab.Blocks {
			bWhere := fmt.Sprintf("%s.blocks[%d]", tabWhere, bi)
			if !knownBlockTypes[block.Type] {
				res.Errors = append(res.Errors, bWhere+": tipo de bloque "+fmt.Sprintf("%q", block.Type)+" desconocido")
				continue
			}
			if block.Type == "sections" && len(block.Sections) == 0 {
				res.Warnings = append(res.Warnings, bWhere+": bloque sections sin secciones")
			}
			for si, section := range block.Sections {
				sWhere := fmt.Sprintf("%s.sections[%d]", bWhere, si)
				if len(section.Items) == 0 {
					res.Warnings = append(res.Warnings, sWhere+": sin items")
				}
				for ii, ctrl := range section.Items {
					// `&res`: pasamos el puntero para que validateControl
					// ACUMULE errores/avisos en el mismo resultado.
					validateControl(&res, m, ctrl, fmt.Sprintf("%s.items[%d]", sWhere, ii))
				}
			}
		}
	}
	return m, res
}

// validateControl comprueba un control del faceplate (tags, acciones, nivel).
// El primer parámetro es un PUNTERO al resultado: la función muta el struct
// del llamante (patrón «append result» sin devolver nada).
func validateControl(res *ValidateResult, m Machine, ctrl ControlDef, where string) {
	if !knownControlKind[ctrl.Kind] {
		res.Errors = append(res.Errors, where+": control "+fmt.Sprintf("%q", ctrl.Kind)+" desconocido (switch|number|display|button|pad|lamp)")
		return
	}
	if ctrl.MinLevel != "" && !knownLevel[ctrl.MinLevel] {
		res.Errors = append(res.Errors, where+": minLevel "+fmt.Sprintf("%q", ctrl.MinLevel)+" desconocido (viewer|operator|admin)")
	}
	// Un control de escritura con minLevel viewer no es usable: WriteTag
	// exige siempre operator como mínimo.
	if ctrl.MinLevel == LevelViewer {
		writes := ctrl.Kind == "button"
		if !writes {
			if t, ok := findTagInMachine(m, ctrl.Tag); ok {
				writes = t.Access == AccessReadWrite && (ctrl.Kind == "switch" || ctrl.Kind == "number" || ctrl.Kind == "pad")
			}
		}
		if writes {
			res.Errors = append(res.Errors, where+": minLevel "+fmt.Sprintf("%q", LevelViewer)+" no admite controles de escritura (mínimo operator)")
		}
	}

	needsTag := ctrl.Kind != "button"
	if needsTag {
		if ctrl.Tag == "" {
			res.Errors = append(res.Errors, where+": sin \"tag\"")
		} else if _, ok := findTagInMachine(m, ctrl.Tag); !ok {
			res.Errors = append(res.Errors, where+": la tag "+fmt.Sprintf("%q", ctrl.Tag)+" no existe en esta máquina")
		}
	}
	if ctrl.Kind == "button" {
		if ctrl.Write == nil { // puntero opcional: nil = sin acción
			res.Errors = append(res.Errors, where+": botón sin \"write\"")
			return
		}
		if _, ok := findTagInMachine(m, ctrl.Write.Tag); !ok {
			res.Errors = append(res.Errors, where+": write.tag "+fmt.Sprintf("%q", ctrl.Write.Tag)+" no existe en esta máquina")
		}
	}
}

// SaveMachineConfig valida y guarda hmi-config/machines/<id>.json (solo admin),
// recarga la configuración en caliente y lo deja en la auditoría.
// Los errores de validación NO escriben el fichero (Saved=false).
func (a *App) SaveMachineConfig(id, raw string) (ValidateResult, error) {
	if err := a.requireAdmin(); err != nil {
		return ValidateResult{}, err
	}
	if !validID(id) {
		return ValidateResult{Errors: []string{"id de máquina no válido: " + id}}, nil
	}

	_, res := validateMachine(id, []byte(raw))
	if len(res.Errors) > 0 {
		// errors.New crea un error desde un string; se usa para dejar rastro
		// en la auditoría sin devolverlo como error de la operación.
		a.auditWrite("configuración", "guardado rechazado: "+id, "hmi-config/machines/"+id+".json", "", "", errors.New(strings.Join(res.Errors, "; ")))
		return res, nil
	}

	// Reindentamos lo guardado (el editor puede mandar texto sin formato).
	var pretty json.RawMessage // conserva el JSON crudo sin reinterpretable
	if err := json.Unmarshal([]byte(raw), &pretty); err != nil {
		return ValidateResult{Errors: []string{"JSON inválido: " + err.Error()}}, nil
	}
	out, err := json.MarshalIndent(pretty, "", "  ")
	if err != nil {
		return ValidateResult{}, err
	}

	path := filepath.Join("hmi-config", "machines", id+".json")
	tmp := path + ".tmp"
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return ValidateResult{}, err
	}
	// ESCRITURA ATÓMICA: escribimos a un temporal y luego RENAME (atómico en
	// el mismo SO). Así nunca queda un fichero a medio escribir.
	if err := os.WriteFile(tmp, append(out, '\n'), 0o644); err != nil {
		return ValidateResult{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return ValidateResult{}, err
	}

	// Recarga en caliente: GetMachines devolverá la nueva configuración.
	if err := a.loadConfig(); err != nil {
		res.Saved = true
		res.Errors = append(res.Errors, "guardado, pero no pude recargar la configuración: "+err.Error())
		return res, nil
	}

	res.Saved = true
	a.auditWrite("configuración", "máquina: "+id, "hmi-config/machines/"+id+".json", "", "", nil)
	fmt.Printf("[config] máquina %s guardada y recargada (%d avisos)\n", id, len(res.Warnings))
	return res, nil
}
