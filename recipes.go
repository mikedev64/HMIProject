package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Recipe struct {
	Name    string         `json:"name"`
	Values  map[string]any `json:"values"`
	Updated int64          `json:"updated,omitempty"`
}

const maxRecipes = 50

var recipesDir = "hmi-config/recipes"

func recipesPath(machineID string) string {
	return filepath.Join(recipesDir, machineID+".json")
}

func (a *App) requireOperator() error {
	a.mu.RLock()
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

func readRecipes(machineID string) ([]Recipe, error) {
	raw, err := os.ReadFile(filepath.Clean(recipesPath(machineID)))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Recipe{}, nil
		}
		return nil, err
	}
	var list []Recipe
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("recetas inválidas: %w", err)
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
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (a *App) GetRecipes(machineID string) ([]Recipe, error) {
	if !validID(machineID) {
		return nil, fmt.Errorf("id de máquina no válido: %s", machineID)
	}
	return readRecipes(machineID)
}

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
	for addr, v := range recipe.Values {
		tag, found := findTagInMachine(machine, addr)
		if !found {
			return nil, fmt.Errorf("la tag %q no existe en %s", addr, machineID)
		}
		if tag.Access != AccessReadWrite {
			return nil, fmt.Errorf("la tag %q (%s) es de solo lectura", tag.Label, addr)
		}
		if _, err := coerceValue(tag, v); err != nil {
			return nil, fmt.Errorf("valor de la receta para %q: %w", addr, err)
		}
	}

	recipe.Updated = time.Now().UnixMilli()
	list, err := readRecipes(machineID)
	if err != nil {
		return nil, err
	}

	replaced := false
	for i := range list {
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
	out := make([]Recipe, 0, len(list))
	removed := false
	for _, r := range list {
		if strings.EqualFold(r.Name, name) {
			removed = true
			continue
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
