/* 双击窗口判定纯函数：双击识别（同一对象 300ms 内二击）+ 反选延迟辅助。
 * interaction.md 定稿：tap 视觉即时选中，仅反选延迟；双击窗口 300ms。
 * 依赖: namespace.js
 * 导出: App.DoubleTap
 */
'use strict'

App.DoubleTap = (function () {
  // 初始状态：null = 无 pending tap
  function create() { return null }

  // 判定一次 hit：
  //   state  上次 tap 状态（{ name, time } | null）
  //   name   本次命中对象（null = 空白）
  //   now    当前时间戳
  //   ms     双击窗口（默认 300）
  // 返回 { state, double }：
  //   double=true  → 双击（打开），state 清空
  //   double=false → 普通 tap，state 记录本次
  function hit(state, name, now, ms) {
    const windowMs = (ms && ms > 0) ? ms : 300
    if (state && state.name === name && name !== null && (now - state.time) <= windowMs) {
      return { state: null, double: true }
    }
    return { state: { name: name, time: now }, double: false }
  }

  // 窗口超时（反选延迟确认）：返回 false 表示窗口已关闭（无需反选）
  // state 与本次 tap 相同对象且未超时 → 仍在窗口内
  function within(state, name, now, ms) {
    const windowMs = (ms && ms > 0) ? ms : 300
    return !!(state && state.name === name && name !== null && (now - state.time) <= windowMs)
  }

  return {
    create: create,
    hit: hit,
    within: within
  }
})()
