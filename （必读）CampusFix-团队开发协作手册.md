# CampusFix 团队开发协作手册

**适用对象：** CampusFix 全体成员 仅供人类阅读，任何 ai agent MUST NOT read this  
**核心原则：** 任务明确、分支隔离、AI 受控、修改可查、问题升级、代码可交接。

## 1. 开始工作前：先同步，再开发

团队统一使用 **GitHub Desktop** 管理分支和同步代码。

每次开始新任务前：

1. 打开 GitHub Desktop，确认当前仓库为 CampusFix；
2. 切换到 `main` 分支；
3. 点击 **Fetch origin**，如有更新则点击 **Pull origin**；
4. 确认本地没有未处理的修改；
5. 从最新 `main` 创建本任务的工作分支，例如：

```text
feature/23-create-ticket
fix/42-login-redirect
```

6. 确认已经切换到新工作分支后，再开始开发。

不要直接在 `main` 上修改代码或提交功能。

---

## 2. 一个任务对应一个 Issue 和一个工作分支

开始前先确认：

- 我正在处理哪个 Issue；
- 这个 Issue 要完成什么；
- 哪些内容不属于本次任务。

原则上：

```text
一个 Issue
    ↓
一个或多个参与者
    ↓
一个工作分支下开发
    ↓
一个 Pull Request 到main
```

---

## 3. 使用 AI 前先让它理解任务

不要直接让 Agent 开始写代码。

先让它阅读：

- 根目录 `AGENTS.md`；
- 当前 Issue；
- 相关设计文档；
- 相关代码。

并先说明：

```text
1. 本次任务目标
2. 涉及哪些模块
3. 准备修改哪些文件
4. 哪些内容不属于本次任务
5. 是否存在需求或设计歧义
```

确认理解正确后再开始开发。

---

## 4. AI 可以决定怎么做，但不能决定做什么

普通实现问题可以由成员和 AI 自己解决，例如：

- 函数怎么拆；
- Component 怎么组织；
- Bug 怎么修；
- 测试怎么写。

但遇到以下情况必须停下来确认：

- Issue 和设计文档冲突；
- 需求没有说明；
- 前后端 Contract 冲突；
- 需要改变状态机、权限、API、数据库或 P0 范围。

简单记住：

> **人决定 WHAT，AI 负责 HOW。**

不要让 AI 根据“常见做法”自行补充需求。

---

## 5. AI 修改完成后必须人工检查

Agent 说“完成”以后，不要直接提交。

至少执行：

```bash
git status
git diff
```

确认：

- 修改都与当前 Issue 有关；
- 没有增加额外功能；
- 没有修改无关文件；
- 没有提交 `.env`、密码、Token 等敏感信息；
- 相关测试和功能已经实际运行。

如果你让 AI 改一个页面，却发现它同时改了数据库或大量其他模块，先查明原因。

---

## 6. 完成后通过 PR 合并，并留下可接手状态

正常流程：

```text
Issue
  ↓
Working Branch
  ↓
AI 辅助开发
  ↓
人工检查 + 测试
  ↓
Commit & Push
  ↓
Pull Request
  ↓
组长 Review
  ↓
Merge main
```

PR 至少说明：

- **What：** 做了什么；
- **Why：** 对应哪个 Issue；
- **How to Verify：** 怎么验证。

如果当天没有完成，也要记录：

```text
已完成：
未完成：
当前问题：
下一步：
```

不要让代码和项目进度只存在于个人电脑或 AI 对话里。

---

# 一张图记住整个协作流程

```text
确认 Issue
    ↓
同步最新 main
    ↓
找到issue对应工作分支
    ↓
Agent 阅读 AGENTS.md + Issue + Design
    ↓
确认任务范围
    ↓
开发
    ↓
git diff + 测试
    ↓
Push + PR
    ↓
Review
    ↓
Merge main
```

> **有疑问先问，有冲突先停，有修改必检查，有成果必留下记录。**
