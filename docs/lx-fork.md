# 落雪对接版：跟随官方 Folia 更新与发版

这份文档写给维护「Folia 落雪对接版」的人（以及帮忙的 AI）。它说明三件事：这个分支相对官方改了哪些地方，官方 Folia 出新版本后怎么跟进，以及 Folia 和洛雪两边怎么发版。

## 这个分支是什么

- **仓库与分支**：
  - 本仓库 `xinzhihong-ship-it/folia-major` 的 `lx` 分支，是默认分支。手动发版的工作流必须在默认分支上，GitHub 才让手动运行。
  - `main` 分支保持和官方 `chthollyphile/folia-major` 的 `main` 一样，不放我们的改动。
  - `upstream` 远程指向官方仓库。
- **分出来的位置**：官方 `main` 的提交 `1f73b51`（0.7.28 之后、0.7.29 之前）。之后跟进过：
  - 2026-11-18 合入官方 `v0.7.29`，没有冲突，发 `0.7.29-lx.1`。
  - 最新的共同祖先用 `git merge-base lx upstream/main` 查。
- **定位**：
  - 给喜欢 Folia 炫酷歌词的人用。歌由洛雪音乐增强版（`xinzhihong-ship-it/lx-music-desktop-enhanced`）播放，不是 Folia 自己播放。
  - Folia 负责歌词动画、搜歌、浏览列表、控制播放。
  - 发布说明开头要写清楚这两点。
- **版本号**：
  - 官方版本加 `-lx.N`，如 `0.7.28-lx.3`。官方出 0.7.29 后，我们的从 `0.7.29-lx.1` 重新数。
  - 发版工作流只认这种格式。
  - 这种版本号走正式更新通道（`electron/updateChannels.cjs` 判成 realeco），应用内检查更新读本仓库发布页上标成 Latest 的那一版。
  - 模组的 Folia 版本要求去掉 `-lx.N` 再判断（`electron/modSystem/manifest.cjs` 的 `hostRangeVersion`）。

## 相对官方改了哪些地方

随时可以这样列出全部改动：

```bash
git fetch upstream
git diff --name-status $(git merge-base lx upstream/main) lx
```

### 只属于我们的文件

官方不会碰这些文件，合并时不会冲突：

- `src/services/onlineMusic/lxmusic/`：洛雪平台本身，包括搜索、列表、播放、歌词、封面和失败说明。
- `electron/lxmusic/lxmusicApiBridge.cjs`：主进程里读洛雪的连接文件，带令牌请求洛雪的本机接口，转发它推来的事件。
- `src/services/onlineMusic/playerQualityChoices.ts`：播放器自己的音质档，音质选择用它。
- 播放相关的新文件：
  - `src/components/app/playback/bridges/externalPlayerFollow.ts`
  - `src/components/app/playback/leadingPlayerQueue.ts`
  - `src/components/app/playback/start/nextTrackStep.ts`
  - `src/components/app/playback/useLeadingPlayerShuffle.ts`
- 搜索与界面的新文件：
  - `src/components/app/search/useSearchScopes.ts`
  - `src/components/command-palette/commands/sharedListCommand.ts`
  - `src/components/hifi/useExternalPlayerSignal.ts`
- 发版用的文件：`.github/workflows/lx-release.yml`（手动发版）、`.github/lx-release-notes.md`（发布说明）、本文档。
- 测试：`test/unit/lxmusic/`，以及下面这些：
  - `test/unit/electron/lxmusicApiBridge.test.ts`
  - `test/unit/onlineMusic/externalLeadingPlayback.test.ts`、`test/unit/onlineMusic/playerQualityChoices.test.ts`
  - `test/unit/playback/` 下的 `externalPlayerFollow`、`leadingPlayerQueue`、`nextTrackStep` 三个测试

### 改了官方文件的地方

这些合并时可能冲突，合完要逐个核对：

| 文件 | 我们改了什么 |
|---|---|
| `README.md`、`README.en.md` | 整个换成本分支自己的说明（中英两份）。合并冲突时保留我们的（`git checkout --ours README.md README.en.md`），再看官方 README 有没有新内容值得在我们的里提一句 |
| `package.json` | `build.publish.owner` 改成 `xinzhihong-ship-it`。版本号保持官方的，不写 `-lx.N`，由发版工作流打包时填 |
| `electron/main.cjs` | `FOLIA_RELEASES_URL` 和自动更新的 `owner` 指向本仓库；创建洛雪桥（`createLxmusicApiBridge`）、`lxmusic-api-request` 这个 IPC、退出时 `lxmusicApiBridge.close()` |
| `electron/preload.cjs` | 暴露洛雪桥的请求和事件 |
| `electron/modSystem/manifest.cjs` | `hostRangeVersion`：模组版本范围按去掉 `-lx.N` 的版本判断 |
| `src/services/onlineMusic/providerRegistry.ts` | 登记 `lxmusic` 平台 |
| `src/types/onlineMusic.ts`、`omni.ts` | 外部播放的「播放器主导」（`leadsPlayback`）一组能力。外部播放能力是 `follow`、`skip`、`getQueue`、`queueInPlayer`、`watchPlayer`、`setLoopMode`、`setQuality`、`setShuffle`、`qualityChoices`；另有搜索范围（`getScopes`）和打开分享歌单 |
| `src/services/onlineMusic/externalPlayback.ts`、`externalClock.ts` | 主导播放：跟随播放器换歌、音量和播放模式双向同步、播放器的音质与随机状态、倍速 |
| `src/components/app/playback/...` | 队列控制器（`usePlaybackQueueController.ts`）、`useExternalPlaybackBridge.ts`（跟随播放器）；`usePlaybackVisualizerBridge.ts` 修了舞台歌词不前进 |
| `src/App.tsx` | 给 `useExternalPlaybackBridge` 多传一个 `playSong` |
| 搜索 | `SearchTabs.tsx`、`SearchWorkspace.tsx`、`search.css`、`useSearchNavigationStore.ts`：单曲搜索可以只搜一个平台 |
| 命令面板与设置 | `navigationCommands.ts`、`settingsCommands.ts`、`types.ts`、`buildSettingsCommandContext.ts`、`PlaybackPage.tsx`（「外部播放器开播时跟随」） |
| 播放器界面 | `playerControlSlotActions.ts`、`useAppOverlaysModel.ts`、`LatticePlaybackProvider.tsx`（随机按钮亮起）、`AccountTab.tsx`（音质选择列洛雪的档）、`PlaybackSignalPathButton.tsx`、`createQueueMutations.ts` |
| `src/stores/useAudioSettingsStore.ts` | 新设置「外部播放器开播时跟随」 |
| 四份语言文件 `src/i18n/locales/` | 新文案（en、zh-CN、in、vi） |
| `dev/dedicatus/` 的 `ipcChannels.mjs`、`registeredSites.mjs`、`storageKeys.mjs` | 登记新 IPC、新站点和新存储键 |
| `src/services/onlineMusic/README.md`、`UPSTREAMS.md` | 洛雪平台和主导播放的说明 |
| 测试 | `platformNamePlaces.ts`、`platformNameCount.ts`（平台目录外提到平台名的计数），还有命令面板、存储键的快照（`.snap`）等 |

## 官方出新版本后怎么跟进

### 1. 同步 `main`，看官方改了什么

**合官方的发版标签（如 `v0.7.29`），不合 `upstream/main` 的最新提交。** 官方 `main` 上常有还没发版的改动（测试通道 Limo/Cielo 用），我们的版本号跟官方正式版走，内容也该和它一致。官方正式版看 [官方发布页](https://github.com/chthollyphile/folia-major/releases) 上标成 Latest、名字是「Realeco vX.Y.Z」的那个。

```bash
git fetch upstream --tags
git checkout main
git merge --ff-only upstream/main
git push origin main

git checkout lx
TAG=v0.7.29                                   # 官方最新正式版
git log --oneline lx..$TAG                    # 官方新提交
git diff --stat $(git merge-base lx $TAG) $TAG   # 官方改了哪些文件
gh release view $TAG --repo chthollyphile/folia-major   # 官方这一版的说明
```

重点看几件事：

- 官方有没有碰上面「改了官方文件的地方」那张表里的文件。
- 官方的版本号，也就是 `package.json` 的 `version`。
- 官方有没有自己修好舞台歌词不前进的问题。修好了就用官方的修法，删掉我们的。

### 2. 在新分支上合并

用 merge，不用 rebase：`lx` 已经发过版，不改它的历史。

```bash
git checkout -b sync/upstream-0.7.29 lx      # 版本号按官方的写
git merge $TAG
```

解决冲突的原则：先保留官方的改动，再把我们那几行补回去。

- **`package.json`**：版本号用官方的；`build.publish.owner` 保持 `xinzhihong-ship-it`。
- **`electron/main.cjs`**：更新地址和 `owner` 保持指向本仓库，洛雪桥那几处保留。
- **外部播放的接口**（`types/onlineMusic.ts`、`omni.ts`、`externalPlayback.ts`）：官方改了，就照官方的新写法改我们的「播放器主导」、随机、音质档那几块，不要把官方的改动退回去。
- **快照测试（`.snap`）冲突**：先取官方的，再跑 `npx vitest run -u <那个测试文件>` 重新生成，核对差异只多出我们的命令和存储键。
- **`platformNamePlaces.ts` / `platformNameCount.ts`**：跑 `test/unit/onlineMusic/omniArchitecture.test.ts`，按它报的计数改。
- **语言文件**：官方新加的词条照收；我们的词条，四份文件都要在。

### 3. 自检

按 `AGENTS.md` 的要求：

```bash
npm ci
npm run typecheck
npm run dedicatus
npm run lint:install   # 第一次
npm run lint
npm run test:unit
```

单测有失败时，先在 `upstream/main` 上跑同一条，看是不是官方本来就失败。比如 `test/unit/mod-system/modSignature.test.ts` 跟我们的改动无关，2026-11 时就失败；`test/unit/visualizer/fumeLineFit.test.ts` 在全量跑、机器忙时偶尔超时，单独跑能过。

### 4. 在真机上过一遍

开着洛雪增强版，用 `skills/run-desktop` 的驱动或者 `npm run dev:electron` 起 Folia，至少过一遍：

- 在平台里选「洛雪」，点「连接」。
- 搜歌并播放，从洛雪的列表和分享歌单起播。
- 在洛雪里切歌，Folia 应该跟着换歌和歌词。
- 随机按钮、音质选择、音量都能两边同步。
- 舞台模式的歌词正常。

### 5. 合回 `lx` 并发测试版

```bash
git checkout lx
git merge --ff-only sync/upstream-0.7.29
git push origin lx
```

然后改 `.github/lx-release-notes.md`：版本号、需要的洛雪版本、这次的变化。开头那段定位说明（只是给喜欢炫酷歌词的人用、歌由洛雪播放）要保留。

发布说明末尾的 `## English` 一段也要跟着改：版本号、需要的洛雪版本、这次的变化写一两句。

写「这次的变化」时，按 `git log --oneline <上一次合入的官方提交>..$TAG` 列，不要照抄官方说明：官方说明是相对官方上一版写的，我们上一次合入的位置可能已经带了其中一部分（0.7.29 就是这样，随机播放、搜索历史等在 0.7.28-lx.3 里已经有了）。

## 发版

### Folia 落雪对接版

1. 在 GitHub Actions 里运行「Publish LX fork build」（`lx-release.yml`），填 `version`，如 `0.7.29-lx.1`：
   - 测试版勾上 `prerelease`。应用内检查更新看不到它，要在发布页手动下载。
   - 命令行这样运行：`gh workflow run lx-release.yml --repo xinzhihong-ship-it/folia-major --ref lx -f version=0.7.29-lx.1 -f prerelease=true`。
2. 工作流打 Windows x64 安装包和 macOS arm64 的 dmg、zip，不签名，发到本仓库的 Releases，说明取自 `.github/lx-release-notes.md`。
   - 同一个版本号再运行一次，只会重新上传文件、更新说明，不会改它是不是测试版。
3. 测试版测好了转正式版，不用重新打包：

   ```bash
   gh release edit v0.7.29-lx.1 --repo xinzhihong-ship-it/folia-major --prerelease=false --latest --notes-file .github/lx-release-notes.md
   ```

   标成 Latest 之后，已经装了落雪对接版的人在应用内检查更新就能看到。
4. 先确认它需要的洛雪版本已经发布，再转正式版，说明里也要写上需要哪个版本。

### 洛雪音乐增强版

洛雪在另一个仓库 `lx-music-desktop-enhanced`：

- **测试版**：在 `beta` 分支改好、改 `package.json` 的版本号（如 `3.4.1-beta.1`）和 `RELEASE_NOTES.md`，推到 `beta`。「Build Beta」打包并发成 Pre-release；版本号不带 beta / alpha / rc 的，它只打包不发布。
- **正式版**：
  1. 在 `beta` 上提交 `release: x.y.z`，把版本号改成正式的，`RELEASE_NOTES.md` 写正式版说明。
  2. 把 `beta` 用 `--no-ff` 合进 `main`，提交信息写 `merge: x.y.z 正式版（…）`。
  3. 推 `main`。「Build main」打包并发成正式版，所有洛雪增强版的用户会收到应用内更新。
- 本地仓库的 `git fetch origin` 只跟踪 `main`。要看 `beta` 的最新状态，用 `git fetch origin beta` 或者 `git ls-remote origin`。
- Linux 的 ARM 交叉编译任务固定在 `ubuntu-24.04`：`ubuntu-latest` 换成 26.04 后，`qemu-user-static` 没了，交叉工具链装不上。

## 简介和说明怎么写

README、发布说明、GitHub 仓库的 About，以及洛雪那边的同类文字，都按这几条写，免得惹上侵权或冒充官方的麻烦：

- **开头就写明是非官方分支**，与官方 Folia、LX Music 原作者无关，问题到本仓库反馈。不要用官方的横幅、Trendshift 徽章、Discord、网盘、一键部署、贡献者徽章这类东西，免得看起来像官方仓库。
- **简介里不点名具体的音乐平台和视频网站**，写「在线平台」「受支持的视频网站」；举例时写「某平台 · 我喜欢」。软件界面里的名字不受这条限制。
- **不放带真实歌词、歌曲封面的截图或视频**，那是别人的版权。
- 不写接口加解密、绕过限制之类的实现细节；高音质只说「取决于平台、地区、版权和你所用的来源」。别人的商标（如 Dolby Atmos）换成通用说法（多声道）。
- 保留「不提供任何音频、歌词或封面，只使用你有权访问的内容」和「商标与版权声明」两段，以及权利人联系方式（Issues）。
- 致谢和许可证说明不能删：它们是开源许可的要求。
- 中文和英文一起改，内容要对得上；界面上的名字照语言文件里的写（英文看 `src/i18n/locales/en.ts`）。
- GitHub 仓库的 About 用 `gh repo edit xinzhihong-ship-it/folia-major --description ...` 改。这个仓库里 `gh` 默认指向官方仓库，命令里一定写上 `--repo` 或完整的仓库名。

## 两边的接口约定

- 洛雪开着「设置 → 开放 API → Folia 对接」时，在系统应用数据目录的 `lx-music-folia-link/connection.json` 里写端口和令牌。接口只监听 `127.0.0.1`。
- 接口有三个：`GET /status`、`POST /rpc`（`{ op, params }`）、`GET /events`（SSE，推状态和列表变化）。
- 加一个操作，下面四处都要改：
  1. 洛雪 `src/main/modules/foliaLink/ops.ts`：`RENDERER_OPS` 或 `MAIN_OPS`，加上参数校验 `checkParams`。
  2. 洛雪 `src/main/modules/foliaLink/index.ts` 的 `RPC_TIMEOUTS`；渲染进程的操作写在 `src/renderer/core/useApp/useFoliaLink/handlers.ts`。
  3. Folia `electron/lxmusic/lxmusicApiBridge.cjs`：`RPC_OPERATIONS`；`TIMEOUTS` 要比洛雪那边多 5 秒。
  4. Folia `src/services/onlineMusic/lxmusic/` 里调用它的地方，以及测试。
- 新操作需要新版洛雪时，发布说明里写清楚 Folia 这一版需要哪个版本的洛雪。
- 洛雪的状态字段变了，要跟着改 `lxmusicPlayback.ts` 的 `lxExternalStatusOf`。

## 已知的坑

- 平台名（酷狗、QQ 等）不要写进 `src/services/onlineMusic/lxmusic/` 等平台目录外文件的注释里，`omniArchitecture.test.ts` 会按平台名计数报错。
- 新文件用 LF 换行。Windows 上用脚本写文件时要注意，`npm run lint` 会报 D432。
- 洛雪在没有 Windows SDK 的 Windows 机器上编不了原生模块，但 `npm run build:main`、`npm run build:renderer` 能打出 `dist/`。可以照 `scripts/preview-ui.cjs` 用一次性的 profile 起界面截图，查界面问题。
