/**
 * 配置契约回归测试：桌面端设置界面只认 volatile 字段，而 volatile 解析结果
 * 是个带 `get()` 的引用（当普通值读会静默变 undefined）。这里用真实
 * schemastery 解析插件导出的 Config，锁住「四个字段都是 volatile 引用」和
 * 「liveValue 能取回真实值」两件事。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MAX_CONTEXT_BYTES, liveValue } from "../src/config.ts";
import { Config } from "../src/index.ts";

interface VolatileLike {
  get(): unknown;
}

/** schemastery 的 schema 可调用：调用即解析并补齐默认值。 */
const resolve = (partial: Record<string, unknown> = {}): Record<string, VolatileLike> =>
  Config(partial as never) as unknown as Record<string, VolatileLike>;

const FIELDS = ["directory", "projectSources", "reminders", "maxContextBytes"] as const;

test("Config 的四个字段解析后都是 volatile 引用", () => {
  const resolved = resolve();
  for (const field of FIELDS) {
    assert.equal(
      typeof resolved[field]?.get,
      "function",
      `${field} 必须是 volatile 引用，否则桌面端设置界面不会渲染它`,
    );
  }
  // 默认值也要走 volatile 包装：否则用户改过配置再删除该键就取不到默认值。
  assert.equal(liveValue(resolved.directory), "");
  assert.equal(liveValue(resolved.projectSources), true);
  assert.equal(liveValue(resolved.reminders), true);
  assert.equal(liveValue(resolved.maxContextBytes), DEFAULT_MAX_CONTEXT_BYTES);
});

test("liveValue 从 volatile 引用取回配置值", () => {
  const resolved = resolve({
    directory: "/tmp/vault",
    projectSources: false,
    reminders: false,
    maxContextBytes: 4096,
  });
  assert.equal(liveValue(resolved.directory), "/tmp/vault");
  assert.equal(liveValue(resolved.projectSources), false);
  assert.equal(liveValue(resolved.reminders), false);
  assert.equal(liveValue(resolved.maxContextBytes), 4096);
});

test("liveValue 对非 volatile 值原样返回，且不把 null 当引用", () => {
  assert.equal(liveValue("plain"), "plain");
  assert.equal(liveValue(1024), 1024);
  assert.equal(liveValue<string | undefined>(undefined), undefined);
  assert.equal(liveValue<string | null>(null), null);
  // 带 get 但不是函数的普通对象不算引用。
  assert.deepEqual(liveValue({ get: "not a function" }), { get: "not a function" });
});
