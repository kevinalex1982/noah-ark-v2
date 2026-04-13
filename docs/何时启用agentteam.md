# 何时启用 Agent Teams

> 研究时间：2026-03-24
> 来源：Reddit r/ClaudeCode 社区讨论

---

## 一、Agent Teams 是什么

Claude Code 的新功能，允许 3-5 个独立的 Claude Code 实例协作处理同一项目。

### 与旧 Sub-Agent 模式的区别

| 维度 | 旧 Sub-Agent 模式 | 新 Agent Teams 模式 |
|------|------------------|-------------------|
| **执行方式** | 隔离工作，会话终止后只返回摘要 | 持续运行，共享上下文 |
| **通信** | 无（只能向主 Agent 汇报） | Agent 间直接消息 + 广播 |
| **协调** | 主 Agent 手动分配 | 共享任务列表 + 状态机 |
| **生命周期** | 任务完成即终止 | 显式 startup/shutdown 控制 |

### 底层工具链

```
TeamCreate    → 创建 .claude/teams/<team_id>/ 目录结构
TaskCreate    → 创建任务 JSON 文件（含状态、依赖、负责人）
Task tool     → 启动 Agent（新增 name + team_name 参数）
taskUpdate    → 更新任务状态
sendMessage   → Agent 间通信（写入 inbox/ 目录）
```

---

## 二、如何启用

### 步骤 1：更新 Claude Code 到最新版本

### 步骤 2：修改配置文件

```bash
code ~/.claude/settings.json
```

添加：

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### 步骤 3：重启终端，开始新会话

### 步骤 4：在提示词中明确要求创建团队

示例：

> "I'm designing a CLI tool that helps developers track TODO comments across their codebase. Create an agent team to explore this from different angles: one teammate on UX, one on technical architecture, one playing devil's advocate."

### 终端配置建议

- 用 **tmux + mosh**（不是普通 SSH，防止网络抖动断开）
- iTerm2 需要启用 Python API
- Ghostty + tmux 也可以

---

## 三、社区观点分析

### 正面观点（~40%）

| 观点 | 代表评论 |
|------|----------|
| **功能强大** | "God Damn its so good. You chat with agents, tell them they are wrong, watch them argue solutions" |
| **协作真实有效** | 硬件设计案例：6个agent模拟工程团队协作，PM协调冲突，agent主动跟进 |
| **省时间** | "Just when I was thinking one ai agent session wasn't enough" |

### 质疑观点（~35%）

| 观点 | 代表评论 |
|------|----------|
| **Token 成本高** | "Agent Teams burns more tokens on messaging overhead" / "just a way for users to use more token$ faster" |
| **通信效果存疑** | "It mostly did feel like subagents with extra steps... hard to accomplish useful discussion before hitting context window limit" |
| **触发不稳定** | "I'll put 'create an agent team' in my prompt but half the time it decides to use the old agents instead" |
| **Headless 问题** | "Doesn't work well in headless mode. Crashes or hangs 50% of the time" |

### 中立/观望（~25%）

| 观点 | 代表评论 |
|------|----------|
| **需要实测** | 需要对比测试：速度、完整性、token成本 |
| **场景受限** | "Is it best mostly only for complex debugging?" |
| **配置门槛** | "Make sure your CLAUDE.md is solid before spawning a team" |

---

## 四、最佳实践

### 1. 任务依赖管理

状态机：

```
pending → ready → claimed → in_progress → complete
         ↑
    只有 blockers 解除后才能变成 ready
```

### 2. CLAUDE.md 要扎实

> "Each teammate reads CLAUDE.md independently, so any vague instructions get amplified across multiple agents."

### 3. 模型分配

> "Have Claude Opus 4.6 create a plan for each agent. Specify the model for each agent - for some tasks, Sonnet will be more than enough."

### 4. 团队角色模板

- **Architect**: 系统架构设计
- **Developer**: 代码实现
- **Reviewer**: 代码审查
- **Tester**: 测试编写

---

## 五、适用场景判断

### ✅ 适合用 Agent Teams

| 场景 | 原因 |
|------|------|
| **深度调试** | 多假设并行验证，agent 间辩论 |
| **复杂系统设计** | 多子系统协作，需要协调 trade-offs |
| **长时间任务** | agent 可以自主协调，不需要一直盯着 |
| **跨领域任务** | 不同 agent 专注不同领域（前端/后端/测试） |

### ❌ 不适合的场景

| 场景 | 原因 |
|------|------|
| **简单任务** | 单 agent 足够，多 agent 反而慢 |
| **Token 敏感** | 通信开销大 |
| **需要快速响应** | 协调需要时间 |
| **Headless 自动化** | 稳定性差 |

---

## 六、当前项目评估

### noah-ark-v2 项目

| 因素 | 评估 |
|------|------|
| **复杂度** | 中等（生物识别设备管理） |
| **模块数** | 多个（虹膜/掌纹/MQTT/数据库） |
| **协作需求** | 中等（设备同步、错误处理） |

### 结论

**暂时不启用 Agent Teams**

原因：
1. 当前复杂度单 agent 可以应付
2. 功能仍处于实验阶段，有稳定性问题
3. Token 成本考虑

### 后续考虑启用的时机

- [ ] 需要同时重构多个模块
- [ ] 需要深度调试一个难以复现的 bug
- [ ] 需要设计一个新的复杂子系统
- [ ] 项目规模显著扩大

---

## 七、混合策略建议

```
默认：单 Agent
    ↓
遇到复杂任务
    ↓
判断是否需要并行 + 协作
    ↓
是 → 启用 Agent Teams
否 → 用普通 sub-agents 或自己处理
```

---

## 八、参考链接

- Reddit 原文：https://www.reddit.com/r/ClaudeCode/comments/1qz8tyy/how_to_set_up_claude_code_agent_teams_full/
- Claude Code 官方文档

---

*研究笔记 - 2026.03.24*