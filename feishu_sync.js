// 飞书 -> data.json 同步脚本（供本地手动或 GitHub Actions 定时调用）
// 读取飞书多维表格下 6 个数据表，重组为前端 data.json 格式并覆盖写出。
// 密钥只从环境变量读取；app_token 与 table_id 映射来自 feishu.config.json。
//
// 用法：
//   FEISHU_APP_ID=xxx FEISHU_APP_SECRET=yyy [FEISHU_APP_TOKEN=zzz] \
//     node feishu_sync.js [输出路径，默认 data.json]
//
// 说明：飞书表只存 fields/rows，name/hint 为静态映射（见下方 META）。

const fs = require('fs');
const path = require('path');

const APP_ID = process.env.FEISHU_APP_ID;
const SECRET = process.env.FEISHU_APP_SECRET;
const BASE = 'https://open.feishu.cn/open-apis';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 与前端 TABS 顺序一致；name/hint 为静态展示文案
const META = [
  { key: 'qingdan',   name: '国标清单库', hint: '按清单编码、项目名称、特征描述浏览，右侧表格查看完整清单。' },
  { key: 'cailiao',   name: '材料库',     hint: '常用建筑材料参考单价，单位与规格已标注。' },
  { key: 'zhibiao',   name: '指标库',     hint: '典型工程含量与单方造价参考指标。' },
  { key: 'dispute',   name: '争议处理',   hint: '常见计价争议点及处理依据参考。' },
  { key: 'lwjg',      name: '劳务价格',   hint: '劳务分包参考单价（示例）。' },
  { key: 'gzbiaodan', name: '广州市场价', hint: '广州地区材料市场参考价（示例日期）。' }
];

// 工期计算为纯前端计算模块，无数据，保持静态
const GONGQI = {
  name: '工期计算',
  hint: '输入建筑面积与层数，按经验公式估算参考工期（示意，非官方定额）。',
  type: 'calc'
};

let TK = '';

async function token() {
  const r = await fetch(BASE + '/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: SECRET })
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('token ' + j.code + ' ' + j.msg);
  TK = j.tenant_access_token;
  return TK;
}

async function api(method, p, body) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) { await sleep(800 * attempt); console.error('  重试', attempt, p); }
    const r = await fetch(BASE + '/bitable/v1' + p, {
      method,
      headers: { 'Authorization': 'Bearer ' + TK, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch (e) { throw new Error(p + ' -> 非JSON: ' + t.slice(0, 160)); }
    if (j.code === 99991668) { lastErr = p + ' -> ' + j.code + ' ' + j.msg; continue; }
    if (j.code !== 0) throw new Error(p + ' -> ' + j.code + ' ' + j.msg);
    return j.data;
  }
  throw new Error(lastErr || 'api failed');
}

async function listFields(app_token, table_id) {
  const d = await api('GET', `/apps/${app_token}/tables/${table_id}/fields?page_size=100`);
  // 排除主键“标题”，其余即为数据列（按返回顺序）
  return (d.items || []).filter(f => !f.is_primary).map(f => f.field_name);
}

async function listRecords(app_token, table_id) {
  let items = [], page_token = '';
  do {
    const p = `/apps/${app_token}/tables/${table_id}/records?page_size=100` + (page_token ? `&page_token=${encodeURIComponent(page_token)}` : '');
    const d = await api('GET', p);
    items = items.concat(d.items || []);
    page_token = d.page_token || '';
  } while (page_token);
  return items;
}

(async () => {
  if (!APP_ID || !SECRET) throw new Error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量');
  const outPath = process.argv[2] || path.join(__dirname, 'data.json');

  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'feishu.config.json'), 'utf8')); }
  catch (e) { throw new Error('读取 feishu.config.json 失败: ' + e.message); }
  const app_token = process.env.FEISHU_APP_TOKEN || cfg.app_token;
  if (!app_token) throw new Error('缺少 app_token（env 或 feishu.config.json）');
  if (!cfg.tableIds) throw new Error('feishu.config.json 缺少 tableIds');

  await token();
  await sleep(1200); // 新 token 短暂生效

  const DB = {};
  for (const m of META) {
    const tid = cfg.tableIds[m.key] && cfg.tableIds[m.key].table_id;
    if (!tid) { console.error('跳过(无 table_id):', m.key); continue; }
    const fields = await listFields(app_token, tid);
    const recs = await listRecords(app_token, tid);
    const rows = recs.map(rec => fields.map(fn => {
      const v = rec.fields ? rec.fields[fn] : undefined;
      return v === undefined || v === null ? '' : String(v);
    }));
    DB[m.key] = { name: m.name, hint: m.hint, fields, rows };
    console.error('已同步', m.name, '| 列', fields.length, '| 行', rows.length);
  }
  DB.gongqi = GONGQI;

  fs.writeFileSync(outPath, JSON.stringify(DB, null, 2), 'utf8');
  console.error('已写出', outPath);

  // 同步生成离线兜底 data.js（暴露 window.DB，供 file:// 直接打开时回退）
  const jsPath = outPath.replace(/data\.json$/, 'data.js');
  if (jsPath !== outPath) {
    const js = '// 造价数据库（原型）— 离线兜底数据（由 feishu_sync.js 自动生成，请勿手改）\n' +
      '// 注意：以下均为「演示用示例」，非真实造价数据，不可用于实际工程计价。\n' +
      'window.DB = ' + JSON.stringify(DB, null, 2) + ';\n';
    fs.writeFileSync(jsPath, js, 'utf8');
    console.error('已写出', jsPath);
  }

  // 仅打印汇总行到 stdout
  console.log('SYNC_OK modules=' + Object.keys(DB).length);
})().catch(e => { console.error('SYNC_ERR', e.message); process.exit(1); });
