// Canonical output formats. TXT and DAT are input-only (sniffed), not listed here.
export const FORMATS = [
    { id: 'csv', label: 'CSV', delimiter: ',',  ext: 'csv' },
    { id: 'tsv', label: 'TSV', delimiter: '\t', ext: 'tsv' },
    { id: 'ssv', label: 'SSV', delimiter: ';',  ext: 'ssv' },
];

// Extensions that map unambiguously to a format. Others fall back to sniffing.
const EXT_MAP = { csv: 'csv', tsv: 'tsv', tab: 'tsv', ssv: 'ssv' };

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
