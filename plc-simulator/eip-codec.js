// Codificación de valores CIP: los tipos de dato de Allen-Bradley.
//
//   BOOL   (0xC1) -> 1 byte   0|1
//   INT    (0xC3) -> 2 bytes  little-endian con signo
//   DINT   (0xC4) -> 4 bytes  little-endian con signo
//   REAL   (0xCA) -> 4 bytes  IEEE-754 little-endian
//
// El mapa HMI usa nombres propios (bool, int16, int32, float32); cipTypeFor
// los traduce al código real que viaja por el cable, igual que hace el
// factory protocol de Logix en Read/Write Tag.

export const CIP_TYPE = {
  BOOL: 0xc1,
  INT: 0xc3,
  DINT: 0xc4,
  REAL: 0xca,
};

/** Tamaño en bytes que ocupa cada tipo en el assembly y en el cable. */
export function cipTypeFor(dataType) {
  switch (dataType) {
    case "bool":
      return CIP_TYPE.BOOL;
    case "int16":
      return CIP_TYPE.INT;
    case "int32":
      return CIP_TYPE.DINT;
    case "float32":
      return CIP_TYPE.REAL;
    default:
      return null;
  }
}

/** Tamaño del valor (sin la cabecera de tipo) para un dataType del mapa. */
export function sizeOf(dataType) {
  switch (dataType) {
    case "bool":
      return 1;
    case "int16":
      return 2;
    case "int32":
    case "float32":
      return 4;
    default:
      return 0;
  }
}

/** Serializa un valor a sus bytes CIP (sin código de tipo). */
export function encodeValue(dataType, value) {
  switch (dataType) {
    case "bool": {
      const b = Buffer.alloc(1);
      b[0] = value ? 1 : 0;
      return b;
    }
    case "int16": {
      const b = Buffer.alloc(2);
      b.writeInt16LE(Math.round(Number(value) || 0), 0);
      return b;
    }
    case "int32": {
      const b = Buffer.alloc(4);
      b.writeInt32LE(Math.round(Number(value) || 0), 0);
      return b;
    }
    case "float32": {
      const b = Buffer.alloc(4);
      b.writeFloatLE(Number(value) || 0, 0);
      return b;
    }
    default:
      return Buffer.alloc(0);
  }
}

/** Decodifica bytes CIP a un valor JS según el dataType del mapa. */
export function decodeValue(dataType, buf, offset = 0) {
  switch (dataType) {
    case "bool":
      return buf[offset] !== 0;
    case "int16":
      return buf.readInt16LE(offset);
    case "int32":
      return buf.readInt32LE(offset);
    case "float32":
      return Number(buf.readFloatLE(offset).toFixed(4));
    default:
      return null;
  }
}

/**
 * Decodifica un valor con su código de tipo CIP en la cabecera
 * (formato de Read/Write Tag: [tipo(2)][valor]).
 */
export function decodeTyped(buf, offset = 0) {
  const type = buf.readUInt16LE(offset) & 0x0ff;
  const body = buf.subarray(offset + 2);
  switch (type) {
    case CIP_TYPE.BOOL:
      return body.length ? body[0] !== 0 : false;
    case CIP_TYPE.INT:
      return body.length >= 2 ? body.readInt16LE(0) : 0;
    case CIP_TYPE.DINT:
      return body.length >= 4 ? body.readInt32LE(0) : 0;
    case CIP_TYPE.REAL:
      return body.length >= 4 ? Number(body.readFloatLE(0).toFixed(4)) : 0;
    default:
      return null;
  }
}

/** Cabecera [tipo(2 LE)][valor] para Write Tag / Read Tag response. */
export function encodeTyped(dataType, value) {
  const code = cipTypeFor(dataType);
  if (code === null) return Buffer.alloc(0);
  const head = Buffer.alloc(2);
  head.writeUInt16LE(code, 0);
  return Buffer.concat([head, encodeValue(dataType, value)]);
}
