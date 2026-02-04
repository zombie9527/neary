# Neary - Simple, Private, P2P Sharing Tool 🚀

[中文版](./README.zh-CN.md) | **English**

**Neary** is a peer-to-peer (P2P) file and text transfer tool designed for local networks. Based on WebRTC technology, it provides an ultimate privacy experience where data never leaves your local network and is never stored on a server.

![Neary Preview](https://img.shields.io/badge/Status-Stable-success)
![Technology](https://img.shields.io/badge/Stack-React%20%7C%20Hono%20%7C%20WebRTC-blue)

## ✨ Features

- **P2P Transfer**: Files and chat messages are transferred directly between devices. No server relay means speeds are only limited by your local bandwidth.
- **Privacy First**:
  - **Host as Server**: Chat history is only stored in the "Host" device's memory and is destroyed when the page is closed.
  - **No Database**: No registration required, no personal data tracking.
- **Minimalist Experience**:
  - **3-Digit Room Code**: No QR codes needed. Enter 111-999 to establish a private connection instantly.
  - **Clean Light UI**: Modern, airy design with thumbnail previews for images.
- **Universal Support**: Works directly in browsers on PC, mobile, and tablets.

## 🛠️ Tech Stack

- **Frontend**: React 19 + Vite + Lucide Icons
- **Backend**: Hono (running on Cloudflare Pages/Workers)
- **Signaling**: Cloudflare KV for WebRTC handshaking
- **Protocol**: WebRTC Data Channel (SRTP Encrypted)

## 🚀 Quick Start

### Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start dev server:
   ```bash
   npm run pages-dev
   ```
3. Access `http://localhost:5678` or `http://[your-local-ip]:5678`.

## 📖 User Guide

1. **Create Room**: Enter any 3-digit number (e.g., `888`). The first person to enter becomes the Host.
2. **Join Room**: Another device enters the same number to connect.
3. **Share**: Type text or click "Select Image/File".
4. **Download**: Click the download button. Data will stream directly via the P2P tunnel.

---

*Made with ❤️ for private local sharing.*
