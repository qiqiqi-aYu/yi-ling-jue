# 弈灵诀

> 单机自走棋策略游戏 · 软件工程课程设计项目  
> 当前仓库状态：**后端已完成并可运行**；小程序与 Web 管理后台代码尚未生成，需按 `plan.md` 逐轮确认后开发。

弈灵诀采用 1 名真人玩家 + 7 名 AI 的单机对战形态，不包含联机匹配、观战、装备和独立技能系统。后端将数值计算集中在纯函数 engine 中，通过统一接口同时服务未来的 UniApp 小程序和 Vue3 Web 管理后台。

---

## 1. 项目基线

| 项目 | 当前约定 |
|---|---|
| 项目名称 | 弈灵诀 |
| 项目定位 | 单机自走棋，1 真人 + 7 AI |
| 玩家端 | UniApp 微信小程序（Vue 3，待开发） |
| 管理端 | Vue 3 Web 后台（待开发） |
| 后端 | Node.js 18+ / Express 4 / CommonJS |
| 数据库 | MySQL 8.0，库名 `yi_ling_jue`，15 张表 |
| 测试 | Jest + Supertest，包含真实数据库全链路集成测试 |
| 游戏规模 | 24 英雄、12 羁绊、33 个羁绊档位、188 张共享卡池 |
| 接口前缀 | `/api/v1` |
| 默认端口 | `3000` |
| 总控文档 | [`plan.md`](./plan.md) |

核心工程原则：

- 数值逻辑正确优先于动画表现。
- engine 是纯函数内核，不接触数据库、Express、HTTP 或 `req/res`，不使用 `Math.random()`。
- 所有随机结果由可注入的 seed 与派生随机流产生，可复现。
- 配置数值来自数据库并由 `balance.loader.js` 加载，不在业务层复制另一套硬编码。
- SQL 集中在 dao 层，controller 不写业务规则。
- 小程序与后台共用一套后端接口，靠 JWT `role` 区分权限，不建设双份 API。

---

## 2. 当前完成范围

| 模块 | 状态 | 说明 |
|---|---|---|
| `server/src/engine/` | 已完成 | rng、economy、probability、synergy、stats、damage、combat |
| 数据库脚本 | 已完成 | `schema.sql`、`seed.sql`、`reset.sql`，15 表定稿 |
| 配置加载器 | 已完成 | `db.js`、`balance.loader.js`、配置自检脚本 |
| services | 已完成 | match、economy、shop、hero、board、trait、battle、ai、snapshot、catalog、auth |
| dao / middleware | 已完成 | SQL 封装、事务、JWT、幂等、统一错误处理 |
| P0 接口 | 已完成 | 26 个 P0 接口及额外只读接口，完整对局流程已联调 |
| 单元测试与集成测试 | 已完成 | 10 套件 / 203 用例 |
| 小程序对局页 | 未开始 | 需按 `plan.md` 逐轮确认后开发 |
| Web 后台配置页 | 未开始 | H 组后台管理接口尚未全部实现 |
| 简版战斗动画 | 未开始 | 只回放服务端时间轴，不参与结算 |
| `plan.md` / `docs/01~04` | 已完成 | 总控、数据库、接口、目录结构、测试与部署说明 |

---

## 3. 目录结构

```text
.
├── plan.md                         # 后续开发总控与交付门禁
├── README.md                       # 项目总览与快速开始
├── database/
│   ├── schema.sql                  # 15 表建库脚本（会 DROP DATABASE）
│   ├── seed.sql                    # 24 英雄等初始化配置
│   ├── reset.sql                   # 开发期清表脚本，谨慎使用
│   └── 弈灵诀-数据库设计说明书.md   # 数据库权威规格
├── docs/
│   ├── 01-数据库设计.md
│   ├── 02-后端接口清单.md
│   ├── 03-项目目录结构.md
│   └── 04-测试与部署.md
└── server/
    ├── package.json
    ├── .env.example
    ├── src/
    │   ├── app.js                  # Express 应用装配
    │   ├── server.js               # 启动与优雅关闭
    │   ├── engine/                 # 纯函数数值内核
    │   ├── config/                 # 连接池、配置加载与常量
    │   ├── services/               # 业务逻辑与事务编排
    │   ├── dao/                    # SQL 集中管理
    │   ├── middleware/             # 鉴权、幂等、错误处理
    │   ├── routes/                 # 路径映射
    │   ├── controllers/            # 请求解析与响应组织
    │   └── scripts/                # 配置自检脚本
    └── tests/
        ├── unit/                   # 引擎、配置与纯度测试
        └── integration/            # P0 全链路集成测试
```

---

## 4. 快速开始

### 4.1 环境要求

- Node.js **18+**
- npm
- MySQL **8.0**
- 可执行的 MySQL 客户端
- 微信开发者工具（仅「运行小程序」时需要，可用测试号）

### 4.2 导入数据库

如果本机 `yi_ling_jue` 库已存在且数据完整（15 张表、24 个英雄），可跳过本节直接看 4.3。

在项目根目录执行：

```bash
mysql -u <数据库用户> -p --default-character-set=utf8mb4 < database/schema.sql
mysql -u <数据库用户> -p --default-character-set=utf8mb4 < database/seed.sql
```

**警告**：`schema.sql` 会删除并重建 `yi_ling_jue` 数据库，`seed.sql` 会清空并重建初始化数据。请仅在开发环境中执行，并提前备份需要保留的数据。

### 4.3 配置后端

```bash
cd server
cp .env.example .env
```

按本机情况填写 `.env`，重点确认：

- `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`
- `PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `BALANCE_CACHE_TTL_MS`

`.env` 不得提交到 Git。完整变量说明见 [`docs/04-测试与部署.md`](./docs/04-测试与部署.md)。

### 4.4 启动服务

```bash
npm ci
npm start
```

开发模式：

```bash
npm run dev
```

健康检查（注意在根路径，不带 `/api/v1`）：

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":3.15}
```

启动成功后可用一条命令确认接口真的可用：

```bash
curl -X POST http://localhost:3000/api/v1/auth/miniapp/login \
  -H "Content-Type: application/json" -d '{"code":"dev-openid-001"}'
# 返回 data.token 即为可用 JWT
```

### 4.5 运行小程序

小程序是 UniApp + Vue3，需单独安装依赖（与 `server/` 的依赖互不影响）。

```bash
cd miniapp
npm install
```

**方式一：微信开发者工具（推荐，最接近真机）**

```bash
npm run dev:mp-weixin
```

命令会持续监听并输出到 `miniapp/dist/dev/mp-weixin`，然后在微信开发者工具中：

1. 导入项目 → 目录选择 `miniapp/dist/dev/mp-weixin`
2. AppID 选择「测试号」（`src/manifest.json` 的 `appid` 为空，用测试号即可）
3. `src/manifest.json` 已设 `urlCheck: false`，因此 `localhost` 请求不会被域名校验拦截

**方式二：H5 浏览器预览（最快，适合调 UI 与接口）**

```bash
npm run dev:h5
```

浏览器打开 `http://localhost:5173`。H5 下请求同源问题由浏览器处理，接口仍指向 `http://localhost:3000/api/v1`。

**接口地址配置**

默认地址在 `miniapp/src/api/request.js`（`http://localhost:3000/api/v1`），可用环境变量覆盖：

```bash
cd miniapp
cp .env.example .env.local
# 编辑 .env.local
VITE_API_BASE_URL=http://192.168.1.100:3000/api/v1
```

- 微信开发者工具模拟器可用 `localhost`；
- **真机预览必须改成电脑的局域网 IP**（手机访问不到 `localhost`），且电脑防火墙需放行 3000 端口。

**登录说明**

当前无账号体系，小程序端调用 `POST /api/v1/auth/miniapp/login` 传 `code` 即可换 JWT（开发态任意字符串），token 存在本地 Storage，后续请求自动带 `Authorization`。

---

## 5. 测试与自检

在 `server/` 目录执行：

```bash
npm test                 # 单元测试 + 真实库集成测试
npm run config:check     # 真实库配置校验 + engine 冒烟
```

其他命令：

```bash
npm run test:unit
npm run test:integration
npm run test:cov
npm run test:watch
```

当前基线：

- `npm test`：**10 suites / 203 tests 全部通过**。
- 集成测试覆盖完整对局链路，要求数据库已按脚本初始化。
- 配置自检验证概率和、配置引用、卡池均分、档位可达性，并运行抽卡、羁绊、属性、战斗、经济、积分冒烟。

任何后续交付都必须实际运行上述两条必检命令，并在交付说明中给出真实结果。

---

## 6. 账号与接口概览

### 6.1 账号

| 身份 | 获取方式 | 角色 | 说明 |
|---|---|---|---|
| 玩家 | `POST /api/v1/auth/miniapp/login` | `player` | 当前按非空 `code` 派生稳定 `openid`，不持久化玩家账号 |
| 管理员 | `POST /api/v1/auth/admin/login` | `admin` | 账号位于 `admin_user`，密码 bcrypt 校验 |

默认管理员用户名为 `admin`。**本文档不记录明文口令**；初始口令请从受控的项目初始化说明或项目负责人处获取。重置方式见 [`docs/04-测试与部署.md`](./docs/04-测试与部署.md) §6。

请求受保护接口时使用：

```text
Authorization: Bearer <JWT>
```

所有写操作必须携带唯一 `clientRequestId`，用于防止重复扣款、重复购买和重复结算。

### 6.2 已实现的接口分组

| 分组 | 内容 |
|---|---|
| A · 认证 | 小程序登录、管理员登录、当前身份 |
| B · 配置与图鉴 | 配置快照、等级、概率、卡池、英雄、羁绊 |
| C · 对局生命周期 | 创建、列表、详情、棋盘、结算、投降 |
| D · 商店与经济 | 商店查询、刷新、购买、出售、买经验、收入预估 |
| E · 棋盘与羁绊 | 提交布局、部署、羁绊统计 |
| F · 回合与战斗 | 回合列表、回合详情、发起战斗、战报 |
| G · 存档 | 快照列表、最新快照、恢复 |

完整路径、请求示例、响应结构和错误码见 [`docs/02-后端接口清单.md`](./docs/02-后端接口清单.md)。

---

## 7. 文档索引

- [`plan.md`](./plan.md)：后续开发总控，约束范围、顺序、产物和验收。
- [`docs/01-数据库设计.md`](./docs/01-数据库设计.md)：15 表 E-R 图、数据字典、不变量、事务边界。
- [`docs/02-后端接口清单.md`](./docs/02-后端接口清单.md)：接口、错误码、请求示例与时序说明。
- [`docs/03-项目目录结构.md`](./docs/03-项目目录结构.md)：目录结构、engine 契约与阶段进度。
- [`docs/04-测试与部署.md`](./docs/04-测试与部署.md)：环境、导入、配置、启动、测试、账号和常见故障排查。
- [`database/弈灵诀-数据库设计说明书.md`](./database/弈灵诀-数据库设计说明书.md)：数据库定稿规格。

---

## 8. 安全与开发约束

- 不要提交 `.env`、真实口令、JWT 密钥、微信密钥或令牌。
- 不要在日志、测试用例、文档、提交信息和聊天中展示完整真实凭据。
- 不要执行未经确认的清库、删表、强制推送或数据库脚本。
- 不要修改定稿的英雄、羁绊档位、卡池、概率、表结构和核心数值公式。
- engine 禁止引入 I/O、数据库、Express 或 `Math.random()`；纯度由单元测试静态守卫。
- 后续每轮只完成一个明确模块，交付代码、测试、说明和自检结果后等待确认，不自动连做。

如发现需要变更上述基线，请先列出变更原因、影响范围和回归计划，获得明确确认后再实施。

---

## 9. 后续开发顺序

按 `plan.md` 的既定节奏，在后端验收通过后，候选工作依次为：

1. 小程序对局页（无动画）。
2. Web 后台数值配置页。
3. 基于服务端时间轴的简版战斗动画。
4. `docs/04` 与 README 的后续补充（本文已完成初版）。

以上均为候选而非自动执行项；每一轮需由用户明确指定具体模块。
