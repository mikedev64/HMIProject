package main

import (
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) WriteTag(address string, value any) (Snapshot, error) {
	a.mu.RLock()
	requireLogin := a.config.Security.RequireLogin
	a.mu.RUnlock()

	if requireLogin {
		if err := a.auth.Require(LevelOperator); err != nil {
			a.auditWrite("", "", address, "", value, err)
			return a.GetSnapshot(), err
		}
	}

	tag, machine, err := a.findTag(address)
	if err != nil {
		return a.GetSnapshot(), err
	}

	if requireLogin {
		if minRank := requiredRankForTag(machine, address); levelRank(a.auth.Session().Level) < minRank {
			err := fmt.Errorf("el nivel %q no puede escribir en %q (se requiere %s)", a.auth.Session().Level, tag.Label, rankLevel(minRank))
			a.auditWrite(machine.Name, tag.Label, address, "", value, err)
			return a.GetSnapshot(), err
		}
	}

	if tag.Access != AccessReadWrite {
		err := fmt.Errorf("la tag %q (%s) es de solo lectura", tag.Label, address)
		return a.GetSnapshot(), err
	}

	coerced, err := coerceValue(tag, value)
	if err != nil {
		return a.GetSnapshot(), err
	}

	a.mu.RLock()
	oldValue := a.snapshot.Values[address]
	a.mu.RUnlock()

	stored, err := a.plc.writeTag(address, tag.DataType, coerced)
	if err != nil {
		a.auditWrite(machine.Name, tag.Label, address, oldValue, coerced, err)
		return a.GetSnapshot(), fmt.Errorf("PLC rechazó la escritura: %w", err)
	}

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
	a.auditWrite(machine.Name, tag.Label, address, oldValue, stored, nil)
	fmt.Printf("[write] %s / %s -> %v\n", machine.Name, tag.Label, stored)
	return snap, nil
}

func (a *App) findTag(address string) (TagDef, Machine, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, m := range a.config.Machines {
		for _, t := range m.Tags {
			if t.Address == address {
				return t, m, nil
			}
		}
	}
	return TagDef{}, Machine{}, fmt.Errorf("dirección %q no está en el mapa HMI", address)
}

func rankLevel(rank int) string {
	switch {
	case rank >= levelRank(LevelAdmin):
		return LevelAdmin
	case rank >= levelRank(LevelOperator):
		return LevelOperator
	default:
		return LevelViewer
	}
}

func controlWritesAddress(m Machine, c ControlDef, address string) bool {
	if c.Kind == "button" {
		if c.Write == nil {
			return false
		}
		t, ok := findTagInMachine(m, c.Write.Tag)
		return ok && t.Address == address
	}
	if c.Kind == "switch" || c.Kind == "number" || c.Kind == "pad" {
		t, ok := findTagInMachine(m, c.Tag)
		return ok && t.Address == address
	}
	return false
}

func requiredRankForTag(m Machine, address string) int {
	rank := levelRank(LevelOperator)
	if m.HMI == nil {
		return rank
	}
	for _, tab := range m.HMI.Tabs {
		for _, b := range tab.Blocks {
			for _, s := range b.Sections {
				for _, c := range s.Items {
					if !controlWritesAddress(m, c, address) {
						continue
					}
					if r := levelRank(c.MinLevel); r > rank {
						rank = r
					}
				}
			}
		}
	}
	return rank
}

func coerceValue(tag TagDef, value any) (any, error) {
	switch tag.DataType {
	case "bool":
		b, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("se esperaba un booleano para %q", tag.Label)
		}
		return b, nil
	case "int16", "int32":
		f, ok := value.(float64)
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
