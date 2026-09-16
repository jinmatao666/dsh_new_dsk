import process from 'node:process'

if (process.env.GITHUB_ACTIONS !== 'true') {
  process.stderr.write('build:runner 只能由 GitHub Actions 执行；本地请使用 build 或 build:local。\n')
  process.exit(1)
}

process.stdout.write('GitHub Actions 安装包构建边界验证通过。\n')
