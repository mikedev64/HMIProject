//go:build ignore

// ============================================================================
// ESPEJO COMENTADO DE main.go  (código idéntico al de la raíz del repo)
// Etiqueta //go:build ignore => excluido del build: es documentación.
// ============================================================================
package main

import (
	// embed: trae los tipos embed.FS (sistema de ficheros embebido en el
	// binario). Esta vez NO es blank import: usamos embed.FS como tipo.
	"embed"

	// github.com/wailsapp/wails/v2: núcleo de Wails (wails.Run).
	"github.com/wailsapp/wails/v2"
	// options: structs de configuración de la app (tamaño, callbacks, etc.).
	"github.com/wailsapp/wails/v2/pkg/options"
	// assetserver: sirve los ficheros de frontend/dist dentro de la webview.
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// DIRECTIVA //go:embed all:frontend/dist — embebe TODA la carpeta del build
// del frontend en el binario. El prefijo `all:` además incluye los ficheros
// que empiezan por "." o "_" (sin él se omiten). OJO: si la carpeta no existe
// (no se ha ejecutado `pnpm build`), `go build` FALLA: hay que compilar el
// frontend antes que Go. embed.FS es de solo lectura, ideal para servir la UI.
//
//go:embed all:frontend/dist
var assets embed.FS

// main: punto de entrada del binario de escritorio.
//
// TRUCOS DE SINTAXIS QUE APARECEN AQUÍ:
//   - `app := NewApp()` := declara e inicializa en una línea (en Go, una
//     variable declarada y no usada NO compila: := fuerza a que la useas).
//   - `&options.App{...}` literal compuesto POR REFERENCIA: se crea la struct
//     de configuración y se pasa su dirección — Run la conserva durante toda
//     la vida de la app (y evita copiar un struct grande).
//   - Los campos llevan NOMBRE (`Title:`), así que el orden da igual y se
//     puede saltar cualquiera (los que falalten quedan en su valor cero).
//   - `OnStartup: app.startup` — VALOR DE MÉTODO (method value): escribir
//     `app.startup` SIN paréntesis NO llama a la función; toma su dirección
//     como valor func(context.Context) y Wails la invoca DESPUÉS, cuando
//     arranca, pasándole el ctx. `app.startup()` con paréntesis fallaría ya
//     (firma sin argumentos) y sería un error clásico de novato.
//   - `Bind: []interface{}{app}` — slice de "cualquier cosa". Aquí Wails hace
//     la magia: por reflexión descubre los métodos EXPORTADOS de *App
//     (GetMachines, GetSnapshot, WriteTag, Greet) y genera el puente
//     go.main.App.* que usa el frontend. El puntero (App, no *App) importa:
//     solo los métodos con receptor pointer se exponen sobre la instancia viva.
//   - `if err != nil {...}`: el patrón de fallos de Go, siempre igual.
//   - `println` es una primitiva del lenguaje (escribe en stderr, para debug);
//     en código de producción se preferiría log.Println o fmt.Println.
func main() {
	// Create an instance of the app structure
	app := NewApp() // única instancia: la misma que verán OnStartup y Bind

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "myproject",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets, // la UI embebida (frontend/dist)
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		// Callbacks: funciones como VALORES, guardadas para llamarlas después.
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
