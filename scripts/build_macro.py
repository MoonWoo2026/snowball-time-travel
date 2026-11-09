#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取月度宏观序列（附估算公布日），生成 data/macro.json。

用途：交易终端「周期工具」按复盘时点回溯——只使用该日期之前已公布的月度
数据，复刻「荀玉根改良美林时钟」与「周金涛周期罗盘」，不做后视镜结论。

公布日按官方发布惯例估算（公布日当天及之后才算可见）：
    CPI / PPI               次月 9 日
    工业增加值 / 社零 / 固投   次月 15 日
    PMI                     当月最后一天
    货币供应 / 新增人民币贷款  次月 12 日
    70 城房价                次月 16 日
    LPR                     实际报价日（每月 20 日）
    中证全指                 月末收盘日

用法:
    python3 scripts/build_macro.py            # 使用本地缓存
    python3 scripts/build_macro.py --refresh  # 强制重新抓取
"""
import calendar
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
CACHE = Path(__file__).resolve().parent / '.cache'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
START = '2008-01'

REFRESH = '--refresh' in sys.argv
CACHE.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)


def get(url, key):
    """带磁盘缓存的 GET → JSON。"""
    path = CACHE / (key + '.json')
    if path.exists() and not REFRESH:
        return json.loads(path.read_text(encoding='utf-8'))
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=40) as resp:
                raw = resp.read().decode('utf-8', 'ignore')
            path.write_text(raw, encoding='utf-8')
            time.sleep(0.2)
            return json.loads(raw)
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError('抓取失败 %s: %s' % (key, last))


def em_pages(report, cols='ALL', sort='REPORT_DATE'):
    """东财数据中心报表全量分页（单页上限 500）。"""
    out, page = [], 1
    while True:
        url = ('https://datacenter-web.eastmoney.com/api/data/v1/get?'
               'reportName=%s&columns=%s&pageNumber=%d&pageSize=500'
               '&sortColumns=%s&sortTypes=-1&source=WEB&client=WEB'
               % (report, cols, page, sort))
        d = get(url, 'macro_%s_%s_%d' % (report, re.sub(r'[^A-Za-z0-9]', '-', cols), page))
        res = d.get('result') or {}
        rows = res.get('data') or []
        out.extend(rows)
        if len(rows) < 500 or page * 500 >= (res.get('count') or 0):
            break
        page += 1
    return out


def f(x):
    try:
        v = float(x)
        return v
    except Exception:  # noqa: BLE001
        return None


def pub_next(ym, day):
    """次月第 day 日（超出当月天数则取月末）。"""
    y, m = int(ym[:4]), int(ym[5:7])
    m += 1
    if m > 12:
        y, m = y + 1, 1
    return '%04d-%02d-%02d' % (y, m, min(day, calendar.monthrange(y, m)[1]))


def pub_month_end(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return '%04d-%02d-%02d' % (y, m, calendar.monthrange(y, m)[1])


def monthly(report, field, pub, cols='ALL'):
    """报表 → [[月, 值, 公布日]]（升序，同名月份取最新一行）。"""
    rows = em_pages(report, cols=cols)
    bym = {}
    for r in rows:
        ym = (r.get('REPORT_DATE') or '')[:7]
        if len(ym) != 7 or ym in bym:
            continue
        v = f(r.get(field))
        if v is not None:
            bym[ym] = round(v, 2)
    return [[k, bym[k], pub(k)] for k in sorted(bym) if k >= START]


def house_ups():
    """70 城新房环比上涨城市数（FIRST_COMHOUSE_SEQUENTIAL > 100 计 1 城）。"""
    rows = em_pages('RPT_ECONOMY_HOUSE_PRICE',
                    cols='REPORT_DATE,FIRST_COMHOUSE_SEQUENTIAL')
    cnt = {}
    for r in rows:
        ym = (r.get('REPORT_DATE') or '')[:7]
        v = f(r.get('FIRST_COMHOUSE_SEQUENTIAL'))
        if len(ym) != 7 or v is None:
            continue
        n = cnt.get(ym, [0, 0])
        n[0] += 1
        if v > 100:
            n[1] += 1
        cnt[ym] = n
    # 只保留完整月份（样本数 >= 60 城），避免残缺月份拉低上涨城数
    return [[k, cnt[k][1], pub_next(k, 16)] for k in sorted(cnt) if cnt[k][0] >= 60]


def fai_yoy():
    """固投累计同比：按上年同月累计值自算（报表无现成累计同比）。"""
    rows = em_pages('RPT_ECONOMY_ASSET_INVEST')
    bym = {}
    for r in rows:
        ym = (r.get('REPORT_DATE') or '')[:7]
        if len(ym) != 7 or ym in bym:
            continue
        v = f(r.get('BASE_ACCUMULATE'))
        if v:
            bym[ym] = v
    out = []
    for ym in sorted(bym):
        y0 = '%d-%s' % (int(ym[:4]) - 1, ym[5:])
        base = bym.get(y0)
        if base:
            out.append([ym, round((bym[ym] / base - 1) * 100, 2), pub_next(ym, 15)])
    return [x for x in out if x[0] >= START]


def lpr_series():
    """1 年期政策利率：优先 LPR1Y，2019 年以前回退 1 年期贷款基准利率。

    旧口径只在调息日有记录，这里补成连续月度网格：无调息的月份沿用上一次
    已知利率，公布日取当月 1 日（月初即已知），保证「6 个月变化」是真 6 个月。
    """
    rows = em_pages('RPTA_WEB_RATE', sort='TRADE_DATE')
    bym = {}
    for r in rows:
        day = (r.get('TRADE_DATE') or '')[:10]
        ym = day[:7]
        if len(ym) != 7 or ym in bym:
            continue
        v = f(r.get('LPR1Y'))
        if v is None:
            v = f(r.get('RATE_1'))
        if v is not None:
            bym[ym] = (round(v, 2), day)
    if not bym:
        return []
    out, prev = [], None
    y, m = int(sorted(bym)[0][:4]), int(sorted(bym)[0][5:7])
    y1, m1 = int(sorted(bym)[-1][:4]), int(sorted(bym)[-1][5:7])
    while (y, m) <= (y1, m1):
        ym = '%04d-%02d' % (y, m)
        if ym in bym:
            prev, day = bym[ym]
            out.append([ym, prev, day])
        elif prev is not None:
            out.append([ym, prev, ym + '-01'])
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return [x for x in out if x[0] >= START]


def csi_monthly():
    """中证全指（000985）月收盘，公布日取该月最后一个交易日。"""
    url = ('https://push2his.eastmoney.com/api/qt/stock/kline/get?'
           'secid=1.000985&fields1=f1,f2,f3&fields2=f51,f53&klt=103&fqt=0'
           '&beg=20080101&end=20500101&lmt=400')
    d = get(url, 'macro_csi_000985')
    klines = ((d.get('data') or {}).get('klines') or [])
    out = []
    for k in klines:
        p = k.split(',')
        if len(p) >= 2 and f(p[1]) is not None:
            out.append([p[0][:7], round(f(p[1]), 2), p[0][:10]])
    return [x for x in out if x[0] >= START]


def m1m2():
    """M1 / M2 同比，剪刀差在页面端计算。"""
    return (monthly('RPT_ECONOMY_CURRENCY_SUPPLY', 'CURRENCY_SAME', lambda k: pub_next(k, 12)),
            monthly('RPT_ECONOMY_CURRENCY_SUPPLY', 'BASIC_CURRENCY_SAME', lambda k: pub_next(k, 12)))


def main():
    print('抓取宏观序列…')
    m1, m2 = m1m2()
    series = {
        'cpi': monthly('RPT_ECONOMY_CPI', 'NATIONAL_SAME', lambda k: pub_next(k, 9)),
        'ppi': monthly('RPT_ECONOMY_PPI', 'BASE_SAME', lambda k: pub_next(k, 9)),
        'ip': monthly('RPT_ECONOMY_INDUS_GROW', 'BASE_SAME', lambda k: pub_next(k, 15)),
        'pmi': monthly('RPT_ECONOMY_PMI', 'MAKE_INDEX', pub_month_end),
        'retail': monthly('RPT_ECONOMY_TOTAL_RETAIL', 'RETAIL_TOTAL_SAME', lambda k: pub_next(k, 15)),
        'fai': fai_yoy(),
        'loan': monthly('RPT_ECONOMY_RMB_LOAN', 'RMB_LOAN_SAME', lambda k: pub_next(k, 12)),
        'm1': m1,
        'm2': m2,
        'house': house_ups(),
        'lpr': lpr_series(),
        'csi': csi_monthly(),
    }

    for k, arr in series.items():
        if arr:
            print('  %-7s %4d 行  %s → %s' % (k, len(arr), arr[0][0], arr[-1][0]))
        else:
            print('  %-7s 空' % k)

    payload = {
        'built': max((a[-1][2] for a in series.values() if a), default=''),
        'notes': [
            '公布日按官方发布惯例估算：CPI/PPI 次月 9 日、工增/社零/固投 次月 15 日、'
            'PMI 当月最后一天、货币供应与新增贷款 次月 12 日、70 城房价 次月 16 日、'
            'LPR 实际报价日、中证全指月末收盘。',
            '只采用公布日不晚于复盘时点的数据；宏观数据事后存在修订，本工具按当期公布值'
            '（现值）回溯，不做实时修正，因此个别早期节点的方向可能与当年实际看到的略有差异。',
            '固投为累计同比（按上年同月累计值自算）；库存用「工增同比 − 社零同比」作'
            '产销缺口代理；1 年期政策利率在 2019 年前使用 1 年期贷款基准利率。',
        ],
        'series': series,
    }
    out = DATA / 'macro.json'
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
                   encoding='utf-8')
    print('写出 %s（%.1f KB）' % (out, out.stat().st_size / 1024))


if __name__ == '__main__':
    main()
