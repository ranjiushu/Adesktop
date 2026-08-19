// 共享启动逻辑：定位 Chromium，启动无头浏览器
// 优先级：环境变量 CHROME_PATH > 系统 chromium/chrome
// ═══════════════════════════════════════════════════════════════
//  沙盒内委托技能层（单一真相，避免内嵌副本漂移——历史教训：内嵌副本必漂移，
//  release-check 旧脚本检查 .git-hooks/ 路径静默假绿）。技能层含 aarch64 arm64
//  chrome 自动发现；外部环境（无技能层）回退下方自身逻辑。
// ═══════════════════════════════════════════════════════════════
try {
  module.exports = require('/skills/ui-verify/scripts/lib/browser.js')
  return
} catch (e) { /* 无技能层 → 使用下方兜底逻辑 */ }

const puppeteer = require('puppeteer-core')
const fs = require('fs')
const { execSync } = require('child_process')

function findChromium() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH
  }
  const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  try {
    const out = execSync('which chromium chromium-browser google-chrome 2>/dev/null | head -1').toString().trim()
    if (out) return out
  } catch (e) {}
  throw new Error('找不到 Chromium。请先运行 setup.sh，或设置 CHROME_PATH 环境变量。')
}

async function launch() {
  return puppeteer.launch({
    executablePath: findChromium(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  })
}

// 解析通用参数：--safe-top <px> --width <n> --height <n> --dsf <n> --eval <file>
function parseCommonArgs(argv) {
  const opts = { width: 412, height: 915, dsf: 2.75, safeTop: null, evalFile: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--width') opts.width = parseFloat(argv[++i])
    else if (argv[i] === '--height') opts.height = parseFloat(argv[++i])
    else if (argv[i] === '--dsf') opts.dsf = parseFloat(argv[++i])
    else if (argv[i] === '--safe-top') opts.safeTop = argv[++i]
    else if (argv[i] === '--eval') opts.evalFile = argv[++i]
  }
  return opts
}

async function openPage(browser, htmlPath, opts) {
  const page = await browser.newPage()
  await page.setViewport({ width: opts.width, height: opts.height, deviceScaleFactor: opts.dsf })
  if (opts.safeTop) {
    // evaluateOnNewDocument：每次导航（含后续 reload）都重新注入，内联样式不会丢
    await page.evaluateOnNewDocument((v) => {
      document.documentElement.style.setProperty('--safe-top', v)
    }, opts.safeTop)
  }
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 30000 })
  if (opts.evalFile) {
    const code = fs.readFileSync(opts.evalFile, 'utf8')
    await page.evaluate(code)
    // eval 里通常写 localStorage，reload 让应用吃到数据
    await page.reload({ waitUntil: 'networkidle0' })
  }
  await new Promise(r => setTimeout(r, 800))
  if (opts.safeTop) {
    // 双保险：应用 JS 可能在启动时覆盖 documentElement 内联样式，落定后再设一次
    await page.evaluate((v) => {
      document.documentElement.style.setProperty('--safe-top', v)
    }, opts.safeTop)
    await new Promise(r => setTimeout(r, 200))
  }
  return page
}

module.exports = { launch, parseCommonArgs, openPage }
