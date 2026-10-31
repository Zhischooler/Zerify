# Zerify

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Dependencies](https://img.shields.io/badge/dependencies-0-16a34a.svg)](./package.json)

给自己的静态站点加一个人机验证：**画一条横线**。

Zerify 是一个 GitHub Action，在构建阶段扫描输出目录里的 HTML，自动向表单上方注入一个 Canvas 画线验证器，并在提交时拦截未通过的请求。纯前端、零依赖、无后端，桌面鼠标与移动端触摸通用，通过后中央浮出 SVG 对勾动画。

---

## 工作原理

```
源码 / public/  ──build──▶  dist/  ──Zerify Action──▶  dist/（已注入）
                                                          │
                                                          ▼
                                                   GitHub Pages
```

Action 做三件事：

1. 递归扫描 `path` 下的所有 `.html` / `.htm`
2. 找到匹配 `form-selector` 的表单（为空则匹配全部 `<form>`）
3. 在提交按钮前插入验证器挂载点，把 `zerify.js` 与挂载逻辑内联合并成一段 `<script>` 写入 `</body>` 前

重复运行是幂等的：已注入的页面带 `data-zerify-injected` 标记，会被跳过。

---

## 快速开始

### 1. 准备表单

给想保护的表单加一个属性，便于精确匹配：

```html
<form data-protect action="/subscribe" method="post">
  <input type="email" name="email" required>
  <button type="submit">订阅</button>
</form>
```

### 2. 在 workflow 中调用

```yaml
name: Deploy Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build site
        run: |
          mkdir -p dist
          cp -r public/* dist/

      - name: Inject Zerify
        uses: Zhischooler/Zerify@v1
        with:
          path: ./dist
          form-selector: 'form[data-protect]'

      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 3. 手动引入（不用 Action 时）

```html
<script src="zerify.js"></script>
<div id="zerify"></div>
<button id="submit-btn" disabled>提交</button>

<script>
  const verifier = new Zerify('#zerify', {
    onSuccess: () => { document.getElementById('submit-btn').disabled = false; },
    onFail:    () => { document.getElementById('submit-btn').disabled = true;  },
    onReset:   () => { document.getElementById('submit-btn').disabled = true;  }
  });

  document.querySelector('form').addEventListener('submit', (e) => {
    if (!verifier.isVerified()) e.preventDefault();
  });
</script>
```

---

## Action 参数

| 输入 | 默认值 | 说明 |
|---|---|---|
| `path` | `.` | 待扫描的 HTML 目录 |
| `form-selector` | 空 | CSS 选择器；为空时匹配所有 `<form>` |
| `exclude` | 空 | 逗号分隔的 glob，例如 `admin/*,preview.html` |
| `dry-run` | `false` | 只打印将修改的文件，不写盘 |

跳过某个表单：给它加 `data-zerify-ignore` 属性。

---

## 实例 API

### `new Zerify(target, options)`

`target` 支持 CSS 选择器字符串或 DOM 元素，返回实例。

### 方法

| 方法 | 说明 |
|---|---|
| `isVerified()` | 是否已通过验证，返回 `Boolean` |
| `reset()` | 清空轨迹与状态，回到初始提示 |
| `setDisabled(flag)` | 禁用 / 启用交互 |
| `destroy()` | 移除事件监听与 DOM，恢复容器原状 |

### 回调

| 回调 | 参数 | 触发时机 |
|---|---|---|
| `onSuccess` | `instance` | 验证通过 |
| `onFail` | `reason, instance` | 验证失败，`reason` 为中文原因 |
| `onReset` | `instance` | 调用 `reset()` 后 |

### 配置项

| 参数 | 默认值 | 说明 |
|---|---|---|
| `height` | `64` | Canvas 高度（px） |
| `padding` | `12` | 左右内边距（px） |
| `lineWidth` | `3` | 轨迹线宽 |
| `strokeColor` | `#2563eb` | 正常轨迹颜色 |
| `successColor` | `#16a34a` | 通过状态颜色 |
| `failColor` | `#dc2626` | 失败状态颜色 |
| `guideColor` | `#cbd5e1` | 参考虚线颜色 |
| `minPoints` | `8` | 最少轨迹采样点 |
| `minLengthRatio` | `0.5` | 横线至少覆盖可用宽度的比例 |
| `maxSlopeRatio` | `0.28` | 起终点 Y 差允许占高度的比例 |
| `maxDeviationRatio` | `0.16` | 平均偏离参考线的允许比例 |
| `maxPointDeviationRatio` | `0.45` | 单点最大偏离的允许比例 |
| `minDuration` | `120` | 绘制耗时下限（ms） |
| `maxDuration` | `15000` | 绘制耗时上限（ms） |
| `minSpeedVariation` | `0.05` | 速度变异系数下限，过低判为机械轨迹 |
| `maxBacktrackRatio` | `0.2` | 允许的 X 方向回溯比例 |
| `showCheck` | `true` | 是否显示 SVG 对勾 |
| `hint` | `按住并水平拖动，画一条横线` | 初始提示文案 |
| `successText` | `验证通过` | 通过文案 |
| `failPrefix` | `验证失败：` | 失败文案前缀 |

---

## 校验逻辑

一条横线需同时满足以下条件才算通过：

1. **采样点数量** ≥ `minPoints`
2. **耗时** 在 `minDuration` ~ `maxDuration` 之间
3. **长度** 横向跨度 ≥ 可用宽度 × `minLengthRatio`
4. **水平度** 起终点 Y 差 ≤ 高度 × `maxSlopeRatio`
5. **回溯** X 方向反向移动比例 ≤ `maxBacktrackRatio`
6. **直线度** 平均偏离 ≤ 高度 × `maxDeviationRatio`，单点最大偏离 ≤ 高度 × `maxPointDeviationRatio`
7. **拟人度** 逐点速度变异系数 ≥ `minSpeedVariation`，且时间戳重复比例不过高

任一条件不满足即判定失败，画布红框抖动并提示具体原因；通过时中央浮出 SVG 对勾。

---

## 对勾动画实现

对勾是独立的 SVG 覆盖层，不是画在 Canvas 上：

```html
<svg class="zerify-check" viewBox="0 0 100 100">
  <circle class="zerify-check-ring" cx="50" cy="50" r="42"/>
  <path   class="zerify-check-mark" d="M30 52 L45 67 L72 36"/>
</svg>
```

外圈 `circle` 与勾形 `path` 均通过 `stroke-dasharray` / `stroke-dashoffset` 做描边动画，`path` 延迟 180ms 启动，形成「先圈后勾」的书写感。通过时添加 `.is-visible` 类触发，重置时移除。

---

## 本地开发

```bash
git clone https://github.com/Zhischooler/Zerify.git
cd Zerify

# 干跑，只打印将修改的文件
ZERIFY_PATH=./test-site ZERIFY_DRY_RUN=true node inject.js

# 真实注入到副本
rm -rf test-out && cp -r test-site test-out
ZERIFY_PATH=./test-out node inject.js
grep -c data-zerify-injected test-out/index.html

# 浏览器打开 test-out/index.html 查看效果
```

CI 会验证三件事：干跑能识别目标文件、真实注入产生标记、重复运行幂等。

---

## 浏览器兼容

- Chrome / Edge / Firefox / Safari 现代版本
- 使用 Pointer Events（统一鼠标、触摸、触控笔）
- 使用 `ResizeObserver` 与 `devicePixelRatio` 自适应，高 DPI 不糊
- 使用 `requestAnimationFrame` 做重绘节流

---

## 已知限制

**CSP**：Action 采用内联注入。若站点设置了 `Content-Security-Policy: script-src 'self'`，内联脚本会被浏览器拦截，验证器不会运行。解决方式是放宽到 `'unsafe-inline'`（不推荐），或改用手动外链引入 `<script src="./zerify.js">`，由你自己处理 base path。

**动态渲染**：Action 只处理构建产物里的静态 HTML。SPA 在运行时渲染的表单不会被扫描到，需要手动调用 `new Zerify()`。

---

## 安全边界

> 纯前端验证只能**提高脚本模拟成本**，不能提供真正的安全防护。

熟练的攻击者可以用 Puppeteer / Selenium 生成带抖动的鼠标轨迹绕过本验证。Zerify 的定位是：

- [x] 拦截简单脚本与灌水机器人
- [x] 低成本、无后端、可直接部署在静态站
- [ ] 不能用于登录、支付、权限等敏感场景

敏感操作仍需后端会话、Token 校验或专业的服务端验证方案。

---

## 许可证与传染性说明

Zerify 以 **GNU General Public License v3.0 or later** 发布，Copyright (C) 2026 Zhischooler。

<details>
<summary>查看 GPLv3 标准声明</summary>

```
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
```

</details>

**关于注入代码的传染性**：`zerify.js` 以 GPLv3 发布。Action 在构建时把它内联合并进用户的 HTML，这一步在 GPLv3 意义上属于“分发”。对于商业站点或闭源项目，这可能意味着被注入的页面需要以 GPL 兼容方式授权——是否构成“衍生作品”在司法上并无定论，但内联合并比 `<script src>` 外链风险更高。如果你对此有疑虑，请在仓库根目录的 `COPYING.EXCEPTION` 中查阅附加的链接例外条款，或改用 `MIT` / `Apache-2.0` 发布。

`uses: Zhischooler/Zerify@v1` 这种在 workflow 中引用 Action 的方式，不构成对 Action 源码的再分发。

---

## 贡献

欢迎 Issue 与 PR。提交前请确保：

- 不引入第三方依赖
- 保持 `zerify.js` 单文件可用
- 保持 `inject.js` 幂等
- 新增校验规则需附带默认值与 README 说明

---

## License

[GPL-3.0-or-later](./LICENSE) © Zhischooler