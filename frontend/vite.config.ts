import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

/*
 * En modo preview (vite dev sin el binario de Wails) el frontend necesita el
 * mapa HMI: sirvemos hmi-config/machines.json desde la raíz del repo. En la
 * app compilada, el backend Go lo tiene embebido (go:embed).
 */
function hmiConfigPreview(): Plugin {
        return {
                name: "hmi-config-preview",
                configureServer(server) {
                        server.middlewares.use((req, res, next) => {
                                if (req.url?.split("?")[0] !== "/hmi-config/machines.json") return next();
                                import("node:fs").then((fs) => {
                                        fs.readFile(new URL("../hmi-config/machines.json", import.meta.url), (err, data) => {
                                                if (err) {
                                                        res.statusCode = 404;
                                                        res.end(JSON.stringify({ error: "machines.json no encontrado" }));
                                                        return;
                                                }
                                                res.setHeader("Content-Type", "application/json");
                                                res.end(data);
                                        });
                                });
                        });
                },
        };
}

// https://vitejs.dev/config/
export default defineConfig({
        plugins: [preact(), hmiConfigPreview()],
});
