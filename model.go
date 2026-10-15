package main

type Access string

const (
	AccessReadOnly  Access = "ro"
	AccessReadWrite Access = "rw"
)

type TagDef struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	Address  string   `json:"address"`
	DataType string   `json:"dataType"`
	Access   Access   `json:"access"`
	Unit     string   `json:"unit,omitempty"`
	Min      *float64 `json:"min,omitempty"`
	Max      *float64 `json:"max,omitempty"`
	Group    string   `json:"group,omitempty"`
	Default  any      `json:"default,omitempty"`
}

type StatusTags struct {
	Run   string `json:"run,omitempty"`
	Alarm string `json:"alarm,omitempty"`
	Ack   string `json:"ack,omitempty"`
}

type Size struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type WriteAction struct {
	Tag     string `json:"tag"`
	Value   any    `json:"value"`
	Release any    `json:"release,omitempty"`
}

type ControlDef struct {
	Kind      string       `json:"kind"`
	Tag       string       `json:"tag,omitempty"`
	Label     string       `json:"label,omitempty"`
	Tone      string       `json:"tone,omitempty"`
	Variant   string       `json:"variant,omitempty"`
	Momentary bool         `json:"momentary,omitempty"`
	Write     *WriteAction `json:"write,omitempty"`
	MinLevel  string       `json:"minLevel,omitempty"`
}

type SectionDef struct {
	Title   string       `json:"title,omitempty"`
	Columns int          `json:"columns,omitempty"`
	Items   []ControlDef `json:"items"`
}

type BlockDef struct {
	Type     string       `json:"type"`
	Sections []SectionDef `json:"sections,omitempty"`
	Tags     []string     `json:"tags,omitempty"`
	Points   int          `json:"points,omitempty"`
}

type TabDef struct {
	ID     string     `json:"id"`
	Title  string     `json:"title"`
	Blocks []BlockDef `json:"blocks"`
}

type MachineHMI struct {
	Tabs []TabDef `json:"tabs"`
}

type Machine struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Type       string      `json:"type"`
	Image      string      `json:"image"`
	Size       Size        `json:"size"`
	StatusTags StatusTags  `json:"statusTags,omitempty"`
	Tags       []TagDef    `json:"tags"`
	HMI        *MachineHMI `json:"hmi,omitempty"`
}

type PlcInfo struct {
	Name           string `json:"name"`
	Endpoint       string `json:"endpoint"`
	PollIntervalMs int    `json:"pollIntervalMs"`
}

type AlarmBannerCfg struct {
	Enabled  bool `json:"enabled"`
	MaxItems int  `json:"maxItems"`
}

type UISettings struct {
	AlarmBanner AlarmBannerCfg `json:"alarmBanner"`
}

type SecuritySettings struct {
	RequireLogin      bool `json:"requireLogin"`
	SessionTimeoutMin int  `json:"sessionTimeoutMin"`
}

type HMIConfig struct {
	Version  int              `json:"version"`
	Plc      PlcInfo          `json:"plc"`
	UI       UISettings       `json:"ui"`
	Security SecuritySettings `json:"security"`
	Machines []Machine        `json:"machines"`
}

type Snapshot struct {
	Connected bool           `json:"connected"`
	Error     string         `json:"error,omitempty"`
	Ts        int64          `json:"ts"`
	Values    map[string]any `json:"values"`
	EIP       map[string]any `json:"eip,omitempty"`
}
