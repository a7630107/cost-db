// 刷新按钮触发「飞书同步」所需的 GitHub 令牌。
// 用途：仅供浏览器调用 GitHub API 去启动同步工作流（最小权限：Actions: write，且仅限 a7630107/cost-db 这一个仓库）。
// ⚠️ 此文件会随公开仓库一起发布，任何人查看页面源码都能看到。
//    请勿填入拥有「代码读写 / 读取密钥」权限的令牌；只用下面这种最小权限令牌。
//    要换令牌，只改这一行即可。
window.GITHUB_SYNC_TOKEN = "REPLACE_WITH_SCOPED_TOKEN";
