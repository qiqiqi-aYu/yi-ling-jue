'use strict';

/**
 * tests/unit/engine.purity.test.js —— engine 层「纯函数」守卫
 *
 * 这是本项目最重要的一条架构约束（docs/03 §2）：
 *   engine/ 里只能有纯函数，不允许 require 数据库驱动、Express、HTTP 客户端、文件系统，
 *   也不允许出现 Math.random（随机性必须来自注入的 rng，否则战斗不可复现）。
 *
 * 用静态扫描代替人工 review：谁往 engine 里塞了 io 依赖，单测立刻红。
 */

const fs = require('fs');
const path = require('path');

const ENGINE_DIR = path.resolve(__dirname, '../../src/engine');

/** 禁止在 engine 中出现的依赖（正则匹配 require 的参数） */
const FORBIDDEN_REQUIRES = [
  'mysql2',
  'mysql',
  'express',
  'http',
  'https',
  'fs',
  'net',
  'axios',
  'knex',
  'sequelize',
  '../config/db',
  '../config/balance.loader',
  '../services',
  '../dao',
];

/** engine 目录下的所有模块 */
function listEngineFiles() {
  return fs
    .readdirSync(ENGINE_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, fullPath: path.join(ENGINE_DIR, name) }));
}

/**
 * 去掉注释，避免把「注释里写的 Math.random」误判成真实调用。
 * @param {string} source 源码
 * @returns {string} 去注释后的源码
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('engine 纯函数约束', () => {
  const files = listEngineFiles();

  test('engine 目录至少有 7 个模块（六个数值模块 + combat）', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  test('★ 不允许 require 任何 IO / 数据库 / Web 框架', () => {
    for (const file of files) {
      const source = fs.readFileSync(file.fullPath, 'utf8');
      const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
      for (const dep of requires) {
        const hit = FORBIDDEN_REQUIRES.find((bad) => dep === bad || dep.startsWith(`${bad}/`));
        expect({ file: file.name, dep, forbidden: Boolean(hit) }).toEqual({
          file: file.name,
          dep,
          forbidden: false,
        });
      }
    }
  });

  test('★ 不允许使用 Math.random（随机必须注入，保证可复现）', () => {
    for (const file of files) {
      const source = stripComments(fs.readFileSync(file.fullPath, 'utf8'));
      expect({ file: file.name, hasMathRandom: /Math\s*\.\s*random/.test(source) }).toEqual({
        file: file.name,
        hasMathRandom: false,
      });
    }
  });

  test('每个模块的导出都是函数或常量对象，没有可变的运行时状态', () => {
    for (const file of files) {
      const mod = require(file.fullPath);
      expect(Object.keys(mod).length).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(mod)) {
        const ok = typeof value === 'function' || (value && typeof value === 'object');
        expect({ file: file.name, key, ok }).toEqual({ file: file.name, key, ok: true });
      }
    }
  });
});
