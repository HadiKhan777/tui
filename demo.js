'use strict'
// tui demo — live system monitor dashboard.
// Shows: CPU sparkline, memory bar, process table, uptime counter.
// Press q or Ctrl-C to exit.

const os  = require('os')
const { Screen, box, text, progressBar, sparkline, table, A } = require('./index')

// ── Data collection ──────────────────────────────────────────────────────────

const cpuHistory  = Array(60).fill(0)
const memHistory  = Array(60).fill(0)
let   prevIdle    = 0
let   prevTotal   = 0

function cpuPercent() {
  const cpus  = os.cpus()
  let idle    = 0, total = 0
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
  const total = os.totalmem()
  const free  = os.freemem()
  return Math.round((1 - free / total) * 100)
}

function formatBytes(b) {
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
  return Math.round(b / 1e3) + ' KB'
}

function formatUptime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sc = s % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`
}

// ── Main ──────────────────────────────────────────────────────────────────────

const screen = new Screen()
const start  = Date.now()

setInterval(() => {
  cpuHistory.push(cpuPercent())
  cpuHistory.shift()
  memHistory.push(memPercent())
  memHistory.shift()
}, 500)

screen.start((cols, rows) => {
  const cpu = cpuHistory[cpuHistory.length - 1]
  const mem = memPercent()
  const uptime = Math.floor((Date.now() - start) / 1000)

  const out = []

  // Title bar
  out.push(A.bg.rgb(12,12,12) + A.fg.rgb(200,255,0) + A.bold)
  out.push(text({ x:1, y:1, content:'  tui — system monitor  ' }))
  out.push(A.reset)
  out.push(text({ x:cols-20, y:1, content:`uptime ${formatUptime(uptime)}`, color: A.fg.gray }))

  // CPU box
  out.push(box({ x:1, y:2, w:Math.floor(cols/2)-1, h:7, title:'CPU', color: A.fg.rgb(200,255,0) }))
  out.push(progressBar({ x:3, y:4, w:Math.floor(cols/2)-5, value:cpu, max:100,
    color: cpu > 80 ? A.fg.red : cpu > 50 ? A.fg.yellow : A.fg.green }))
  out.push(text({ x:3, y:5, content:`Current: ${cpu}%`, color: A.fg.gray }))
  out.push(sparkline({ x:3, y:6, w:Math.floor(cols/2)-5, data:cpuHistory, color: A.fg.rgb(200,255,0) }))
  out.push(text({ x:3, y:7, content:`Cores: ${os.cpus().length}  Model: ${os.cpus()[0]?.model.slice(0,30)}`, color: A.fg.gray }))

  // MEM box
  const memFree  = os.freemem()
  const memTotal = os.totalmem()
  out.push(box({ x:Math.floor(cols/2)+1, y:2, w:Math.ceil(cols/2)-1, h:7, title:'Memory', color: A.fg.cyan }))
  out.push(progressBar({ x:Math.floor(cols/2)+3, y:4, w:Math.ceil(cols/2)-5, value:mem, max:100, color: A.fg.cyan }))
  out.push(text({ x:Math.floor(cols/2)+3, y:5,
    content:`Used: ${formatBytes(memTotal-memFree)} / ${formatBytes(memTotal)}`, color: A.fg.gray }))
  out.push(sparkline({ x:Math.floor(cols/2)+3, y:6, w:Math.ceil(cols/2)-5, data:memHistory, color: A.fg.cyan }))
  out.push(text({ x:Math.floor(cols/2)+3, y:7, content:`Free: ${formatBytes(memFree)}`, color: A.fg.gray }))

  // OS info box
  out.push(box({ x:1, y:9, w:cols-1, h:5, title:'System', color: A.fg.gray }))
  out.push(text({ x:3, y:10, content:`OS:       ${os.type()} ${os.release()}`, color: A.fg.white }))
  out.push(text({ x:3, y:11, content:`Hostname: ${os.hostname()}`, color: A.fg.white }))
  out.push(text({ x:3, y:12, content:`Arch:     ${os.arch()}   Platform: ${os.platform()}`, color: A.fg.white }))

  // Process table
  out.push(box({ x:1, y:14, w:cols-1, h:rows-14, title:'Load Average', color: A.fg.gray }))
  const [l1, l5, l15] = os.loadavg()
  out.push(table({
    x: 3, y: 15,
    headers:   ['Interval', 'Load'],
    colWidths: [10, 20],
    rows: [
      ['1 min',  l1.toFixed(3) + (l1 > os.cpus().length ? ' ⚠' : '')],
      ['5 min',  l5.toFixed(3)],
      ['15 min', l15.toFixed(3)],
    ],
    color: A.fg.white,
  }))

  // Footer
  out.push(text({ x:1, y:rows, content:' [q] quit ', color: A.dim }))

  return out.join('')
})
