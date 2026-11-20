<!--
@file src/index.md
@description src/index.ts 伴生澄清文档
@date 2026-11-19
@version 0.1.0
-->

# `src/index.ts` 技术设计说明

## 1. 技术设计要点

- **统一导出门面 (Barrel Module)**: 集中收敛 `schema.ts`, `store.ts`, `server.ts` 的公开运行时符号与 TypeScript 类型, 便于外部包调用方或内部入口统一导入.
- **无副作用边界**: 刻意不从 `src/index.ts` 导出 `src/main.ts`, 避免在仅需复用 `createInfoCenter` 或 `MemoryStreamStore` 时意外触发 HTTP 监听与信号注册副作用.
- **依赖方向**: `schema.ts` -> `store.ts` -> `server.ts` -> `index.ts` -> `main.ts`, 保持单向无环依赖.

## 2. 变更记录流水

- `@Antigravity, 20261119, [INIT]`: 新建 `src/index.ts`, 统一导出频道白名单, 信封 Schema, 存储接口与内存实现, 以及信息中心服务工厂函数.
