package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"net"
	"sync"
	"time"
)

const (
	cmdListIdentity      uint16 = 0x0063
	cmdRegisterSession   uint16 = 0x0065
	cmdUnregisterSession uint16 = 0x0066
	cmdSendRRData        uint16 = 0x006f
	cmdSendUnitData      uint16 = 0x0070
)

const (
	svcForwardClose uint8 = 0x4e
	svcForwardOpen  uint8 = 0x54
	svcReadTag      uint8 = 0x4c
	svcWriteTag     uint8 = 0x4d
)

const (
	cipOK                 uint8 = 0x00
	cipPathSegmentError   uint8 = 0x04
	cipServiceUnsupported uint8 = 0x08
	cipTooMuchData        uint8 = 0x13
)

const (
	cipTypeBool   uint16 = 0xc1
	cipTypeInt    uint16 = 0xc3
	cipTypeDint   uint16 = 0xc4
	cipTypeReal   uint16 = 0xca
	cipTypeString uint16 = 0xa0
)

type eipConnInfo struct {
	Connected bool   `json:"connected"`
	Session   string `json:"session"`
	O2T       string `json:"o2t"`
	T2O       string `json:"t2o"`
	Serial    uint32 `json:"serial"`
	RpiMs     int    `json:"rpiMs"`
	Seq       uint32 `json:"seq"`
	Lost      uint64 `json:"lost"`
	PacketsRx uint64 `json:"packetsRx"`
	PacketsTx uint64 `json:"packetsTx"`
	Endpoint  string `json:"endpoint"`
}

func (i eipConnInfo) toMap() map[string]any {
	return map[string]any{
		"connected": i.Connected,
		"session":   i.Session,
		"o2t":       i.O2T,
		"t2o":       i.T2O,
		"serial":    i.Serial,
		"rpiMs":     i.RpiMs,
		"seq":       i.Seq,
		"lost":      i.Lost,
		"packetsRx": i.PacketsRx,
		"packetsTx": i.PacketsTx,
		"endpoint":  i.Endpoint,
	}
}

type eipTagSlot struct {
	Address  string
	DataType string
	Size     int
}

func cipSizeOf(dataType string) int {
	switch dataType {
	case "bool":
		return 1
	case "int16":
		return 2
	case "int32", "float32":
		return 4
	default:
		return 0
	}
}

func cipTypeOf(dataType string) (uint16, bool) {
	switch dataType {
	case "bool":
		return cipTypeBool, true
	case "int16":
		return cipTypeInt, true
	case "int32":
		return cipTypeDint, true
	case "float32":
		return cipTypeReal, true
	default:
		return 0, false
	}
}

func encodeCIPValue(dataType string, value any) ([]byte, error) {
	code, ok := cipTypeOf(dataType)
	if !ok {
		return nil, fmt.Errorf("tipo %q no soportado por CIP", dataType)
	}
	buf := make([]byte, 2, 6)
	binary.LittleEndian.PutUint16(buf, code)
	switch dataType {
	case "bool":
		b, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("se esperaba bool")
		}
		if b {
			buf = append(buf, 1)
		} else {
			buf = append(buf, 0)
		}
	case "int16":
		n, err := toFloat(value)
		if err != nil {
			return nil, err
		}
		v := make([]byte, 2)
		binary.LittleEndian.PutUint16(v, uint16(int16(n)))
		buf = append(buf, v...)
	case "int32":
		n, err := toFloat(value)
		if err != nil {
			return nil, err
		}
		v := make([]byte, 4)
		binary.LittleEndian.PutUint32(v, uint32(int32(n)))
		buf = append(buf, v...)
	case "float32":
		n, err := toFloat(value)
		if err != nil {
			return nil, err
		}
		v := make([]byte, 4)
		binary.LittleEndian.PutUint32(v, math.Float32bits(float32(n)))
		buf = append(buf, v...)
	}
	return buf, nil
}

func toFloat(value any) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int32:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case bool:
		if v {
			return 1, nil
		}
		return 0, nil
	default:
		return 0, fmt.Errorf("valor no numérico: %v", value)
	}
}

func decodeAssembly(buf []byte, slots []eipTagSlot) map[string]any {
	values := make(map[string]any, len(slots))
	off := 0
	for _, slot := range slots {
		if off+slot.Size > len(buf) {
			break
		}
		switch slot.DataType {
		case "bool":
			values[slot.Address] = buf[off] != 0
		case "int16":
			values[slot.Address] = float64(int16(binary.LittleEndian.Uint16(buf[off:])))
		case "int32":
			values[slot.Address] = float64(int32(binary.LittleEndian.Uint32(buf[off:])))
		case "float32":
			values[slot.Address] = float64(math.Float32frombits(binary.LittleEndian.Uint32(buf[off:])))
		}
		off += slot.Size
	}
	return values
}

func encodeSymbolPath(name string) []byte {
	out := []byte{0x91, byte(len(name))}
	out = append(out, []byte(name)...)
	if len(name)%2 != 0 {
		out = append(out, 0)
	}
	return out
}

func parseSymbolPath(path []byte) string {
	if len(path) < 2 || path[0] != 0x91 {
		return ""
	}
	n := int(path[1])
	if len(path) < 2+n {
		return ""
	}
	return string(path[2 : 2+n])
}

type eipClient struct {
	addr   string
	slot   []eipTagSlot
	pollMs int

	mu       sync.Mutex
	conn     net.Conn
	session  uint32
	o2t, t2o uint32
	serial   uint32
	rpiMs    int
	seq      uint32
	lost     uint64
	rx, tx   uint64
	values   map[string]any
	lastRx   time.Time
	nextCtx  uint64
	pending  map[uint64]chan []byte
	dialing  bool
}

func newEIPClient(addr string, slot []eipTagSlot, pollMs int) *eipClient {
	return &eipClient{
		addr:    addr,
		slot:    slot,
		pollMs:  pollMs,
		values:  map[string]any{},
		pending: map[uint64]chan []byte{},
	}
}

func (c *eipClient) info() eipConnInfo {
	c.mu.Lock()
	defer c.mu.Unlock()
	connected := c.conn != nil && c.session != 0 && time.Since(c.lastRx) < 5*time.Second
	return eipConnInfo{
		Connected: connected,
		Session:   fmt.Sprintf("0x%08X", c.session),
		O2T:       fmt.Sprintf("0x%08X", c.o2t),
		T2O:       fmt.Sprintf("0x%08X", c.t2o),
		Serial:    c.serial,
		RpiMs:     c.rpiMs,
		Seq:       c.seq,
		Lost:      c.lost,
		PacketsRx: c.rx,
		PacketsTx: c.tx,
		Endpoint:  c.addr,
	}
}

func (c *eipClient) close() {
	c.mu.Lock()
	conn, session := c.conn, c.session
	c.conn, c.session = nil, 0
	c.mu.Unlock()
	if conn == nil {
		return
	}
	if session != 0 {
		_ = c.sendRaw(conn, cmdSendRRData, session, cipRR(c.forwardClosePayload()))
		_ = c.sendRaw(conn, cmdUnregisterSession, session, nil)
	}
	_ = conn.Close()
}

func buildFrame(command uint16, session uint32, context uint64, payload []byte) []byte {
	frame := make([]byte, 24+len(payload))
	binary.LittleEndian.PutUint16(frame[0:], command)
	binary.LittleEndian.PutUint16(frame[2:], uint16(len(payload)))
	binary.LittleEndian.PutUint32(frame[4:], session)
	binary.LittleEndian.PutUint32(frame[8:], 0)
	binary.LittleEndian.PutUint64(frame[12:], context)
	binary.LittleEndian.PutUint32(frame[20:], 0)
	copy(frame[24:], payload)
	return frame
}

func (c *eipClient) sendRaw(conn net.Conn, command uint16, session uint32, payload []byte) error {
	c.mu.Lock()
	c.tx++
	c.mu.Unlock()
	_, err := conn.Write(buildFrame(command, session, 0, payload))
	return err
}

func (c *eipClient) request(conn net.Conn, session uint32, cip []byte, timeout time.Duration) ([]byte, error) {
	c.mu.Lock()
	c.nextCtx++
	ctx := c.nextCtx
	ch := make(chan []byte, 1)
	c.pending[ctx] = ch
	c.tx++
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, ctx)
		c.mu.Unlock()
	}()

	if _, err := conn.Write(buildFrame(cmdSendRRData, session, ctx, cip)); err != nil {
		return nil, err
	}
	select {
	case resp := <-ch:
		return resp, nil
	case <-time.After(timeout):
		return nil, fmt.Errorf("timeout esperando respuesta CIP")
	}
}

func (c *eipClient) connect() error {
	c.mu.Lock()
	if c.dialing {
		c.mu.Unlock()
		return fmt.Errorf("conexión en curso")
	}
	c.dialing = true
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.dialing = false
		c.mu.Unlock()
	}()

	conn, err := net.DialTimeout("tcp", c.addr, 2*time.Second)
	if err != nil {
		return fmt.Errorf("sin conexión EIP con %s: %w", c.addr, err)
	}
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	payload := []byte{1, 0, 0, 0}
	if err := c.sendRaw(conn, cmdRegisterSession, 0, payload); err != nil {
		_ = conn.Close()
		return err
	}
	hdr, body, err := readFrame(conn)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("RegisterSession sin respuesta: %w", err)
	}
	if hdr.Command != cmdRegisterSession || hdr.Status != 0 || len(body) < 4 {
		_ = conn.Close()
		return fmt.Errorf("RegisterSession rechazado (status %d)", hdr.Status)
	}
	session := hdr.Session

	if err := c.sendRaw(conn, cmdSendRRData, session, cipRR(c.forwardOpenPayload())); err != nil {
		_ = conn.Close()
		return err
	}
	hdrFO, bodyFO, err := readFrame(conn)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("Forward Open sin respuesta: %w", err)
	}
	if hdrFO.Command != cmdSendRRData {
		_ = conn.Close()
		return fmt.Errorf("Forward Open: trama inesperada 0x%04X", hdrFO.Command)
	}
	cip, status, err := parseCIPResponse(bodyFO)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("Forward Open: %w", err)
	}
	if status != cipOK || len(cip) < 20 {
		_ = conn.Close()
		return fmt.Errorf("Forward Open rechazado (status CIP 0x%02X)", status)
	}
	o2t := binary.LittleEndian.Uint32(cip[0:])
	t2o := binary.LittleEndian.Uint32(cip[4:])
	serial := uint32(binary.LittleEndian.Uint16(cip[8:]))
	rpiUs := binary.LittleEndian.Uint32(cip[10:])
	rpiMs := int(rpiUs) / 1000
	if rpiMs <= 0 {
		rpiMs = c.pollMs
	}

	_ = conn.SetDeadline(time.Time{})

	c.mu.Lock()
	c.conn, c.session = conn, session
	c.o2t, c.t2o, c.serial, c.rpiMs = o2t, t2o, serial, rpiMs
	c.lastRx = time.Now()
	c.seq, c.lost = 0, 0
	c.mu.Unlock()

	go c.readLoop(conn, session)
	return nil
}

func (c *eipClient) forwardOpenPayload() []byte {
	path := []byte{0x20, 0x06, 0x24, 0x01}
	data := make([]byte, 39)
	data[0] = 5
	data[1] = 20
	binary.LittleEndian.PutUint32(data[2:], 0)
	binary.LittleEndian.PutUint32(data[6:], 0)
	binary.LittleEndian.PutUint16(data[10:], 0)
	rpiUs := uint32(c.pollMs) * 1000
	binary.LittleEndian.PutUint32(data[12:], rpiUs)
	binary.LittleEndian.PutUint32(data[16:], rpiUs)
	binary.LittleEndian.PutUint16(data[20:], 0x43ff)
	data[22] = 0x0a
	data[23] = byte(len(path) / 2)
	out := []byte{svcForwardOpen, byte(len(path) / 2)}
	out = append(out, path...)
	return append(out, data...)
}

func (c *eipClient) forwardClosePayload() []byte {
	path := []byte{0x20, 0x06, 0x24, 0x01}
	data := make([]byte, 6)
	data[0] = 5
	data[1] = 20
	c.mu.Lock()
	serial := uint16(c.serial)
	c.mu.Unlock()
	binary.LittleEndian.PutUint16(data[2:], serial)
	data[4] = byte(len(path) / 2)
	out := []byte{svcForwardClose, byte(len(path) / 2)}
	out = append(out, path...)
	return append(out, data...)
}

type eipHeader struct {
	Command uint16
	Length  uint16
	Session uint32
	Status  uint32
	Context uint64
}

func readFrame(r io.Reader) (eipHeader, []byte, error) {
	head := make([]byte, 24)
	if _, err := io.ReadFull(r, head); err != nil {
		return eipHeader{}, nil, err
	}
	h := eipHeader{
		Command: binary.LittleEndian.Uint16(head[0:]),
		Length:  binary.LittleEndian.Uint16(head[2:]),
		Session: binary.LittleEndian.Uint32(head[4:]),
		Status:  binary.LittleEndian.Uint32(head[8:]),
		Context: binary.LittleEndian.Uint64(head[12:]),
	}
	body := make([]byte, h.Length)
	if h.Length > 0 {
		if _, err := io.ReadFull(r, body); err != nil {
			return eipHeader{}, nil, err
		}
	}
	return h, body, nil
}

func (c *eipClient) readLoop(conn net.Conn, session uint32) {
	for {
		hdr, body, err := readFrame(conn)
		if err != nil {
			c.mu.Lock()
			if c.conn == conn {
				c.conn, c.session = nil, 0
			}
			c.mu.Unlock()
			return
		}
		switch hdr.Command {
		case cmdSendUnitData:
			c.handleUnitData(body)
		case cmdSendRRData:
			c.handleRRData(hdr, body)
		}
	}
}

func (c *eipClient) handleUnitData(body []byte) {

	if len(body) < 10 {
		return
	}
	off := 8
	itemCount := int(binary.LittleEndian.Uint16(body[off:]))
	off += 2
	for i := 0; i < itemCount && off+4 <= len(body); i++ {
		typ := binary.LittleEndian.Uint16(body[off:])
		ln := int(binary.LittleEndian.Uint16(body[off+2:]))
		off += 4
		if off+ln > len(body) {
			return
		}
		if typ == 0x00b2 {
			if ln < 2 {
				return
			}
			seq := uint32(binary.LittleEndian.Uint16(body[off:]))
			values := decodeAssembly(body[off+2:], c.slot)
			c.mu.Lock()
			if c.rx > 0 && seq != (c.seq+1)&0xffff {
				c.lost += uint64((seq - c.seq - 1) & 0xffff)
			}
			c.seq = seq
			c.rx++
			c.values = values
			c.lastRx = time.Now()
			c.mu.Unlock()
			return
		}
		off += ln
	}
}

func (c *eipClient) handleRRData(hdr eipHeader, body []byte) {
	c.mu.Lock()
	ch := c.pending[hdr.Context]
	c.mu.Unlock()
	if ch != nil {
		ch <- body
	}
}

func parseCIPResponse(body []byte) ([]byte, uint8, error) {

	if len(body) < 8 {
		return nil, 0, fmt.Errorf("respuesta SendRRData demasiado corta (%d B)", len(body))
	}
	off := 6
	itemCount := int(binary.LittleEndian.Uint16(body[off:]))
	off += 2
	for i := 0; i < itemCount && off+4 <= len(body); i++ {
		typ := binary.LittleEndian.Uint16(body[off:])
		ln := int(binary.LittleEndian.Uint16(body[off+2:]))
		off += 4
		if off+ln > len(body) {
			break
		}
		if typ == 0x00b2 {
			data := body[off : off+ln]
			if len(data) < 4 {
				return nil, 0, fmt.Errorf("respuesta CIP vacía")
			}
			status := data[2]
			extra := int(data[3]) * 2
			if 4+extra > len(data) {
				extra = len(data) - 4
			}
			return data[4+extra:], status, nil
		}
		off += ln
	}
	return nil, 0, fmt.Errorf("sin item de datos CIP en la respuesta")
}

func cipRequest(service uint8, path []byte, data []byte) []byte {
	out := []byte{service, byte(len(path) / 2)}
	out = append(out, path...)
	return append(out, data...)
}

func cipRR(cip []byte) []byte {
	out := make([]byte, 8)
	binary.LittleEndian.PutUint16(out[6:], 2)
	out = append(out, 0x00, 0x00, 0x00, 0x00)
	out = append(out, 0xb2, 0x00)
	out = append(out, byte(len(cip)), byte(len(cip)>>8))
	return append(out, cip...)
}

func (c *eipClient) writeTag(address string, dataType string, value any) error {
	data, err := encodeCIPValue(dataType, value)
	if err != nil {
		return err
	}
	cip := cipRequest(svcWriteTag, encodeSymbolPath(address), data)

	c.mu.Lock()
	conn, session := c.conn, c.session
	c.mu.Unlock()
	if conn == nil || session == 0 {
		return fmt.Errorf("sin sesión EIP con el PLC")
	}
	resp, err := c.request(conn, session, cipRR(cip), 2*time.Second)
	if err != nil {
		return fmt.Errorf("Write Tag %s: %w", address, err)
	}
	_, status, err := parseCIPResponse(resp)
	if err != nil {
		return fmt.Errorf("Write Tag %s: %w", address, err)
	}
	switch status {
	case cipOK:
		return nil
	case cipPathSegmentError:
		return fmt.Errorf("el PLC no conoce la tag %s", address)
	case cipTooMuchData:
		return fmt.Errorf("el PLC rechazó el valor para %s (fuera de rango o tipo)", address)
	default:
		return fmt.Errorf("Write Tag %s rechazado (status CIP 0x%02X)", address, status)
	}
}

func (c *eipClient) readTag(address string) (any, error) {
	cip := cipRequest(svcReadTag, encodeSymbolPath(address), nil)

	c.mu.Lock()
	conn, session := c.conn, c.session
	c.mu.Unlock()
	if conn == nil || session == 0 {
		return nil, fmt.Errorf("sin sesión EIP con el PLC")
	}
	resp, err := c.request(conn, session, cipRR(cip), 2*time.Second)
	if err != nil {
		return nil, fmt.Errorf("Read Tag %s: %w", address, err)
	}
	data, status, err := parseCIPResponse(resp)
	if err != nil {
		return nil, fmt.Errorf("Read Tag %s: %w", address, err)
	}
	if status != cipOK {
		return nil, fmt.Errorf("el PLC no conoce la tag %s (status CIP 0x%02X)", address, status)
	}
	if len(data) < 2 {
		return nil, fmt.Errorf("respuesta vacía para %s", address)
	}
	code := binary.LittleEndian.Uint16(data) & 0xff
	body := data[2:]
	switch code {
	case cipTypeBool:
		return len(body) > 0 && body[0] != 0, nil
	case cipTypeInt:
		if len(body) < 2 {
			return nil, fmt.Errorf("respuesta corta para %s", address)
		}
		return float64(int16(binary.LittleEndian.Uint16(body))), nil
	case cipTypeDint:
		if len(body) < 4 {
			return nil, fmt.Errorf("respuesta corta para %s", address)
		}
		return float64(int32(binary.LittleEndian.Uint32(body))), nil
	case cipTypeReal:
		if len(body) < 4 {
			return nil, fmt.Errorf("respuesta corta para %s", address)
		}
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(body))), nil
	default:
		return nil, fmt.Errorf("tipo CIP 0x%02X no soportado para %s", code, address)
	}
}
