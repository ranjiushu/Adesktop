#!/usr/bin/env bash
# [常驻] 构建时变量注入：Git 元数据 + 源码/非源码文件统计 + 仓库地图生成
# ═══════════════════════════════════════════════════════════════
# 追加 var 声明到 <tmp_js>，输出进度到 stdout
# 副作用：写入 docs/repo-map.md
# 用法: bash tools/build-stats.sh <src_dir> <project_root> <tmp_js>
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SRC_DIR="$1"
SCRIPT_DIR="$2"
TMP_JS="$3"

export SRC_DIR
export SCRIPT_DIR

# ── 5. 近期提交记录（单次 git log --numstat 批量获取，失败降级为空数组） ──
# 性能：旧实现 = 50 条 × 每条 2 次 git diff-tree = 101 次子进程/构建
#       新实现 = 1 次 git log（--diff-merges=first-parent 保持 merge 提交
#       相对第一父的 diff，与旧 diff-tree 默认行为一致）
# 解析：逐行遍历，40-hex+NUL 开头的行是 format 行（4 字段 \x00 分隔）→ 新 commit；
#       其余非空行是 numstat（"ins\tdel\tfile"，二进制显示 '-'）。
#       numstat 输出里 commit 间无空行分隔（format 行紧跟上一 commit 的 numstat），
#       不能用空行切块。stat 摘要由 numstat 求和（格式与旧 shortstat replace
#       链逐字节一致："N files, M+, K-"）。
python3 << 'PYEOF' >> "$TMP_JS" 2>/dev/null || true
import os, json, subprocess, re
try:
    os.chdir(os.environ['SCRIPT_DIR'])
    raw = subprocess.run(['git','log','--format=%H%x00%s%x00%ai%x00%an',
        '--numstat','--diff-merges=first-parent','-50'],
        capture_output=True, text=True, timeout=15).stdout
    commits = []
    cur = None
    for ln in raw.split('\n'):
        if re.match(r'^[0-9a-f]{40}\x00', ln):
            fmt = ln.split('\x00')
            if len(fmt) >= 4:
                cur = {'hash': fmt[0], 'msg': fmt[1], 'date': fmt[2],
                       'author': fmt[3], 'files': [], 'ins_total': 0, 'del_total': 0}
                commits.append(cur)
            else:
                cur = None
        elif cur is not None:
            fparts = ln.split('\t')
            if len(fparts) >= 3 and fparts[2]:
                ins = int(fparts[0]) if fparts[0].isdigit() else 0  # 二进制显示 '-'
                dels = int(fparts[1]) if fparts[1].isdigit() else 0
                cur['files'].append({'name': fparts[2], 'ins': ins, 'del': dels})
                cur['ins_total'] += ins
                cur['del_total'] += dels
    out = []
    for c in commits:
        n = len(c['files'])
        if n == 0:
            stat = ''
        elif n == 1:
            stat = '1 file'
        else:
            stat = '%d files' % n
        if c['ins_total']:
            stat += ', %d+' % c['ins_total']
        if c['del_total']:
            stat += ', %d-' % c['del_total']
        out.append({'hash': c['hash'][:7], 'fullHash': c['hash'], 'msg': c['msg'],
                    'date': c['date'], 'author': c['author'],
                    'stat': stat, 'files': c['files']})
    print('var RECENT_COMMITS=' + json.dumps(out, ensure_ascii=False).replace('</', '<\\/') + ';')
except Exception:
    print('var RECENT_COMMITS=[];')
PYEOF
if ! grep -q 'var RECENT_COMMITS=' "$TMP_JS" 2>/dev/null; then
  echo "var RECENT_COMMITS=[];" >> "$TMP_JS"
  echo "  [WARN] RECENT_COMMITS 注入失败，已注入空数组"
fi
GIT_HEAD=$(cd "$SCRIPT_DIR" && git log --oneline -1 2>/dev/null || echo '无')
echo "  [5/10] 近期提交: ${GIT_HEAD}"

# ── 6. 贡献热力图数据（按天 level，渲染端按"今天锚定 7 天窗口"重排） ──
# 日志日口径：author 时间转北京时区（+08:00）后按 8 点日界归日——8 点前归前一天
# （与 .githooks/pre-commit 防线 0b 的日志日规则一致：当日 08:00 ~ 次日 08:00 为一个提交日）
# 时区自洽性（勿改坏）：构建机 UTC 时 date.today() 的 UTC 日界恰好 = 北京 8 点日界——
# 北京 0-8 点提交归前一天 = UTC 今日，窗口"最近 7 天" = "最近 7 个日志日"自洽。
# 若换 +08:00 构建机需重验窗口锚点（勿随手加 TZ 环境变量）。
python3 << 'PYEOF' >> "$TMP_JS" 2>/dev/null || true
import subprocess, json, re
from collections import Counter
from datetime import date, timedelta, datetime

def _logday(s):
    m = re.match(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([+-]\d{4})', s or '')
    if not m: return None
    dt = datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')
    off = int(m.group(2)[1:3]) * 60 + int(m.group(2)[3:5])
    if m.group(2)[0] == '-': off = -off
    dt = dt - timedelta(minutes=off) + timedelta(hours=8)  # → 北京时区
    if dt.hour < 8:
        return (dt - timedelta(days=1)).strftime('%Y-%m-%d')
    return dt.strftime('%Y-%m-%d')

try:
    lines = subprocess.run(['git','log','--format=%ai','--since-as-filter','365 days ago'],
        capture_output=True, text=True, timeout=10).stdout.strip().split('\n')
    daily = Counter()
    for ln in lines:
        d = _logday(ln)
        if d: daily[d] += 1
    if not daily:
        print('var CONTRIBUTION_GRID={startDate:"",today:"",daily:{},maxDay:"",maxCount:0};')
    else:
        today = date.today()
        start = today - timedelta(days=364)
        all_vals = sorted(daily.values())
        boundaries = []
        if all_vals:
            n = len(all_vals)
            for i in range(1, 5):
                idx = int(n * i / 5)
                if idx >= n: idx = n - 1
                boundaries.append(all_vals[idx])
        def to_level(v):
            if v == 0: return 0
            for i, b in enumerate(boundaries):
                if v <= b: return i + 1
            return 5
        # 按天 level 字典（覆盖 start..today 每一天，含 0）
        day_levels = {}
        d = start
        while d <= today:
            day_levels[str(d)] = to_level(daily.get(str(d), 0))
            d += timedelta(days=1)
        max_day = max(daily, key=daily.get)
        max_count = daily[max_day]
        print('var CONTRIBUTION_GRID=' + json.dumps({
            'startDate': str(start),
            'today': str(today),
            'daily': day_levels,
            'maxDay': str(max_day),
            'maxCount': max_count
        }, ensure_ascii=False).replace('</', '<\\/') + ';')
except Exception:
    print('var CONTRIBUTION_GRID={startDate:"",today:"",daily:{},maxDay:"",maxCount:0};')
PYEOF
if ! grep -q 'var CONTRIBUTION_GRID=' "$TMP_JS" 2>/dev/null; then
  echo "var CONTRIBUTION_GRID={startDate:'',today:'',daily:{},maxDay:'',maxCount:0};" >> "$TMP_JS"
  echo "  [WARN] CONTRIBUTION_GRID 注入失败，已注入空对象"
fi
# 显示统计与注入数据同口径（北京 8 点日界；不用 %as 机器时区日界——避免两处活跃日数字不一致）
echo "  [6/10] 贡献热力图: $(python3 << 'PYEOF' 2>/dev/null || echo '0 个活跃日'
import subprocess, re
from datetime import timedelta, datetime

def _logday(s):
    m = re.match(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([+-]\d{4})', s or '')
    if not m: return None
    dt = datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')
    off = int(m.group(2)[1:3]) * 60 + int(m.group(2)[3:5])
    if m.group(2)[0] == '-': off = -off
    dt = dt - timedelta(minutes=off) + timedelta(hours=8)
    if dt.hour < 8:
        return (dt - timedelta(days=1)).strftime('%Y-%m-%d')
    return dt.strftime('%Y-%m-%d')

r = subprocess.run(['git','log','--format=%ai','--since-as-filter','365 days ago'], capture_output=True, text=True, timeout=5)
days = set()
for ln in r.stdout.strip().split('\n'):
    d = _logday(ln)
    if d: days.add(d)
print(f'{len(days)} 个活跃日')
PYEOF
)"

# ── 7. 源码规模统计（失败降级为 null） ──
JS_LINES=$(find "$SRC_DIR/js" -name '*.js' -exec cat {} + 2>/dev/null | wc -l)
JS_FILES=$(ls "$SRC_DIR/js"/*.js 2>/dev/null | wc -l)
CSS_FILES=$(ls "$SRC_DIR/css"/*.css 2>/dev/null | wc -l)
CSS_LINES=$(find "$SRC_DIR/css" -name '*.css' -exec cat {} + 2>/dev/null | wc -l)
HTML_LINES=$(wc -l < "$SRC_DIR/index.html" 2>/dev/null || echo 0)
HTML_FILES=1
JAVA_DIR="$SCRIPT_DIR/android/app/src/main/java"
JAVA_LINES=0; JAVA_FILES=0
if [ -d "$JAVA_DIR" ]; then
  JAVA_FILES=$(find "$JAVA_DIR" -name '*.java' -type f 2>/dev/null | wc -l)
  JAVA_LINES=$(find "$JAVA_DIR" -name '*.java' -type f -exec cat {} + 2>/dev/null | wc -l)
fi
if [ "$JS_FILES" -gt 0 ] 2>/dev/null; then
  TOTAL_LINES=$((JS_LINES + CSS_LINES + HTML_LINES + JAVA_LINES))
  echo "var SOURCE_STATS={js:{files:${JS_FILES},lines:${JS_LINES}},java:{files:${JAVA_FILES},lines:${JAVA_LINES}},css:{files:${CSS_FILES},lines:${CSS_LINES}},html:{files:${HTML_FILES},lines:${HTML_LINES}},total:${TOTAL_LINES}};" >> "$TMP_JS"
  echo "  [7/10] 源码规模: JS ${JS_FILES}文件/${JS_LINES}行 + CSS ${CSS_FILES}文件/${CSS_LINES}行 + HTML ${HTML_FILES}文件/${HTML_LINES}行 + Java ${JAVA_FILES}文件/${JAVA_LINES}行 = ${TOTAL_LINES}行"
else
  echo "var SOURCE_STATS=null;" >> "$TMP_JS"
  echo "  [7/10] 源码规模: 统计失败，注入 null"
fi

# ── 8. 逐文件规模统计（可视化条形图用） ──
python3 << 'PYEOF' >> "$TMP_JS" 2>/dev/null || true
import os, json, subprocess, re
SRC = os.environ['SRC_DIR']
SCRIPT = os.environ['SCRIPT_DIR']
files = []

def git_file_times(pathspecs):
    """单次 git log --name-only 收集 路径→[最新修改, 最早创建]（输出新→旧遍历）"""
    r = subprocess.run(['git','-c','core.quotePath=false','log','--format=%ai','--name-only'] + pathspecs,
        capture_output=True, text=True, timeout=20, cwd=SCRIPT)
    times = {}
    ts = None
    for ln in r.stdout.split('\n'):
        ln = ln.strip()
        if not ln:
            continue
        if re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', ln):
            ts = ln  # 时间行 → 新 commit 开始（commit 间无空行分隔，勿用空行切块）
        elif ts:
            if ln in times:
                times[ln][1] = ts  # 更旧的提交 → 更新创建时间
            else:
                times[ln] = [ts, ts]  # 首次遇到 = 最新修改
    return times

def extract_desc(fp):
    try:
        with open(fp, 'r') as fh:
            for line in fh:
                line = line.strip()
                if not line: continue
                if line.startswith('#!'): continue
                raw = re.sub(r'^[/\*#!]+|[\*/]+$|\s*=+\s*|^@\w+\s*|^\s*[─━═].*', '', line).strip()
                raw = re.sub(r'^[─━═\s]+', '', raw).strip()
                # 跳过占位式分组注释（如「看板模块」「数据层」）：无描述性标点且过短视为无效，继续找下一行
                if raw and not re.search(r'[：:——()（）/]', raw) and len(raw) <= 10:
                    continue
                if raw and len(raw) > 3 and len(raw) < 120:
                    return raw
        return ''
    except: return ''

try:
    times = git_file_times(['src/js','src/css','src/index.html','android/app/src/main/java'])
except Exception:
    times = {}

try:
    js_dir = os.path.join(SRC, 'js')
    if os.path.isdir(js_dir):
        for f in sorted(os.listdir(js_dir)):
            if f.endswith('.js'):
                fp = os.path.join(js_dir, f)
                try:
                    with open(fp, 'r') as fh: lines = len(fh.readlines())
                except: lines = 0
                rel = 'src/js/' + f
                t = times.get(rel, ['', ''])
                files.append({'name': rel, 'lines': lines, 'type': 'js',
                    'created': t[1], 'modified': t[0], 'desc': extract_desc(fp)})
except: pass

try:
    css_dir = os.path.join(SRC, 'css')
    if os.path.isdir(css_dir):
        for f in sorted(os.listdir(css_dir)):
            if f.endswith('.css'):
                fp = os.path.join(css_dir, f)
                try:
                    with open(fp, 'r') as fh: css_lines = len(fh.readlines())
                except: css_lines = 0
                rel = 'src/css/' + f
                t = times.get(rel, ['', ''])
                files.append({'name': rel, 'lines': css_lines, 'type': 'css',
                    'created': t[1], 'modified': t[0], 'desc': extract_desc(fp)})
except: pass

try:
    html_path = os.path.join(SRC, 'index.html')
    if os.path.isfile(html_path):
        with open(html_path, 'r') as fh: html_lines = len(fh.readlines())
        t = times.get('src/index.html', ['', ''])
        files.append({'name': 'src/index.html', 'lines': html_lines, 'type': 'html',
            'created': t[1], 'modified': t[0], 'desc': extract_desc(html_path)})
except: pass

try:
    java_dir = os.path.join(SCRIPT, 'android', 'app', 'src', 'main', 'java')
    if os.path.isdir(java_dir):
        for root, dirs, fnames in os.walk(java_dir):
            for f in sorted(fnames):
                if f.endswith('.java'):
                    fp = os.path.join(root, f)
                    try:
                        with open(fp, 'r') as fh: lines = len(fh.readlines())
                    except: lines = 0
                    rel = os.path.relpath(fp, SCRIPT)
                    t = times.get(rel, ['', ''])
                    files.append({'name': rel, 'lines': lines, 'type': 'java',
                        'created': t[1], 'modified': t[0], 'desc': extract_desc(fp)})
except: pass

files.sort(key=lambda x: -x['lines'])
print('var FILE_STATS=' + json.dumps(files, ensure_ascii=False).replace('</', '<\\/') + ';')

# ── 生成仓库地图 repo-map.md（Agent 定向用） ──
repo_map_path = os.path.join(SCRIPT, 'docs', 'repo-map.md')
try:
    from datetime import datetime, timezone, timedelta
    tz = timezone(timedelta(hours=8))
    gen_time = datetime.now(tz).strftime('%Y-%m-%dT%H:%M:%S+08:00')
    grouped = {}
    for f in files:
        parts = f['name'].split('/')
        if len(parts) >= 2:
            group = parts[0] + '/' + parts[1] + '/'
        else:
            group = 'root'
        if group not in grouped:
            grouped[group] = []
        grouped[group].append(f)

    lines = []
    lines.append('# Adesktop 仓库地图')
    lines.append('')
    lines.append(f'> 自动生成于 {gen_time} | {len(files)} 个源文件 | 构建时可刷新')
    lines.append('')
    lines.append('## 快速定向')
    lines.append('')
    lines.append('| 文件 | 行数 | 职责 |')
    lines.append('|------|------|------|')
    for f in files:
        lines.append(f'| {f["name"]} | {f["lines"]} | {f["desc"] or "—"} |')
    lines.append('')
    lines.append('## 按目录')
    lines.append('')
    for group in sorted(grouped.keys()):
        gfiles = grouped[group]
        total = sum(f['lines'] for f in gfiles)
        lines.append(f'### {group} ({len(gfiles)} 文件, {total} 行)')
        lines.append('')
        lines.append('| 文件 | 行数 | 职责 |')
        lines.append('|------|------|------|')
        for f in gfiles:
            fname = f['name'].split('/')[-1] if '/' in f['name'] else f['name']
            lines.append(f'| {fname} | {f["lines"]} | {f["desc"] or "—"} |')
        lines.append('')

    with open(repo_map_path, 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
except Exception:
    pass  # repo-map 生成失败不阻塞构建
PYEOF
if ! grep -q 'var FILE_STATS=' "$TMP_JS" 2>/dev/null; then
  echo "var FILE_STATS=[];" >> "$TMP_JS"
  echo "  [WARN] 逐文件统计失败，注入空数组"
fi
echo "  [8/10] 逐文件统计: $(python3 << 'PYEOF' 2>/dev/null || echo '0 个文件'
import os
SRC = os.environ['SRC_DIR']
SCRIPT = os.environ['SCRIPT_DIR']
count = 0
try:
    js_files = [f for f in os.listdir(os.path.join(SRC, 'js')) if f.endswith('.js')]
    count += len(js_files)
except: pass
for fn in ['index.html']:
    if os.path.isfile(os.path.join(SRC, fn)): count += 1
css_dir = os.path.join(SRC, 'css')
if os.path.isdir(css_dir):
    count += len([f for f in os.listdir(css_dir) if f.endswith('.css')])
java_dir = os.path.join(SCRIPT, 'android', 'app', 'src', 'main', 'java')
if os.path.isdir(java_dir):
    for root, dirs, fnames in os.walk(java_dir):
        count += len([f for f in fnames if f.endswith('.java')])
print(f'{count} 个文件')
PYEOF
)"

# ── 9. 非源码文件规模统计（文档、工具脚本、配置文件等） ──
python3 << 'PYEOF' >> "$TMP_JS" 2>/dev/null || true
import os, json, subprocess, re
SRC = os.environ['SRC_DIR']
SCRIPT = os.environ['SCRIPT_DIR']
non_source_files = []

def git_file_times(pathspecs):
    """单次 git log --name-only 收集 路径→[最新修改, 最早创建]（输出新→旧遍历）"""
    r = subprocess.run(['git','-c','core.quotePath=false','log','--format=%ai','--name-only'] + pathspecs,
        capture_output=True, text=True, timeout=20, cwd=SCRIPT)
    times = {}
    ts = None
    for ln in r.stdout.split('\n'):
        ln = ln.strip()
        if not ln:
            continue
        if re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', ln):
            ts = ln  # 时间行 → 新 commit 开始（commit 间无空行分隔，勿用空行切块）
        elif ts:
            if ln in times:
                times[ln][1] = ts  # 更旧的提交 → 更新创建时间
            else:
                times[ln] = [ts, ts]  # 首次遇到 = 最新修改
    return times

try:
    times = git_file_times(['docs',':(exclude)docs/7-archive/','tools','scripts','tests',
        'AGENTS.md','README.md','.gitignore','android/app/build.gradle','android/build-local.sh'])
except Exception:
    times = {}

def extract_desc(fp):
    try:
        with open(fp, 'r') as fh:
            for line in fh:
                line = line.strip()
                if not line: continue
                if line.startswith('#!'): continue
                raw = re.sub(r'^[/\*#!]+|[\*/]+$|\s*=+\s*|^@\w+\s*|^\s*[─━═].*', '', line).strip()
                raw = re.sub(r'^[─━═\s]+', '', raw).strip()
                # 跳过占位式分组注释（如「看板模块」「数据层」）：无描述性标点且过短视为无效，继续找下一行
                if raw and not re.search(r'[：:——()（）/]', raw) and len(raw) <= 10:
                    continue
                if raw and len(raw) > 3 and len(raw) < 120:
                    return raw
        return ''
    except: return ''

# docs/ - all .md files (skip 7-archive/)
try:
    docs_dir = os.path.join(SCRIPT, 'docs')
    if os.path.isdir(docs_dir):
        for root, dirs, fnames in os.walk(docs_dir):
            if '7-archive' in root: continue
            for f in sorted(fnames):
                if f.endswith('.md'):
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, SCRIPT)
                    try:
                        with open(fp, 'r') as fh:
                            text = fh.read()
                            lines = len(text.splitlines())
                            chars = len(text.replace('\n', '').replace('\r', ''))
                    except: lines = 0; chars = 0
                    t = times.get(rel, ['', ''])
                    desc = extract_desc(fp)
                    non_source_files.append({'name': rel, 'lines': lines, 'chars': chars, 'type': 'doc',
                        'created': t[1], 'modified': t[0], 'desc': desc})
except: pass

# tools/ - all non-.zip, non-.json files
try:
    tools_dir = os.path.join(SCRIPT, 'tools')
    if os.path.isdir(tools_dir):
        for f in sorted(os.listdir(tools_dir)):
            fp = os.path.join(tools_dir, f)
            if not os.path.isfile(fp): continue
            if f.endswith('.zip'): continue
            if f.endswith('.json'): continue
            try:
                with open(fp, 'r') as fh: lines = len(fh.readlines())
            except: lines = 0
            rel = 'tools/' + f
            t = times.get(rel, ['', ''])
            desc = extract_desc(fp)
            non_source_files.append({'name': rel, 'lines': lines, 'type': 'tool',
                'created': t[1], 'modified': t[0], 'desc': desc})
except: pass

# root config files
for fn in ['AGENTS.md', 'README.md', '.gitignore']:
    fp = os.path.join(SCRIPT, fn)
    if os.path.isfile(fp):
        try:
            with open(fp, 'r') as fh: text = fh.read()
            lines = len(text.splitlines())
            chars = len(text.replace('\n', '').replace('\r', '')) if fn.endswith('.md') else 0
        except: lines = 0; chars = 0
        t = times.get(fn, ['', ''])
        desc = extract_desc(fp)
        entry = {'name': fn, 'lines': lines, 'type': 'config',
            'created': t[1], 'modified': t[0], 'desc': desc}
        if chars: entry['chars'] = chars
        non_source_files.append(entry)

# android/ non-Java files
for fn in ['android/app/build.gradle', 'android/build-local.sh']:
    fp = os.path.join(SCRIPT, fn)
    if os.path.isfile(fp):
        try:
            with open(fp, 'r') as fh: lines = len(fh.readlines())
        except: lines = 0
        t = times.get(fn, ['', ''])
        desc = extract_desc(fp)
        non_source_files.append({'name': fn, 'lines': lines, 'type': 'gradle' if fn.endswith('.gradle') else 'tool',
            'created': t[1], 'modified': t[0], 'desc': desc})

# scripts/ - all .js (exclude node_modules/), E2E verification suites
try:
    scripts_dir = os.path.join(SCRIPT, 'scripts')
    if os.path.isdir(scripts_dir):
        for root, dirs, fnames in os.walk(scripts_dir):
            if 'node_modules' in root: continue
            for f in sorted(fnames):
                if not f.endswith('.js'): continue
                fp = os.path.join(root, f)
                try:
                    with open(fp, 'r') as fh: lines = len(fh.readlines())
                except: lines = 0
                rel = os.path.relpath(fp, SCRIPT)
                t = times.get(rel, ['', ''])
                desc = extract_desc(fp)
                non_source_files.append({'name': rel, 'lines': lines, 'type': 'script',
                    'created': t[1], 'modified': t[0], 'desc': desc})
except: pass

# tests/ - all .js (exclude _disabled/), unit tests
try:
    tests_dir = os.path.join(SCRIPT, 'tests')
    if os.path.isdir(tests_dir):
        for root, dirs, fnames in os.walk(tests_dir):
            if '_disabled' in root: continue
            for f in sorted(fnames):
                if not f.endswith('.js'): continue
                fp = os.path.join(root, f)
                try:
                    with open(fp, 'r') as fh: lines = len(fh.readlines())
                except: lines = 0
                rel = os.path.relpath(fp, SCRIPT)
                t = times.get(rel, ['', ''])
                desc = extract_desc(fp)
                non_source_files.append({'name': rel, 'lines': lines, 'type': 'test',
                    'created': t[1], 'modified': t[0], 'desc': desc})
except: pass

non_source_files.sort(key=lambda x: -x['lines'])
print('var NON_SOURCE_STATS=' + json.dumps(non_source_files, ensure_ascii=False).replace('</', '<\\/') + ';')
PYEOF
if ! grep -q 'var NON_SOURCE_STATS=' "$TMP_JS" 2>/dev/null; then
  echo "var NON_SOURCE_STATS=[];" >> "$TMP_JS"
  echo "  [WARN] 非源码文件统计失败，注入空数组"
fi
echo "  [9/10] 非源码文件统计: $(python3 << 'PYEOF' 2>/dev/null || echo '0 个文件'
import os
SCRIPT = os.environ['SCRIPT_DIR']
count = 0
docs_dir = os.path.join(SCRIPT, 'docs')
if os.path.isdir(docs_dir):
    for root, dirs, fnames in os.walk(docs_dir):
        if '7-archive' in root: continue
        count += len([f for f in fnames if f.endswith('.md')])
tools_dir = os.path.join(SCRIPT, 'tools')
if os.path.isdir(tools_dir):
    count += len([f for f in os.listdir(tools_dir) if os.path.isfile(os.path.join(tools_dir, f)) and not f.endswith('.zip')])
for fn in ['AGENTS.md', 'README.md', '.gitignore', 'android/app/build.gradle', 'android/build-local.sh']:
    if os.path.isfile(os.path.join(SCRIPT, fn)): count += 1
print(f'{count} 个文件')
PYEOF
)"

# ── 10. 更新日志（注入 CHANGELOG.md 原文，前端 App.Markdown 运行时渲染） ──
# 渲染统一交给 src/js/markdown.js（h1-h6/多行列表/有序列表/引用/代码/链接），
# 避免构建期 python 迷你渲染器语法覆盖不全（### 标题被当段落、列表续行被拆段）。
python3 << 'PYEOF' >> "$TMP_JS" 2>/dev/null || true
import os
SCRIPT_DIR = os.environ['SCRIPT_DIR']
CHANGELOG_PATH = os.path.join(SCRIPT_DIR, 'CHANGELOG.md')
try:
    if not os.path.isfile(CHANGELOG_PATH):
        raise FileNotFoundError('no CHANGELOG.md')
    with open(CHANGELOG_PATH) as f:
        raw = f.read()
    # JS 单引号字符串转义：反斜杠 / 单引号 / 换行 / </ 防脚本闭合
    esc = (raw
        .replace('\\', '\\\\')
        .replace("'", "\\'")
        .replace('\r', '')
        .replace('\n', '\\n')
        .replace('</', '<\\/'))
    print("var CHANGELOG_MD='" + esc + "';")
except Exception:
    print("var CHANGELOG_MD='';")
PYEOF
if ! grep -q 'var CHANGELOG_MD=' "$TMP_JS" 2>/dev/null; then
  echo "var CHANGELOG_MD='';" >> "$TMP_JS"
  echo "  [WARN] CHANGELOG_MD 注入失败，注入空字符串"
fi
CHANGELOG_STATUS=$(python3 -c "
import os
SCRIPT = os.environ.get('SCRIPT_DIR', '/dev/null')
cp = os.path.join(SCRIPT, 'CHANGELOG.md')
if os.path.isfile(cp):
    count = 0
    with open(cp) as f:
        for line in f:
            if line.startswith('## ') and not line.startswith('### '):
                count += 1
    print(f'{count} 个日志日（从 CHANGELOG.md）')
else:
    print('无 CHANGELOG.md')
" 2>/dev/null || echo '未知')
echo "  [10/10] 更新日志: ${CHANGELOG_STATUS}"
