# 铁路调度 6 周学习计划

入职前学习用的静态网站：每天先学内容，再做测试，错题自动进错题本。

网址：<https://djzts.github.io/Railway_Study/>

## 功能
- **日历**：6 周 42 天（平日学习、周六缓冲、周日考试），显示每天的完成情况
- **每天的页面**：① 学习内容（必读 / 选读笔记、睡前三问）→ ② 测试（单选、判断自动批改，简答自评）→ ③ 错题自动进错题本
- **考试**：6 份试卷，交卷后对照参考答案逐题自评；不到 80 分时提示把下一个周六改成重学
- **错题本**：在不同的两天各做对一次算掌握；可以导出成 Obsidian 错题本的表格格式
- **知识库**：全部概念笔记、资料笔记和术语表，可搜索
- 进度保存在浏览器 localStorage；在"设置"里可以导出 / 导入
- **同步到 GitHub**：在"设置"里填一个仓库和 fine-grained Token 后，进度一有变化约 10 秒自动提交到仓库里的 `progress.json`，切走或关闭页面时也会提交；多台设备按条目三方合并（见下文）

## 目录
| 路径 | 内容 |
|---|---|
| `index.html` | 页面入口 |
| `assets/app.js` | 单页应用（无构建步骤） |
| `assets/style.css` | 样式（自动跟随浅色 / 深色模式） |
| `data/plan.js` | 42 天的学习安排 |
| `data/quiz.js` | 每日测试题库 |
| `data/notes.js` | 笔记正文（自动生成） |
| `data/exams.js` | 6 份试卷（自动生成） |
| `tools/build_data.py` | 从 Obsidian 知识库生成 `notes.js` 和 `exams.js` |

## 更新内容
知识库改动后重新生成数据，再提交推送：

```bash
python -X utf8 tools/build_data.py "F:\Obsidian_vault\Train_dispatch\Train_dispatch"
```

`plan.js` 和 `quiz.js` 是手写的，要和知识库里的 `MOC/6周学习计划.md` 保持一致。

## 发布
GitHub Pages 发布的是 `gh-pages` 分支。改完后两个分支一起推：

```bash
git push origin main main:gh-pages
```

## 进度同步
- 建议单独建一个**私有**仓库（如 `Railway_Study_progress`）放进度，不要用本仓库：本仓库是公开的，而且能写本仓库的 Token 也能改网站
- Token 用 fine-grained token，只授权进度仓库，权限只给 Contents: Read and write，设过期时间
- Token 只存在浏览器 localStorage 里，只发给 `api.github.com`，不会写进进度文件
- 合并规则：记住上次同步时两边一致的版本（base），按 `days[n]`、`exams[key]`、`wrong[id]` 逐条比较；只有一边改了就取那一边，两边都改了同一条就取较新的一边
- 第三方库（marked、KaTeX、Mermaid）带 SRI 校验，CDN 上的文件被改动时浏览器会拒绝加载

## 同步到 Obsidian 知识库
`tools/sync_obsidian.js` 从进度仓库拉取 `progress.json`（用本机 git，私有仓库要求本机 git 有权限），写进知识库：

| 知识库文件 | 写什么 |
|---|---|
| `MOC/6周学习计划.md` | 网站上完成的天打勾；"进度记录"表填考试分数、是否合格、需要重学的题和笔记（已有手填分数的行不覆盖） |
| `30-Practice/错题本.md` | 每周标题下的"网站错题"表，在两行 `%%` 标记之间，每次重写；标记外的手写内容不动 |
| `30-Practice/网站学习进度.md` | 总览、考试、每天的状态和测试分数、错题统计（整篇自动生成） |

然后在知识库里只提交这三个文件。同一份进度重复运行不会产生改动。

```bash
node tools/sync_obsidian.js
```

也可以双击 `tools/sync_obsidian.cmd`。常用参数：`--repo 用户名/仓库名`、`--branch 分支`、`--file 导出的进度.json`、`--dry-run`（只看会改什么）、`--no-commit`。

## 本地预览
```bash
python -m http.server 8000
```
然后打开 <http://localhost:8000/>。

## 说明
- 内容来自个人学习笔记（教材、论文、公众号文章的摘要）。标有"Claude 补充，待核实"的部分不是资料原文，以官方规章为准
- 车次字头一律按新版车次规定
- 原书 PDF 不在这个仓库里
