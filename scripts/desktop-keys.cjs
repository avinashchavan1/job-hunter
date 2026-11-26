// Reads the API keys the desktop app saved (encrypted with the macOS Keychain) — run it yourself in Terminal.
//
//   npx electron scripts/desktop-keys.cjs           list which keys are saved (names only)
//   npx electron scripts/desktop-keys.cjs --show    print the values in this Terminal window
//   npx electron scripts/desktop-keys.cjs --push    copy them into Supabase function secrets as JH_<NAME>
//
// macOS may ask to allow access to "job-hunter Safe Storage" — click Allow.
// Nothing is written to disk except a temporary 0600 file for --push, deleted straight after.
const { app, safeStorage } = require('electron')
const { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')
const { spawnSync } = require('child_process')

const PROJECT_REF = 'vrhcofbhrcqthbacixpb'
const mode = process.argv.includes('--push') ? 'push' : process.argv.includes('--show') ? 'show' : 'list'

app.setName('job-hunter') // same Keychain entry and data folder as the desktop app
app.dock?.hide()

app.whenReady().then(() => {
  try {
    const file = join(app.getPath('userData'), 'data', 'secrets.bin')
    if (!existsSync(file)) throw new Error(`no saved keys at ${file}`)
    const buf = readFileSync(file)
    const keys = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8'))
    const names = Object.keys(keys).filter((k) => String(keys[k] || '').trim())
    if (!names.length) throw new Error('the desktop app has no keys saved')

    if (mode === 'list') {
      console.log('Saved in the desktop app:\n' + names.map((k) => `  ${k}`).join('\n'))
      console.log('\nRun with --show to print them here, or --push to copy them into Supabase.')
    } else if (mode === 'show') {
      for (const k of names) console.log(`${k}=${keys[k]}`)
    } else {
      const dir = mkdtempSync(join(tmpdir(), 'jh-keys-'))
      const env = join(dir, 'keys.env')
      try {
        writeFileSync(env, names.map((k) => `JH_${k}=${String(keys[k]).trim()}`).join('\n') + '\n', { mode: 0o600 })
        console.log(`Copying ${names.length} keys to Supabase as: ${names.map((k) => 'JH_' + k).join(', ')}`)
        // run from the empty temp folder so no unrelated supabase/config.toml up the tree gets in the way
        const r = spawnSync('npx', ['-y', 'supabase@latest', 'secrets', 'set', '--env-file', env, `--remote=${PROJECT_REF}`, '--workdir', dir], { stdio: 'inherit', cwd: dir })
        if (r.status !== 0) throw new Error('supabase secrets set failed (see above)')
        console.log('Done. Reload the website and click "Check again".')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  } catch (e) {
    console.error('Error:', e.message)
    process.exitCode = 1
  }
  app.quit()
})
