// dta.js — Stata .dta format 118/119 reader
// Reference: https://www.stata.com/help.cgi?dta

// Days between Stata epoch (Jan 1, 1960) and Unix epoch (Jan 1, 1970).
// Leap years in 1960–1969: 1960, 1964, 1968 → 3×366 + 7×365 = 3653 days.
const STATA_DAY_OFFSET = 3653;
const STATA_MS_OFFSET  = STATA_DAY_OFFSET * 86400 * 1000;

// Numeric type codes
const TYPE_STRL   = 32768;
const TYPE_DOUBLE = 65526;
const TYPE_FLOAT  = 65527;
const TYPE_LONG   = 65528;
const TYPE_INT    = 65529;
const TYPE_BYTE   = 65530;

// Missing value thresholds (values strictly above these are missing)
const MISSING_BYTE   = 100;
const MISSING_INT    = 32740;
const MISSING_LONG   = 2147483620;

function readNullStr(bytes, off, maxLen) {
    let end = off;
    while (end < off + maxLen && bytes[end] !== 0) end++;
    return new TextDecoder('utf-8').decode(bytes.subarray(off, end));
}

function readUint64(dv, off, le) {
    const lo = dv.getUint32(off + (le ? 0 : 4), le);
    const hi = dv.getUint32(off + (le ? 4 : 0), le);
    return hi * 2 ** 32 + lo;
}

// Read a 6-byte unsigned integer (strL observation index stored in <data>).
function readUint48(dv, off, le) {
    if (le)
        return dv.getUint32(off, true) + dv.getUint16(off + 4, true) * 2 ** 32;
    return dv.getUint16(off, false) * 2 ** 32 + dv.getUint32(off + 2, false);
}

// All double missing values have biased exponent ≥ 0x7FE (> max nonmissing 0x7FD...).
function isMissingDouble(dv, off, le) {
    const hi = le ? dv.getUint32(off + 4, true) : dv.getUint32(off, false);
    return (hi & 0x7FFFFFFF) > 0x7FDFFFFF;
}

// All float missing values have biased exponent ≥ 0xFE (> max nonmissing 0x7EFF...).
function isMissingFloat(dv, off, le) {
    return (dv.getUint32(off, le) & 0x7FFFFFFF) > 0x7EFFFFFF;
}

function expectTag(bytes, pos, tag) {
    for (let j = 0; j < tag.length; j++)
        if (bytes[pos + j] !== tag.charCodeAt(j))
            throw new Error(`Expected "${tag}" at offset ${pos}`);
    return pos + tag.length;
}

function peekTag(bytes, pos, tag) {
    for (let j = 0; j < tag.length; j++)
        if (bytes[pos + j] !== tag.charCodeAt(j)) return false;
    return true;
}

// %td / legacy %d → value is days since Jan 1, 1960
function isDateFmt(fmt) {
    return /^%-?(td|d(?!\d))/.test(fmt);
}

// %tc / %tC → value is milliseconds since Jan 1, 1960
function isDatetimeFmt(fmt) {
    return /^%-?t[cC]/.test(fmt);
}

// %tcHH:MM:SS and similar masks with no date tokens → output time only
function isTimeOnlyFmt(fmt) {
    const m = fmt.match(/^%-?t[cC](.+)$/);
    if (!m) return false;
    return !/CC|YY|NN|DD|jjj|[Mm]on(th)?|MONTH|MON/.test(m[1]);
}

function formatDatetime(raw, timeOnly) {
    const d   = new Date(raw - STATA_MS_OFFSET);
    const ms  = ((raw % 1000) + 1000) % 1000;
    const frac = ms !== 0 ? '.' + String(ms).padStart(3, '0') : '';
    if (timeOnly)
        return d.toISOString().slice(11, 19) + frac;
    return d.toISOString().slice(0, 19) + frac;
}

// Two byte-code schemes coexist in pre-117 files:
//   Numeric codes: 255=byte  254=int  253=long  252=float  251=double  1–244=strN
//   ASCII codes:    98='b'   105='i'  108='l'   102='f'    100='d'     1–244=strN
// Both must be recognised because different tools wrote different schemes.

function parseLegacyDtaFile(bytes, view, filename) {
    let pos = 0;
    const release = bytes[pos++];
    if (release < 104)
        throw new Error(`Stata format ${release} (pre-104) is not supported.`);

    const le = bytes[pos++] !== 1; // 1 = big-endian (MSF), 2 = little-endian (LSF)
    pos++; // filetype
    pos++; // unused

    const K = view.getUint16(pos, le); pos += 2;
    const N = view.getUint32(pos, le); pos += 4;
    pos += 81; // dataset label (80 chars + null)
    pos += 18; // timestamp
    // pos == 109

    // Field widths vary by format version
    const nameWidth = release >= 110 ? 33 : 9;
    const fmtWidth  = release >= 115 ? 49 : release >= 105 ? 12 : 7;
    const lblWidth  = release >= 110 ? 33 : 9;
    const vlblWidth = 81;

    // ── Type list ─────────────────────────────────────────────────────────────
    const types = [];
    for (let i = 0; i < K; i++) {
        types.push(bytes[pos]);
        pos += 1;
    }

    // ── Variable names ────────────────────────────────────────────────────────
    const varnames = [];
    for (let i = 0; i < K; i++) {
        varnames.push(readNullStr(bytes, pos, nameWidth));
        pos += nameWidth;
    }

    // ── Sort list ─────────────────────────────────────────────────────────────
    pos += (K + 1) * 2;

    // ── Display formats ───────────────────────────────────────────────────────
    const formats = [];
    for (let i = 0; i < K; i++) {
        formats.push(readNullStr(bytes, pos, fmtWidth));
        pos += fmtWidth;
    }

    // ── Value label names ─────────────────────────────────────────────────────
    const vlNames = [];
    for (let i = 0; i < K; i++) {
        vlNames.push(readNullStr(bytes, pos, lblWidth));
        pos += lblWidth;
    }

    // ── Variable labels ───────────────────────────────────────────────────────
    const varlabels = [];
    for (let i = 0; i < K; i++) {
        varlabels.push(readNullStr(bytes, pos, vlblWidth));
        pos += vlblWidth;
    }

    // ── Expansion fields ──────────────────────────────────────────────────────
    // Each entry: 1-byte type + 4-byte length (for 108+) or 2-byte length (older)
    const expLenWidth = release >= 108 ? 4 : 2;
    while (pos < bytes.length) {
        const xtype = bytes[pos]; pos++;
        const xlen = expLenWidth === 4
            ? view.getUint32(pos, le)
            : view.getUint16(pos, le);
        pos += expLenWidth;
        if (xtype === 0) break;
        pos += xlen;
    }

    // ── Field widths for data ─────────────────────────────────────────────────
    // Two byte-code schemes coexist in pre-117 files:
    //   Numeric codes: 255=double  254=float  253=long  252=int  251=byte  1–244=strN
    //   ASCII codes:   100='d'     102='f'    108='l'   105='i'   98='b'
    const widths = types.map(t => {
        if (t === 255 || t === 100) return 8; // double  ('d')
        if (t === 254 || t === 102) return 4; // float   ('f')
        if (t === 253 || t === 108) return 4; // long    ('l')
        if (t === 252 || t === 105) return 2; // int     ('i')
        if (t === 251 || t ===  98) return 1; // byte    ('b')
        if (t >= 1 && t <= 244)     return t; // strN (standard: type code = byte width)
        throw new Error(`Unknown Stata type code ${t}`);
    });

    // Some old files encode string width as (type_code & 0x7F)+1 for codes ≥ 128,
    // rather than type_code directly.  Fall back to that formula if the standard
    // row width would overflow the remaining file bytes.
    if (widths.reduce((s, w) => s + w, 0) * N > bytes.length - pos)
        for (let i = 0; i < K; i++)
            if (types[i] >= 128 && types[i] <= 244)
                widths[i] = (types[i] & 0x7F) + 1;

    // ── Data ──────────────────────────────────────────────────────────────────
    const rawData = [];
    for (let j = 0; j < N; j++) {
        const obs = [];
        for (let i = 0; i < K; i++) {
            const t = types[i];
            let val;
            if (t === 251 || t === 98) {
                val = view.getInt8(pos);
                if (val > MISSING_BYTE) val = null;
            } else if (t === 252 || t === 105) {
                val = view.getInt16(pos, le);
                if (val > MISSING_INT) val = null;
            } else if (t === 253 || t === 108) {
                val = view.getInt32(pos, le);
                if (val > MISSING_LONG) val = null;
            } else if (t === 254 || t === 102) {
                val = isMissingFloat(view, pos, le) ? null : view.getFloat32(pos, le);
            } else if (t === 255 || t === 100) {
                val = isMissingDouble(view, pos, le) ? null : view.getFloat64(pos, le);
            } else {
                const raw = bytes.subarray(pos, pos + widths[i]);
                const nullIdx = raw.indexOf(0);
                val = new TextDecoder('utf-8').decode(nullIdx >= 0 ? raw.subarray(0, nullIdx) : raw);
            }
            obs.push(val);
            pos += widths[i];
        }
        rawData.push(obs);
    }

    // ── Value labels ──────────────────────────────────────────────────────────
    // Same structure as 117+ lbl blocks but without XML tags
    const labelDefs = new Map();
    while (pos + 4 < bytes.length) {
        const recStart = pos;
        const recLen = view.getInt32(pos, le); pos += 4;
        if (recLen <= 0) break;
        const labname = readNullStr(bytes, pos, lblWidth); pos += lblWidth;
        pos += 3; // padding
        const tblStart = pos;

        const n      = view.getInt32(pos, le); pos += 4;
        const txtlen = view.getInt32(pos, le); pos += 4;
        const offs = [];
        for (let i = 0; i < n; i++) { offs.push(view.getInt32(pos, le)); pos += 4; }
        const vals = [];
        for (let i = 0; i < n; i++) { vals.push(view.getInt32(pos, le)); pos += 4; }

        const txtBase = tblStart + 8 + 8 * n;
        const map = {};
        for (let i = 0; i < n; i++) {
            const lbl = readNullStr(bytes, txtBase + offs[i], txtlen - offs[i]);
            map[String(vals[i])] = lbl;
        }
        labelDefs.set(labname, map);
        pos = tblStart + recLen;
    }

    // ── Assemble rows ─────────────────────────────────────────────────────────
    const header = [...varnames];
    const rows   = [header];
    for (let j = 0; j < N; j++) {
        const row = rawData[j].map((raw, i) => {
            if (raw === null)
                return '';
            if (typeof raw === 'string')
                return raw;
            const fmt = formats[i];
            if (isDateFmt(fmt))
                return new Date((raw - STATA_DAY_OFFSET) * 86400000).toISOString().slice(0, 10);
            if (isDatetimeFmt(fmt))
                return formatDatetime(raw, isTimeOnlyFmt(fmt));
            return String(raw);
        });
        rows.push(row);
    }

    // ── Column metadata ───────────────────────────────────────────────────────
    const columnMeta = varnames.map((_, i) => {
        const meta = {};
        if (varlabels[i]) meta.label = varlabels[i];
        const vlName = vlNames[i];
        if (vlName) {
            const vl = labelDefs.get(vlName);
            if (vl) meta.valueLabels = vl;
        }
        return Object.keys(meta).length > 0 ? meta : null;
    });

    const name = filename.replace(/\.[^.]+$/, '');
    return [{ name, rows, columnMeta }];
}

export async function parseDtaFile(arrayBuffer, filename) {
    const bytes = new Uint8Array(arrayBuffer);
    const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes[0] !== 0x3C) // not '<', so it's a legacy flat-binary format
        return parseLegacyDtaFile(bytes, view, filename);

    // ── Header ────────────────────────────────────────────────────────────────
    let pos = expectTag(bytes, 0, '<stata_dta>');
    pos = expectTag(bytes, pos, '<header>');
    pos = expectTag(bytes, pos, '<release>');
    const release = parseInt(new TextDecoder().decode(bytes.subarray(pos, pos + 3)));
    if (release !== 117 && release !== 118 && release !== 119)
        throw new Error(`Unsupported Stata format ${release}; only 117/118/119 are supported.`);
    pos += 3;
    pos = expectTag(bytes, pos, '</release>');

    pos = expectTag(bytes, pos, '<byteorder>');
    const le = bytes[pos] === 0x4C; // 'L' for LSF (little-endian), 'M' for MSF
    pos += 3;
    pos = expectTag(bytes, pos, '</byteorder>');

    pos = expectTag(bytes, pos, '<K>');
    const K = view.getUint16(pos, le); pos += 2;
    pos = expectTag(bytes, pos, '</K>');

    // Format 117 (Stata 13): N is 4 bytes. Format 118+ (Stata 14+): N is 8 bytes.
    pos = expectTag(bytes, pos, '<N>');
    let N;
    if (release === 117) {
        N = view.getUint32(pos, le); pos += 4;
    } else {
        N = readUint64(view, pos, le); pos += 8;
    }
    pos = expectTag(bytes, pos, '</N>');

    // Format 117: dataset label length is 1 byte. Format 118+: 2 bytes.
    pos = expectTag(bytes, pos, '<label>');
    if (release === 117) {
        pos += 1 + bytes[pos];
    } else {
        pos += 2 + view.getUint16(pos, le);
    }
    pos = expectTag(bytes, pos, '</label>');

    pos = expectTag(bytes, pos, '<timestamp>');
    pos += 1 + bytes[pos]; // skip 1-byte length + timestamp text
    pos = expectTag(bytes, pos, '</timestamp>');

    pos = expectTag(bytes, pos, '</header>');

    // ── Map ───────────────────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<map>');
    pos += 14 * 8; // 14 file-position entries × 8 bytes each
    pos = expectTag(bytes, pos, '</map>');

    // ── Variable types ────────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<variable_types>');
    const types = [];
    for (let i = 0; i < K; i++) {
        types.push(view.getUint16(pos, le)); pos += 2;
    }
    pos = expectTag(bytes, pos, '</variable_types>');

    // Field widths differ between format 117 (Stata 13) and 118/119 (Stata 14+).
    const W = release === 117
        ? { name: 33, fmt: 49, vlname: 33, label: 81 }
        : { name: 129, fmt: 57, vlname: 129, label: 321 };

    // ── Variable names ────────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<varnames>');
    const varnames = [];
    for (let i = 0; i < K; i++) {
        varnames.push(readNullStr(bytes, pos, W.name)); pos += W.name;
    }
    pos = expectTag(bytes, pos, '</varnames>');

    // ── Sort list (not needed for reading) ────────────────────────────────────
    pos = expectTag(bytes, pos, '<sortlist>');
    pos += (K + 1) * 2;
    pos = expectTag(bytes, pos, '</sortlist>');

    // ── Display formats ───────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<formats>');
    const formats = [];
    for (let i = 0; i < K; i++) {
        formats.push(readNullStr(bytes, pos, W.fmt)); pos += W.fmt;
    }
    pos = expectTag(bytes, pos, '</formats>');

    // ── Value label names (one per variable, empty string if none) ─────────────
    pos = expectTag(bytes, pos, '<value_label_names>');
    const vlNames = [];
    for (let i = 0; i < K; i++) {
        vlNames.push(readNullStr(bytes, pos, W.vlname)); pos += W.vlname;
    }
    pos = expectTag(bytes, pos, '</value_label_names>');

    // ── Variable labels ───────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<variable_labels>');
    const varlabels = [];
    for (let i = 0; i < K; i++) {
        varlabels.push(readNullStr(bytes, pos, W.label)); pos += W.label;
    }
    pos = expectTag(bytes, pos, '</variable_labels>');

    // ── Characteristics (skip using length fields to avoid false tag matches) ──
    pos = expectTag(bytes, pos, '<characteristics>');
    while (!peekTag(bytes, pos, '</characteristics>')) {
        pos = expectTag(bytes, pos, '<ch>');
        const chLen = view.getUint32(pos, le); pos += 4;
        pos += chLen;
        pos = expectTag(bytes, pos, '</ch>');
    }
    pos = expectTag(bytes, pos, '</characteristics>');

    // ── Data ──────────────────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<data>');

    const widths = types.map(t => {
        if (t <= 2045)         return t; // strN: exactly t bytes
        if (t === TYPE_STRL)   return 8; // 2-byte v + 6-byte o
        if (t === TYPE_DOUBLE) return 8;
        if (t === TYPE_FLOAT)  return 4;
        if (t === TYPE_LONG)   return 4;
        if (t === TYPE_INT)    return 2;
        if (t === TYPE_BYTE)   return 1;
        throw new Error(`Unknown Stata variable type ${t}`);
    });

    // rawData[j][i] = JS number | string | [v, o] (strL ref) | null (missing)
    const rawData = [];
    for (let j = 0; j < N; j++) {
        const obs = [];
        for (let i = 0; i < K; i++) {
            const t = types[i];
            let val;
            if (t === TYPE_BYTE) {
                val = view.getInt8(pos);
                if (val > MISSING_BYTE) val = null;
            } else if (t === TYPE_INT) {
                val = view.getInt16(pos, le);
                if (val > MISSING_INT) val = null;
            } else if (t === TYPE_LONG) {
                val = view.getInt32(pos, le);
                if (val > MISSING_LONG) val = null;
            } else if (t === TYPE_FLOAT) {
                val = isMissingFloat(view, pos, le) ? null : view.getFloat32(pos, le);
            } else if (t === TYPE_DOUBLE) {
                val = isMissingDouble(view, pos, le) ? null : view.getFloat64(pos, le);
            } else if (t === TYPE_STRL) {
                const v = view.getUint16(pos, le);
                const o = readUint48(view, pos + 2, le);
                val = [v, o];
            } else {
                // strN: stop at first null byte, leave trailing spaces intact
                const raw = bytes.subarray(pos, pos + t);
                const nullIdx = raw.indexOf(0);
                val = new TextDecoder('utf-8').decode(nullIdx >= 0 ? raw.subarray(0, nullIdx) : raw);
            }
            obs.push(val);
            pos += widths[i];
        }
        rawData.push(obs);
    }
    pos = expectTag(bytes, pos, '</data>');

    // ── StrLs ─────────────────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<strls>');
    const strlMap = new Map(); // "v,o" → string content
    while (!peekTag(bytes, pos, '</strls>')) {
        pos = expectTag(bytes, pos, 'GSO');
        const gsoV = view.getUint32(pos, le); pos += 4;
        const gsoO = readUint64(view, pos, le); pos += 8;
        const t    = bytes[pos]; pos += 1;
        const len  = view.getUint32(pos, le); pos += 4;
        const content = bytes.subarray(pos, pos + len); pos += len;
        // t=130: UTF-8 with trailing \0; t=129: binary blob
        const str = t === 130
            ? new TextDecoder('utf-8').decode(content.subarray(0, len - 1))
            : new TextDecoder('latin1').decode(content);
        strlMap.set(`${gsoV},${gsoO}`, str);
    }
    pos = expectTag(bytes, pos, '</strls>');

    // ── Value labels ──────────────────────────────────────────────────────────
    pos = expectTag(bytes, pos, '<value_labels>');
    const labelDefs = new Map(); // labname → { val_str → label_str }
    while (!peekTag(bytes, pos, '</value_labels>')) {
        pos = expectTag(bytes, pos, '<lbl>');
        const tblLen  = view.getInt32(pos, le); pos += 4;
        const labname = readNullStr(bytes, pos, W.vlname); pos += W.vlname;
        pos += 3; // padding
        const tblStart = pos;

        const n      = view.getInt32(pos, le); pos += 4;
        const txtlen = view.getInt32(pos, le); pos += 4;
        const offs = [];
        for (let i = 0; i < n; i++) { offs.push(view.getInt32(pos, le)); pos += 4; }
        const vals = [];
        for (let i = 0; i < n; i++) { vals.push(view.getInt32(pos, le)); pos += 4; }

        const txtBase = tblStart + 8 + 8 * n; // start of txt[] array
        const map = {};
        for (let i = 0; i < n; i++) {
            const lbl = readNullStr(bytes, txtBase + offs[i], txtlen - offs[i]);
            map[String(vals[i])] = lbl;
        }
        labelDefs.set(labname, map);

        pos = tblStart + tblLen;
        pos = expectTag(bytes, pos, '</lbl>');
    }
    pos = expectTag(bytes, pos, '</value_labels>');

    // ── Assemble rows ─────────────────────────────────────────────────────────
    const header = [...varnames];
    const rows   = [header];
    for (let j = 0; j < N; j++) {
        const row = rawData[j].map((raw, i) => {
            if (raw === null)
                return '';
            if (Array.isArray(raw)) {
                const [v, o] = raw;
                if (v === 0 && o === 0) return '';
                return strlMap.get(`${v},${o}`) ?? '';
            }
            if (typeof raw === 'string')
                return raw;
            // Numeric: apply date conversion or stringify
            const fmt = formats[i];
            if (isDateFmt(fmt))
                return new Date((raw - STATA_DAY_OFFSET) * 86400000).toISOString().slice(0, 10);
            if (isDatetimeFmt(fmt))
                return formatDatetime(raw, isTimeOnlyFmt(fmt));
            return String(raw);
        });
        rows.push(row);
    }

    // ── Column metadata ───────────────────────────────────────────────────────
    const columnMeta = varnames.map((_, i) => {
        const meta = {};
        if (varlabels[i]) meta.label = varlabels[i];
        const vlName = vlNames[i];
        if (vlName) {
            const vl = labelDefs.get(vlName);
            if (vl) meta.valueLabels = vl;
        }
        return Object.keys(meta).length > 0 ? meta : null;
    });

    const name = filename.replace(/\.[^.]+$/, '');
    return [{ name, rows, columnMeta }];
}
