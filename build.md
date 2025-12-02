# 构建指南 (GitHub Actions)

本项目使用 GitHub Actions 进行自动化构建和发布。经过优化，目前的构建流程不再依赖 Git Tags 自动触发，而是采用手动触发的方式，更加灵活可控。

## 触发构建

构建工作流被配置为 **手动触发 (workflow_dispatch)**。这意味着你需要手动在 GitHub 界面上启动构建过程。

### 步骤

1.  进入项目的 GitHub 仓库页面。
2.  点击顶部的 **Actions** 标签。
3.  在左侧侧边栏中，选择名为 **Build** 的工作流。
4.  在工作流页面右侧，点击 **Run workflow** 按钮。
5.  此时会出现一个输入框：
    *   **Release Version**: (可选) 输入你想要构建的版本号（例如 `1.0.5`）。
    *   如果不输入（留空），系统将自动使用 `0.0.{run_number}` 格式的版本号（例如 `0.0.42`），这是一个从头开始计数的版本方案，方便测试和开发。
6.  点击绿色的 **Run workflow** 按钮开始构建。

## 构建产物

构建过程可能需要几分钟到几十分钟，取决于构建队列和各平台的编译速度。完成后：

1.  **Release 草稿**: 构建成功后，会在项目的 **Releases** 页面生成一个新的 **Draft (草稿)** 版本。这个版本不会立即对公众可见，直到你手动点击 "Publish release"。
2.  **Artifacts**: 在 Actions 运行详情页面底部，你可以直接下载各平台的构建产物（压缩包形式）。
3.  **自动发布**: 如果配置了后续步骤（如 AUR 更新等），它们通常会在你将 Release 从草稿状态转为正式发布状态后触发（具体取决于配置）。

## 支持的平台

该工作流会自动并行构建以下平台的客户端：

*   **Windows**:
    *   Windows 10/11 (x64, ia32, arm64)
    *   Windows 7/8 (x64, ia32)
*   **Linux**:
    *   DEB/RPM 包 (amd64, arm64)
*   **macOS**:
    *   macOS 11+ (Intel & Apple Silicon)
    *   macOS 10.15 Catalina (Intel & Apple Silicon)
