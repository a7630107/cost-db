(function () {
  "use strict";

  // Tab 定义（顺序即展示顺序）
  const TABS = [
    { id: "qingdan",   label: "国标清单库" },
    { id: "cailiao",   label: "材料库" },
    { id: "zhibiao",   label: "指标库" },
    { id: "dispute",   label: "争议处理" },
    { id: "lwjg",      label: "劳务价格" },
    { id: "gzbiaodan", label: "广州市场价" },
    { id: "gongqi",    label: "工期计算" }
  ];

  let current = "qingdan";
  let keyword = "";
  let DB = null;

  const $ = (s) => document.querySelector(s);

  function setStatus(t) { $("#statusText").textContent = t; }

  // —— 数据加载（在线 JSON，失败回退本地 data.js）——
  async function loadData() {
    setStatus("正在加载数据...");
    try {
      const res = await fetch("data.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      DB = await res.json();
      setStatus("数据已加载（在线）");
    } catch (e) {
      // 回退：file:// 直接打开时无法 fetch，尝试本地 data.js
      if (typeof window.DB !== "undefined" && window.DB) {
        DB = window.DB;
        setStatus("数据已加载（本地回退）");
      } else {
        setStatus("加载失败：" + e.message);
        $("#tableWrap").innerHTML =
          '<div class="empty-box">无法加载 data.json。<br>请通过本地或云端 HTTP 服务访问本页面，' +
          '不要直接用 file:// 打开。<br>若已部署，请确认 data.json 与 index.html 同目录。</div>';
        return;
      }
    }
    renderTabs();
    keyword = "";
    if ($("#searchInput")) $("#searchInput").value = "";
    render();
  }

  // —— Tab 渲染 ——
  function renderTabs() {
    const bar = $("#tabBar");
    bar.innerHTML = "";
    TABS.forEach((t) => {
      const b = document.createElement("button");
      b.className = "tab-btn" + (t.id === current ? " active" : "");
      b.textContent = t.label;
      b.onclick = () => {
        current = t.id;
        keyword = "";
        $("#searchInput").value = "";
        render();
      };
      bar.appendChild(b);
    });
  }

  // —— 数据过滤 ——
  function getRows() {
    const d = DB[current];
    if (!d.rows) return [];
    if (!keyword) return d.rows;
    const k = keyword.toLowerCase();
    return d.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(k)));
  }

  // —— 表格视图 ——
  function renderTable() {
    $("#calcWrap").style.display = "none";
    const tw = $("#tableWrap");
    tw.style.display = "block";

    const d = DB[current];
    const fields = d.fields || [];
    const rows = getRows();

    let html = '<table class="data-table"><thead><tr>';
    fields.forEach((f) => (html += `<th>${f}</th>`));
    html += "</tr></thead><tbody>";

    if (rows.length === 0) {
      html += `<tr><td class="empty" colspan="${fields.length}">无匹配数据</td></tr>`;
    } else {
      rows.forEach((r) => {
        html += "<tr>";
        r.forEach((c) => (html += `<td>${c}</td>`));
        html += "</tr>";
      });
    }
    html += "</tbody></table>";
    tw.innerHTML = html;
    $("#contextStats").textContent = `共 ${rows.length} 条`;
  }

  // —— 工期计算视图 ——
  function renderCalc() {
    $("#tableWrap").style.display = "none";
    const c = $("#calcWrap");
    c.style.display = "block";
    c.innerHTML = `
      <div class="calc-card">
        <h3>工期估算（经验示意）</h3>
        <div class="calc-row">
          <label>建筑面积（万㎡）</label>
          <input type="number" id="area" value="1" min="0" step="0.1">
        </div>
        <div class="calc-row">
          <label>地上层数</label>
          <input type="number" id="floors" value="6" min="1" step="1">
        </div>
        <button id="btnCalc" class="btn-export">计算参考工期</button>
        <div class="calc-result" id="calcResult"></div>
        <p class="calc-note">公式为示意：工期 ≈ 120 + 面积(万㎡)×30 + 层数×5（天）。非官方定额，仅供原型演示。</p>
      </div>`;
    $("#btnCalc").onclick = () => {
      const a = parseFloat($("#area").value) || 0;
      const f = parseFloat($("#floors").value) || 0;
      const days = Math.round(120 + a * 30 + f * 5);
      $("#calcResult").innerHTML = `参考工期：<b>${days}</b> 天`;
    };
  }

  // —— 主渲染 ——
  function render() {
    const d = DB[current];
    $("#contextBadge").textContent = d.name;
    $("#contextHint").textContent = d.hint || "";
    if (d.type === "calc") renderCalc();
    else renderTable();
  }

  // —— 导出（SheetJS 优先，离线降级 CSV）——
  let XLSX_ready = false;
  function loadXLSX(cb) {
    if (window.XLSX) return cb();
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => { XLSX_ready = true; cb(); };
    s.onerror = () => cb();
    document.head.appendChild(s);
  }

  function exportData() {
    const d = DB[current];
    if (d.type === "calc") return setStatus("工期计算无需导出");
    const fields = d.fields || [];
    const rows = getRows();
    if (rows.length === 0) return setStatus("无数据可导出");

    setStatus("正在生成文件...");
    loadXLSX(() => {
      const aoa = [fields, ...rows];
      if (XLSX_ready && window.XLSX) {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, d.name.slice(0, 28));
        XLSX.writeFile(wb, `${d.name}.xlsx`);
        setStatus(`已导出 ${rows.length} 条 → ${d.name}.xlsx`);
      } else {
        const csv =
          "﻿" +
          aoa
            .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
            .join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${d.name}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`已导出 ${rows.length} 条 → ${d.name}.csv（离线模式）`);
      }
    });
  }

  // —— 事件绑定 ——
  function bind() {
    $("#btnSearch").onclick = () => { keyword = $("#searchInput").value.trim(); render(); };
    $("#searchInput").addEventListener("input", (e) => { keyword = e.target.value.trim(); render(); });
    $("#btnClear").onclick = () => { keyword = ""; $("#searchInput").value = ""; render(); };
    $("#btnExport").onclick = exportData;
    const rb = $("#btnRefresh");
    if (rb) rb.onclick = () => loadData();
  }

  // —— 初始化 ——
  bind();
  loadData();
})();
