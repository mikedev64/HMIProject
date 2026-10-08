package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

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

type Access string

const (
	AccessReadOnly  Access = "ro"
	AccessReadWrite Access = "rw"
)

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
	Default  any      `json:"default,omitempty"`
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
type Snapshot struct {
	Connected bool           `json:"connected"`
	Error     string         `json:"error,omitempty"`
	Ts        int64          `json:"ts"`
	Values    map[string]any `json:"values"`
}

// App struct
type App struct {
	ctx    context.Context
	config HMIConfig
	plc    *plcClient

	mu       sync.RWMutex
	snapshot Snapshot
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	if err := a.loadConfig(); err != nil {
		fmt.Printf("Error cargando mapa HMI: %v\n", err)
		return
	}

	a.plc = newPlcClient(a.config.Plc.Endpoint)
	a.snapshot = Snapshot{
		Connected: false,
		Values:    map[string]any{},
	}

	go a.pollLoop()
}

// loadConfig lee hmi-config/machines.json; si no está en disco (app compilada
// en otra máquina) usa la copia embebida en el binario.
func (a *App) loadConfig() error {
	data := embeddedConfig

	if _, err := os.Stat("hmi-config/machines.json"); err == nil {
		if raw, err := os.ReadFile(filepath.Clean("hmi-config/machines.json")); err == nil {
			data = raw
		}
	}

	return json.Unmarshal(data, &a.config)
}

// pollLoop hace polling al PLC cada pollIntervalMs y emite un evento con el
// nuevo snapshot. Así el frontend siempre ve valores frescos sin tener que
// preguntar: el backend es el único que habla con el PLC.
func (a *App) pollLoop() {
	interval := a.config.Plc.PollIntervalMs
	if interval <= 0 {
		interval = 500
	}
	ticker := time.NewTicker(time.Duration(interval) * time.Millisecond)
	defer ticker.Stop()

	for {
		a.pollOnce()
		<-ticker.C
	}
}

func (a *App) pollOnce() {
	values, ts, err := a.plc.readAll()

	a.mu.Lock()
	if err != nil {
		a.snapshot.Connected = false
		a.snapshot.Error = err.Error()
	} else {
		a.snapshot.Connected = true
		a.snapshot.Error = ""
		a.snapshot.Values = values
		a.snapshot.Ts = ts
	}
	snap := a.snapshot
	a.mu.Unlock()

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "plc:update", snap)
	}
}

// GetMachines devuelve el mapa HMI (máquinas + tags + metadatos). Es estático:
// se carga del JSON de configuración.
func (a *App) GetMachines() HMIConfig {
	return a.config
}

// GetSnapshot devuelve el último estado conocido del PLC.
func (a *App) GetSnapshot() Snapshot {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.snapshot
}

// WriteTag escribe un valor en una dirección del PLC.
// Valida contra el mapa: la tag debe existir y ser editable (rw).
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

	// Actualizamos la caché local para que la UI responda de inmediato.
	a.mu.Lock()
	if a.snapshot.Values == nil {
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
	fmt.Printf("[write] %s / %s -> %v\n", machine.Name, tag.Label, stored)
	return snap, nil
}

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
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
