<div align="center">

# Folia 落雪对接版

用 Folia 的全屏歌词动画，配洛雪音乐增强版的播放 · 非官方分支

简体中文 | [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/xinzhihong-ship-it/folia-major?label=release)](https://github.com/xinzhihong-ship-it/folia-major/releases)
[![License](https://img.shields.io/github/license/xinzhihong-ship-it/folia-major)](LICENSE)

</div>

> [!IMPORTANT]
> - 这是 [Folia](https://github.com/chthollyphile/folia-major)（作者 chthollyphile）的**非官方分支**，与官方项目及其作者没有关系，也没有得到官方认可。这个版本的问题请在 [本仓库的 Issues](https://github.com/xinzhihong-ship-it/folia-major/issues) 反馈，不要去找官方。
> - **这个版本只是给喜欢 Folia 炫酷歌词的人用的。** 歌由 [洛雪音乐增强版](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced) 播放，不是 Folia 自己播放。不用洛雪音乐的话，请直接用 [官方 Folia](https://github.com/chthollyphile/folia-major/releases)。
> - Folia 和洛雪音乐增强版自身都不提供任何音频、歌词或封面。能播什么，取决于你在洛雪音乐里用的来源和你自己的账号。请只使用你有权访问的内容。

## 这是什么

官方 Folia 是一个以全屏沉浸式歌词动画为核心的音乐播放器。这个分支在官方 Folia 上加了一个「洛雪」平台，两个软件分工：

- **Folia**：显示歌词动画，以及搜歌、浏览列表、控制播放。
- **洛雪音乐增强版**：真正出声。音源、音质、播放引擎（MPV、内置）、输出设备、VST3 插件都按洛雪的设置走。

官方 Folia 自带的其他功能（本地音乐、Navidrome、其他在线平台、各种歌词样式、模组系统等）原样保留，用法见 [官方仓库](https://github.com/chthollyphile/folia-major) 和它的使用指南。

## 加了什么

- **搜歌、搜歌单**：用洛雪的搜索，可以搜全部平台，也可以只搜一个。歌单按关键词各平台一起搜，名字下面写着来自哪个平台。
- **洛雪的列表**：试听列表、我的收藏、自建列表在 Folia 的「歌单」里；洛雪「平台音乐」里你自己账号的每日推荐和歌单接在后面，只能看和播放。
- **打开分享的歌单**：在命令面板选「打开分享的歌单」，或者把链接直接贴进搜索框。可以播放全部，也可以收藏到洛雪。
- **两边同步**：播放暂停、拖动、上一首下一首、音量、播放模式、随机、音质都两边同步。在洛雪里切歌，Folia 跟着换歌和歌词；在洛雪里开始放歌，Folia 接过来显示（设置里的「外部播放器开播时跟随」可以关）。
- **队列**：Folia 的队列就是洛雪正在播放的列表，稍后播放的歌排在当前这首后面。
- **音质**：连着洛雪时，音质选择列出洛雪自己的全部音质档，和洛雪的设置随时一致；不影响 Folia 给其他平台用的音质。
- **舞台模式**：修了经 Stage API 推送的歌词原文大字不显示、不随进度走的问题。

## 下载与使用

1. 安装 [洛雪音乐增强版](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases) 3.4.0 起，确认「设置 → 开放 API → Folia 对接」已开启（默认开启）。
2. 到 [Releases](https://github.com/xinzhihong-ship-it/folia-major/releases) 下载本版本：Windows x64 安装包，或 macOS Apple 芯片的 dmg / zip。每一版需要的洛雪版本写在它的发布说明里。
3. 在 Folia 的平台里选「洛雪」，点「连接」。两边谁先打开都可以，洛雪重开后 Folia 会自动重连。

说明：

- 安装后会覆盖官方 Folia（应用名和数据目录相同），原有设置和登录保留。想换回官方版，安装官方安装包覆盖即可。
- 应用内检查更新看的是本仓库的发布页，不会被官方版本覆盖回去。
- 版本号是官方版本加 `-lx.N`，如 `0.7.29-lx.1`。模组的 Folia 版本要求按官方版本判断。
- 安装包没有签名。macOS 打开时如果提示「已损坏」，在终端执行 `xattr -dr com.apple.quarantine /Applications/Folia.app`。
- 两边只在本机（127.0.0.1）通信，Folia 凭洛雪每次启动随机生成的令牌访问。

## 与官方 Folia 的关系

- 官方项目：[chthollyphile/folia-major](https://github.com/chthollyphile/folia-major)。本仓库在它的代码上修改，原始代码的版权归官方作者和贡献者所有。
- 「Folia」的名称、图标和视觉设计属于官方作者。本分支沿用它们只是为了说明代码的来源，并和官方版保持安装兼容；如果官方作者认为不妥，请在 Issues 联系，我们会更改。
- 官方的 Discord、网盘、一键部署、模组市场和使用指南都属于官方，这个分支的问题请不要去那里问。
- 本仓库的 `main` 分支和官方 `main` 保持一致，我们的改动都在默认分支 `lx` 上。相对官方改了哪些文件、怎么跟进官方更新，见 [docs/lx-fork.md](docs/lx-fork.md)。

## 商标与版权声明

- 文中和软件里提到的音乐平台、流媒体服务和软件的名称与商标，归各自所有者所有，只用来说明兼容性。本项目与它们没有任何合作、从属或认可关系。
- 歌曲、歌词、专辑封面等内容的版权归各自权利人。本项目不提供这些内容，也不鼓励任何侵犯版权的用法。请尊重版权，在条件允许时通过官方平台支持正版音乐。
- 如果你是权利人，认为本仓库的内容侵犯了你的权益，请在 [Issues](https://github.com/xinzhihong-ship-it/folia-major/issues) 联系，我们核实后会尽快处理。

## 法律与免责声明

- 官方 Folia 在 AI 的广泛协助下开发；本分支新增和修改的代码全部由 AI 编程助手完成。因此仍可能存在细微或不易察觉的问题，若给你带来不便，敬请理解。
- 本项目主要用于展示歌词动效、界面设计与相关工程实现。
- 本仓库及其源代码仅供个人学习、技术交流与非营利测试使用，请勿用于商业盈利用途。若因对在线资源的传播、加工或再分发而引发版权纠纷或其他责任，均由使用者自行承担，项目开发者不承担相关责任。

## 许可证

本项目沿用官方的 [AGPL-3.0](LICENSE) 许可证。本分支的完整源代码就在本仓库，相对官方的修改见 [docs/lx-fork.md](docs/lx-fork.md)。

## 致谢

- 感谢 [chthollyphile](https://github.com/chthollyphile) 和 Folia 的全部贡献者（[贡献者名单](CONTRIBUTORS.md)）。官方 Folia 用到和致谢的开源项目，见 [官方 README](https://github.com/chthollyphile/folia-major#致谢)。
- 感谢 [lyswhut](https://github.com/lyswhut) 开发并开源 [LX Music](https://github.com/lyswhut/lx-music-desktop)。
