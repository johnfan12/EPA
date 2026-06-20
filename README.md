# Research Idea Agent

## 为什么做这个项目

AI agent 时代的科研工作正在变得越来越碎片化：

- 和 ChatGPT / Claude 聊想法是一个地方
- 用 Codex / Claude Code 写代码是另一台设备或服务器
- 跑代码可能在本地，也可能在远程服务器
- 清理硬盘空间时，实验数据、对话记录可能被一并删掉
- 不知道怎么向 Claude Code / Codex 准确描述自己的需求
- 多任务并行开发时，每个任务的进度不清晰，上下文散落各处

本项目要构造一个**聚合空间**，把科研过程中散落在不同工具、设备、会话里的想法、对话、代码、实验和进度统一收纳并相互关联，让一个研究课题的完整上下文始终可追溯、可复用。

## 功能

- 按 `Idea` 聚合一个研究课题的全过程：研究问题、方向、状态、标签和阶段 brief。
- 粘贴 ChatGPT / Claude / Codex 对话或自己的研究笔记，并生成阶段总结 prompt。
- 为 Codex、Claude Code、ChatGPT 等外部 Agent 生成可复制 prompt，记录外部输出与结论，避免上下文只在某个会话里。
- 汇总实验日志、指标 JSON、结论，并提供简单图表和表格。
- 从讨论、Agent 记录和实验数据生成 Markdown 汇报草稿，可编辑和导出。
- 支持 OpenAI Responses API 与 Anthropic Messages API；未配置 API key 时仍然保留"复制 prompt"工作流。
- SQLite 本地持久化，FTS5 全文搜索；API key 不写入 SQLite。

## 技术栈

- 桌面壳：Tauri 2
- 前端：Vite + React + TypeScript
- UI：Tailwind CSS 风格变量、自写 shadcn 风格组件、lucide-react
- 数据：SQLite + sqlx + FTS5
- 状态与数据流：TanStack Query、TanStack Router、TanStack Table、Zustand
- 编辑与展示：CodeMirror 6、Marked、DOMPurify、Recharts
- 密钥：Tauri Stronghold；留空 passphrase 时只保存在当前浏览会话

## 运行

```powershell
npm install
npm run tauri:dev
```

Tauri 2 当前需要较新的 Rust 工具链。仓库中的 `src-tauri/Cargo.toml` 明确标注 `rust-version = "1.77.2"`；如果本机 Rust 低于该版本，请先更新：

```powershell
rustup update stable
```

## 数据与隐私

- SQLite 数据库位于 Tauri app local data 目录，文件名为 `research-idea-agent.sqlite3`。
- Markdown 导出位于 app local data 目录下的 `exports/`。
- Provider/model 写入 SQLite 的 `app_settings`。
- API key 通过前端 Stronghold 入口保存，不进入 SQLite，也不会写入 `llm_runs`。
- `llm_runs` 只记录任务类型、provider、model、prompt digest 和模型输出。

## 第一版边界

- 单用户本地应用，不包含账号、权限、多设备同步或多人协作。
- 不直接控制 Codex / Claude Code 进程，而是生成 prompt 并记录用户粘贴回来的输出。
- PDF / Word 导出、论文 PDF 导入、向量知识库和自动实验编排留到后续阶段。
