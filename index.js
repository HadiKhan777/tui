'use strict'
// tui — terminal UI framework built on raw ANSI escape codes.
// Primitives: Box, Text, Table, ProgressBar, Sparkline, Input.
// Render loop: full diff-based repaint at up to 30fps.

const { EventEmitter } = require('events')

// ── ANSI ─────────────────────────────────────────────────────────────────────

const A = {
  reset:     '\x1b[0m',
  bold:      '\x1b[1m',
  dim:       '\x1b[2m',
  underline: '\x1b[4m',
  clear:     '\x1b[2J',
  home:      '\x1b[H',
  hideCursor:'\x1b[?25l',
  showCursor:'\x1b[?25h',
  alt:       '\x1b[?1049h',
  mainScreen:'\x1b[?1049l',
  move:      (row, col) => `\x1b[${row};${col}H`,

  fg: {
    black:   '\x1b[30m', red:     '\x1b[31m', green:  '\x1b[32m',
    yellow:  '\x1b[33m', blue:    '\x1b[34m', magenta:'\x1b[35m',
    cyan:    '\x1b[36m', white:   '\x1b[37m', gray:   '\x1b[90m',
    bright:  (c) => `\x1b[${90 + c}m`,
    rgb:     (r,g,b) => `\x1b[38;2;${r};${g};${b}m`,
  },
  bg: {
    black:   '\x1b[40m', red:     '\x1b[41m', green:  '\x1b[42m',
    yellow:  '\x1b[43m', blue:    '\x1b[44m', magenta:'\x1b[45m',
    cyan:    '\x1b[46m', white:   '\x1b[47m', gray:   '\x1b[100m',
    rgb:     (r,g,b) => `\x1b[48;2;${r};${g};${b}m`,
  },
}

// ── Widgets ───────────────────────────────────────────────────────────────────

function box(opts) {
  const { x, y, w, h, title = '', border = 'single', color = '' } = opts
  const B = border === 'double'
    ? { tl:'╔', tr:'╗', bl:'╚', br:'╝', h:'═', v:'║' }
    : { tl:'┌', tr:'┐', bl:'└', br:'┘', h:'─', v:'│' }

  const lines = []
  const titleStr = title ? ` ${title} ` : ''
  const topLine  = B.tl + titleStr + B.h.repeat(w - 2 - titleStr.length) + B.tr
  lines.push(A.move(y, x) + color + topLine + A.reset)
  for (let i = 1; i < h - 1; i++) {
    lines.push(A.move(y + i, x) + color + B.v + ' '.repeat(w - 2) + B.v + A.reset)
  }
  lines.push(A.move(y + h - 1, x) + color + B.bl + B.h.repeat(w - 2) + B.br + A.reset)
  return lines.join('')
}

function text(opts) {
  const { x, y, content, color = '', truncate = 80 } = opts
  const str = String(content).slice(0, truncate)
  return A.move(y, x) + color + str + A.reset
}

function progressBar(opts) {
  const { x, y, w, value, max = 100, label = '', color = A.fg.green } = opts
  const pct     = Math.min(1, value / max)
  const filled  = Math.round(pct * (w - 2))
  const empty   = (w - 2) - filled
  const bar     = '[' + color + '█'.repeat(filled) + A.reset + '░'.repeat(empty) + ']'
  const pctStr  = ` ${Math.round(pct * 100)}%`
  return A.move(y, x) + (label ? A.bold + label + ' ' + A.reset : '') + bar + pctStr
}

function sparkline(opts) {
  const { x, y, w, data, color = A.fg.cyan } = opts
  const chars  = '▁▂▃▄▅▆▇█'
  const slice  = data.slice(-w)
  const mn     = Math.min(...slice)
  const mx     = Math.max(...slice) || 1
  const cells  = slice.map(v => chars[Math.floor(((v - mn) / (mx - mn)) * 7)] || '▁')
  return A.move(y, x) + color + cells.join('') + A.reset
}

function table(opts) {
  const { x, y, headers, rows, colWidths, color = '' } = opts
  const lines = []
  const fmt   = (cells) => cells.map((c, i) => String(c).slice(0, colWidths[i]).padEnd(colWidths[i])).join('  ')
  lines.push(A.move(y, x) + A.bold + color + fmt(headers) + A.reset)
  lines.push(A.move(y + 1, x) + A.dim + '─'.repeat(colWidths.reduce((a, b) => a + b + 2, -2)) + A.reset)
  rows.forEach((row, i) => {
    lines.push(A.move(y + 2 + i, x) + fmt(row))
  })
  return lines.join('')
}

// ── Screen ────────────────────────────────────────────────────────────────────

class Screen extends EventEmitter {
  constructor() {
    super()
    this._buf       = ''
    this._fps       = 30
    this._timer     = null
    this._renderFn  = null
    this._rows      = process.stdout.rows  || 24
    this._cols      = process.stdout.columns || 80

    process.stdout.on('resize', () => {
      this._rows = process.stdout.rows
      this._cols = process.stdout.columns
      this.emit('resize', this._cols, this._rows)
    })
  }

  get rows() { return this._rows }
  get cols()  { return this._cols }

  start(renderFn) {
    this._renderFn = renderFn
    process.stdout.write(A.alt + A.hideCursor + A.clear)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on('data', (key) => {
        const k = key.toString()
        if (k === '\x03' || k === 'q') this.stop()   // Ctrl-C or q
        this.emit('key', k)
      })
    }
    this._timer = setInterval(() => this._repaint(), 1000 / this._fps)
    this._repaint()
  }

  _repaint() {
    if (!this._renderFn) return
    process.stdout.write(A.home)
    process.stdout.write(this._renderFn(this._cols, this._rows))
  }

  write(str) { process.stdout.write(str) }

  stop() {
    clearInterval(this._timer)
    process.stdout.write(A.showCursor + A.mainScreen)
    process.exit(0)
  }
}

module.exports = { Screen, box, text, progressBar, sparkline, table, A }
