/**
 * 打印：把 HTML 输出到新窗口并调用浏览器打印。
 * 返回是否成功打开打印窗口（被浏览器拦截时会返回 false，由调用方提示用户）。
 */
export function printHTML(html: string, title = '打印'): boolean {
  const w = window.open('', '_blank', 'width=900,height=1200')
  if (!w) return false

  w.document.open()
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>@page { size: A4; margin: 14mm; } body { margin: 0; }</style></head>` +
    `<body>${html}</body></html>`
  )
  w.document.close()
  w.focus()
  w.print()
  return true
}

/**
 * 打印「预览弹窗」里 iframe 的内容。
 * 预览使用 <iframe srcdoc> 渲染单据，直接打印该 iframe 即可，
 * 不会弹出新窗口，也不会把页面自身的界面元素打进去。
 * 返回是否成功调用打印；不支持时由调用方回退到新窗口打印。
 */
export function printIframe(frame: HTMLIFrameElement | null): boolean {
  const win = frame?.contentWindow
  if (!win || typeof win.print !== 'function') return false
  try {
    win.focus()
    win.print()
    return true
  } catch {
    return false
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}
