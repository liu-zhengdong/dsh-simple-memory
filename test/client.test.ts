/**
 * 客户端半侧（`client/client.js`）的接线测试：不开浏览器也能锁住契约——
 * ① 工厂 id 与导出形状（`name`/`inject`/`apply`）；
 * ② 三个槽位的注册参数（`plugins.bundle.config` 用包名、`plugins.row.config` 用
 *    `<包名>#<行 id>`、`settings.plugins.tab` 用 id/order/label）；
 * ③ 只在设置服务真的服务了 `simple-memory` 这个命名空间时才注册；
 * ④ 卡片的三种状态（summary 一行文本、不可写、字段非法）与「选择目录…」把
 *    `pickDirectory()` 的结果写回 `directory`。
 * 另外锁住宿主侧的 `liveValue()`：volatile 字段必须 `.get()` 才读得到值。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { liveValue } from "../src/config.ts";

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

interface Registration {
  options: Record<string, unknown>;
  component: unknown;
}

interface MutateCall {
  ops: { op: string; path: string[]; value?: unknown }[];
  revision: unknown;
}

function createElement(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): Element {
  const merged: Record<string, unknown> = { ...(props ?? {}) };
  if (children.length === 1) merged.children = children[0];
  else if (children.length > 1) merged.children = children;
  return { type, props: merged };
}

/**
 * 极小的 hooks 运行时：状态按槽位跨渲染保存，于是「点按钮 → 重渲染 → 再点保存」
 * 这条真实路径能在纯 Node 里跑通。
 */
function makeRenderer() {
  let slots: unknown[] = [];
  let cursor = 0;
  const react = {
    createElement,
    useCallback: (fn: unknown) => fn,
    useState(initial: unknown) {
      const index = cursor;
      cursor += 1;
      if (!(index in slots)) slots[index] = initial;
      const read = () => slots[index];
      const write = (next: unknown) => {
        slots[index] = typeof next === "function" ? (next as (prev: unknown) => unknown)(read()) : next;
      };
      return [read(), write];
    },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  };
  return {
    render(component: (props: any) => unknown, props: Record<string, unknown>): unknown {
      cursor = 0;
      return component(props);
    },
    react,
  };
}

/** 从注册进去的词典里取一个同步 t()，像宿主那样在调用时才查字典。 */
function makeTranslator(dictionaries: Record<string, Record<string, string>>) {
  return (namespace: string) => (key: string) => dictionaries[namespace]?.[key] ?? key;
}

interface ClientHarness {
  exports: Record<string, unknown>;
  registrations: Registration[];
  slotOwners: string[];
  whileServed: string[][];
  effects: number;
  pickCalls: number;
  mutateCalls: MutateCall[];
  unsetCalls: string[];
  dictionaries: Record<string, Record<string, string>>;
  t: (key: string) => string;
  /** 改快照：用来在同一个 harness 上测 ready / 只读 / 非法值等状态。 */
  setSnapshot(snapshot: Record<string, unknown>): void;
  /** 已注册的槽位条目里 `inject()` 展开出来的 props。 */
  faceOf(index: number): Record<string, any>;
  /** 渲染一次卡片（hooks 槽位跨渲染保存，能模拟「点按钮 → 重渲染」）。 */
  renderFor(component: (props: any) => unknown, props: Record<string, unknown>): unknown;
}

function makeHarness(
  options: {
    snapshot?: Record<string, unknown>;
    serve?: boolean;
    pick?: () => Promise<string | null>;
    withWorkspace?: boolean;
    withConfigForms?: boolean;
  } = {},
): ClientHarness {
  const code = readFileSync(new URL("../client/client.js", import.meta.url), "utf8");
  let loaded: { id: string; factory: (require: (id: string) => unknown) => any } | undefined;
  const window = {
    __ModuleLoader__: {
      load(module: { id: string; factory: (require: (id: string) => unknown) => any }) {
        loaded = module;
      },
    },
  };
  const renderer = makeRenderer();
  // eslint-disable-next-line no-new-func
  new Function("window", code)(window);
  assert.ok(loaded !== undefined, "client bundle 必须调用 window.__ModuleLoader__.load");
  const bundle = loaded;
  const exported = bundle.factory((id: string) => {
    if (id === "react") return renderer.react;
    throw new Error(`client 半侧不能 require ${id}`);
  });

  const registrations: Registration[] = [];
  const slotOwners: string[] = [];
  const whileServed: string[][] = [];
  const mutateCalls: MutateCall[] = [];
  const unsetCalls: string[] = [];
  const dictionaries: Record<string, Record<string, string>> = {};
  let effects = 0;
  let pickCalls = 0;

  let snapshot: Record<string, unknown> = {
    status: "ready",
    writable: true,
    revision: 7,
    mode: "host",
    value: {
      directory: "",
      projectSources: true,
      reminders: true,
      maxContextBytes: 262144,
    },
    base: { maxContextBytes: 262144 },
    user: {},
    ...(options.snapshot ?? {}),
  };

  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: () => Promise.resolve(true),
    unset: (field: string) => {
      unsetCalls.push(field);
      return Promise.resolve(true);
    },
    mutate: (ops: MutateCall["ops"], revision: unknown) => {
      mutateCalls.push({ ops, revision });
      return Promise.resolve(true);
    },
  };

  const services: Record<string, unknown> = {};
  if (options.withWorkspace !== false) {
    services.uiWorkspace = {
      pickDirectory: () => {
        pickCalls += 1;
        return (options.pick ?? (() => Promise.resolve("/Users/me/vault")))();
      },
    };
  }
  if (options.withConfigForms !== false) {
    services.configForms = {
      get: (entryId: string) => {
        assert.equal(entryId, "simple-memory", "表单命名空间必须是 profile 的行 id");
        return form;
      },
      whileServed: (namespaces: string[], register: () => unknown) => {
        whileServed.push(namespaces);
        if (options.serve === false) return () => {};
        const dispose = register();
        return typeof dispose === "function" ? dispose : () => {};
      },
    };
  }

  const ctx = {
    effect: (fn: () => unknown) => {
      effects += 1;
      return fn();
    },
    inject: (names: readonly string[], callback: (scope: Record<string, unknown>) => unknown) => {
      const scope: Record<string, unknown> = {};
      for (const name of names) if (name in services) scope[name] = services[name];
      if (Object.keys(scope).length === 0) return;
      const dispose = callback(scope);
      return typeof dispose === "function" ? dispose : () => {};
    },
    locale: {
      bind: (namespace: string) => makeTranslator(dictionaries)(namespace),
      register: (namespace: string, value: Record<string, Record<string, string>>) => {
        // 客户端两个词典都在同一个 register 调用里进来，宿主按语言挑一份。
        dictionaries[namespace] = value.zh ?? {};
        return () => {};
      },
    },
    slots: {
      inject: (ownerKey: string, run: () => unknown) => {
        slotOwners.push(ownerKey);
        return run();
      },
      register: (slotOptions: Record<string, unknown>, component: unknown) => {
        registrations.push({ options: slotOptions, component });
        return () => {};
      },
    },
  };

  (exported as { apply: (ctx: unknown) => void }).apply(ctx);

  return {
    exports: exported,
    registrations,
    slotOwners,
    whileServed,
    get effects() {
      return effects;
    },
    get pickCalls() {
      return pickCalls;
    },
    mutateCalls,
    unsetCalls,
    dictionaries,
    t: makeTranslator(dictionaries)("dsh-simple-memory"),
    setSnapshot(next: Record<string, unknown>) {
      snapshot = { ...snapshot, ...next };
    },
    faceOf(index: number) {
      const entry = registrations[index];
      assert.ok(entry !== undefined, `没有第 ${index} 个槽位注册`);
      const inject = entry.options.inject as () => Record<string, any>;
      return inject();
    },
    renderFor(component: (props: any) => unknown, props: Record<string, unknown>) {
      return renderer.render(component, props);
    },
  };
}

function findByClass(node: unknown, className: string): Element | undefined {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  const element = node as Element;
  if (typeof element.props?.className === "string" && element.props.className.split(" ").includes(className)) {
    return element;
  }
  return findAny(element.props?.children, (child) => findByClass(child, className));
}

function findAny(node: unknown, predicate: (child: unknown) => Element | undefined): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = predicate(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  const element = node as Element;
  const self = predicate(node);
  if (self !== undefined) return self;
  return findAny(element.props?.children, predicate);
}

function findAllByClass(node: unknown, className: string, found: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) findAllByClass(child, className, found);
    return found;
  }
  if (node === null || node === undefined || typeof node !== "object") return found;
  const element = node as Element;
  if (typeof element.props?.className === "string" && element.props.className.split(" ").includes(className)) {
    found.push(element);
  }
  findAllByClass(element.props?.children, className, found);
  return found;
}

test("client 工厂 id 与导出形状符合 lazy-CJS 契约", () => {
  const harness = makeHarness();
  assert.equal(harness.exports.name, "dsh-simple-memory");
  assert.deepEqual(harness.exports.inject, ["slots", "locale"]);
  assert.equal(typeof harness.exports.apply, "function");
  // 插件自身不 import 任何 Harness 客户端包：工厂里 require 别的东西就会抛。
  assert.ok(harness.effects > 0, "register / effect 必须发生在 apply 内");
});

test("三个槽位都注册，key/id 按宿主约定填", () => {
  const harness = makeHarness();
  assert.deepEqual(harness.whileServed, [["simple-memory"]]);
  assert.deepEqual(harness.slotOwners, [
    "plugins.bundle.config",
    "plugins.row.config",
    "settings.plugins.tab",
  ]);
  assert.equal(harness.registrations.length, 3);

  const [bundle, row, tab] = harness.registrations;
  assert.equal(bundle!.options.name, "plugins.bundle.config");
  assert.equal(bundle!.options.key, "dsh-simple-memory", "bundle 座位的 key 是包名");
  assert.equal(row!.options.name, "plugins.row.config");
  assert.equal(row!.options.key, "dsh-simple-memory#simple-memory", "行座位的 key 是 <包名>#<行 id>");
  assert.equal(tab!.options.name, "settings.plugins.tab");
  assert.equal(tab!.options.id, "dsh-simple-memory");
  assert.equal(tab!.options.order, 60);
  assert.equal(tab!.options.locale, "dsh-simple-memory");
  assert.equal((tab!.options.label as () => string)(), "记忆");

  for (const entry of harness.registrations) {
    assert.equal(typeof entry.component, "function");
  }
});

test("设置服务没有服务这个命名空间时不注册任何座位", () => {
  const harness = makeHarness({ serve: false });
  assert.deepEqual(harness.whileServed, [["simple-memory"]]);
  assert.deepEqual(harness.registrations, []);
  assert.deepEqual(harness.slotOwners, []);
});

test("face() 把 t / 表单 / 目录选择器交给卡片", async () => {
  const harness = makeHarness();
  const face = harness.faceOf(0);
  assert.equal(typeof face.t, "function");
  assert.equal(typeof face.configForm.mutate, "function");
  assert.equal(await face.pickDirectory(), "/Users/me/vault");
  assert.equal(harness.pickCalls, 1);
});

test("profile 里没有 uiWorkspace 服务时，pickDirectory() 只是不可用，不抛异常", () => {
  const harness = makeHarness({ withWorkspace: false });
  const face = harness.faceOf(0);
  assert.equal(face.pickDirectory(), undefined);
});

test("summary 座位只返回一行文本", () => {
  const harness = makeHarness();
  const card = harness.registrations[0]!.component as (props: any) => unknown;
  const text = card({ ...harness.faceOf(0), view: "summary" });
  assert.equal(text, "Markdown 记忆目录：每轮注入索引，正文按需读取。");
});

test("「选择目录…」把结果写回 directory，保存只提交变化过的字段", async () => {
  const harness = makeHarness();
  const card = harness.registrations[0]!.component as (props: any) => unknown;
  const props = () => ({ ...harness.faceOf(0), view: "page" });

  const first = findByClass(harness.renderFor(card, props()), "dsm-browse");
  assert.ok(first !== undefined, "应有一个「选择目录…」按钮");
  await (first!.props.onClick as () => Promise<void>)();
  assert.equal(harness.pickCalls, 1);

  const save = findByClass(harness.renderFor(card, props()), "dsm-save");
  assert.ok(save !== undefined, "应有一个保存按钮");
  assert.equal(save!.props.disabled, false);
  await (save!.props.onClick as () => Promise<void>)();

  assert.deepEqual(harness.mutateCalls, [
    {
      ops: [{ op: "set", path: ["directory"], value: "/Users/me/vault" }],
      revision: 7,
    },
  ]);
});

test("非法字节数拦住保存并给出提示", () => {
  const harness = makeHarness({
    snapshot: {
      value: { directory: "", projectSources: true, reminders: true, maxContextBytes: 999 },
    },
  });
  const card = harness.registrations[0]!.component as (props: any) => unknown;
  const tree = harness.renderFor(card, { ...harness.faceOf(0), view: "page" });
  const save = findByClass(tree, "dsm-save");
  assert.equal(save!.props.disabled, true);
  const invalid = findByClass(tree, "dsm-invalid");
  assert.equal(invalid!.props.children, "请填 1024 到 16777216 之间的整数。");
});

test("只读的 profile 里字段全部禁用，并说明原因", () => {
  const harness = makeHarness({ snapshot: { writable: false } });
  const card = harness.registrations[0]!.component as (props: any) => unknown;
  const tree = harness.renderFor(card, { ...harness.faceOf(0), view: "page" });
  const inputs = findAllByClass(tree, "dsm-input");
  assert.equal(inputs.length, 2, "目录与字节数两个输入框仍然展示当前值");
  assert.ok(inputs.every((input) => input.props.disabled === true));
  assert.equal(findByClass(tree, "dsm-save")!.props.disabled, true);
  assert.equal(findByClass(tree, "dsm-note")!.props.children, "这个 profile 的配置是只读的，改不动。");
});

test("宿主没服务这个命名空间时，卡片说明原因而不是给一张空表单", () => {
  const harness = makeHarness({ snapshot: { status: "unavailable", value: undefined } });
  const card = harness.registrations[0]!.component as (props: any) => unknown;
  const tree = harness.renderFor(card, { ...harness.faceOf(0), view: "page" });
  assert.equal(findByClass(tree, "dsm-input"), undefined);
  assert.equal(
    findByClass(tree, "dsm-note")!.props.children,
    "宿主没有提供这份配置（检查插件是否已挂载）。",
  );
});

test("连表单控制器都没有时也只说明原因，不把槽位炸掉", () => {
  const harness = makeHarness();
  const card = harness.registrations[0]!.component as (props: any) => unknown;
  const tree = harness.renderFor(card, {
    t: harness.t,
    configForm: undefined,
    pickDirectory: undefined,
    view: "page",
  });
  assert.equal(findByClass(tree, "dsm-save"), undefined);
  assert.equal(
    findByClass(tree, "dsm-note")!.props.children,
    "宿主没有提供这份配置（检查插件是否已挂载）。",
  );
});

test("liveValue 既接受普通值也接受 volatile 引用", () => {
  assert.equal(liveValue("vault"), "vault");
  assert.equal(liveValue(4096), 4096);
  assert.equal(liveValue(true), true);
  assert.equal(liveValue(undefined), undefined);
  const volatile = { get: () => "from-volatile" };
  assert.equal(liveValue(volatile), "from-volatile");
  // volatile 引用当普通值读会静默变 undefined —— 这正是必须走 liveValue 的原因。
  assert.equal(typeof volatile === "string", false);
});
