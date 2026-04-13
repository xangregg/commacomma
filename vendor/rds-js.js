// src/errors.ts
var RdsError = class extends Error {
  name = "RdsError";
};
var UnsupportedTypeError = class extends Error {
  constructor(message, sexpType) {
    super(message);
    this.sexpType = sexpType;
  }
  sexpType;
  name = "UnsupportedTypeError";
};

// src/decompress.ts
var GZIP_MAGIC_0 = 31;
var GZIP_MAGIC_1 = 139;
var BZIP2_MAGIC_0 = 66;
var BZIP2_MAGIC_1 = 90;
var XZ_MAGIC_0 = 253;
var XZ_MAGIC_1 = 55;
async function decompress(data) {
  if (data.length < 2) {
    throw new RdsError("Input too short to be a valid RDS file");
  }
  const b0 = data[0];
  const b1 = data[1];
  if (b0 === BZIP2_MAGIC_0 && b1 === BZIP2_MAGIC_1) {
    throw new RdsError("Unsupported compression: bzip2. Only gzip is supported.");
  }
  if (b0 === XZ_MAGIC_0 && b1 === XZ_MAGIC_1) {
    throw new RdsError("Unsupported compression: xz. Only gzip is supported.");
  }
  if (b0 === GZIP_MAGIC_0 && b1 === GZIP_MAGIC_1) {
    return decompressGzip(data);
  }
  return data;
}
async function decompressGzip(data) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const writePromise = writer.write(data).then(() => writer.close());
  const chunks = [];
  let totalLength = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }
  await writePromise;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// src/reader.ts
var RdsReader = class {
  view;
  bytes;
  pos;
  constructor(data) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = 0;
  }
  get position() {
    return this.pos;
  }
  get remaining() {
    return this.bytes.byteLength - this.pos;
  }
  readByte() {
    this.ensureAvailable(1);
    const value = this.bytes[this.pos];
    this.pos += 1;
    return value;
  }
  readInt() {
    this.ensureAvailable(4);
    const value = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return value;
  }
  readDouble() {
    this.ensureAvailable(8);
    const value = this.view.getFloat64(this.pos, false);
    this.pos += 8;
    return value;
  }
  readBytes(length) {
    this.ensureAvailable(length);
    const slice = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }
  /** Read a format character (single ASCII byte) for the serialization header. */
  readFormatByte() {
    const byte = this.readByte();
    if (this.pos < this.bytes.byteLength && this.bytes[this.pos] === 10) {
      this.pos += 1;
    }
    return String.fromCharCode(byte);
  }
  ensureAvailable(n) {
    if (this.pos + n > this.bytes.byteLength) {
      throw new RdsError(
        `Unexpected end of data: needed ${n} bytes at offset ${this.pos}, but only ${this.remaining} remain`
      );
    }
  }
};

// src/types.ts
var SEXP = {
  NIL: 0,
  SYM: 1,
  LIST: 2,
  // pairlist (dotted pair)
  CHAR: 9,
  LGL: 10,
  INT: 13,
  REAL: 14,
  CPLX: 15,
  STR: 16,
  VEC: 19,
  // generic vector (list)
  RAW: 24
};
var PSEUDO = {
  ALTREP: 238,
  NILVALUE: 254,
  GLOBALENV: 253,
  EMPTYENV: 242,
  BASEENV: 241,
  BASENAMESPACE: 247,
  NAMESPACESXP: 249,
  PACKAGESXP: 250,
  MISSINGARG: 251,
  REF: 255
};
var FLAGS = {
  TYPE_MASK: 255,
  OBJECT_BIT: 256,
  ATTR_BIT: 512,
  TAG_BIT: 1024,
  GP_SHIFT: 12,
  GP_MASK: 268431360
};
var NA = {
  INTEGER: -2147483648,
  // 0x80000000 as signed int32
  // NA_REAL is a specific NaN: 0x7FF00000000007A2
  REAL_HI: 2146435072,
  REAL_LO: 1954
};
var CHAR_ENCODING = {
  LATIN1: 4,
  UTF8: 8,
  BYTES: 32
};
var SUPPORTED_VERSIONS = [2, 3];

// src/parser.ts
var textDecoder = new TextDecoder("utf-8");
var latin1Decoder = new TextDecoder("latin1");
var RefTable = class {
  refs = [];
  add(obj) {
    this.refs.push(obj);
    return this.refs.length;
  }
  get(index) {
    if (index < 1 || index > this.refs.length) {
      throw new RdsError(`Invalid reference index: ${index}`);
    }
    return this.refs[index - 1];
  }
};
function parseStream(data) {
  const reader = new RdsReader(data);
  const format = reader.readFormatByte();
  if (format !== "X") {
    throw new RdsError(
      `Unsupported serialization format: "${format}". Only XDR binary format ("X") is supported.`
    );
  }
  const version = reader.readInt();
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new RdsError(`Unsupported serialization version: ${version}. Expected 2 or 3.`);
  }
  reader.readInt();
  reader.readInt();
  if (version === 3) {
    const encodingLen = reader.readInt();
    reader.readBytes(encodingLen);
  }
  const refTable = new RefTable();
  return readItem(reader, refTable);
}
function readItem(reader, refs) {
  const flags = reader.readInt();
  const sexpType = flags & FLAGS.TYPE_MASK;
  const hasAttributes = (flags & FLAGS.ATTR_BIT) !== 0;
  const hasTag = (flags & FLAGS.TAG_BIT) !== 0;
  const isObject = (flags & FLAGS.OBJECT_BIT) !== 0;
  const gpFlags = (flags & FLAGS.GP_MASK) >>> FLAGS.GP_SHIFT;
  switch (sexpType) {
    case SEXP.NIL:
    case PSEUDO.NILVALUE:
      return null;
    case PSEUDO.GLOBALENV:
    case PSEUDO.EMPTYENV:
    case PSEUDO.BASEENV:
    case PSEUDO.BASENAMESPACE:
      return null;
    case PSEUDO.REF: {
      const refIndex = unpackRefIndex(flags);
      return refs.get(refIndex);
    }
    case PSEUDO.NAMESPACESXP:
    case PSEUDO.PACKAGESXP: {
      const info = readPersistentNames(reader, refs);
      refs.add(info);
      return info;
    }
    case SEXP.SYM:
      return readSymbol(reader, refs);
    case SEXP.LIST:
      return readPairlist(reader, refs, hasAttributes, hasTag);
    case SEXP.CHAR:
      return readCharsxp(reader, gpFlags);
    case SEXP.LGL:
      return readLogicalVector(reader, refs, hasAttributes);
    case SEXP.INT:
      return readIntegerVector(reader, refs, hasAttributes, isObject);
    case SEXP.REAL:
      return readRealVector(reader, refs, hasAttributes, isObject);
    case SEXP.STR:
      return readStringVector(reader, refs, hasAttributes);
    case SEXP.VEC:
      return readGenericVector(reader, refs, hasAttributes, isObject);
    case SEXP.RAW:
      return readRawVector(reader, refs, hasAttributes);
    case SEXP.CPLX:
      return readComplexVector(reader, refs, hasAttributes);
    case PSEUDO.ALTREP:
      return readAltrep(reader, refs);
    default:
      throw new UnsupportedTypeError(
        `Unsupported R type: SEXPTYPE ${sexpType}. Only tabular data types are supported.`,
        sexpType
      );
  }
}
function unpackRefIndex(flags) {
  const index = flags >>> 8;
  return index === 0 ? -1 : index;
}
function readPersistentNames(reader, refs) {
  const names = [];
  for (; ; ) {
    const item = readItem(reader, refs);
    if (item === null) break;
    if (typeof item === "string") names.push(item);
  }
  return names;
}
function readSymbol(reader, refs) {
  const charValue = readItem(reader, refs);
  if (typeof charValue !== "string") {
    throw new RdsError("Expected CHARSXP for symbol name");
  }
  refs.add(charValue);
  return charValue;
}
function readCharsxp(reader, gpFlags) {
  const length = reader.readInt();
  if (length === -1) {
    return null;
  }
  const bytes = reader.readBytes(length);
  if (gpFlags & CHAR_ENCODING.LATIN1) {
    return latin1Decoder.decode(bytes);
  }
  return textDecoder.decode(bytes);
}
function readPairlist(reader, refs, hasAttributes, hasTag) {
  const attrs = {};
  if (hasAttributes) {
    readItem(reader, refs);
  }
  let tag = null;
  if (hasTag) {
    const tagValue = readItem(reader, refs);
    tag = typeof tagValue === "string" ? tagValue : null;
  }
  const value = readItem(reader, refs);
  if (tag !== null) {
    attrs[tag] = value;
  }
  const rest = readItem(reader, refs);
  if (rest !== null && typeof rest === "object" && !Array.isArray(rest)) {
    Object.assign(attrs, rest);
  }
  return attrs;
}
function readAttributes(reader, refs) {
  const attrs = readItem(reader, refs);
  if (attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)) {
    return attrs;
  }
  return {};
}
function readLength(reader) {
  const len = reader.readInt();
  if (len === -1) {
    const hi = reader.readInt();
    const lo = reader.readInt();
    return hi * 4294967296 + (lo >>> 0);
  }
  return len;
}
function readLogicalVector(reader, refs, hasAttributes) {
  const length = readLength(reader);
  const result = new Array(length);
  for (let i = 0; i < length; i++) {
    const val = reader.readInt();
    result[i] = val === NA.INTEGER ? null : val !== 0;
  }
  if (hasAttributes) {
    const attrs = readAttributes(reader, refs);
    if (attrs.label != null) result.__label = String(attrs.label);
  }
  return result;
}
function readIntegerVector(reader, refs, hasAttributes, isObject) {
  const length = readLength(reader);
  const raw = new Array(length);
  for (let i = 0; i < length; i++) {
    const val = reader.readInt();
    raw[i] = val === NA.INTEGER ? null : val;
  }
  if (!hasAttributes) return raw;
  const attrs = readAttributes(reader, refs);
  let result = raw;
  if (isObject && isFactor(attrs)) {
    const levels = attrs.levels;
    if (levels) {
      result = new Array(length);
      for (let i = 0; i < length; i++) {
        const idx = raw[i];
        result[i] = idx === null || idx === void 0 ? null : levels[idx - 1] ?? null;
      }
      result.__factorLevels = [...levels];
      result.__factorOrdered = hasClass(attrs, "ordered");
    }
  }
  if (attrs.label != null) result.__label = String(attrs.label);
  if (attrs.names != null) result.__names = attrs.names;
  if (Array.isArray(attrs.labels) && attrs.labels.__names != null)
    result.__valueLabels = Object.fromEntries(
      attrs.labels.__names.map((label, i) => [String(attrs.labels[i]), label])
    );
  return result;
}
function isFactor(attrs) {
  return hasClass(attrs, "factor") || hasClass(attrs, "ordered");
}
var _naCheckBuf = new ArrayBuffer(8);
var _naCheckF64 = new Float64Array(_naCheckBuf);
var _naCheckU32 = new Uint32Array(_naCheckBuf);
function isNaReal(value) {
  if (!Number.isNaN(value)) return false;
  _naCheckF64[0] = value;
  return _naCheckU32[1] === NA.REAL_HI && _naCheckU32[0] === NA.REAL_LO;
}
function readRealVector(reader, refs, hasAttributes, isObject) {
  const length = readLength(reader);
  const raw = new Array(length);
  for (let i = 0; i < length; i++) {
    const val = reader.readDouble();
    raw[i] = isNaReal(val) ? null : val;
  }
  if (!hasAttributes) return raw;
  const attrs = readAttributes(reader, refs);
  let result;
  if (isObject && hasClass(attrs, "Date"))
    result = raw.map((v) => v === null ? null : epochDaysToIsoDate(v));
  else if (isObject && hasClass(attrs, "POSIXct"))
    result = raw.map((v) => v === null ? null : epochSecondsToIsoDatetime(v));
  else
    result = raw;
  if (attrs.label != null) result.__label = String(attrs.label);
  if (attrs.names != null) result.__names = attrs.names;
  if (attrs.tzone != null) {
    const tz = Array.isArray(attrs.tzone) ? attrs.tzone[0] : String(attrs.tzone);
    if (tz) result.__tzone = tz;
  }
  if (Array.isArray(attrs.labels) && attrs.labels.__names != null)
    result.__valueLabels = Object.fromEntries(
      attrs.labels.__names.map((label, i) => [String(attrs.labels[i]), label])
    );
  return result;
}
function hasClass(attrs, className) {
  return attrs.class?.includes(className) ?? false;
}
function epochDaysToIsoDate(days) {
  const ms = Math.round(days) * 864e5;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function epochSecondsToIsoDatetime(seconds) {
  const ms = Math.round(seconds * 1e3);
  return new Date(ms).toISOString();
}
function readStringVector(reader, refs, hasAttributes) {
  const length = readLength(reader);
  const result = new Array(length);
  for (let i = 0; i < length; i++) {
    const flags = reader.readInt();
    const gpFlags = (flags & FLAGS.GP_MASK) >>> FLAGS.GP_SHIFT;
    result[i] = readCharsxp(reader, gpFlags);
  }
  if (hasAttributes) {
    const attrs = readAttributes(reader, refs);
    if (attrs.label != null) result.__label = String(attrs.label);
    if (attrs.names != null) result.__names = attrs.names;
  }
  return result;
}
function readGenericVector(reader, refs, hasAttributes, isObject) {
  const length = readLength(reader);
  const elements = new Array(length);
  for (let i = 0; i < length; i++) {
    elements[i] = readItem(reader, refs);
  }
  if (hasAttributes) {
    const attrs = readAttributes(reader, refs);
    if (isObject && hasClass(attrs, "data.frame") && attrs.names) {
      return toDataFrame(attrs.names, elements);
    }
    if (attrs.names) {
      const obj = {};
      for (let i = 0; i < attrs.names.length && i < elements.length; i++) {
        const name = attrs.names[i];
        if (name !== void 0) {
          obj[name] = elements[i];
        }
      }
      return obj;
    }
  }
  return elements;
}
function toDataFrame(names, columns) {
  const validNames = [];
  const validColumns = [];
  const columnMeta = [];
  const nCols = Math.min(names.length, columns.length);
  for (let c = 0; c < nCols; c++) {
    const name = names[c];
    const col = columns[c];
    if (name !== void 0 && Array.isArray(col)) {
      validNames.push(name);
      validColumns.push(col);
      const meta = {};
      if (col.__factorLevels != null) {
        meta.levels  = col.__factorLevels;
        meta.ordered = col.__factorOrdered ?? false;
      }
      if (col.__label       != null) meta.label       = col.__label;
      if (col.__tzone       != null) meta.tzone       = col.__tzone;
      if (col.__valueLabels != null) meta.valueLabels = col.__valueLabels;
      columnMeta.push(Object.keys(meta).length > 0 ? meta : null);
    }
  }
  return { names: validNames, columns: validColumns, columnMeta };
}
function readRawVector(reader, refs, hasAttributes) {
  const length = readLength(reader);
  const data = reader.readBytes(length);
  if (hasAttributes) {
    readAttributes(reader, refs);
  }
  return data;
}
function readComplexVector(reader, refs, hasAttributes) {
  const length = readLength(reader);
  const result = new Array(length);
  for (let i = 0; i < length; i++) {
    const re = reader.readDouble();
    const im = reader.readDouble();
    result[i] = {
      re: isNaReal(re) ? null : re,
      im: isNaReal(im) ? null : im
    };
  }
  if (hasAttributes) {
    readAttributes(reader, refs);
  }
  return result;
}
function readAltrep(reader, refs) {
  const info = readItem(reader, refs);
  const state = readItem(reader, refs);
  readItem(reader, refs);
  if (isCompactSeq(state)) {
    const seq = state;
    const n = seq[0];
    const start = seq[1];
    const step = seq[2];
    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = start + i * step;
    }
    return result;
  }
  if (Array.isArray(state)) {
    return state;
  }
  void info;
  return state;
}
function isCompactSeq(state) {
  return Array.isArray(state) && state.length === 3 && typeof state[0] === "number" && typeof state[1] === "number" && typeof state[2] === "number";
}

// src/index.ts
async function parseRds(data) {
  const decompressed = await decompress(data);
  return parseStream(decompressed);
}
function isDataFrame(value) {
  if (typeof value !== "object" || value === null) return false;
  const obj = value;
  return Array.isArray(obj.names) && Array.isArray(obj.columns);
}
function toRows(frame) {
  const { names, columns } = frame;
  if (names.length === 0 || columns.length === 0) return [];
  const firstCol = columns[0];
  const nRows = Array.isArray(firstCol) ? firstCol.length : 0;
  if (nRows === 0) return [];
  const rows = new Array(nRows);
  for (let r = 0; r < nRows; r++) {
    const row = {};
    for (let c = 0; c < names.length; c++) {
      const name = names[c];
      const col = columns[c];
      if (name !== void 0 && Array.isArray(col)) {
        row[name] = col[r] ?? null;
      }
    }
    rows[r] = row;
  }
  return rows;
}
export {
  RdsError,
  UnsupportedTypeError,
  isDataFrame,
  parseRds,
  toRows
};
