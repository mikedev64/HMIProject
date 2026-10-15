package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"
)

//go:embed all:hmi-config
var embeddedFiles embed.FS

func (a *App) loadConfig() error {
	if info, err := os.Stat("hmi-config"); err == nil && info.IsDir() {
		cfg, err := readConfigFS(os.DirFS("hmi-config"))
		if err == nil {
			a.mu.Lock()
			a.config = cfg
			a.mu.Unlock()
			return nil
		}
		fmt.Printf("hmi-config en disco incompleto (%v), uso la copia embebida\n", err)
	}

	sub, err := fs.Sub(embeddedFiles, "hmi-config")
	if err != nil {
		return err
	}
	cfg, err := readConfigFS(sub)
	if err != nil {
		return err
	}
	a.mu.Lock()
	a.config = cfg
	a.mu.Unlock()
	if a.plc != nil {
		a.plc.setLayout(assemblyLayout(cfg))
	}
	return nil
}

func readConfigFS(fsys fs.FS) (HMIConfig, error) {
	var cfg HMIConfig

	appRaw, err := fs.ReadFile(fsys, "app.json")
	if err != nil {
		return cfg, fmt.Errorf("app.json: %w", err)
	}
	if err := json.Unmarshal(appRaw, &cfg); err != nil {
		return cfg, fmt.Errorf("app.json inválido: %w", err)
	}

	entries, err := fs.ReadDir(fsys, "machines")
	if err != nil {
		return cfg, fmt.Errorf("machines/: %w", err)
	}

	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		raw, err := fs.ReadFile(fsys, "machines/"+name)
		if err != nil {
			return cfg, err
		}
		var m Machine
		if err := json.Unmarshal(raw, &m); err != nil {
			return cfg, fmt.Errorf("machines/%s inválido: %w", name, err)
		}
		cfg.Machines = append(cfg.Machines, m)
	}

	if len(cfg.Machines) == 0 {
		return cfg, fmt.Errorf("no hay máquinas en machines/")
	}
	return cfg, nil
}

func assemblyLayout(cfg HMIConfig) []eipTagSlot {
	slots := make([]eipTagSlot, 0, 32)
	for _, m := range cfg.Machines {
		for _, t := range m.Tags {
			slots = append(slots, eipTagSlot{Address: t.Address, DataType: t.DataType, Size: cipSizeOf(t.DataType)})
		}
	}
	return slots
}
