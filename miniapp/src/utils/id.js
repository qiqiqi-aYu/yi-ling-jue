'use strict';

/**
 * 生成写接口幂等 ID（UUID v4 形式）。
 * 仅用于标识一次前端业务操作，不参与任何游戏随机或数值计算。
 */
export function createRequestId() {
  const hex = '0123456789abcdef';
  const bytes = new Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = hex.charAt(Math.floor(Math.random() * 16));
  }
  bytes[6] = hex.charAt((parseInt(bytes[6], 16) & 0x0f) | 0x40);
  bytes[8] = hex.charAt((parseInt(bytes[8], 16) & 0x3f) | 0x80);
  const segments = [
    bytes.slice(0, 8).join(''),
    bytes.slice(8, 12).join(''),
    bytes.slice(12, 16).join(''),
    bytes.slice(16, 20).join(''),
    bytes.slice(20).join(''),
  ];
  return segments.join('-');
}
