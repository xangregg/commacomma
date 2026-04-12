# CommaComma — Data File Converter

A browser-based tool for converting tabular data files.
Drop or open a file, choose an output format, and download the result.

**Supported input formats:** CSV, TSV, SSV, TXT, DAT, RDS, RData/RDA

**Supported output formats:** CSV, TSV, SSV

R files (`.rds`, `.rdata`, `.rda`) are read-only inputs.
Data frames and matrices are extracted; one output file is produced per table.

The app runs entirely in the browser with no server-side processing.
Serve it locally with `npm start` (uses `npx serve`) or deploy the files
directly to any static host such as GitHub Pages.

---

## Developer Notes

### Running locally

```sh
npm start
```

### Running tests

```sh
npm test
```

### R file parsing

R binary file support is provided by
[rds-js](https://github.com/jackemcpherson/rds-js) (MIT),
vendored as `vendor/rds-js.js`.
The adapter in `rds.js` wraps the library and handles the `.rdata`/`.rda`
magic-header stripping that the library does not do itself.

#### Updating rds-js

```sh
npm install
npm run vendor
```

Then commit `vendor/rds-js.js`.
`node_modules/` is not committed — it is only needed to run this command.
