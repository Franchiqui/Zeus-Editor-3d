/**
 * Desktop Automation Module for Windows
 * Controls real mouse, keyboard, captures desktop screenshots, and records screen video.
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG_PATH = path.resolve(__dirname, 'ffmpeg', 'ffmpeg.exe');

let recordingProcess = null;
let recordingOutputPath = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => { stdout += d.toString(); });
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `PowerShell exited with code ${code}`));
      resolve(stdout.trim());
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mouse
// ─────────────────────────────────────────────────────────────────────────────

async function moveMouse(x, y) {
  // Usamos SetCursorPos (user32) para coordenadas físicas puras de pantalla.
  // Después leemos la posición real con GetCursorPos para confirmar dónde quedó.
  const script = `
    Add-Type -MemberDefinition @'
      [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
      [DllImport("user32.dll")] public static extern bool GetCursorPos(out int X, out int Y);
'@ -Name MouseUtils -Namespace Win32
    [Win32.MouseUtils]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
    Start-Sleep -Milliseconds 50
    $cx = 0
    $cy = 0
    [void][Win32.MouseUtils]::GetCursorPos([ref]$cx, [ref]$cy)
    Write-Output "$($cx),$($cy)"
  `;
  const result = await runPowerShell(script);
  console.log(`[DesktopAutomation] Mouse moved to (${x}, ${y}). Real cursor pos: ${result}`);
  return result;
}

async function mouseClick(button = 'left') {
  const MOUSEEVENTF_LEFTDOWN = 0x02;
  const MOUSEEVENTF_LEFTUP = 0x04;
  const MOUSEEVENTF_RIGHTDOWN = 0x08;
  const MOUSEEVENTF_RIGHTUP = 0x10;

  let downFlag, upFlag;
  if (button === 'right') {
    downFlag = MOUSEEVENTF_RIGHTDOWN;
    upFlag = MOUSEEVENTF_RIGHTUP;
  } else {
    downFlag = MOUSEEVENTF_LEFTDOWN;
    upFlag = MOUSEEVENTF_LEFTUP;
  }

  const script = `
    Add-Type -MemberDefinition @'
      [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
'@ -Name MouseUtils -Namespace Win32
    [Win32.MouseUtils]::mouse_event(${downFlag}, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 50
    [Win32.MouseUtils]::mouse_event(${upFlag}, 0, 0, 0, 0)
  `;
  await runPowerShell(script);
  console.log(`[DesktopAutomation] Mouse ${button} clicked`);
}

async function doubleClick() {
  await mouseClick('left');
  await new Promise(r => setTimeout(r, 100));
  await mouseClick('left');
  console.log('[DesktopAutomation] Double clicked');
}

async function scroll(amount = 300) {
  const WHEEL_DELTA = 120;
  const clicks = Math.round(amount / WHEEL_DELTA);
  const script = `
    Add-Type -MemberDefinition @'
      [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
'@ -Name MouseUtils -Namespace Win32
    for ($i = 0; $i -lt ${Math.abs(clicks)}; $i++) {
      [Win32.MouseUtils]::mouse_event(0x0800, 0, 0, ${amount > 0 ? WHEEL_DELTA : -WHEEL_DELTA}, 0)
      Start-Sleep -Milliseconds 50
    }
  `;
  await runPowerShell(script);
  console.log(`[DesktopAutomation] Scrolled ${amount}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard
// ─────────────────────────────────────────────────────────────────────────────

async function typeText(text) {
  if (!text) return;
  // Use WScript.Shell.SendKeys via VBScript-like approach in PowerShell
  const escaped = text
    .replace(/'/g, "''")
    .replace(/"/g, '`"')
    .replace(/\+/g, '{+}')
    .replace(/\^/g, '{^}')
    .replace(/%/g, '{%}')
    .replace(/~/g, '{~}')
    .replace(/\(/g, '{(}')
    .replace(/\)/g, '{)}')
    .replace(/\{/g, '{{}')
    .replace(/\}/g, '{}}')
    .replace(/\[/g, '{[}')
    .replace(/\]/g, '{]}');

  const script = `
    $wshell = New-Object -ComObject WScript.Shell
    $wshell.SendKeys('${escaped}')
  `;
  await runPowerShell(script);
  console.log(`[DesktopAutomation] Typed: ${text.substring(0, 50)}`);
}

async function pressKey(key) {
  const keyMap = {
    'enter': '~',
    'tab': '\t',
    'escape': '{ESC}',
    'esc': '{ESC}',
    'delete': '{DEL}',
    'backspace': '{BACKSPACE}',
    'space': ' ',
    'up': '{UP}',
    'down': '{DOWN}',
    'left': '{LEFT}',
    'right': '{RIGHT}',
  };
  const mapped = keyMap[key.toLowerCase()] || key;
  const escaped = mapped.replace(/'/g, "''");
  const script = `
    $wshell = New-Object -ComObject WScript.Shell
    $wshell.SendKeys('${escaped}')
  `;
  await runPowerShell(script);
  console.log(`[DesktopAutomation] Pressed key: ${key}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mouse position
// ─────────────────────────────────────────────────────────────────────────────

async function getMousePosition() {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $pos = [System.Windows.Forms.Cursor]::Position
    Write-Output "$($pos.X),$($pos.Y)"
  `;
  const result = await runPowerShell(script);
  const [x, y] = result.split(',').map(Number);
  return { x, y };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot
// ─────────────────────────────────────────────────────────────────────────────

async function screenshot(outputPath, clip = null, cursorOffset = null, cursorPosition = null, cursorImagePath = null) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const hasClip = clip && clip.width > 0 && clip.height > 0;
  const safePath = outputPath.replace(/\\/g, '\\\\');

  // Dibujamos un puntero de ratón real sobre la captura.
  // CopyFromScreen no captura el cursor real de Windows, así que lo superponemos manualmente.
  // En modo recorte (clip), las coordenadas del bitmap empiezan en (clip.x, clip.y), así que
  // debemos restar ese offset para dibujar el cursor dentro del recorte.
  // Si se proporciona cursorPosition (coordenadas absolutas de pantalla), se dibuja ahí.
  // Si no, se dibuja en la posición actual del ratón real.
  const clipX = hasClip ? Math.round(clip.x) : 0;
  const clipY = hasClip ? Math.round(clip.y) : 0;

  let cursorTipX, cursorTipY;
  if (cursorPosition && typeof cursorPosition.x === 'number' && typeof cursorPosition.y === 'number') {
    cursorTipX = String(Math.round(cursorPosition.x));
    cursorTipY = String(Math.round(cursorPosition.y));
  } else if (cursorOffset && typeof cursorOffset.x === 'number' && typeof cursorOffset.y === 'number') {
    // Modo legado: cursorOffset se suma a la posición actual del ratón real
    cursorTipX = `$cursorPos.X + ${Math.round(cursorOffset.x)}`;
    cursorTipY = `$cursorPos.Y + ${Math.round(cursorOffset.y)}`;
  } else {
    cursorTipX = '$cursorPos.X';
    cursorTipY = '$cursorPos.Y';
  }
  console.log('[DesktopAutomation] screenshot cursorPosition:', cursorPosition, 'cursorOffset:', cursorOffset, 'tip:', { x: cursorTipX, y: cursorTipY }, 'cursorImagePath:', cursorImagePath);

  // Default cursor: clean white arrow with black outline rendered as PNG.
  // .cur files are hard to draw reliably into a memory bitmap, so we ship a PNG.
  const defaultCursorPath = path.resolve(__dirname, 'cursors', 'default.png');
  const effectiveCursorPath = cursorImagePath && fs.existsSync(cursorImagePath)
    ? cursorImagePath
    : (fs.existsSync(defaultCursorPath) ? defaultCursorPath : null);
  console.log('[DesktopAutomation] effective cursor:', effectiveCursorPath, '| requested:', cursorImagePath);
  const safeCursorPath = effectiveCursorPath ? effectiveCursorPath.replace(/\\/g, '\\\\') : null;

  // Build PowerShell snippet to draw the chosen image cursor.
  let drawCursor;
  if (safeCursorPath) {
    const ext = path.extname(effectiveCursorPath || '').toLowerCase();
    if (ext === '.cur') {
      // Fallback: try to load as Windows Forms cursor; may render in system colors.
      drawCursor = `
    $cursorPos = [System.Windows.Forms.Cursor]::Position
    $tipX = ${cursorTipX} - ${clipX}
    $tipY = ${cursorTipY} - ${clipY}
    $cursor = New-Object System.Windows.Forms.Cursor('${safeCursorPath}')
    $drawX = $tipX - $cursor.HotSpot.X
    $drawY = $tipY - $cursor.HotSpot.Y
    $rect = New-Object System.Drawing.Rectangle($drawX, $drawY, $cursor.Size.Width, $cursor.Size.Height)
    $cursor.Draw($graphics, $rect)
    $cursor.Dispose()
      `;
    } else if (ext === '.ico') {
      drawCursor = `
    $cursorPos = [System.Windows.Forms.Cursor]::Position
    $tipX = ${cursorTipX} - ${clipX}
    $tipY = ${cursorTipY} - ${clipY}
    $icon = New-Object System.Drawing.Icon('${safeCursorPath}')
    $graphics.DrawIcon($icon, $tipX, $tipY)
    $icon.Dispose()
      `;
    } else {
      // PNG / BMP / GIF / JPG
      drawCursor = `
    $cursorPos = [System.Windows.Forms.Cursor]::Position
    $tipX = ${cursorTipX} - ${clipX}
    $tipY = ${cursorTipY} - ${clipY}
    $cursorImg = [System.Drawing.Image]::FromFile('${safeCursorPath}')
    $graphics.DrawImage($cursorImg, $tipX, $tipY, $cursorImg.Width, $cursorImg.Height)
    $cursorImg.Dispose()
      `;
    }
  } else {
    // Fallback polygon cursor if no image cursor is available
    drawCursor = `
    $cursorPos = [System.Windows.Forms.Cursor]::Position
    $tipX = ${cursorTipX} - ${clipX}
    $tipY = ${cursorTipY} - ${clipY}

    $outline = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 3)
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

    $points = New-Object System.Drawing.Point[] (12)
    $points[0]  = New-Object System.Drawing.Point(($tipX - 3), ($tipY + 6))
    $points[1]  = New-Object System.Drawing.Point($tipX, $tipY)
    $points[2]  = New-Object System.Drawing.Point(($tipX + 3), ($tipY + 6))
    $points[3]  = New-Object System.Drawing.Point(($tipX + 8), ($tipY + 22))
    $points[4]  = New-Object System.Drawing.Point(($tipX + 5), ($tipY + 22))
    $points[5]  = New-Object System.Drawing.Point($tipX, ($tipY + 13))
    $points[6]  = New-Object System.Drawing.Point(($tipX - 5), ($tipY + 22))
    $points[7]  = New-Object System.Drawing.Point(($tipX - 8), ($tipY + 22))
    $points[8]  = $points[0]
    $points[9]  = $points[1]
    $points[10] = $points[2]
    $points[11] = $points[3]

    $graphics.DrawPolygon($outline, $points)
    $graphics.FillPolygon($fill, $points)
    $outline.Dispose()
    $fill.Dispose()
      `;
  }

  let script;
  if (hasClip) {
    script = `
      Add-Type -AssemblyName System.Windows.Forms,System.Drawing
      $bitmap = New-Object System.Drawing.Bitmap(${Math.round(clip.width)}, ${Math.round(clip.height)})
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $sourcePoint = New-Object System.Drawing.Point(${Math.round(clip.x)}, ${Math.round(clip.y)})
      $graphics.CopyFromScreen($sourcePoint, [System.Drawing.Point]::Empty, $bitmap.Size)
      ${drawCursor}
      $bitmap.Save('${safePath}', [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bitmap.Dispose()
      Write-Output 'OK'
    `;
  } else {
    script = `
      Add-Type -AssemblyName System.Windows.Forms,System.Drawing
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      ${drawCursor}
      $bitmap.Save('${safePath}', [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bitmap.Dispose()
      Write-Output 'OK'
    `;
  }
  await runPowerShell(script);
  console.log(`[DesktopAutomation] Screenshot saved${hasClip ? ' (clipped)' : ''}: ${outputPath}`);
  return outputPath;
}

function screenshotToBase64(outputPath) {
  if (!fs.existsSync(outputPath)) return null;
  const buffer = fs.readFileSync(outputPath);
  return 'data:image/png;base64,' + buffer.toString('base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen Recording (FFmpeg gdigrab)
// ─────────────────────────────────────────────────────────────────────────────

// Calidad → CRF para la grabación en tiempo real (gdigrab + libx264).
// Mantenemos preset 'ultrafast' siempre para no perder frames; solo variamos el CRF
// (más bajo = más calidad y archivo mayor). El merge/build posterior usa preset+CRF.
function recordingCrfForQuality(quality) {
  switch (quality) {
    case 'low':    return 28;
    case 'medium': return 23;
    case 'ultra':  return 16;
    case 'high':
    default:       return 20;
  }
}

function startRecording(outputPath, clip = null, quality = 'high') {
  return new Promise((resolve, reject) => {
    if (recordingProcess) {
      return reject(new Error('Recording already in progress'));
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // FFmpeg gdigrab: record primary monitor desktop into a temporary AVI,
    // then remux to MP4 on stop. This avoids the "moov atom missing" corruption
    // that can happen when FFmpeg is killed before it flushes the MP4 index.
    const tempPath = outputPath.replace(/\.mp4$/i, '.avi');

    const crf = recordingCrfForQuality(quality);

    const args = [
      '-y',
      '-f', 'gdigrab',
      '-framerate', '30',
      '-draw_mouse', '1',
    ];

    if (clip && typeof clip.width === 'number' && clip.width > 0 && typeof clip.height === 'number' && clip.height > 0) {
      const cx = Math.round(clip.x);
      const cy = Math.round(clip.y);
      // Ensure width/height are even numbers for x264
      const cw = Math.round(clip.width) & ~1;
      const ch = Math.round(clip.height) & ~1;
      args.push(
        '-offset_x', String(cx),
        '-offset_y', String(cy),
        '-video_size', `${cw}x${ch}`
      );
      console.log(`[DesktopAutomation] Recording region: offset=(${cx},${cy}) size=${cw}x${ch}`);
    } else {
      console.log('[DesktopAutomation] Recording full desktop');
    }

    args.push(
      '-i', 'desktop',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
      tempPath,
    );

    recordingOutputPath = outputPath;
    try {
      recordingProcess = spawn(FFMPEG_PATH, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (recordingProcess.stdin) {
        recordingProcess.stdin.on('error', (err) => {
          console.warn('[DesktopAutomation] Recording process stdin error:', err.message);
        });
      }
      if (recordingProcess.stdout) {
        recordingProcess.stdout.on('error', (err) => {
          console.warn('[DesktopAutomation] Recording process stdout error:', err.message);
        });
      }
    } catch (spawnErr) {
      console.error('[DesktopAutomation] Failed to spawn FFmpeg recording process:', spawnErr);
      recordingProcess = null;
      recordingOutputPath = null;
      return reject(spawnErr);
    }

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        if (recordingProcess) {
          try { recordingProcess.kill(); } catch {}
        }
        recordingProcess = null;
        recordingOutputPath = null;
        reject(new Error('FFmpeg recording failed to start within 10s'));
      }
    }, 10000);

    recordingProcess.stderr.on('data', (data) => {
      const str = data.toString();
      // FFmpeg outputs progress to stderr; look for "frame=" to confirm it's running
      if (str.includes('frame=') && !started) {
        started = true;
        clearTimeout(timeout);
        console.log(`[DesktopAutomation] Recording started: ${tempPath}`);
        resolve({ outputPath: tempPath, pid: recordingProcess.pid });
      }
    });

    recordingProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (!started && code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    recordingProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!recordingProcess) {
      return resolve({ outputPath: recordingOutputPath, message: 'No recording in progress' });
    }

    const processRef = recordingProcess;
    const finalOutputPath = recordingOutputPath;
    const tempPath = finalOutputPath.replace(/\.mp4$/i, '.avi');

    const cleanup = () => {
      recordingProcess = null;
      recordingOutputPath = null;
    };

    const onClose = () => {
      cleanup();
      // Remux AVI to MP4 to produce a valid, seekable file
      const remuxArgs = [
        '-y',
        '-i', tempPath,
        '-c:v', 'copy',
        '-movflags', '+faststart',
        finalOutputPath,
      ];
      let remux;
      try {
        remux = spawn(FFMPEG_PATH, remuxArgs, { windowsHide: true });
      } catch (spawnErr) {
        console.error('[DesktopAutomation] Remux spawn failed:', spawnErr.message);
        try { fs.unlinkSync(tempPath); } catch {}
        return reject(spawnErr);
      }

      remux.on('close', (code) => {
        try { fs.unlinkSync(tempPath); } catch {}
        if (code !== 0) {
          console.error(`[DesktopAutomation] Remux to MP4 failed with code ${code}`);
          return reject(new Error('Failed to finalize MP4'));
        }
        console.log(`[DesktopAutomation] Recording stopped and finalized: ${finalOutputPath}`);
        resolve({ outputPath: finalOutputPath, message: 'Recording stopped' });
      });
      remux.on('error', (err) => {
        try { fs.unlinkSync(tempPath); } catch {}
        reject(err);
      });
    };

    // If the process has already exited
    if (processRef.exitCode !== null || processRef.killed) {
      console.warn('[DesktopAutomation] Recording process already exited with code:', processRef.exitCode);
      cleanup();
      if (fs.existsSync(tempPath)) {
        onClose();
      } else {
        reject(new Error('Recording process exited prematurely and no temp file was found'));
      }
      return;
    }

    // Graceful stop via stdin 'q'
    if (processRef.stdin && processRef.stdin.writable) {
      try {
        processRef.stdin.write('q');
      } catch (err) {
        console.warn('[DesktopAutomation] Error writing q to stdin:', err.message);
      }
    }

    // Force kill after 5 seconds if graceful stop doesn't work
    const forceKill = setTimeout(() => {
      try { processRef.kill('SIGTERM'); } catch {}
    }, 5000);

    processRef.on('close', () => {
      clearTimeout(forceKill);
      onClose();
    });
  });
}

function isRecording() {
  return recordingProcess !== null && !recordingProcess.killed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execute Action (unified dispatch)
// ─────────────────────────────────────────────────────────────────────────────

async function executeDesktopAction(action) {
  const { type, target, value, x, y } = action;
  const actionType = (type || '').toLowerCase();
  let realCursorPosition = null;

  console.log(`[DesktopAutomation] Executing action: ${actionType}`, { target, value, x, y });

  switch (actionType) {
    case 'click': {
      if (x != null && y != null) {
        const moveResult = await moveMouse(x, y);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
        await new Promise(r => setTimeout(r, 200));
        await mouseClick('left');
      } else if (value && value.includes(',')) {
        const [cx, cy] = value.split(',').map(Number);
        const moveResult = await moveMouse(cx, cy);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
        await new Promise(r => setTimeout(r, 200));
        await mouseClick('left');
      } else if (target) {
        // For desktop mode, target is less useful unless we have coordinates
        console.warn('[DesktopAutomation] Click without coordinates — skipping');
      }
      break;
    }
    case 'doubleclick': {
      if (x != null && y != null) {
        const moveResult = await moveMouse(x, y);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
        await doubleClick();
      } else if (value && value.includes(',')) {
        const [cx, cy] = value.split(',').map(Number);
        const moveResult = await moveMouse(cx, cy);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
        await doubleClick();
      }
      break;
    }
    case 'move': {
      // Mover el ratón a la coordenada SIN pulsar. Se usa cuando un punto de control
      // tiene clic=false: el puntero debe ir al sitio pero no ejecutar la acción.
      if (x != null && y != null) {
        const moveResult = await moveMouse(x, y);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
      } else if (value && value.includes(',')) {
        const [cx, cy] = value.split(',').map(Number);
        const moveResult = await moveMouse(cx, cy);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
      }
      break;
    }
    case 'type': {
      // Si se proporcionan coordenadas, hacemos clic primero para enfocar el campo.
      if (x != null && y != null) {
        const moveResult = await moveMouse(x, y);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
        await new Promise(r => setTimeout(r, 200));
        await mouseClick('left');
        await new Promise(r => setTimeout(r, 300));
      } else if (target && target.includes(',')) {
        const [cx, cy] = target.split(',').map(Number);
        const moveResult = await moveMouse(cx, cy);
        const [rx, ry] = moveResult.split(',').map(Number);
        realCursorPosition = { x: rx, y: ry };
        await mouseClick('left');
        await new Promise(r => setTimeout(r, 300));
      }
      if (value) await typeText(value);
      break;
    }
    case 'scroll': {
      await scroll(parseInt(value || '300', 10));
      break;
    }
    case 'navigate':
    case 'wait': {
      const waitMs = Math.min(parseInt(value || '500', 10), 30000);
      await new Promise(r => setTimeout(r, waitMs));
      break;
    }
    case 'keypress': {
      if (value) await pressKey(value);
      break;
    }
    default:
      console.warn(`[DesktopAutomation] Unknown action type: ${type}`);
  }

  return realCursorPosition;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  moveMouse,
  mouseClick,
  doubleClick,
  scroll,
  typeText,
  pressKey,
  getMousePosition,
  screenshot,
  screenshotToBase64,
  startRecording,
  stopRecording,
  isRecording,
  executeDesktopAction,
};
