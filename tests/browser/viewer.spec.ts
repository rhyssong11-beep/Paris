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

test('animates local traffic, pauses it, and adapts its density without displacing the tower', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openFromMap(page);
  const quality = page.getByRole('combobox', { name: '3D 화질' });
  await quality.selectOption('high');
  const state = () => page.evaluate(() => {
    const { scene, traffic, camera } = (window as any).viewer3d;
    const tower = scene.getObjectByName('Tower_Iron');
    tower.geometry.computeBoundingBox();
    const centre = tower.geometry.boundingBox.getCenter(camera.position.clone()).applyMatrix4(tower.matrixWorld);
    return { pedestrians: traffic.simulation.pedestrians.length, cars: traffic.simulation.cars.length,
      time: traffic.simulation.time, travelled: traffic.simulation.cars[0].travelled, centre: [centre.x, centre.z] };
  });
  const before = await state();
  expect(before.pedestrians).toBe(160); expect(before.cars).toBe(32);
  expect(Math.hypot(...before.centre)).toBeLessThan(0.1);
  await expect.poll(async () => (await state()).travelled).toBeGreaterThan(before.travelled);
  await page.getByRole('button', { name: '사람·차량 이동', exact: true }).click();
  const stopped = await state();
  await page.getByRole('button', { name: '☀ 낮', exact: true }).click();
  await page.getByRole('button', { name: '거리 보기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).viewer3d.controls.target.z)).toBeCloseTo(163, 0);
  expect((await state()).time).toBe(stopped.time);
  await quality.selectOption('low');
  expect((await state()).pedestrians).toBe(56); expect((await state()).cars).toBe(12);
  await page.getByRole('button', { name: '사람·차량 이동', exact: true }).click();
  await expect.poll(async () => (await state()).time).toBeGreaterThan(stopped.time);
  await page.getByRole('button', { name: '☾ 밤', exact: true }).click();
  expect(await page.evaluate(() => (window as any).viewer3d.scene.getObjectByName('Vehicle_LightPools').visible)).toBe(true);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
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

test('walk around the tower on foot with W/A/S/D and leave with Escape', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openFromMap(page);
  const walkButton = page.locator('#viewer [data-act=walk]');
  await walkButton.click();
  await expect(walkButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#viewer .v-cross')).toBeVisible();
  await expect(page.locator('#viewer .v-hint')).toContainText('W A S D');
  // The camera glides down to eye level (a person's height above the ground it stands on).
  await page.waitForFunction(() => {
    const { walk, camera } = (window as any).viewer3d;
    return walk.active && Math.abs(camera.position.y - (walk.walker.y + 1.68)) < 0.05;
  }, null, { timeout: 30000 });
  const before = await page.evaluate(() => ({ ...(window as any).viewer3d.walk.walker }));
  expect(before.y).toBeLessThan(3);

  // Forward (W) heads towards the tower at the origin; the camera follows the walker.
  await page.keyboard.down('KeyW');
  await page.waitForFunction((z) => (window as any).viewer3d.walk.walker.z < z - 0.5, before.z, { timeout: 30000 });
  await page.keyboard.up('KeyW');
  const cam = await page.evaluate(() => {
    const { walk, camera } = (window as any).viewer3d;
    return { dx: camera.position.x - walk.walker.x, dz: camera.position.z - walk.walker.z, orbit: (window as any).viewer3d.controls.enabled };
  });
  expect(Math.hypot(cam.dx, cam.dz)).toBeLessThan(0.01);
  expect(cam.orbit).toBe(false);
  // Sideways (D) moves along x without turning.
  const mid = await page.evaluate(() => ({ ...(window as any).viewer3d.walk.walker }));
  await page.keyboard.down('KeyD');
  await page.waitForFunction((x) => (window as any).viewer3d.walk.walker.x > x + 0.3, mid.x, { timeout: 30000 });
  await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => (window as any).viewer3d.walk.walker.yaw)).toBeCloseTo(mid.yaw, 5);

  // Dragging the mouse turns the view (the fallback when the pointer cannot be captured).
  const yaw = await page.evaluate(() => (window as any).viewer3d.walk.walker.yaw);
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).viewer3d.walk.walker.yaw)).not.toBeCloseTo(yaw, 2);

  // Escape leaves walk mode but keeps the viewer open; orbit controls come back.
  await page.keyboard.press('Escape');
  await expect(walkButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#viewer')).toBeVisible();
  expect(await page.evaluate(() => (window as any).viewer3d.controls.enabled)).toBe(true);
  expect(errors).toEqual([]);
});

test('open the Louvre in 3D and walk in its courtyard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => (window as any).view?.width === window.innerWidth);
  // Zoom the map in on the Louvre so its neighbours don't overlap the click.
  const point = await page.evaluate(() => {
    const { sim, view } = (window as any);
    const poi = sim.data.pois.find((p: any) => p.name === 'Musée du Louvre');
    view.cam.x = poi.x; view.cam.y = poi.y; view.cam.k = 0.5; view.invalidate();
    const [x, y] = view.toScreen(poi.x, poi.y);
    return { x, y: y - 6 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#tip')).toContainText('클릭해서 3D로 보기');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#viewer h2')).toHaveText('Musée du Louvre');
  await expect(page.locator('#viewer .v-loading')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).viewer3d.usingFallback)).toBe(false);
  // Eiffel-only controls are not offered here.
  await expect(page.locator('#viewer [data-act=street]')).toBeHidden();
  await expect(page.locator('#viewer [data-act=traffic]')).toBeHidden();
  await page.locator('#viewer [data-act=night]').click();
  await expect(page.locator('#viewer [data-act=twinkle]')).toBeHidden();

  await page.locator('#viewer [data-act=walk]').click();
  await page.waitForFunction(() => (window as any).viewer3d.walk.active && (window as any).viewer3d.walk.walker);
  const start = await page.evaluate(() => ({ ...(window as any).viewer3d.walk.walker }));
  expect(start.x).toBeCloseTo(-100, 0);
  expect(start.y).toBeCloseTo(0.3, 1); // standing on the courtyard paving
  // Walking straight at the pyramid ends at its base rather than inside it.
  const stopped = await page.evaluate(() => {
    const w = (window as any).viewer3d.walk.walker;
    for (let t = 0; t < 30; t += 1 / 30) w.step({ forward: 1, right: 0, run: false }, 1 / 30);
    return w.x;
  });
  expect(stopped).toBeLessThan(-17);
  expect(stopped).toBeGreaterThan(-22);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('open the Arc de Triomphe in 3D and walk beneath its central vault', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => (window as any).view?.width === window.innerWidth);
  const point = await page.evaluate(() => {
    const { sim, view } = (window as any);
    const poi = sim.data.pois.find((p: any) => p.name === 'Arc de Triomphe');
    view.cam.x = poi.x; view.cam.y = poi.y; view.cam.k = 0.5; view.invalidate();
    const [x, y] = view.toScreen(poi.x, poi.y);
    return { x, y: y - 6 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#tip')).toContainText('클릭해서 3D로 보기');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#viewer h2')).toHaveText('Arc de Triomphe');
  await expect(page.locator('#viewer .v-loading')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).viewer3d.usingFallback)).toBe(false);
  await page.locator('#viewer [data-act=night]').click();

  await page.locator('#viewer [data-act=walk]').click();
  await page.waitForFunction(() => (window as any).viewer3d.walk.active && (window as any).viewer3d.walk.walker);
  const start = await page.evaluate(() => ({ ...(window as any).viewer3d.walk.walker }));
  expect(start.z).toBeCloseTo(34, 0);
  expect(start.y).toBeCloseTo(0.3, 1);
  // Walk right through the Grand Central Vault alongside the Tomb of the Unknown Soldier.
  const zAfter = await page.evaluate(() => {
    const w = (window as any).viewer3d.walk.walker;
    w.place(4.2, 20, 0);
    for (let t = 0; t < 5; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
    return w.z;
  });
  expect(zAfter).toBeLessThan(-15);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('open Notre-Dame in 3D with its textures and walk across the parvis to the central portal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => (window as any).view?.width === window.innerWidth);
  const point = await page.evaluate(() => {
    const { sim, view } = (window as any);
    const poi = sim.data.pois.find((p: any) => p.name === 'Notre-Dame');
    view.cam.x = poi.x; view.cam.y = poi.y; view.cam.k = 0.5; view.invalidate();
    const [x, y] = view.toScreen(poi.x, poi.y);
    return { x, y: y - 6 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#tip')).toContainText('클릭해서 3D로 보기');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#viewer h2')).toHaveText('Notre-Dame');
  await expect(page.locator('#viewer .v-loading')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).viewer3d.usingFallback)).toBe(false);
  // The rose windows, lancets, tympanum, doors, stone and lead all receive their pictures.
  await page.waitForFunction(() => {
    const maps = new Set<string>();
    (window as any).viewer3d.scene.traverse((o: any) => { if (/^NotreDame_/.test(o.name) && o.material?.map?.image) maps.add(o.material.name); });
    return maps.size === 9;
  });
  expect(await page.evaluate(() => {
    const rose = (window as any).viewer3d.scene.getObjectByName('NotreDame_Vitrail_Glow_RoseWest');
    return rose.material.emissiveMap === rose.material.map;
  })).toBe(true);
  await page.locator('#viewer [data-act=night]').click();

  await page.locator('#viewer [data-act=walk]').click();
  await page.waitForFunction(() => (window as any).viewer3d.walk.active && (window as any).viewer3d.walk.walker);
  const start = await page.evaluate(() => ({ ...(window as any).viewer3d.walk.walker }));
  expect(start.x).toBeCloseTo(-112, 0);
  const end = await page.evaluate(() => {
    const { walk } = (window as any).viewer3d;
    const w = walk.walker;
    w.place(-112, 1.6, -Math.PI / 2); // facing east, towards the Portal of the Last Judgment
    for (let t = 0; t < 8; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
    return { x: w.x };
  });
  expect(end.x).toBeGreaterThan(-66);
  expect(end.x).toBeLessThan(-61.5);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#viewer')).toHaveCount(0);
  expect(errors).toEqual([]);
});
