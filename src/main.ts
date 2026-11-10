import './style.css';
import type { CityData } from './types';
import { Simulation, DAY } from './sim';
import { Renderer, COLORS } from './render';
import { landmarkModel, landmarkScale, Z_SCALE } from './landmarks';
import { fmtClock } from './util';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SPEEDS = [0, 30, 120, 600, 1800];
const MAX_DT = 4; // largest simulation step, seconds
const fmt = new Intl.NumberFormat('ko-KR');

async function main() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/paris.json`);
  if (!res.ok) throw new Error(`지도 데이터를 불러오지 못했습니다 (${res.status})`);
  const data: CityData = await res.json();

  const popInput = $<HTMLInputElement>('pop');
  const sim = new Simulation(data, +popInput.value);
  const live = $<HTMLCanvasElement>('live');
  const view = new Renderer($<HTMLCanvasElement>('map'), live, data, sim);
  const panel = $('panel');
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  const fit = () => (narrow() ? view.fit(0, panel.classList.contains('closed') ? 0 : window.innerHeight * 0.46) : view.fit(324, 0));
  fit();
  window.addEventListener('resize', () => {
    view.resize();
    fit();
  });
  $('togglePanel').addEventListener('click', () => panel.classList.toggle('closed'));
  $('loading').remove();

  // ---------------------------------------------------------------- speed
  let speed = 120;
  const speedBox = $('speeds');
  for (const s of SPEEDS) {
    const b = document.createElement('button');
    b.textContent = s === 0 ? '⏸' : `×${s}`;
    b.setAttribute('aria-label', s === 0 ? '일시정지' : `${s}배속`);
    b.addEventListener('click', () => setSpeed(s));
    speedBox.append(b);
  }
  const setSpeed = (s: number) => {
    speed = s;
    [...speedBox.children].forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === s)));
  };
  setSpeed(speed);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      setSpeed(speed ? 0 : 120);
    }
  });

  // ---------------------------------------------------------------- metro lines (strike toggles)
  const linesBox = $('lines');
  sim.metro.lines.forEach((l, i) => {
    const b = document.createElement('button');
    b.textContent = l.ref;
    b.style.background = l.color;
    b.style.color = luminance(l.color) > 0.5 ? '#111' : '#fff';
    b.setAttribute('aria-pressed', 'false');
    b.title = `${l.ref}호선 운행 중단/재개`;
    b.addEventListener('click', () => {
      sim.setLineClosed(i, !l.closed);
      b.setAttribute('aria-pressed', String(l.closed));
      view.invalidate();
    });
    linesBox.append(b);
  });

  // ---------------------------------------------------------------- settings
  $<HTMLInputElement>('rain').addEventListener('change', (e) => (sim.rain = (e.target as HTMLInputElement).checked));
  const popOut = $('popOut');
  popInput.addEventListener('input', () => (popOut.textContent = fmt.format(+popInput.value)));
  popInput.addEventListener('change', () => sim.setPopulation(+popInput.value));
  $('credits').innerHTML = data.attribution.map((a) => `<div>${a}</div>`).join('');

  // ---------------------------------------------------------------- camera controls
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  live.addEventListener('pointerdown', (e) => {
    live.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    live.classList.add('dragging');
  });
  live.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return hover(e.clientX, e.clientY);
    if (pointers.size === 1) {
      view.cam.x -= (e.clientX - p.x) / view.cam.k;
      view.cam.y += (e.clientY - p.y) / view.cam.k;
      moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
      view.invalidate();
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(p.x - other.x, p.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) view.zoomAt((e.clientX + other.x) / 2, (e.clientY + other.y) / 2, after / before);
    }
    p.x = e.clientX;
    p.y = e.clientY;
  });
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) live.classList.remove('dragging');
    if (moved < 6 && e.type === 'pointerup') hover(e.clientX, e.clientY);
  };
  live.addEventListener('pointerup', release);
  live.addEventListener('pointercancel', release);
  live.addEventListener('pointerleave', () => (tip.hidden = true));
  live.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // ---------------------------------------------------------------- tooltip
  const tip = $('tip');
  const chip = (line: number) => {
    const l = sim.metro.lines[line];
    return `<span class="chip" style="background:${l.color};color:${luminance(l.color) > 0.5 ? '#111' : '#fff'}">${l.ref}</span>`;
  };
  function hover(sx: number, sy: number) {
    let html = '';
    let best = 14;
    for (const tr of sim.metro.trains) {
      const [tx, ty] = view.toScreen(tr.x, tr.y);
      const d = Math.hypot(tx - sx, ty - sy);
      if (d < best) {
        best = d;
        const stops = tr.route.stops;
        html = `${chip(tr.route.line)} <b>${sim.metro.stations[stops[stops.length - 1]].name}</b> 방면<br>승객 ${tr.riders.length} / ${sim.metro.capacity}명`;
      }
    }
    if (!html) {
      best = 12;
      sim.metro.stations.forEach((s, i) => {
        const [tx, ty] = view.toScreen(s.x, s.y);
        const d = Math.hypot(tx - sx, ty - sy);
        if (d < best) {
          best = d;
          html = `<b>${s.name}</b><br>${sim.metro.stationLines[i].map(chip).join('')}<br>승강장 대기 ${sim.metro.waiting[i].length}명`;
        }
      });
    }
    if (!html) {
      best = 16;
      for (const p of data.pois) {
        const [tx, ty] = view.toScreen(p.x, p.y);
        const m = landmarkModel(p.name);
        const s = m ? landmarkScale(m, view.cam.k) * view.cam.k : 1;
        const r = m ? Math.max(14, m.radius * s * 0.7) : 12;
        const topY = m ? ty - m.height * s * Z_SCALE : ty;
        const cy = Math.min(ty, Math.max(topY, sy));
        const d = Math.hypot(tx - sx, cy - sy);
        if (d < r && d < best) {
          best = d;
          html = `<b>${p.name}</b>`;
        }
      }
    }
    tip.hidden = !html;
    if (html) {
      tip.innerHTML = html;
      tip.style.left = `${Math.min(sx + 14, window.innerWidth - 270)}px`;
      tip.style.top = `${sy + 16}px`;
    }
  }

  // ---------------------------------------------------------------- side panel
  const stateDefs: [string, string, () => number][] = [
    ['집', COLORS.home, () => sim.stats.atHome],
    ['직장', COLORS.work, () => sim.stats.atWork],
    ['여가·관광', COLORS.out, () => sim.stats.out],
    ['걷는 중', COLORS.walking, () => sim.stats.walking],
    ['승강장 대기', COLORS.waiting, () => sim.stats.waiting],
    ['메트로 탑승', COLORS.riding, () => sim.stats.riding],
  ];
  const bar = $('stateBar');
  const legend = $('stateLegend');
  const cells = stateDefs.map(([label, color]) => {
    const seg = document.createElement('i');
    seg.style.background = color;
    bar.append(seg);
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${color}"></span>${label}<b>0</b>`;
    legend.append(li);
    return { seg, num: li.querySelector('b')! };
  });
  const spark = $<HTMLCanvasElement>('spark').getContext('2d')!;
  const busy = $('busy');
  busy.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    const s = sim.metro.stations[+li.dataset.station!];
    view.cam.x = s.x;
    view.cam.y = s.y;
    view.cam.k = Math.max(view.cam.k, 0.3);
    view.invalidate();
  });
  const mins = (s: number) => (s ? `평균 ${Math.round(s / 60)}분` : '');

  function updatePanel() {
    $('day').textContent = `${Math.floor(sim.time / DAY) + 1}일차`;
    $('time').textContent = fmtClock(sim.time);
    const n = sim.agents.length || 1;
    stateDefs.forEach(([, , get], i) => {
      const v = get();
      cells[i].seg.style.width = `${(v / n) * 100}%`;
      cells[i].num.textContent = fmt.format(v);
    });
    const s = sim.stats;
    const trips = s.tripsMetro + s.tripsWalk || 1;
    $('modeMetro').textContent = `${Math.round((s.tripsMetro / trips) * 100)}% · ${mins(s.avgMetroTrip)}`;
    $('modeWalk').textContent = `${Math.round((s.tripsWalk / trips) * 100)}% · ${mins(s.avgWalkTrip)}`;
    $('trains').textContent = sim.metro.headway(sim.time) ? `${sim.metro.trains.length}대` : `${sim.metro.trains.length}대 (운행 종료)`;

    const top = sim.metro.waiting
      .map((q, i) => [q.length, i])
      .filter(([c]) => c > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 5);
    busy.innerHTML = top.length
      ? top.map(([c, i]) => `<li data-station="${i}">${sim.metro.stations[i].name}<span>${c}명</span></li>`).join('')
      : '<li style="list-style:none;color:var(--muted);cursor:default">대기 중인 승객 없음</li>';

    // 24 h sparkline of the share of people travelling.
    const { width: w, height: h } = spark.canvas;
    spark.clearRect(0, 0, w, h);
    const peak = Math.max(0.1, ...sim.history);
    spark.beginPath();
    spark.moveTo(0, h);
    for (let i = 0; i < 144; i++) spark.lineTo(((i + 0.5) / 144) * w, h - (sim.history[i] / peak) * (h - 22));
    spark.lineTo(w, h);
    spark.fillStyle = 'rgba(255, 209, 102, 0.35)';
    spark.fill();
    const nowX = (((sim.time % DAY) + DAY) % DAY) / DAY * w;
    spark.fillStyle = '#ffffff';
    spark.fillRect(nowX - 1, 0, 2, h);
    spark.fillStyle = '#8b95a7';
    spark.font = '18px system-ui, sans-serif';
    spark.textBaseline = 'top';
    for (const hour of [6, 12, 18]) spark.fillText(`${hour}시`, (hour / 24) * w - 14, 0);
    spark.textAlign = 'right';
    spark.fillText(`최대 ${Math.round(peak * 100)}%`, w, 0);
    spark.textAlign = 'left';

    // Dim the map at night.
    const hr = ((sim.time % DAY) + DAY) % DAY / 3600;
    const light = Math.min(1, Math.max(0, Math.min(hr - 5.5, 21.5 - hr) / 2));
    $('map').style.filter = `brightness(${(0.62 + 0.38 * light).toFixed(2)})`;
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  let lastPanel = 0;
  let debt = 0;
  function frame(now: number) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    debt = Math.min(debt + real * speed, MAX_DT * 16);
    while (debt >= 1) {
      const dt = Math.min(MAX_DT, debt);
      sim.step(dt);
      debt -= dt;
    }
    view.draw();
    if (now - lastPanel > 200) {
      lastPanel = now;
      updatePanel();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for debugging from the console.
  Object.assign(window, { sim, view });
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

main().catch((err) => {
  $('loading').textContent = String(err.message ?? err);
  console.error(err);
});
