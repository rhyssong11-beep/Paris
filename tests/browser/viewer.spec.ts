import { expect, test, type Page } from '@playwright/test';

async function openFromMap(page: Page, ready = true) {
  await page.waitForFunction(() => (window as any).view?.width === window.innerWidth);
  const point = await page.evaluate(() => {
    const { sim, view } = (window as any);
    const poi = sim.data.pois.find((p: any) => p.name === 'Tour Eiffel');
    const [x, y] = view.toScreen(poi.x, poi.y);
    return { x, y: y - 12 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#viewer')).toBeVisible();
  if (ready) await expect(page.locator('#viewer .v-loading')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveCount(0);
});

test('empty busy-station item is safe to click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByText('대기 중인 승객 없음', { exact: true }).click();
  expect(errors).toEqual([]);
});

for (const asset of ['eiffel.spz', 'eiffel.glb']) {
  test(`cancel while ${asset} is loading and resume the map`, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => release = resolve);
    await page.route(`**/models/${asset}`, async (route) => {
      await pending;
      await route.abort().catch(() => {});
    });
    const requested = page.waitForRequest((r) => r.url().endsWith(`/models/${asset}`));
    await openFromMap(page, false);
    await requested;
    const stopped = await page.evaluate(() => (window as any).sim.time);
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(page.locator('#viewer')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).sim.time)).toBeGreaterThan(stopped);
    release();
    await page.unroute(`**/models/${asset}`);
    await openFromMap(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#viewer')).toHaveCount(0);
  });
}

test('releases passes, shared scene textures, and the active debug handle', async ({ page }) => {
  await openFromMap(page);
  await page.evaluate(async () => {
    const counts: Record<string, number> = {};
    const urls = performance.getEntriesByType('resource').map((r) => r.name);
    for (const name of ['GTAOPass', 'UnrealBloomPass', 'OutputPass']) {
      const url = urls.find((u) => u.includes(name) && u.includes('/.vite/deps/'))!;
      const mod = await import(url);
      const original = mod[name].prototype.dispose;
      counts[name] = 0;
      mod[name].prototype.dispose = function (...args: unknown[]) { counts[name]++; return original.apply(this, args); };
    }
    counts.background = 0;
    (window as any).viewer3d.scene.background.addEventListener('dispose', () => counts.background++);
    (window as any).disposalCounts = counts;
  });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).disposalCounts)).toEqual({ GTAOPass: 1, UnrealBloomPass: 1, OutputPass: 1, background: 1 });
  expect(await page.evaluate(() => 'viewer3d' in window)).toBe(false);
});

test('supports day/night, an optional sparkle show, and persisted quality', async ({ page }) => {
  await openFromMap(page);
  expect(await page.evaluate(() => (window as any).viewer3d.usingFallback)).toBe(false);
  await page.getByRole('combobox', { name: '3D 화질' }).selectOption('low');
  await expect(page.getByRole('combobox', { name: '3D 화질' })).toHaveAttribute('data-level', 'low');
  await page.getByRole('button', { name: '☾ 밤', exact: true }).click();
  const sparkle = () => page.evaluate(() => (window as any).viewer3d.scene.getObjectByName('Tower_Sparkles').visible);
  await expect.poll(sparkle).toBe(false);
  await page.getByRole('button', { name: '반짝임 보기', exact: true }).click();
  await expect.poll(sparkle).toBe(true);
  await page.getByRole('button', { name: '☀ 낮', exact: true }).click();
  await expect.poll(sparkle).toBe(false);
  await page.keyboard.press('Escape');
  await openFromMap(page);
  await expect(page.getByRole('combobox', { name: '3D 화질' })).toHaveValue('low');
});

test('reduces automatic quality under sustained load and respects a manual choice', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  });
  await page.reload();
  await expect(page.locator('#loading')).toHaveCount(0);
  await openFromMap(page);
  const quality = page.getByRole('combobox', { name: '3D 화질' });
  await quality.selectOption('auto');
  await expect(quality).toHaveAttribute('data-level', 'high');
  await page.evaluate(() => {
    for (let i = 0; i < 300; i++) (window as any).viewer3d.quality.sample(0.05);
  });
  await expect(quality).toHaveAttribute('data-level', 'low');
  await quality.selectOption('high');
  await page.evaluate(() => {
    for (let i = 0; i < 300; i++) (window as any).viewer3d.quality.sample(0.05);
  });
  await expect(quality).toHaveAttribute('data-level', 'high');
  await page.keyboard.press('Escape');
});

test('frames a translucent splat capture and restores the map after closing', async ({ page }) => {
  // The .splat format uses 32-byte records: centre, scale, RGBA, quaternion.
  const bytes = Buffer.alloc(32 * 24);
  for (let i = 0; i < 24; i++) {
    const at = i * 32;
    bytes.writeFloatLE((i % 3 - 1) * 0.4, at);
    bytes.writeFloatLE(-i * 0.25, at + 4);
    bytes.writeFloatLE((i % 4 - 1.5) * 0.3, at + 8);
    for (const offset of [12, 16, 20]) bytes.writeFloatLE(0.1, at + offset);
    bytes.set([180, 140, 100, 40, 255, 128, 128, 128], at + 24);
  }
  await page.route('**/models/eiffel.*', (route) => {
    if (route.request().url().endsWith('.splat')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes });
    return route.fulfill({ status: 404 });
  });
  await openFromMap(page);
  expect(await page.evaluate(() => {
    const viewer = (window as any).viewer3d;
    return { mode: viewer.mode, splats: viewer.splats, finite: [...viewer.camera.position.toArray(), ...viewer.controls.target.toArray()].every(Number.isFinite) };
  })).toEqual({ mode: 'splat', splats: 24, finite: true });
  await page.getByRole('combobox', { name: '3D 화질' }).selectOption('low');
  await page.getByRole('button', { name: '닫기', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '자동 회전', exact: true })).toBeFocused();
  const stopped = await page.evaluate(() => (window as any).sim.time);
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).sim.time)).toBeGreaterThan(stopped);
});

test('falls back to a usable procedural model when the GLB is absent', async ({ page }) => {
  await page.route('**/models/eiffel.glb', (route) => route.fulfill({ status: 404 }));
  await openFromMap(page);
  expect(await page.evaluate(() => (window as any).viewer3d.usingFallback)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCount(0);
});

test('keeps the close action working when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: any[]) {
      if (type.startsWith('webgl')) return null;
      return original.call(this, type as any, ...args);
    } as typeof original;
  });
  await page.reload();
  await expect(page.locator('#loading')).toHaveCount(0);
  await openFromMap(page, false);
  await expect(page.locator('.v-loading')).toContainText('3D 보기를 불러오지 못했습니다');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('#viewer')).toHaveCount(0);
});

test('fits the controls on mobile and keeps manual quality available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFromMap(page);
  const box = await page.locator('#viewer .v-bar').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.getByRole('combobox', { name: '3D 화질' }).selectOption('high');
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCount(0);
});
