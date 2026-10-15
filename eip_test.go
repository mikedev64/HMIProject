package main

/*
Tests del protocolo EtherNet/IP:

  - codec de valores CIP (encode/decode de bool, int16, int32, float32),
  - segmentos de símbolo (0x91) como usa Logix,
  - montaje/lectura de tramas EIP y respuestas CIP,
  - interoperabilidad REAL contra el servidor EIP del simulador Node
    (plc-simulator/eip.js) si está en marcha: sesión, Forward Open,
    secuencia implícita, Read Tag y Write Tag.

Ejecutar con: go test -tags webkit2_41 ./...
*/

import (
	"encoding/binary"
	"math"
	"net"
	"strings"
	"testing"
	"time"
)

// Roundtrip de los 4 tipos CIP del mapa HMI.
func TestCIPCodecTipos(t *testing.T) {
	cases := []struct {
		dataType string
		value    any
	}{
		{"bool", true},
		{"bool", false},
		{"int16", 1234.0},
		{"int16", -42.0},
		{"int32", 123456.0},
		{"int32", -654321.0},
		{"float32", 3.5},
		{"float32", -12.25},
	}
	for _, c := range cases {
		data, err := encodeCIPValue(c.dataType, c.value)
		if err != nil {
			t.Fatalf("encode %s=%v: %v", c.dataType, c.value, err)
		}
		// Misma forma que Read/Write Tag: [tipo(2)][valor].
		if got := decodeTypedForTest(t, data); got != c.value {
			t.Errorf("%s: roundtrip %v -> %v", c.dataType, c.value, got)
		}
	}
}

// decodeTypedForTest decodifica el par [tipo][valor] como hace el frontend
// (decodeTyped) para comparar valores del roundtrip.
func decodeTypedForTest(t *testing.T, data []byte) any {
	t.Helper()
	if len(data) < 2 {
		t.Fatal("encode corto")
	}
	code := uint16(data[0]) | uint16(data[1])<<8
	body := data[2:]
	switch code {
	case cipTypeBool:
		return len(body) > 0 && body[0] != 0
	case cipTypeInt:
		return float64(int16(uint16(body[0]) | uint16(body[1])<<8))
	case cipTypeDint:
		return float64(int32(uint32(body[0]) | uint32(body[1])<<8 | uint32(body[2])<<16 | uint32(body[3])<<24))
	case cipTypeReal:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(body)))
	default:
		t.Fatalf("tipo desconocido 0x%02X", code)
		return nil
	}
}

// Segmentos de símbolo 0x91 con padding a word (como Logix).
func TestSimboloPath(t *testing.T) {
	for _, name := range []string{"N7:0", "B3/12", "F8:20", "N7:11"} {
		path := encodeSymbolPath(name)
		if got := parseSymbolPath(path); got != name {
			t.Errorf("símbolo %q -> %q", name, got)
		}
		if len(path)%2 != 0 {
			t.Errorf("el path de %q debe alinear a word: %v", name, path)
		}
	}
}

// Decodificación del assembly en el orden de los slots.
func TestDecodeAssembly(t *testing.T) {
	slots := []eipTagSlot{
		{Address: "B3/0", DataType: "bool", Size: 1},
		{Address: "N7:0", DataType: "int16", Size: 2},
		{Address: "F8:0", DataType: "float32", Size: 4},
	}
	// B3/0 = true, N7:0 = 120, F8:0 = 3.5 (se monta con el propio codec)
	buf := append([]byte{1}, 120, 0)
	f := make([]byte, 4)
	binary.LittleEndian.PutUint32(f, math.Float32bits(3.5))
	buf = append(buf, f...)
	values := decodeAssembly(buf, slots)
	if values["B3/0"] != true {
		t.Errorf("B3/0 = %v (esperado true)", values["B3/0"])
	}
	if values["N7:0"] != 120.0 {
		t.Errorf("N7:0 = %v (esperado 120)", values["N7:0"])
	}
	if values["F8:0"] != 3.5 {
		t.Errorf("F8:0 = %v (esperado 3.5)", values["F8:0"])
	}
}

// Interoperabilidad REAL: si el simulador Node está en marcha, la sesión EIP
// completa (RegisterSession + Forward Open + implícito + Read/Write Tag)
// funciona entre Go y Node. Si no está, el test se omite (no falla).
func TestEIPInteroperabilidadConSimulador(t *testing.T) {
	addr := "127.0.0.1:44818"
	if !eipPortOpen(addr) {
		t.Skip("simulador EIP no en marcha (arranca plc-simulator/server.js para este test)")
	}
	slots := []eipTagSlot{
		{Address: "N7:0", DataType: "int16", Size: 2},
		{Address: "F8:20", DataType: "float32", Size: 4},
		{Address: "B3/10", DataType: "bool", Size: 1},
	}
	client := newEIPClient(addr, slots, 100)
	if err := client.connect(); err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer client.close()

	info := client.info()
	if !info.Connected || info.Session == "0x00000000" {
		t.Fatalf("sesión no establecida: %+v", info)
	}
	if info.RpiMs <= 0 {
		t.Errorf("RPI no negociado: %+v", info)
	}

	// Esperar al menos un paquete implícito con secuencia.
	deadline := time.Now().Add(3 * time.Second)
	for client.info().PacketsRx == 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if client.info().PacketsRx == 0 {
		t.Fatal("sin paquetes implícitos (SendUnitData T->O) del PLC")
	}

	// Write Tag explícito y confirmación con Read Tag.
	if err := client.writeTag("N7:0", "int16", 55.0); err != nil {
		t.Fatalf("writeTag: %v", err)
	}
	got, err := client.readTag("N7:0")
	if err != nil {
		t.Fatalf("readTag: %v", err)
	}
	if got != 55.0 {
		t.Errorf("N7:0 = %v tras Write Tag (esperado 55)", got)
	}

	// Tag inexistente -> error CIP de path (status 0x04).
	if err := client.writeTag("N9:9", "int16", 1.0); err == nil || !strings.Contains(err.Error(), "no conoce") {
		t.Errorf("escribir en tag inexistente debía fallar, got: %v", err)
	}
}

// eipPortOpen comprueba si algo escucha en el puerto EIP del simulador.
func eipPortOpen(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
