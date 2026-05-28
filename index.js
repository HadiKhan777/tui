'use strict'
// tui — terminal UI framework built on raw ANSI escape codes.
// Primitives: Box, Text, Table, ProgressBar, Sparkline, Input, Tabs,
//             ScrollList, Modal, Gauge, FocusManager, Layout helpers, Themes.
// Render loop: full repaint at up to 30fps.

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

// ── Existing Widgets ──────────────────────────────────────────────────────────

function box(opts) {
  const { x, y, w, h, title = '', border = 'single', color = '' } = opts
  const B = border === 'double'
    ? { tl:'╔', tr:'╗', bl:'╚', br:'╝', h:'═', v:'║' }
    : { tl:'┌', tr:'┐', bl:'└', br:'┘', h:'─', v:'│' }

  const lines = []
  const titleStr = title ? ` ${title} ` : ''
  const innerW   = Math.max(0, w - 2 - titleStr.length)
  const topLine  = B.tl + titleStr + B.h.repeat(innerW) + B.tr
  lines.push(A.move(y, x) + color + topLine + A.reset)
  for (let i = 1; i < h - 1; i++) {
    lines.push(A.move(y + i, x) + color + B.v + ' '.repeat(w - 2) + B.v + A.reset)
  }
  if (h > 1) {
    lines.push(A.move(y + h - 1, x) + color + B.bl + B.h.repeat(w - 2) + B.br + A.reset)
  }
  return lines.join('')
}

function text(opts) {
  const { x, y, content, color = '', truncate = 200 } = opts
  const str = String(content).slice(0, truncate)
  return A.move(y, x) + color + str + A.reset
}

function progressBar(opts) {
  const { x, y, w, value, max = 100, label = '', color = A.fg.green } = opts
  const pct     = Math.min(1, Math.max(0, value / max))
  const barW    = Math.max(2, w - 2)
  const filled  = Math.round(pct * barW)
  const empty   = barW - filled
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
  const cells  = slice.map(v => chars[Math.min(7, Math.floor(((v - mn) / (mx - mn)) * 7.99))] || '▁')
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

// ── FocusManager ─────────────────────────────────────────────────────────────

class FocusManager {
  constructor(count) {
    this._count   = count
    this._current = 0
  }

  next() {
    this._current = (this._current + 1) % this._count
    return this._current
  }

  prev() {
    this._current = (this._current - 1 + this._count) % this._count
    return this._current
  }

  current() {
    return this._current
  }

  isFocused(i) {
    return this._current === i
  }

  setCount(count) {
    this._count = count
    if (this._current >= count) this._current = 0
  }
}

// ── Input widget ──────────────────────────────────────────────────────────────

function input(opts) {
  const {
    x, y, w,
    value       = '',
    placeholder = '',
    focused     = false,
    label       = '',
    color       = A.fg.white,
  } = opts

  const labelStr  = label ? label + ' ' : ''
  const labelLen  = stripAnsi(labelStr).length
  const boxX      = x + labelLen
  const innerW    = Math.max(1, w - labelLen - 2)  // -2 for borders

  let display
  if (focused) {
    const withCursor = value + '█'
    const visible    = withCursor.slice(-innerW)
    display = color + visible.padEnd(innerW) + A.reset
  } else {
    if (value === '') {
      display = A.dim + placeholder.slice(0, innerW).padEnd(innerW) + A.reset
    } else {
      display = color + value.slice(-innerW).padEnd(innerW) + A.reset
    }
  }

  const borderColor = focused ? A.fg.rgb(200,255,0) : A.fg.gray
  const top    = borderColor + '┌' + '─'.repeat(innerW) + '┐' + A.reset
  const middle = borderColor + '│' + A.reset + display + borderColor + '│' + A.reset
  const bottom = borderColor + '└' + '─'.repeat(innerW) + '┘' + A.reset

  const out = []
  out.push(A.move(y,   x) + A.bold + color + labelStr + A.reset + top)
  out.push(A.move(y+1, x) + ' '.repeat(labelLen)                 + middle)
  out.push(A.move(y+2, x) + ' '.repeat(labelLen)                 + bottom)
  return out.join('')
}

// ── Tabs widget ───────────────────────────────────────────────────────────────

function tabs(opts) {
  const { x, y, items, active = 0, color = A.fg.rgb(200,255,0) } = opts
  let out = A.move(y, x)
  items.forEach((label, i) => {
    if (i === active) {
      out += A.bold + A.underline + color + ` ${label} ` + A.reset
    } else {
      out += A.dim + A.fg.gray + ` ${label} ` + A.reset
    }
    out += A.fg.gray + '│' + A.reset
  })
  return out
}

// ── ScrollList widget ─────────────────────────────────────────────────────────

function scrollList(opts) {
  const {
    x, y, w, h,
    items        = [],
    selected     = 0,
    scrollOffset = 0,
    focused      = false,
    color        = A.fg.white,
  } = opts

  const out         = []
  const borderColor = focused ? A.fg.rgb(200,255,0) : A.fg.gray
  const innerW      = w - 3  // -2 border cols, -1 scrollbar col
  const total       = items.length

  for (let row = 0; row < h; row++) {
    const itemIdx = scrollOffset + row
    const atY     = y + row

    if (itemIdx >= total) {
      out.push(A.move(atY, x) + ' '.repeat(w))
      continue
    }

    const item       = String(items[itemIdx]).slice(0, innerW).padEnd(innerW)
    const isSelected = itemIdx === selected

    // Scrollbar
    const sbH    = total > h ? Math.max(1, Math.round((h / total) * h)) : h
    const sbTop  = total > h
      ? Math.min(h - sbH, Math.round((scrollOffset / (total - h)) * (h - sbH)))
      : 0
    const inSb   = total > h && row >= sbTop && row < sbTop + sbH
    const sbChar = total > h
      ? (inSb ? (borderColor + '█' + A.reset) : (A.dim + '░' + A.reset))
      : ' '

    if (isSelected) {
      out.push(
        A.move(atY, x) +
        A.bg.rgb(40,40,60) + color + A.bold +
        '▶ ' + item +
        A.reset +
        sbChar
      )
    } else {
      out.push(
        A.move(atY, x) +
        '  ' + A.reset + item + A.reset +
        sbChar
      )
    }
  }
  return out.join('')
}

// ── Modal widget ──────────────────────────────────────────────────────────────

function modal(opts) {
  const {
    cols, rows,
    w = 40, h = 10,
    title       = '',
    content     = [],
    buttons     = [],
    activeButton= 0,
  } = opts

  const mx = Math.floor((cols - w) / 2) + 1
  const my = Math.floor((rows - h) / 2) + 1
  const out = []

  out.push(box({ x:mx, y:my, w, h, title, border:'double', color: A.fg.rgb(200,255,0) }))

  content.forEach((line, i) => {
    const truncated = String(line).slice(0, w - 4)
    out.push(A.move(my + 1 + i, mx + 2) + A.reset + truncated)
  })

  if (buttons.length > 0) {
    let btnRow = ''
    buttons.forEach((btn, i) => {
      if (i === activeButton) {
        btnRow += A.bold + A.bg.rgb(200,255,0) + A.fg.black + ` ${btn} ` + A.reset + '  '
      } else {
        btnRow += A.dim + A.fg.gray + `[ ${btn} ]` + A.reset + '  '
      }
    })
    const btnLen = stripAnsi(btnRow).length
    const btnX   = mx + Math.floor((w - btnLen) / 2)
    out.push(A.move(my + h - 2, btnX) + btnRow)
  }

  return out.join('')
}

// ── Gauge widget ──────────────────────────────────────────────────────────────

function gauge(opts) {
  const { x, y, value = 0, max = 100, label = '', color = A.fg.green } = opts
  const pct    = Math.min(100, Math.max(0, Math.round((value / max) * 100)))
  const barW   = 12
  const filled = Math.round((pct / 100) * barW)
  const bar    = color + '█'.repeat(filled) + A.reset + A.dim + '░'.repeat(barW - filled) + A.reset

  const out = []
  out.push(A.move(y,   x) + color + A.bold + String(pct).padStart(3) + '%' + A.reset + A.dim + ' ' + label + A.reset)
  out.push(A.move(y+1, x) + '[' + bar + ']')
  out.push(A.move(y+2, x) + A.dim + `${value}/${max}` + A.reset)
  return out.join('')
}

// ── Themes ────────────────────────────────────────────────────────────────────

const themes = {
  dark: {
    accent:    A.fg.rgb(200,255,0),
    dim:       A.fg.gray,
    highlight: A.fg.white,
    border:    A.fg.rgb(80,80,80),
    danger:    A.fg.red,
    success:   A.fg.green,
    info:      A.fg.cyan,
  },
  ocean: {
    accent:    A.fg.cyan,
    dim:       A.fg.gray,
    highlight: A.fg.rgb(180,220,255),
    border:    A.fg.rgb(30,80,120),
    danger:    A.fg.rgb(255,80,80),
    success:   A.fg.rgb(0,200,150),
    info:      A.fg.rgb(100,180,255),
  },
  fire: {
    accent:    A.fg.rgb(255,100,0),
    dim:       A.fg.rgb(100,60,0),
    highlight: A.fg.rgb(255,200,100),
    border:    A.fg.rgb(120,40,0),
    danger:    A.fg.red,
    success:   A.fg.rgb(200,200,0),
    info:      A.fg.rgb(255,160,0),
  },
}

// ── Layout helpers ────────────────────────────────────────────────────────────

// Strip ANSI escape codes to measure visual width
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[mhH]/g, '').replace(/\x1b\[\?[0-9]+[hl]/g, '')
}

/**
 * vstack — stack items vertically.
 * Items: { render: fn(x, y) => string, height: number }
 */
function vstack(items, { x = 1, y = 1, gap = 1 } = {}) {
  let curY = y
  const parts = []
  for (const item of items) {
    if (typeof item === 'string') {
      parts.push(item)
    } else if (item && typeof item.render === 'function') {
      parts.push(item.render(x, curY))
      curY += (item.height || 1) + gap
    }
  }
  return parts.join('')
}

/**
 * hstack — stack items horizontally.
 * Items: { render: fn(x, y) => string, width: number }
 */
function hstack(items, { x = 1, y = 1, gap = 2 } = {}) {
  let curX = x
  const parts = []
  for (const item of items) {
    if (typeof item === 'string') {
      parts.push(item)
    } else if (item && typeof item.render === 'function') {
      parts.push(item.render(curX, y))
      curX += (item.width || 0) + gap
    }
  }
  return parts.join('')
}

/**
 * center — center a plain string within `width` characters.
 */
function center(str, width) {
  const visual = stripAnsi(str).length
  const pad    = Math.max(0, Math.floor((width - visual) / 2))
  return ' '.repeat(pad) + str
}

// ── Screen ────────────────────────────────────────────────────────────────────

class Screen extends EventEmitter {
  constructor() {
    super()
    this._buf       = ''
    this._fps       = 30
    this._timer     = null
    this._renderFn  = null
    this._rows      = process.stdout.rows    || 24
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

module.exports = {
  Screen,
  FocusManager,
  box, text, progressBar, sparkline, table,
  input, tabs, scrollList, modal, gauge,
  themes, stripAnsi,
  vstack, hstack, center,
  A,
}
