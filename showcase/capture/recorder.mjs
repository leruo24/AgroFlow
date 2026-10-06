// Records a real page as video using Chrome's own frame stream (CDP
// Page.startScreencast). Frames arrive only when the page changes, each with a
// wall-clock timestamp, so the encoded clip keeps real timing. Interaction
// events (taps/clicks/dialogs) are logged on the same clock so the composition
// can draw touch and cursor indicators exactly where and when they happened.
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export async function startRec(page, name, outDir, { width, height }) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    // Arrival time, on the same clock as the interaction events. Chrome's own
    // frame timestamps drifted by up to ~3 s on long 2x captures.
    frames.push({ t: Date.now() / 1000, data: f.data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: width, maxHeight: height });
  const rec = { name, outDir, cdp, frames, events: [], t0: Date.now() / 1000, width, height };
  rec.mark = (type, data = {}) => rec.events.push({ type, t: Date.now() / 1000, ...data });
  return rec;
}

export async function stopRec(rec, fps = 25) {
  const tEnd = Date.now() / 1000;
  await rec.cdp.send('Page.stopScreencast').catch(() => {});
  const dir = join(rec.outDir, `${rec.name}.frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fr = rec.frames;
  if (!fr.length) throw new Error(`no frames recorded for ${rec.name}`);
  const t0 = Math.min(fr[0].t, rec.t0);
  // Resample to a fixed rate: output frame k (time k/fps) shows the last
  // captured frame that had arrived by then. Exact timing, no drift.
  fr.forEach((f, i) => writeFileSync(join(dir, `src${String(i).padStart(5, '0')}.png`), Buffer.from(f.data, 'base64')));
  const total = Math.ceil((tEnd - t0) * fps);
  let j = 0;
  for (let k = 0; k < total; k++) {
    const t = t0 + k / fps;
    while (j + 1 < fr.length && fr[j + 1].t <= t) j++;
    symlinkSync(`src${String(j).padStart(5, '0')}.png`, join(dir, `out${String(k).padStart(5, '0')}.png`));
  }
  const out = join(rec.outDir, `${rec.name}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, 'out%05d.png'),
    '-vf', `scale=${rec.width}:${rec.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-r', String(fps), '-movflags', '+faststart', out]);
  const events = rec.events.map((e) => ({ ...e, t: +(e.t - t0).toFixed(3) }));
  writeFileSync(join(rec.outDir, `${rec.name}.events.json`), JSON.stringify({ duration: +(tEnd - t0).toFixed(3), width: rec.width, height: rec.height, events }, null, 2));
  rmSync(dir, { recursive: true, force: true });
  console.log(`clip ${rec.name}: ${(tEnd - t0).toFixed(1)}s, ${fr.length} frames, ${events.length} events`);
}

// Tap/click on a locator's centre, logging the point (CSS px) first.
export async function tapAt(page, rec, locator, opts = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box for tap target');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  rec.mark(opts.kind || 'tap', { x: Math.round(x), y: Math.round(y), label: opts.label || '' });
  await page.waitForTimeout(opts.lead ?? 450);
  await page.mouse.click(x, y);
}
