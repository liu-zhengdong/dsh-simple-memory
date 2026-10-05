import assert from "node:assert/strict";
import { test } from "node:test";
import { KeywordIndex, type KeywordNote } from "../src/keywords.ts";
import type { Snapshot } from "../src/memory.ts";
import { Reminders } from "../src/reminders.ts";

function index(notes: Partial<KeywordNote>[]): KeywordIndex {
  const value = new KeywordIndex();
  value.notes = new Map(
    notes.map((note) => [
      note.path!,
      {
        name: note.name!,
        path: note.path!,
        keywords: note.keywords ?? [],
        description: note.description,
        purpose: note.purpose,
      },
    ]),
  );
  return value;
}

function snapshot(notes: { name: string; path: string }[]): Snapshot {
  return {
    directory: "/vault",
    issues: [],
    text: "",
    bytes: 0,
    reads: 0,
    cacheHits: 0,
    sources: [
      {
        kind: "global",
        path: "/vault",
        notes,
        folders: [],
        issues: [],
        text: "# 记忆",
        bytes: 4,
      },
    ],
  };
}

const deep = {
  name: "字体.md",
  path: "/vault/项目/字体.md",
  keywords: ["字体", "font-family"],
  purpose: "设置字体时参考。",
  description: "字体栈约定。",
};

test("用户输入命中在本次提供，并按路径去重", () => {
  const reminders = new Reminders(index([deep]));
  reminders.configure(undefined, 256 * 1024);
  reminders.capture("这个页面的字体想换一下");
  const first = reminders.take(0);
  assert.deepEqual(
    first.reminders.map((note) => note.path),
    ["/vault/项目/字体.md"],
  );
  assert.match(first.text, /^# 关键词提醒/);
  assert.match(first.text, /路径：\/vault\/项目\/字体\.md/);
  assert.match(first.text, /定位：设置字体时参考。/);
  // 再次命中不重复提供。
  reminders.capture("font-family 也要改");
  assert.equal(reminders.take(0).reminders.length, 0);
});

test("默认注入过的根层记忆不再通过关键词重复提供", () => {
  const root = { name: "USER.md", path: "/vault/USER.md", keywords: ["用户"] };
  const reminders = new Reminders(index([root]));
  reminders.configure(snapshot([root]), 256 * 1024);
  reminders.capture("用户偏好是什么");
  assert.deepEqual(reminders.pendingPaths, []);
  assert.equal(reminders.take(0).reminders.length, 0);
});

test("未提供的命中在超预算时整篇延后并计数", () => {
  const reminders = new Reminders(index([deep]));
  reminders.configure(undefined, 10);
  reminders.capture("字体");
  const result = reminders.take(0);
  assert.equal(result.reminders.length, 0);
  assert.equal(result.omitted, 1);
  assert.deepEqual(reminders.pendingPaths, ["/vault/项目/字体.md"]);
});

test("reset 之后同一命中可以再次提醒", () => {
  const reminders = new Reminders(index([deep]));
  reminders.configure(undefined, 256 * 1024);
  reminders.capture("字体");
  reminders.take(0);
  reminders.reset();
  reminders.configure(undefined, 256 * 1024);
  reminders.capture("字体");
  assert.equal(reminders.take(0).reminders.length, 1);
});

test("已离开索引的候选被清理", () => {
  const value = index([deep]);
  const reminders = new Reminders(value);
  reminders.configure(undefined, 256 * 1024);
  reminders.capture("字体");
  value.notes = new Map();
  reminders.configure(undefined, 256 * 1024);
  assert.deepEqual(reminders.pendingPaths, []);
});
