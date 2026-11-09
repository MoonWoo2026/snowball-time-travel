#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取真实历史行情 / 分红 / 拆股 / 财报 / 汇率，生成前端静态数据。

用法:
    python3 scripts/build_data.py            # 使用本地缓存
    python3 scripts/build_data.py --refresh  # 强制重新抓取

数据来源:
    东方财富 日线 / 分红送转 / 港股 F10
    Frankfurter 历史汇率
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
CACHE = Path(__file__).resolve().parent / '.cache'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
END = date(2026, 11, 6)
BEG = date(2010, 1, 1)

STOCKS = [
    # 默认自选（顺序即默认顺序）
    dict(code='09633', name='农夫山泉', market='HK', sector='饮料', secid='116.09633', cur='HKD', default=True),
    dict(code='600519', name='茅台', market='A', sector='白酒', secid='1.600519', cur='CNY', default=True),
    dict(code='600036', name='招商银行', market='A', sector='银行', secid='1.600036', cur='CNY', default=True),
    dict(code='02328', name='中国财险', market='HK', sector='保险', secid='116.02328', cur='HKD', default=True),
    dict(code='00151', name='中国旺旺', market='HK', sector='食品', secid='116.00151', cur='HKD', default=True),
    dict(code='00700', name='腾讯', market='HK', sector='互联网', secid='116.00700', cur='HKD', default=True),
    dict(code='09992', name='泡泡玛特', market='HK', sector='潮玩', secid='116.09992', cur='HKD', default=True),
    dict(code='002001', name='新和成', market='A', sector='化工', secid='0.002001', cur='CNY', default=True),
    dict(code='601336', name='新华保险', market='A', sector='保险', secid='1.601336', cur='CNY', default=True),
    dict(code='600999', name='招商证券', market='A', sector='证券', secid='1.600999', cur='CNY', default=True),
    # 可加入自选
    dict(code='03690', name='美团', market='HK', sector='本地生活', secid='116.03690', cur='HKD', default=False),
    dict(code='01810', name='小米集团', market='HK', sector='消费电子', secid='116.01810', cur='HKD', default=False),
    dict(code='002594', name='比亚迪', market='A', sector='汽车', secid='0.002594', cur='CNY', default=False),
    dict(code='00941', name='中国移动', market='HK', sector='通信', secid='116.00941', cur='HKD', default=False),
]

REFRESH = '--refresh' in sys.argv
CACHE.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)


def fetch(url, key, as_text=False):
    """带磁盘缓存的 GET。"""
    path = CACHE / (key + ('.txt' if as_text else '.json'))
    if path.exists() and not REFRESH:
        raw = path.read_text(encoding='utf-8')
    else:
        last = None
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    raw = resp.read().decode('utf-8', 'ignore')
                path.write_text(raw, encoding='utf-8')
                time.sleep(0.25)
                break
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(1.2 * (attempt + 1))
        else:
            raise RuntimeError('抓取失败 %s: %s' % (key, last))
    return raw if as_text else json.loads(raw)


def em_data(report, flt, sort='', size=300):
    url = ('https://datacenter-web.eastmoney.com/api/data/v1/get?'
           'reportName=%s&columns=ALL&filter=%s&pageNumber=1&pageSize=%d'
           % (report, urllib.parse.quote(flt, safe=''), size))
    if sort:
        url += '&sortColumns=%s&sortTypes=-1' % sort
    return fetch(url, 'em_%s_%s' % (report, re.sub(r'[^0-9A-Za-z]', '', flt)))


def em_hk_data(report, flt, sort='', size=300):
    url = ('https://datacenter.eastmoney.com/securities/api/data/v1/get?'
           'reportName=%s&columns=ALL&filter=%s&pageNumber=1&pageSize=%d'
           % (report, urllib.parse.quote(flt, safe=''), size))
    if sort:
        url += '&sortColumns=%s&sortTypes=-1' % sort
    return fetch(url, 'emhk_%s_%s' % (report, re.sub(r'[^0-9A-Za-z]', '', flt)))


def day(s):
    return datetime.strptime(s[:10].replace('/', '-'), '%Y-%m-%d').date()


def next_weekday(d):
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def klines(secid, code):
    url = ('https://push2his.eastmoney.com/api/qt/stock/kline/get?'
           'secid=%s&fields1=f1,f2,f3,f4,f5,f6'
           '&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=0&beg=%s&end=%s'
           % (secid, BEG.strftime('%Y%m%d'), END.strftime('%Y%m%d')))
    raw = fetch(url, 'k_%s' % code)
    rows = (raw.get('data') or {}).get('klines') or []
    out = []
    for row in rows:
        p = row.split(',')
        try:
            out.append([p[0], float(p[1]), float(p[3]), float(p[4]), float(p[2]), float(p[5])])
        except (ValueError, IndexError):
            continue
    out.sort(key=lambda x: x[0])
    return out


def a_dividends(code):
    res = em_data('RPT_SHAREBONUS_DET', '(SECURITY_CODE="%s")' % code, 'EX_DIVIDEND_DATE')
    rows = (res.get('result') or {}).get('data') or []
    events = []
    for row in rows:
        ex = row.get('EX_DIVIDEND_DATE')
        if not ex or '实施' not in (row.get('ASSIGN_PROGRESS') or ''):
            continue
        dps = float(row.get('PRETAX_BONUS_RMB') or 0) / 10.0
        bonus = float(row.get('BONUS_IT_RATIO') or 0) / 10.0
        factor = 1.0 + bonus
        if dps > 0 or abs(factor - 1) > 1e-9:
            ev = {'date': ex[:10], 'dps': round(dps, 6), 'cur': 'CNY'}
            if abs(factor - 1) > 1e-9:
                ev['factor'] = round(factor, 6)
            events.append(ev)
    events.sort(key=lambda x: x['date'])
    return events


def hk_corporate(code):
    res = em_hk_data('RPT_HKF10_MAIN_DIVBASIC',
                     '(SECUCODE="%s.HK")(IS_BFP="0")' % code, 'EX_DIVIDEND_DATE')
    rows = (res.get('result') or {}).get('data') or []
    events = []
    for row in rows:
        ex = row.get('EX_DIVIDEND_DATE')
        if not ex:
            continue
        text = row.get('PLAN_EXPLAIN') or ''
        amount = None
        cur = 'HKD'
        m = re.search(r'相当于(?:港币|港元)\s*([0-9.]+)', text)
        if m:
            amount = float(m.group(1))
        else:
            m = re.search(r'每\s*(10\s*)?股[^0-9]{0,10}(港币|港元|人民币|美元)?\s*([0-9.]+)', text)
            if m:
                amount = float(m.group(3))
                if m.group(1):
                    amount /= 10.0
                cur = m.group(2) or 'HKD'
                if cur in ('港元',):
                    cur = 'HKD'
                elif cur == '港币':
                    cur = 'HKD'
                elif cur == '人民币':
                    cur = 'CNY'
                elif cur == '美元':
                    cur = 'USD'
        if amount and amount > 0:
            events.append({'date': ex.replace('/', '-')[:10], 'dps': round(amount, 6), 'cur': cur})

    split = em_hk_data('RPT_HKF10_SH_SPLIT', '(SECUCODE="%s.HK")' % code, 'EFFECTIVE_DATE')
    for row in (split.get('result') or {}).get('data') or []:
        if '实施' not in (row.get('SPLIT_PROCESS') or ''):
            continue
        ratio = row.get('SPLIT_RATIO') or ''
        m = re.match(r'\s*([0-9.]+)\s*:\s*([0-9.]+)', ratio)
        if not m:
            continue
        factor = float(m.group(2)) / float(m.group(1))
        ex = (row.get('EFFECTIVE_DATE') or '')[:10]
        if ex:
            events.append({'date': ex, 'dps': 0.0, 'cur': 'HKD', 'factor': round(factor, 6)})
    events.sort(key=lambda x: x['date'])
    return events


def a_reports(code):
    res = em_data('RPT_LICO_FN_CPD', '(SECURITY_CODE="%s")' % code, 'REPORTDATE')
    rows = (res.get('result') or {}).get('data') or []
    # 扣非净利润来自利润表，按报告期合并
    non_map = {}
    gi = em_data('RPT_F10_FINANCE_GINCOME', '(SECURITY_CODE="%s")' % code, 'REPORT_DATE')
    for row in (gi.get('result') or {}).get('data') or []:
        rd = row.get('REPORT_DATE')
        if rd:
            non_map[rd[:10]] = row.get('DEDUCT_PARENT_NETPROFIT')
    items = []
    for row in rows:
        rd = row.get('REPORTDATE')
        nd = row.get('NOTICE_DATE')
        if not rd or not nd:
            continue
        items.append({
            'date': rd[:10], 'disc': nd[:10], 'est': False,
            'rev': row.get('TOTAL_OPERATE_INCOME'),
            'np': row.get('PARENT_NETPROFIT'),
            'npNon': non_map.get(rd[:10]),
            'eps': row.get('BASIC_EPS'),
            'bvps': row.get('BPS'),
        })
    return finish_reports(items)


def hk_reports(code):
    res = em_hk_data('RPT_HKF10_FN_MAININDICATOR', '(SECUCODE="%s.HK")' % code, 'REPORT_DATE')
    rows = (res.get('result') or {}).get('data') or []
    items = []
    for row in rows:
        rd = row.get('REPORT_DATE')
        if not rd:
            continue
        d = day(rd)
        lag = 90 if d.month == 12 else (60 if d.month == 6 else 45)
        items.append({
            'date': rd[:10],
            'disc': next_weekday(d + timedelta(days=lag)).isoformat(),
            'est': True,
            'type': row.get('REPORT_TYPE'),
            'rev': row.get('OPERATE_INCOME'),
            'np': row.get('HOLDER_PROFIT'),
            'eps': row.get('BASIC_EPS'),
            'bvps': row.get('BPS'),
            'cur': row.get('CURRENCY'),
        })
    # 港股按 REPORT_TYPE 标注的财年差分（如旺旺 3 月年结）
    return finish_reports(items)


def fiscal_year(it):
    """财报所属财年：港股用 REPORT_TYPE 前缀，A 股按报告期年份。"""
    m = re.match(r'(\d{4})\s*年', it.get('type') or '')
    return m.group(1) if m else it['date'][:4]


def finish_reports(items):
    """把累计口径转换为单季/单期，同一财年内做差分。"""
    items.sort(key=lambda x: x['date'])
    prev = {}
    out = []
    for it in items:
        fy = fiscal_year(it)
        base = prev.get(fy)
        q = {'date': it['date'], 'disc': it['disc'], 'est': it['est'], 'fy': fy}
        for k in ('rev', 'np', 'npNon', 'eps'):
            v = it.get(k)
            if v is None:
                q[k + 'Q'] = None
            else:
                q[k + 'Q'] = float(v) - (base.get(k) or 0) if base and base.get(k) is not None else float(v)
        q['rev'] = it.get('rev')
        q['np'] = it.get('np')
        q['npNon'] = it.get('npNon')
        q['eps'] = it.get('eps')
        q['bvps'] = it.get('bvps')
        q['cur'] = it.get('cur') or 'CNY'
        out.append(q)
        prev[fy] = it
    return [x for x in out if x['disc'] <= END.isoformat()]


def fx_series(base, quote):
    url = ('https://api.frankfurter.app/%s..%s?from=%s&to=%s'
           % (BEG.isoformat(), END.isoformat(), base, quote))
    raw = fetch(url, 'fx_%s_%s' % (base, quote))
    rows = []
    for d, obj in sorted((raw.get('rates') or {}).items()):
        v = obj.get(quote)
        if v:
            rows.append([d, round(float(v), 6)])
    return fill_days(rows)


def fill_days(rows):
    """把仅工作日的汇率补成每个自然日，便于按任意日期取值。"""
    out = []
    cur = None
    m = {r[0]: r[1] for r in rows}
    d = BEG
    while d <= END:
        s = d.isoformat()
        if s in m:
            cur = m[s]
        if cur is not None:
            out.append([s, cur])
        d += timedelta(days=1)
    return out


def main():
    meta = {'generatedAt': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
            'endDate': END.isoformat(), 'stocks': [], 'calendar': []}
    all_dates = set()
    counts = []
    fx_hkd = fx_series('HKD', 'CNY')
    fx_usd = fx_series('USD', 'HKD')
    meta['fx'] = {'HKDCNY': fx_hkd, 'USDHKD': fx_usd}

    for cfg in STOCKS:
        code = cfg['code']
        bars = klines(cfg['secid'], code)
        if not bars:
            raise RuntimeError('%s 无行情' % code)
        events = a_dividends(code) if cfg['market'] == 'A' else hk_corporate(code)
        reports = a_reports(code) if cfg['market'] == 'A' else hk_reports(code)
        for b in bars:
            all_dates.add(b[0])
        payload = {
            'code': code, 'name': cfg['name'], 'market': cfg['market'],
            'sector': cfg['sector'], 'currency': cfg['cur'],
            'bars': bars, 'events': events, 'reports': reports,
        }
        (DATA / (code + '.json')).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        meta['stocks'].append({
            'code': code, 'name': cfg['name'], 'market': cfg['market'],
            'sector': cfg['sector'], 'currency': cfg['cur'], 'default': cfg['default'],
            'listed': bars[0][0], 'bars': len(bars),
            'events': len(events), 'reports': len(reports),
        })
        counts.append((code, cfg['name'], len(bars), len(events), len(reports)))
        print('%-6s %-6s bars=%-5d events=%-3d reports=%d' % (code, cfg['name'], len(bars), len(events), len(reports)))

    meta['calendar'] = sorted(all_dates)
    (DATA / 'meta.json').write_text(
        json.dumps(meta, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('\n写入 %d 个标的，交易日 %d 个，数据截止 %s' % (len(counts), len(meta['calendar']), END))


if __name__ == '__main__':
    main()
