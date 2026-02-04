# Neary - 简约、私密、点对点的分享工具 🚀

**English** | [中文版](./README.zh-CN.md)

[English](./README.md) | **中文版**

**Neary** 是一款专为局域网设计的点对点（P2P）文件与文字传输工具。基于 WebRTC 技术，它实现了数据不出内网、不留服务器的极致隐私体验。

![Neary Preview](https://img.shields.io/badge/Status-Stable-success)
![Technology](https://img.shields.io/badge/Stack-React%20%7C%20Hono%20%7C%20WebRTC-blue)

## ✨ 特性

- **点对点传输 (P2P)**：文件和聊天记录直接在设备间传输，不经过服务器中转，速度仅受限于内网带宽。
- **极致隐私**：
  - **房主即服务**：聊天历史仅保存在“房主”设备内存中，随关随灭。
  - **无数据库**：不需要注册，不记录个人信息。
- **极简体验**：
  - **3位房间码**：无需扫码，输入 111-999 即可快速对暗号建立连接。
  - **简约亮色 UI**：清新、现代的设计风格，支持图片缩略图预览。
- **全平台支持**：支持电脑、手机、平板通过浏览器直接使用，无需安装应用。

## 🛠️ 技术架构

- **前端**: React 19 + Vite + Lucide Icons
- **后端**: Hono (运行于 Cloudflare Pages/Workers)
- **信令服务器**: 使用 Cloudflare KV 作为 WebRTC 握手的中转站
- **传输协议**: WebRTC Data Channel (SRTP 加密)

## 🚀 快速启动

### 本地开发
1. 安装依赖：
   ```bash
   npm install
   ```
2. 启动开发服务器（支持内网多设备访问）：
   ```bash
   npm run pages-dev
   ```
3. 访问 `http://localhost:5678` 或 `http://[你的显机内网IP]:5678`。

## 📖 使用指南

1. **创建房间**：输入任意 3 位数字（如 `888`），第一个进入的人自动成为 Host。
2. **加入房间**：另一台设备输入相同的数字即可建立连接。
3. **分享**：直接输入文字或点击“分享文件”按钮。
4. **下载**：点击消息下方的下载按钮，文件将通过 P2P 隧道开始下载。

---

*Made with ❤️ for private local sharing.*
