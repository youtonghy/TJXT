## 1.7.7
### 新功能 (Feat)
- Mihomo 内核升级 v1.19.12
- 新增 Webdav 最大备数设置和清理逻辑

### 修复 (Fix)
- 修复 MacOS 下无法启动的问题（重置工作目录权限）
- 尝试修复不同版本  MacOS 下安装软件时候的报错（Input/output error）
- 部分遗漏的多国语言翻译

## 1.7.6

**此版本修复了 1.7.5 中的几个严重 bug，推荐所有人更新**

### 修复 (Fix)
- 修复了内核1.19.8更新后gist同步失效的问题(#780)
- 部分遗漏的多国语言翻译
- MacOS 下启动Error: EACCES: permission denied
-  MacOS 系统代理 bypass 不生效
-  MacOS 系统代理开启时 500 报错

## 1.7.5

### 新功能 (Feat)
- 增加组延迟测试时的动画
- 订阅卡片可右键点击
- 

### 修复 (Fix)
- 1.7.4引入的内核启动错误
 - 无法手动设置内核权限
 - 完善 系统代理socket 重建和检测机制

## 1.7.4

### 新功能 (Feat)
- Mihomo 内核升级 v1.19.10
- 改进 socket创建机制，防止 MacOS 下系统代理开启无法找到 socket 文件的问题
- mihomo-party-helper增加更多日志，以方便调试
- 改进 MacOS 下签名和公正流程
- 增加 MacOS 下 plist 权限设置
- 改进安装流程
- 

### 修复 (Fix)
 - 修复mihomo-party-helper本地提权漏洞
 - 修复 MacOS 下安装失败的问题
- 移除节点页面的滚动位置记忆，解决页面溢出的问题
- DNS hosts 设置在 useHosts 不为 true 时也会被错误应用的问题(#742)
- 当用户在 Profile 设置中修改了更新间隔并保存后，新的间隔时间不会立即生效(#671)
- 禁止选择器组件选择空值
- 修复proxy-provider

## 1.7.3
**注意：如安装后为英文，请在设置中反复选择几次不同语言以写入配置文件**

### 新功能 (Feat)
- Mihomo 内核升级 v1.19.5
- MacOS 下添加 Dock 图标动态展现方式 (#594)
- 更改默认 UA 并添加版本
- 添加固定间隔的配置文件更新按钮 (#670)
- 重构Linux上的手动授权内核方式
- 将sub-store迁移到工作目录下(#552)
- 重置软件增加警告提示

### 修复 (Fix)
- 修复代理节点页面因为重复刷新导致的溢出问题
- 修复由于 Mihomo 核心错误导致启动时窗口丢失 (#601)
- 修复macOS下的sub-store更新问题 (#552)
- 修复多语言翻译
- 修复 defaultBypass 几乎总是 Windows 默认绕过设置 (#602)
- 修复重置防火墙时发生的错误，因为没有指定防火墙规则 (#650)

### 下载地址：

#### Windows10/11：

- 安装版：[64位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-windows-1.0.1-x64-setup.exe) | [32位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-windows-1.0.1-ia32-setup.exe) | [ARM64](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-windows-1.0.1-arm64-setup.exe)

- 便携版：[64位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-windows-1.0.1-x64-portable.7z) | [32位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-windows-1.0.1-ia32-portable.7z) | [ARM64](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-windows-1.0.1-arm64-portable.7z)


#### Windows7/8：

- 安装版：[64位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-win7-1.0.1-x64-setup.exe) | [32位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-win7-1.0.1-ia32-setup.exe)

- 便携版：[64位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-win7-1.0.1-x64-portable.7z) | [32位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-win7-1.0.1-ia32-portable.7z)


#### macOS 11+：

- PKG：[Intel](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-macos-1.0.1-x64.pkg) | [Apple Silicon](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-macos-1.0.1-arm64.pkg)


#### macOS 10.15+：

- PKG：[Intel](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-catalina-1.0.1-x64.pkg) | [Apple Silicon](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-catalina-1.0.1-arm64.pkg)


#### Linux：

- DEB：[64位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-linux-1.0.1-amd64.deb) | [ARM64](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-linux-1.0.1-arm64.deb)

- RPM：[64位](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-linux-1.0.1-x86_64.rpm) | [ARM64](https://github.com/youtonghy/mihomo-party/releases/download/v1.0.1/mihomo-party-linux-1.0.1-aarch64.rpm)