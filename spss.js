// spss.js — SPSS .sav reader (uncompressed and bytecode-compressed)
// Reference: https://www.gnu.org/software/pspp/pspp-dev/html_node/System-File-Format.html

// -Number.MAX_VALUE as little-endian uint32 halves
const SYSMIS_LO = 0xFFFFFFFF;
const SYSMIS_HI = 0xFFEFFFFF;

function isSysmis(view, off) {
    return view.getUint32(off,     true) === SYSMIS_LO
        && view.getUint32(off + 4, true) === SYSMIS_HI;
}

function decode(bytes, enc) {
    try   { return new TextDecoder(enc).decode(bytes); }
    catch { return new TextDecoder('latin1').decode(bytes); }
}

// Advance position past one type-2 variable record.
// p must point at the 'type' field (immediately after rec_type was consumed).
function advVar(view, p) {
    const hasLabel = view.getInt32(p + 4,  true);
    const nMissing = view.getInt32(p + 8,  true);
    p += 28; // type(4) + hasLabel(4) + nMissing(4) + print(4) + write(4) + name(8)
    if (hasLabel) {
        const ll = view.getInt32(p, true);
        p += 4 + ll + (4 - ll % 4) % 4;
    }
    return p + Math.abs(nMissing) * 8;
}

export async function parseSavFile(arrayBuffer, filename) {
    const bytes = new Uint8Array(arrayBuffer);
    const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Validate magic: $FL2 (uncompressed / bytecode) or $FL3 (zsav)
    if (bytes[0] !== 0x24 || bytes[1] !== 0x46 || bytes[2] !== 0x4C)
        throw new Error('Not a valid SPSS .sav file.');
    if (bytes[3] === 0x33)
        throw new Error('ZSAV (zlib-compressed) files are not yet supported.');
    if (bytes[3] !== 0x32)
        throw new Error('Unrecognised SPSS format variant.');

    // Layout code 2 = little-endian (all modern SPSS files)
    if (view.getInt32(64, true) !== 2)
        throw new Error('Big-endian SPSS files are not supported.');

    const compression  = view.getInt32(72, true); // 0=none, 1=bytecode, 2=zlib
    const nCasesHeader = view.getInt32(80, true); // may be -1 if unknown
    const bias         = view.getFloat64(84, true); // typically 100.0

    if (compression === 2)
        throw new Error('ZSAV (zlib-compressed) files are not yet supported.');
    if (compression !== 0 && compression !== 1)
        throw new Error(`Unsupported compression type: ${compression}.`);

    // ── Pass 1: scan for character encoding (type-7 subtype-20) ──────────────
    // Encoding record appears after variable records, so we must scan forward.
    let encoding = 'windows-1252';
    {
        let p = 176;
        while (p + 4 <= bytes.byteLength) {
            const rt = view.getInt32(p, true); p += 4;
            if (rt === 999) break;
            if (rt === 2) {
                p = advVar(view, p);
            } else if (rt === 3) {
                const n = view.getInt32(p, true); p += 4;
                for (let i = 0; i < n; i++) {
                    p += 8; // value
                    const ll = bytes[p];
                    p += 1 + ll + (8 - (1 + ll) % 8) % 8;
                }
            } else if (rt === 4) {
                const n = view.getInt32(p, true); p += 4 + n * 4;
            } else if (rt === 6) {
                const n = view.getInt32(p, true); p += 4 + n * 80;
            } else if (rt === 7) {
                const subtype = view.getInt32(p, true);     p += 4;
                const size    = view.getInt32(p, true);     p += 4;
                const count   = view.getInt32(p, true);     p += 4;
                const len     = size * count;
                if (subtype === 20)
                    encoding = decode(bytes.subarray(p, p + len), 'latin1')
                                   .replace(/\0.*/, '').trim();
                p += len;
            }
        }
    }

    // ── Pass 2: parse dictionary ──────────────────────────────────────────────
    // vars: real variables in declaration order
    // varBySlot: one entry per type-2 record (real vars + continuation records)
    const vars      = [];
    const varBySlot = []; // null for continuation slots
    let pendingVL   = null; // value-label map waiting for its type-4 record

    let pos = 176;
    while (pos + 4 <= bytes.byteLength) {
        const rt = view.getInt32(pos, true); pos += 4;
        if (rt === 999) { pos += 4; break; }

        if (rt === 2) {
            const type     = view.getInt32(pos,      true);
            const hasLabel = view.getInt32(pos + 4,  true);
            const nMissing = view.getInt32(pos + 8,  true);
            const nameRaw  = bytes.subarray(pos + 20, pos + 28);
            pos += 28;

            let label = null;
            if (hasLabel) {
                const ll = view.getInt32(pos, true); pos += 4;
                label = decode(bytes.subarray(pos, pos + ll), encoding).trimEnd();
                pos += ll + (4 - ll % 4) % 4;
            }
            pos += Math.abs(nMissing) * 8;

            if (type === -1) {
                // Continuation record: extends the previous string variable by one slot
                if (vars.length > 0)
                    vars[vars.length - 1].nSlots++;
                varBySlot.push(null);
            } else {
                const name = decode(nameRaw, 'latin1').trimEnd();
                const v    = { name, type, label, firstSlot: varBySlot.length, nSlots: 1,
                               valueLabels: null };
                vars.push(v);
                varBySlot.push(v);
            }

        } else if (rt === 3) {
            // Value labels — always immediately followed by a type-4 record
            const n      = view.getInt32(pos, true); pos += 4;
            const labels = new Map();
            for (let i = 0; i < n; i++) {
                const val = view.getFloat64(pos, true); pos += 8;
                const ll  = bytes[pos];                 pos += 1;
                const lbl = decode(bytes.subarray(pos, pos + ll), encoding);
                pos += ll + (8 - (1 + ll) % 8) % 8;
                labels.set(String(val), lbl);
            }
            pendingVL = labels;

        } else if (rt === 4) {
            // Assign pending value labels to the referenced variables
            const n = view.getInt32(pos, true); pos += 4;
            for (let i = 0; i < n; i++) {
                const idx = view.getInt32(pos, true); pos += 4;
                if (pendingVL) {
                    const v = varBySlot[idx - 1];
                    if (v) {
                        const vl = {};
                        for (const [code, lbl] of pendingVL) vl[code] = lbl;
                        v.valueLabels = vl;
                    }
                }
            }
            pendingVL = null;

        } else if (rt === 6) {
            const n = view.getInt32(pos, true); pos += 4 + n * 80;

        } else if (rt === 7) {
            const subtype = view.getInt32(pos, true); pos += 4;
            const size    = view.getInt32(pos, true); pos += 4;
            const count   = view.getInt32(pos, true); pos += 4;
            const len     = size * count;
            if (subtype === 13) {
                // Long variable names: "SHORTNAME=LongName\tSHORTNAME=LongName"
                const text = decode(bytes.subarray(pos, pos + len), encoding);
                for (const pair of text.split('\t')) {
                    const eq = pair.indexOf('=');
                    if (eq < 1) continue;
                    const short = pair.slice(0, eq).trimEnd().toUpperCase();
                    const long  = pair.slice(eq + 1).replace(/\0.*/, '');
                    if (long) {
                        const v = vars.find(v => v.name.toUpperCase() === short);
                        if (v) v.name = long;
                    }
                }
            }
            pos += len;
        }
    }

    // ── Read data ─────────────────────────────────────────────────────────────
    const totalSlots = varBySlot.length;
    const nCasesMax  = nCasesHeader >= 0 ? nCasesHeader : Infinity;

    // allSlots[caseIndex][slotIndex] = Uint8Array(8)
    const allSlots = [];

    if (compression === 0) {
        // Uncompressed: each case is totalSlots × 8 bytes
        while (allSlots.length < nCasesMax && pos + totalSlots * 8 <= bytes.byteLength) {
            const row = [];
            for (let s = 0; s < totalSlots; s++) {
                row.push(bytes.subarray(pos, pos + 8));
                pos += 8;
            }
            allSlots.push(row);
        }
    } else {
        // Bytecode compressed:
        // Each block = 8 instruction bytes + 8-byte raw value for each code-253 in the block.
        const SYSMIS_SLOT = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xEF, 0xFF]);
        const SPACES_SLOT = new Uint8Array(8).fill(0x20);

        let pending = []; // accumulated slots for the in-progress case
        let done    = false;

        while (!done && pos + 8 <= bytes.byteLength) {
            const instr = bytes.subarray(pos, pos + 8); pos += 8;

            // Count code-253s to locate raw data section
            let n253 = 0;
            for (const b of instr) if (b === 253) n253++;
            const rawBase = pos; pos += n253 * 8;

            let rawIdx = 0;
            for (const code of instr) {
                if (code === 0) continue; // padding, not a data slot

                let slot;
                if (code >= 1 && code <= 251) {
                    slot = new Uint8Array(8);
                    new DataView(slot.buffer).setFloat64(0, code - bias, true);
                } else if (code === 252) {
                    done = true; break;
                } else if (code === 253) {
                    const off = rawBase + rawIdx++ * 8;
                    slot = bytes.subarray(off, off + 8);
                } else if (code === 254) {
                    slot = SPACES_SLOT;
                } else { // 255 = SYSMIS
                    slot = SYSMIS_SLOT;
                }

                pending.push(slot);
                if (pending.length === totalSlots) {
                    allSlots.push(pending);
                    pending = [];
                    if (allSlots.length >= nCasesMax) { done = true; break; }
                }
            }
        }
    }

    // ── Convert slots to string values ────────────────────────────────────────
    const header = vars.map(v => v.name);
    const rows   = [header];

    for (const caseSlots of allSlots) {
        const row = vars.map(v => {
            if (v.type === 0) {
                // Numeric: first slot is a double
                const s = caseSlots[v.firstSlot];
                const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
                if (isSysmis(dv, 0)) return '';
                const val = dv.getFloat64(0, true);
                if (!isFinite(val)) return '';
                return String(val);
            } else {
                // String: concatenate nSlots × 8 bytes, take first type bytes, right-trim
                const buf = new Uint8Array(v.nSlots * 8);
                for (let s = 0; s < v.nSlots; s++)
                    buf.set(caseSlots[v.firstSlot + s], s * 8);
                return decode(buf.subarray(0, v.type), encoding).trimEnd();
            }
        });
        rows.push(row);
    }

    // ── Build columnMeta ──────────────────────────────────────────────────────
    const columnMeta = vars.map(v => {
        const meta = {};
        if (v.label)       meta.label       = v.label;
        if (v.valueLabels) meta.valueLabels = v.valueLabels;
        return Object.keys(meta).length > 0 ? meta : null;
    });

    const name = filename.replace(/\.[^.]+$/, '');
    return [{ name, rows, columnMeta }];
}
