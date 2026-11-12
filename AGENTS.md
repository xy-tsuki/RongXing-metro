# 榕乘——福州地铁精细化导航：协作入口

适用于整个工作区。首次架构审查：2026-10-16（Asia/Tokyo），代码基线 `639309e`。这是已有 uni-app 工程，先理解当前实现，再开展授权范围内的工作。

## 开始工作前

1. 读 [当前状态](docs/STATUS.md)、[需求与版本范围](docs/PRD.md)、[架构与接口](docs/architecture.md)、[决策记录](docs/decisions.md)，再读本次任务涉及的专题文档。
2. 检查 `git status --short --branch`、相关 diff 和目标文件当前内容。共享工作区可能有其他对话正在编辑；未提交修改不代表可以覆盖，干净状态也不代表文件无人使用。
3. 只修改当前任务必要文件。不要 reset、clean、stash、批量格式化、自动升级依赖或替其他对话提交。发现相同文件并发编辑时先协调，不能整文件回写旧副本。
4. 本机 Git 可能因运行账号不同提示 dubious ownership；可对单条命令使用 `git -c safe.directory=E:/Documents/ChatGPT/地铁助手 ...`，不为此改全局配置。

## 文档位置与发布边界

- 本项目沿用等价文件：`docs/architecture.md` 承担 ARCHITECTURE，`docs/PRD.md` 承担 REQUIREMENTS。不要再建仅大小写不同的文件或第二套需求事实源；Windows 通常不区分大小写。
- `docs/STATUS.md` 记录实际状态、证据、风险、优先级和工作交接；`docs/decisions.md` 记录已确认决策与待确认提案，不能混写。
- **公开仓库（`xy-tsuki/RongXing-metro` 为 PUBLIC）。`.gitignore` 默认排除 Markdown、docs/、output/。** 2026-11-09 用户确认只把下面四个文件加入白名单：`AGENTS.md`、`CLAUDE.md`、`.github/pull_request_template.md`、`docs/devlog.md`。其余 Markdown 和 `docs/`（含 STATUS、decisions、PRD、architecture）仍只在当前工作区可见，不随 Git 克隆、worktree 或远端传播；Git 状态干净不能证明它们已备份。
- 公开文件里不写服务器地址、内网 IP、SSH、凭据、部署细节；这些只写在私有文档。新增公开范围须先经用户确认，不用强制添加（`git add -f`）绕过白名单，不推送。上面链接到的私有文档在公开克隆里不存在，属预期。
- 使用仓库与本轮明确需求维护知识，不依赖聊天历史。旧报告中的测试数量、UI 描述和运行环境须带日期与基线；新代码行为有冲突时先记录差异，不能将其自动认定为用户已批准的新需求。

## 产品约束

- 保留现有 uni-app + Vue 3 + TypeScript + Vite，兼顾 H5 与微信小程序，移动优先。
- V1：起终站、换乘路线、逐段车厢/车门和换乘说明；最近路线、少走楼梯、仅限电梯。真实数据不足时明确降级，不能宣称 V1 真实精细导航已完成。
- V2：可选起终点出入口。V3：时刻表、具体车次、预计上下车时间、列车位置推算。均为计划范围，当前接口没有实现。
- 长期用户共创以作品展示和低成本运营为目标。当前个人维护不等于公共投稿、审核或同步后台。
- “最近路线”指已建模通路内的步行目标，不是实时最快到达；搜索有预算，不承诺不受限全局最优。

## 模块责任

| 范围 | 责任与边界 |
| --- | --- |
| `src/pages`、`src/components`、`src/App.vue` | 页面与结果投影；不私设推荐值、不在 UI 改写核心规划语义；优先 uni 跨端 API |
| `src/core` | 平台无关类型、运行时校验、候选搜索、站内寻路和组合优化；不依赖 Vue、DOM、存储或网络 |
| `src/data` | 随包真实/合成数据、加载及 uni 本机存储适配；不提供云数据库或自动同步 |
| `src/maintenance`、`scripts`、`data-entry` | 采集、来源、验证、补丁和导入导出；工作簿、单站 CSV、标准七表 CSV 是不同格式 |
| 架构/项目管理对话 | 维护范围、接口、决策、影响分析和状态；未经明确要求不接管日常 UI、算法或数据录入实现 |
| 部署工作 | 依赖现有双端构建；托管、AppID、微信工具/真机和正式发布分别验收，不从构建成功推导上线 |

## 不得破坏的数据语义

- `types.ts` 和 `validation.ts` 是当前运行时契约；`metro.schema.json` 是编辑辅助，不能替代引用与语义校验。
- 保持真实与合成数据隔离。真实缺失资料不套用演示设施；不按站名合并三叉街两站或水部/闽都。
- 未知测量保持 `null` 或相应未知状态；不填默认门位、0 米、虚构分钟。来源类型、日期、方向、门位编号确认必须保留。
- “福州电梯全覆盖”来自旧文档记录的用户前提，非本轮现场核实；有电梯不能证明已采集连续轮椅通路。电梯模式排除楼梯、扶梯与未确认轮椅边。
- 一次单站补录保持 partial；人工推荐只作对照。每段推荐车门只由该段终点（换乘站或目的站）的设施决定，各段互相独立，不做跨段配套；换乘路径只记「下车门 → 下一程站台」，不含候车门，到站台后在哪个门候车由下一程自己的推荐决定（2026-11-10 用户确认，2026-11-12 实现）。
- 本机保存的是完整个人数据副本，键按城市和基础版本隔离；没有自动迁移。涉及版本、ID、存储键或补丁格式的修改须评估旧数据兼容和备份。
- `network:generate` 会重写真实初始快照；`data:generate` 会重写合成 JSON/CSV。不要把生成器作为常规检查运行，也不要覆盖已采集资料。`output/tools` 是本机工具，不是已纳入版本控制的部署或维护流水线。

## 变更与验收

重大变更（换栈、引入云数据库/账户、改变目标排序或无障碍规则、破坏性协议/存储变更、公开范围及部署方式变化）先给出影响模块、兼容/迁移方案、替代方案、成本、验收和回滚措施，取得用户确认后实施。普通授权范围内的文档更新与检查可直接执行。

按影响选择验证，记录命令、日期、基线、结果和未验证项：核心/数据变更运行测试、类型检查及相应数据校验；跨端页面/配置变更补双端构建与相关交互；纯文档检查链接、事实一致性与业务文件未改变即可，不为文档增加镜像测试。

```powershell
npm test
npm run typecheck
npm run data:validate
npm run data:validate -- src/data/demo-network.json
npm run network:check
npm run build:h5
npm run build:mp-weixin
```

`network:check` 目前断言初始真实包没有站内资料；以后将真实采集资料纳入基础包前，须先调整该检查的职责，不能为让检查通过而清空资料。

完成任务后更新 STATUS；跨模块变更同步架构/需求/决策。状态只用有证据的“已实现”“正在开发”“计划中”，注明“仅合成测试”“构建通过”“工具/真机未验收”“现场未核实”。没有可核实执行者或工作证据时，不擅自标为正在开发。

## 项目是什么

榕乘（仓库名 RongXing-metro）：面向福州地铁乘客的精细化导航。在换乘路线之外，给出每段推荐乘坐的车厢/车门和换乘说明，支持最近路线、少走楼梯、仅限电梯三种模式。真实站内数据仍在采集，默认福州数据包只有线网，精细导航目前靠合成数据演示。

## 技术栈

- uni-app 3 + Vue 3.4 + TypeScript + Vite，一套代码出 H5 和微信小程序（`@dcloudio/uni-h5`、`uni-mp-weixin`）。
- 测试：Vitest（TypeScript）和 Python `unittest`（`tests/test_*.py`，覆盖部署边界与时刻表研究脚本）。
- 数据：随包 JSON；维护工作簿 `data-entry/*.xlsx`；时刻表研究另有 Python 脚本。
- 运行环境：本机 Node 18.17.1 / npm 9.6.7 / Python 3.11 能跑通下面的命令；CI（`.github/workflows/ci.yml`）使用 Node 24。

## 目录结构

- `src/core/`：平台无关的类型、校验、候选路线搜索、站内寻路、票价和已确认门位（`types.ts`、`validation.ts`、`planner.ts`、`fare*.ts`、`approved-positions.ts`）。
- `src/data/`：随包线网（`fuzhou-network.json`）、合成数据（`demo-*`）、票价与站间距、本机存储（`local-store.ts`）、发布包读取与缓存（`published*.ts`、`data-sync.ts`）。
- `src/navigation/`：路线页的时间、站台板、发车选择、票价展示等纯逻辑，供页面共用。
- `src/pages/`、`src/components/`、`src/App.vue`：页面与组件（`index`、`journey`、`routes`、`timetable`、`maintenance`）；`src/pages.json`、`src/manifest.json` 为 uni 路由与应用配置。
- `src/maintenance/`：数据采集与审核用的表单、校验、补丁与接口封装。
- `scripts/`：数据校验/导入导出/生成（`data-*.ts`）、线网检查、票价生成、维护服务与预览启动器，以及 `deployment/`、`maintenance/`、`timetable_research/` 子目录。
- `tests/`：Vitest 与 Python 测试。
- `data-entry/`：可编辑的车站维护工作簿与合成示例。
- 私有（不进 Git）：`docs/`（除 `devlog.md`）、`output/`、`dist/`、`.npm-cache/`；本机专用的 `scripts/timetable_research/`（时刻表重建研究）、`scripts/deployment/`（含服务器地址）及导入它们的 Python 测试。

## 常用命令

2026-11-09 在 dev 分支（基线 `639309e` 加其他对话的未提交改动）实际运行：

- 开发运行：`npm run dev:h5`、`npm run dev:mp-weixin`（本次未运行）。
- 构建：`npm run build:h5`、`npm run build:mp-weixin`（本次未运行；产物写入被忽略的 `dist/`）。
- 类型检查：`npm run typecheck`（通过）。
- 测试：`npm test`（Vitest）。2026-11-12 连续三次完整运行均为 303 通过、0 失败、14 跳过（SQLite 测试在本机 Node 18 下跳过，CI 的 Node 24 不允许跳过）；同日逐段车门改动后完整运行为 304 通过、0 失败、14 跳过。集成测试较慢，单个用例超时在 `vitest.config.ts` 设为 20 秒。Python 测试（`tests/test_*.py`）依赖本机的部署脚本和时刻表研究脚本，已加入忽略、只在本机运行，CI 不跑。
- 数据校验：`npm run data:validate`（通过）；`npm run data:validate -- src/data/demo-network.json`；`npm run network:check`（通过）；`npm run fare:check`（通过）。
- 会改写数据的命令，不作为常规检查：`network:generate`、`data:generate`、`fare:generate`、`data:import`、`station:import`。
- 维护服务：`npm run maintenance:serve`、`maintenance:test`、`timetable:import`（依赖本机私有环境，细节见私有文档）。
- 服务地址：不写进公开源码。在项目根目录建 `.env.local`（已忽略），写 `VITE_PUBLIC_API_ORIGIN=<服务来源地址>`；微信小程序构建用它发请求，`dev:h5` 用它代理 `/api/`。未配置时小程序不联网、使用随包数据，H5 本机预览不代理 `/api/`。可选 `VITE_MAINTENANCE_API` 强制所有平台使用指定的维护接口地址。

## 架构要点

- 规划流程：线网数据 → `src/core` 候选路线搜索 → 按模式在站内寻路、逐段独立推荐车门 → `src/navigation` 加时间、票价 → 页面只做展示。核心不依赖 Vue、存储、网络。
- 真实与合成数据分开：真实线网不带站内设施；演示设施只在合成数据里，不得混用。
- 用户补录存在本机存储，按城市和基础版本隔离，没有自动迁移；发布包由 `src/data/published*.ts`、`data-sync.ts` 拉取并缓存（具体校验与更新规则待逐项确认）。
- `src/navigation/session.ts` 是页面共用的会话：汇总随包数据、本机个人副本和发布包，调用 `planJourney`，并保存查询、所选方案和展开状态，页面切换时保持。

## 已知问题

- 会话、发布包等集成测试要在真实线网上连续做多次完整规划，单个用例 4–7 秒；2026-11-12 已把用例超时从默认 5 秒放宽到 20 秒。若再出现超时，先查是否有用例变慢，不要直接继续加大超时。
- `.gitattributes` 固定文本文件为 LF（2026-11-12），新检出不再受本机 `core.autocrlf=true` 影响；`tests/fare-presentation.test.ts` 会校验 `src/data/fuzhou-fares.json` 的原始字节哈希，不要用会改换行的工具保存它。
- 2026-11-09 已把 Codex 时期积压的未提交改动按功能分组提交到 `dev`；归属依据 Codex 导出记录，见 `docs/devlog.md`。提交时仍按文件 `git add`，不要整体添加。
- 微信开发者工具与真机未验收；真实站内数据尚未采集，V1 精细导航不能宣称完成。
- 私有文档（STATUS、decisions、PRD、architecture）不在公开仓库里，克隆者看不到。

## Git 与分支

- 全局约定为在 `dev` 分支开发、`main` 只通过 PR 更新。`dev` 于 2026-11-09 从 `639309e` 建立；同目录其他对话可能仍在 `main` 上工作，切换分支前先看 `git status`。
- 项目约束优先于全局约定：不替其他对话提交、不 `git add -A`、不 stash/reset/clean、不强制添加被忽略的文件、不推送，除非用户明确要求。
