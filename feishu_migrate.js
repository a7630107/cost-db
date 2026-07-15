// 飞书多维表格迁移脚本：把本地 data.json 的 6 个数据模块写入飞书 bitable。
// 密钥只从环境变量读取，绝不写死在脚本里。
// 用法（复用已存在的 app）：
//   FEISHU_APP_ID=xxx FEISHU_APP_SECRET=yyy FEISHU_APP_TOKEN=zzz node feishu_migrate.js > feishu.config.json
// 新建 app（不传 FEISHU_APP_TOKEN）：
//   FEISHU_APP_ID=xxx FEISHU_APP_SECRET=yyy node feishu_migrate.js > feishu.config.json

const APP_ID = process.env.FEISHU_APP_ID;
const SECRET = process.env.FEISHU_APP_SECRET;
const fs = require('fs');

const DATA_PATH = 'E:/ima下载知识库/造价数据库原型/data.json';
const DB = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

const MODULES = [
  { key: 'qingdan',   name: '国标清单库' },
  { key: 'cailiao',   name: '材料库' },
  { key: 'zhibiao',   name: '指标库' },
  { key: 'dispute',   name: '争议处理' },
  { key: 'lwjg',      name: '劳务价格' },
  { key: 'gzbiaodan', name: '广州市场价' }
];

const BASE = 'https://open.feishu.cn/open-apis';
let TK = ''; // 全局保存已获取的 token，避免调用 api() 时漏传

async function token() {
  const r = await fetch(BASE + '/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: SECRET })
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('token ' + j.code + ' ' + j.msg);
  TK = j.tenant_access_token;
  return TK;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, path, body, tk) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) { await sleep(800 * attempt); console.error('  重试', attempt, path); }
    const authTk = tk || TK;
    const r = await fetch(BASE + '/bitable/v1' + path, {
      method,
      headers: { 'Authorization': 'Bearer ' + authTk, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch (e) { throw new Error(path + ' -> 非JSON响应: ' + t.slice(0, 200)); }
    // 99991668：新颁发的 token 偶尔需要短暂生效，重试即可
    if (j.code === 99991668) { lastErr = path + ' -> ' + j.code + ' ' + j.msg; continue; }
    if (j.code !== 0) throw new Error(path + ' -> ' + j.code + ' ' + j.msg);
    return j.data;
  }
  throw new Error(lastErr || 'api failed');
}

(async () => {
  if (!APP_ID || !SECRET) throw new Error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量');
  const tk = await token();
  // 飞书新 token 偶尔需短暂生效，首次调用前稍作等待
  await sleep(1500);

  let app_token = process.env.FEISHU_APP_TOKEN;
  if (app_token) {
    console.error('复用已有多维表格 app:', app_token);
  } else {
    const app = await api('POST', '/apps', { name: '造价数据库' });
    app_token = (app && app.app_token) || (app && app.app && app.app.app_token);
    if (!app_token) throw new Error('未取到 app_token: ' + JSON.stringify(app));
    console.error('已新建 app:', app_token);
  }

  // 已存在的表，避免重复建表
  const tlist = await api('GET', `/apps/${app_token}/tables?page_size=100`);
  const tableMap = {};
  (tlist.items || []).forEach(t => { tableMap[t.name] = t.table_id; });

  const tableIds = {};
  for (const m of MODULES) {
    const d = DB[m.key];
    if (!d || !d.fields) { console.error('跳过(无字段):', m.key); continue; }

    let table_id = tableMap[m.name];
    if (!table_id) {
      const tbl = await api('POST', `/apps/${app_token}/tables`, { table: { name: m.name } });
      table_id = (tbl.table && tbl.table.table_id) || tbl.table_id;
      console.error('已建表:', m.name, '->', table_id);
    } else {
      console.error('复用表:', m.name, '->', table_id);
    }

    // 已有字段
    const flist = await api('GET', `/apps/${app_token}/tables/${table_id}/fields?page_size=100`);
    const items = flist.items || [];
    const haveFields = new Set(items.map(f => f.field_name));
    const titleField = items.find(f => f.is_primary) || (haveFields.has('标题') ? { field_name: '标题' } : null);

    // 逐字段创建（type=1 文本）
    for (const fn of d.fields) {
      if (haveFields.has(fn)) continue;
      await api('POST', `/apps/${app_token}/tables/${table_id}/fields`, { field_name: fn, type: 1 });
      console.error('  已加字段:', fn);
    }

    // 已存在记录则跳过，避免重复
    const rc = await api('GET', `/apps/${app_token}/tables/${table_id}/records?page_size=1`);
    const total = rc.total || 0;
    if (total > 0) {
      console.error('  已有', total, '条记录，跳过写入:', m.name);
      tableIds[m.key] = { name: m.name, table_id };
      continue;
    }

    const records = d.rows.map(row => {
      const f = {};
      d.fields.forEach((fn, i) => { f[fn] = String(row[i]); });
      if (titleField && titleField.field_name && !d.fields.includes(titleField.field_name)) {
        f[titleField.field_name] = String(row[0]);
      }
      return { fields: f };
    });

    // 飞书单次 batch_create 上限 500，这里每批 100
    for (let i = 0; i < records.length; i += 100) {
      await api('POST', `/apps/${app_token}/tables/${table_id}/records/batch_create`,
        { records: records.slice(i, i + 100) });
    }
    console.error('OK', m.name, '写入', records.length, '条');
    tableIds[m.key] = { name: m.name, table_id };
  }

  // 尝试改名（失败不影响主流程）
  try {
    await api('PATCH', `/apps/${app_token}`, { name: '造价数据库' });
    console.error('已重命名 app 为「造价数据库」');
  } catch (e) { console.error('改名跳过:', e.message); }

  // 仅此行输出到 stdout（供重定向成配置文件）
  console.log(JSON.stringify({ app_token, tableIds, app_id: APP_ID }, null, 2));
})().catch(e => { console.error('MIG_ERR', e.message); process.exit(1); });
