'use strict'
// tui demo — multi-tab interactive system monitor.
// Tabs: System | Processes | Disks | Help
// Press q or Ctrl-C to quit.

const os = require('os')
const fs = require('fs')

const {
  Screen, FocusManager,
  box, text, progressBar, sparkline, table,
  input, tabs, scrollList, modal, gauge,
  themes, stripAnsi, center,
  A,
} = require('./index')

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS       = ['System', 'Processes', 'Disks', 'Help']
const THEME      = themes.dark
const TAB_HEIGHT = 2   // tab bar rows

// ── Data collection ──────────────────────────────────────────────────────────

const cpuHistory = Array(80).fill(0)
const memHistory = Array(80).fill(0)
let   prevIdle   = 0
let   prevTotal  = 0

function cpuPercent() {
  const cpus = os.cpus()
  let idle = 0, total = 0
  for (const c of cpus) {
    for (const v of Object.values(c.times)) total += v
    idle += c.times.idle
  }
  const diffIdle  = idle  - prevIdle
  const diffTotal = total - prevTotal
  prevIdle  = idle
  prevTotal = total
  return diffTotal ? Math.round((1 - diffIdle / diffTotal) * 100) : 0
}

function memPercent() {
  return Math.round((1 - os.freemem() / os.totalmem()) * 100)
}

function formatBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return Math.round(b / 1e3) + ' KB'
}

function formatUptime(s) {
  const h  = Math.floor(s / 3600)
  const m  = Math.floor((s % 3600) / 60)
  const sc = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
}

// ── Fake process data ─────────────────────────────────────────────────────────

const PROC_NAMES = [
  'systemd','kworker','sshd','nginx','postgres','redis-server',
  'node','python3','bash','vim','chrome','firefox','electron',
  'docker','containerd','journald','dbus-daemon','NetworkManager',
  'rsyslogd','cron',
]

function makeFakeProcs() {
  return PROC_NAMES.map((name, i) => ({
    pid:  1000 + i * 37,
    name,
    cpu:  parseFloat((Math.random() * 15).toFixed(1)),
    mem:  parseFloat((Math.random() * 8).toFixed(1)),
  }))
}

let processes = makeFakeProcs()

// Randomly jitter cpu/mem a little each tick
function jitterProcs() {
  processes = processes.map(p => ({
    ...p,
    cpu: parseFloat(Math.max(0, p.cpu + (Math.random() - 0.5) * 2).toFixed(1)),
    mem: parseFloat(Math.max(0, p.mem + (Math.random() - 0.5) * 0.5).toFixed(1)),
  }))
}

// ── Disk data ─────────────────────────────────────────────────────────────────

function getDiskInfo(mountPath) {
  try {
    const stat = fs.statfsSync(mountPath)
    const total = stat.blocks * stat.bsize
    const free  = stat.bfree  * stat.bsize
    const used  = total - free
    return { path: mountPath, total, used, free, pct: Math.round((used / total) * 100) }
  } catch (_) {
    return { path: mountPath, total: 0, used: 0, free: 0, pct: 0 }
  }
}

// ── Application state ─────────────────────────────────────────────────────────

const state = {
  activeTab:    0,           // 0-3
  // Processes tab
  procSelected: 0,
  procScroll:   0,
  filterText:   '',
  focusIndex:   0,           // 0=filter input, 1=list  (for Processes tab)
  flashPid:     null,        // pid being "killed"
  flashTimer:   0,
  // Help tab
  helpScroll:   0,
}

const focusMgr = new FocusManager(2)   // filter input + list

// ── Keyboard handler ─────────────────────────────────────────────────────────

const screen = new Screen()
const startMs = Date.now()

screen.on('key', (k) => {
  // Tab switching — number keys 1-4
  if (k === '1') { state.activeTab = 0; return }
  if (k === '2') { state.activeTab = 1; state.focusIndex = focusMgr.current(); return }
  if (k === '3') { state.activeTab = 2; return }
  if (k === '4') { state.activeTab = 3; return }

  // Left/Right arrows — switch tabs
  if (k === '\x1b[D') { state.activeTab = Math.max(0, state.activeTab - 1); return }
  if (k === '\x1b[C') { state.activeTab = Math.min(TABS.length - 1, state.activeTab + 1); return }

  // Tab key — cycle focus on Processes tab
  if (k === '\t' && state.activeTab === 1) {
    focusMgr.next()
    state.focusIndex = focusMgr.current()
    return
  }
  if (k === '\x1b[Z' && state.activeTab === 1) {  // Shift-Tab
    focusMgr.prev()
    state.focusIndex = focusMgr.current()
    return
  }

  // Processes tab actions
  if (state.activeTab === 1) {
    const filtered = getFilteredProcs()

    // Arrow keys on list (focus 1) or anywhere when input not focused
    if (k === '\x1b[A') {  // Up
      if (state.procSelected > 0) {
        state.procSelected--
        if (state.procSelected < state.procScroll) state.procScroll = state.procSelected
      }
      return
    }
    if (k === '\x1b[B') {  // Down
      if (state.procSelected < filtered.length - 1) {
        state.procSelected++
      }
      return
    }

    // k = kill selected
    if (k === 'k') {
      const target = filtered[state.procSelected]
      if (target) {
        state.flashPid   = target.pid
        state.flashTimer = 6  // frames
        processes = processes.filter(p => p.pid !== target.pid)
        if (state.procSelected >= getFilteredProcs().length) {
          state.procSelected = Math.max(0, getFilteredProcs().length - 1)
        }
      }
      return
    }

    // Typing in filter input (focus 0)
    if (focusMgr.isFocused(0)) {
      if (k === '\x7f' || k === '\b') {  // Backspace
        state.filterText = state.filterText.slice(0, -1)
        state.procSelected = 0
        state.procScroll   = 0
      } else if (k.length === 1 && k >= ' ') {
        state.filterText += k
        state.procSelected = 0
        state.procScroll   = 0
      }
    }
  }
})

function getFilteredProcs() {
  const f = state.filterText.toLowerCase()
  return f
    ? processes.filter(p => p.name.toLowerCase().includes(f))
    : processes
}

// Clamp scroll so selected stays visible
function clampProcScroll(visH) {
  const filtered = getFilteredProcs()
  if (state.procSelected < state.procScroll) {
    state.procScroll = state.procSelected
  }
  if (state.procSelected >= state.procScroll + visH) {
    state.procScroll = state.procSelected - visH + 1
  }
  if (state.procScroll < 0) state.procScroll = 0
  if (state.procScroll > Math.max(0, filtered.length - visH)) {
    state.procScroll = Math.max(0, filtered.length - visH)
  }
}

// ── Tab renderers ─────────────────────────────────────────────────────────────

function renderSystem(cols, rows, contentY) {
  const out  = []
  const cpu  = cpuHistory[cpuHistory.length - 1]
  const mem  = memPercent()
  const half = Math.floor(cols / 2)

  // CPU box (left half)
  const cpuW = half - 1
  out.push(box({ x:1, y:contentY, w:cpuW, h:7, title:'CPU', color: THEME.accent }))
  out.push(progressBar({
    x: 3, y: contentY+2, w: cpuW - 4, value: cpu, max: 100,
    color: cpu > 80 ? THEME.danger : cpu > 50 ? A.fg.yellow : THEME.success,
  }))
  out.push(text({ x:3, y:contentY+3, content:`Current: ${cpu}%  Cores: ${os.cpus().length}`, color: THEME.dim }))
  out.push(sparkline({ x:3, y:contentY+4, w:cpuW-4, data:cpuHistory, color: THEME.accent }))
  out.push(text({ x:3, y:contentY+5, content:os.cpus()[0]?.model.slice(0,cpuW-6) || '', color: THEME.dim }))

  // Memory box (right half)
  const memX = half + 1
  const memW = cols - half - 1
  const memFree  = os.freemem()
  const memTotal = os.totalmem()
  out.push(box({ x:memX, y:contentY, w:memW, h:7, title:'Memory', color: THEME.info }))
  out.push(progressBar({
    x: memX+2, y: contentY+2, w: memW - 4, value: mem, max: 100, color: THEME.info,
  }))
  out.push(text({ x:memX+2, y:contentY+3,
    content:`Used: ${formatBytes(memTotal-memFree)} / ${formatBytes(memTotal)}`, color: THEME.dim }))
  out.push(sparkline({ x:memX+2, y:contentY+4, w:memW-4, data:memHistory, color: THEME.info }))
  out.push(text({ x:memX+2, y:contentY+5, content:`Free: ${formatBytes(memFree)}`, color: THEME.dim }))

  const infoY = contentY + 8

  // System info box
  out.push(box({ x:1, y:infoY, w:Math.floor(cols*0.55)-1, h:6, title:'System Info', color: THEME.dim }))
  out.push(text({ x:3, y:infoY+1, content:`OS:       ${os.type()} ${os.release()}`, color: A.fg.white }))
  out.push(text({ x:3, y:infoY+2, content:`Hostname: ${os.hostname()}`, color: A.fg.white }))
  out.push(text({ x:3, y:infoY+3, content:`Arch:     ${os.arch()}   Platform: ${os.platform()}`, color: A.fg.white }))
  out.push(text({ x:3, y:infoY+4, content:`Uptime:   ${formatUptime(Math.floor(os.uptime()))}`, color: A.fg.white }))

  // Load average box
  const laX = Math.floor(cols*0.55) + 1
  const laW = cols - laX
  out.push(box({ x:laX, y:infoY, w:laW, h:6, title:'Load Average', color: THEME.dim }))
  const [l1, l5, l15] = os.loadavg()
  const cores = os.cpus().length
  const loadColor = (v) => v > cores ? THEME.danger : v > cores * 0.7 ? A.fg.yellow : THEME.success
  out.push(text({ x:laX+2, y:infoY+1, content:' 1 min', color: THEME.dim }))
  out.push(gauge({ x:laX+2, y:infoY+2, value:parseFloat(l1.toFixed(1)), max:cores*2, label:'1m',  color:loadColor(l1) }))

  return out.join('')
}

function renderProcesses(cols, rows, contentY) {
  const out      = []
  const filtered = getFilteredProcs()
  const listH    = rows - contentY - 5  // rows for the list
  const listY    = contentY + 4         // after filter input

  clampProcScroll(listH)

  // Flash decrement
  if (state.flashTimer > 0) state.flashTimer--
  else state.flashPid = null

  // Filter input
  out.push(text({ x:1, y:contentY, content: THEME.dim + 'Filter processes:' + A.reset }))
  out.push(input({
    x:1, y:contentY+1, w:Math.min(50, cols-2),
    value:       state.filterText,
    placeholder: 'type to filter...',
    focused:     focusMgr.isFocused(0),
    color:       THEME.highlight,
  }))

  // List header
  const hdrY = listY - 1
  out.push(text({ x:1, y:hdrY,
    content: A.bold + THEME.accent +
      'PID'.padEnd(7) + 'NAME'.padEnd(20) + 'CPU%'.padEnd(8) + 'MEM%' +
      A.reset,
  }))
  out.push(text({ x:1, y:hdrY+0, content: A.move(hdrY, 1) }))  // noop, already set

  // Format items for scrollList
  const items = filtered.map(p => {
    const flash = p.pid === state.flashPid
    const line  = String(p.pid).padEnd(7) +
                  p.name.padEnd(20) +
                  String(p.cpu).padEnd(8) +
                  String(p.mem)
    return flash ? A.bg.red + A.fg.white + line + A.reset : line
  })

  out.push(scrollList({
    x:1, y:listY, w:cols-1, h:Math.max(1, listH),
    items,
    selected:     state.procSelected,
    scrollOffset: state.procScroll,
    focused:      focusMgr.isFocused(1),
    color:        THEME.highlight,
  }))

  if (filtered.length === 0) {
    out.push(text({ x:3, y:listY+1, content:'No processes match filter.', color: THEME.dim }))
  }

  return out.join('')
}

function renderDisks(cols, rows, contentY) {
  const out    = []
  const mounts = ['/', '/tmp', '/home']
  let curY     = contentY

  out.push(text({ x:1, y:curY, content: THEME.accent + A.bold + 'Disk Usage' + A.reset }))
  curY += 1

  const barW = Math.min(50, cols - 30)

  for (const mp of mounts) {
    const d = getDiskInfo(mp)
    if (d.total === 0) continue

    out.push(box({ x:1, y:curY, w:cols-1, h:5, title:mp, color: THEME.dim }))
    const color = d.pct > 90 ? THEME.danger : d.pct > 70 ? A.fg.yellow : THEME.success
    out.push(progressBar({ x:3, y:curY+1, w:barW, value:d.pct, max:100, color }))
    out.push(text({ x:3, y:curY+2,
      content:`Used: ${formatBytes(d.used)}  Free: ${formatBytes(d.free)}  Total: ${formatBytes(d.total)}`,
      color: THEME.dim,
    }))
    out.push(gauge({ x:cols-18, y:curY+1, value:d.used, max:d.total, label:'used', color }))
    curY += 6
  }

  return out.join('')
}

function renderHelp(cols, rows, contentY) {
  const out = []
  let y = contentY

  const section = (title) => {
    out.push(text({ x:1, y, content: THEME.accent + A.bold + title + A.reset }))
    out.push(text({ x:1, y:y+1, content: A.dim + '─'.repeat(Math.min(50, cols-2)) + A.reset }))
    y += 2
  }

  const row = (key, desc) => {
    out.push(text({ x:3, y, content: A.bold + key.padEnd(20) + A.reset + A.fg.white + desc + A.reset }))
    y += 1
  }

  section('Navigation')
  row('1 / 2 / 3 / 4',  'Switch to tab by number')
  row('← / →',          'Previous / next tab')
  row('q  or  Ctrl-C',  'Quit')
  y += 1

  section('Processes Tab')
  row('Tab / Shift-Tab', 'Cycle focus (filter ↔ list)')
  row('↑ / ↓',           'Move selection in list')
  row('k',               '"Kill" (remove) selected process')
  row('Type characters', 'Filter processes by name')
  row('Backspace',       'Delete filter character')
  y += 1

  section('About')
  out.push(text({ x:3, y:y,   content: A.fg.white + 'tui — terminal UI framework' + A.reset }))
  out.push(text({ x:3, y:y+1, content: THEME.dim  + 'Built with raw ANSI escape codes.' + A.reset }))
  out.push(text({ x:3, y:y+2, content: THEME.dim  + 'Widgets: box, text, progressBar, sparkline,' + A.reset }))
  out.push(text({ x:3, y:y+3, content: THEME.dim  + '  table, input, tabs, scrollList, modal, gauge.' + A.reset }))

  return out.join('')
}

// ── Main render ───────────────────────────────────────────────────────────────

screen.start((cols, rows) => {
  const out     = []
  const uptime  = Math.floor((Date.now() - startMs) / 1000)
  const cpu     = cpuHistory[cpuHistory.length - 1]

  // Title bar (row 1)
  const title  = '  tui — system monitor  '
  const uptStr = `uptime ${formatUptime(uptime)}`
  out.push(A.move(1, 1) + A.bg.rgb(18,18,18) + A.fg.rgb(200,255,0) + A.bold +
    title.padEnd(cols) + A.reset)
  out.push(text({ x: cols - uptStr.length - 1, y:1, content:uptStr, color: A.fg.gray }))

  // Tabs bar (row 2)
  out.push(tabs({ x:1, y:2, items:TABS, active:state.activeTab, color: THEME.accent }))

  // Separator (row 3)
  out.push(A.move(3, 1) + THEME.dim + '─'.repeat(cols) + A.reset)

  const contentY = 4  // content starts at row 4

  // Render active tab
  if (state.activeTab === 0) out.push(renderSystem(cols, rows, contentY))
  if (state.activeTab === 1) out.push(renderProcesses(cols, rows, contentY))
  if (state.activeTab === 2) out.push(renderDisks(cols, rows, contentY))
  if (state.activeTab === 3) out.push(renderHelp(cols, rows, contentY))

  // Footer (last row)
  const footerParts = [
    '[q] quit',
    '[←/→] tabs',
    '[1-4] jump tab',
  ]
  if (state.activeTab === 1) {
    footerParts.push('[Tab] focus', '[↑↓] select', '[k] kill')
  }
  const footerStr = '  ' + footerParts.join('  ·  ') + '  '
  out.push(A.move(rows, 1) + A.bg.rgb(18,18,18) + THEME.dim + footerStr.slice(0, cols).padEnd(cols) + A.reset)

  return out.join('')
})

// ── Data update loop ──────────────────────────────────────────────────────────

setInterval(() => {
  cpuHistory.push(cpuPercent())
  cpuHistory.shift()
  memHistory.push(memPercent())
  memHistory.shift()
  jitterProcs()
}, 500)
