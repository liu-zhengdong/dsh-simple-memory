import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeTemplateBraces, joinBlocks } from "../src/text.ts";

test("完整的模板括号被拆开，避免组装期变量扫描", () => {
  assert.equal(
    escapeTemplateBraces("用 {{cwd}} 和 {{unknown}} 举例"),
    "用 {\u200b{cwd}} 和 {\u200b{unknown}} 举例",
  );
});

test("单个花括号不动，未闭合的模板前缀也一并拆开", () => {
  assert.equal(escapeTemplateBraces("单个 { 花括号 }"), "单个 { 花括号 }");
  assert.equal(escapeTemplateBraces("未闭合 {{ 前缀"), "未闭合 {\u200b{ 前缀");
});

test("空块被丢掉，其余按顺序拼接", () => {
  assert.equal(joinBlocks(["a", "", undefined, "  b  "]), "a\n\nb");
  assert.equal(joinBlocks([]), "");
});
