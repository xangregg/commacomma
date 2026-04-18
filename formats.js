// Output formats. Input-only formats (WSV, FWF) are appended separately.
export const OUTPUT_FORMATS = [
    { id: 'csv', label: 'CSV',   delimiter: ',',  ext: 'csv', tooltip: 'Comma-separated values' },
    { id: 'tsv', label: 'TSV',   delimiter: '\t', ext: 'tsv', tooltip: 'Tab-separated values' },
    { id: 'ssv', label: 'SSV',   delimiter: ';',  ext: 'ssv', tooltip: 'Semicolon-separated values' },
];

export const FORMATS = [
    ...OUTPUT_FORMATS,
    { id: 'wsv', label: 'WSV',   inputOnly: true, tooltip: 'Whitespace-separated: any run of spaces or tabs is a delimiter' },
    { id: 'fwf', label: 'Fixed', inputOnly: true, ext: 'fwf', tooltip: 'Fixed-width: column boundaries auto-detected from consistent spacing' },
];

// Extensions that map unambiguously to a format. Others fall back to sniffing.
const EXT_MAP = { csv: 'csv', tsv: 'tsv', tab: 'tsv', ssv: 'ssv', fwf: 'fwf' };

export function detectFormatFromExt(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return EXT_MAP[ext] ?? null;
}

export function sniffFormat(text) {
    const firstLine = text.split('\n')[0];
    const scores = FORMATS.map(f => ({
        id: f.id,
        count: firstLine.split(f.delimiter).length - 1,
    }));
    scores.sort((a, b) => b.count - a.count);
    return scores[0].count > 0 ? scores[0].id : 'csv';
}
