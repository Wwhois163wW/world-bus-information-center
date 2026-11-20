<!--
@file GEMINI.md
@description world-bus-information-center 工作区专用指令规范
@date 2026-11-19
@version 0.1.0
-->

# `world-bus-information-center` 工作区规范

## 1. 项目定位与技术栈

- **服务定位**: World Bus 信息中心邮局服务 (频道白名单校验, 信封 Schema 校验, 消费组投递与 PEL 签收, 节点心跳与超时巡检).
- **核心技术栈**: TypeScript (ESM, `NodeNext`), Node.js, Hono, `@hono/node-server`, Zod v3 (`z.record(z.unknown())` 契约), Vitest.
- **目录约定**:
  - `src/`: TypeScript 源码根目录 (`tsconfig.json` 中 `"rootDir": "src"`, `"outDir": "dist"`).
  - `tests/`: Vitest 测试目录 (通过 `tsconfig.test.json` 纳入 `tsc --noEmit` 类型检查).
  - `docs/dialog/`: 会话工作日志目录.

## 2. 标准文件头规范

**本工作区所有新建或修改的源码与文档文件, 必须使用标准文件头, 且严禁标注作者署名 (`Author`) 与机构名称/链接 (`License`/机构信息).**

- **TypeScript 文件头模板**:

```ts
/**
 * @file src/example.ts
 * @description 模块职责简述
 * @date YYYY-MM-DD
 * @version 0.1.0
 */
```

- **Markdown 文件头模板**:

```markdown
<!--
@file path/to/doc.md
@description 文档用途简述
@date YYYY-MM-DD
@version 0.1.0
-->
```

## 3. TypeScript 编码与模块规范

1. **ESM 导入规范**: `package.json` 启用 `"type": "module"`, 所有相对路径导入必须显式保留 `.js` 后缀 (如 `import { createInfoCenter } from "./server.js";`).
2. **类型安全**: 保持 `tsconfig.json` 的 `"strict": true` 约束, 禁止使用隐式 `any`; 对环境变量解析做显式边界校验.
3. **代码格式与可读性**:
   - 单行尽量控制在 80 字符以内, 长表达式与多条件判断换行缩进, 前置逻辑符 (`&&`, `||`).
   - 保持浅层嵌套, 优先使用早返回 (Early Return).
4. **核心运行时默认契约**:
   - `createInfoCenter()` 工厂函数内部 `patrolIntervalMs` 保持默认关闭 (`0`), 不自动开启后台定时器, 便于测试精确控制.
   - `src/main.ts` 服务端启动入口默认监听 `0.0.0.0:3200`, 默认开启 `patrolIntervalMs = 60000` (支持 `INFO_CENTER_PATROL_INTERVAL_MS` 覆盖), 默认 `heartbeatTimeoutMs = 3 * 24 * 60 * 60 * 1000` (支持 `INFO_CENTER_HEARTBEAT_TIMEOUT_MS` 覆盖).

## 4. 变更与文档工作流

1. **非破坏性编辑**: 修改既有代码时先保留原逻辑为注释并在下方编写新代码, 仅在收到 `[CLEANUP]` 指令时清理.
2. **标准化标记**: 变更处使用 `// @Antigravity, YYYYMMDD, [KEYWORD]: 修改说明` (不得包含 `@ zhu`).
3. **伴生澄清文档**: 源码变更同步维护同级同名 `.md` 文档 (`src/main.ts` <-> `src/main.md`).
4. **会话日志**: 每次实质变更后在 `docs/dialog/` 写入 `work_log_{YYYYMMDD_HHMMSS}.md`.
5. **通讯语言与标点**: 使用中文响应, 严格使用半角逗号加空格 (`, `).
