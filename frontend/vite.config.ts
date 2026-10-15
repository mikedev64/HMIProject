import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { createEipClient } from "./eip-bridge.mjs";

/*
 * En modo preview (vite dev sin el binario de Wails) el frontend necesita el
 * mapa HMI y los usuarios para verificar el login:
 *
 *  - GET /hmi-config/machines.json -> se agrega al vuelo desde app.json +
 *    machines/*.json (mismo formato que devuelve GetMachines() en Go).
 *  - GET /hmi-config/<cualquier.json> -> ficheros sueltos (p.ej. users.json,
 *    que el preview usa con WebCrypto/PBKDF2 para verificar la contraseña).
 *
 * En la app compilada, el backend Go tiene todo embebido (go:embed).
 */
function hmiConfigPreview(): Plugin {
        const configDir = fileURLToPath(new URL("../hmi-config/", import.meta.url));

        const sendJson = (res: import("node:http").ServerResponse, data: unknown, status = 200) => {
                res.statusCode = status;
                res.setHeader("Content-Type", "application/json");
                res.end(typeof data === "string" ? data : JSON.stringify(data));
        };

        return {
                name: "hmi-config-preview",
                configureServer(server) {
                        server.middlewares.use((req, res, next) => {
                                const pathname = req.url?.split("?")[0] ?? "";
                                if (!pathname.startsWith("/hmi-config/")) return next();

                                import("node:fs").then((fs) => {
                                        try {
                                                if (pathname === "/hmi-config/machines.json") {
                                                        const app = JSON.parse(fs.readFileSync(configDir + "app.json", "utf8"));
                                                        const dir = configDir + "machines";
                                                        const machines = fs
                                                                .readdirSync(dir)
                                                                .filter((f) => f.endsWith(".json"))
                                                                .sort()
                                                                .map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")));
                                                        sendJson(res, { ...app, machines });
                                                        return;
                                                }

                                                // Recetas por máquina (hmi-config/recipes/<id>.json).
                                                const recipes = /^\/hmi-config\/recipes\/([A-Za-z0-9._-]+\.json)$/.exec(pathname);
                                                if (recipes) {
                                                        fs.readFile(`${configDir}recipes/${recipes[1]}`, (err, data) => {
                                                                if (err) {
                                                                        sendJson(res, [], 200); // sin recetas todavía
                                                                        return;
                                                                }
                                                                sendJson(res, data.toString("utf8"));
                                                        });
                                                        return;
                                                }

                                                // Ficheros sueltos (users.json): solo nombres simples, sin traversals.
                                                const name = pathname.slice("/hmi-config/".length);
                                                if (!/^[A-Za-z0-9._-]+\.json$/.test(name) || name.startsWith(".")) {
                                                        sendJson(res, { error: "no encontrado" }, 404);
                                                        return;
                                                }
                                                fs.readFile(configDir + name, (err, data) => {
                                                        if (err) {
                                                                sendJson(res, { error: `${name} no encontrado` }, 404);
                                                                return;
                                                        }
                                                        sendJson(res, data.toString("utf8"));
                                                });
                                        } catch (e) {
                                                sendJson(res, { error: String(e) }, 500);
                                        }
                                });
                        });
                },
        };
}

/*
 * Puente EtherNet/IP para el modo preview.
 *
 * Fuera del binario Go, el navegador no puede abrir un socket TCP, así que
 * el dev server actúa como el «runtime del PanelView»: mantiene la MISMA
 * sesión EIP (RegisterSession + Forward Open + mensajería implícita) contra
 * el simulador y la expone por HTTP/SSE:
 *
 *   GET  /eip/state  -> snapshot { connected, ts, values, eip }
 *   POST /eip/write  -> { address, dataType, value } (Write Tag explícito)
 *   GET  /eip/stream -> SSE con los snapshots (como el evento plc:update)
 */
function eipPreview(): Plugin {
        const configDir = fileURLToPath(new URL("../hmi-config/", import.meta.url));
        let client: ReturnType<typeof createEipClient> | null = null;
        let starting: Promise<boolean> | null = null;

        const ensureClient = async () => {
                if (client) return client;
                if (!starting) {
                        starting = (async () => {
                                const fs = await import("node:fs");
                                const app = JSON.parse(fs.readFileSync(configDir + "app.json", "utf8"));
                                const dir = configDir + "machines";
                                const machines = fs
                                        .readdirSync(dir)
                                        .filter((f) => f.endsWith(".json"))
                                        .sort()
                                        .map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")));
                                // Orden fijo del assembly: machines alfabéticas, tags en su orden.
                                const slots: { address: string; dataType: string }[] = [];
                                for (const m of machines) for (const t of m.tags) slots.push({ address: t.address, dataType: t.dataType });
                                const endpoint: string = app.plc?.endpoint ?? "eip://127.0.0.1:44818";
                                const addr = endpoint
                                        .replace(/^eip:\/\//, "")
                                        .replace(/^https?:\/\//, "")
                                        .split("/")[0];
                                client = createEipClient({ addr: addr || "127.0.0.1:44818", slots, pollMs: app.plc?.pollIntervalMs || 500 });
                                await client.start();
                                return true;
                        })();
                }
                await starting;
                return client;
        };

        return {
                name: "hmi-eip-preview",
                configureServer(server) {
                        // Montado en "/eip": req.url llega SIN ese prefijo (/state, /write, /stream).
                        server.middlewares.use("/eip", async (req, res) => {
                                const url = new URL(req.url ?? "/", "http://localhost");
                                const send = (status: number, body: unknown) => {
                                        res.statusCode = status;
                                        res.setHeader("Content-Type", "application/json");
                                        res.end(JSON.stringify(body));
                                };

                                // SSE: suscripción a los snapshots (stream del PLC).
                                if (url.pathname === "/stream" && req.method === "GET") {
                                        res.setHeader("Content-Type", "text/event-stream");
                                        res.setHeader("Cache-Control", "no-cache");
                                        res.setHeader("Connection", "keep-alive");
                                        res.flushHeaders?.();
                                        const c = await ensureClient();
                                        const push = (snap: unknown) => res.write(`data: ${JSON.stringify(snap)}\n\n`);
                                        push(c.state);
                                        const off = c.onUpdate(push);
                                        req.on("close", () => {
                                                off();
                                        });
                                        return;
                                }

                                // Estado actual del snapshot EIP.
                                if (url.pathname === "/state" && req.method === "GET") {
                                        const c = await ensureClient();
                                        return send(200, c.state);
                                }

                                // Write Tag explícito.
                                if (url.pathname === "/write" && req.method === "POST") {
                                        let raw = "";
                                        req.on("data", (chunk) => (raw += chunk));
                                        req.on("end", async () => {
                                                try {
                                                        const { address, dataType, value } = JSON.parse(raw || "{}");
                                                        const c = await ensureClient();
                                                        if (!c.state.eip.connected) return send(503, { error: "sin sesión EIP con el PLC" });
                                                        const out = await c.writeTag(address, dataType, value);
                                                        return send(out.ok ? 200 : 400, out);
                                                } catch (e) {
                                                        return send(500, { error: String(e) });
                                                }
                                        });
                                        return;
                                }

                                send(404, { error: "ruta EIP no encontrada" });
                        });
                },
        };
}

// https://vitejs.dev/config/
export default defineConfig({
        plugins: [preact(), hmiConfigPreview(), eipPreview()],
});
