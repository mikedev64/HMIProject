package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Las máquinas reales del repositorio deben pasar la validación del editor
// (si no, «Guardar» en la app las rechazaría).
func TestMachinesDelRepoValidas(t *testing.T) {
	entries, err := os.ReadDir("hmi-config/machines")
	if err != nil {
		t.Fatalf("lectura de hmi-config/machines: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("no hay máquinas")
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("hmi-config", "machines", e.Name()))
		if err != nil {
			t.Fatalf("%s: %v", e.Name(), err)
		}
		id := strings.TrimSuffix(e.Name(), ".json")
		if _, res := validateMachine(id, raw); len(res.Errors) > 0 {
			t.Errorf("%s no valida: %v", e.Name(), res.Errors)
		}
	}
}

// La validación bloquea errores claros (JSON roto, tags duplicadas, controles
// que apuntan a tags inexistentes) y deja avisos no bloqueantes.
func TestValidateMachineErroresYAvisos(t *testing.T) {
	// JSON roto.
	if _, res := validateMachine("m1", []byte("{no es json")); len(res.Errors) == 0 {
		t.Error("el JSON roto debía producir error")
	}

	good := `{
	  "id": "m1", "name": "Prueba", "type": "x", "image": "/x.svg",
	  "size": {"width": 100, "height": 80},
	  "statusTags": {"run": "B3/1", "alarm": "B3/2"},
	  "tags": [
	    {"name":"motor","label":"Motor","address":"B3/1","dataType":"bool","access":"rw"},
	    {"name":"alarma","label":"Alarma","address":"B3/2","dataType":"bool","access":"ro"}
	  ],
	  "hmi": {"tabs": [{"id":"control","title":"Control","blocks":[
	    {"type":"sections","sections":[{"title":"Mando","items":[
	      {"kind":"switch","tag":"motor"},
	      {"kind":"button","label":"Marcha","write":{"tag":"motor","value":true}}
	    ]}]}
	  ]}]}
	}`
	_, res := validateMachine("m1", []byte(good))
	if len(res.Errors) > 0 {
		t.Errorf("una config válida tiene errores: %v", res.Errors)
	}
	if len(res.Warnings) == 0 {
		t.Error("se esperaba al menos un aviso (sin statusTags.ack)")
	}

	// Dirección duplicada y control hacia una tag inexistente.
	bad := strings.Replace(good, `"name":"alarma","label":"Alarma","address":"B3/2"`, `"name":"alarma","label":"Alarma","address":"B3/1"`, 1)
	bad = strings.Replace(bad, `{"kind":"switch","tag":"motor"}`, `{"kind":"switch","tag":"noexiste"}`, 1)
	_, res = validateMachine("m1", []byte(bad))
	if len(res.Errors) < 2 {
		t.Errorf("se esperaban errores de duplicado y de tag inexistente: %v", res.Errors)
	}

	// Bloque desconocido también bloquea.
	unknown := strings.Replace(good, `{"type":"sections"`, `{"type":"magia"`, 1)
	_, res = validateMachine("m1", []byte(unknown))
	if len(res.Errors) == 0 {
		t.Error("un bloque desconocido debía bloquear el guardado")
	}
}

// La gestión de usuarios exige nivel admin y persiste los cambios.
func TestGestionUsuariosRequiereAdmin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.json")
	svc, err := newAuthService(path)
	if err != nil {
		t.Fatalf("newAuthService: %v", err)
	}
	app := &App{auth: svc}

	// Sin sesión no hay gestión.
	if _, err := app.ListUsers(); err == nil {
		t.Error("ListUsers sin sesión debía fallar")
	}

	// admin puede; operator no.
	if _, err := svc.Login("admin", "admin123"); err != nil {
		t.Fatalf("login admin: %v", err)
	}
	if _, err := app.ListUsers(); err != nil {
		t.Errorf("admin debía poder listar usuarios: %v", err)
	}
	if err := app.SetUser("tecnico", "secreto1", LevelOperator); err != nil {
		t.Errorf("admin debía poder crear usuarios: %v", err)
	}
	if err := app.SetUser("otro", "corta", LevelViewer); err == nil {
		t.Error("una contraseña de 5 caracteres debía rechazarse")
	}

	svc.Logout()
	if _, err := svc.Login("operador", "operador123"); err != nil {
		t.Fatalf("login operador: %v", err)
	}
	if err := app.SetUser("x", "secreto1", LevelViewer); err == nil {
		t.Error("operator no debe poder gestionar usuarios")
	}

	// Persistencia: recargar el fichero y comprobar que tecnico sigue.
	svc2, err := newAuthService(path)
	if err != nil {
		t.Fatalf("recarga: %v", err)
	}
	if _, err := svc2.Login("tecnico", "secreto1"); err != nil {
		t.Errorf("tecnico no sobrevivió la recarga de users.json: %v", err)
	}
	users := svc2.ListUsers()
	if len(users) != 4 { // admin, operador, consulta, tecnico
		t.Errorf("se esperaban 4 usuarios, hay %d: %+v", len(users), users)
	}
}

// Reglas de borrado: ni el propio usuario ni el último administrador.
func TestDeleteUserReglas(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.json")
	svc, err := newAuthService(path)
	if err != nil {
		t.Fatalf("newAuthService: %v", err)
	}

	// Sesión en admin: no puede eliminarse a sí mismo.
	svc.active = &SessionInfo{Authenticated: true, Username: "admin", Level: LevelAdmin}
	if _, err := svc.DeleteUser("admin"); err == nil {
		t.Error("autoborrado debía fallar")
	}

	// Sesión en operador: admin es el único administrador.
	svc.active = &SessionInfo{Authenticated: true, Username: "operador", Level: LevelOperator}
	if _, err := svc.DeleteUser("admin"); err == nil || !strings.Contains(err.Error(), "último administrador") {
		t.Errorf("borrar el único admin debía fallar, got: %v", err)
	}

	// Con un segundo admin, el primero sí se puede borrar.
	if _, err := svc.SetUser("admin2", "secreto1", LevelAdmin); err != nil {
		t.Fatalf("SetUser: %v", err)
	}
	if _, err := svc.DeleteUser("admin"); err != nil {
		t.Errorf("con dos admins debía poderse borrar uno: %v", err)
	}
}

// Recetas: se guardan solo tags rw existentes y se persisten en disco.
func TestRecetas(t *testing.T) {
	orig := recipesDir
	recipesDir = t.TempDir()
	defer func() { recipesDir = orig }()

	app := &App{config: HMIConfig{Machines: []Machine{{
		ID: "m1", Name: "Máquina 1",
		Tags: []TagDef{
			{Name: "setpoint", Address: "N7:0", DataType: "int16", Access: AccessReadWrite, Min: f64(0), Max: f64(100)},
			{Name: "actual", Address: "F8:0", DataType: "float32", Access: AccessReadOnly},
		},
	}}}}

	// Guardar receta válida (requireLogin=false -> sin gate de sesión).
	list, err := app.SaveRecipe("m1", Recipe{Name: "Verano", Values: map[string]any{"N7:0": 80}})
	if err != nil {
		t.Fatalf("SaveRecipe: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("se esperaba 1 receta, hay %d", len(list))
	}

	// Se persiste: otra lectura la ve.
	got, err := app.GetRecipes("m1")
	if err != nil || len(got) != 1 || got[0].Name != "Verano" {
		t.Errorf("receta no persistida: %v %+v", err, got)
	}

	// Rechaza tag inexistente y tag ro.
	if _, err := app.SaveRecipe("m1", Recipe{Name: "mala", Values: map[string]any{"N9:9": 1}}); err == nil {
		t.Error("una tag inexistente debía rechazarse")
	}
	if _, err := app.SaveRecipe("m1", Recipe{Name: "mala", Values: map[string]any{"F8:0": 1}}); err == nil {
		t.Error("una tag ro debía rechazarse")
	}

	// Sustituir por nombre y borrar.
	list, err = app.SaveRecipe("m1", Recipe{Name: "invierno", Values: map[string]any{"N7:0": 20}})
	if err != nil || len(list) != 2 {
		t.Fatalf("segunda receta: %v (%d)", err, len(list))
	}
	list, err = app.DeleteRecipe("m1", "Verano")
	if err != nil || len(list) != 1 {
		t.Fatalf("DeleteRecipe: %v (%d)", err, len(list))
	}
	if _, err := app.DeleteRecipe("m1", "noexiste"); err == nil {
		t.Error("borrar una receta inexistente debía fallar")
	}
}

func f64(v float64) *float64 { return &v }

// El nivel mínimo de una tag es el máximo entre operator y el minLevel de
// los controles que la escriben (mismo criterio que requiredRankForAddress
// del frontend y que el gate de WriteTag).
func TestRequiredRankForTag(t *testing.T) {
	m := Machine{
		ID: "m1",
		Tags: []TagDef{
			{Name: "normal", Address: "N7:0", DataType: "int16", Access: AccessReadWrite},
			{Name: "critica", Address: "N7:1", DataType: "int16", Access: AccessReadWrite},
		},
		HMI: &MachineHMI{Tabs: []TabDef{{
			ID: "c", Title: "Control",
			Blocks: []BlockDef{{Type: "sections", Sections: []SectionDef{{Items: []ControlDef{
				{Kind: "number", Tag: "normal"},
				{Kind: "button", Label: "Reset", MinLevel: LevelAdmin, Write: &WriteAction{Tag: "critica", Value: true}},
			}}}}},
		}}},
	}

	if r := requiredRankForTag(m, "N7:0"); r != levelRank(LevelOperator) {
		t.Errorf("N7:0 debía exigir operator, rango %d", r)
	}
	if r := requiredRankForTag(m, "N7:1"); r != levelRank(LevelAdmin) {
		t.Errorf("N7:1 debía exigir admin, rango %d", r)
	}
	sinHMI := Machine{Tags: m.Tags}
	if r := requiredRankForTag(sinHMI, "N7:0"); r != levelRank(LevelOperator) {
		t.Errorf("sin bloque hmi todo exige operator, rango %d", r)
	}
}

// El bloqueo temporal tras intentos fallidos funciona y es por usuario.
func TestBloqueoTrasIntentosFallidos(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.json")
	svc, err := newAuthService(path)
	if err != nil {
		t.Fatalf("newAuthService: %v", err)
	}

	for i := 0; i < maxLoginFailures; i++ {
		if _, err := svc.Login("operador", "mala"); err == nil {
			t.Fatal("una contraseña mala fue aceptada")
		}
	}
	// La siguiente (aunque fuese correcta) debe estar bloqueada.
	_, err = svc.Login("operador", "operador123")
	if err == nil || !strings.Contains(err.Error(), "bloqueada") {
		t.Errorf("se esperaba bloqueo de la cuenta, got: %v", err)
	}
	// Otro usuario no está afectado.
	if _, err := svc.Login("consulta", "consulta123"); err != nil {
		t.Errorf("el bloqueo debe ser por usuario: %v", err)
	}
}
