package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// plcClient talks to the (simulated) PLC over HTTP. A real PanelView reaches
// the controller through a driver (RSLinx / EtherNet-IP) and reads/writes
// memory addresses directly; here the same address space is exposed over HTTP
// so the HMI can poll it the same way: read on an interval, write on demand.
type plcClient struct {
	endpoint string
	http     *http.Client
}

func newPlcClient(endpoint string) *plcClient {
	return &plcClient{
		endpoint: endpoint,
		http:     &http.Client{Timeout: 2 * time.Second},
	}
}

// readAll fetches the current value of every address in the PLC memory.
func (c *plcClient) readAll() (map[string]any, int64, error) {
	resp, err := c.http.Get(c.endpoint + "/tags")
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("PLC devolvió %d", resp.StatusCode)
	}

	var payload struct {
		Values map[string]any `json:"values"`
		Ts     int64          `json:"ts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, 0, err
	}
	return payload.Values, payload.Ts, nil
}

// writeTag writes a value to a PLC memory address and returns the value the
// PLC actually stored (it may clamp/round it).
func (c *plcClient) writeTag(address string, value any) (any, error) {
	body, err := json.Marshal(map[string]any{"address": address, "value": value})
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Post(c.endpoint+"/write", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)

	var ok struct {
		Ok    bool   `json:"ok"`
		Value any    `json:"value"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(raw, &ok); err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK || !ok.Ok {
		if ok.Error != "" {
			return nil, fmt.Errorf("%s", ok.Error)
		}
		return nil, fmt.Errorf("escritura rechazada (%d)", resp.StatusCode)
	}
	return ok.Value, nil
}
