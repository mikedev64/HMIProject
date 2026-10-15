package main

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	auditFilePath   = "hmi-config/audit.csv"
	auditMaxEntries = 1000
	auditHeader     = "fecha_hora,usuario,nivel,maquina,tag,direccion,valor_anterior,valor_nuevo,error"
)

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
		return fmt.Sprintf("%v", t)
	}
}

type auditLog struct {
	mu      sync.Mutex
	entries []AuditEntry
	path    string
	loaded  bool
}

func (l *auditLog) load() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.loaded {
		return
	}
	l.loaded = true

	f, err := os.Open(filepath.Clean(l.path))
	if err != nil {
		return
	}
	defer f.Close()

	r := csv.NewReader(f)
	rows, err := r.ReadAll()
	if err != nil || len(rows) == 0 {
		return
	}

	for i, row := range rows {
		if i == 0 && len(row) > 0 && row[0] == "fecha_hora" {
			continue
		}
		if len(row) < 8 {
			continue
		}
		ts, err := time.Parse(time.RFC3339, row[0])
		if err != nil {
			continue
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
	if len(l.entries) > auditMaxEntries {
		l.entries = l.entries[len(l.entries)-auditMaxEntries:]
	}
}

func (l *auditLog) add(e AuditEntry) {
	if e.Ts == 0 {
		e.Ts = time.Now().UnixMilli()
	}
	if e.User == "" {
		e.User = "(sin sesión)"
	}

	l.mu.Lock()

	needHeader := false
	if info, err := os.Stat(l.path); err != nil || info.Size() == 0 {
		needHeader = true
	}
	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		fmt.Printf("[audit] no puedo crear el directorio: %v\n", err)
	}
	f, err := os.OpenFile(filepath.Clean(l.path), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		w := csv.NewWriter(f)
		if needHeader {
			_ = w.Write([]string{
				"fecha_hora", "usuario", "nivel", "maquina", "tag", "direccion", "valor_anterior", "valor_nuevo", "error",
			})
		}
		_ = w.Write([]string{
			time.UnixMilli(e.Ts).Format(time.RFC3339),
			e.User, e.Level, e.Machine, e.Label, e.Address, e.Old, e.New, e.Error,
		})
		w.Flush()
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

func (l *auditLog) list(limit int) []AuditEntry {
	l.load()
	l.mu.Lock()
	defer l.mu.Unlock()
	if limit <= 0 || limit > len(l.entries) {
		limit = len(l.entries)
	}
	out := make([]AuditEntry, 0, limit)
	for i := len(l.entries) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, l.entries[i])
	}
	return out
}

func (a *App) GetAudit() []AuditEntry {
	if a.audit == nil {
		return []AuditEntry{}
	}
	return a.audit.list(200)
}

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
