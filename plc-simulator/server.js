// Servidor HTTP que simula un PLC.
//
// Un PanelView real se conecta al PLC por un driver (RSLinx/EtherNet-IP) y
// lee/escribe direcciones de memoria del controlador (archivos N, F, B...).
// Aquí no hay PLC físico, así que exponemos esa memoria por HTTP:
//
//   GET  /tags        -> { values: { "N7:0": 120, ... }, ts }
//   POST /read        -> { addresses: ["N7:0"] }  => { values: {...}, ts }
//   POST /write       -> { address, value }       => { ok, address, value }
//   GET  /health      -> { ok, uptimeMs, tags }
//
// El backend Go hace polling de /tags cada pollIntervalMs y reenvía los
// cambios al frontend por eventos de Wails.
//
// Los valores "ro" evolucionan solos según la sección "sim" del tag en
// hmi-config/machines.json; los "rw" solo cambian cuando el HMI escribe.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.HMI_CONFIG ?? path.join(__dirname, "..", "hmi-config", "machines.json");
const PORT = Number(process.env.PLC_PORT ?? 4100);

// ---------------------------------------------------------------- config ---

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

const config = loadConfig();

/** address -> { tag, machine, value } */
const memory = new Map();

for (const machine of config.machines) {
  for (const tag of machine.tags) {
    memory.set(tag.address, { tag, machine, value: tag.default ?? zeroFor(tag.dataType) });
  }
}

function zeroFor(dataType) {
  if (dataType === "bool") return false;
  if (dataType === "string") return "";
  return 0;
}

// ----------------------------------------------------------- simulación ---

const startedAt = Date.now();

function clamp(v, tag) {
  if (typeof v !== "number") return v;
  if (typeof tag.min === "number") v = Math.max(tag.min, v);
  if (typeof tag.max === "number") v = Math.min(tag.max, v);
  return v;
}

function simStep(entry) {
  const { tag, machine, value } = entry;
  const sim = tag.sim;
  if (!sim || sim.kind === "static") return;

  const t = Date.now() - startedAt;
  const addrOf = (name) => machine.tags.find((x) => x.name === name)?.address;
  const read = (addr) => (addr ? memory.get(addr)?.value : undefined);
  const gateOpen = (gateName) => {
    if (!gateName) return true;
    const gateAddr = addrOf(gateName) ?? gateName; // permite nombre o dirección
    return !!read(gateAddr);
  };
  const src = sim.source ? read(addrOf(sim.source) ?? sim.source) : undefined;

  switch (sim.kind) {
    case "sine": {
      const base = sim.base ?? value;
      const period = sim.periodMs ?? 8000;
      entry.value = clamp(
        Number((base + sim.amplitude * Math.sin((2 * Math.PI * t) / period)).toFixed(2)),
        tag,
      );
      break;
    }
    case "follow": {
      if (!gateOpen(sim.gate)) {
        entry.value = clamp(zeroFor(tag.dataType), tag);
        break;
      }
      const target = typeof src === "number" ? src * (sim.scale ?? 1) : value;
      const noise = (Math.random() * 2 - 1) * (sim.noise ?? 0);
      const next = value + (target - value) * 0.2 + noise;
      entry.value = clamp(Number(next.toFixed(2)), tag);
      break;
    }
    case "counter": {
      if (!gateOpen(sim.gate)) break;
      const period = sim.periodMs ?? 1000;
      const ticks = Math.floor(t / period);
      const expected = (sim._base ?? 0) + ticks;
      if (expected !== value) entry.value = clamp(expected, tag);
      break;
    }
    case "boolRandom": {
      if (typeof value !== "boolean") break;
      const p = sim.probability ?? 0.01;
      entry.value = Math.random() < p;
      break;
    }
    case "boolToggle": {
      if (!gateOpen(sim.gate)) {
        entry.value = false;
        break;
      }
      const period = sim.periodMs ?? 1500;
      entry.value = Math.floor(t / period) % 2 === 0;
      break;
    }
    default:
      break;
  }
}

setInterval(() => {
  for (const entry of memory.values()) simStep(entry);
}, 250);

// -------------------------------------------------------------- servidor ---

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function currentValues() {
  const values = {};
  for (const [addr, entry] of memory) values[addr] = entry.value;
  return values;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      uptimeMs: Date.now() - startedAt,
      tags: memory.size,
      plc: config.plc?.name ?? "PLC",
    });
  }

  if (req.method === "GET" && url.pathname === "/tags") {
    return send(res, 200, { values: currentValues(), ts: Date.now() });
  }

  if (req.method === "POST" && url.pathname === "/read") {
    const { addresses } = await readBody(req);
    if (!Array.isArray(addresses)) return send(res, 400, { error: "addresses[] requerido" });
    const values = {};
    for (const a of addresses) {
      const entry = memory.get(a);
      if (entry) values[a] = entry.value;
    }
    return send(res, 200, { values, ts: Date.now() });
  }

  if (req.method === "POST" && url.pathname === "/write") {
    const { address, value } = await readBody(req);
    const entry = memory.get(address);
    if (!entry) return send(res, 404, { error: `Dirección desconocida: ${address}` });

    const { tag } = entry;
    let coerced = value;
    if (tag.dataType === "bool") {
      if (typeof value !== "boolean") return send(res, 400, { error: `Se esperaba bool para ${address}` });
    } else if (typeof value === "number") {
      coerced = tag.dataType === "int16" || tag.dataType === "int32" ? Math.round(value) : value;
      if (typeof tag.min === "number" && coerced < tag.min) {
        return send(res, 400, { error: `Valor ${coerced} < mínimo ${tag.min} (${address})` });
      }
      if (typeof tag.max === "number" && coerced > tag.max) {
        return send(res, 400, { error: `Valor ${coerced} > máximo ${tag.max} (${address})` });
      }
    } else {
      return send(res, 400, { error: `Tipo inválido para ${address}` });
    }

    entry.value = coerced;
    console.log(`[write] ${address} (${tag.name}) = ${JSON.stringify(coerced)}`);
    return send(res, 200, { ok: true, address, value: entry.value });
  }

  send(res, 404, { error: "Ruta no encontrada" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PLC simulado escuchando en http://127.0.0.1:${PORT}`);
  console.log(`  config: ${CONFIG_PATH}`);
  console.log(`  tags en memoria: ${memory.size}`);
});
