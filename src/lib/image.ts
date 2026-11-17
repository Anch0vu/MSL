/** Обрезает картинку по центру до w×h (как object-fit: cover) и сжимает перед загрузкой (PNG сохраняет прозрачность логотипа). */
export function coverImage(file: File, w: number, h: number, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.max(w / img.width, h / img.height)
      const sw = w / scale
      const sh = h / scale
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL(type, 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Не удалось прочитать картинку'))
    }
    img.src = url
  })
}
