# tui

Terminal UI framework built on raw ANSI escape codes — no curses, no blessed, no dependencies.

A full widget library with a 30fps render loop, focus management, and keyboard navigation.

## Widgets

| Widget | Description |
|--------|-------------|
| `box` | Bordered box with optional title, single or double border |
| `text` | Positioned coloured text |
| `progressBar` | Filled bar with percentage |
| `sparkline` | ASCII sparkline from a data array |
| `table` | Columnar data with headers |
| `input` | Single-line text input with cursor, placeholder, focus highlight |
| `tabs` | Horizontal tab bar, bold+underline on active |
| `scrollList` | Scrollable list with selection highlight and proportional scrollbar |
| `modal` | Centered double-border dialog with buttons |
| `gauge` | Compact progress gauge |

## Classes & utilities

- **`Screen`** — manages the alternate screen buffer, 30fps render loop, raw keyboard input, resize events
- **`FocusManager`** — tracks focused widget index, Tab/Shift-Tab cycling
- **`themes`** — `dark` · `ocean` · `fire` colour presets
- **`stripAnsi`** — strips ANSI codes for accurate string width measurement
- **`center`**, **`vstack`**, **`hstack`** — layout helpers

## Demo

```bash
node demo.js
```

Four-tab interactive system monitor:

**System** — CPU sparkline + progress bar, memory bar + sparkline, OS info, load average  
**Processes** — scrollable process list, live CPU/mem jitter, filter input (Tab to focus), `k` to kill  
**Disks** — per-mount usage bars and gauges via `fs.statfsSync`  
**Help** — key bindings reference

**Keyboard:** `←/→` or `1`–`4` switch tabs · `↑/↓` navigate lists · Tab cycles focus · `k` kill process · `q` quit

## Usage

```javascript
const { Screen, FocusManager, box, text, progressBar, sparkline, input, tabs, scrollList, themes, A } = require('./index')

const screen = new Screen()
const focus  = new FocusManager(2)
const state  = { query: '', selected: 0 }
const items  = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']

screen.on('key', (k) => {
  if (k === '\t')     focus.next()
  if (k === '\x1b[A') state.selected = Math.max(0, state.selected - 1)
  if (k === '\x1b[B') state.selected = Math.min(items.length - 1, state.selected + 1)
  if (focus.isFocused(0) && k.length === 1) state.query += k
  if (focus.isFocused(0) && k === '\x7f')   state.query = state.query.slice(0, -1)
})

screen.start((cols, rows) => {
  const filtered = items.filter(i => i.includes(state.query))
  const out = []
  out.push(box({ x:1, y:1, w:cols-2, h:rows-2, title:'Search', color: themes.dark.accent }))
  out.push(input({ x:3, y:3, w:cols-6, value: state.query, placeholder: 'filter...', focused: focus.isFocused(0) }))
  out.push(scrollList({ x:3, y:7, w:cols-6, h:rows-10, items: filtered, selected: state.selected, focused: focus.isFocused(1) }))
  return out.join('')
})
```

## How it works

The `Screen` class switches to the alternate terminal buffer (`\x1b[?1049h`), hides the cursor, and starts a `setInterval` at 30fps. On each tick, it calls the render function and writes the full output starting at position (1,1). Because the entire frame is re-written from the top each tick, there's no diffing — fast enough for terminal UIs and simpler to reason about.

Raw mode (`stdin.setRawMode(true)`) captures individual keystrokes including arrow keys and Ctrl sequences before they reach the line editor.
