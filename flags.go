package main

import "flag"

var onlyMouse = flag.Bool("onlymouse", false, "Modo solo ratón: desactiva el pad numérico y los gestos táctiles")

type RuntimeFlags struct {
	OnlyMouse bool `json:"onlyMouse"`
}

func (a *App) GetRuntimeFlags() RuntimeFlags {
	return RuntimeFlags{OnlyMouse: *onlyMouse}
}
