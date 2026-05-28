# tui

Terminal UI framework built on raw ANSI escape codes — no curses, no blessed, no dependencies.

## Primitives

| Widget | Description |
|---|---|
| `box` | Bordered box with optional title, single or double border |
| `text` | Colored text at absolute position |
| `progressBar` | `[███░░░] 67%` with threshold color changes |
| `sparkline` | `▁▂▄▆█▇▅▃` inline time-series from an array |
| `table` | Fixed-width column table with header row |

## Demo

```bash
node demo.js
```

Renders a live system monitor — CPU/memory bars with sparklines, OS info, load averages. Updates at 30fps. Press `q` to exit.

## Usage

```javascript
const { Screen, box, text, progressBar, sparkline, A } = require('./index')

const screen = new Screen()
const data   = Array(40).fill(0)

screen.start((cols, rows) => {
  data.push(Math.random() * 100)
  data.shift()

  return [
    box({ x:1, y:1, w:50, h:6, title:'Live Chart', color: A.fg.cyan }),
    sparkline({ x:3, y:3, w:46, data, color: A.fg.green }),
    text({ x:3, y:5, content:`latest: ${data.at(-1).toFixed(1)}`, color: A.fg.gray }),
  ].join('')
})

screen.on('key', (k) => { if (k === 'q') screen.stop() })
```
