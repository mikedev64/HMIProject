package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type ValidateResult struct {
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
	Saved    bool     `json:"saved"`
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

var (
	knownBlockTypes  = map[string]bool{"groups": true, "sections": true, "process": true, "trend": true, "alarms": true, "recipes": true}
	knownControlKind = map[string]bool{"switch": true, "number": true, "display": true, "button": true, "pad": true, "lamp": true}
	knownDataType    = map[string]bool{"bool": true, "int16": true, "int32": true, "float32": true, "string": true}
	knownLevel       = map[string]bool{LevelViewer: true, LevelOperator: true, LevelAdmin: true}
)

func validID(id string) bool {
	return id != "" && idPattern.MatchString(id) && !strings.Contains(id, "..")
}

func findTagInMachine(m Machine, key string) (TagDef, bool) {
	for _, t := range m.Tags {
		if t.Name == key || t.Address == key {
			return t, true
		}
	}
	return TagDef{}, false
}

func validateMachine(id string, raw []byte) (Machine, ValidateResult) {
	res := ValidateResult{}
	var m Machine

	if err := json.Unmarshal(raw, &m); err != nil {
		res.Errors = append(res.Errors, "JSON inválido: "+err.Error())
		return m, res
	}

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

	if len(m.Tags) == 0 {
		res.Errors = append(res.Errors, "la máquina no define tags")
	}
	seen := map[string]string{}
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
		if t.DataType != "bool" && (t.Min == nil || t.Max == nil) {
			res.Warnings = append(res.Warnings, fmt.Sprintf("%s (%s): sin min/max (gauge y pad no tendrán rango)", where, t.Address))
		}
	}

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

	if m.HMI == nil || len(m.HMI.Tabs) == 0 {
		res.Warnings = append(res.Warnings, "sin bloque \"hmi\": se usarán las pestañas por defecto")
		return m, res
	}

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
					validateControl(&res, m, ctrl, fmt.Sprintf("%s.items[%d]", sWhere, ii))
				}
			}
		}
	}
	return m, res
}

func validateControl(res *ValidateResult, m Machine, ctrl ControlDef, where string) {
	if !knownControlKind[ctrl.Kind] {
		res.Errors = append(res.Errors, where+": control "+fmt.Sprintf("%q", ctrl.Kind)+" desconocido (switch|number|display|button|pad|lamp)")
		return
	}
	if ctrl.MinLevel != "" && !knownLevel[ctrl.MinLevel] {
		res.Errors = append(res.Errors, where+": minLevel "+fmt.Sprintf("%q", ctrl.MinLevel)+" desconocido (viewer|operator|admin)")
	}

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
		if ctrl.Write == nil {
			res.Errors = append(res.Errors, where+": botón sin \"write\"")
			return
		}
		if _, ok := findTagInMachine(m, ctrl.Write.Tag); !ok {
			res.Errors = append(res.Errors, where+": write.tag "+fmt.Sprintf("%q", ctrl.Write.Tag)+" no existe en esta máquina")
		}
	}
}

func (a *App) SaveMachineConfig(id, raw string) (ValidateResult, error) {
	if err := a.requireAdmin(); err != nil {
		return ValidateResult{}, err
	}
	if !validID(id) {
		return ValidateResult{Errors: []string{"id de máquina no válido: " + id}}, nil
	}

	_, res := validateMachine(id, []byte(raw))
	if len(res.Errors) > 0 {
		a.auditWrite("configuración", "guardado rechazado: "+id, "hmi-config/machines/"+id+".json", "", "", errors.New(strings.Join(res.Errors, "; ")))
		return res, nil
	}

	var pretty json.RawMessage
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
	if err := os.WriteFile(tmp, append(out, '\n'), 0o644); err != nil {
		return ValidateResult{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return ValidateResult{}, err
	}

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
