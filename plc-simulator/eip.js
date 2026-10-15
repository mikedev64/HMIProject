// Servidor EtherNet/IP (EIP) + CIP del PLC simulado.
//
// Reproduce el perfil de comunicación que usa un PanelView con un PLC
// Allen-Bradley ControlLogix/CompactLogix por EtherNet/IP sobre TCP/44818:
//
//   1. El origen (HMI) abre una SESIÓN EIP (RegisterSession 0x0065).
//   2. Negocia una conexión de clase 3 con Forward Open (0x54) al
//      Connection Manager (clase 6, instancia 1): pide un RPI y recibe los
//      connection ID (O->T y T->O) y el número de serie.
//   3. MENSAJERÍA IMPLÍCITA (la de producción): el PLC produce paquetes
//      SendUnitData (0x0070) T->O cada RPI con un nº de SECUENCIA de 16 bits
//      y el "assembly" 100 (todas las tags mapeadas, en orden fijo, con su
//      tipo CIP). El HMI los consume y detecta huecos de secuencia.
//   4. MENSAJERÍA EXPLÍCITA (la de servicio): Read Tag (0x4C) / Write Tag
//      (0x4D) sobre SendRRData (0x006F), direccionando la tag por su
//      símbolo (segmento ANSI extendido 0x91), como hace Logix.
//   5. Forward Close (0x4E) al desconectar.
//
// El fichero HTTP de siempre (server.js) sigue vivo como interfaz de
// DIAGNÓSTICO (como la página web de estado de un PLC real): el canal de
// datos del HMI es este socket EIP.
import net from "node:net";
import { encodeValue, decodeTyped, encodeTyped } from "./eip-codec.js";

export const EIP_PORT = Number(process.env.EIP_PORT ?? 44818);

// ------------------------------------------------------------- comandos ---
export const CMD = {
  NOP: 0x0000,
  ListIdentity: 0x0063,
  RegisterSession: 0x0065,
  UnregisterSession: 0x0066,
  SendRRData: 0x006f,
  SendUnitData: 0x0070,
};

// Servicios CIP (los mismos números que usa Logix).
export const SVC = {
  GetAttributesAll: 0x01,
  SetAttributesAll: 0x02,
  ForwardClose: 0x4e,
  ForwardOpen: 0x54,
  ReadTag: 0x4c,
  WriteTag: 0x4d,
};

// Estados general CIP (general status).
export const CIP_OK = 0x00;
export const CIP_PATH_SEGMENT_ERROR = 0x04;
export const CIP_SERVICE_NOT_SUPPORTED = 0x08;
export const CIP_OBJECT_DOES_NOT_EXIST = 0x16;
export const CIP_TOO_MUCH_DATA = 0x13;

// ---------------------------------------------------------- cabecera EIP --
// Cabecera EIP: 24 bytes little-endian:
//   command(2) length(2) sessionHandle(4) status(4) senderContext(8)
//   options(4)
export function buildHeader(command, payloadLen, session, status, context) {
  const buf = Buffer.alloc(24);
  buf.writeUInt16LE(command, 0);
  buf.writeUInt16LE(payloadLen, 2);
  buf.writeUInt32LE(session, 4);
  buf.writeUInt32LE(status, 8);
  (context ?? Buffer.alloc(8)).copy(buf, 12, 0, 8);
  buf.writeUInt32LE(0, 20); // options siempre 0
  return buf;
}

/** Parsea una cabecera EIP devuelta como objeto legible. */
export function parseHeader(buf) {
  return {
    command: buf.readUInt16LE(0),
    length: buf.readUInt16LE(2),
    session: buf.readUInt32LE(4),
    status: buf.readUInt32LE(8),
    context: buf.subarray(12, 20),
  };
}

// ----------------------------------------------------------- respuestas ---
/**
 * Respuesta CIP: 0x80|servicio, reservado, status, nº de words de «additional
 * status» (0 aquí) + el reply data del servicio (p.ej. los 39 B de Forward
 * Open o el par [tipo][valor] de Read Tag).
 */
export function cipResponse(service, status, extra = Buffer.alloc(0)) {
  return Buffer.concat([
    Buffer.from([service | 0x80, 0x00, status, 0x00]),
    extra,
  ]);
}

/** Item de datos del Common Packet Format (tipo 0x00B2 = datos sin conexión). */
export function cpfData(data) {
  const item = Buffer.alloc(4);
  item.writeUInt16LE(0x00b2, 0);
  item.writeUInt16LE(data.length, 2);
  return Buffer.concat([item, data]);
}

/** Item nulo de dirección (type 0x0000, length 0). */
export function cpfNullAddress() {
  return Buffer.from([0x00, 0x00, 0x00, 0x00]);
}

/**
 * Payload de SendRRData: handle de interfaz (0) + timeout + CPF
 * (2 items: dirección nula + datos).
 */
export function sendRRDataPayload(cip) {
  const head = Buffer.alloc(6);
  head.writeUInt32LE(0, 0); // interface handle: 0 = CIP
  head.writeUInt16LE(0, 4); // timeout (0 = sin timeout explícito)
  const count = Buffer.alloc(2);
  count.writeUInt16LE(2, 0); // 2 items
  return Buffer.concat([head, count, cpfNullAddress(), cpfData(cip)]);
}

// ----------------------------------------------------- símbolos Logix ----
// Segmento ANSI de símbolo extendido (0x91): 0x91, longitud, bytes, y pad
// a byte par si la longitud es impar. Así se direccionan las tags en Logix.
export function parseSymbolPath(path) {
  if (path.length < 2 || path[0] !== 0x91) return null;
  const len = path[1];
  if (path.length < 2 + len) return null;
  return path.subarray(2, 2 + len).toString("ascii");
}

export function buildSymbolPath(name) {
  const bytes = Buffer.from(name, "ascii");
  const pad = bytes.length % 2; // el segmento se alinea a word
  const head = Buffer.alloc(2);
  head[0] = 0x91;
  head[1] = bytes.length;
  return Buffer.concat([head, bytes, Buffer.alloc(pad)]);
}

// ----------------------------------------------------------- assembly ----
// El "assembly" 100 (T->O) empaqueta TODAS las tags mapeadas en orden fijo
// (el orden del mapa HMI), cada una con su tamaño CIP: bool=1, int16=2,
// int32=4, float32=4. Es el equivalente al tag-level implicit messaging de
// un PanelView: layout acordado en el proyecto, no auto-descrito en el cable.
export function buildAssembly(memory, order) {
  const chunks = [];
  for (const address of order) {
    const entry = memory.get(address);
    if (!entry) continue;
    chunks.push(encodeValue(entry.tag.dataType, entry.value));
  }
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------ servidor ----
let nextSession = 0x11111100;
let nextConnId = 0x22222200;
let nextSerial = 0x3001;

/**
 * Arranca el servidor EIP sobre TCP. Devuelve { server, stop }.
 *
 * `memory` es el mapa address->{tag,machine,value} del simulador y `order`
 * el orden fijo de direcciones del assembly (se inyecta desde server.js
 * para compartir la memoria con la interfaz HTTP de diagnóstico).
 */
export function startEipServer({ memory, order, port = EIP_PORT }) {
  const startedAt = Date.now();
  const sockets = new Set();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);

    // Estado de la conexión EIP de este origen.
    const state = {
      session: 0,
      conn: null, // { o2t, t2o, serial, rpiMs, timer, seq, produced }
      buffer: Buffer.alloc(0),
    };

    const send = (command, payload, session = state.session, status = 0, context) =>
      socket.write(Buffer.concat([buildHeader(command, payload.length, session, status, context), payload]));

    const closeConn = (reason) => {
      if (!state.conn) return;
      clearInterval(state.conn.timer);
      console.log(`[eip] conn ${state.conn.serial} cerrada (${reason})`);
      state.conn = null;
    };

    socket.on("data", (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      while (state.buffer.length >= 24) {
        const header = parseHeader(state.buffer);
        if (state.buffer.length < 24 + header.length) break; // trama incompleta
        const payload = state.buffer.subarray(24, 24 + header.length);
        state.buffer = state.buffer.subarray(24 + header.length);
        handleFrame(header, payload);
      }
    });

    const handleFrame = (header, payload) => {
      const reply = (cip) => send(CMD.SendRRData, sendRRDataPayload(cip), state.session, 0, header.context);

      switch (header.command) {
        // --- RegisterSession: asigna el manejador de sesión EIP.
        case CMD.RegisterSession: {
          state.session = ++nextSession;
          const resp = Buffer.alloc(4);
          resp.writeUInt16LE(1, 0); // versión de protocolo
          resp.writeUInt16LE(0, 2); // opciones
          send(CMD.RegisterSession, resp, state.session, 0, header.context);
          console.log(`[eip] session ${state.session.toString(16)} registrada`);
          break;
        }

        // --- UnregisterSession: sin payload, solo se cierra.
        case CMD.UnregisterSession:
          socket.end();
          break;

        // --- ListIdentity: identidad del "controlador" (como un
        //     ListIdentity de EtherNet/IP de verdad).
        case CMD.ListIdentity: {
          const name = Buffer.from("PLC-SIM-EIP", "ascii");
          const item = Buffer.alloc(63 + name.length);
          item.writeUInt16LE(0x000c, 0); // item type: Identity
          item.writeUInt16LE(item.length - 4, 2);
          item.writeUInt16LE(1, 4); // encapsulation protocol version
          item.writeUInt32LE(0, 6); // sockaddr (sin IPv4 real: a 0)
          item.writeUInt16LE(0x0001, 22); // vendor id: Rockwell Automation
          item.writeUInt16LE(0x000e, 24); // device type: PLC
          item.writeUInt16LE(0x0064, 26); // product code
          item.writeUInt8(1, 28); // major revision
          item.writeUInt8(0, 29); // minor revision
          item.writeUInt16LE(0, 30); // status
          item.writeUInt32LE(0x504c4353, 32); // serial "PLCS"
          item.writeUInt8(name.length, 36);
          name.copy(item, 37);
          const count = Buffer.alloc(2);
          count.writeUInt16LE(1, 0);
          send(CMD.ListIdentity, Buffer.concat([count, item]), state.session, 0, header.context);
          break;
        }

        // --- SendRRData: mensajería EXPLÍCITA (Forward Open/Close,
        //     Read/Write Tag).
        case CMD.SendRRData: {
          // Payload: interface handle(4) timeout(2) itemCount(2) [addr item] [data item]
          if (state.session === 0) {
            send(CMD.SendRRData, Buffer.alloc(0), 0, 0x0001, header.context); // sin sesión
            break;
          }
          const itemCount = payload.readUInt16LE(6);
          let off = 8;
          for (let i = 0; i < itemCount; i++) {
            const type = payload.readUInt16LE(off);
            const len = payload.readUInt16LE(off + 2);
            if (type === 0x00b2) {
              handleCip(payload.subarray(off + 4, off + 4 + len), reply);
            }
            off += 4 + len;
          }
          break;
        }

        // --- SendUnitData: solo acepta el HMI->PLC (O->T) como keepalive;
        //     la producción T->O la manda el propio PLC (más abajo).
        case CMD.SendUnitData:
          break;

        default:
          send(header.command, Buffer.alloc(0), state.session, 0x0001, header.context); // comando desconocido
          break;
      }
    };

    // --- Servicios CIP explícitos ------------------------------------------
    const handleCip = (cip, reply) => {
      const service = cip[0];
      const pathSize = cip[1] * 2;
      const path = cip.subarray(2, 2 + pathSize);
      const data = cip.subarray(2 + pathSize);

      switch (service) {
        // Forward Open (0x54): negocia la conexión de clase 3.
        // Request: priority/ticks, timeout, O->T id, T->O id, serial,
        //          O->T RPI, T->O RPI, params, trigger, path.
        case SVC.ForwardOpen: {
          const o2tReq = data.readUInt32LE(2);
          const t2oReq = data.readUInt32LE(6);
          const serialReq = data.readUInt16LE(10);
          const o2tRpiUs = data.readUInt32LE(12);
          const t2oRpiUs = data.readUInt32LE(16);
          closeConn("nueva Forward Open");

          const o2t = o2tReq || ++nextConnId;
          const t2o = t2oReq || ++nextConnId;
          const serial = serialReq || ++nextSerial;
          // El RPI pedido está en microsegundos; el simulador produce en ms
          // (mínimo 20 ms para no martillear el event loop de Node).
          const rpiMs = Math.max(20, Math.round((t2oRpiUs || o2tRpiUs || 500000) / 1000));

          const seq = { value: 0, produced: 0 };
          const timer = setInterval(() => {
            if (socket.destroyed) return;
            const assembly = buildAssembly(memory, order);
            const seqBuf = Buffer.alloc(2);
            seqBuf.writeUInt16LE(seq.value & 0xffff, 0); // secuencia de 16 bits
            const unit = Buffer.alloc(8);
            unit.writeUInt32LE(t2o, 0); // connection ID T->O
            unit.writeUInt32LE(1, 4); // sequence count del paquete
            const count = Buffer.alloc(2);
            count.writeUInt16LE(2, 0);
            const dataItem = Buffer.alloc(4);
            dataItem.writeUInt16LE(0x00b2, 0);
            dataItem.writeUInt16LE(seqBuf.length + assembly.length, 2);
            socket.write(
              Buffer.concat([
                buildHeader(
                  CMD.SendUnitData,
                  unit.length + count.length + 4 + dataItem.length + seqBuf.length + assembly.length,
                  state.session,
                ),
                unit,
                count,
                Buffer.from([0x00, 0x00, 0x00, 0x00]), // dirección nula
                dataItem,
                seqBuf,
                assembly,
              ]),
            );
            seq.value = (seq.value + 1) & 0xffff;
            seq.produced++;
          }, rpiMs);

          state.conn = { o2t, t2o, serial, rpiMs, timer, seq: seq.value, produced: 0 };
          console.log(`[eip] conn ${serial}: RPI ${rpiMs} ms, T->O ${t2o.toString(16)}`);

          // Response: O->T id, T->O id, serial, RPI O->T, RPI T->O, params,
          //           name size, app reply name.
          const resp = Buffer.alloc(39);
          resp.writeUInt32LE(o2t, 0);
          resp.writeUInt32LE(t2o, 4);
          resp.writeUInt16LE(serial, 8);
          resp.writeUInt32LE(rpiMs * 1000, 10);
          resp.writeUInt32LE(rpiMs * 1000, 14);
          resp.writeUInt16LE(0x43ff, 18); // connection parameters
          resp.writeUInt8(0, 20); // name size
          resp.writeUInt16LE(0, 21); // app reply size
          reply(cipResponse(service, CIP_OK, resp));
          break;
        }

        // Forward Close (0x4E): cierra la conexión de clase 3.
        case SVC.ForwardClose: {
          const serial = data.readUInt16LE(2);
          closeConn(`Forward Close del origen (serial ${serial})`);
          const resp = Buffer.alloc(6);
          resp.writeUInt16LE(serial, 0);
          reply(cipResponse(service, CIP_OK, resp));
          break;
        }

        // Read Tag (0x4C): [0x91 len nombre] -> [tipo(2)][valor].
        case SVC.ReadTag: {
          const name = parseSymbolPath(path);
          const entry = name ? memory.get(name) : null;
          if (!entry) {
            reply(cipResponse(service, CIP_PATH_SEGMENT_ERROR));
            break;
          }
          reply(cipResponse(service, CIP_OK, encodeTyped(entry.tag.dataType, entry.value)));
          break;
        }

        // Write Tag (0x4D): [0x91 len nombre][tipo(2)][valor].
        case SVC.WriteTag: {
          const name = parseSymbolPath(path);
          const entry = name ? memory.get(name) : null;
          if (!entry) {
            reply(cipResponse(service, CIP_PATH_SEGMENT_ERROR));
            break;
          }
          const value = decodeTyped(data, 0);
          if (value === null) {
            reply(cipResponse(service, CIP_TOO_MUCH_DATA));
            break;
          }
          // Mismas reglas que la interfaz HTTP: rangos y coerción.
          const { tag } = entry;
          let coerced = value;
          if (typeof value === "number") {
            coerced = tag.dataType === "int16" || tag.dataType === "int32" ? Math.round(value) : value;
            if (typeof tag.min === "number" && coerced < tag.min) {
              reply(cipResponse(service, CIP_TOO_MUCH_DATA));
              break;
            }
            if (typeof tag.max === "number" && coerced > tag.max) {
              reply(cipResponse(service, CIP_TOO_MUCH_DATA));
              break;
            }
          }
          entry.value = coerced;
          entry.manual = true; // anula la simulación (fuerza manual)
          console.log(`[eip] write ${name} = ${JSON.stringify(coerced)}`);
          reply(cipResponse(service, CIP_OK));
          break;
        }

        default:
          reply(cipResponse(service, CIP_SERVICE_NOT_SUPPORTED));
          break;
      }
    };

    socket.on("close", () => {
      sockets.delete(socket);
      if (state.conn) {
        clearInterval(state.conn.timer);
        console.log(`[eip] conn ${state.conn.serial}: origen desconectado`);
        state.conn = null;
      }
    });
    socket.on("error", () => socket.destroy());
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`PLC simulado EIP/CIP escuchando en tcp://127.0.0.1:${port} (EtherNet/IP)`);
    console.log(`  uptime base: ${startedAt > 0 ? "ok" : "?"}, tags en assembly: ${order.length}`);
  });

  return {
    server,
    stop() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}
