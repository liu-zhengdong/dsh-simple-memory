# dsh-simple-memory

把**你自己维护的 Markdown 记忆目录**（Obsidian 库、`.memory` 项目记忆）接入 DSH：
每轮常驻一份**索引**，正文按需读取，插件只读不改。

从 [pi-memory](https://github.com/liu-zhengdong/pi-memory) 移植。行为契约（frontmatter
的含义、按字节计的预算、整份来源排除、字面关键词提醒）保持不变，注入机制按 DSH 的
插件面重写。

## 它做什么

- **索引注入**：每轮把记忆的根层条目放进运行时上下文——名称、绝对路径、frontmatter
  的 `description`/`purpose` 定位，以及子文件夹入口。`defaultopen: true` 的记忆带全文，
  其余只给摘要；更深层的记忆不进默认上下文。
- **关键词提醒**：frontmatter `keywords` 里的字面短语命中**用户输入**或**模型文本**时，
  在**本步**追加一条 user 快照消息，给出路径，让模型自己用 `read` 读取全文。
  命中过一次的记忆在本轮不再重复提醒。
- **按需阅读**：上层正文里的 `[[路径]]` 引用由模型自己判断，插件不解析、不校验。
- **只读**：不写你的记忆目录，不写配置文件；缓存只在内存里。

## 与 pi-memory 的差异

| | pi-memory | dsh-simple-memory |
| --- | --- | --- |
| 索引注入 | Pi 系统提示词尾部 | DSH `runtime-context` 快照里的 `simple-memory` 段 |
| 关键词提醒 | 系统提示词尾部（下一轮） | `agent/pre-step` 追加的 user 快照消息（**本步**生效） |
| 配置 | agent 目录下的 `memory.json` | profile 的 `cordis.patch.yml`（schemastery Config） |
| 项目记忆信任门槛 | 需要 Pi 信任该项目 | 无（与 `AGENTS.md` 注入同一个信任边界） |
| 命令 | `/memory set`、`/memory clear` 会写配置 | 只读；配置改 YAML |
| 落盘缓存 | agent 目录 `cache/pi-memory/` | 无（内存里按文件签名缓存） |

## 安装

```bash
# 本地 checkout（开发用，pnpm link）
dsh plugin --profile <profile> add /abs/path/to/dsh-simple-memory

# 或从 npm
dsh plugin --profile <profile> add dsh-simple-memory
```

包声明了 `dsh.bundle.patch`，添加后包名会被追加进该 profile 的 `dsh.profile.bundles`。
验证层已挂上：

```bash
dsh --profile <profile> --dump-config | grep -B2 -A6 dsh-simple-memory
```

> link 安装不会给插件装依赖。从 git 安装时请先在 checkout 里 `pnpm install`
> （运行时只依赖 `yaml`）。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `directory` | `""` | 全局记忆目录，绝对路径或 `~` 开头；留空表示不使用全局来源 |
| `projectSources` | `true` | 从工作目录向上到 git 根逐层发现 `.memory` |
| `reminders` | `true` | 按 `keywords` 命中用户输入或模型文本时提醒 |
| `maxContextBytes` | `262144` | 每轮注入的记忆文本上限（UTF-8 字节，1 KiB–16 MiB） |

配置住在 profile 的 `cordis.patch.yml` 里。**patch 整块替换 `config`，不做深合并**，
所以覆盖时请写全你要的字段：

```yaml
- id: simple-memory
  config:
    directory: ~/Obsidian/记忆
    projectSources: true
    reminders: true
    maxContextBytes: 262144
```

改这一行会触发插件热替换，不需要重启。

## 记忆文件格式

```markdown
---
description: 界面字体的选择（进索引，一句话定位）
purpose: 排版相关任务开工前先看（进索引）
defaultopen: true          # 可选：整篇正文进默认上下文（超过 8 KiB 会提示拆分）
keywords:                  # 可选：字面短语，命中就提醒
  - 字体
  - 字体栈
---

正文……
```

- 只有 `.md` 会被收录；点开头的文件、符号链接跳过。
- 每层来源只扫**根目录的直接子项**，子文件夹作为入口列出（示例见 `examples/vault/`）。
- 解析失败、frontmatter 超限、来源超预算都会出现在 `/memory` 的输出里，不会静默截断。

## 上限

| 项 | 值 |
| --- | --- |
| 每轮注入文本 | 256 KiB（可配 1 KiB–16 MiB） |
| 单篇 frontmatter | 64 KiB |
| 单篇 `defaultopen` 全文 | 8 KiB（照常注入，但提示拆分） |
| 关键词索引 | 16 MiB / 100,000 条 |

超预算的**整份来源**会被排除并在 `/memory` 里给出原因，而不是截断正文。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/memory` | 目录、来源数、注入 KiB、索引篇数、未注入来源与提醒 |
| `/memory preview` | 本轮的注入文本（索引）与未注入来源 |
| `/memory help` | 用法 |

命令只在有命令面的宿主里可用（headless 没有）。它是只读的——配置请改 YAML。

## 开发

```bash
pnpm install
npm run check     # tsc --noEmit
npm test          # node --test（80 个用例，含假宿主接线测试）
npm run build     # tsc -p tsconfig.build.json → lib/
```

本地联调：`dsh plugin --profile <profile> add .`，然后用
`dsh headless --json "……"` 或桌面端发一条消息；调试日志用
`DSH_SIMPLE_MEMORY_DEBUG=1` 打开。

## 已知限制

- **只读、无写回**：插件不替你整理记忆，也不从对话里自动提取。
- **字面匹配，不是语义检索**：`keywords` 是大小写不敏感的英文子串匹配，
  中文按原样匹配；不做正则、不做向量检索。
- **`[[路径]]` 不解析**：是否读取由模型决定。
- **注入文本会改写 `{{`**：DSH 组装期会对 `{{name}}` 做变量插值，未注册的变量名会让
  整轮请求报错，所以索引文本里的 `{{` 会被拆成 `{<零宽空格>{`（提醒消息不需要，
  它不走插值）。
- **不 import `@deepseek-ai/*` 类型**：官方包只随 DSH 分发，npm 上的版本与宿主不一致；
  插件用自己的最小结构化类型对接宿主。
