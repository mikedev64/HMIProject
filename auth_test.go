package main

/*
Tests del sistema de perfiles: la verificación de credenciales y el gate de
escritura viven en el backend Go, así que se prueban aquí (contra el
hmi-config/users.json real y contra una siembra en directorio temporal).

Ejecutar con: go test -tags webkit2_41 ./...
*/

import (
	"path/filepath"
	"strings"
	"testing"
)

// Login contra el users.json sembrado del repositorio (PBKDF2-HMAC-SHA256).
func TestLoginContraUsersSembrado(t *testing.T) {
	svc, err := newAuthService(usersFilePath) // hmi-config/users.json
	if err != nil {
		t.Fatalf("newAuthService: %v", err)
	}

	if _, err := svc.Login("operador", "malamenta"); err == nil {
		t.Error("una contraseña incorrecta fue aceptada")
	}
	if _, err := svc.Login("noexiste", "operador123"); err == nil {
		t.Error("un usuario inexistente fue aceptado")
	}

	s, err := svc.Login("operador", "operador123")
	if err != nil {
		t.Fatalf("login válido rechazado: %v", err)
	}
	if !s.Authenticated || s.Username != "operador" || s.Level != LevelOperator {
		t.Errorf("sesión inesperada: %+v", s)
	}

	// El operador sí alcanza el nivel mínimo de escritura.
	if err := svc.Require(LevelOperator); err != nil {
		t.Errorf("operador no superó Require(operator): %v", err)
	}

	svc.Logout()
	if err := svc.Require(LevelOperator); err == nil {
		t.Error("sin sesión no se debe poder escribir en el PLC")
	}

	// El perfil consulta (viewer) queda por debajo de operator.
	if _, err := svc.Login("consulta", "consulta123"); err != nil {
		t.Fatalf("login de consulta rechazado: %v", err)
	}
	if err := svc.Require(LevelOperator); err == nil {
		t.Error("el nivel viewer no debería poder escribir en el PLC")
	}
	if err := svc.Require(LevelViewer); err != nil {
		t.Errorf("viewer no superó Require(viewer): %v", err)
	}
}

// Siembra automática de users.json + roundtrip PBKDF2 en un dir temporal.
func TestSeedUsuariosPorDefecto(t *testing.T) {
	path := filepath.Join(t.TempDir(), "users.json")
	svc, err := newAuthService(path)
	if err != nil {
		t.Fatalf("newAuthService (siembra): %v", err)
	}
	if _, err := svc.Login("admin", "admin123"); err != nil {
		t.Errorf("admin123 no verifica tras sembrar: %v", err)
	}
	if _, err := svc.Login("admin", "otra"); err == nil {
		t.Error("una contraseña incorrecta fue aceptada tras sembrar")
	}
}

// WriteTag exige nivel operator (si security.requireLogin) ANTES de tocar el
// mapa o el PLC: sin sesión el error es de autorización; con sesión válida el
// gate se supera y el fallo posterior es otro (tag no encontrada, PLC caído…).
func TestWriteTagExigeSesion(t *testing.T) {
	svc, err := newAuthService(usersFilePath)
	if err != nil {
		t.Fatalf("newAuthService: %v", err)
	}
	app := &App{
		auth:   svc,
		config: HMIConfig{Security: SecuritySettings{RequireLogin: true}},
	}

	_, err = app.WriteTag("N7:0", 10)
	if err == nil {
		t.Fatal("WriteTag sin sesión debía fallar")
	}
	if !strings.Contains(err.Error(), "inicia sesión") {
		t.Errorf("error inesperado sin sesión: %v", err)
	}

	if _, err := svc.Login("consulta", "consulta123"); err != nil {
		t.Fatalf("login de consulta: %v", err)
	}
	if _, err := app.WriteTag("N7:0", 10); err == nil || !strings.Contains(err.Error(), "se requiere operator") {
		t.Errorf("el perfil viewer debía quedar bloqueado, got: %v", err)
	}

	if _, err := svc.Login("operador", "operador123"); err != nil {
		t.Fatalf("login de operador: %v", err)
	}
	_, err = app.WriteTag("N7:0", 10)
	if err == nil {
		t.Error("con config vacía la tag no existe: se esperaba fallo de mapa, no éxito")
	}
	if strings.Contains(err.Error(), "inicia sesión") || strings.Contains(err.Error(), "se requiere") {
		t.Errorf("una sesión operator no superó el gate de autorización: %v", err)
	}
}
