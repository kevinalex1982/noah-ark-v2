# Skills 安装指南

> 创建时间：2026-03-24
> 最后更新：2026-03-24
> 用途：记录常用 Skills 及安装方法，方便换项目时快速配置

---

## 安装方法

### 方法一：npm 安装（推荐）

```bash
# 全局安装
npm install -g <package-name>

# 项目级安装
npm install <package-name>
```

### 方法二：npx skills 安装

```bash
# 从 GitHub 安装
npx skills install <owner>/<repo>
```

### 方法三：手动安装

将 skill 文件夹放入项目 `skills/` 目录或全局 `~/.claude/skills/` 目录。

---

## 一、已找到并可安装的 Skills

### 开发类

| Skill 名称 | NPM 包名 | 用途说明 | 安装状态 |
|-----------|---------|---------|---------|
| React/Next.js 最佳实践 | `@adonis0123/react-best-practices` | React 和 Next.js 性能优化最佳实践 | ✅ 已安装 |
| Next.js Skills 套件 | `@sharetech-labs/nextjs-claude-skills` | 14 个 Next.js App Router skills | ✅ 已安装 |
| Supabase 技能包 | `@intentsolutionsio/supabase-pack` | 30 个 Supabase skills（数据库、认证、Edge Functions） | ✅ 已安装 |

### 设计类

| Skill 名称 | NPM 包名 | 用途说明 | 安装状态 |
|-----------|---------|---------|---------|
| UI/UX Pro Max | `uipro-cli` | UI/UX 专业级设计 | ✅ 已安装 |
| UI Design CC | `ui-design-cc` | UI/UX 设计规范系统，支持多设计工具导出 | ✅ 已安装 |
| Design Shit Properly | `design-shit-properly` | 完整设计工作流系统 | ✅ 已安装 |
| Figma MCP | `conductor-figma` | 201 个 Figma 设计智能工具 | ✅ 已安装 |

### 提示词工程类

| Skill 名称 | NPM 包名 | 用途说明 | 安装状态 |
|-----------|---------|---------|---------|
| Prompt Architect | `@ckelsoe/claude-skill-prompt-architect` | 27 种研究支持的提示词框架 | ✅ 已安装 |

### 工具类

| Skill 名称 | NPM 包名 | 用途说明 | 安装状态 |
|-----------|---------|---------|---------|
| Skill Validator | `claude-skill-validator` | 验证和修复 Claude Code skills | ✅ 已安装 |
| Skill Loop | `claude-skill-loop` | 从开发经验创建可复用 skills | ✅ 已安装 |
| Claude Skill Lord | `@donganhvu16/claude-skill-lord` | 22 agents + 61 tiered skills + 40+ commands | ⬜ 待安装 |

---

## 二、原始需求列表（待确认来源）

> 以下 skills 暂未找到公开仓库，可能需要特定的安装源

### Vibe Coding 开发类

| # | Skill 名称 | 用途说明 | 状态 |
|---|-----------|---------|------|
| 1 | `vercel-react-best-practices` | React 最佳实践（Vercel 风格） | ⚠️ 未找到 |
| 2 | `remotion-best-practices` | Remotion 视频开发最佳实践 | ⚠️ 未找到 |
| 3 | `vercel-composition-patterns` | Vercel 组合模式 | ⚠️ 未找到 |
| 4 | `vercel-react-native-skills` | React Native 开发技能 | ⚠️ 未找到 |
| 5 | `supabase-postgres-best-practices` | Supabase/PostgreSQL 最佳实践 | ⚠️ 可用 `@intentsolutionsio/supabase-pack` 替代 |
| 6 | `next-best-practices` | Next.js 最佳实践 | ⚠️ 可用 `@sharetech-labs/nextjs-claude-skills` 替代 |
| 7 | `better-auth-best-practices` | Better Auth 认证最佳实践 | ⚠️ 未找到 |
| 8 | `webapp-testing` | Web 应用测试 | ⚠️ 未找到 |
| 9 | `test-driven-development` | 测试驱动开发 | ⚠️ 未找到 |
| 10 | `building-native-ui` | 原生 UI 构建 | ⚠️ 未找到 |

### Vibe Coding 设计类

| # | Skill 名称 | 用途说明 | 状态 |
|---|-----------|---------|------|
| 1 | `web-design-guidelines` | Web 设计指南 | ⚠️ 未找到 |
| 2 | `frontend-design` | 前端设计 | ⚠️ 未找到 |
| 3 | `ui-ux-pro-max` | UI/UX 专业级设计 | ✅ 已安装 (`uipro-cli`) |
| 4 | `tailwind-design-system` | Tailwind 设计系统 | ⚠️ 可用 `ui-design-cc` 替代 |

### 深度思考与写作类

| # | Skill 名称 | 用途说明 | 状态 |
|---|-----------|---------|------|
| 1 | `brainstorming` | 头脑风暴 | ⚠️ 未找到 |
| 2 | `copywriting` | 文案写作 | ⚠️ 未找到 |
| 3 | `systematic-debugging` | 系统化调试 | ⚠️ 未找到 |
| 4 | `writing-plans` | 计划编写 | ⚠️ 未找到 |
| 5 | `content-strategy` | 内容策略 | ⚠️ 未找到 |
| 6 | `executing-plans` | 计划执行 | ⚠️ 未找到 |
| 7 | `copy-editing` | 文案编辑 | ⚠️ 未找到 |

### 内容可视化类

| # | Skill 名称 | 用途说明 | 状态 |
|---|-----------|---------|------|
| 1 | `baoyu-cover-image` | 封面图片生成 | ⚠️ 未找到 |
| 2 | `baoyu-comic` | 漫画生成 | ⚠️ 未找到 |
| 3 | `baoyu-infographic` | 信息图表生成 | ⚠️ 未找到 |

---

## 三、已安装的 Skills

### 当前项目已安装

| Skill 名称 | 来源 | 用途 |
|-----------|------|------|
| `claude-to-im` | op7418/Claude-to-IM-skill | Claude Code 连接 IM 平台（Telegram/Discord/飞书/QQ/微信） |
| `uipro-cli` (ui-ux-pro-max) | npm | UI/UX 专业级设计 |

### 内置 Skills（系统自带）

| Skill 名称 | 用途 |
|-----------|------|
| `update-config` | 配置 settings.json |
| `simplify` | 代码简化审查 |
| `loop` | 循环执行任务 |
| `claude-api` | Claude API 开发 |

---

## 四、批量安装脚本

### 一键安装已找到的 Skills

```bash
# 开发类
npm install -g @adonis0123/react-best-practices
npm install -g @sharetech-labs/nextjs-claude-skills
npm install -g @intentsolutionsio/supabase-pack

# 设计类
npm install -g uipro-cli
npm install -g ui-design-cc
npm install -g design-shit-properly
npm install -g conductor-figma

# 提示词工程
npm install -g @ckelsoe/claude-skill-prompt-architect

# 工具类
npm install -g claude-skill-validator
npm install -g claude-skill-loop
npm install -g @donganhvu16/claude-skill-lord
```

---

## 五、管理命令

```bash
# 查看已安装的 skills
npx skills list

# 更新 skill
npx skills update <skill-name>

# 删除 skill
npx skills uninstall <skill-name>
```

---

## 六、注意事项

1. **安装位置**：Skills 可以安装在项目级（`skills/`）或全局级（`~/.claude/skills/`）
2. **优先级**：项目级 skills 优先于全局 skills
3. **版本管理**：`skills-lock.json` 记录已安装 skills 的版本信息
4. **换项目时**：复制此文档和 `skills-lock.json` 到新项目，然后执行批量安装
5. **来源确认**：原始列表中的部分 skills 需要确认正确的安装源

---

## 七、相关链接

- Claude Code 官方文档
- npm skills 搜索：`npm search claude-skill`
- GitHub skills 搜索：搜索 `claude-code-skill` 或 `claude-skill`

---

*文档维护：每次安装新 skill 后更新安装状态*