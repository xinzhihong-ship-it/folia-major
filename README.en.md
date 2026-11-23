<div align="center">

# Folia · LX Edition

Folia's full-screen lyric animations, with playback by LX Music Enhanced · an unofficial fork

[简体中文](README.md) | English

[![Release](https://img.shields.io/github/v/release/xinzhihong-ship-it/folia-major?label=release)](https://github.com/xinzhihong-ship-it/folia-major/releases)
[![License](https://img.shields.io/github/license/xinzhihong-ship-it/folia-major)](LICENSE)

</div>

> [!IMPORTANT]
> - This is an **unofficial fork** of [Folia](https://github.com/chthollyphile/folia-major) (by chthollyphile). It is not affiliated with, or endorsed by, the official project or its author. Please report problems with this edition in [this repository's Issues](https://github.com/xinzhihong-ship-it/folia-major/issues), not to the official project.
> - **This edition is only for people who love Folia's lyric visuals.** Music is played by [LX Music Enhanced](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced), not by Folia. If you don't use LX Music, use the [official Folia](https://github.com/chthollyphile/folia-major/releases) instead.
> - Neither Folia nor LX Music Enhanced provides any audio, lyrics or cover art of its own. What you can play depends on the sources you use in LX Music and on your own accounts. Only use content you have the right to access.

## What it is

The official Folia is a music player built around full-screen, immersive lyric animations. This fork adds an "LX Music" platform to it, and the two apps split the work:

- **Folia** shows the lyric animations and lets you search, browse lists and control playback.
- **LX Music Enhanced** makes the sound. Sources, quality, playback engine (MPV or built-in), output device and VST3 plugins all follow LX Music's settings.

Everything else the official Folia offers (local music, Navidrome, its other online platforms, lyric styles, the mod system and so on) is unchanged; see the [official repository](https://github.com/chthollyphile/folia-major) and its user guide.

## What it adds

- **Search tracks and playlists** with LX Music's search, across all platforms or just one. Playlist search covers every platform at once, and each result shows which platform it comes from.
- **Your LX Music lists**: the trial list, favorites and your own lists appear under Playlists in Folia; daily picks and playlists from your own accounts in LX Music's "Platform Music" follow them, view and play only.
- **Open shared playlists** from the command palette ("Open a shared song list"), or paste the link straight into the search box. Play them all or save them to LX Music.
- **Two-way sync**: play/pause, seeking, previous/next, volume, play mode, shuffle and quality. When you change tracks in LX Music, Folia follows with the new track and lyrics; when you start playing in LX Music, Folia takes it up (turn off "Follow the external player" in settings if you don't want that).
- **Queue**: Folia's queue is LX Music's current play list, with Play Later tracks right after the current one.
- **Quality**: while linked, the quality picker lists LX Music's own quality levels and always matches its setting, without touching the quality Folia uses for other platforms.
- **Stage mode**: fixes original-language lyrics pushed through the Stage API not showing in large type and not following playback.

## Download and setup

1. Install [LX Music Enhanced](https://github.com/xinzhihong-ship-it/lx-music-desktop-enhanced/releases) 3.4.0 or later and make sure Settings → Open API → Folia link is on (it is by default).
2. Download this edition from [Releases](https://github.com/xinzhihong-ship-it/folia-major/releases): the Windows x64 installer, or the dmg / zip for Apple-silicon Macs. Each release's notes say which LX Music version it needs.
3. In Folia, pick the "LX Music" platform and click Connect. Either app can start first; Folia reconnects by itself when LX Music restarts.

Notes:

- It installs over the official Folia (same app name and data folder) and keeps your settings and sign-ins. To go back, install the official installer over it.
- In-app update checks look at this repository's releases, so an official update won't replace it.
- Version numbers are the official version plus `-lx.N`, such as `0.7.29-lx.1`. Mod version requirements are checked against the official version.
- Installers are not signed. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/Folia.app` in Terminal.
- The two apps talk only on this machine (127.0.0.1); Folia uses a token that LX Music generates at every launch.

## Relationship to the official Folia

- Official project: [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major). This repository modifies its code; copyright in the original code belongs to the official author and contributors.
- The name "Folia", its icon and its visual design belong to the official author. This fork keeps them only to show where the code comes from and to stay install-compatible with the official app; if the official author objects, please open an issue and they will be changed.
- The official Discord, download mirrors, one-click deployments, mod marketplace and user guide belong to the official project. Please don't take questions about this fork there.
- This repository's `main` branch mirrors the official `main`; our changes live on the default branch `lx`. For the list of changed files and how we follow official updates, see [docs/lx-fork.md](docs/lx-fork.md) (Chinese).

## Trademarks and copyright

- Names and trademarks of music platforms, streaming services and software mentioned here or in the app belong to their respective owners and are used only to describe compatibility. This project has no partnership with, affiliation to, or endorsement from any of them.
- Songs, lyrics, cover art and other content belong to their rights holders. This project does not provide such content and does not encourage any use that infringes copyright. Please respect copyright and support licensed music through official platforms when you can.
- If you hold rights and believe something in this repository infringes them, please contact us through [Issues](https://github.com/xinzhihong-ship-it/folia-major/issues); we will check and act promptly.

## Legal notice and disclaimer

- The official Folia was developed with extensive help from AI, and all code added or changed in this fork was written by AI coding assistants. Subtle problems may remain; we appreciate your understanding.
- This project mainly demonstrates lyric animation, interface design and the engineering behind them.
- This repository and its source code are for personal learning, technical exchange and non-profit testing only. Do not use them for commercial gain. Users alone are responsible for any copyright dispute or other liability arising from distributing, processing or redistributing online content; the developers accept no such liability.

## License

Like the official project, this fork is licensed under [AGPL-3.0](LICENSE). The complete source of this fork is in this repository, and its changes from the official code are listed in [docs/lx-fork.md](docs/lx-fork.md).

## Credits

- Thanks to [chthollyphile](https://github.com/chthollyphile) and all Folia contributors ([contributors](CONTRIBUTORS.md)). For the open-source projects the official Folia uses and thanks, see the [official README](https://github.com/chthollyphile/folia-major/blob/main/README.en.md#acknowledgements).
- Thanks to [lyswhut](https://github.com/lyswhut) for creating and open-sourcing [LX Music](https://github.com/lyswhut/lx-music-desktop).
