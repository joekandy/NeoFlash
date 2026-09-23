import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { getDynamicSymbol, SYMBOL_CATALOG, type NeoScene, type NeoSymbol, type Primitive, type SceneEvent, type SymbolDefinition, type SymbolKind, type TimelineEntry } from './neoflashEngine';

interface CanvasProps {
  scene: NeoScene;
  running: boolean;
  runKey: number;
  onFps: (fps: number) => void;
  onSymbolClick?: (symbolId: string) => void;
  clickableSymbolIds?: ReadonlySet<string>;
  symbolTestIds?: Readonly<Record<string, string>>;
}

interface DragOffset {
  x: number;
  y: number;
}

interface ActiveDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const NEON_TEXT_SIZES: Record<string, number> = {
  xs: 16,
  sm: 22,
  md: 30,
  lg: 42,
  xl: 58,
  '2xl': 82,
};

function numeric(value: string | number | boolean | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function wrapSvgText(value: string, maxCharacters: number): string[] {
  const words = value.replace(/_/g, ' ').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines[lines.length - 1];
    if (!current || current.length + word.length + 1 > maxCharacters) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines.slice(0, 4);
}

interface PongFrame {
  ballX: number;
  ballY: number;
  velocityX: number;
  velocityY: number;
  leftY: number;
  rightY: number;
  leftScore: number;
  rightScore: number;
}

type RetroGameKind = 'arcade' | 'level' | 'duel' | 'bonus';
type RetroControl = 'left' | 'right' | 'up' | 'down' | 'playerA' | 'playerB';

interface RetroGameFrame {
  offsetX: number;
  offsetY: number;
  score: number;
  selected: 'playerA' | 'playerB' | null;
  collected: string[];
}

const INITIAL_RETRO_FRAME: RetroGameFrame = {
  offsetX: 0,
  offsetY: 0,
  score: 0,
  selected: null,
  collected: [],
};

function getRetroGameKind(scene: NeoScene): RetroGameKind | null {
  const ids = new Set([...scene.primitives, ...scene.symbols].map((item) => item.id));
  if (ids.has('player') && ids.has('rival') && ids.has('coinA')) return 'arcade';
  if (ids.has('hero') && ids.has('enemy') && ids.has('platformA')) return 'level';
  if (ids.has('playerA') && ids.has('playerB') && ids.has('versus')) return 'duel';
  if (ids.has('runner') && ids.has('bonusA') && ids.has('bonusB')) return 'bonus';
  return null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function initialPongFrame(scene: NeoScene): PongFrame {
  const ball = scene.primitives.find((item) => item.id === 'ball');
  const left = scene.primitives.find((item) => item.id === 'leftPaddle');
  const right = scene.primitives.find((item) => item.id === 'rightPaddle');
  return {
    ballX: numeric(ball?.values.x, scene.stage.width / 2),
    ballY: numeric(ball?.values.y, scene.stage.height / 2),
    velocityX: 500,
    velocityY: 285,
    leftY: numeric(left?.values.y, scene.stage.height / 2 - 90),
    rightY: numeric(right?.values.y, scene.stage.height / 2 - 90),
    leftScore: 0,
    rightScore: 0,
  };
}

function basePoint(item: Primitive | NeoSymbol): { x: number; y: number } {
  if ('symbol' in item) return { x: item.x, y: item.y };
  if (item.kind === 'circle' || item.kind === 'rect' || item.kind === 'text') return { x: numeric(item.values.x, 0), y: numeric(item.values.y, 0) };
  if (item.kind === 'line') return { x: numeric(item.values.x1, 0), y: numeric(item.values.y1, 0) };
  const first = String(item.values.points || '0,0').split(/\s+/)[0]?.split(',') || ['0', '0'];
  return { x: numeric(first[0], 0), y: numeric(first[1], 0) };
}

function Animations({ entries, item, running }: { entries: TimelineEntry[]; item: Primitive | NeoSymbol; running: boolean }) {
  if (!running) return null;
  const base = basePoint(item);
  return <>{entries.map((entry, index) => {
    const duration = numeric(entry.values.duration, entry.interval);
    if (entry.action === 'move') {
      const fromX = numeric(entry.values.fromX, base.x); const fromY = numeric(entry.values.fromY, base.y);
      const toX = numeric(entry.values.toX, base.x); const toY = numeric(entry.values.toY, base.y);
      const start = `${fromX - base.x} ${fromY - base.y}`; const end = `${toX - base.x} ${toY - base.y}`;
      const values = String(entry.values.alternate) === 'true' ? `${start};${end};${start}` : `${start};${end}`;
      return <animateTransform key={index} attributeName="transform" additive="sum" type="translate" values={values} dur={`${duration}s`} repeatCount="indefinite" />;
    }
    if (entry.action === 'scale') {
      const from = numeric(entry.values.from, .8); const to = numeric(entry.values.to, 1.15);
      const matrix = (scale: number) => `matrix(${scale} 0 0 ${scale} ${base.x * (1 - scale)} ${base.y * (1 - scale)})`;
      return <animate key={index} attributeName="transform" additive="sum" values={`${matrix(from)};${matrix(to)};${matrix(from)}`} dur={`${entry.interval}s`} repeatCount="indefinite" />;
    }
    if (entry.action === 'rotate') return <animateTransform key={index} attributeName="transform" additive="sum" type="rotate" values={`${numeric(entry.values.from, 0)} ${base.x} ${base.y};${numeric(entry.values.to, 360)} ${base.x} ${base.y}`} dur={`${entry.interval}s`} repeatCount="indefinite" />;
    if (entry.action === 'fade') return <animate key={index} attributeName="opacity" values={`${numeric(entry.values.from, .2)};${numeric(entry.values.to, 1)};${numeric(entry.values.from, .2)}`} dur={`${entry.interval}s`} repeatCount="indefinite" />;
    if (entry.action === 'flicker') return <animate key={index} attributeName="opacity" values={`1;${numeric(entry.values.min, .45)};${numeric(entry.values.max, 1)};.7;1`} dur={`${entry.interval}s`} repeatCount="indefinite" />;
    if (entry.action === 'toggle') return <animate key={index} attributeName="opacity" values="1;0;1" dur={`${entry.interval}s`} repeatCount="indefinite" />;
    return null;
  })}</>;
}

function PrimitiveShape({ item }: { item: Primitive }) {
  const v = item.values;
  if (item.kind === 'circle') return <circle cx={numeric(v.x, 0)} cy={numeric(v.y, 0)} r={numeric(v.radius, 10)} fill={String(v.fill)} />;
  if (item.kind === 'rect') return <rect x={numeric(v.x, 0)} y={numeric(v.y, 0)} width={numeric(v.width, 10)} height={numeric(v.height, 10)} rx={numeric(v.rx, 0)} fill={String(v.fill)} />;
  if (item.kind === 'line') return <line x1={numeric(v.x1, 0)} y1={numeric(v.y1, 0)} x2={numeric(v.x2, 0)} y2={numeric(v.y2, 0)} stroke={String(v.stroke)} strokeWidth={numeric(v.width, 2)} strokeLinecap="round" />;
  if (item.kind === 'polygon') return <polygon points={String(v.points)} fill={String(v.fill)} />;
  return <text x={numeric(v.x, 0)} y={numeric(v.y, 0)} fill={String(v.fill)} fontSize={numeric(v.size, 24)} fontFamily="ui-monospace, monospace" fontWeight="700" letterSpacing=".08em">{String(v.text)}</text>;
}

const windows = Array.from({ length: 18 }, (_, index) => ({ x: 24 + (index % 3) * 58, y: 34 + Math.floor(index / 3) * 48 }));
const particles = Array.from({ length: 22 }, (_, index) => ({ x: (index * 67) % 1120 + 40, y: (index * 97) % 560 + 30, r: 2 + (index % 3) }));
const rainDrops = Array.from({ length: 48 }, (_, index) => ({
  x: 24 + ((index * 83) % 1450),
  length: 34 + (index % 5) * 9,
  width: 1.4 + (index % 3) * .55,
  opacity: .28 + (index % 5) * .12,
  duration: .72 + (index % 7) * .105,
  delay: -((index * 0.137) % 1.25),
  drift: 155 + (index % 4) * 18,
}));

function SymbolArtwork({ item, emotion, toggled = false, running = true, onAction }: { item: NeoSymbol; emotion?: string; toggled?: boolean; running?: boolean; onAction?: () => void }) {
  const text = String(item.values.text || 'NEON').replace(/_/g, ' ');
  const mood = emotion || String(item.values.emotion || 'happy');
  const color = String(item.values.color || '#48f7ff');
  const transform = `translate(${item.x} ${item.y}) scale(${item.scale})`;
  const isOpen = String(item.values.open) === 'true' ? !toggled : toggled;
  const pulse = running ? <animate attributeName="opacity" values=".45;1;.45" dur="1.6s" repeatCount="indefinite" /> : null;
  const catalogSvg = (SYMBOL_CATALOG.find((definition) => definition.name === item.symbol) as SymbolDefinition | undefined)?.svgPreview;
  const catalogSvgBody = catalogSvg?.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const dynamicSymbol = getDynamicSymbol(item.symbol);

  if (dynamicSymbol) return <g transform={transform}><svg width={dynamicSymbol.width} height={dynamicSymbol.height} viewBox={`0 0 ${dynamicSymbol.width} ${dynamicSymbol.height}`} overflow="visible" aria-label={dynamicSymbol.description || dynamicSymbol.name} dangerouslySetInnerHTML={{ __html: dynamicSymbol.svg }} /></g>;
  if (item.symbol === 'Highway') return <g transform={transform}><rect width="1280" height="230" fill="#090b18" /><path d="M0 42H1280M0 178H1280" stroke="#27284a" strokeWidth="7" /><path d="M40 111H260M350 111H570M660 111H880M970 111H1190" stroke="#c6ff00" strokeWidth="8" strokeLinecap="round" opacity=".72" /><path d="M0 8H1280" stroke="#48f7ff" strokeWidth="2" opacity=".45" /></g>;
  if (item.symbol === 'Bar') return <g transform={transform}><rect width="430" height="310" rx="8" fill="#111226" stroke="#ff2bd6" strokeWidth="5" /><rect x="28" y="92" width="100" height="176" fill="#070a12" stroke="#48f7ff" strokeWidth="4" /><rect x="160" y="120" width="225" height="92" rx="4" fill="#1b1236" stroke="#7c3aed" strokeWidth="3" /><path d="M0 72H430M144 72V310" stroke="#352150" strokeWidth="5" /><path d="M180 250H370" stroke="#ff2bd6" strokeWidth="7" opacity=".8" /></g>;
  if (item.symbol === 'StreetLamp') {
    const lampOn = !toggled;
    const lightColor = color === '#48f7ff' ? '#c6ff00' : color;
    return <g transform={transform}>
      <path d="M22 0V245M0 245H44M22 8H86Q104 8 104 28V42" stroke="#66708d" strokeWidth="9" fill="none" strokeLinecap="round" />
      <path d="M75 42H133L120 74H88Z" fill="#171b29" stroke="#48f7ff" strokeWidth="4" />
      <g opacity={lampOn ? 1 : .18} filter={lampOn ? 'url(#nf-glow)' : undefined}>
        <path d="M88 62H120L114 76H94Z" fill={lampOn ? '#fffde7' : '#343746'} stroke={lampOn ? lightColor : '#55596b'} strokeWidth="3" />
        <ellipse cx="104" cy="84" rx="72" ry="22" fill={lightColor} opacity={lampOn ? .24 : .02} />
        <path d="M70 77L12 190H196L136 77Z" fill={lightColor} opacity={lampOn ? .08 : 0} />
        {running && lampOn && <animate attributeName="opacity" values=".58;1;.82;1" dur=".42s" repeatCount="2" />}
      </g>
    </g>;
  }
  if (item.symbol === 'Table') return <g transform={transform}><ellipse cx="150" cy="54" rx="150" ry="48" fill={color} stroke="#ff73df" strokeWidth="4" /><path d="M38 63L22 210M260 63L278 210" stroke="#79628f" strokeWidth="15" /><ellipse cx="150" cy="54" rx="125" ry="30" fill="#21132f" opacity=".65" /></g>;
  if (item.symbol === 'Desk') return <g transform={transform}><rect width="390" height="42" rx="6" fill={color === '#48f7ff' ? '#432451' : color} stroke="#ff2bd6" strokeWidth="4" /><path d="M30 42V210M360 42V210" stroke="#6b527b" strokeWidth="18" /><rect x="250" y="48" width="105" height="72" fill="#20152e" stroke="#48f7ff" strokeWidth="3" /><path d="M262 76H344M262 101H344" stroke="#8b7a99" strokeWidth="3" /></g>;
  if (item.symbol === 'Chair') return <g transform={transform}><rect x="38" width="130" height="125" rx="26" fill={color === '#48f7ff' ? '#35224c' : color} stroke="#48f7ff" strokeWidth="5" /><rect x="24" y="118" width="160" height="45" rx="16" fill="#21152f" stroke="#ff2bd6" strokeWidth="4" /><path d="M104 163V235M48 245H160M104 225L42 260M104 225L170 260" stroke="#7b7390" strokeWidth="10" strokeLinecap="round" /></g>;
  if (item.symbol === 'Sofa') return <g transform={transform}><rect y="62" width="360" height="145" rx="34" fill={color} stroke="#ff73df" strokeWidth="5" /><rect x="48" y="35" width="126" height="110" rx="28" fill="#4e245e" /><rect x="186" y="35" width="126" height="110" rx="28" fill="#4e245e" /><rect x="-20" y="80" width="62" height="120" rx="25" fill="#5d2869" /><rect x="318" y="80" width="62" height="120" rx="25" fill="#5d2869" /><path d="M42 207V235M318 207V235" stroke="#00ffff" strokeWidth="9" /></g>;
  if (item.symbol === 'Shelf' || item.symbol === 'Bookshelf') return <g transform={transform}><rect width="260" height="360" fill="#1b1023" stroke="#8b00ff" strokeWidth="7" /><path d="M0 90H260M0 180H260M0 270H260" stroke="#6c3d72" strokeWidth="8" />{Array.from({ length: 16 }, (_, i) => <rect key={i} x={15 + (i % 4) * 61} y={18 + Math.floor(i / 4) * 90} width={26 + (i % 2) * 12} height={66} fill={['#ff2bd6', '#00ffff', '#c6ff00', '#8b00ff'][i % 4]} opacity=".85" />)}</g>;
  if (item.symbol === 'Window') return <g transform={transform}><rect width="320" height="245" fill="#05091c" stroke="#48f7ff" strokeWidth="8" /><path d="M160 0V245M0 122H320" stroke="#25345f" strokeWidth="7" />{windows.slice(0, 12).map((w, i) => <rect key={i} x={w.x} y={w.y} width="20" height="12" fill={i % 3 ? '#ff2bd6' : '#c6ff00'} opacity={i % 4 ? .7 : .25}>{running && <animate attributeName="opacity" values=".2;1;.2" dur={`${2 + (i % 4)}s`} repeatCount="indefinite" />}</rect>)}</g>;
  if (item.symbol === 'Door') return <g transform={transform}><rect width="170" height="300" fill="#110d1d" stroke="#8b00ff" strokeWidth="8" /><g transform={isOpen ? 'skewY(-12) scale(.55 1)' : undefined}><rect x="12" y="12" width="146" height="276" fill="#281537" stroke="#ff2bd6" strokeWidth="4" /><circle cx="132" cy="156" r="9" fill="#c6ff00" /></g>{isOpen && <path d="M20 20L150 70V278L20 288Z" fill="#03030a" opacity=".8" />}</g>;
  if (item.symbol === 'Floor') return <g transform={transform}><path d="M0 0H1280V250H0Z" fill={color === '#48f7ff' ? '#0c0a18' : color} /><path d="M0 0H1280M0 60H1280M0 130H1280M0 210H1280" stroke="#ff00ff" opacity=".18" /><path d="M0 250L300 0M1280 250L980 0M640 250V0" stroke="#00ffff" opacity=".16" /></g>;
  if (item.symbol === 'Wall') return <g transform={transform}><rect width="1280" height="520" fill={color === '#48f7ff' ? '#0e0c17' : color} />{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${(i * 173) % 1200} ${40 + i * 52}h110l35 22h120`} stroke="#44354f" strokeWidth="3" opacity=".45" />)}</g>;
  if (item.symbol === 'Room') return <g transform={transform}><rect width="1280" height="500" fill={color === '#48f7ff' ? '#12101d' : color} /><path d="M0 500H1280V720H0Z" fill="#090812" /><path d="M0 500H1280M0 720L390 500M1280 720L890 500M640 720V500" stroke="#8b00ff" strokeWidth="3" opacity=".28" /></g>;
  if (item.symbol === 'CeilingLight') return <g transform={transform}><path d="M100 0V110" stroke="#655f78" strokeWidth="8" /><path d="M30 112Q100 60 170 112L148 150H52Z" fill="#342440" stroke={color} strokeWidth="5" /><ellipse cx="100" cy="152" rx="90" ry="26" fill={color} opacity=".22" />{running && <animateTransform attributeName="transform" type="rotate" values="-3 100 0;3 100 0;-3 100 0" dur="3s" repeatCount="indefinite" />}</g>;
  if (item.symbol === 'Building') return <g transform={transform}><rect width="230" height="410" fill={color === '#48f7ff' ? '#11152c' : color} stroke="#342557" strokeWidth="5" />{windows.map((w, i) => <rect key={i} x={w.x} y={w.y} width="28" height="20" fill={i % 4 === 0 ? '#ff2bd6' : i % 3 === 0 ? '#c6ff00' : '#00ffff'} opacity={i % 5 === 0 ? .18 : .75}>{running && i % 4 === 0 && <animate attributeName="opacity" values=".15;.95;.15" dur={`${2 + i % 3}s`} repeatCount="indefinite" />}</rect>)}</g>;
  if (item.symbol === 'Rooftop') return <g transform={transform}><path d="M0 180V70H120V25H210V100H340V52H470V120H590V38H760V90H900V0H1010V105H1140V55H1280V180Z" fill="#080811" stroke="#382054" strokeWidth="5" /><path d="M0 180H1280" stroke="#ff00ff" strokeWidth="3" opacity=".5" /></g>;
  if (item.symbol === 'CoffeeCup') return <g transform={transform}><path d="M15 35H120V132Q120 160 70 160Q15 160 15 132Z" fill={color === '#48f7ff' ? '#d7c7b0' : color} stroke="#ff2bd6" strokeWidth="6" /><path d="M120 62Q175 60 166 108Q160 138 120 127" fill="none" stroke="#d7c7b0" strokeWidth="13" /><path d="M42 15Q28 -8 50 -30M78 15Q62 -10 85 -35" stroke="#b9b3ca" strokeWidth="7" fill="none" opacity=".65">{running && <animate attributeName="opacity" values=".2;.9;.2" dur="2.2s" repeatCount="indefinite" />}</path></g>;

  if (item.symbol === 'IBM1989' || item.symbol === 'Monitor') return <g transform={transform}><rect width="200" height="158" rx="7" fill={item.symbol === 'IBM1989' ? '#d1c9b3' : '#252235'} stroke="#6c6a75" strokeWidth="5" /><rect x="18" y="18" width="164" height="100" rx="6" fill="#04130d" stroke="#39423e" strokeWidth="7" /><path d="M24 42H176M24 66H176M24 90H176" stroke="#00ff41" opacity=".12" /><text x="34" y="61" fill="#6eff8b" fontSize="16" fontFamily="monospace">{text}</text><text x="34" y="89" fill="#6eff8b" fontSize="13" fontFamily="monospace">NF&gt; RUN_</text><rect x="70" y="158" width="62" height="28" fill="#777184" /><rect x="38" y="184" width="128" height="16" rx="4" fill="#9992a3" />{pulse}</g>;
  if (item.symbol === 'Laptop') return <g transform={transform}><rect width="230" height="145" rx="9" fill="#211d35" stroke={color} strokeWidth="6" /><rect x="16" y="15" width="198" height="112" fill="#061526" /><text x="34" y="72" fill={color} fontSize="18" fontFamily="monospace">{text}</text><path d="M-25 148H255L220 190H10Z" fill="#3e3a4e" stroke="#8b82a0" strokeWidth="4" /><rect x="90" y="160" width="70" height="8" rx="4" fill="#00ffff" /></g>;
  if (item.symbol === 'TV') return <g transform={transform}><rect width="250" height="205" rx="20" fill="#31263a" stroke="#8b00ff" strokeWidth="7" /><rect x="20" y="23" width="175" height="142" rx="16" fill="#080a13" stroke="#797184" strokeWidth="5" />{Array.from({ length: 12 }, (_, i) => <path key={i} d={`M28 ${34 + i * 11}H187`} stroke={i % 2 ? '#00ffff' : '#f5f5ff'} strokeWidth="5" opacity={.15 + (i % 4) * .12}>{running && <animate attributeName="opacity" values=".1;.6;.2" dur={`${.25 + i * .03}s`} repeatCount="indefinite" />}</path>)}<circle cx="222" cy="63" r="13" fill="#ff2bd6" /><circle cx="222" cy="105" r="13" fill="#48f7ff" /><path d="M45 205L30 235M205 205L220 235" stroke="#777083" strokeWidth="9" /></g>;
  if (item.symbol === 'Phone') return <g transform={transform}><rect y="48" width="145" height="120" rx="20" fill="#2b2138" stroke={color} strokeWidth="5" /><path d="M18 42Q72 -5 127 42L112 70Q72 45 32 70Z" fill="#ff2bd6" stroke="#8d739d" strokeWidth="4" /><circle cx="72" cy="112" r="35" fill="#0b0911" stroke="#48f7ff" strokeWidth="5" />{[0,60,120,180,240,300].map((deg) => <circle key={deg} cx={72 + Math.cos(deg * Math.PI / 180) * 22} cy={112 + Math.sin(deg * Math.PI / 180) * 22} r="5" fill="#c6ff00" />)}</g>;
  if (item.symbol === 'BulbLamp') return <g transform={transform}><path d="M95 0V88" stroke="#746b83" strokeWidth="8" /><path d="M35 82H155L135 145H55Z" fill="#4b3658" stroke={color} strokeWidth="5" /><circle cx="95" cy="135" r="22" fill={toggled ? '#443d32' : color} /><ellipse cx="95" cy="160" rx="110" ry="48" fill={color} opacity={toggled ? .02 : .2} />{!toggled && pulse}</g>;
  if (item.symbol === 'FloorLamp') return <g transform={transform}><path d="M95 108V330M35 330H155" stroke="#756b82" strokeWidth="11" strokeLinecap="round" /><path d="M20 0H170L145 110H45Z" fill="#3b2d46" stroke={color} strokeWidth="6" /><ellipse cx="95" cy="112" rx="110" ry="42" fill={color} opacity={toggled ? .02 : .22} />{!toggled && pulse}</g>;
  if (item.symbol === 'Keyboard') return <g transform={transform}><path d="M20 0H280L310 100H0Z" fill="#242132" stroke={color} strokeWidth="5" />{Array.from({ length: 24 }, (_, i) => <rect key={i} x={16 + (i % 8) * 35} y={16 + Math.floor(i / 8) * 27} width="25" height="16" rx="3" fill={i % 5 === 0 ? '#ff2bd6' : '#5c5570'} />)}</g>;
  if (item.symbol === 'Speaker') return <g transform={transform}><rect width="170" height="280" rx="12" fill="#11121d" stroke={color} strokeWidth="6" /><circle cx="85" cy="92" r="45" fill="#090a12" stroke="#ff2bd6" strokeWidth="7" /><circle cx="85" cy="205" r="58" fill="#090a12" stroke={color} strokeWidth="8" /><circle cx="85" cy="205" r="19" fill="#ff2bd6" />{running && <><path d="M185 70Q235 140 185 215" fill="none" stroke={color} strokeWidth="8">{pulse}</path><path d="M205 42Q285 140 205 245" fill="none" stroke={color} strokeWidth="5">{pulse}</path></>}</g>;
  if (item.symbol === 'ArcadeCabinet') return <g transform={transform}><path d="M20 0H220L245 90L220 360H10L0 90Z" fill="#251339" stroke={color} strokeWidth="7" /><rect x="35" y="45" width="175" height="120" rx="8" fill="#030914" stroke="#00ffff" strokeWidth="5" /><text x="122" y="110" textAnchor="middle" fill={color} fontFamily="monospace" fontSize="24" fontWeight="900">{text}</text><path d="M20 190H225L210 255H30Z" fill="#48204f" /><circle cx="85" cy="219" r="13" fill="#c6ff00" /><circle cx="152" cy="216" r="10" fill="#ff2bd6" /><circle cx="182" cy="216" r="10" fill="#00ffff" /><rect x="44" y="285" width="142" height="42" fill="#11101b" />{pulse}</g>;

  if (item.symbol === 'Sky') return <g transform={transform}><defs><linearGradient id="nf-sky-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#87CEEB" /><stop offset="100%" stopColor="#E0F4FF" /></linearGradient></defs><rect width="1280" height="720" fill="url(#nf-sky-gradient)" /></g>;
  if (item.symbol === 'Grass') {
    const grassColor = color === '#48f7ff' ? '#4a7c59' : color;
    return <g transform={transform}><defs><linearGradient id="nf-grass-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={grassColor} /><stop offset="100%" stopColor="#2d5a3d" /></linearGradient></defs><rect width="1280" height="240" fill="url(#nf-grass-gradient)" />{Array.from({ length: 58 }, (_, i) => { const x = 8 + i * 22; const height = 18 + (i % 5) * 7; return <path key={i} d={`M${x} 12L${x + 7} ${12 - height}L${x + 13} 12Z`} fill={i % 3 === 0 ? '#6fa66f' : '#3f744d'} opacity={.78}>{running && <animateTransform attributeName="transform" type="rotate" values={`-3 ${x + 7} 12;4 ${x + 7} 12;-3 ${x + 7} 12`} dur={`${1.8 + (i % 4) * .35}s`} repeatCount="indefinite" />}</path>; })}</g>;
  }
  if (item.symbol === 'Sun') {
    const sunColor = color === '#48f7ff' ? '#FFD700' : color;
    return <g transform={transform} filter="url(#nf-glow)"><g stroke={sunColor} strokeWidth="8" strokeLinecap="round">{Array.from({ length: 12 }, (_, i) => { const angle = (i * Math.PI) / 6; return <line key={i} x1={100 + Math.cos(angle) * 78} y1={100 + Math.sin(angle) * 78} x2={100 + Math.cos(angle) * 112} y2={100 + Math.sin(angle) * 112} />; })}</g><circle cx="100" cy="100" r="58" fill={sunColor}>{running && <animate attributeName="r" values="56;62;56" dur="3s" repeatCount="indefinite" />}</circle><circle cx="100" cy="100" r="76" fill={sunColor} opacity=".16">{running && <animate attributeName="opacity" values=".1;.28;.1" dur="3s" repeatCount="indefinite" />}</circle></g>;
  }
  if (item.symbol === 'Dog') {
    const dogColor = color === '#48f7ff' ? '#8B5E3C' : color;
    if (toggled) return <g transform={transform}><ellipse cx="115" cy="184" rx="108" ry="32" fill="#D99A5D" opacity=".22" filter="url(#nf-soft-glow)" /><ellipse cx="116" cy="124" rx="62" ry="78" fill={dogColor} stroke="#68422d" strokeWidth="5" /><circle cx="116" cy="44" r="48" fill={dogColor} stroke="#68422d" strokeWidth="5" /><path d="M78 18L48 -13L61 49ZM151 18L181 -12L169 51Z" fill="#68422d" /><circle cx="99" cy="41" r="5" fill="#17110e" /><circle cx="133" cy="41" r="5" fill="#17110e" /><ellipse cx="116" cy="61" rx="11" ry="8" fill="#17110e" /><path d="M72 154V210M158 154V210" stroke="#68422d" strokeWidth="18" strokeLinecap="round" /><path d="M58 114Q3 80 22 34" fill="none" stroke={dogColor} strokeWidth="16" strokeLinecap="round" /></g>;
    return <g transform={transform}><ellipse cx="132" cy="150" rx="132" ry="34" fill="#D99A5D" opacity=".24" filter="url(#nf-soft-glow)" /><g>{running && <animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur=".48s" repeatCount="indefinite" />}<ellipse cx="128" cy="70" rx="106" ry="54" fill={dogColor} stroke="#68422d" strokeWidth="5" /><circle cx="228" cy="48" r="46" fill={dogColor} stroke="#68422d" strokeWidth="5" /><path d="M198 18L188 -22L220 15ZM250 17L278 -16L271 34Z" fill="#68422d" /><circle cx="242" cy="44" r="5" fill="#17110e" /><ellipse cx="268" cy="59" rx="11" ry="8" fill="#17110e" /><path d="M24 61Q-24 20 -7 -20" fill="none" stroke={dogColor} strokeWidth="17" strokeLinecap="round" />{[48, 92, 158, 202].map((x, i) => <rect key={x} x={x} y="101" width="22" height="66" rx="10" fill={i % 2 ? '#70472f' : dogColor}>{running && <animate attributeName="y" values={i % 2 ? '101;119;101' : '119;101;119'} dur=".48s" repeatCount="indefinite" />}</rect>)}</g></g>;
  }
  if (item.symbol === 'Bird') {
    const birdColor = color === '#48f7ff' ? '#334155' : color;
    return <g transform={transform} fill="none" stroke={birdColor} strokeWidth="10" strokeLinecap="round"><path d="M80 65Q42 12 0 58">{running && <animate attributeName="d" values="M80 65Q42 12 0 58;M80 65Q42 92 0 58;M80 65Q42 12 0 58" dur=".6s" repeatCount="indefinite" />}</path><path d="M80 65Q118 12 160 58">{running && <animate attributeName="d" values="M80 65Q118 12 160 58;M80 65Q118 92 160 58;M80 65Q118 12 160 58" dur=".6s" repeatCount="indefinite" />}</path>{running && <animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur=".6s" repeatCount="indefinite" />}</g>;
  }
  if (item.symbol === 'Cloud') {
    const cloudColor = color === '#48f7ff' ? '#1c2443' : color;
    return <g transform={transform} opacity=".88"><g>{running && <animateTransform attributeName="transform" type="translate" values="0 0;28 0;0 0" dur="9s" repeatCount="indefinite" />}<ellipse cx="45" cy="58" rx="45" ry="31" fill={cloudColor} /><ellipse cx="82" cy="39" rx="54" ry="40" fill={cloudColor} /><ellipse cx="127" cy="57" rx="49" ry="33" fill={cloudColor} /><rect x="27" y="54" width="121" height="35" rx="18" fill={cloudColor} /><path d="M18 76H154" stroke="#d7e0e8" strokeWidth="3" opacity=".5" /></g></g>;
  }
  if (item.symbol === 'Tree') return <g transform={transform}><path d="M110 150V330M60 330H165" stroke="#7d435c" strokeWidth="24" /><path d="M110 0L15 170H68L25 245H195L150 170H205Z" fill={color} stroke="#00ffff" strokeWidth="5" opacity=".85" /></g>;
  if (item.symbol === 'Palm') return <g transform={transform}><path d="M125 80Q95 190 120 360" stroke="#ff73df" strokeWidth="22" fill="none" /><path d="M125 82Q40 15 5 70M125 82Q65 0 55 -22M125 82Q150 0 210 -25M125 82Q210 10 260 58M125 82Q230 80 265 135" stroke={color} strokeWidth="18" fill="none" strokeLinecap="round" /></g>;
  if (item.symbol === 'Moon') return <g transform={transform}><circle cx="100" cy="100" r="82" fill={color} opacity=".18" filter="url(#nf-soft-glow)" /><circle cx="100" cy="100" r="62" fill={color} /><circle cx="72" cy="82" r="12" fill="#9aa9c8" opacity=".35" /><circle cx="125" cy="120" r="17" fill="#9aa9c8" opacity=".3" /></g>;
  if (item.symbol === 'Star') return <g transform={transform}>{particles.slice(0, Math.min(22, numeric(item.values.count, 16))).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={color}>{running && i % 3 === 0 && <animate attributeName="opacity" values=".2;1;.2" dur={`${1.2 + i % 4}s`} repeatCount="indefinite" />}</circle>)}</g>;
  if (item.symbol === 'Wave') return <g transform={transform}>
    <rect x="-240" y="96" width="1920" height="124" fill={color} opacity=".26" />
    <g>
      <path d="M-240 98Q-180 58 -120 98T0 98T120 98T240 98T360 98T480 98T600 98T720 98T840 98T960 98T1080 98T1200 98T1320 98T1440 98T1560 98T1680 98V220H-240Z" fill={color} opacity=".5" stroke="#b5f6ff" strokeWidth="6" />
      {running && <animateTransform attributeName="transform" type="translate" values="0 0;-240 0" dur="4s" repeatCount="indefinite" />}
    </g>
    <g opacity=".62">
      <path d="M-240 132Q-180 102 -120 132T0 132T120 132T240 132T360 132T480 132T600 132T720 132T840 132T960 132T1080 132T1200 132T1320 132T1440 132T1560 132T1680 132" fill="none" stroke="#48f7ff" strokeWidth="4" />
      {running && <animateTransform attributeName="transform" type="translate" values="-240 0;0 0" dur="5.5s" repeatCount="indefinite" />}
    </g>
  </g>;
  if (item.symbol === 'Fire') return <g transform={transform}>
    <ellipse cx="120" cy="198" rx="104" ry="24" fill="#FF6B00" opacity=".2" filter="url(#nf-soft-glow)" />
    <g transform="translate(120 190)">
      <g>
        <path d="M0 0C-66-8-88-60-55-108C-41-128-37-148-44-175C-7-154 9-123 11-98C39-123 48-157 37-186C96-142 97-61 54-18C39-3 21 3 0 0Z" fill="#CC2200" />
        <path d="M0-5C-43-15-59-57-31-95C-16-116-9-134-14-154C21-133 34-100 25-78C48-91 63-119 57-140C90-100 81-40 45-13C31-2 16 2 0-5Z" fill="#FF6B00" />
        <path d="M1-12C-28-28-33-55-15-76C-4-90 1-105 0-120C28-98 41-62 29-43C43-47 52-58 55-72C72-38 50-9 1-12Z" fill="#FFD700" />
        {running && <>
          <animateTransform attributeName="transform" type="translate" values="-4 0;5 -3;-3 -1;-4 0" dur=".9s" repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="scale" additive="sum" values="1 1;.96 1.11;1.04 .97;1 1" dur=".74s" repeatCount="indefinite" />
        </>}
      </g>
    </g>
    <g stroke="#5a2414" strokeWidth="6" strokeLinecap="round">
      <path d="M52 202L187 176" />
      <path d="M52 176L187 202" />
    </g>
    {[{ x: 76, y: 178, r: 5 }, { x: 105, y: 185, r: 4 }, { x: 148, y: 181, r: 5 }, { x: 177, y: 188, r: 3 }].map((ember, index) => <circle key={index} cx={ember.x} cy={ember.y} r={ember.r} fill={index % 2 ? '#FFD700' : '#FF6B00'}>{running && <><animate attributeName="opacity" values=".35;1;.4" dur={`${.55 + index * .13}s`} repeatCount="indefinite" /><animate attributeName="r" values={`${ember.r};${ember.r + 2};${ember.r}`} dur={`${.7 + index * .11}s`} repeatCount="indefinite" /></>}</circle>)}
    {[{ x: 96, delay: '-.6s' }, { x: 143, delay: '-1.8s' }].map((puff, index) => <circle key={`fire-smoke-${index}`} cx={puff.x} cy="76" r="13" fill="#958ca8" opacity="0" filter="url(#nf-soft-glow)">{running && <><animate attributeName="cy" values="76;34;-12" dur="3s" begin={puff.delay} repeatCount="indefinite" /><animate attributeName="opacity" values="0;.28;0" dur="3s" begin={puff.delay} repeatCount="indefinite" /><animate attributeName="r" values="10;17;25" dur="3s" begin={puff.delay} repeatCount="indefinite" /></>}</circle>)}
  </g>;
  if (item.symbol === 'Smoke') return <g transform={transform} fill={color} filter="url(#nf-soft-glow)">
    {[{ x: 88, y: 225, r: 22, drift: -18, delay: '0s' }, { x: 135, y: 238, r: 26, drift: 22, delay: '-1.3s' }, { x: 112, y: 215, r: 18, drift: -10, delay: '-2.5s' }].map((puff, index) => <circle key={index} cx={puff.x} cy={puff.y} r={puff.r} opacity="0">{running && <><animate attributeName="cy" values={`${puff.y};${puff.y - 82};${puff.y - 158}`} dur="4s" begin={puff.delay} repeatCount="indefinite" /><animate attributeName="cx" values={`${puff.x};${puff.x + puff.drift};${puff.x - puff.drift * .4}`} dur="4s" begin={puff.delay} repeatCount="indefinite" /><animate attributeName="r" values={`${puff.r};${puff.r * 1.25};${puff.r * 1.7}`} dur="4s" begin={puff.delay} repeatCount="indefinite" /><animate attributeName="opacity" values="0;.42;.24;0" keyTimes="0;.12;.68;1" dur="4s" begin={puff.delay} repeatCount="indefinite" /></>}</circle>)}
  </g>;
  if (item.symbol === 'Rain') return <g transform={transform} pointerEvents="none">{rainDrops.map((drop, index) => <line key={index} x1={drop.x} y1="-90" x2={drop.x - 16} y2={-90 + drop.length} stroke={index % 4 === 0 ? '#f2fbff' : color} strokeWidth={drop.width} strokeLinecap="round" opacity={drop.opacity}>{running && <animateTransform attributeName="transform" type="translate" from="0 0" to={`${-drop.drift} 900`} dur={`${drop.duration}s`} begin={`${drop.delay}s`} repeatCount="indefinite" />}</line>)}</g>;

  if (item.symbol === 'Car90') return <g transform={transform}><path d="M20 76L60 26H215L270 76H310V130H0V92Q0 76 20 76Z" fill={color === '#48f7ff' ? '#f12cbf' : color} stroke="#48f7ff" strokeWidth="5" /><path d="M82 34H140V74H54ZM150 34H205L244 74H150Z" fill="#111b3c" stroke="#7bdcff" strokeWidth="3" /><circle cx="68" cy="132" r="27" fill="#080914" stroke="#c6ff00" strokeWidth="7" /><circle cx="246" cy="132" r="27" fill="#080914" stroke="#c6ff00" strokeWidth="7" /><rect x="284" y="84" width="34" height="18" rx="5" fill="#c6ff00" /></g>;
  if (item.symbol === 'TrafficLight') return <g transform={transform}><path d="M78 250V350M20 350H136" stroke="#6d687d" strokeWidth="12" /><rect width="156" height="260" rx="35" fill="#15131f" stroke="#8b00ff" strokeWidth="7" /><circle cx="78" cy="65" r="38" fill="#ff334f">{running && <animate attributeName="opacity" values="1;.15;.15;1" dur="4s" repeatCount="indefinite" />}</circle><circle cx="78" cy="130" r="38" fill="#ffd133">{running && <animate attributeName="opacity" values=".15;1;.15;.15" dur="4s" repeatCount="indefinite" />}</circle><circle cx="78" cy="195" r="38" fill="#00ff71">{running && <animate attributeName="opacity" values=".15;.15;1;.15" dur="4s" repeatCount="indefinite" />}</circle></g>;
  if (item.symbol === 'Bus') return <g transform={transform}><rect width="430" height="185" rx="28" fill={color} stroke="#00ffff" strokeWidth="7" /><rect x="35" y="30" width="275" height="78" rx="8" fill="#091329" />{[50,120,190,260].map((x) => <path key={x} d={`M${x} 34V104`} stroke="#48f7ff" strokeWidth="4" />)}<rect x="325" y="30" width="75" height="118" fill="#161327" stroke="#ff2bd6" strokeWidth="4" /><text x="212" y="88" fill="#c6ff00" fontSize="23" fontFamily="monospace" textAnchor="middle">{text}</text><circle cx="90" cy="185" r="36" fill="#090910" stroke="#ff2bd6" strokeWidth="9" /><circle cx="350" cy="185" r="36" fill="#090910" stroke="#ff2bd6" strokeWidth="9" /></g>;
  if (item.symbol === 'Bicycle') return <g transform={transform}><circle cx="70" cy="150" r="62" fill="none" stroke={color} strokeWidth="8" /><circle cx="255" cy="150" r="62" fill="none" stroke={color} strokeWidth="8" /><path d="M70 150L135 65L190 150H70L125 150L165 25M138 65H215L255 150M145 25H190" fill="none" stroke="#ff2bd6" strokeWidth="8" strokeLinecap="round" /></g>;
  if (item.symbol === 'Motorcycle') return <g transform={transform}><circle cx="72" cy="140" r="48" fill="#070811" stroke="#00ffff" strokeWidth="9" /><circle cx="260" cy="140" r="48" fill="#070811" stroke="#00ffff" strokeWidth="9" /><path d="M70 140L130 70H210L260 140M128 70L180 140H95M210 70L245 35M220 38H280" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" /><path d="M125 64Q170 18 220 62L202 92H145Z" fill="#21152e" stroke="#ff2bd6" strokeWidth="5" /></g>;
  if (item.symbol === 'NeonSign') return <g transform={transform}><rect width="270" height="82" rx="12" fill="#130b26" stroke={color === '#48f7ff' ? '#ff2bd6' : color} strokeWidth="5" /><text x="135" y="53" textAnchor="middle" fill="#fff" stroke={color} strokeWidth="1" fontSize="29" fontFamily="monospace" fontWeight="900" letterSpacing="2">{text}</text></g>;
  if (item.symbol === 'Antenna') return <g transform={transform}><path d="M100 70V300M35 300H165M100 85L28 0M100 85L175 0" stroke="#7b748e" strokeWidth="10" strokeLinecap="round" /><circle cx="100" cy="82" r="12" fill={color} /><path d="M125 55Q185 82 125 112M145 30Q245 82 145 135" fill="none" stroke={color} strokeWidth="6">{pulse}</path></g>;

  if (item.symbol === 'Person' || item.symbol === 'Astronaut') {
    if (item.symbol === 'Astronaut') return <g transform={transform}><circle cx="85" cy="60" r="58" fill="#d9dcea" stroke={color} strokeWidth="7" /><path d="M46 48Q85 20 125 48V82Q85 112 46 82Z" fill="#07152d" stroke="#00ffff" strokeWidth="5" /><rect x="28" y="118" width="115" height="145" rx="35" fill="#d9dcea" stroke="#8b00ff" strokeWidth="7" /><path d="M30 150L-20 225M140 150L195 220M55 260L35 350M120 260L145 350" stroke="#d9dcea" strokeWidth="28" strokeLinecap="round" /><rect x="58" y="155" width="58" height="42" fill="#17172c" /><circle cx="72" cy="170" r="5" fill="#ff2bd6" /><circle cx="93" cy="170" r="5" fill="#00ff41" /></g>;
    const mouth = mood === 'sad' ? 'M61 72Q80 57 99 72' : 'M60 65Q80 82 100 65';
    return <g transform={transform}>
      <ellipse cx="80" cy="318" rx="62" ry="13" fill={color} opacity=".16" filter="url(#nf-soft-glow)" />
      <g stroke="#070b16" strokeWidth="31" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M46 130L10 208" />
        <path d="M114 130L150 208" />
        <path d="M59 220L35 306" />
        <path d="M101 220L126 306" />
      </g>
      <g stroke={color} strokeWidth="19" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M46 130L10 208" />
        <path d="M114 130L150 208" />
        <path d="M59 220L35 306" />
        <path d="M101 220L126 306" />
      </g>
      <rect x="66" y="86" width="28" height="30" rx="9" fill="#f4fbff" stroke="#070b16" strokeWidth="7" />
      <rect x="37" y="108" width="86" height="122" rx="18" fill="#f4fbff" stroke="#070b16" strokeWidth="8" />
      <path d="M43 122H117" stroke={color} strokeWidth="6" opacity=".9" />
      <circle cx="80" cy="49" r="41" fill="#f4fbff" stroke="#070b16" strokeWidth="8" />
      <circle cx="80" cy="49" r="43" fill="none" stroke={color} strokeWidth="3" opacity=".92" filter="url(#nf-soft-glow)" />
      <circle cx="65" cy="48" r="4.5" fill="#070b16" />
      <circle cx="95" cy="48" r="4.5" fill="#070b16" />
      {mood === 'surprised' ? <circle cx="80" cy="69" r="9" fill="none" stroke="#070b16" strokeWidth="5" /> : <path d={mouth} stroke="#070b16" strokeWidth="5" fill="none" strokeLinecap="round" />}
    </g>;
  }
  if (item.symbol === 'Cat') {
    const catColor = color === '#48f7ff' ? '#ff9f43' : color;
    return <g transform={transform}>
      <g>
      <ellipse cx="142" cy="172" rx="116" ry="29" fill="#ff2bd6" opacity=".16" filter="url(#nf-soft-glow)" />
      <path d="M224 132Q300 112 270 35Q258 7 238 37Q251 79 211 90" fill="none" stroke={catColor} strokeWidth="20" strokeLinecap="round" />
      <ellipse cx="142" cy="112" rx="95" ry="68" fill={catColor} stroke="#ff2bd6" strokeWidth="5" />
      <path d="M80 153V184M128 167V192M177 164V191" stroke="#713758" strokeWidth="21" strokeLinecap="round" />
      <circle cx="71" cy="73" r="57" fill={catColor} stroke="#ff2bd6" strokeWidth="5" />
      <path d="M28 42L31 0L64 30M78 29L112 1L108 49" fill={catColor} stroke="#ff2bd6" strokeWidth="5" strokeLinejoin="round" />
      <path d="M37 28L40 12L54 29M87 27L104 13L101 35" fill="#ff73df" opacity=".72" />
      <ellipse cx="55" cy="71" rx="8" ry="12" fill="#00ffff" filter="url(#nf-glow)" /><ellipse cx="88" cy="71" rx="8" ry="12" fill="#00ffff" filter="url(#nf-glow)" />
      <path d="M68 87L75 87L71 94Z" fill="#ff2bd6" /><path d="M71 94Q61 103 55 95M71 94Q81 103 88 95" fill="none" stroke="#52233e" strokeWidth="3" strokeLinecap="round" />
      <path d="M48 92L1 81M48 99L-1 101M94 92L139 80M94 100L141 105" stroke="#f8f5fe" strokeWidth="3" strokeLinecap="round" />
      <path d="M93 125Q143 146 194 119" fill="none" stroke="#00ffff" strokeWidth="7" /><circle cx="145" cy="139" r="8" fill="#ffff00" filter="url(#nf-glow)" />
      {running && <animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="2.8s" repeatCount="indefinite" />}
      </g>
    </g>;
  }
  if (item.symbol === 'YarnBall') {
    const yarnColor = color === '#48f7ff' ? '#ff2bd6' : color;
    return <g transform={transform}>
      <g>
      <ellipse cx="90" cy="151" rx="76" ry="18" fill={yarnColor} opacity=".16" filter="url(#nf-soft-glow)" />
      <circle cx="86" cy="78" r="67" fill={yarnColor} stroke="#00ffff" strokeWidth="5" />
      <path d="M31 52Q84 18 139 47M21 82Q82 48 150 72M31 112Q87 79 139 108M55 20Q98 69 119 132M28 36Q73 82 77 145M93 12Q67 68 51 127" fill="none" stroke="#ffd9fb" strokeWidth="5" strokeLinecap="round" opacity=".82" />
      <path d="M130 119Q174 134 155 161Q143 180 189 184Q221 187 231 165" fill="none" stroke={yarnColor} strokeWidth="9" strokeLinecap="round" />
      <circle cx="231" cy="165" r="6" fill="#ffff00" filter="url(#nf-glow)" />
      {running && <animateTransform attributeName="transform" type="rotate" values="-4 86 78;4 86 78;-4 86 78" dur="1.8s" repeatCount="indefinite" />}
      </g>
    </g>;
  }
  if (item.symbol === 'Shadow') return <g transform={transform}><ellipse cx="170" cy="45" rx="170" ry="45" fill={color === '#48f7ff' ? '#030207' : color} opacity=".72" filter="url(#nf-blur)" /></g>;

  if (item.symbol === 'GeometricCircle') {
    const fillColor = String(item.values.fillColor || 'transparent');
    return <g transform={transform}><circle cx="64" cy="64" r="56" fill={fillColor} stroke={color} strokeWidth="6" strokeDasharray="352" strokeLinecap="round">{running && <animate attributeName="stroke-dashoffset" values="352;0;0" dur="2.8s" repeatCount="indefinite" />}</circle><circle cx="64" cy="64" r="6" fill={color}>{running && <animate attributeName="opacity" values=".35;1;.35" dur="2s" repeatCount="indefinite" />}</circle></g>;
  }
  if (item.symbol === 'GeometricLine') {
    const lineLength = numeric(item.values.width, 280);
    return <g transform={transform}><line x1="0" y1="0" x2={lineLength} y2="0" stroke={color} strokeWidth="6" strokeLinecap="square" strokeDasharray={lineLength}>{running && <animate attributeName="stroke-dashoffset" values={`${lineLength};0;0`} dur="2.4s" repeatCount="indefinite" />}</line></g>;
  }
  if (item.symbol === 'PixelChar') {
    const altColor = String(item.values.altColor || '#ff00ff');
    const pixelMap = [[2,0],[3,0],[1,1],[2,1],[3,1],[4,1],[1,2],[2,2],[3,2],[4,2],[2,3],[3,3],[0,4],[2,4],[3,4],[5,4],[1,5],[2,5],[3,5],[4,5],[2,6],[3,6],[1,7],[4,7]];
    return <g transform={transform}>{pixelMap.map(([x, y], index) => <rect key={`${x}-${y}`} x={x * 18} y={y * 18} width="16" height="16" fill={y < 3 ? altColor : color}>{running && index % 5 === 0 && <animate attributeName="opacity" values="1;.55;1" dur={`${.8 + index * .03}s`} repeatCount="indefinite" />}</rect>)}</g>;
  }
  if (item.symbol === 'Planet') {
    const ringColor = String(item.values.ringColor || '#b388ff');
    return <g transform={transform}><circle cx="90" cy="90" r="62" fill={color} opacity=".88" /><circle cx="68" cy="62" r="18" fill="#ffffff" opacity=".22" /><path d="M40 106Q86 133 138 111" fill="none" stroke="#071128" strokeWidth="10" opacity=".28" /><ellipse cx="90" cy="90" rx="104" ry="32" fill="none" stroke={ringColor} strokeWidth="7" transform="rotate(-14 90 90)">{running && <animate attributeName="stroke-opacity" values=".35;1;.35" dur="2.6s" repeatCount="indefinite" />}</ellipse><ellipse cx="90" cy="90" rx="118" ry="42" fill="none" stroke={ringColor} strokeWidth="2" opacity=".35" transform="rotate(-14 90 90)" /></g>;
  }
  if (item.symbol === 'Particle') return <g transform={transform}>{particles.slice(0, Math.min(22, numeric(item.values.count, 18))).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={color} opacity={.25 + (i % 4) * .18}>{running && <animateTransform attributeName="transform" type="translate" values={`0 0;${i % 2 ? 12 : -12} -45;0 0`} dur={`${2.5 + i % 5}s`} repeatCount="indefinite" />}</circle>)}</g>;
  if (item.symbol === 'Glow') return <g transform={transform}><circle cx="120" cy="120" r="72" fill={color} opacity=".14" filter="url(#nf-blur)">{pulse}</circle><circle cx="120" cy="120" r="42" fill={color} opacity=".09" /></g>;
  if (item.symbol === 'Pulse') return <g transform={transform} fill="none" stroke={color}><circle cx="120" cy="120" r="42" strokeWidth="8" /><circle cx="120" cy="120" r="84" strokeWidth="5" opacity=".5" />{running && <animateTransform attributeName="transform" type="scale" values=".65;.95;.65" dur="1.4s" repeatCount="indefinite" additive="sum" />}</g>;
  if (item.symbol === 'Scanline') return <g transform={transform} opacity=".16">{Array.from({ length: 36 }, (_, i) => <rect key={i} x="0" y={i * 20} width="1280" height="3" fill={color} />)}{running && <rect width="1280" height="55" fill={color} opacity=".18"><animate attributeName="y" values="-60;720" dur="3s" repeatCount="indefinite" /></rect>}</g>;
  if (item.symbol === 'Grid') return <g transform={transform} fill="none" stroke={color} opacity=".5"><path d="M0 0H1280M0 60H1280M0 130H1280M0 220H1280M0 330H1280" /><path d="M640 0L0 330M640 0L180 330M640 0L360 330M640 0L520 330M640 0L760 330M640 0L920 330M640 0L1100 330M640 0L1280 330" /></g>;

  if (item.symbol === 'NeoFlashLogo') {
    const primary = String(item.values.primary || item.values.color || '#ff2bd6');
    const secondary = String(item.values.secondary || '#48f7ff');
    const logoTheme = String(item.values.theme || 'cyberpunk');
    const minimal = logoTheme === 'minimal';
    const pixel = logoTheme === 'retro';
    const outlineFilter = minimal ? undefined : 'url(#nf-soft-glow)';
    return <g transform={transform} aria-label="NeoFlash animated logo" data-neoflash-logo={logoTheme}>
      <g data-neoflash-logo-letter data-neoflash-logo-mode={logoTheme}>
        <path d="M22 104V18L88 104V18" fill="none" stroke={primary} strokeWidth={pixel ? 14 : 11} strokeLinecap={pixel ? 'square' : 'round'} strokeLinejoin="round" opacity={minimal ? .24 : .38} filter={outlineFilter} strokeDasharray="260" strokeDashoffset="260"><animate attributeName="stroke-dashoffset" values="260;0" dur=".75s" fill="freeze" /></path>
        <path d="M22 104V18L88 104V18" fill="none" stroke={primary} strokeWidth={pixel ? 8 : 5} strokeLinecap={pixel ? 'square' : 'round'} strokeLinejoin="round" />
      </g>
      <g data-neoflash-logo-letter data-neoflash-logo-mode={logoTheme}>
        <path d="M128 104V18H205M128 58H190" fill="none" stroke={secondary} strokeWidth={pixel ? 14 : 11} strokeLinecap={pixel ? 'square' : 'round'} strokeLinejoin="round" opacity={minimal ? .24 : .38} filter={outlineFilter} strokeDasharray="260" strokeDashoffset="260"><animate attributeName="stroke-dashoffset" values="260;0" dur=".95s" fill="freeze" /></path>
        <path d="M128 104V18H205M128 58H190" fill="none" stroke={secondary} strokeWidth={pixel ? 8 : 5} strokeLinecap={pixel ? 'square' : 'round'} strokeLinejoin="round" />
      </g>
      <g data-neoflash-logo-letter data-neoflash-logo-mode={logoTheme}>
        <text x="232" y="62" fill={primary} stroke={minimal ? 'none' : primary} strokeWidth={minimal ? 0 : .8} fontFamily={pixel ? 'ui-monospace, monospace' : minimal ? 'Inter, ui-sans-serif, sans-serif' : 'ui-monospace, SFMono-Regular, Menlo, monospace'} fontSize="31" fontWeight="1000" letterSpacing={pixel ? 2 : 4} filter={outlineFilter}>NEO</text>
        <text x="232" y="101" fill={secondary} stroke={minimal ? 'none' : secondary} strokeWidth={minimal ? 0 : .8} fontFamily={pixel ? 'ui-monospace, monospace' : minimal ? 'Inter, ui-sans-serif, sans-serif' : 'ui-monospace, SFMono-Regular, Menlo, monospace'} fontSize="31" fontWeight="1000" letterSpacing={pixel ? 2 : 4} filter={outlineFilter}>FLASH</text>
      </g>
      <line x1="225" y1="16" x2="432" y2="16" stroke={secondary} strokeWidth={pixel ? 5 : 2} strokeDasharray="207" strokeDashoffset="207" opacity={minimal ? .55 : .9}><animate attributeName="stroke-dashoffset" values="207;0" dur="1.1s" fill="freeze" /></line>
    </g>;
  }
  if (item.symbol === 'NeonNav') {
    const width = numeric(item.values.width, 1280);
    const height = numeric(item.values.height, 88);
    const logo = String(item.values.logo || 'NF').replace(/_/g, ' ');
    const items = String(item.values.items || 'Playground|Demos|Export').split('|');
    const navColor = String(item.values.color || '#39ff14');
    const itemGap = width < 800 ? 118 : 150;
    const startX = Math.max(240, width - items.length * itemGap - 28);
    return <g transform={transform}>
      <rect width={width} height={height} fill="#0a0a0f" />
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="#ff00ff" strokeWidth="1" filter="url(#nf-glow)" />
      <text x="38" y={height / 2} dy=".35em" fill={navColor} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={height * .34} fontWeight="1000" letterSpacing="3" filter="url(#nf-glow)">{logo}</text>
      {items.map((label, index) => <g key={label} role={index === 0 && onAction ? 'button' : undefined} tabIndex={index === 0 && onAction ? 0 : undefined} onClick={index === 0 && onAction ? (event) => { event.stopPropagation(); onAction(); } : undefined} onKeyDown={index === 0 && onAction ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onAction(); } } : undefined} style={{ cursor: index === 0 && onAction ? 'pointer' : 'default' }}>
        <text x={startX + index * itemGap} y={height / 2} dy=".35em" fill={index === 0 ? '#fff7ff' : '#aaa4bd'} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={width < 800 ? 14 : 16} fontWeight="800" letterSpacing="1.2">{label}</text>
      </g>)}
    </g>;
  }
  if (item.symbol === 'NeonButton') {
    const width = numeric(item.values.width, 360);
    const height = numeric(item.values.height, 72);
    const label = String(item.values.label || item.values.text || 'OPEN').replace(/_/g, ' ');
    const fill = String(item.values.color || '#ff2bd6');
    const variant = String(item.values.variant || 'primary').toLowerCase();
    const secondary = variant === 'secondary';
    const textColor = String(item.values.textColor || (secondary ? fill : '#080810'));
    const glow = String(item.values.glow ?? 'true').toLowerCase() !== 'false';
    return <g transform={transform} filter={glow ? 'url(#nf-glow)' : undefined}><rect width={width} height={height} rx="4" fill={secondary ? '#080810' : fill} stroke={fill} strokeWidth={secondary ? 3 : 2} /><rect width={width} height={height} rx="4" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;.2;0" dur=".85s" begin="mouseover" end="mouseout" repeatCount="indefinite" /></rect><text x={width / 2} y={height / 2} dy=".36em" textAnchor="middle" fill={textColor} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={Math.max(13, height * .24)} fontWeight="900" letterSpacing="1.5">{label}</text></g>;
  }
  if (item.symbol === 'NeonText') {
    const rawText = String(item.values.text || 'NEON TEXT').replace(/\\n|\|/g, '\n').replace(/_/g, ' ');
    const lines = rawText.split('\n');
    const sizeToken = String(item.values.size || 'md').toLowerCase();
    const size = NEON_TEXT_SIZES[sizeToken] ?? numeric(item.values.size, 30);
    const tracking = numeric(item.values.tracking, 1.5);
    const weight = String(item.values.weight || '800');
    const glow = String(item.values.glow ?? 'false').toLowerCase() === 'true';
    return <g transform={transform} filter={glow ? 'url(#nf-glow)' : undefined}><text x="0" y="0" textAnchor="middle" fill={color} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={size} fontWeight={weight} letterSpacing={tracking}>{lines.map((line, index) => <tspan key={`${line}-${index}`} x="0" dy={index === 0 ? 0 : size * 1.06}>{line}</tspan>)}</text></g>;
  }
  if (item.symbol === 'NeonCard') {
    const width = numeric(item.values.width, 420);
    const height = numeric(item.values.height, 260);
    const border = String(item.values.borderColor || item.values.color || '#48f7ff');
    const background = String(item.values.bgColor || '#0b0b16');
    const title = String(item.values.title || '').replace(/_/g, ' ');
    const subtitle = String(item.values.subtitle || '').replace(/_/g, ' ');
    const body = wrapSvgText(String(item.values.body || ''), Math.max(24, Math.floor(width / 11)));
    const icon = String(item.values.icon || '').toLowerCase();
    const glow = String(item.values.glow ?? 'true').toLowerCase() !== 'false';
    const iconGlyph: Record<string, string> = { spark: '✦', code: '</>', export: '↗', grid: '▦', mail: '@' };
    const patternId = `nf-card-${item.id.replace(/[^a-z0-9_-]/gi, '')}`;
    const titleY = subtitle ? 50 : 58;
    const bodyY = subtitle ? 112 : 105;
    return <g transform={transform}><defs><pattern id={patternId} width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke={border} strokeWidth="1" opacity=".07" /></pattern></defs><rect width={width} height={height} rx="8" fill={background} stroke={border} strokeWidth="3" filter={glow ? 'url(#nf-soft-glow)' : undefined} /><rect width={width} height={height} rx="8" fill={`url(#${patternId})`} />{icon && <g><rect x={width - 67} y="24" width="42" height="42" rx="4" fill={border} fillOpacity=".1" stroke={border} strokeWidth="2" /><text x={width - 46} y="46" dy=".35em" textAnchor="middle" fill={border} fontFamily="ui-monospace, monospace" fontSize="18" fontWeight="900">{iconGlyph[icon] || icon.slice(0, 2).toUpperCase()}</text></g>}{title && <text x="26" y={titleY} fill={border} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="22" fontWeight="900" letterSpacing="1.4">{title}</text>}{subtitle && <text x="26" y="79" fill="#aaa4bd" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="12" fontWeight="700" letterSpacing="1.5">{subtitle}</text>}{body.length > 0 && <text x="26" y={bodyY} fill="#d8d4e4" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="15" fontWeight="600">{body.map((line, index) => <tspan key={`${line}-${index}`} x="26" dy={index === 0 ? 0 : 25}>{line}</tspan>)}</text>}</g>;
  }
  if (item.symbol === 'NeonFooter') {
    const width = numeric(item.values.width, 1280);
    const height = numeric(item.values.height, 100);
    const footerColor = String(item.values.color || '#ff00ff');
    const label = String(item.values.text || 'NeoFlash © 2024 — Describe it. Animate it. Instantly.').replace(/_/g, ' ');
    return <g transform={transform}><rect width={width} height={height} fill="#050711" /><line x1="0" y1="1" x2={width} y2="1" stroke={footerColor} strokeWidth="1" filter="url(#nf-glow)" /><text x={width / 2} y={height / 2} dy=".35em" textAnchor="middle" fill="#aaa4bd" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={width < 800 ? 13 : 15} fontWeight="700" letterSpacing={width < 800 ? .6 : 1.5}>{label}</text></g>;
  }
  if (item.symbol === 'NeonBadge') {
    const label = String(item.values.label || 'NEOFLASH').replace(/_/g, ' ');
    const width = numeric(item.values.width, Math.max(132, label.length * 10.5 + 28));
    const height = numeric(item.values.height, 40);
    return <g transform={transform}><rect width={width} height={height} rx="2" fill="#080810" fillOpacity=".82" stroke={color} strokeWidth="2" filter="url(#nf-soft-glow)" /><text x={width / 2} y={height / 2} dy=".36em" textAnchor="middle" fill={color} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="13" fontWeight="900" letterSpacing="2.4">{label}</text></g>;
  }
  if (item.symbol === 'NeonGrid') {
    const width = numeric(item.values.width, 1280);
    const height = numeric(item.values.height, 720);
    const opacity = numeric(item.values.opacity, .08);
    const patternId = `nf-grid-${item.id.replace(/[^a-z0-9_-]/gi, '')}`;
    return <g transform={transform}><defs><pattern id={patternId} width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke={color} strokeWidth="1" opacity={opacity} /></pattern></defs><rect width={width} height={height} fill={`url(#${patternId})`} /></g>;
  }
  if (item.symbol === 'NeonScanlines') {
    const width = numeric(item.values.width, 1280);
    const height = numeric(item.values.height, 720);
    const opacity = numeric(item.values.opacity, .12);
    const patternId = `nf-scanlines-${item.id.replace(/[^a-z0-9_-]/gi, '')}`;
    return <g transform={transform}><defs><pattern id={patternId} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000" opacity={opacity} /></pattern></defs><rect width={width} height={height} fill={`url(#${patternId})`} pointerEvents="none" /></g>;
  }
  if (catalogSvgBody) return <g transform={transform} color={color} dangerouslySetInnerHTML={{ __html: catalogSvgBody }} />;
  return null;
}

export function NeoFlashSymbolPreview({ name }: { name: SymbolKind }) {
  const tall = ['Building', 'Bookshelf', 'Shelf', 'FloorLamp', 'Person', 'Astronaut', 'Tree', 'Palm', 'Antenna'].includes(name);
  const wide = ['Highway', 'Floor', 'Wall', 'Room', 'Rooftop', 'Grid', 'Scanline', 'Wave', 'Star', 'Particle', 'Sky', 'Grass', 'NeoFlashLogo', 'NeonNav', 'NeonButton', 'NeonText', 'NeonCard', 'NeonFooter', 'NeonBadge', 'NeonGrid', 'NeonScanlines'].includes(name);
  const scale = name === 'NeoFlashLogo' ? .5 : wide ? .22 : tall ? .55 : .7;
  const item: NeoSymbol = { id: `preview-${name}`, symbol: name, x: wide ? 0 : 28, y: tall ? 6 : 35, scale, values: { text: name, color: name === 'Fire' ? '#ff4d00' : '#48f7ff', count: 10 } };
  return <svg viewBox="0 0 260 250" className="h-full w-full overflow-visible" aria-hidden><defs><filter id="nf-glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter><filter id="nf-blur"><feGaussianBlur stdDeviation="8" /></filter><filter id="nf-soft-glow"><feGaussianBlur stdDeviation="5" /></filter></defs><SymbolArtwork item={item} running={false} /></svg>;
}

export default function NeoFlashCanvas({ scene, running, runKey, onFps, onSymbolClick, clickableSymbolIds, symbolTestIds }: CanvasProps) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [emotions, setEmotions] = useState<Record<string, string>>({});
  const [pongFrame, setPongFrame] = useState<PongFrame>(() => initialPongFrame(scene));
  const [retroFrame, setRetroFrame] = useState<RetroGameFrame>(INITIAL_RETRO_FRAME);
  const [dragOffsets, setDragOffsets] = useState<Record<string, DragOffset>>({});
  const [hovered, setHovered] = useState<Record<string, boolean>>({});
  const [compactLayout, setCompactLayout] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const pongFrameRef = useRef<PongFrame>(pongFrame);
  const playerTargetYRef = useRef(pongFrame.rightY);
  const retroJumpTimerRef = useRef<number | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const responsiveAnchor = scene.symbols.find((symbol) => symbol.values.mobileStageWidth !== undefined);
  const responsiveStage = compactLayout && responsiveAnchor ? {
    width: numeric(responsiveAnchor.values.mobileStageWidth, scene.stage.width),
    height: numeric(responsiveAnchor.values.mobileStageHeight, scene.stage.height),
  } : scene.stage;
  const clientToStage = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const bounds = svg.getBoundingClientRect();
    const scale = Math.min(bounds.width / responsiveStage.width, bounds.height / responsiveStage.height);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const offsetX = (bounds.width - responsiveStage.width * scale) / 2;
    const offsetY = (bounds.height - responsiveStage.height * scale) / 2;
    return {
      x: (clientX - bounds.left - offsetX) / scale,
      y: (clientY - bounds.top - offsetY) / scale,
    };
  }, [responsiveStage.height, responsiveStage.width]);
  const responsiveSymbol = (item: NeoSymbol): NeoSymbol => {
    if (!compactLayout) return item;
    const values = { ...item.values };
    if (values.mobileWidth !== undefined) values.width = values.mobileWidth;
    if (values.mobileHeight !== undefined) values.height = values.mobileHeight;
    return {
      ...item,
      x: numeric(values.mobileX, item.x),
      y: numeric(values.mobileY, item.y),
      scale: numeric(values.mobileScale, item.scale),
      values,
    };
  };
  const pongParts = useMemo(() => ({
    ball: scene.primitives.find((item) => item.id === 'ball' && item.kind === 'circle'),
    left: scene.primitives.find((item) => item.id === 'leftPaddle' && item.kind === 'rect'),
    right: scene.primitives.find((item) => item.id === 'rightPaddle' && item.kind === 'rect'),
    score: scene.primitives.find((item) => item.id === 'score' && item.kind === 'text'),
  }), [scene.primitives]);
  const isPongScene = !!(pongParts.ball && pongParts.left && pongParts.right && pongParts.score);
  const retroGameKind = useMemo(() => getRetroGameKind(scene), [scene]);
  const retroPlayerId = retroGameKind === 'arcade' ? 'player' : retroGameKind === 'level' ? 'hero' : retroGameKind === 'bonus' ? 'runner' : null;

  const handleRetroControl = useCallback((control: RetroControl) => {
    if (!retroGameKind || !running) return;
    if (retroGameKind === 'duel') {
      if (control === 'playerA' || control === 'playerB') {
        setRetroFrame((current) => ({ ...current, selected: control }));
      }
      return;
    }

    if (control === 'up' && retroGameKind !== 'arcade') {
      if (retroJumpTimerRef.current !== null) window.clearTimeout(retroJumpTimerRef.current);
      setRetroFrame((current) => ({ ...current, offsetY: -118 }));
      retroJumpTimerRef.current = window.setTimeout(() => {
        setRetroFrame((current) => ({ ...current, offsetY: 0 }));
        retroJumpTimerRef.current = null;
      }, 360);
      return;
    }

    setRetroFrame((current) => {
      const horizontalLimit = retroGameKind === 'arcade' ? 430 : retroGameKind === 'level' ? 760 : 1010;
      const minimumX = retroGameKind === 'arcade' ? -690 : retroGameKind === 'level' ? -250 : -100;
      const next: RetroGameFrame = {
        ...current,
        offsetX: control === 'left' ? clamp(current.offsetX - 72, minimumX, horizontalLimit) : control === 'right' ? clamp(current.offsetX + 72, minimumX, horizontalLimit) : current.offsetX,
        offsetY: retroGameKind === 'arcade' && control === 'up' ? clamp(current.offsetY - 54, -300, 130) : retroGameKind === 'arcade' && control === 'down' ? clamp(current.offsetY + 54, -300, 130) : current.offsetY,
      };
      const player = retroPlayerId ? scene.symbols.find((symbol) => symbol.id === retroPlayerId) : undefined;
      const collectibleIds = retroGameKind === 'arcade' ? ['coinA', 'coinB'] : retroGameKind === 'bonus' ? ['bonusA', 'bonusB', 'bonusC'] : [];
      if (!player || !collectibleIds.length) return next;
      const playerX = player.x + next.offsetX;
      const playerY = player.y + next.offsetY;
      const newlyCollected = scene.primitives
        .filter((item) => collectibleIds.includes(item.id) && !next.collected.includes(item.id))
        .filter((item) => {
          const point = basePoint(item);
          return Math.hypot(point.x - playerX, point.y - playerY) < 115;
        })
        .map((item) => item.id);
      return newlyCollected.length ? { ...next, collected: [...next.collected, ...newlyCollected], score: next.score + newlyCollected.length * 100 } : next;
    });
  }, [retroGameKind, retroPlayerId, running, scene.primitives, scene.symbols]);

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const updateMobileViewport = () => setIsMobileViewport(window.innerWidth < 768);
    updateMobileViewport();
    window.addEventListener('resize', updateMobileViewport);
    return () => window.removeEventListener('resize', updateMobileViewport);
  }, []);

  useEffect(() => () => {
    if (retroJumpTimerRef.current !== null) window.clearTimeout(retroJumpTimerRef.current);
  }, []);

  useEffect(() => {
    if (!running) { onFps(0); return; }
    let frame = 0; let previous = performance.now(); let raf = 0;
    const tick = (now: number) => { frame += 1; if (now - previous >= 500) { onFps(Math.round((frame * 1000) / (now - previous))); frame = 0; previous = now; } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); onFps(0); };
  }, [running, runKey, onFps]);

  useEffect(() => {
    setHidden({});
    setToggled({});
    setEmotions({});
    setDragOffsets({});
    setHovered({});
    dragRef.current = null;
    setRetroFrame(INITIAL_RETRO_FRAME);
    if (retroJumpTimerRef.current !== null) {
      window.clearTimeout(retroJumpTimerRef.current);
      retroJumpTimerRef.current = null;
    }
  }, [runKey]);
  useEffect(() => {
    if (!responsiveAnchor || !svgRef.current) {
      setCompactLayout(false);
      return;
    }
    const element = svgRef.current;
    const update = () => setCompactLayout(element.getBoundingClientRect().width < 680);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [responsiveAnchor, runKey]);

  useEffect(() => {
    if (!running) {
      dragRef.current = null;
      return;
    }
    const move = (event: PointerEvent) => {
      const active = dragRef.current;
      if (!active || event.pointerId !== active.pointerId) return;
      const point = clientToStage(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      setDragOffsets((current) => ({
        ...current,
        [active.id]: {
          x: active.originX + point.x - active.startX,
          y: active.originY + point.y - active.startY,
        },
      }));
    };
    const end = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [clientToStage, running]);

  useEffect(() => {
    if (!running || !svgRef.current) return;
    const letters = Array.from(svgRef.current.querySelectorAll<SVGGElement>('[data-neoflash-logo-letter]'));
    if (!letters.length) return;
    let cancelled = false;
    const timers = new Set<number>();
    const queue = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    };
    const schedule = (letter: SVGGElement, index: number) => {
      const tick = () => {
        if (cancelled) return;
        const mode = letter.dataset.neoflashLogoMode;
        const subtle = mode === 'minimal';
        const blackout = !subtle && Math.random() < .08;
        letter.style.opacity = blackout ? String(.2 + Math.random() * .22) : subtle ? String(.96 + Math.random() * .04) : String(.7 + Math.random() * .3);
        const jitter = subtle ? 0 : Math.round((Math.random() - .5) * 2);
        letter.setAttribute('transform', `translate(${jitter} ${index % 2 ? -jitter : jitter})`);
        queue(tick, 100 + Math.random() * 100);
      };
      queue(tick, 70 + index * 45);
    };
    letters.forEach(schedule);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      letters.forEach((letter) => {
        letter.style.opacity = '';
        letter.removeAttribute('transform');
      });
    };
  }, [runKey, running, scene]);

  useEffect(() => {
    if (!running || !svgRef.current) return;
    const animated = [...scene.primitives, ...scene.symbols].filter((item) => item.values.raf);
    if (!animated.length) return;
    const svg = svgRef.current;
    const groups = new Map(Array.from(svg.querySelectorAll<SVGGElement>('[data-object-id]')).map((node) => [node.getAttribute('data-object-id') || '', node]));
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - started;
      animated.forEach((item, index) => {
        const group = groups.get(item.id);
        if (!group) return;
        const mode = String(item.values.raf);
        if (mode === 'cursor') group.setAttribute('opacity', Math.floor(elapsed / 480) % 2 === 0 ? '1' : '.08');
        if (mode === 'countdown') {
          const seconds = Math.floor(elapsed / 1000);
          const hours = Math.floor(seconds / 3600);
          const minutes = Math.floor((seconds % 3600) / 60);
          const label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
          const text = group.querySelector('tspan') || group.querySelector('text');
          if (text) text.textContent = label;
        }
        if (mode === 'rain') group.setAttribute('transform', `translate(0 ${((elapsed * .42 + index * 173) % 980) - 80})`);
        if (mode === 'accent') group.setAttribute('transform', `translate(${Math.sin(elapsed / 700 + index) * 54} 0)`);
        if (mode === 'scan') group.setAttribute('transform', `translate(0 ${(elapsed / 24) % 8})`);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [runKey, running, scene]);

  useEffect(() => {
    if (!running) return;
    const timers = scene.timeline.filter((entry) => entry.action === 'emotion').map((entry) => window.setInterval(() => setEmotions((current) => ({ ...current, [entry.target]: String(entry.values.value || 'happy') })), Math.max(.1, entry.interval) * 1000));
    return () => timers.forEach((timer) => window.clearInterval(timer));
  }, [runKey, running, scene.timeline]);

  useEffect(() => {
    if (!isPongScene || !pongParts.ball || !pongParts.left || !pongParts.right) return;
    const initial = initialPongFrame(scene);
    pongFrameRef.current = initial;
    playerTargetYRef.current = initial.rightY;
    setPongFrame(initial);
    if (!running) return;

    const radius = numeric(pongParts.ball.values.radius, 22);
    const leftX = numeric(pongParts.left.values.x, 80);
    const leftWidth = numeric(pongParts.left.values.width, 24);
    const leftHeight = numeric(pongParts.left.values.height, 180);
    const rightX = numeric(pongParts.right.values.x, scene.stage.width - 104);
    const rightWidth = numeric(pongParts.right.values.width, 24);
    const rightHeight = numeric(pongParts.right.values.height, 180);
    const topWall = 24;
    const bottomWall = scene.stage.height - 24;
    let previous = performance.now();
    let raf = 0;

    const serve = (frame: PongFrame, direction: 1 | -1): PongFrame => ({
      ...frame,
      ballX: scene.stage.width / 2,
      ballY: scene.stage.height / 2,
      velocityX: 500 * direction,
      velocityY: (frame.leftScore + frame.rightScore) % 2 === 0 ? 285 : -285,
    });

    const tick = (now: number) => {
      const delta = Math.min(.032, Math.max(.001, (now - previous) / 1000));
      previous = now;
      const current = pongFrameRef.current;
      let next: PongFrame = { ...current };

      const aiTarget = current.ballY - leftHeight / 2;
      next.leftY = clamp(current.leftY + clamp(aiTarget - current.leftY, -380 * delta, 380 * delta), topWall, bottomWall - leftHeight);
      next.rightY = clamp(playerTargetYRef.current, topWall, bottomWall - rightHeight);
      next.ballX += next.velocityX * delta;
      next.ballY += next.velocityY * delta;

      if (next.ballY - radius <= topWall) {
        next.ballY = topWall + radius;
        next.velocityY = Math.abs(next.velocityY);
      } else if (next.ballY + radius >= bottomWall) {
        next.ballY = bottomWall - radius;
        next.velocityY = -Math.abs(next.velocityY);
      }

      const hitLeft = next.velocityX < 0 && next.ballX - radius <= leftX + leftWidth && next.ballX + radius >= leftX && next.ballY + radius >= next.leftY && next.ballY - radius <= next.leftY + leftHeight;
      const hitRight = next.velocityX > 0 && next.ballX + radius >= rightX && next.ballX - radius <= rightX + rightWidth && next.ballY + radius >= next.rightY && next.ballY - radius <= next.rightY + rightHeight;
      if (hitLeft) {
        next.ballX = leftX + leftWidth + radius;
        next.velocityX = Math.min(980, Math.abs(next.velocityX) * 1.045);
        next.velocityY = clamp(next.velocityY + ((next.ballY - (next.leftY + leftHeight / 2)) / (leftHeight / 2)) * 240, -720, 720);
      } else if (hitRight) {
        next.ballX = rightX - radius;
        next.velocityX = -Math.min(980, Math.abs(next.velocityX) * 1.045);
        next.velocityY = clamp(next.velocityY + ((next.ballY - (next.rightY + rightHeight / 2)) / (rightHeight / 2)) * 240, -720, 720);
      }

      if (next.ballX + radius < 0) {
        next.rightScore += 1;
        next = serve(next, -1);
      } else if (next.ballX - radius > scene.stage.width) {
        next.leftScore += 1;
        next = serve(next, 1);
      }

      pongFrameRef.current = next;
      setPongFrame(next);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPongScene, pongParts.ball, pongParts.left, pongParts.right, runKey, running, scene]);

  useEffect(() => {
    if (!retroGameKind || !running) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const control = event.key === 'ArrowLeft' || key === 'a' ? 'left' : event.key === 'ArrowRight' || key === 'd' ? 'right' : event.key === 'ArrowUp' || key === 'w' ? 'up' : event.key === 'ArrowDown' || key === 's' ? 'down' : key === '1' ? 'playerA' : key === '2' ? 'playerB' : null;
      if (!control) return;
      event.preventDefault();
      handleRetroControl(control);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRetroControl, retroGameKind, runKey, running]);

  const events = useMemo(() => {
    const map = new Map<string, SceneEvent[]>();
    scene.events.forEach((event) => {
      if (event.event === 'drag' || event.event === 'hover') {
        map.set(event.target, [...(map.get(event.target) || []), event]);
        return;
      }
      const symbol = scene.symbols.find((item) => item.id === event.target)?.symbol;
      const coherentToggle = event.action === 'toggle' && ['StreetLamp', 'BulbLamp', 'FloorLamp', 'Door', 'Dog'].includes(symbol || '');
      const coherentEmotion = event.action === 'emotion' && symbol === 'Person';
      if (coherentToggle || coherentEmotion) map.set(event.target, [...(map.get(event.target) || []), event]);
    });
    return map;
  }, [scene.events, scene.symbols]);
  const timeline = useMemo(() => { const map = new Map<string, TimelineEntry[]>(); scene.timeline.forEach((entry) => map.set(entry.target, [...(map.get(entry.target) || []), entry])); return map; }, [scene.timeline]);
  const symbols = useMemo(() => new Map(scene.symbols.map((symbol) => [symbol.id, symbol])), [scene.symbols]);

  const startDrag = (id: string, event: ReactPointerEvent<SVGGElement>) => {
    if (!running || !(events.get(id) || []).some((item) => item.event === 'drag')) return;
    const point = clientToStage(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const current = dragOffsets[id] || { x: 0, y: 0 };
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originX: current.x,
      originY: current.y,
    };
  };

  const hoverStyleFor = (id: string): CSSProperties => {
    const hoverEvent = (events.get(id) || []).find((event) => event.event === 'hover');
    if (!hoverEvent || hoverEvent.event !== 'hover' || !hovered[id]) return {};
    if (hoverEvent.action === 'opacity') return { opacity: numeric(hoverEvent.value, .7) };
    return {
      transform: `scale(${numeric(hoverEvent.value, 1.08)})`,
      transformBox: 'fill-box',
      transformOrigin: 'center',
    };
  };

  const activate = (id: string) => {
    const symbolName = symbols.get(id)?.symbol;
    if (symbolName === 'NeonButton' || symbolName === 'NeonNav') {
      console.log(`[NeoFlash] UI event: ${id}`);
      onSymbolClick?.(id);
    }
    if (!running) return;
    for (const event of events.get(id) || []) {
      if (event.event !== 'click') continue;
      if (event.action === 'toggle') {
        setToggled((current) => ({ ...current, [id]: !current[id] }));
      }
      if (event.action === 'emotion') {
        const baseEmotion = String(symbols.get(id)?.values.emotion || 'happy');
        const nextEmotion = event.value || 'happy';
        setEmotions((current) => ({ ...current, [id]: current[id] === nextEmotion ? baseEmotion : nextEmotion }));
      }
    }
  };

  const roomDimmed = scene.symbols.some((symbol) => (symbol.symbol === 'BulbLamp' || symbol.symbol === 'FloorLamp') && toggled[symbol.id]);
  const movePlayerPaddle = (clientY: number) => {
    if (!isPongScene || !pongParts.right || !svgRef.current || !running) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const scale = Math.min(bounds.width / scene.stage.width, bounds.height / scene.stage.height);
    const renderedHeight = scene.stage.height * scale;
    const offsetY = (bounds.height - renderedHeight) / 2;
    const stageY = (clientY - bounds.top - offsetY) / scale;
    const paddleHeight = numeric(pongParts.right.values.height, 180);
    playerTargetYRef.current = clamp(stageY - paddleHeight / 2, 24, scene.stage.height - 24 - paddleHeight);
  };

  const retroControlButton = (control: RetroControl, label: string, ariaLabel: string) => (
    <button
      key={control}
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        handleRetroControl(control);
      }}
      style={{
        minWidth: 48,
        minHeight: 48,
        border: '1px solid rgba(0,255,255,.75)',
        borderRadius: 8,
        background: 'rgba(0,0,0,.68)',
        color: '#fff',
        font: '900 16px ui-monospace, monospace',
        boxShadow: '0 0 14px rgba(0,255,255,.2)',
        touchAction: 'none',
      }}
    >
      {label}
    </button>
  );

  return <div className="flex h-full w-full flex-col" style={{ touchAction: isPongScene || retroGameKind ? 'none' : 'auto' }}>
  <style>{`
    .nf-canvas-svg,
    .nf-canvas-svg * {
      outline: none !important;
      -webkit-tap-highlight-color: transparent;
    }
  `}</style>
  <svg ref={svgRef} key={runKey} viewBox={`0 0 ${responsiveStage.width} ${responsiveStage.height}`} className="nf-canvas-svg min-h-0 w-full flex-1" role="img" aria-label={isPongScene ? 'Interactive NeoFlash Pong game. Move the mouse or drag a finger vertically to control the right paddle.' : retroGameKind ? `Interactive NeoFlash ${retroGameKind} game. Use keyboard or the controls below the canvas.` : 'NeoFlash animated scene'} preserveAspectRatio="xMidYMid meet" onMouseMove={isPongScene ? (event) => movePlayerPaddle(event.clientY) : undefined} onTouchMove={isPongScene ? (event) => { event.preventDefault(); const touch = event.touches[0]; if (touch) movePlayerPaddle(touch.clientY); } : undefined} style={{ touchAction: isPongScene || retroGameKind ? 'none' : 'auto', outline: 'none' }}>
    <rect width={responsiveStage.width} height={responsiveStage.height} fill={scene.stage.background} />
    <defs>
      <filter id="nf-glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <filter id="nf-soft-glow"><feGaussianBlur stdDeviation="8" /></filter>
      <filter id="nf-blur"><feGaussianBlur stdDeviation="12" /></filter>
    </defs>
    {scene.primitives.map((item) => {
      let displayedItem = item;
      if (isPongScene) {
        if (item.id === 'leftPaddle') displayedItem = { ...item, values: { ...item.values, y: pongFrame.leftY } };
        if (item.id === 'rightPaddle') displayedItem = { ...item, values: { ...item.values, y: pongFrame.rightY } };
        if (item.id === 'ball') displayedItem = { ...item, values: { ...item.values, x: pongFrame.ballX, y: pongFrame.ballY } };
        if (item.id === 'score') displayedItem = { ...item, values: { ...item.values, text: `${pongFrame.leftScore}  :  ${pongFrame.rightScore}` } };
      }
      const itemEvents = events.get(item.id) || [];
      const clickable = running && itemEvents.some((event) => event.event === 'click');
      const draggable = running && itemEvents.some((event) => event.event === 'drag');
      const hoverable = running && itemEvents.some((event) => event.event === 'hover');
      const offset = dragOffsets[item.id];
      return (
        <g
          key={item.id}
          data-object-id={item.id}
          opacity={hidden[item.id] || retroFrame.collected.includes(item.id) ? 0 : 1}
          transform={offset ? `translate(${offset.x} ${offset.y})` : undefined}
          onPointerDown={draggable ? (event) => startDrag(item.id, event) : undefined}
          onPointerUp={clickable ? () => activate(item.id) : undefined}
          onPointerEnter={hoverable ? () => setHovered((current) => ({ ...current, [item.id]: true })) : undefined}
          onPointerLeave={hoverable ? () => setHovered((current) => ({ ...current, [item.id]: false })) : undefined}
          style={{ cursor: draggable ? 'grab' : clickable ? 'pointer' : 'default', touchAction: draggable ? 'none' : 'auto' }}
        >
          <g style={hoverStyleFor(item.id)}>
            <g><PrimitiveShape item={displayedItem} /><Animations entries={isPongScene ? [] : timeline.get(item.id) || []} item={displayedItem} running={running} /></g>
          </g>
        </g>
      );
    })}
    {scene.symbols.map((item) => {
      const controlledByRetroGame = item.id === retroPlayerId;
      const selectedRetroPlayer = retroGameKind === 'duel' && (item.id === 'playerA' || item.id === 'playerB');
      const gameItem = controlledByRetroGame
        ? { ...item, x: item.x + retroFrame.offsetX, y: item.y + retroFrame.offsetY }
        : selectedRetroPlayer && retroFrame.selected === item.id
          ? { ...item, scale: item.scale * 1.12 }
          : item;
      const displayedItem = responsiveSymbol(gameItem);
      const itemEvents = events.get(item.id) || [];
      const externallyClickable = !!onSymbolClick && !!clickableSymbolIds?.has(item.id);
      const clickInteractive = running && itemEvents.some((event) => event.event === 'click');
      const draggable = running && itemEvents.some((event) => event.event === 'drag');
      const hoverable = running && itemEvents.some((event) => event.event === 'hover');
      const keyboardInteractive = externallyClickable || selectedRetroPlayer || clickInteractive;
      const interactive = keyboardInteractive || draggable || hoverable;
      const accessibleLabel = selectedRetroPlayer
        ? `Select ${item.id === 'playerA' ? 'player one' : 'player two'}`
        : draggable
          ? `Drag ${item.symbol}`
          : item.symbol === 'NeonButton'
            ? String(item.values.label || item.values.text || 'NeoFlash button').replace(/_/g, ' ')
            : clickInteractive ? `Toggle ${item.symbol}` : undefined;
      const activateSymbol = () => selectedRetroPlayer ? handleRetroControl(item.id as 'playerA' | 'playerB') : activate(item.id);
      const selectionOpacity = selectedRetroPlayer && retroFrame.selected && retroFrame.selected !== item.id ? .38 : 1;
      const offset = dragOffsets[item.id];
      return (
        <g
          key={item.id}
          data-object-id={item.id}
          data-testid={symbolTestIds?.[item.id]}
          opacity={hidden[item.id] ? 0 : selectionOpacity}
          transform={offset ? `translate(${offset.x} ${offset.y})` : undefined}
          onPointerDown={draggable ? (event) => startDrag(item.id, event) : undefined}
          onPointerUp={keyboardInteractive ? activateSymbol : undefined}
          onPointerEnter={hoverable ? () => setHovered((current) => ({ ...current, [item.id]: true })) : undefined}
          onPointerLeave={hoverable ? () => setHovered((current) => ({ ...current, [item.id]: false })) : undefined}
          onKeyDown={keyboardInteractive ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateSymbol(); } } : undefined}
          role={interactive ? 'button' : undefined}
          tabIndex={keyboardInteractive ? 0 : undefined}
          aria-label={accessibleLabel}
          style={{ cursor: draggable ? 'grab' : interactive ? 'pointer' : 'default', touchAction: draggable ? 'none' : 'auto', filter: ['NeonSign', 'Pulse', 'Fire', 'Sun', 'NeonButton'].includes(item.symbol) ? 'url(#nf-glow)' : undefined }}
        >
          <g style={hoverStyleFor(item.id)}>
            <g><SymbolArtwork item={displayedItem} emotion={emotions[item.id]} toggled={toggled[item.id]} running={running} onAction={item.symbol === 'NeonNav' && externallyClickable ? () => activate(item.id) : undefined} /><Animations entries={controlledByRetroGame || (toggled[item.id] && item.symbol === 'Dog') ? [] : timeline.get(item.id) || []} item={displayedItem} running={running} /></g>
          </g>
        </g>
      );
    })}
    {roomDimmed && <rect width={responsiveStage.width} height={responsiveStage.height} fill="#020208" opacity=".2" pointerEvents="none" />}
  </svg>
  {(isTouchDevice || isMobileViewport) && retroGameKind && (
    <div
      aria-label="Touch game controls"
      style={{
        display: 'flex',
        flexShrink: 0,
        alignItems: 'end',
        justifyContent: 'center',
        gap: 8,
        padding: 6,
        borderTop: '1px solid rgba(0,255,255,.25)',
        background: 'rgba(3,5,13,.92)',
      }}
    >
      {retroGameKind === 'duel' ? <>
        {retroControlButton('playerA', 'P1', 'Select player one')}
        {retroControlButton('playerB', 'P2', 'Select player two')}
      </> : <>
        {retroControlButton('left', '←', 'Move left')}
        {retroGameKind === 'arcade' ? <div style={{ display: 'grid', gap: 4 }}>
          {retroControlButton('up', '↑', 'Move up')}
          {retroControlButton('down', '↓', 'Move down')}
        </div> : retroControlButton('up', '↑', 'Jump')}
        {retroControlButton('right', '→', 'Move right')}
      </>}
      {!!retroFrame.score && <output aria-live="polite" style={{ minWidth: 58, color: '#c6ff00', font: '900 12px ui-monospace, monospace', textAlign: 'center' }}>+{retroFrame.score}</output>}
    </div>
  )}
  </div>;
}
