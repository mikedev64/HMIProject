// Puente EtherNet/IP para el modo preview.
//
// En el binario de escritorio, el backend Go mantiene la sesión EIP con el
// PLC. Fuera de Wails (`pnpm dev`), el navegador no puede abrir un socket
// TCP, así que el dev server de Vite actúa como el «runtime del PanelView»:
// mantiene la MISMA sesión EIP (RegisterSession + Forward Open + mensajería
// implícita/explícita) contra el simulador y la expone al navegador por
// HTTP/SSE con la forma del snapshot del HMI.
//
// Espejo en TypeScript/Node del eip.go del backend.
import net from "node:net";

// Comandos y servicios CIP (los mismos números que en eip.go y eip.js).
const CMD = { RegisterSession: 0x0065, UnregisterSession: 0x0066, SendRRData: 0x006f, SendUnitData: 0x0070 };
const SVC = { ForwardClose: 0x4e, ForwardOpen: 0x54, ReadTag: 0x4c, WriteTag: 0x4d };

const header = (command, payloadLen, session, context = 0n) => {
        const b = Buffer.alloc(24);
        b.writeUInt16LE(command, 0);
        b.writeUInt16LE(payloadLen, 2);
        b.writeUInt32LE(session, 4);
        b.writeBigUInt64LE(context & 0xffffffffffffffffn, 12);
        return b;
};

// Segmento ANSI de símbolo extendido (0x91), como direcciona Logix las tags.
const symbolPath = (name) => {
        const bytes = Buffer.from(name, "ascii");
        const head = Buffer.alloc(2);
        head[0] = 0x91;
        head[1] = bytes.length;
        return Buffer.concat([head, bytes, Buffer.alloc(bytes.length % 2)]);
};

// Petición CIP sobre SendRRData: [servicio][pathSize words][path][data] con
// 2 items CPF (dirección nula + datos sin conexión 0x00B2).
const cipRequest = (service, path, data = Buffer.alloc(0)) => {
        const cip = Buffer.concat([Buffer.from([service, path.length / 2]), path, data]);
        const head = Buffer.alloc(6);
        const count = Buffer.alloc(2);
        count.writeUInt16LE(2, 0);
        const addr = Buffer.alloc(4);
        const di = Buffer.alloc(4);
        di.writeUInt16LE(0x00b2, 0);
        di.writeUInt16LE(cip.length, 2);
        return Buffer.concat([head, count, addr, di, cip]);
};

// Tamaño CIP de cada tipo del mapa HMI (para decodificar el assembly).
const sizeOf = (dt) => (dt === "bool" ? 1 : dt === "int16" ? 2 : dt === "int32" || dt === "float32" ? 4 : 0);

/**
 * Crea un cliente EIP contra el PLC simulado.
 *   addr   - "host:puerto" EIP del PLC (127.0.0.1:44818)
 *   slots  - [{ address, dataType }] en el orden fijo del assembly
 *   pollMs - RPI pedido (ms)
 */
export function createEipClient({ addr, slots, pollMs }) {
        const sizes = slots.map((s) => sizeOf(s.dataType));
        let socket = null;
        let session = 0;
        let nextCtx = 0n;
        const pending = new Map();
        let buffer = Buffer.alloc(0);

        const state = {
                connected: false,
                error: "",
                ts: 0,
                values: {},
                eip: {
                        connected: false,
                        session: "0x00000000",
                        o2t: "0x00000000",
                        t2o: "0x00000000",
                        serial: 0,
                        rpiMs: 0,
                        seq: 0,
                        lost: 0,
                        packetsRx: 0,
                        packetsTx: 0,
                        endpoint: addr,
                },
        };
        const listeners = new Set();
        const emit = () => listeners.forEach((cb) => cb({ ...state, values: { ...state.values }, eip: { ...state.eip } }));

        const decodeAssembly = (buf) => {
                const values = {};
                let off = 0;
                for (let i = 0; i < slots.length && off + sizes[i] <= buf.length; i++) {
                        const s = slots[i];
                        if (s.dataType === "bool") values[s.address] = buf[off] !== 0;
                        else if (s.dataType === "int16") values[s.address] = buf.readInt16LE(off);
                        else if (s.dataType === "int32") values[s.address] = buf.readInt32LE(off);
                        else if (s.dataType === "float32") values[s.address] = Number(buf.readFloatLE(off).toFixed(4));
                        off += sizes[i];
                }
                return values;
        };

        const handleFrame = (cmd, body, ctx) => {
                if (cmd === CMD.SendUnitData) {
                        // Implícito T->O: [connID(4)][seqcount(4)][items...-> seq(2)][assembly]
                        if (body.length < 10) return;
                        let off = 8;
                        const itemCount = body.readUInt16LE(off);
                        off += 2;
                        for (let i = 0; i < itemCount && off + 4 <= body.length; i++) {
                                const typ = body.readUInt16LE(off);
                                const ln = body.readUInt16LE(off + 2);
                                off += 4;
                                if (off + ln > body.length) return;
                                if (typ === 0x00b2 && ln >= 2) {
                                        const seq = body.readUInt16LE(off);
                                        const values = decodeAssembly(body.subarray(off + 2));
                                        if (state.eip.packetsRx > 0 && (seq !== state.eip.seq + 1) & 0xffff) {
                                                state.eip.lost += (seq - state.eip.seq - 1) & 0xffff;
                                        }
                                        state.eip.seq = seq;
                                        state.eip.packetsRx++;
                                        state.values = values;
                                        state.ts = Date.now();
                                        state.connected = true;
                                        state.error = "";
                                        state.eip.connected = true;
                                        emit();
                                        return;
                                }
                                off += ln;
                        }
                } else if (cmd === CMD.SendRRData) {
                        // Explícito: enruta la respuesta por su sender context.
                        const waiter = pending.get(ctx);
                        if (waiter) {
                                pending.delete(ctx);
                                waiter(body);
                        }
                }
        };

        const pump = () => {
                while (buffer.length >= 24) {
                        const len = buffer.readUInt16LE(2);
                        if (buffer.length < 24 + len) break;
                        const cmd = buffer.readUInt16LE(0);
                        const sess = buffer.readUInt32LE(4);
                        const ctx = buffer.readBigUInt64LE(12);
                        // La respuesta de RegisterSession trae el manejador de sesión.
                        if (cmd === CMD.RegisterSession && sess) session = sess;
                        handleFrame(cmd, buffer.subarray(24, 24 + len), ctx);
                        buffer = buffer.subarray(24 + len);
                }
        };

        const send = (cmd, payload, sess = session, ctx = 0n) => {
                state.eip.packetsTx++;
                socket.write(Buffer.concat([header(cmd, payload.length, sess, ctx), payload]));
        };

        // Envía una petición explícita y espera la respuesta por contexto.
        const request = (cip, timeout = 2000) =>
                new Promise((resolve, reject) => {
                        nextCtx++;
                        const ctx = nextCtx;
                        const timer = setTimeout(() => {
                                pending.delete(ctx);
                                reject(new Error("timeout esperando respuesta CIP"));
                        }, timeout);
                        pending.set(ctx, (body) => {
                                clearTimeout(timer);
                                resolve(body);
                        });
                        send(CMD.SendRRData, cip, session, ctx);
                });

        // Extrae (replyData, status) de una respuesta SendRRData CIP.
        const parseCIP = (body) => {
                let off = 6;
                const itemCount = body.readUInt16LE(off);
                off += 2;
                for (let i = 0; i < itemCount && off + 4 <= body.length; i++) {
                        const typ = body.readUInt16LE(off);
                        const ln = body.readUInt16LE(off + 2);
                        off += 4;
                        if (off + ln > body.length) break;
                        if (typ === 0x00b2) {
                                const data = body.subarray(off, off + ln);
                                if (data.length < 4) return [Buffer.alloc(0), -1];
                                const status = data[2];
                                const extra = data[3] * 2;
                                return [data.subarray(4 + extra), status];
                        }
                        off += ln;
                }
                return [Buffer.alloc(0), -1];
        };

        const connect = () =>
                new Promise((resolve) => {
                        socket = net.createConnection(Number(addr.split(":")[1]) || 44818, addr.split(":")[0]);
                        buffer = Buffer.alloc(0);
                        socket.on("data", (chunk) => {
                                buffer = Buffer.concat([buffer, chunk]);
                                pump();
                        });
                        socket.on("error", (e) => {
                                state.connected = false;
                                state.eip.connected = false;
                                state.error = String(e.message || e);
                                emit();
                        });
                        socket.on("close", () => {
                                state.connected = false;
                                state.eip.connected = false;
                                emit();
                        });
                        socket.on("connect", async () => {
                                // 1) RegisterSession (el manejador de sesión llega en la respuesta).
                                send(CMD.RegisterSession, Buffer.from([1, 0, 0, 0]), 0);
                                await new Promise((r) => setTimeout(r, 120));
                                if (!session) {
                                        state.error = "RegisterSession sin sesión";
                                        resolve(false);
                                        return;
                                }
                                // 2) Forward Open: pide RPI y recibe connection IDs.
                                const fo = Buffer.alloc(39);
                                fo.writeUInt16LE(0x3001, 10);
                                fo.writeUInt32LE(pollMs * 1000, 12);
                                fo.writeUInt32LE(pollMs * 1000, 16);
                                fo[22] = 0x0a;
                                const path = Buffer.from([0x20, 0x06, 0x24, 0x01]);
                                try {
                                        const body = await request(cipRequest(SVC.ForwardOpen, path, fo), 3000);
                                        const [reply, status] = parseCIP(body);
                                        if (status !== 0 || reply.length < 20)
                                                throw new Error(`Forward Open rechazado (status CIP 0x${status.toString(16)})`);
                                        state.eip.o2t = "0x" + reply.readUInt32LE(0).toString(16).toUpperCase().padStart(8, "0");
                                        state.eip.t2o = "0x" + reply.readUInt32LE(4).toString(16).toUpperCase().padStart(8, "0");
                                        state.eip.serial = reply.readUInt16LE(8);
                                        state.eip.rpiMs = Math.round(reply.readUInt32LE(10) / 1000);
                                        state.eip.session = "0x" + session.toString(16).toUpperCase().padStart(8, "0");
                                        state.connected = true;
                                        state.eip.connected = true;
                                        state.error = "";
                                        emit();
                                        resolve(true);
                                } catch (e) {
                                        state.error = String(e.message || e);
                                        state.connected = false;
                                        emit();
                                        resolve(false);
                                }
                        });
                });

        return {
                state,
                async start() {
                        const ok = await connect();
                        return ok;
                },
                getSession() {
                        return session;
                },
                /** Write Tag explícito (0x4D). */
                async writeTag(address, dataType, value) {
                        let data;
                        const code = dataType === "bool" ? 0xc1 : dataType === "int16" ? 0xc3 : dataType === "int32" ? 0xc4 : 0xca;
                        const head = Buffer.alloc(2);
                        head.writeUInt16LE(code, 0);
                        let body;
                        if (dataType === "bool") body = Buffer.from([value ? 1 : 0]);
                        else if (dataType === "int16") {
                                body = Buffer.alloc(2);
                                body.writeInt16LE(Math.round(value), 0);
                        } else if (dataType === "int32") {
                                body = Buffer.alloc(4);
                                body.writeInt32LE(Math.round(value), 0);
                        } else {
                                body = Buffer.alloc(4);
                                body.writeFloatLE(value, 0);
                        }
                        data = Buffer.concat([head, body]);
                        const resp = await request(cipRequest(SVC.WriteTag, symbolPath(address), data));
                        const [, status] = parseCIP(resp);
                        if (status === 0) return { ok: true, value };
                        if (status === 0x04) return { ok: false, error: `el PLC no conoce la tag ${address}` };
                        if (status === 0x13) return { ok: false, error: `el PLC rechazó el valor para ${address} (fuera de rango o tipo)` };
                        return { ok: false, error: `Write Tag ${address} rechazado (status CIP 0x${status.toString(16)})` };
                },
                /** Suscripción a actualizaciones del snapshot. Devuelve el cancelador. */
                onUpdate(cb) {
                        listeners.add(cb);
                        return () => listeners.delete(cb);
                },
                close() {
                        try {
                                socket?.end();
                        } catch {
                                /* ignorado */
                        }
                },
        };
}
