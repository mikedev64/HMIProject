//go:build ignore

// ============================================================================
// ESPEJO COMENTADO DE recipes.go  (código idéntico al de la raíz del repo)
// Etiqueta //go:build ignore => Go lo excluye del build: documentación viva.
// ============================================================================
package main

/*
Recetas por máquina (setpoints guardados).

Una receta es un nombre + un mapa dirección->valor con los setpoints de esa
máquina (temperatura, velocidad, presión…). Se guardan en
hmi-config/recipes/<machine-id>.json y se cargan en el PLC escribiendo cada
tag rw desde el frontend (con el mismo gate de nivel operator).

Solo se admiten direcciones que existan en la máquina y sean rw: una receta
nunca puede escribir en tags de solo lectura.

TRUCOS DE SINTAXIS QUE APARECEN AQUÍ:
  - `map[string]any` como JSON libre: dirección -> valor de tipo arbitrario.
  - Puntero de paquete `var recipesDir = "..."`: como es una variable GLOBAL
    mutable, los tests la redirigen a un dir temporal y la restauran con
    `defer` (patrón «seam» para testear sin tocar disco real).
  - `errors.Is(err, os.ErrNotExist)`: comprueba si un error envuelve otro
    (los errores de os envuelven ErrNotExist; `==` no funcionaría).
  - Receptores con puntero (`*App`) para mutar el estado compartido.
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Recipe es un conjunto de setpoints guardados para una máquina.
// `Values` es un mapa libre dirección->valor (JSON arbitrario).
type Recipe struct {
	Name    string         `json:"name"`
	Values  map[string]any `json:"values"`            // dirección -> valor
	Updated int64          `json:"updated,omitempty"` // omitempty: se omite si es 0
}

const maxRecipes = 50

// recipesDir es variable para poder testear con un directorio temporal.
// Al ser un `var` de paquete (no const), un test puede hacer
// `recipesDir = t.TempDir()` y `defer` restaurar el original.
var recipesDir = "hmi-config/recipes"

func recipesPath(machineID string) string {
	return filepath.Join(recipesDir, machineID+".json")
}

// requireOperator exige nivel operator si la seguridad está activada.
func (a *App) requireOperator() error {
	a.mu.RLock() // lectura concurrente: RLock no bloquea otras lecturas
	required := a.config.Security.RequireLogin
	a.mu.RUnlock()
	if !required {
		return nil
	}
	if a.auth == nil {
		return errors.New("autenticación no inicializada")
	}
	return a.auth.Require(LevelOperator)
}

// findMachine devuelve una máquina del mapa actual.
// `defer a.mu.RUnlock()` desbloquea al salir; con RLock el defer suele ir en
// la línea siguiente para que la intención sea evidente.
func (a *App) findMachine(id string) (Machine, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, m := range a.config.Machines {
		if m.ID == id {
			return m, true
		}
	}
	return Machine{}, false
}

// readRecipes carga las recetas de una máquina ([] si no existen).
func readRecipes(machineID string) ([]Recipe, error) {
	raw, err := os.ReadFile(filepath.Clean(recipesPath(machineID)))
	if err != nil {
		// errors.Is envuelve: compara con el error sentinela ErrNotExist.
		if errors.Is(err, os.ErrNotExist) {
			return []Recipe{}, nil // aún no hay recetas: lista vacía
		}
		return nil, err
	}
	var list []Recipe
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("recetas inválidas: %w", err) // %w ENCADENA el error
	}
	return list, nil
}

func writeRecipes(machineID string, list []Recipe) error {
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	path := recipesPath(machineID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// Escritura atómica: temporal + Rename (igual que el editor de config).
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// GetRecipes devuelve las recetas de una máquina.
func (a *App) GetRecipes(machineID string) ([]Recipe, error) {
	if !validID(machineID) {
		return nil, fmt.Errorf("id de máquina no válido: %s", machineID)
	}
	return readRecipes(machineID)
}

// SaveRecipe crea o reemplaza una receta de la máquina (nivel operator).
// Solo admite tags rw existentes en esa máquina.
func (a *App) SaveRecipe(machineID string, recipe Recipe) ([]Recipe, error) {
	if err := a.requireOperator(); err != nil {
		return nil, err
	}
	if !validID(machineID) {
		return nil, fmt.Errorf("id de máquina no válido: %s", machineID)
	}
	machine, ok := a.findMachine(machineID)
	if !ok {
		return nil, fmt.Errorf("la máquina %q no existe", machineID)
	}

	recipe.Name = strings.TrimSpace(recipe.Name)
	if recipe.Name == "" {
		return nil, errors.New("la receta necesita un nombre")
	}
	if len(recipe.Name) > 40 {
		return nil, errors.New("el nombre de la receta no puede superar 40 caracteres")
	}
	if len(recipe.Values) == 0 {
		return nil, errors.New("la receta no tiene valores")
	}
	// Validamos CADA tag de la receta contra el mapa de la máquina.
	for addr, v := range recipe.Values {
		// findTagInMachine resuelve por nombre O dirección (coma-ok).
		tag, found := findTagInMachine(machine, addr)
		if !found {
			return nil, fmt.Errorf("la tag %q no existe en %s", addr, machineID)
		}
		if tag.Access != AccessReadWrite {
			return nil, fmt.Errorf("la tag %q (%s) es de solo lectura", tag.Label, addr)
		}
		// coerceValue valida tipo y rango; %w encadena el error original.
		if _, err := coerceValue(tag, v); err != nil {
			return nil, fmt.Errorf("valor de la receta para %q: %w", addr, err)
		}
	}

	recipe.Updated = time.Now().UnixMilli()
	list, err := readRecipes(machineID)
	if err != nil {
		return nil, err
	}

	// ¿Reemplazar por nombre (case-insensitive) o añadir?
	replaced := false
	for i := range list { // `range` con índice para mutar in situ via &list[i]
		if strings.EqualFold(list[i].Name, recipe.Name) {
			list[i] = recipe
			replaced = true
			break
		}
	}
	if !replaced {
		if len(list) >= maxRecipes {
			return nil, fmt.Errorf("máximo de %d recetas por máquina", maxRecipes)
		}
		list = append(list, recipe)
	}

	if err := writeRecipes(machineID, list); err != nil {
		return nil, err
	}
	a.auditWrite(machine.Name, "receta: "+recipe.Name, "hmi-config/recipes/"+machineID+".json", "", fmt.Sprintf("%d tags", len(recipe.Values)), nil)
	return list, nil
}

// DeleteRecipe elimina una receta por nombre.
func (a *App) DeleteRecipe(machineID, name string) ([]Recipe, error) {
	if err := a.requireOperator(); err != nil {
		return nil, err
	}
	if !validID(machineID) {
		return nil, fmt.Errorf("id de máquina no válido: %s", machineID)
	}
	machine, ok := a.findMachine(machineID)
	if !ok {
		return nil, fmt.Errorf("la máquina %q no existe", machineID)
	}

	name = strings.TrimSpace(name)
	list, err := readRecipes(machineID)
	if err != nil {
		return nil, err
	}
	// Filtramos out la receta a borrar (patrón «filter into new slice»).
	out := make([]Recipe, 0, len(list))
	removed := false
	for _, r := range list {
		if strings.EqualFold(r.Name, name) {
			removed = true
			continue // no la copiamos a `out`
		}
		out = append(out, r)
	}
	if !removed {
		return nil, fmt.Errorf("la receta %q no existe", name)
	}
	if err := writeRecipes(machineID, out); err != nil {
		return nil, err
	}
	a.auditWrite(machine.Name, "borrar receta: "+name, "hmi-config/recipes/"+machineID+".json", name, "", nil)
	return out, nil
}
