/**
 * 图片小工具：把用户上传的图片压成固定边长的正方形 dataURL。
 *
 * 为什么必须压缩：品牌标志与角色头像都存 localStorage（配额只有几 MB），
 * 直接塞手机拍的 4MB 照片会当场写失败。统一裁成 96px 方图后约 3~8KB。
 */
export async function fileToSquareDataUrl(file: File, size = 96): Promise<string> {
  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  // 等比缩放到「短边填满」，再居中裁切，保证头像不变形
  const scale = Math.max(size / img.width, size / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  return canvas.toDataURL('image/png')
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解析失败'))
    img.src = src
  })
}
