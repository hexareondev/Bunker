// QR-код в виде SVG (генератор — js/vendor/qrcode.mjs, MIT, Kazuhiko Arase)
import qrcode from './vendor/qrcode.mjs?v=3.8';

export function qrSvg(text, { size = 220, label = '' } = {}) {
  const q = qrcode(0, 'M');
  q.addData(unescape(encodeURIComponent(text))); // UTF-8
  q.make();
  const n = q.getModuleCount(), m = 2, full = n + m * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg class="qr" viewBox="0 0 ${full} ${full}" width="${size}" height="${size}" role="img" aria-label="${label || 'QR-код'}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
