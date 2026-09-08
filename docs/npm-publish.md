# 发布 PiCraft npm 包

PiCraft 的 npm 包是 `pi-craft`，发布目录是仓库中的 `packages/picraft/`，不是仓库根目录。

## PowerShell 发布流程

先进入包目录。已经在该目录时不要重复执行 `cd packages/picraft`：

```powershell
cd D:\UGit\AgentFramework\packages\picraft
```

确认当前版本：

```powershell
node -p "require('./package.json').version"
```

如果这次还没有递增版本号，执行一次：

```powershell
npm version patch --no-git-tag-version
```

如果版本已经递增过，例如当前已经是 `0.1.10`，不要再次执行 `npm version`，否则会变成 `0.1.11`。

生成发布包到专用输出目录：

```powershell
npm run pack:artifact
```

该命令会在被 Git 忽略的 `artifacts/` 目录生成对应版本的 tarball，例如：

```text
artifacts/pi-craft-0.1.10.tgz
```

发布刚生成的 tarball：

```powershell
npm publish .\artifacts\pi-craft-0.1.10.tgz --access public
```

将命令中的版本号替换成 `package.json` 的实际版本号。打包文件可以保留在 `artifacts/` 中，不会进入 Git。

## 下次更新的最短流程

在 `packages/picraft` 目录中，且当前版本还没有递增时，逐行执行：

```powershell
npm version patch --no-git-tag-version
npm run pack:artifact
npm publish .\artifacts\pi-craft-X.Y.Z.tgz --access public
```

把最后一行的 `X.Y.Z` 替换为新的实际版本号。

如果 `npm version patch` 已经执行过，则从 `npm run pack:artifact` 开始，不要再次递增版本。

## 登录

发布时如果 npm token 有效，不需要重新登录。只有出现 `401 Unauthorized` 或确认登录状态失效时，才执行：

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami
```

`npm whoami` 成功后，再执行 `npm publish`。不要为了普通版本更新主动执行 `npm logout`，否则会清掉当前发布凭据。

## 验证

```powershell
npm view pi-craft version dist-tags
```

然后更新本机 Pi package：

```powershell
pi update npm:pi-craft
```

在 Pi 中执行 `/reload`，或重启 Pi。

## 注意事项

- `npm publish` 要在 `packages/picraft` 目录执行，并发布 `artifacts/` 中刚生成的 `.tgz`。
- `packages/picraft/artifacts/` 是统一的本地输出目录；其中只有 `.gitignore` 被跟踪，所有打包产物都不会进入 Git。
- 不要在仓库根目录执行发布命令，根 `package.json` 是 private 综合仓库 manifest。
- npm 包的发布内容由 `packages/picraft/package.json` 的 `files` 白名单决定。
- PowerShell 中建议逐行执行命令，不依赖 `&&`。
- npm 版本不可重复发布；已经存在的版本必须递增后再发布。
- `Allow public` 已配置在 `packages/picraft/package.json` 的 `publishConfig` 中。
