package main

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

type plcClient struct {
	endpoint string

	mu     sync.Mutex
	eip    *eipClient
	layout []eipTagSlot
	pollMs int
}

func newPlcClient(endpoint string, pollMs int) *plcClient {
	addr := strings.TrimPrefix(endpoint, "eip://")
	addr = strings.TrimPrefix(addr, "http://")
	addr = strings.TrimPrefix(addr, "https://")
	if i := strings.Index(addr, "/"); i >= 0 {
		addr = addr[:i]
	}
	if addr == "" {
		addr = "127.0.0.1:44818"
	}
	return &plcClient{endpoint: addr, pollMs: pollMs}
}

func (p *plcClient) setLayout(slots []eipTagSlot) {
	p.mu.Lock()
	p.layout = slots
	if p.eip != nil {
		p.eip.close()
		p.eip = nil
	}
	p.mu.Unlock()
}

func (p *plcClient) ensureConnection() bool {
	p.mu.Lock()
	if p.eip != nil && p.eip.info().Connected {
		p.mu.Unlock()
		return true
	}
	if p.eip == nil {
		p.eip = newEIPClient(p.endpoint, p.layout, p.pollMs)
	}
	client := p.eip
	p.mu.Unlock()

	if err := client.connect(); err != nil {
		p.mu.Lock()
		if p.eip == client {
			p.eip.close()
			p.eip = nil
		}
		p.mu.Unlock()
		return false
	}
	return true
}

func (p *plcClient) readAll() (map[string]any, int64, eipConnInfo, error) {
	p.mu.Lock()
	client := p.eip
	p.mu.Unlock()
	if client == nil {
		return nil, 0, eipConnInfo{Endpoint: p.endpoint}, fmt.Errorf("sin sesión EIP con el PLC")
	}
	client.mu.Lock()
	values := client.values
	lastRx := client.lastRx
	client.mu.Unlock()
	info := client.info()
	if !info.Connected {
		return values, lastRx.UnixMilli(), info, fmt.Errorf("sin paquetes implícitos del PLC (¿Forward Open caducado?)")
	}

	out := make(map[string]any, len(values))
	for k, v := range values {
		out[k] = v
	}
	return out, lastRx.UnixMilli(), info, nil
}

func (p *plcClient) writeTag(address string, dataType string, value any) (any, error) {
	p.mu.Lock()
	client := p.eip
	p.mu.Unlock()
	if client == nil {
		return nil, fmt.Errorf("sin sesión EIP con el PLC")
	}
	if err := client.writeTag(address, dataType, value); err != nil {
		return nil, err
	}

	stored, err := client.readTag(address)
	if err != nil {
		return value, nil
	}
	return stored, nil
}

func (p *plcClient) close() {
	p.mu.Lock()
	if p.eip != nil {
		p.eip.close()
		p.eip = nil
	}
	p.mu.Unlock()
}

var _ = time.Now
