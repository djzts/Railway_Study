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

## 本地预览
```bash
python -m http.server 8000
```
然后打开 <http://localhost:8000/>。

## 说明
- 内容来自个人学习笔记（教材、论文、公众号文章的摘要）。标有"Claude 补充，待核实"的部分不是资料原文，以官方规章为准
- 车次字头一律按新版车次规定
- 原书 PDF 不在这个仓库里
