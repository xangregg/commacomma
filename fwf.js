// Fixed-width file parser.
//
// detectBoundaries scans the text for column start positions.
// If a hyphen-separator line is present (a line of only hyphens and spaces,
// e.g. "-------  ----  --------"), its hyphen runs define the columns
// precisely and it is used instead of the space-gap heuristic.
// Otherwise every character position is tested: if every sampled row has a
// space there (or ends before it), the position is a gap, and transitions
// from gap to non-gap mark column starts.

function isHyphenLine(line) {
    return /^[\s-]+$/.test(line) && line.includes('-');
}

function boundariesFromHyphenLine(line) {
    const boundaries = [];
    let inRun = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '-' && !inRun) {
            boundaries.push(i);
            inRun = true;
        } else if (line[i] !== '-') {
            inRun = false;
        }
    }
    return boundaries;
}

// Convert boundaries array to a column-widths array.
// The last width is inferred from the longest non-hyphen line in text.
export function boundariesToWidths(boundaries, text) {
    const lines = text.split('\n').filter(l => l.trim() !== '' && !isHyphenLine(l));
    const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const widths = [];
    for (let i = 0; i < boundaries.length - 1; i++)
        widths.push(boundaries[i + 1] - boundaries[i]);
    widths.push(Math.max(1, maxLen - (boundaries[boundaries.length - 1] ?? 0)));
    return widths;
}

// Convert a column-widths array to a boundaries array (column start positions).
// Returns n start positions for n widths; the caller supplies lineWidth to
// parseFwf so the last column is capped rather than reading to end of line.
export function widthsToBoundaries(widths) {
    const boundaries = [0];
    let pos = 0;
    for (let i = 0; i < widths.length - 1; i++) {
        pos += widths[i];
        boundaries.push(pos);
    }
    return boundaries;
}

// Scan raw (un-stripped) text for a hyphen separator line.
// If found at line i (0-indexed, i >= 1), returns the spinner values that
// position that line correctly: comment lines skip everything before the
// header, and header lines = 1.
export function detectFwfPreamble(text) {
    const lines = text.split('\n');
    const i = lines.findIndex(isHyphenLine);
    if (i < 1)
        return null;
    return { commentLines: i - 1, headerLines: 1 };
}

export function detectBoundaries(text, sampleRows = 200) {
    const allLines = text.split('\n').filter(l => l.trim() !== '');
    if (allLines.length === 0)
        return [0];

    // Column-defining hyphen line (e.g. "---  ---  ---"): use its runs directly.
    const hyphenLine = allLines.find(isHyphenLine);
    if (hyphenLine) {
        const b = boundariesFromHyphenLine(hyphenLine);
        if (b.length > 1)
            return b;
    }

    // Space-gap heuristic: exclude hyphen lines so solid separators don't block gaps.
    const sample = allLines.filter(l => !isHyphenLine(l)).slice(0, sampleRows);
    if (sample.length === 0)
        return [0];
    const width  = Math.max(...sample.map(l => l.length));

    const isGap = new Array(width);
    for (let pos = 0; pos < width; pos++)
        isGap[pos] = sample.every(l => pos >= l.length || l[pos] === ' ');

    const boundaries = [];
    for (let pos = 0; pos < width; pos++) {
        if (!isGap[pos] && (pos === 0 || isGap[pos - 1]))
            boundaries.push(pos);
    }
    return boundaries.length > 0 ? boundaries : [0];
}

export function parseFwf(text, boundaries, lineWidth = Infinity) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (text.endsWith('\n'))
        text = text.slice(0, -1);
    if (text === '')
        return [];
    return text.split('\n')
        .filter(line => !isHyphenLine(line))
        .map(line =>
            boundaries.map((start, i) => {
                const isLast = i === boundaries.length - 1;
                const end = isLast
                    ? (isFinite(lineWidth) ? lineWidth : undefined)
                    : boundaries[i + 1];
                return (end === undefined ? line.slice(start) : line.slice(start, end)).trim();
            })
        );
}
