# MPP Reader

A viewer for Microsoft Project files (`.mpp`) packed into a single offline HTML file.
Open it in a browser, drop a `.mpp` file on it and browse tasks, resources and assignments.
No Microsoft Project licence, no installation, no server.

## Features

- Reads files saved by Project 2010 and later, including Project 365 (MPP14 format).
- Project summary, tasks (ID, unique ID, WBS, duration, work, dates, % complete, predecessors, resources),
  resources and assignments.
- Custom fields and enterprise fields, with selectable columns.
- Search, links between tabs, selectable date format, light/dark theme.

## Privacy

- The page makes no network requests: everything (code, styles, libraries) is inline.
- The `.mpp` file is read in the browser's memory only. Nothing is uploaded or saved.

## Usage

Build the page, then open `dist/lettore-mpp.html` with a double click (tested in Microsoft Edge and Chrome).

```
npm install
npm run build
```

The result is one self-contained HTML file (about 260 KB) that can be copied to any PC.

## Development

- `npm test` runs the tests with the built-in Node test runner (Node 24).
- `samples/` holds public test files from MPXJ; `samples/expected/*.json` are the values MPXJ reads from them.
- `npm run oracle` regenerates those expected values and `npm run fields` regenerates `src/mpp/field-tables.js`.
  Both need a JDK in `.tools/jdk/` and MPXJ in `.tools/mpxj/` (`mpxj.jar` plus its `lib/` folder).

## Licence and credits

Released under the GNU Lesser General Public License 2.1 or later (see `LICENSE` and `NOTICE`).

- The MPP parsing logic is derived from [MPXJ](https://www.mpxj.org) by Packwood Software (LGPL-2.1).
- The OLE2 container is read with [cfb](https://github.com/SheetJS/js-cfb) by SheetJS (Apache 2.0).

Microsoft and Microsoft Project are trademarks of Microsoft Corporation.
This project is not affiliated with or endorsed by Microsoft.

Provided "as is", without warranty of any kind.
