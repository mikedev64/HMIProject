package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx    context.Context
	config HMIConfig
	auth   *authService
	plc    *plcClient
	audit  *auditLog

	mu       sync.RWMutex
	snapshot Snapshot
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	if err := a.loadConfig(); err != nil {
		fmt.Printf("Error cargando mapa HMI: %v\n", err)
		return
	}

	if a.auth == nil {
		if err := a.initAuth(); err != nil {
			fmt.Printf("Error cargando usuarios: %v\n", err)
		}
	}

	if a.audit == nil {
		a.audit = &auditLog{path: auditFilePath}
		a.audit.load()
	}

	a.plc = newPlcClient(a.config.Plc.Endpoint, a.config.Plc.PollIntervalMs)
	a.plc.setLayout(assemblyLayout(a.config))
	a.snapshot = Snapshot{
		Connected: false,
		Values:    map[string]any{},
	}

	go a.pollLoop()
}

func (a *App) pollLoop() {
	base := a.config.Plc.PollIntervalMs
	if base <= 0 {
		base = 500
	}
	const maxBackoffMs = 5000

	failures := 0
	for {
		if a.pollOnce() {
			failures = 0
		} else if failures < 4 {
			failures++
		}

		delay := base
		if failures > 0 {
			delay = base
			for i := 1; i < failures; i++ {
				delay *= 2
			}
			if delay > maxBackoffMs {
				delay = maxBackoffMs
			}
		}
		time.Sleep(time.Duration(delay) * time.Millisecond)
	}
}

func (a *App) pollOnce() bool {
	if !a.plc.ensureConnection() {
		a.mu.Lock()
		a.snapshot.Connected = false
		a.snapshot.Error = "sin sesión EtherNet/IP con el PLC (¿está el simulador en marcha?)"
		snap := a.snapshot
		a.mu.Unlock()
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "plc:update", snap)
		}
		return false
	}

	values, ts, eip, err := a.plc.readAll()

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
	info := eip
	a.snapshot.EIP = info.toMap()
	snap := a.snapshot
	a.mu.Unlock()

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "plc:update", snap)
	}
	return err == nil
}

func (a *App) GetMachines() HMIConfig {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.config
}

func (a *App) GetSnapshot() Snapshot {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.snapshot
}
