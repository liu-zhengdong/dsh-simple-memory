# dsh-simple-memory 开发规范

面向编码 Agent 的硬规矩。给人看的说明在 `README.md`。

## 这个仓库要维护什么

把用户自己维护的 Markdown 记忆目录接入 DSH：往运行时上下文注入一份**索引**，
正文由模型按需 `read`。插件只读，不写用户的记忆目录。

用户会同时在 macOS 与 Windows 上跑同一个 profile，所以**跨平台是功能要求，不是加分项**。

## 命令

```bash
npm run check     # tsc --noEmit，改完必跑
npm test          # node --test test/*.test.ts，改完必跑
npm run build     # tsc -p tsconfig.build.json → lib/
```

- **`lib/` 是构建产物，随仓库提交**。改 `src/` 后必须跑 `npm run build` 并一起提交，
  否则用户装到的还是旧代码。安装时不跑构建脚本（git 包的 `prepare` 被 pnpm 拦下）。
- 改 `client/client.js` 要重启 DSH 才生效（客户端半侧只在启动时扫一次）。
- 性能有要求的路径有基准脚本：`npm run bench`、`bench:keywords`、`bench:store`。

## 跨平台（Windows 兼容）

同一份 `cordis.patch.yml` 会跟着 profile 在 Mac 与 Windows 之间走。规则：

- **路径判据同时认两侧的绝对路径形态**：POSIX `/...`、盘符 `C:\...` 与 `C:/...`、
  UNC `\\server\share`。只按运行平台判断，会让另一侧写好的值在加载时报错。
  实现在 `isAbsolutePath`（`src/engine.ts:40`）与 `resolveDirectory`（`src/engine.ts:52`）：
  本机判不出绝对路径时交给 `win32.resolve` 规范化——用本机 `resolve` 会把 `C:\x`
  当成相对段拼到 cwd 后面，得到一个不存在又不报错的路径，比直接拒绝更难查。
- **`~` 后面两种分隔符都收**，并一律按本机分隔符重拼（`src/engine.ts:57`）：
  `~\notes` 原样保留到 Mac 上，`\` 会被当成文件名的一部分。
- **判据只有一处**：`client/client.js` 的 `isAbsoluteish`（`client/client.js:160`）与
  `src/engine.ts` 的上面两个函数必须同进同退。改一侧就改另一侧。
- **路径拼接一律走 `node:path`**，不手写 `/` 或 `\`。前缀与包含判断带 `sep`
  （`src/keywords.ts:144`、`src/keyword-store.ts:160`）。
- **换行按 CRLF 也能解析**：frontmatter 分界（`src/memory.ts:67`）与渲染时的折行
  （`src/memory.ts:130`、`src/memory.ts:132`）都用 `\r?\n`。Windows 上编辑过的 `.md`
  是 CRLF，不认就等于整个仓库读不出来。
- **扩展名判断大小写不敏感**：`src/memory.ts:403`、`src/keywords.ts:88`、
  `src/keywords.ts:205` 都先 `toLowerCase()`。Windows 文件系统不区分大小写。
- **只有 POSIX 才有的能力要降级，不能抛错**：权限位（`0o600`/`0o700`）在 Windows 上被
  忽略；`fs.watch` 的 `recursive` 在 Linux 上不可用（`src/keyword-store.ts:146`），
  已有降级路径——报进 issues 并改为后台定期检查。
- **测试要么跨平台通过，要么显式跳过**：依赖 POSIX 权限的用例用
  `if (process.getuid?.() === 0 || process.platform === "win32") return t.skip();`
  （见 `test/memory.test.ts:261`、`test/keywords.test.ts:169`、
  `test/keyword-store.test.ts:248`）；只核对权限位的断言用
  `if (process.platform !== "win32")` 包住（`test/keyword-store.test.ts:82`）。
  不许留下在 Windows 上必然失败的断言。

守这条规则的自动检查是 `test/engine.test.ts:269`
（「异平台写下的绝对路径不被改写、也不被拒绝」）。加了新的路径处理就扩这一条。

## 代码约束

- **不 import 任何 `@deepseek-ai/*` 包**（`@deepseek-ai/schemastery` 除外）。官方包只随
  DSH 分发，npm 上的版本与宿主不一致，写进 import 会把插件锁死在某个版本上。宿主面
  用 `src/dsh.ts` 里的最小结构化类型对接。
- **客户端半侧也不 require `@deepseek-ai/dsh-client-*`**（官方明令禁止），只 require
  `react`；控件按官方标记与 `--dsw-*` 主题变量照抄。约束写在 `client/client.js` 头部。
- **源码要能被 Node 的类型剥离直接运行**（测试直接跑 `.ts`）：不用 `enum`、`namespace`、
  构造器参数属性。`src/engine.ts:118` 有对应的坑记录。
- **注入文本只在一处生成**：`src/memory.ts`。关键词提醒复用它的 `renderNote`，写入
  提醒复用 `renderWriteReminder`，不另写一份渲染。
- **模块职责**：`index.ts` 只做宿主接线，`engine.ts` 管状态与刷新，`memory.ts` 管扫描与
  渲染，`keywords.ts` 管索引与匹配，`reminders.ts` 管提醒去重，`config.ts` 管配置与路径。
  加能力先找已有模块，不往入口堆。
- 扫描只走根层直接子项，点开头与符号链接跳过；这既省成本也是安全边界，不要放宽。

## 验证与提交

- 改完跑 `npm run check`、`npm test`、`npm run build`，三样都要过，`lib/` 一起提交。
- 提交信息用中文，写清改了什么、为什么。
- 注入文本的改动会改模型看到的字节，交付前用真实记忆库看一眼渲染结果
  （`/memory preview`，或直接用 `MemoryLoader` 扫一遍），不靠断言推想。
