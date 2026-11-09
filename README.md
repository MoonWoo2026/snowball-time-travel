# 滚雪球 · 历史投资复盘

选一个过去的日期，用当时能看到的基本面与 K 线做决策，然后让真实行情带你走完接下来的几年。
分红、送转、拆股、汇率与红利税，全部按真实事件结算。

## 功能

- **时点封印**：行情、估值、财报都截止到当前复盘时点；财报按披露日解封，K 线不显示未来。
- **真实行情**：14 只 A 股 / 港股，日线自 2010 年起，来自东方财富公开接口。
- **公司行动**：现金分红、送转、拆合股、红利税（A 股按持有期）、港元/人民币汇率折算。
- **交易终端**：K 线 + BOLL + 成交量 + RSI，B/S 买卖点标记；25% / 50% / 全仓快捷下单。
- **时间推进**：拖拽时间轴，或 +1 月 / +3 月 / +6 月 / +1 年 / +3 年 / 推到现在。
- **复盘报告**：资产曲线对比等权买入持有基准、收益拆解、持仓、分红、成交，支持导出 JSON / CSV。

## 目录

```
index.html          首页
setup.html          新建复盘
terminal.html       交易终端
watchlist.html      自选股
review.html         复盘报告
assets/css/app.css  设计系统
assets/js/          store / market / engine / ui + pages/*
assets/vendor/      ECharts
data/               预生成的静态行情数据（meta.json + 每只标的）
scripts/build_data.py  数据抓取脚本（需 Python 3，仅开发时使用）
render.yaml         Render 静态站点配置
```

## 本地运行

纯静态站点，不需要构建。任意静态服务器即可：

```bash
cd time-travel-backtest
python3 -m http.server 8901
# 打开 http://localhost:8901
```

请勿直接双击 `index.html`（`file://` 下浏览器会拦截 `fetch` 数据）。

## 更新数据

```bash
python3 scripts/build_data.py            # 使用 scripts/.cache 缓存
python3 scripts/build_data.py --refresh  # 强制重新抓取
```

脚本会重写 `data/*.json` 与 `data/meta.json`，然后提交即可。

## 部署

仓库已包含 `render.yaml`，Render 会把它识别为静态站点（`staticPublishPath: .`）。

1. 推送到 GitHub（公开仓库）。
2. 在 Render 打开 Blueprint 一键部署链接，登录并确认。
3. 首次部署完成后获得 `https://<name>.onrender.com` 地址，手机与电脑都可直接访问，无需本地开机。

一键部署链接格式：

```
https://render.com/deploy?repo=https://github.com/MoonWoo2026/snowball-time-travel
```

## 说明

行情来自公开市场日线；港股财报披露日为估算值（年报 +90 天、中报 +60 天、季报 +45 天），界面上以「估」标注。
A 股红利税按持有期简化计算（≤30 天 20%，30–365 天 10%，>365 天 0）。
本项目仅供投资学习与研究，不构成任何投资建议。
