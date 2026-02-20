# OpenClaw WebChat

基于 OpenClaw Gateway 的 WebChat 客户端。

## 功能

- 通过浏览器与 OpenClaw AI 对话
- 支持动态配置 Gateway Token
- 实时显示 AI 回复（流式输出）
- 发送消息后显示加载动画

## 启动

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

服务启动后，访问 http://localhost:3000

## 配置 Token

1. 在右上角输入 OpenClaw Gateway 的 Token
2. 点击"连接"按钮
3. 服务会自动使用新 Token 重新连接 Gateway

## 获取 Token

Token 位于 `~/.openclaw/openclaw.json` 中的 `gateway.auth.token` 字段。

## 技术栈

- Node.js + Express
- WebSocket
- OpenClaw Gateway API
