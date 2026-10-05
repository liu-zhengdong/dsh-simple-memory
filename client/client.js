/**
 * dsh-simple-memory 的桌面端配置面（client half）。
 *
 * 往三个官方槽位各注册同一张卡片，都是「不手改 cordis.patch.yml 就能改配置」的入口：
 *   ① `plugins.bundle.config`，key 用组合包包名 → 桌面「插件」页里本包页面上的配置区；
 *   ② `plugins.row.config`，key 为 `<包名>#<行 id>` → 插件列表里本包那一行的「配置」；
 *   ③ `settings.plugins.tab` → 「设置 → 插件」分区里的一个标签页。
 * 表单本体来自宿主服务 `configForms.get("simple-memory")`（命名空间＝profile 的行 id），
 * 写入落进 profile 的 `cordis.patch.yml`。
 *
 * 这里有两条硬约束，代码里都照做了：
 *   ① 不许 require 任何 `@deepseek-ai/dsh-client-*`：官方 practices.md 明令禁止
 *      （那些包随时会变，且构建期 purity gate 会拦跨插件的值导入）。所以控件与样式
 *      是按官方 SettingsForm / TextField 的标记与 `--dsw-*` 主题变量照抄后重命名的。
 *   ② 工厂体只做「取依赖」这一件事：注册、样式、清理全部发生在 `apply(ctx)` 里，
 *      并交给 `ctx.effect` 管理生命周期。
 *
 * 目录选择走官方给第三方的服务 `ctx.uiWorkspace.pickDirectory()`（macOS 上就是系统
 * 目录选择框），不 import 任何 picker 组件。
 */
window.__ModuleLoader__.load({
  id: "dsh-simple-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;

    /** 组合包包名：`plugins.bundle.config` 的 key 就是它。 */
    const PACKAGE_NAME = "dsh-simple-memory";
    /** profile patches 里那一行的 id：设置服务用它做命名空间。 */
    const ENTRY_ID = "simple-memory";
    /** 本插件文案的命名空间。 */
    const LOCALE_NS = "dsh-simple-memory";

    const MIN_BYTES = 1024;
    const MAX_BYTES = 16 * 1024 * 1024;

    /** 照抄官方 settings-form 的排版，类名全部换成自己的前缀，颜色只用 --dsw-* 变量。 */
    const CSS = [
      ".dsm-form{display:flex;flex-direction:column;max-width:760px;color:var(--dsw-alias-label-primary)}",
      ".dsm-heading{margin:0 0 4px;font-size:15px;font-weight:600;line-height:22px}",
      ".dsm-intro{margin:0 0 4px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}",
      ".dsm-note{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".dsm-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}",
      ".dsm-field+.dsm-field{border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".dsm-head{display:flex;align-items:center;gap:8px}",
      ".dsm-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}",
      ".dsm-reset{border:0;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".dsm-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
      ".dsm-reset:disabled{cursor:default;opacity:.5}",
      ".dsm-control{display:flex;align-items:center;gap:8px}",
      ".dsm-input{flex:1;min-width:0;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}",
      ".dsm-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}",
      ".dsm-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
      ".dsm-input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}",
      ".dsm-browse{flex:none;height:34px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:none;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer}",
      ".dsm-browse:hover:not(:disabled){background:var(--dsw-alias-bg-layer-4)}",
      ".dsm-browse:disabled{opacity:.5;cursor:default}",
      ".dsm-check{display:flex;align-items:center;gap:8px;height:34px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}",
      ".dsm-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
      ".dsm-invalid{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}",
      ".dsm-footer{display:flex;align-items:center;gap:8px;padding-top:16px}",
      ".dsm-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}",
      ".dsm-save{appearance:none;border:1px solid transparent;border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
      ".dsm-save:disabled{opacity:.4;cursor:default}",
      ".dsm-save:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}",
    ].join("");

    /** 简体中文是文案的键源。 */
    const zh = {
      nav: "记忆",
      heading: "记忆目录",
      summary: "Markdown 记忆目录：每轮注入索引，正文按需读取。",
      intro:
        "留空表示只用工作目录里的 .memory；改动写进 profile 的 cordis.patch.yml，立即生效。",
      directory: "全局记忆目录",
      directoryPlaceholder: "/Users/you/Documents/Obsidian/记忆",
      directoryHint: "绝对路径，或用 ~ 开头；目录里的 Markdown 由你自己维护，插件只读。",
      invalidDirectory: "请填绝对路径（或以 ~ 开头），或留空。",
      browse: "选择目录…",
      pickerFailed: "打不开目录选择器，请手动填写路径。",
      projectSources: "启用项目记忆（.memory）",
      projectSourcesHint: "从工作目录向上到 git 根，逐层发现 .memory 目录。",
      reminders: "启用关键词提醒",
      remindersHint: "frontmatter 的 keywords 命中时，提醒模型去读那篇记忆。",
      maxBytes: "每轮注入上限（字节）",
      maxBytesHint: "1024 到 16777216；超预算的整份来源会被排除并在状态栏提示。",
      invalidBytes: "请填 1024 到 16777216 之间的整数。",
      overridden: "已在设置里改写",
      reset: "恢复默认",
      readOnly: "这个 profile 的配置是只读的，改不动。",
      unavailable: "宿主没有提供这份配置（检查插件是否已挂载）。",
      loading: "正在读取配置…",
      save: "保存",
      saving: "保存中…",
      saveFailed: "保存失败：宿主拒绝了这次改动。",
    };
    const en = {
      nav: "Memory",
      heading: "Memory directory",
      summary: "Markdown memory directory: an index every turn, bodies on demand.",
      intro:
        "Leave empty to use only the .memory directories of your projects. Changes are written to the profile's cordis.patch.yml and apply immediately.",
      directory: "Global memory directory",
      directoryPlaceholder: "/Users/you/Documents/Obsidian/memory",
      directoryHint:
        "An absolute path, or one starting with ~. The Markdown in it is yours; the plugin only reads.",
      invalidDirectory: "Enter an absolute path (or one starting with ~), or leave it empty.",
      browse: "Choose directory…",
      pickerFailed: "The directory picker is unavailable; type the path instead.",
      projectSources: "Use project memories (.memory)",
      projectSourcesHint: "Walk from the working directory up to the git root, one .memory per level.",
      reminders: "Keyword reminders",
      remindersHint: "When a frontmatter keyword matches, remind the model to read that note.",
      maxBytes: "Injection budget per turn (bytes)",
      maxBytesHint: "1024 to 16777216. A source over budget is excluded and reported in the status line.",
      invalidBytes: "Enter an integer between 1024 and 16777216.",
      overridden: "Overridden in settings",
      reset: "Reset",
      readOnly: "This profile's configuration is read-only.",
      unavailable: "The host does not serve this configuration (is the plugin loaded?).",
      loading: "Reading configuration…",
      save: "Save",
      saving: "Saving…",
      saveFailed: "Save failed: the host rejected the change.",
    };

    /**
     * 表单控制器缺席时的兜底：只让卡片说「宿主没提供这份配置」，而不是抛异常把整个
     * 槽位炸成空白（宿主只会在控制台留一句 `slot entry crashed`）。
     */
    const EMPTY_FORM = {
      getSnapshot: () => ({ status: "unavailable" }),
      subscribe: () => () => {},
      set: () => Promise.resolve(false),
      unset: () => Promise.resolve(false),
      mutate: () => Promise.resolve(false),
    };

    /** 依赖 `ctx.store` 的快照订阅：ConfigForm 的快照引用稳定，可直接喂给 React。 */
    function useFormSnapshot(form) {
      const target = form ?? EMPTY_FORM;
      const subscribe = react.useCallback(
        (notify) => target.subscribe(notify),
        [target],
      );
      const snapshot = react.useCallback(() => target.getSnapshot(), [target]);
      return react.useSyncExternalStore(subscribe, snapshot, snapshot);
    }

    function isAbsoluteish(value) {
      return value === "" || value === "~" || value.startsWith("/") || value.startsWith("~/");
    }

    /**
     * 配置卡片：一套本地草稿 + 一次原子 mutate。只读、未就绪、不可写三种状态都显式
     * 说明，不给用户一个按不动的按钮。
     */
    function MemoryConfigCard(props) {
      const { t, pickDirectory } = props;
      const form = props.configForm ?? EMPTY_FORM;
      const state = useFormSnapshot(form);
      const [draft, setDraft] = react.useState(null);
      const [busy, setBusy] = react.useState(false);
      const [failed, setFailed] = react.useState(false);
      const [pickerFailed, setPickerFailed] = react.useState(false);

      const ready = state.status === "ready" && state.value !== undefined && state.value !== null;
      const editable = ready && state.writable === true;
      const base = ready ? state.value : undefined;

      const edit = (key, value) => {
        setDraft((prev) => ({ ...(prev === null ? {} : prev), [key]: value }));
        setFailed(false);
      };
      const valueOf = (key) => {
        const edited = draft === null ? undefined : draft[key];
        if (edited !== undefined) return edited;
        return base === undefined ? undefined : base[key];
      };
      const overridden = (key) =>
        state.user !== undefined && state.user !== null && state.user[key] !== undefined;

      // 只提交真正变化的字段：一次 mutate 的 ops 是原子的。
      const changed = [];
      if (draft !== null && base !== undefined) {
        for (const key of Object.keys(draft)) {
          const next = key === "maxContextBytes" ? normalizeBytes(draft[key]) : draft[key];
          const before = base[key];
          if (next === undefined) continue;
          if (next !== before) changed.push([key, next]);
        }
      }

      const directoryText = valueOf("directory");
      const directoryInvalid =
        typeof directoryText === "string" && !isAbsoluteish(directoryText.trim());
      const bytesText = valueOf("maxContextBytes");
      const bytesNumber = normalizeBytes(bytesText);
      const bytesInvalid = bytesNumber === undefined;
      const invalid = directoryInvalid || bytesInvalid;
      const dirty = changed.length > 0;

      const save = async () => {
        if (!editable || !dirty || invalid || busy) return;
        const ops = changed.map(([key, value]) => ({
          op: "set",
          path: [key],
          value: key === "directory" ? String(value).trim() : value,
        }));
        setBusy(true);
        setFailed(false);
        try {
          const accepted = await form.mutate(ops, state.revision);
          if (accepted === false) setFailed(true);
          else {
            setDraft(null);
            setPickerFailed(false);
          }
        } catch (error) {
          setFailed(true);
          report("save failed", error);
        } finally {
          setBusy(false);
        }
      };

      const resetField = async (key) => {
        if (!editable || busy) return;
        setBusy(true);
        setFailed(false);
        try {
          const accepted = await form.unset(key);
          if (accepted === false) setFailed(true);
          else setDraft(null);
        } catch (error) {
          setFailed(true);
          report("reset failed", error);
        } finally {
          setBusy(false);
        }
      };

      const browse = async () => {
        if (!editable || busy) return;
        setPickerFailed(false);
        if (typeof pickDirectory !== "function") {
          setPickerFailed(true);
          return;
        }
        try {
          const picked = await pickDirectory();
          if (typeof picked === "string" && picked !== "") edit("directory", picked);
        } catch (error) {
          setPickerFailed(true);
          report("directory picker failed", error);
        }
      };

      // 行摘要座位：`plugins.row.config` 的 `view: "summary"` 只要一行文本。
      if (props.view === "summary") return t("summary");

      const labelOf = (key, text) =>
        h(
          "div",
          { className: "dsm-head", key: `${key}-head` },
          h("span", { className: "dsm-label" }, text),
          overridden(key)
            ? h(
                "button",
                {
                  type: "button",
                  className: "dsm-reset",
                  disabled: busy || !editable,
                  onClick: () => resetField(key),
                },
                t("reset"),
              )
            : null,
        );

      const rows = [];
      rows.push(
        h(
          "div",
          { className: "dsm-field", key: "directory" },
          labelOf("directory", t("directory")),
          h(
            "div",
            { className: "dsm-control" },
            h("input", {
              className: "dsm-input",
              type: "text",
              value: typeof directoryText === "string" ? directoryText : "",
              placeholder: t("directoryPlaceholder"),
              spellCheck: false,
              autoComplete: "off",
              disabled: !editable || busy,
              "aria-invalid": directoryInvalid,
              onChange: (event) => edit("directory", event.target.value),
            }),
            h(
              "button",
              {
                type: "button",
                className: "dsm-browse",
                disabled: !editable || busy,
                onClick: browse,
              },
              t("browse"),
            ),
          ),
          h("p", { className: "dsm-hint" }, t("directoryHint")),
          directoryInvalid
            ? h("p", { className: "dsm-invalid" }, t("invalidDirectory"))
            : null,
          pickerFailed ? h("p", { className: "dsm-invalid" }, t("pickerFailed")) : null,
        ),
      );

      const checkbox = (key, text, hint) =>
        h(
          "div",
          { className: "dsm-field", key },
          h(
            "label",
            { className: "dsm-check" },
            h("input", {
              type: "checkbox",
              checked: valueOf(key) === true,
              disabled: !editable || busy,
              onChange: (event) => edit(key, event.target.checked),
            }),
            h("span", null, text),
          ),
          h("p", { className: "dsm-hint" }, hint),
        );
      rows.push(checkbox("projectSources", t("projectSources"), t("projectSourcesHint")));
      rows.push(checkbox("reminders", t("reminders"), t("remindersHint")));

      rows.push(
        h(
          "div",
          { className: "dsm-field", key: "maxContextBytes" },
          labelOf("maxContextBytes", t("maxBytes")),
          h(
            "div",
            { className: "dsm-control" },
            h("input", {
              className: "dsm-input",
              type: "text",
              inputMode: "numeric",
              value: bytesText === undefined ? "" : String(bytesText),
              disabled: !editable || busy,
              "aria-invalid": bytesInvalid,
              onChange: (event) => edit("maxContextBytes", event.target.value),
            }),
          ),
          h("p", { className: "dsm-hint" }, t("maxBytesHint")),
          bytesInvalid ? h("p", { className: "dsm-invalid" }, t("invalidBytes")) : null,
        ),
      );

      const notes = [];
      if (!ready) {
        notes.push(
          h(
            "p",
            { className: "dsm-note", key: "status" },
            state.status === "unavailable" ? t("unavailable") : t("loading"),
          ),
        );
      } else if (!editable) {
        notes.push(h("p", { className: "dsm-note", key: "readonly" }, t("readOnly")));
      }

      const children = [];
      if (props.view === undefined) {
        children.push(h("h3", { className: "dsm-heading", key: "heading" }, t("heading")));
      }
      children.push(h("p", { className: "dsm-intro", key: "intro" }, t("intro")));
      for (const note of notes) children.push(note);
      if (ready) {
        for (const row of rows) children.push(row);
        children.push(
          h(
            "div",
            { className: "dsm-footer", key: "footer" },
            failed ? h("p", { className: "dsm-failed" }, t("saveFailed")) : null,
            h(
              "button",
              {
                type: "button",
                className: "dsm-save",
                disabled: !editable || busy || !dirty || invalid,
                onClick: save,
              },
              busy ? t("saving") : t("save"),
            ),
          ),
        );
      }
      return h("div", { className: "dsm-form" }, children);
    }

    /** 空串与非法值都算「没有有效数字」，输入框留原样给用户改。 */
    function normalizeBytes(input) {
      if (typeof input === "number") {
        return Number.isSafeInteger(input) && input >= MIN_BYTES && input <= MAX_BYTES
          ? input
          : undefined;
      }
      if (typeof input !== "string") return undefined;
      const text = input.trim();
      if (!/^[0-9]+$/.test(text)) return undefined;
      const parsed = Number(text);
      return Number.isSafeInteger(parsed) && parsed >= MIN_BYTES && parsed <= MAX_BYTES
        ? parsed
        : undefined;
    }

    function report(what, error) {
      try {
        console.warn(`[dsh-simple-memory] ${what}`, error);
      } catch (_ignored) {
        /* 控制台不可用就算了。 */
      }
    }

    /** stylesheet 只挂一次；README 的「已知限制」里说明了它随插件加载常驻。 */
    function ensureStyle() {
      if (typeof document === "undefined") return;
      const tagId = `${PACKAGE_NAME}/client.css`;
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = PACKAGE_NAME;
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    const inject = ["slots", "locale"];

    function apply(ctx) {
      ensureStyle();
      const t = ctx.locale.bind(LOCALE_NS);
      ctx.effect(
        () => ctx.locale.register(LOCALE_NS, { zh, en }),
        "simple-memory: dictionaries",
      );

      // 目录选择器可能后到（或整个 profile 里没有），所以持续跟踪而不是硬依赖。
      let workspace;
      ctx.inject(["uiWorkspace"], (scope) => {
        workspace = scope.uiWorkspace;
        return () => {
          workspace = undefined;
        };
      });

      ctx.inject(["configForms"], (scope) => {
        const forms = scope.configForms;
        if (
          forms === undefined ||
          typeof forms.get !== "function" ||
          typeof forms.whileServed !== "function"
        ) {
          return;
        }
        const configForm = forms.get(ENTRY_ID);
        const face = () => ({
          t,
          configForm,
          pickDirectory: () =>
            workspace !== undefined && typeof workspace.pickDirectory === "function"
              ? workspace.pickDirectory()
              : undefined,
        });

        // 宿主只在真正服务了这个命名空间时才该出现卡片：不然用户会看到一张空表单。
        ctx.effect(
          () =>
            forms.whileServed([ENTRY_ID], () => {
              const offs = [
                ctx.slots.inject("plugins.bundle.config", () =>
                  ctx.slots.register(
                    {
                      name: "plugins.bundle.config",
                      key: PACKAGE_NAME,
                      inject: face,
                    },
                    MemoryConfigCard,
                  ),
                ),
                ctx.slots.inject("plugins.row.config", () =>
                  ctx.slots.register(
                    {
                      name: "plugins.row.config",
                      key: `${PACKAGE_NAME}#${ENTRY_ID}`,
                      inject: face,
                    },
                    MemoryConfigCard,
                  ),
                ),
                ctx.slots.inject("settings.plugins.tab", () =>
                  ctx.slots.register(
                    {
                      name: "settings.plugins.tab",
                      id: PACKAGE_NAME,
                      order: 60,
                      label: () => t("nav"),
                      locale: LOCALE_NS,
                      inject: face,
                    },
                    MemoryConfigCard,
                  ),
                ),
              ];
              return () => {
                for (const off of offs) {
                  if (typeof off === "function") off();
                }
              };
            }),
          "simple-memory: configuration pages",
        );
      });
    }

    exports.name = PACKAGE_NAME;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
