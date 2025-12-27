import axios from 'axios'
import yaml from 'yaml'
import { app, shell } from 'electron'
import { getControledMihomoConfig } from '../config'
import { dataDir, exeDir, exePath, isPortable, resourcesFilesDir } from '../utils/dirs'
import { copyFile, rm, writeFile } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import os from 'os'
import { exec, execSync, spawn } from 'child_process'
import { promisify } from 'util'
import { latestYmlUrl, REPO_SLUG, TAG_PREFIX } from '../../shared/constants'

export async function checkUpdate(): Promise<IAppVersion | undefined> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  let res
  try {
    res = await axios.get(latestYmlUrl(), {
      headers: { 'Content-Type': 'application/octet-stream' },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port: mixedPort
      },
      responseType: 'text'
    })
  } catch (e) {
    // Fallback: try to fetch from repo root (raw) if release asset not found
    const status = (e as any)?.response?.status
    if (status !== 404) throw e
    const fallbackUrl = `https://raw.githubusercontent.com/${REPO_SLUG}/main/latest.yml`
    res = await axios.get(fallbackUrl, {
      headers: { 'Content-Type': 'application/octet-stream' },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port: mixedPort
      },
      responseType: 'text'
    })
  }
  const latest = yaml.parse(res.data, { merge: true }) as IAppVersion
  const currentVersion = app.getVersion()
  if (latest.version !== currentVersion) {
    return latest
  } else {
    return undefined
  }
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const baseName = app.getName() // should match electron-builder ${name}
  const fileMap = {
    'win32-x64': `${baseName}-windows-${version}-x64-setup.exe`,
    'win32-ia32': `${baseName}-windows-${version}-ia32-setup.exe`,
    'win32-arm64': `${baseName}-windows-${version}-arm64-setup.exe`,
    'darwin-x64': `${baseName}-macos-${version}-x64.pkg`,
    'darwin-arm64': `${baseName}-macos-${version}-arm64.pkg`
  } as Record<string, string>
  let file = fileMap[`${process.platform}-${process.arch}`]
  if (isPortable()) {
    file = file.replace('-setup.exe', '-portable.7z')
  }
  if (!file) {
    throw new Error('不支持自动更新，请手动下载更新')
  }
  if (process.platform === 'win32' && parseInt(os.release()) < 10) {
    file = file.replace('windows', 'win7')
  }
  if (process.platform === 'darwin') {
    const productVersion = execSync('sw_vers -productVersion', { encoding: 'utf8' })
      .toString()
      .trim()
    if (parseInt(productVersion) < 11) {
      file = file.replace('macos', 'catalina')
    }
  }
  // Try multiple tag prefixes to improve compatibility (e.g., 'Ver', 'v', none)
  const tagPrefixes = Array.from(new Set([TAG_PREFIX, 'Ver', 'v', '']))

  try {
    if (!existsSync(path.join(dataDir(), file))) {
      let downloaded = false
      let lastError: unknown = undefined
      for (const prefix of tagPrefixes) {
        const tag = `${prefix}${version}`
        const baseUrl = `https://github.com/${REPO_SLUG}/releases/download/${tag}/`
        try {
          const res = await axios.get(`${baseUrl}${file}`, {
            responseType: 'arraybuffer',
            proxy: {
              protocol: 'http',
              host: '127.0.0.1',
              port: mixedPort
            },
            headers: {
              'Content-Type': 'application/octet-stream'
            }
          })
          await writeFile(path.join(dataDir(), file), res.data)
          downloaded = true
          break
        } catch (e) {
          // Continue on 404, rethrow others
          const status = (e as any)?.response?.status
          if (status && status !== 404) throw e
          lastError = e
          continue
        }
      }
      if (!downloaded) {
        throw lastError || new Error('Update file not found for any tag prefix')
      }
    }
    if (file.endsWith('.exe')) {
      spawn(path.join(dataDir(), file), ['/S', '--force-run'], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    }
    if (file.endsWith('.7z')) {
      await copyFile(path.join(resourcesFilesDir(), '7za.exe'), path.join(dataDir(), '7za.exe'))
      spawn(
        'cmd',
        [
          '/C',
          `"timeout /t 2 /nobreak >nul && "${path.join(dataDir(), '7za.exe')}" x -o"${exeDir()}" -y "${path.join(dataDir(), file)}" & start "" "${exePath()}""`
        ],
        {
          shell: true,
          detached: true
        }
      ).unref()
      app.quit()
    }
    if (file.endsWith('.pkg')) {
      try {
        const execPromise = promisify(exec)
        const shell = `installer -pkg ${path.join(dataDir(), file).replace(' ', '\\\\ ')} -target /`
        const command = `do shell script "${shell}" with administrator privileges`
        await execPromise(`osascript -e '${command}'`)
        app.relaunch()
        app.quit()
      } catch {
        shell.openPath(path.join(dataDir(), file))
      }
    }
  } catch (e) {
    rm(path.join(dataDir(), file))
    throw e
  }
}
