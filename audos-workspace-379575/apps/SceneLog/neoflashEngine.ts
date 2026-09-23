import { DEMO_DOCUMENTS, DEMO_DOCUMENT_TYPES } from './demoDocuments';

export type PrimitiveKind = 'circle' | 'rect' | 'line' | 'polygon' | 'text';
export type SymbolCategory =
  | 'Nature & Outdoors'
  | 'Animals'
  | 'Urban & Architecture'
  | 'Vehicles'
  | 'Interior & Furniture'
  | 'Tech & Electronics'
  | 'Cyberpunk / Sci-Fi'
  | 'Food & Objects'
  | 'Weather & Effects'
  | 'Symbols & Abstract'
  | 'UI'
  | 'People';

export interface SymbolDefinition {
  name: string;
  category: SymbolCategory;
  props: string;
  example: string;
  svgPreview?: string;
  neoflashCode?: string;
}

export interface DynamicSymbolDefinition {
  name: string;
  width: number;
  height: number;
  svg: string;
  description: string;
}

const DYNAMIC_SYMBOL_STORAGE_KEY = 'neoflash_dynamic_symbols';
const dynamicSymbols = new Map<string, DynamicSymbolDefinition>();
const ALLOWED_DYNAMIC_SVG_TAGS = new Set([
  'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'filter', 'fegaussianblur', 'femerge',
  'femergenode', 'feoffset', 'feflood', 'fecomposite', 'clippath', 'mask',
]);

function sanitizeDynamicSvg(name: string, svg: string): string {
  const source = svg.trim();
  if (!source || source.length > 100_000) throw new Error(`Dynamic symbol “${name}” has invalid SVG`);
  const wrapped = /^<svg[\s>]/i.test(source) ? source : `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`;
  const documentNode = new DOMParser().parseFromString(wrapped, 'image/svg+xml');
  const root = documentNode.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || documentNode.querySelector('parsererror')) throw new Error(`Dynamic symbol “${name}” has malformed SVG`);

  const idPrefix = `nf-dynamic-${name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}-`;
  const idMap = new Map<string, string>();
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_DYNAMIC_SVG_TAGS.has(tag)) throw new Error(`Dynamic symbol “${name}” uses unsupported SVG element <${tag}>`);
    const id = element.getAttribute('id');
    if (id) {
      const safeId = `${idPrefix}${id.replace(/[^a-z0-9_-]/gi, '-')}`;
      idMap.set(id, safeId);
      element.setAttribute('id', safeId);
    }
  }

  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      const value = attribute.value;
      if (attributeName.startsWith('on') || attributeName === 'href' || attributeName === 'xlink:href' || attributeName === 'style') {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (/javascript:|data:text\/html/i.test(value)) element.removeAttribute(attribute.name);
      if (/url\(/i.test(value)) {
        const localReference = value.match(/^url\(#([^)]+)\)$/);
        if (!localReference) element.removeAttribute(attribute.name);
        else {
          const replacement = idMap.get(localReference[1]);
          if (replacement) element.setAttribute(attribute.name, `url(#${replacement})`);
          else element.removeAttribute(attribute.name);
        }
      }
    }
  }

  const serializer = new XMLSerializer();
  return Array.from(root.childNodes).map((node) => serializer.serializeToString(node)).join('');
}

function persistDynamicSymbols() {
  try {
    const stored = Object.fromEntries(Array.from(dynamicSymbols.entries()).map(([name, definition]) => [name, {
      width: definition.width,
      height: definition.height,
      svg: definition.svg,
      description: definition.description,
    }]));
    localStorage.setItem(DYNAMIC_SYMBOL_STORAGE_KEY, JSON.stringify(stored));
  } catch (error) {
    console.warn('[NeoFlash] Could not persist dynamic symbols:', error);
  }
}

export function registerDynamicSymbol(name: string, width: number, height: number, svg: string, description = '', persist = true) {
  const normalizedName = name.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(normalizedName)) throw new Error('Dynamic symbol names must begin with a letter and contain only letters, numbers, underscores, or hyphens');
  if (SYMBOL_CATALOG.some((symbol) => symbol.name === normalizedName)) return;
  const normalizedWidth = Number(width);
  const normalizedHeight = Number(height);
  if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight) || normalizedWidth < 1 || normalizedHeight < 1 || normalizedWidth > 2048 || normalizedHeight > 2048) {
    throw new Error(`Dynamic symbol “${normalizedName}” has invalid dimensions`);
  }
  dynamicSymbols.set(normalizedName, {
    name: normalizedName,
    width: normalizedWidth,
    height: normalizedHeight,
    svg: sanitizeDynamicSvg(normalizedName, svg),
    description: description.trim().slice(0, 500),
  });
  if (persist) persistDynamicSymbols();
}

export function loadDynamicSymbols(): number {
  dynamicSymbols.clear();
  try {
    const raw = localStorage.getItem(DYNAMIC_SYMBOL_STORAGE_KEY);
    if (!raw) return 0;
    const stored = JSON.parse(raw) as Record<string, { width?: unknown; height?: unknown; svg?: unknown; description?: unknown }>;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return 0;
    for (const [name, definition] of Object.entries(stored).slice(0, 100)) {
      if (!definition || typeof definition.svg !== 'string') continue;
      try {
        registerDynamicSymbol(name, Number(definition.width), Number(definition.height), definition.svg, typeof definition.description === 'string' ? definition.description : '', false);
      } catch (error) {
        console.warn(`[NeoFlash] Ignored invalid stored symbol “${name}”:`, error);
      }
    }
  } catch (error) {
    console.warn('[NeoFlash] Could not load dynamic symbols:', error);
  }
  return dynamicSymbols.size;
}

export function getDynamicSymbol(name: string): DynamicSymbolDefinition | undefined {
  return dynamicSymbols.get(name);
}

export function getSymbol(name: string): DynamicSymbolDefinition | SymbolDefinition | undefined {
  return dynamicSymbols.get(name) || SYMBOL_CATALOG.find((symbol) => symbol.name === name);
}

export function getAvailableSymbolNames(): string[] {
  return [...SYMBOL_CATALOG.map((symbol) => symbol.name), ...dynamicSymbols.keys()];
}

function defineSymbol<const N extends string>(
  name: N,
  category: SymbolCategory,
  body: string,
  animation = '',
  props = 'scale, color',
) {
  const id = name.replace(/[^a-z0-9]/gi, '').replace(/^./, (letter) => letter.toLowerCase());
  const base = `symbol ${id} ${name} 520 300 scale=1 color=#48f7ff`;
  const neoflashCode = animation ? `${base}\n${animation.split('{id}').join(id)}` : base;
  return {
    name,
    category,
    props,
    example: neoflashCode,
    neoflashCode,
    svgPreview: `<svg viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  } as const;
}

export const SYMBOL_CATALOG = [
  { name: 'Bar', category: 'Urban & Architecture', props: 'scale', example: 'symbol bar Bar 80 300 scale=1' },
  { name: 'Highway', category: 'Urban & Architecture', props: 'scale', example: 'symbol road Highway 0 500 scale=1' },
  { name: 'StreetLamp', category: 'Urban & Architecture', props: 'scale', example: 'symbol streetlight StreetLamp 900 290 scale=1' },
  { name: 'Table', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol table Table 380 470 scale=1 color=#4b255f' },
  { name: 'Desk', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol desk Desk 350 430 scale=1' },
  { name: 'Chair', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol chair Chair 720 420 scale=1' },
  { name: 'Sofa', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol sofa Sofa 380 430 scale=1 color=#712b77' },
  { name: 'Shelf', category: 'Interior & Furniture', props: 'scale', example: 'symbol shelf Shelf 80 170 scale=1' },
  { name: 'Bookshelf', category: 'Interior & Furniture', props: 'scale', example: 'symbol books Bookshelf 850 120 scale=1' },
  { name: 'Window', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol window Window 760 90 scale=1' },
  { name: 'Door', category: 'Interior & Furniture', props: 'scale, open', example: 'symbol door Door 1000 220 scale=1 open=false' },
  { name: 'Floor', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol floor Floor 0 470 scale=1' },
  { name: 'Wall', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol wall Wall 0 0 scale=1' },
  { name: 'Room', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol room Room 0 0 scale=1' },
  { name: 'CeilingLight', category: 'Interior & Furniture', props: 'scale, color', example: 'symbol ceiling CeilingLight 570 0 scale=1' },
  { name: 'Building', category: 'Urban & Architecture', props: 'scale, color', example: 'symbol tower Building 80 120 scale=1 color=#15103b' },
  { name: 'Rooftop', category: 'Urban & Architecture', props: 'scale', example: 'symbol roofs Rooftop 0 390 scale=1' },
  { name: 'CoffeeCup', category: 'Food & Objects', props: 'scale, color', example: 'symbol coffee CoffeeCup 620 410 scale=.6' },
  { name: 'IBM1989', category: 'Tech & Electronics', props: 'scale, text', example: 'symbol ibm IBM1989 430 300 scale=.8 text=READY_' },
  { name: 'Monitor', category: 'Tech & Electronics', props: 'scale, text, color', example: 'symbol crt Monitor 430 280 scale=1 text=ONLINE_' },
  { name: 'Laptop', category: 'Tech & Electronics', props: 'scale, text, color', example: 'symbol laptop Laptop 520 350 scale=1 text=NF_RUN' },
  { name: 'TV', category: 'Tech & Electronics', props: 'scale, color', example: 'symbol tv TV 780 300 scale=1' },
  { name: 'Phone', category: 'Tech & Electronics', props: 'scale, color', example: 'symbol phone Phone 690 410 scale=.8' },
  { name: 'BulbLamp', category: 'Tech & Electronics', props: 'scale, color', example: 'symbol lamp BulbLamp 720 300 scale=1 color=#ffe66d' },
  { name: 'FloorLamp', category: 'Tech & Electronics', props: 'scale, color', example: 'symbol lamp FloorLamp 980 240 scale=1 color=#ff4fd8' },
  { name: 'Keyboard', category: 'Tech & Electronics', props: 'scale, color', example: 'symbol keys Keyboard 440 450 scale=1' },
  { name: 'Speaker', category: 'Tech & Electronics', props: 'scale, color', example: 'symbol speaker Speaker 830 330 scale=1 color=#00ffff' },
  { name: 'ArcadeCabinet', category: 'Tech & Electronics', props: 'scale, color, text', example: 'symbol arcade ArcadeCabinet 260 220 scale=1 text=PLAY' },
  { name: 'Cloud', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol cloud Cloud -180 100 scale=1 color=#f5f7fa' },
  { name: 'Sky', category: 'Nature & Outdoors', props: 'scale', example: 'symbol sky Sky 0 0 scale=1' },
  { name: 'Grass', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol meadow Grass 0 500 scale=1 color=#4a7c59' },
  { name: 'Sun', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol sun Sun 980 80 scale=1 color=#FFD700' },
  { name: 'Dog', category: 'Animals', props: 'scale, color', example: 'symbol dog Dog -180 470 scale=.8 color=#8B5E3C' },
  { name: 'Bird', category: 'Animals', props: 'scale, color', example: 'symbol bird Bird -120 160 scale=.7 color=#334155' },
  { name: 'Tree', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol tree Tree 120 250 scale=1 color=#00ff88' },
  { name: 'Palm', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol palm Palm 180 210 scale=1 color=#00ffcc' },
  { name: 'Moon', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol moon Moon 900 80 scale=1 color=#d8e7ff' },
  { name: 'Star', category: 'Nature & Outdoors', props: 'scale, color, count', example: 'symbol stars Star 80 50 scale=1 count=12' },
  { name: 'Wave', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol sea Wave 0 500 scale=1 color=#00ccff' },
  { name: 'Fire', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol fire Fire 600 470 scale=1 color=#ff4d00' },
  { name: 'Smoke', category: 'Nature & Outdoors', props: 'scale, color', example: 'symbol smoke Smoke 620 300 scale=1 color=#958ca8' },
  { name: 'Car90', category: 'Vehicles', props: 'scale, color', example: 'symbol car Car90 -220 510 scale=1 color=#ff2bd6' },
  { name: 'TrafficLight', category: 'Urban & Architecture', props: 'scale', example: 'symbol signal TrafficLight 1000 270 scale=1' },
  { name: 'Bus', category: 'Vehicles', props: 'scale, color, text', example: 'symbol bus Bus -400 480 scale=1 color=#8b00ff text=NIGHT' },
  { name: 'Bicycle', category: 'Vehicles', props: 'scale, color', example: 'symbol bike Bicycle 300 500 scale=.9 color=#00ffff' },
  { name: 'Motorcycle', category: 'Vehicles', props: 'scale, color', example: 'symbol moto Motorcycle -250 500 scale=1 color=#ff00ff' },
  { name: 'NeonSign', category: 'Cyberpunk / Sci-Fi', props: 'scale, text, color', example: 'symbol sign NeonSign 480 100 scale=1 text=NEO_TOKYO color=#ff00ff' },
  { name: 'Antenna', category: 'Tech & Electronics', props: 'scale, color', example: 'symbol antenna Antenna 920 250 scale=1 color=#00ffff' },
  { name: 'Person', category: 'People', props: 'scale, color, emotion', example: 'symbol person Person 520 310 scale=1 emotion=happy color=#00ffff' },
  { name: 'Astronaut', category: 'Cyberpunk / Sci-Fi', props: 'scale, color', example: 'symbol astronaut Astronaut 520 230 scale=1 color=#f5f7ff' },
  { name: 'Cat', category: 'Animals', props: 'scale, color', example: 'symbol cat Cat 690 500 scale=.8 color=#ff9f43' },
  { name: 'YarnBall', category: 'Animals', props: 'scale, color', example: 'symbol yarn YarnBall 820 545 scale=.72 color=#ff2bd6' },
  { name: 'Shadow', category: 'Weather & Effects', props: 'scale, color', example: 'symbol shadow Shadow 480 610 scale=1 color=#090512' },
  { name: 'Particle', category: 'Symbols & Abstract', props: 'scale, color, count', example: 'symbol dust Particle 120 120 scale=1 color=#ffe9a8 count=18' },
  { name: 'Glow', category: 'Symbols & Abstract', props: 'scale, color', example: 'symbol aura Glow 500 250 scale=.6 color=#8b00ff' },
  { name: 'Pulse', category: 'Symbols & Abstract', props: 'scale, color', example: 'symbol pulse Pulse 540 280 scale=1 color=#00ffff' },
  { name: 'GeometricCircle', category: 'Symbols & Abstract', props: 'scale, color, fillColor', example: 'symbol ring GeometricCircle 520 250 scale=1 color=#4A9EFF fillColor=transparent' },
  { name: 'GeometricLine', category: 'Symbols & Abstract', props: 'scale, color, width', example: 'symbol axis GeometricLine 420 360 scale=1 color=#111111 width=280' },
  { name: 'PixelChar', category: 'People', props: 'scale, color, altColor', example: 'symbol player PixelChar 520 300 scale=1 color=#00FFFF altColor=#FF00FF' },
  { name: 'Planet', category: 'Cyberpunk / Sci-Fi', props: 'scale, color, ringColor', example: 'symbol planet Planet 520 220 scale=1 color=#4A9EFF ringColor=#B388FF' },
  { name: 'Scanline', category: 'Cyberpunk / Sci-Fi', props: 'scale, color', example: 'symbol scan Scanline 0 0 scale=1 color=#00ff41' },
  { name: 'Grid', category: 'Cyberpunk / Sci-Fi', props: 'scale, color', example: 'symbol grid Grid 0 340 scale=1 color=#8b00ff' },

  // UI
  { name: 'NeoFlashLogo', category: 'UI', props: 'scale, primary, secondary, theme', example: 'symbol logo NeoFlashLogo 40 20 scale=1 primary=#ff2bd6 secondary=#48f7ff theme=cyberpunk' },
  { name: 'NeonNav', category: 'UI', props: 'scale, width, height, logo, items, color', example: 'symbol nav NeonNav 0 0 width=1280 height=88 logo=NF items=Playground|Demos|Export color=#39ff14' },
  { name: 'NeonButton', category: 'UI', props: 'scale, width, height, label, color, textColor, variant, glow', example: 'symbol cta NeonButton 460 500 width=360 height=72 label=OPEN_THE_PLAYGROUND color=#ff2bd6 textColor=#080810 variant=primary glow=true' },
  { name: 'NeonText', category: 'UI', props: 'scale, text, size, color, tracking, weight, glow', example: 'symbol headline NeonText 640 250 text=DESCRIBE_IT.|ANIMATE_IT. size=2xl color=#fff7ff tracking=-2 weight=900 glow=true' },
  { name: 'NeonCard', category: 'UI', props: 'scale, width, height, borderColor, bgColor, title, subtitle, body, icon, glow', example: 'symbol panel NeonCard 120 160 width=420 height=280 borderColor=#48f7ff title=LIVE_SCENE body=Browser-native_vector_motion icon=code glow=true' },
  { name: 'NeonFooter', category: 'UI', props: 'scale, width, height, text, color', example: 'symbol footer NeonFooter 0 620 width=1280 height=100 text=NeoFlash_©_2024_—_Describe_it._Animate_it._Instantly. color=#ff00ff' },
  { name: 'NeonBadge', category: 'UI', props: 'scale, label, color', example: 'symbol badge NeonBadge 460 135 label=[_NF_]_//_BROWSER_MOTION_SYSTEM color=#ff2bd6' },
  { name: 'NeonGrid', category: 'UI', props: 'scale, width, height, color, opacity', example: 'symbol uiGrid NeonGrid 0 0 width=1280 height=720 color=#48f7ff opacity=.08' },
  { name: 'NeonScanlines', category: 'UI', props: 'scale, width, height, opacity', example: 'symbol uiScan NeonScanlines 0 0 width=1280 height=720 opacity=.12' },
  defineSymbol('PlantLogo', 'UI', '<path d="M110 205V82" stroke="#2f7d45" stroke-width="14"/><path d="M110 108C42 110 31 41 31 41c65-8 91 27 79 67Z" fill="#74b85d"/><path d="M110 143c70 0 83-66 83-66-67-2-95 31-83 66Z" fill="#a8d978"/>'),
  defineSymbol('GreenHeader', 'UI', '<rect x="8" y="50" width="204" height="120" rx="18" fill="#1f6b39"/><circle cx="47" cy="88" r="18" fill="#a8dc79"/><path d="M78 88h38M131 88h27M173 88h22M78 125h55" stroke="#f5fff0" stroke-width="10"/>'),
  defineSymbol('HeroSection', 'UI', '<rect x="8" y="22" width="204" height="176" rx="14" fill="#edf4e2"/><path d="M27 61h93M27 91h76M27 121h64" stroke="#244f32" stroke-width="12"/><circle cx="168" cy="94" r="31" fill="#e3b654"/><path d="M128 175q34-75 82 0" fill="#5e944f"/>'),
  defineSymbol('ProductCard', 'UI', '<rect x="24" y="20" width="172" height="184" rx="20" fill="#f7fff3"/><circle cx="110" cy="76" r="34" fill="#73a856"/><path d="M55 134h110M55 161h78" stroke="#37543c" stroke-width="11"/>'),
  defineSymbol('ContactForm', 'UI', '<rect x="26" y="17" width="168" height="190" rx="15" fill="#f7fff3"/><path d="M47 58h126M47 96h126M47 134h126"/><rect x="47" y="159" width="82" height="27" rx="7" fill="#317143"/>'),
  defineSymbol('CyberPanel', 'UI', '<path d="M22 20h176l16 16v164H6V36Z" fill="#0e1020"/><path d="M39 62h142M39 98h96M39 134h124" stroke="#62f8ff"/><circle cx="170" cy="168" r="18" fill="#ff4fd8"/>', 'every 1s flicker {id} min=.68 max=1'),
  defineSymbol('PortfolioTile', 'UI', '<rect x="17" y="24" width="186" height="172" fill="#ff765e"/><path d="M17 111h186M110 24v172" stroke="#ffe071" stroke-width="13"/><rect x="34" y="153" width="91" height="25" fill="#f4f1eb"/>'),
  defineSymbol('GameControls', 'UI', '<rect x="20" y="64" width="70" height="70" rx="14" fill="#18263b"/><rect x="130" y="64" width="70" height="70" rx="14" fill="#18263b"/><path d="M70 80l-25 19 25 19M150 80l25 19-25 19" stroke="#62f8ff" stroke-width="10"/>'),

  // Nature & Outdoors
  defineSymbol('PineTree', 'Nature & Outdoors', '<path d="M110 15L35 105h45l-55 70h170l-55-70h45z" fill="#176b4b"/><path d="M110 170v38" stroke="#7a4b2b" stroke-width="18"/>'),
  defineSymbol('OakTree', 'Nature & Outdoors', '<path d="M108 118v90M72 208h76" stroke="#7a4b2b" stroke-width="20"/><circle cx="72" cy="88" r="48" fill="#2f8f52"/><circle cx="136" cy="76" r="56" fill="#36a65c"/><circle cx="165" cy="118" r="38" fill="#267a45"/>'),
  defineSymbol('Cactus', 'Nature & Outdoors', '<path d="M110 205V52c0-24 34-24 34 0v48h21V76c0-19 28-19 28 0v52c0 18-14 32-32 32h-17v45M110 126H87c-21 0-37-16-37-37V65c0-18 27-18 27 0v24h33" fill="#228b55"/>'),
  defineSymbol('Bush', 'Nature & Outdoors', '<path d="M24 171c-20-39 17-73 51-57-4-52 65-70 84-25 38-12 65 35 38 65 20 37-22 56-60 48H62c-26 2-48-8-38-31z" fill="#2d8c45"/>'),
  defineSymbol('Flower', 'Nature & Outdoors', '<path d="M110 104v104M110 158c-34-4-43-29-55-43M110 172c34-4 43-29 55-43" stroke="#3a9b55"/><circle cx="110" cy="70" r="22" fill="#ffd43b"/><circle cx="110" cy="30" r="25" fill="#ff5ca8"/><circle cx="150" cy="70" r="25" fill="#ff5ca8"/><circle cx="110" cy="110" r="25" fill="#ff5ca8"/><circle cx="70" cy="70" r="25" fill="#ff5ca8"/>'),
  defineSymbol('Sunflower', 'Nature & Outdoors', '<path d="M110 112v96M110 158l-48-25M110 172l50-31" stroke="#398b49" stroke-width="10"/><circle cx="110" cy="72" r="33" fill="#6b421f"/><g fill="#ffd329"><ellipse cx="110" cy="22" rx="15" ry="34"/><ellipse cx="110" cy="122" rx="15" ry="34"/><ellipse cx="60" cy="72" rx="34" ry="15"/><ellipse cx="160" cy="72" rx="34" ry="15"/></g>'),
  defineSymbol('Mushroom', 'Nature & Outdoors', '<path d="M83 104h54l16 104H67z" fill="#f4dfbf"/><path d="M25 105C30 25 190 25 195 105c-48 20-122 20-170 0z" fill="#e84a5f"/><circle cx="76" cy="68" r="11" fill="white"/><circle cx="137" cy="52" r="14" fill="white"/>'),
  defineSymbol('Fern', 'Nature & Outdoors', '<path d="M108 205C95 142 91 85 116 18M107 171L55 128M108 145l62-47M108 116L57 78M112 88l52-39M115 60L84 38" stroke="#36a65c" stroke-width="10"/>'),
  defineSymbol('GrassPatch', 'Nature & Outdoors', '<path d="M20 202L52 92l16 110L93 54l18 148 30-132 8 132 47-108-20 108z" fill="#4fa85c"/>'),
  defineSymbol('Hill', 'Nature & Outdoors', '<path d="M5 205Q75 65 145 205Q180 130 220 205z" fill="#4f9d58"/><path d="M46 164Q76 105 109 164" stroke="#79c267"/>'),
  defineSymbol('Mountain', 'Nature & Outdoors', '<path d="M8 205L91 46l35 59 28-44 62 144z" fill="#667085"/><path d="M64 98l27-52 27 46-20-9-13 15-10-11zM132 97l22-36 24 55-23-13-13 12z" fill="#eaf2f8"/>'),
  defineSymbol('River', 'Nature & Outdoors', '<path d="M78 5c70 40-35 73 56 113 63 28 24 67-32 97H15c117-52 19-75 74-112C134 73 40 38 15 5z" fill="#39a9db"/>', 'every 4s move {id} fromY=300 toY=312 duration=4 alternate=true'),
  defineSymbol('Waterfall', 'Nature & Outdoors', '<path d="M42 12h136v45H42z" fill="#596579"/><path d="M58 54h104v122c-7 28-97 28-104 0z" fill="#41b6e6"/><path d="M77 62v103M110 62v126M143 62v103" stroke="#c8f5ff"/>', 'every 2s fade {id} from=.65 to=1'),
  defineSymbol('Lake', 'Nature & Outdoors', '<ellipse cx="110" cy="140" rx="98" ry="58" fill="#3197c7"/><path d="M38 127h144M55 151h110M78 174h64" stroke="#b8f0ff"/>'),
  defineSymbol('Island', 'Nature & Outdoors', '<path d="M25 160q85-65 170 0l-22 36H49z" fill="#d5af65"/><path d="M112 142V50M112 55Q72 30 54 65M112 55q43-35 70 8" stroke="#3a8d5d" stroke-width="14"/>'),
  defineSymbol('Rock', 'Nature & Outdoors', '<path d="M40 180l16-78 55-58 66 48 22 88z" fill="#7d8795"/><path d="M56 102l55 28 66-38M111 130v50" stroke="#aeb6c1"/>'),
  defineSymbol('Boulder', 'Nature & Outdoors', '<path d="M22 179L48 75l70-48 68 57 16 95z" fill="#667085"/><path d="M48 75l75 44 63-35M123 119l-12 60" stroke="#9ba4b0"/>'),
  defineSymbol('CumulusCloud', 'Nature & Outdoors', '<path d="M32 164c-40-35 5-79 44-59 5-58 86-72 111-19 49-2 52 78 7 83H48z" fill="#eef6ff"/>', 'every 10s move {id} fromX=520 toX=760 duration=10 alternate=true'),
  defineSymbol('StormCloud', 'Nature & Outdoors', '<path d="M24 130c-25-38 18-72 53-51 12-52 91-51 105 2 45 3 47 67 8 71H45z" fill="#39445f"/><path d="M75 158l-17 38M115 158l-17 38M155 158l-17 38" stroke="#5bc0eb"/>', 'every .8s flicker {id} min=.55 max=1'),
  defineSymbol('Rain', 'Nature & Outdoors', '<path d="M40 25l-18 42M89 10L65 66M137 29l-20 45M185 13l-25 58M57 105l-22 52M111 94l-25 62M166 104l-27 66M203 91l-22 55" stroke="#59c3ff"/>', 'every 1s move {id} fromY=260 toY=330 duration=1'),
  defineSymbol('Snow', 'Nature & Outdoors', '<g fill="#eefaff" stroke="none"><circle cx="35" cy="35" r="8"/><circle cx="92" cy="22" r="6"/><circle cx="151" cy="48" r="10"/><circle cx="202" cy="20" r="7"/><circle cx="54" cy="105" r="9"/><circle cx="122" cy="111" r="7"/><circle cx="184" cy="98" r="8"/><circle cx="26" cy="178" r="7"/><circle cx="93" cy="190" r="10"/><circle cx="164" cy="170" r="6"/></g>', 'every 4s move {id} fromY=250 toY=430 duration=4'),
  defineSymbol('LightningBolt', 'Nature & Outdoors', '<path d="M128 10L52 122h52l-20 88 86-123h-54z" fill="#ffe54f"/>', 'every .7s flicker {id} min=.15 max=1'),
  defineSymbol('Rainbow', 'Nature & Outdoors', '<path d="M20 190a90 90 0 01180 0" stroke="#ff4d6d" stroke-width="42"/><path d="M39 190a71 71 0 01142 0" stroke="#ffd93d" stroke-width="28"/><path d="M57 190a53 53 0 01106 0" stroke="#4dd599" stroke-width="16"/><path d="M73 190a37 37 0 0174 0" stroke="#559cff" stroke-width="10"/>'),
  defineSymbol('CrescentMoon', 'Nature & Outdoors', '<path d="M162 181A88 88 0 1166 39a75 75 0 0096 142z" fill="#f2edc7"/>'),
  defineSymbol('FullMoon', 'Nature & Outdoors', '<circle cx="110" cy="110" r="88" fill="#e9e5c8"/><circle cx="76" cy="76" r="14" fill="#c8c5b0"/><circle cx="143" cy="132" r="22" fill="#c8c5b0"/><circle cx="138" cy="60" r="10" fill="#c8c5b0"/>'),
  defineSymbol('StarsCluster', 'Nature & Outdoors', '<g fill="#fff6a8" stroke="none"><path d="M46 18l8 22 23 1-18 14 6 23-19-13-19 13 6-23-18-14 23-1z"/><path d="M157 72l7 18 19 1-15 11 5 19-16-11-15 11 5-19-15-11 19-1z"/><path d="M92 133l10 27 29 1-23 17 8 28-24-16-24 16 8-28-23-17 29-1z"/></g>', 'every 1.8s flicker {id} min=.35 max=1'),
  defineSymbol('Comet', 'Nature & Outdoors', '<path d="M24 170L142 66" stroke="#74d8ff" stroke-width="22"/><path d="M40 194L153 79" stroke="#d9f8ff"/><circle cx="163" cy="58" r="32" fill="#f7fdff"/>', 'every 5s move {id} fromX=520 fromY=300 toX=900 toY=40 duration=5'),
  defineSymbol('Fog', 'Nature & Outdoors', '<path d="M12 56h150M52 92h156M8 128h174M42 164h151" stroke="#b9c4d0" stroke-width="16" opacity=".72"/>', 'every 8s move {id} fromX=480 toX=610 duration=8 alternate=true'),

  // Animals
  defineSymbol('RunningDog', 'Animals', '<ellipse cx="105" cy="105" rx="67" ry="38" fill="#a96f42"/><circle cx="170" cy="82" r="31" fill="#a96f42"/><path d="M190 68l25-23-8 38M45 103L8 76M70 133l-25 58M105 136l25 55M139 130l39 45" stroke="#704426" stroke-width="14"/>', 'every 5s move {id} fromX=-180 toX=1450 duration=5'),
  defineSymbol('SittingCat', 'Animals', '<path d="M70 192c-8-65 4-118 40-126 45-10 62 57 48 126z" fill="#dc8b42"/><circle cx="110" cy="55" r="43" fill="#dc8b42"/><path d="M76 28L70 2l31 18M120 19l30-18-5 34M151 153q66 6 42-65" stroke="#98562c" stroke-width="12"/><circle cx="95" cy="54" r="4" fill="#111"/><circle cx="125" cy="54" r="4" fill="#111"/>'),
  defineSymbol('SleepingCat', 'Animals', '<ellipse cx="105" cy="132" rx="86" ry="53" fill="#d88945"/><circle cx="166" cy="116" r="38" fill="#d88945"/><path d="M139 94l8-27 25 22 19-22 8 33M37 140q42-58 91-17" stroke="#955a34" stroke-width="10"/><path d="M155 118h10M178 118h10"/>'),
  defineSymbol('FlyingBird', 'Animals', '<path d="M108 119Q54 40 10 98Q64 66 108 119Q157 55 210 94Q157 64 108 119z" fill="#5f7ca8"/>', 'every 7s move {id} fromX=-120 toX=1400 duration=7'),
  defineSymbol('PerchedBird', 'Animals', '<ellipse cx="104" cy="91" rx="55" ry="42" fill="#51739b"/><circle cx="151" cy="65" r="30" fill="#51739b"/><path d="M178 65l28 9-28 9M74 122l-7 47M107 128v41M42 170h110"/><circle cx="160" cy="58" r="4" fill="#fff"/>'),
  defineSymbol('Fish', 'Animals', '<ellipse cx="115" cy="110" rx="66" ry="42" fill="#3ec6d6"/><path d="M51 110L9 67v86z" fill="#1b9aaa"/><circle cx="150" cy="100" r="6" fill="#07131b"/><path d="M95 108q25 25 51 0"/>', 'every 5s move {id} fromX=400 toX=900 duration=5 alternate=true'),
  defineSymbol('Butterfly', 'Animals', '<ellipse cx="110" cy="115" rx="10" ry="55" fill="#332255"/><path d="M99 103C22 16 18 119 88 131M121 103c77-87 81 16 11 28" fill="#ff65c3"/><path d="M105 61L83 29M115 61l22-32"/>', 'every 1.2s scale {id} from=.92 to=1.08'),
  defineSymbol('Dragonfly', 'Animals', '<path d="M110 45v135" stroke="#38a3a5" stroke-width="12"/><circle cx="110" cy="34" r="13" fill="#5ce1e6"/><ellipse cx="67" cy="84" rx="48" ry="18" fill="#bdf8ff"/><ellipse cx="153" cy="84" rx="48" ry="18" fill="#bdf8ff"/><ellipse cx="73" cy="126" rx="38" ry="14" fill="#bdf8ff"/><ellipse cx="147" cy="126" rx="38" ry="14" fill="#bdf8ff"/>', 'every 4s move {id} fromX=450 toX=780 duration=4 alternate=true'),
  defineSymbol('Bee', 'Animals', '<ellipse cx="110" cy="118" rx="58" ry="40" fill="#ffd23f"/><path d="M78 84v68M111 78v80M144 87v63" stroke="#222" stroke-width="15"/><ellipse cx="75" cy="72" rx="40" ry="25" fill="#dff8ff"/><ellipse cx="145" cy="72" rx="40" ry="25" fill="#dff8ff"/><circle cx="164" cy="111" r="5" fill="#111"/>', 'every 3s move {id} fromX=450 toX=700 duration=3 alternate=true'),
  defineSymbol('Spider', 'Animals', '<circle cx="110" cy="92" r="30" fill="#3b2d44"/><ellipse cx="110" cy="142" rx="42" ry="51" fill="#3b2d44"/><path d="M74 112L28 80M72 132L20 125M74 154L30 181M146 112l46-32M148 132l52-7M146 154l44 27"/>'),
  defineSymbol('Horse', 'Animals', '<path d="M48 170V87l75-35 57 32-18 50H94v58H61z" fill="#8b5a35"/><path d="M148 73l22-52 27 14-17 49M68 185v25M145 134v76" stroke="#5c3923" stroke-width="16"/><circle cx="178" cy="52" r="5" fill="#111"/>'),
  defineSymbol('Rabbit', 'Animals', '<ellipse cx="104" cy="145" rx="63" ry="50" fill="#d9d4cf"/><circle cx="142" cy="93" r="40" fill="#d9d4cf"/><ellipse cx="127" cy="35" rx="15" ry="47" fill="#efc2c9"/><ellipse cx="158" cy="33" rx="15" ry="47" fill="#efc2c9"/><circle cx="154" cy="88" r="5" fill="#111"/><circle cx="43" cy="138" r="18" fill="#fff"/>'),
  defineSymbol('Fox', 'Animals', '<path d="M35 165L72 67l42 27 45-27 28 98-77 38z" fill="#e8732a"/><path d="M72 67L45 25l64 65M159 67l23-44 5 142M82 145l28 22 29-22" fill="#fff2df"/><circle cx="92" cy="117" r="5" fill="#111"/><circle cx="134" cy="117" r="5" fill="#111"/>'),
  defineSymbol('Wolf', 'Animals', '<path d="M40 175L62 61l48 35 51-37 20 116-70 31z" fill="#718096"/><path d="M62 61L45 20l64 73M161 59l20-40 0 156" fill="#4a5568"/><path d="M84 151l27 17 27-17" fill="#dce3ea"/>'),
  defineSymbol('Owl', 'Animals', '<ellipse cx="110" cy="125" rx="75" ry="82" fill="#6f5b45"/><circle cx="78" cy="93" r="31" fill="#e8d8ad"/><circle cx="142" cy="93" r="31" fill="#e8d8ad"/><circle cx="78" cy="93" r="10" fill="#111"/><circle cx="142" cy="93" r="10" fill="#111"/><path d="M110 106l-12 24h24z" fill="#e8a229"/><path d="M55 189h110M82 189v20M138 189v20"/>'),
  defineSymbol('FlyingBat', 'Animals', '<path d="M110 112L74 70 18 50l25 50-22 28 69 17 20 46 20-46 69-17-22-28 25-50-56 20z" fill="#39284f"/>', 'every 5s move {id} fromX=-100 toX=1380 duration=5'),
  defineSymbol('Shark', 'Animals', '<path d="M24 120Q95 48 177 93l34-29-9 50 9 50-34-29Q91 182 24 120z" fill="#4f6f8f"/><path d="M102 78l26-48 26 57M77 124l-39 30"/><circle cx="163" cy="105" r="5" fill="#111"/>', 'every 6s move {id} fromX=350 toX=900 duration=6 alternate=true'),
  defineSymbol('Octopus', 'Animals', '<circle cx="110" cy="86" r="61" fill="#9b5de5"/><path d="M58 118q-50 70 9 75q45 1 15-55M91 139q-25 73 19 64q31-7 12-63M139 136q39 72 62 19M158 118q61 48 27 76" stroke="#9b5de5" stroke-width="18"/><circle cx="89" cy="82" r="6" fill="#111"/><circle cx="132" cy="82" r="6" fill="#111"/>'),
  defineSymbol('Crab', 'Animals', '<ellipse cx="110" cy="131" rx="62" ry="45" fill="#ef476f"/><path d="M52 110L18 79M168 110l34-31M43 136L10 151M177 136l33 15M69 164l-19 35M151 164l19 35"/><path d="M17 78q-12-33 22-25M203 78q12-33-22-25"/><circle cx="82" cy="103" r="8" fill="#111"/><circle cx="138" cy="103" r="8" fill="#111"/>'),
  defineSymbol('Frog', 'Animals', '<ellipse cx="110" cy="140" rx="78" ry="54" fill="#57b957"/><circle cx="67" cy="90" r="28" fill="#57b957"/><circle cx="153" cy="90" r="28" fill="#57b957"/><circle cx="67" cy="88" r="7" fill="#111"/><circle cx="153" cy="88" r="7" fill="#111"/><path d="M74 142q36 32 72 0M47 166L12 199M173 166l35 33"/>'),
  defineSymbol('Snake', 'Animals', '<path d="M32 55q151-54 63 58-61 76 59 61 48-6 34-52" stroke="#57a773" stroke-width="28"/><circle cx="188" cy="108" r="27" fill="#57a773"/><circle cx="199" cy="101" r="4" fill="#111"/><path d="M211 116l-20 6" stroke="#e63946"/>', 'every 4s move {id} fromX=450 toX=680 duration=4 alternate=true'),
  defineSymbol('SnakeHead', 'Animals', '<rect x="47" y="47" width="126" height="126" rx="34" fill="#d4ff46"/><circle cx="87" cy="92" r="10" fill="#071018"/><circle cx="135" cy="92" r="10" fill="#071018"/><path d="M110 125v38M110 147l-19 15M110 147l19 15" stroke="#ff4f81"/>'),
  defineSymbol('Deer', 'Animals', '<path d="M56 181V91l88-25 34 43-27 39H94v52" fill="#9a6a3c"/><path d="M153 74l7-45M153 50l-22-18M160 50l22-20M180 105l23-55M195 56l15-17M151 148v58M76 178v28" stroke="#664224" stroke-width="11"/>'),

  // Urban & Architecture
  defineSymbol('Skyscraper', 'Urban & Architecture', '<path d="M58 208V35l52-24 52 24v173z" fill="#20294a"/><path d="M82 51h18v24H82zm38 0h18v24h-18zM82 91h18v24H82zm38 0h18v24h-18zM82 131h18v24H82zm38 0h18v24h-18z" fill="#59d7ff"/>'),
  defineSymbol('House', 'Urban & Architecture', '<path d="M33 102L110 30l77 72v106H33z" fill="#835d81"/><path d="M17 108L110 18l93 90"/><rect x="84" y="130" width="52" height="78" fill="#2b2340"/><rect x="48" y="118" width="28" height="30" fill="#74d9ff"/>'),
  defineSymbol('ApartmentBlock', 'Urban & Architecture', '<rect x="30" y="28" width="160" height="180" fill="#303957"/><g fill="#ffd166"><rect x="50" y="48" width="25" height="23"/><rect x="98" y="48" width="25" height="23"/><rect x="146" y="48" width="25" height="23"/><rect x="50" y="92" width="25" height="23"/><rect x="98" y="92" width="25" height="23"/><rect x="146" y="92" width="25" height="23"/></g><rect x="94" y="157" width="32" height="51" fill="#15192c"/>'),
  defineSymbol('Shop', 'Urban & Architecture', '<rect x="22" y="62" width="176" height="146" fill="#40304e"/><path d="M18 62h184l-18-43H37z" fill="#ff5ca8"/><path d="M46 62v42M78 62v42M110 62v42M142 62v42M174 62v42"/><rect x="51" y="125" width="66" height="83" fill="#63d8ff"/><rect x="137" y="126" width="38" height="82" fill="#241b30"/>'),
  defineSymbol('Warehouse', 'Urban & Architecture', '<path d="M18 83L110 28l92 55v125H18z" fill="#4b5563"/><path d="M18 83h184"/><rect x="55" y="116" width="110" height="92" fill="#252b36"/><path d="M55 143h110M55 170h110"/>'),
  defineSymbol('Bridge', 'Urban & Architecture', '<path d="M8 155h204M30 155V80M190 155V80M30 80q80-65 160 0M30 80q80 85 160 0" stroke-width="11"/><path d="M0 175h220" stroke="#4fc3f7"/>'),
  defineSymbol('Tunnel', 'Urban & Architecture', '<path d="M25 208V107a85 85 0 01170 0v101z" fill="#454b5a"/><path d="M60 208V112a50 50 0 01100 0v96z" fill="#10131d"/><path d="M110 208v-96" stroke="#ffd43b"/>'),
  defineSymbol('StraightRoad', 'Urban & Architecture', '<path d="M63 10h94l50 200H13z" fill="#2e3340"/><path d="M110 20v35M110 83v42M110 157v51" stroke="#ffd43b" stroke-width="9"/>'),
  defineSymbol('CurvedRoad', 'Urban & Architecture', '<path d="M40 210c128-64-11-110 122-200h48C80 114 218 166 87 210z" fill="#313744"/><path d="M66 204c121-61 3-102 121-188" stroke="#ffd43b" stroke-dasharray="18 16"/>'),
  defineSymbol('Sidewalk', 'Urban & Architecture', '<path d="M10 68h200v130H10z" fill="#747d8c"/><path d="M10 68h200M10 111h200M10 154h200M60 68v130M110 68v130M160 68v130" stroke="#aab2bd"/>'),
  defineSymbol('ModernStreetLamp', 'Urban & Architecture', '<path d="M80 208h60M110 208V48q0-27 28-27h52" stroke-width="12"/><path d="M157 21h45l-12 38h-43z" fill="#eaff75"/><ellipse cx="173" cy="65" rx="55" ry="22" fill="#eaff75" opacity=".25"/>', 'every 1.6s flicker {id} min=.72 max=1'),
  defineSymbol('FireHydrant', 'Urban & Architecture', '<path d="M74 72h72v116H74z" fill="#e63946"/><path d="M62 72h96M83 39h54l12 33H71zM55 102H24v40h31M165 102h31v40h-31M65 188h90"/><circle cx="110" cy="118" r="22" fill="#b51f2e"/>'),
  defineSymbol('Mailbox', 'Urban & Architecture', '<path d="M36 42h98q45 0 45 45v61H36z" fill="#345c8c"/><path d="M36 42v106h143M75 148v61M50 209h50M134 42v73M134 68h44"/><rect x="53" y="77" width="53" height="9" fill="#d7efff"/>'),
  defineSymbol('Bench', 'Urban & Architecture', '<path d="M35 74h150v40H35zM25 130h170v33H25z" fill="#8b5e3c"/><path d="M48 163l-12 46M172 163l12 46M46 114v16M174 114v16"/>'),
  defineSymbol('BusStop', 'Urban & Architecture', '<path d="M29 208V40h162v168M29 61h162M65 208v-90h90v90"/><rect x="55" y="18" width="110" height="43" fill="#48f7ff"/><text x="110" y="48" text-anchor="middle" fill="#07111d" stroke="none" font-size="25">BUS</text>'),
  defineSymbol('Billboard', 'Urban & Architecture', '<rect x="20" y="28" width="180" height="108" fill="#20152e"/><path d="M62 136v72M158 136v72M42 208h136"/><text x="110" y="93" text-anchor="middle" fill="#ff5ca8" stroke="none" font-size="25">NEO</text>'),
  defineSymbol('Fence', 'Urban & Architecture', '<path d="M20 205V48l18-25 18 25v157M82 205V48l18-25 18 25v157M144 205V48l18-25 18 25v157M7 82h206M7 161h206"/>'),
  defineSymbol('Gate', 'Urban & Architecture', '<path d="M18 208V48h184v160M18 76h184M110 76v132M18 208q46-75 92 0M110 208q46-75 92 0"/>'),
  defineSymbol('Fountain', 'Urban & Architecture', '<path d="M30 163h160q-3 45-80 45t-80-45z" fill="#5a7188"/><path d="M110 20v105M110 48q-66 20-63 81M110 48q66 20 63 81" stroke="#58d3ff"/><path d="M75 124h70l-14 39H89z" fill="#6d7f91"/>', 'every 2.4s fade {id} from=.65 to=1'),
  defineSymbol('Statue', 'Urban & Architecture', '<path d="M65 208h90l-12-36H77z" fill="#718a82"/><circle cx="110" cy="42" r="26" fill="#718a82"/><path d="M110 68v71M110 84L68 124M110 84l42 40M110 139l-30 34M110 139l30 34" stroke="#718a82" stroke-width="20"/>'),
  defineSymbol('TrashCan', 'Urban & Architecture', '<path d="M50 68h120l-13 140H63z" fill="#54616f"/><path d="M40 68h140M78 68V39h64v29M82 92v91M110 92v91M138 92v91"/>'),

  // Vehicles
  defineSymbol('ModernCar', 'Vehicles', '<path d="M18 141l25-57 42-32h78l38 51 11 38v35H8v-23z" fill="#3178ff"/><path d="M75 61h80l31 44H47z" fill="#bcecff"/><circle cx="56" cy="172" r="25" fill="#111827"/><circle cx="169" cy="172" r="25" fill="#111827"/>', 'every 4s move {id} fromX=-220 toX=1450 duration=4'),
  defineSymbol('VintageCar', 'Vehicles', '<path d="M15 143l19-55h31l24-39h75l25 39h17l10 55v31H15z" fill="#d85d75"/><path d="M96 58h62l20 30H76z" fill="#dff4ff"/><circle cx="55" cy="174" r="27" fill="#191521"/><circle cx="174" cy="174" r="27" fill="#191521"/><circle cx="19" cy="128" r="12" fill="#ffe66d"/>', 'every 5s move {id} fromX=-220 toX=1450 duration=5'),
  defineSymbol('Truck', 'Vehicles', '<path d="M10 65h125v109H10z" fill="#e05a47"/><path d="M135 102h45l30 36v36h-75z" fill="#f07b56"/><rect x="150" y="113" width="28" height="25" fill="#bcecff"/><circle cx="51" cy="178" r="27" fill="#111"/><circle cx="167" cy="178" r="27" fill="#111"/>', 'every 6s move {id} fromX=-260 toX=1450 duration=6'),
  defineSymbol('LaneTruck', 'Vehicles', '<rect x="55" y="22" width="110" height="176" rx="24" fill="#ff9f2f"/><rect x="73" y="48" width="74" height="43" rx="9" fill="#aef7ff"/><path d="M69 198v-25M151 198v-25" stroke="#111827" stroke-width="19"/><rect x="78" y="150" width="64" height="18" fill="#ff54da"/>'),
  defineSymbol('TrafficCar', 'Vehicles', '<rect x="61" y="31" width="98" height="162" rx="25" fill="#ff4f81"/><rect x="78" y="57" width="64" height="48" rx="9" fill="#aef7ff"/><path d="M70 193v-24M150 193v-24" stroke="#111827" stroke-width="17"/>'),
  defineSymbol('Airplane', 'Vehicles', '<path d="M12 116l77-19 37-73h22l-13 69 62-8 16 19-78 20 12 70h-22l-36-61-61 16z" fill="#d7e4ed"/>', 'every 7s move {id} fromX=-220 toX=1450 duration=7'),
  defineSymbol('Helicopter', 'Vehicles', '<path d="M40 127q0-61 62-61h31q48 0 48 61z" fill="#5965d8"/><path d="M181 104l30-39M183 104h29M110 66V32M45 32h130M35 128l-24 21M66 128v33h98M164 128v33"/>', 'every 3s move {id} fromY=300 toY=255 duration=3 alternate=true'),
  defineSymbol('Rocket', 'Vehicles', '<path d="M110 14q58 57 35 133l-35 36-35-36Q52 71 110 14z" fill="#e9edf2"/><circle cx="110" cy="80" r="21" fill="#54d2ff"/><path d="M75 126l-32 45 38-6M145 126l32 45-38-6M91 181l19 31 19-31" fill="#ff5b5b"/>', 'every 5s move {id} fromY=520 toY=-220 duration=5'),
  defineSymbol('Spaceship', 'Vehicles', '<ellipse cx="110" cy="123" rx="94" ry="42" fill="#7682a8"/><path d="M58 112q14-72 52-72t52 72" fill="#6fe3ff"/><ellipse cx="110" cy="144" rx="55" ry="18" fill="#ff62d0"/><circle cx="48" cy="126" r="8" fill="#c6ff00"/><circle cx="172" cy="126" r="8" fill="#c6ff00"/>', 'every 4s move {id} fromX=420 toX=820 duration=4 alternate=true'),
  defineSymbol('Submarine', 'Vehicles', '<ellipse cx="107" cy="130" rx="91" ry="45" fill="#d4a62a"/><path d="M77 87v-37h55v37M104 50V25h35M184 126l28-25v58z"/><circle cx="66" cy="128" r="14" fill="#64d8ff"/><circle cx="111" cy="128" r="14" fill="#64d8ff"/>', 'every 6s move {id} fromX=380 toX=820 duration=6 alternate=true'),
  defineSymbol('Boat', 'Vehicles', '<path d="M18 128h184l-32 65H50z" fill="#795548"/><path d="M68 128V72h89l28 56"/><rect x="79" y="84" width="63" height="44" fill="#e8f6ff"/><path d="M13 204q25-20 50 0t50 0t50 0t50 0" stroke="#42c5f5"/>', 'every 3s move {id} fromY=300 toY=312 duration=3 alternate=true'),
  defineSymbol('Sailboat', 'Vehicles', '<path d="M21 164h178l-31 43H55z" fill="#8b5a3c"/><path d="M110 27v137M105 37L43 145h62M116 51l56 94h-56" fill="#f4f0df"/>', 'every 3s move {id} fromY=300 toY=310 duration=3 alternate=true'),
  defineSymbol('Train', 'Vehicles', '<rect x="14" y="54" width="192" height="126" rx="15" fill="#cc3f67"/><path d="M14 106h192M59 54v52M110 54v52M161 54v52"/><rect x="30" y="70" width="28" height="25" fill="#bdeaff"/><rect x="73" y="70" width="28" height="25" fill="#bdeaff"/><rect x="116" y="70" width="28" height="25" fill="#bdeaff"/><circle cx="55" cy="181" r="24" fill="#171923"/><circle cx="165" cy="181" r="24" fill="#171923"/>', 'every 5s move {id} fromX=-300 toX=1500 duration=5'),
  defineSymbol('MetroCar', 'Vehicles', '<rect x="26" y="28" width="168" height="170" rx="29" fill="#5b6fd8"/><rect x="48" y="49" width="124" height="72" rx="8" fill="#bcecff"/><path d="M110 49v72M44 145h132M63 198l-22 18M157 198l22 18"/><circle cx="72" cy="161" r="10" fill="#ffde59"/><circle cx="148" cy="161" r="10" fill="#ffde59"/>', 'every 4s move {id} fromX=-260 toX=1450 duration=4'),
  defineSymbol('Skateboard', 'Vehicles', '<path d="M27 108q0 31 38 31h90q38 0 38-31" stroke="#ff4fa3" stroke-width="16"/><circle cx="68" cy="161" r="17" fill="#48f7ff"/><circle cx="158" cy="161" r="17" fill="#48f7ff"/>', 'every 2s rotate {id} from=-4 to=4'),
  defineSymbol('Segway', 'Vehicles', '<circle cx="72" cy="183" r="26" fill="#19202b"/><circle cx="148" cy="183" r="26" fill="#19202b"/><path d="M72 180h76M110 177V60M90 60h40M85 145h50" stroke-width="12"/>', 'every 4s move {id} fromX=440 toX=760 duration=4 alternate=true'),

  // Interior & Furniture
  defineSymbol('Armchair', 'Interior & Furniture', '<path d="M49 102V73q0-43 61-43t61 43v29" fill="#724f8f"/><rect x="39" y="96" width="142" height="84" rx="25" fill="#835ea1"/><rect x="17" y="87" width="44" height="95" rx="18" fill="#68447f"/><rect x="159" y="87" width="44" height="95" rx="18" fill="#68447f"/><path d="M62 180v28M158 180v28"/>'),
  defineSymbol('Bed', 'Interior & Furniture', '<path d="M21 94h178v91H21z" fill="#5571a9"/><path d="M21 55v153M199 82v126M26 94q47-47 88 0"/><rect x="32" y="68" width="61" height="28" rx="12" fill="#e8eef8"/><path d="M21 185h178"/>'),
  defineSymbol('Cabinet', 'Interior & Furniture', '<rect x="43" y="18" width="134" height="190" fill="#72513b"/><path d="M110 18v190M43 117h134"/><circle cx="93" cy="76" r="5" fill="#ffd166"/><circle cx="127" cy="76" r="5" fill="#ffd166"/><circle cx="93" cy="158" r="5" fill="#ffd166"/><circle cx="127" cy="158" r="5" fill="#ffd166"/>'),
  defineSymbol('InteriorWindow', 'Interior & Furniture', '<rect x="24" y="24" width="172" height="172" fill="#8cddff"/><path d="M110 24v172M24 110h172"/><path d="M11 12h198v198H11z" stroke="#8b5e3c" stroke-width="14"/>'),
  defineSymbol('DeskLamp', 'Interior & Furniture', '<path d="M72 194h76M110 194v-56l-48-44 43-57" stroke-width="12"/><path d="M82 18h72l-18 58H64z" fill="#ffd166"/><ellipse cx="102" cy="83" rx="56" ry="24" fill="#ffd166" opacity=".28"/>', 'every 1.5s flicker {id} min=.75 max=1'),
  defineSymbol('CeilingFan', 'Interior & Furniture', '<circle cx="110" cy="110" r="22" fill="#6b7280"/><path d="M110 88V20q-65-8-58 30l45 51M132 110h68q8-65-30-58l-51 45M110 132v68q65 8 58-30l-45-51M88 110H20q-8 65 30 58l51-45" fill="#87909d"/>', 'every 2s rotate {id} from=0 to=360'),
  defineSymbol('Fireplace', 'Interior & Furniture', '<path d="M28 208V45h164v163M28 72h164M57 208v-99h106v99" fill="#7b4e42"/><path d="M110 194q-52-35-9-86-3 38 23 30 32-26 16-58 58 66 11 114z" fill="#ff6b35"/>', 'every .8s scale {id} from=.94 to=1.06'),
  defineSymbol('Staircase', 'Interior & Furniture', '<path d="M18 202h38v-36h36v-36h36V94h36V58h38" stroke-width="22"/><path d="M18 202L202 58" stroke="#6d7b8c"/>'),
  defineSymbol('Rug', 'Interior & Furniture', '<ellipse cx="110" cy="126" rx="98" ry="68" fill="#b33a70"/><ellipse cx="110" cy="126" rx="68" ry="43"/><path d="M24 177l-8 27M45 188l-4 22M196 177l8 27M175 188l4 22"/>'),
  defineSymbol('Curtain', 'Interior & Furniture', '<path d="M35 27h150v181H35z" fill="#793f86"/><path d="M35 27h150M61 27q-25 87 0 181M110 27q-25 87 0 181M159 27q25 87 0 181"/><path d="M20 27h180" stroke-width="12"/>'),
  defineSymbol('WallPainting', 'Interior & Furniture', '<rect x="26" y="28" width="168" height="164" fill="#67405e"/><rect x="44" y="46" width="132" height="128" fill="#16243e"/><circle cx="76" cy="79" r="16" fill="#ffd166"/><path d="M45 174l54-66 31 35 20-20 26 51" fill="#4fad78"/>'),
  defineSymbol('WallClock', 'Interior & Furniture', '<circle cx="110" cy="110" r="91" fill="#f0ecdf"/><circle cx="110" cy="110" r="7" fill="#20242b"/><path d="M110 110V53M110 110l44 26" stroke="#20242b"/><path d="M110 27v14M110 179v14M27 110h14M179 110h14"/>'),
  defineSymbol('Mirror', 'Interior & Furniture', '<ellipse cx="110" cy="110" rx="73" ry="96" fill="#bdeaff"/><ellipse cx="110" cy="110" rx="87" ry="104"/><path d="M70 57q42-29 78 2" stroke="#fff" opacity=".7"/>'),

  // Tech & Electronics
  defineSymbol('Smartphone', 'Tech & Electronics', '<rect x="64" y="12" width="92" height="196" rx="18" fill="#1a2030"/><rect x="73" y="34" width="74" height="142" fill="#36c5f0"/><circle cx="110" cy="192" r="7"/><path d="M97 23h26"/>'),
  defineSymbol('Tablet', 'Tech & Electronics', '<rect x="31" y="38" width="158" height="144" rx="16" fill="#202839"/><rect x="47" y="54" width="126" height="108" fill="#5ed9ff"/><circle cx="181" cy="110" r="5"/>'),
  defineSymbol('Mouse', 'Tech & Electronics', '<path d="M70 198V92q0-74 40-74t40 74v106z" fill="#555f73"/><path d="M110 19v73M70 92h80"/><rect x="102" y="42" width="16" height="31" rx="8" fill="#48f7ff"/>'),
  defineSymbol('Printer', 'Tech & Electronics', '<rect x="31" y="70" width="158" height="111" rx="12" fill="#596579"/><path d="M59 70V22h102v48M58 138h104v70H58z" fill="#dce7ef"/><path d="M76 159h69M76 178h55"/><circle cx="162" cy="99" r="7" fill="#c6ff00"/>'),
  defineSymbol('ServerRack', 'Tech & Electronics', '<rect x="48" y="13" width="124" height="195" rx="8" fill="#202634"/><path d="M61 48h98M61 87h98M61 126h98M61 165h98"/><g fill="#48f7ff" stroke="none"><circle cx="75" cy="31" r="5"/><circle cx="75" cy="70" r="5"/><circle cx="75" cy="109" r="5"/><circle cx="75" cy="148" r="5"/><circle cx="75" cy="187" r="5"/></g>', 'every 1.1s flicker {id} min=.65 max=1'),
  defineSymbol('Router', 'Tech & Electronics', '<rect x="35" y="117" width="150" height="66" rx="12" fill="#273145"/><path d="M63 117L50 45M157 117l13-72"/><circle cx="76" cy="151" r="6" fill="#c6ff00"/><circle cx="105" cy="151" r="6" fill="#48f7ff"/><circle cx="134" cy="151" r="6" fill="#ff4fa3"/><path d="M81 84q29-34 58 0M96 98q14-17 28 0"/>', 'every 1.5s flicker {id} min=.55 max=1'),
  defineSymbol('TVScreen', 'Tech & Electronics', '<rect x="16" y="30" width="188" height="137" rx="12" fill="#191d29"/><rect x="32" y="46" width="156" height="105" fill="#37c8ff"/><path d="M110 167v29M69 205h82"/><path d="M44 69h132M44 95h132M44 121h132" stroke="#fff" opacity=".25"/>', 'every .9s flicker {id} min=.7 max=1'),
  defineSymbol('Headphones', 'Tech & Electronics', '<path d="M36 128V91a74 74 0 01148 0v37" stroke-width="18"/><rect x="18" y="111" width="47" height="78" rx="20" fill="#7546a8"/><rect x="155" y="111" width="47" height="78" rx="20" fill="#7546a8"/>'),
  defineSymbol('Camera', 'Tech & Electronics', '<rect x="24" y="69" width="172" height="113" rx="16" fill="#313947"/><path d="M68 69l18-31h48l18 31"/><circle cx="110" cy="126" r="42" fill="#101722"/><circle cx="110" cy="126" r="24" fill="#59d6ff"/><circle cx="172" cy="91" r="7" fill="#ff5b6e"/>'),
  defineSymbol('Robot', 'Tech & Electronics', '<rect x="53" y="33" width="114" height="86" rx="16" fill="#758195"/><circle cx="85" cy="75" r="10" fill="#48f7ff"/><circle cx="135" cy="75" r="10" fill="#48f7ff"/><path d="M84 99h52M110 33V12M98 12h24"/><rect x="43" y="129" width="134" height="63" rx="12" fill="#596579"/><path d="M43 143L13 174M177 143l30 31M74 192v19M146 192v19"/>', 'every 1.2s flicker {id} min=.7 max=1'),
  defineSymbol('Drone', 'Tech & Electronics', '<rect x="79" y="89" width="62" height="45" rx="12" fill="#556070"/><path d="M79 101L35 65M141 101l44-36M79 121l-44 36M141 121l44 36"/><ellipse cx="29" cy="59" rx="29" ry="9"/><ellipse cx="191" cy="59" rx="29" ry="9"/><ellipse cx="29" cy="163" rx="29" ry="9"/><ellipse cx="191" cy="163" rx="29" ry="9"/>', 'every 2.5s move {id} fromY=300 toY=270 duration=2.5 alternate=true'),
  defineSymbol('SatelliteDish', 'Tech & Electronics', '<path d="M39 62q35 99 135 104Q139 66 39 62z" fill="#718096"/><path d="M111 117l59-59M169 58l22-22M111 117v66M75 205h72"/><circle cx="174" cy="53" r="10" fill="#48f7ff"/>', 'every 1.4s flicker {id} min=.55 max=1'),
  defineSymbol('ControlPanel', 'Tech & Electronics', '<rect x="17" y="42" width="186" height="136" rx="12" fill="#222b3b"/><g fill="#ff4fa3" stroke="none"><circle cx="55" cy="81" r="10"/><circle cx="91" cy="81" r="10"/></g><g fill="#48f7ff" stroke="none"><circle cx="129" cy="81" r="10"/><circle cx="165" cy="81" r="10"/></g><path d="M44 128h62M125 128h50M44 151h131"/>', 'every 1s flicker {id} min=.6 max=1'),
  defineSymbol('Joystick', 'Tech & Electronics', '<path d="M42 151h136l22 57H20z" fill="#354052"/><path d="M108 151L91 55" stroke-width="15"/><circle cx="88" cy="40" r="25" fill="#ff4f81"/><circle cx="150" cy="173" r="12" fill="#48f7ff"/><circle cx="174" cy="185" r="10" fill="#c6ff00"/>'),

  // Cyberpunk / Sci-Fi
  defineSymbol('HologramDisplay', 'Cyberpunk / Sci-Fi', '<path d="M31 178h158l-21 30H52z" fill="#2a3150"/><path d="M52 30h116v133H52z" fill="#48f7ff" opacity=".16"/><path d="M71 61h78M71 92h58M71 123h70" stroke="#48f7ff"/>', 'every 1.3s flicker {id} min=.55 max=1'),
  defineSymbol('EnergyShield', 'Cyberpunk / Sci-Fi', '<path d="M110 13l80 30v58q0 71-80 105-80-34-80-105V43z" fill="#48f7ff" opacity=".18"/><path d="M110 32l59 22v47q0 52-59 81-59-29-59-81V54z"/>', 'every 1.5s scale {id} from=.94 to=1.06'),
  defineSymbol('LaserBeam', 'Cyberpunk / Sci-Fi', '<path d="M10 110h200" stroke="#ff2bd6" stroke-width="20"/><path d="M10 110h200" stroke="#fff" stroke-width="5"/>', 'every .5s flicker {id} min=.45 max=1'),
  defineSymbol('Portal', 'Cyberpunk / Sci-Fi', '<ellipse cx="110" cy="110" rx="76" ry="99" stroke="#8b5cf6" stroke-width="22"/><ellipse cx="110" cy="110" rx="51" ry="72" fill="#281256"/><path d="M72 55q77 47 0 110M148 55q-77 47 0 110" stroke="#48f7ff"/>', 'every 3s rotate {id} from=0 to=360'),
  defineSymbol('Wormhole', 'Cyberpunk / Sci-Fi', '<path d="M110 110c-91-74-121 85-17 62 91-20 83-154-19-121-86 29-42 166 58 130 79-29 40-139-39-102-53 25-11 104 41 68" stroke="#b25cff" stroke-width="12"/>', 'every 4s rotate {id} from=0 to=360'),
  defineSymbol('ForceField', 'Cyberpunk / Sci-Fi', '<path d="M25 200Q30 24 110 15q80 9 85 185z" fill="#44d8ff" opacity=".15"/><path d="M46 184Q52 48 110 38q58 10 64 146" stroke-dasharray="15 12"/>', 'every 1.7s fade {id} from=.35 to=1'),
  defineSymbol('MechSuit', 'Cyberpunk / Sci-Fi', '<rect x="65" y="39" width="90" height="78" rx="16" fill="#4a5365"/><rect x="52" y="123" width="116" height="60" fill="#5c6678"/><path d="M52 132L16 171M168 132l36 39M76 183l-16 27M144 183l16 27M110 39V15" stroke-width="18"/><circle cx="91" cy="76" r="9" fill="#ff2bd6"/><circle cx="129" cy="76" r="9" fill="#48f7ff"/>'),
  defineSymbol('Hoverboard', 'Cyberpunk / Sci-Fi', '<path d="M24 112q5 42 45 42h82q40 0 45-42" stroke="#8b5cf6" stroke-width="17"/><path d="M52 176h116" stroke="#48f7ff" stroke-width="12"/><ellipse cx="110" cy="184" rx="76" ry="20" fill="#48f7ff" opacity=".2"/>', 'every 2s move {id} fromY=300 toY=280 duration=2 alternate=true'),
  defineSymbol('Jetpack', 'Cyberpunk / Sci-Fi', '<rect x="56" y="31" width="45" height="111" rx="10" fill="#596579"/><rect x="119" y="31" width="45" height="111" rx="10" fill="#596579"/><path d="M64 142l15 66 14-66M127 142l14 66 15-66" fill="#ff7b32"/><path d="M101 62h18M46 72h10M164 72h10"/>', 'every 3s move {id} fromY=400 toY=120 duration=3 alternate=true'),
  defineSymbol('SpaceStationPanel', 'Cyberpunk / Sci-Fi', '<rect x="14" y="25" width="192" height="170" rx="10" fill="#1b2131"/><path d="M31 48h78v62H31zM126 48h62v28h-62zM126 88h62v22h-62zM31 128h157v48H31z" fill="#31415e"/><circle cx="54" cy="151" r="9" fill="#ff4f81"/><circle cx="82" cy="151" r="9" fill="#48f7ff"/><path d="M116 141h53M116 160h40"/>', 'every 1s flicker {id} min=.7 max=1'),
  defineSymbol('AlienPlant', 'Cyberpunk / Sci-Fi', '<path d="M110 204V77M110 111Q59 74 49 32M110 137q60-22 72-75M110 164q-47 4-73 35" stroke="#55efc4" stroke-width="13"/><ellipse cx="46" cy="28" rx="29" ry="17" fill="#ff4fd8"/><ellipse cx="184" cy="57" rx="31" ry="18" fill="#8b5cf6"/><circle cx="110" cy="61" r="32" fill="#48f7ff"/>', 'every 2s scale {id} from=.93 to=1.07'),
  defineSymbol('Crystal', 'Cyberpunk / Sci-Fi', '<path d="M110 10l63 72-22 113-41 20-41-20L47 82z" fill="#69e7ff" opacity=".55"/><path d="M110 10v205M47 82h126M69 195l41-113 41 113"/>', 'every 2s flicker {id} min=.65 max=1'),
  defineSymbol('DataStream', 'Cyberpunk / Sci-Fi', '<path d="M42 12v196M84 12v196M126 12v196M168 12v196" stroke="#48f7ff" stroke-dasharray="13 15"/><g fill="#c6ff00" stroke="none"><circle cx="42" cy="38" r="7"/><circle cx="84" cy="118" r="7"/><circle cx="126" cy="72" r="7"/><circle cx="168" cy="163" r="7"/></g>', 'every 2s move {id} fromY=260 toY=340 duration=2'),
  defineSymbol('CircuitBoard', 'Cyberpunk / Sci-Fi', '<rect x="18" y="18" width="184" height="184" rx="10" fill="#123d38"/><path d="M42 62h45v38h47v50h44M42 154h39v-30h42V70h55M65 42v20M154 150v31"/><g fill="#c6ff00" stroke="none"><circle cx="42" cy="62" r="7"/><circle cx="178" cy="150" r="7"/><circle cx="178" cy="70" r="7"/><circle cx="65" cy="42" r="7"/></g>'),
  defineSymbol('PowerCell', 'Cyberpunk / Sci-Fi', '<rect x="59" y="19" width="102" height="182" rx="17" fill="#27304a"/><path d="M87 19V5h46v14M76 51h68v118H76z" fill="#3df2a4" opacity=".45"/><path d="M118 60l-26 49h25l-15 49 34-63h-24z" fill="#fff36d"/>', 'every 1.4s flicker {id} min=.55 max=1'),
  defineSymbol('PlasmaOrb', 'Cyberpunk / Sci-Fi', '<circle cx="110" cy="95" r="76" fill="#7026b9" opacity=".4"/><path d="M110 95L73 37M110 95l49-45M110 95l58 28M110 95l-34 60M110 95l-2 74" stroke="#ff71dc"/><path d="M69 184h82M82 169h56"/>', 'every 1.1s flicker {id} min=.5 max=1'),
  defineSymbol('HolographicMap', 'Cyberpunk / Sci-Fi', '<path d="M20 52l55-26 70 24 55-24v142l-55 26-70-24-55 24z" fill="#48f7ff" opacity=".13"/><path d="M75 26v144M145 50v144M42 90l41-22 38 33 56-27M42 142l49-23 37 25 48-26"/>', 'every 1.7s flicker {id} min=.55 max=1'),

  // Food & Objects
  defineSymbol('SnakeFood', 'Food & Objects', '<circle cx="110" cy="116" r="66" fill="#ff54da"/><path d="M110 50q7-32 35-39" stroke="#6fd56c" stroke-width="15"/><path d="M107 58q-34-36-61-13 19 31 61 13Z" fill="#74c764"/>', 'every 1.1s scale {id} from=.88 to=1.1'),
  defineSymbol('Pizza', 'Food & Objects', '<path d="M110 18L29 193h162z" fill="#f4bd4f"/><path d="M43 163h134" stroke="#b96f32" stroke-width="21"/><g fill="#d43f4f" stroke="none"><circle cx="91" cy="93" r="13"/><circle cx="129" cy="132" r="13"/><circle cx="84" cy="145" r="11"/></g>'),
  defineSymbol('BeerGlass', 'Food & Objects', '<path d="M47 37h111l-12 160H59z" fill="#f6b93b"/><path d="M158 69h29q23 0 23 36t-23 36h-35"/><path d="M52 67h101" stroke="#fff" stroke-width="23"/><path d="M78 80v92M112 80v92" stroke="#ffe8a3" opacity=".7"/>'),
  defineSymbol('Bottle', 'Food & Objects', '<path d="M88 15h44v48l24 37v108H64V100l24-37z" fill="#2f9e70"/><path d="M88 15h44M76 118h68v58H76z" fill="#f0e6c8"/>'),
  defineSymbol('Vase', 'Food & Objects', '<path d="M72 24h76l-18 55q58 78 12 129H78q-46-51 12-129z" fill="#7f5af0"/><path d="M81 49h58M76 134h68"/>'),
  defineSymbol('Trophy', 'Food & Objects', '<path d="M68 30h84v40q0 61-42 72-42-11-42-72z" fill="#ffd43b"/><path d="M68 48H27q0 66 54 63M152 48h41q0 66-54 63M110 142v39M72 207h76M84 181h52"/>'),
  defineSymbol('Book', 'Food & Objects', '<path d="M18 45q50-17 92 18v143q-42-31-92-14z" fill="#4a69bd"/><path d="M202 45q-50-17-92 18v143q42-31 92-14z" fill="#5f82d8"/><path d="M110 63v143"/>'),
  defineSymbol('Newspaper', 'Food & Objects', '<rect x="22" y="25" width="176" height="180" fill="#eeeae0"/><path d="M40 49h140M40 70h140M40 94h58v57H40zM112 94h68M112 116h68M112 138h68M40 169h140M40 187h140" stroke="#4b5563"/>'),
  defineSymbol('Coin', 'Food & Objects', '<circle cx="110" cy="110" r="92" fill="#f2c94c"/><circle cx="110" cy="110" r="67"/><path d="M110 66v88M136 82q-12-16-32-11-22 6-15 26 4 12 23 16 22 4 20 24-2 18-24 19-19 1-30-16"/>', 'every 3s rotate {id} from=0 to=360'),
  defineSymbol('Gem', 'Food & Objects', '<path d="M24 79l38-48h96l38 48-86 126z" fill="#55d6ff"/><path d="M24 79h172M62 31l48 174 48-174M62 31l-18 48 66 126 66-126-18-48"/>', 'every 1.7s flicker {id} min=.65 max=1'),
  defineSymbol('Key', 'Food & Objects', '<circle cx="61" cy="83" r="43"/><path d="M92 113l104 96M139 156l25-27M164 180l25-27" stroke-width="16"/>'),
  defineSymbol('Lock', 'Food & Objects', '<rect x="44" y="93" width="132" height="112" rx="12" fill="#5f6675"/><path d="M70 93V62q0-44 40-44t40 44v31" stroke-width="16"/><circle cx="110" cy="143" r="12" fill="#111827"/><path d="M110 155v25"/>'),
  defineSymbol('Umbrella', 'Food & Objects', '<path d="M14 102a96 96 0 01192 0q-24-22-48 0-24-22-48 0-24-22-48 0-24-22-48 0z" fill="#ff5ca8"/><path d="M110 22v151q0 37 30 25"/>'),
  defineSymbol('Balloon', 'Food & Objects', '<ellipse cx="110" cy="76" rx="61" ry="70" fill="#ff5a7a"/><path d="M110 146l-10 16h20zM110 162q-25 20 4 46"/>', 'every 3s move {id} fromY=300 toY=260 duration=3 alternate=true'),
  defineSymbol('Candle', 'Food & Objects', '<rect x="73" y="84" width="74" height="123" rx="8" fill="#f2dfb4"/><path d="M110 85V57"/><path d="M110 12q37 38 0 68-37-30 0-68z" fill="#ff8b32"/>', 'every .7s flicker {id} min=.6 max=1'),
  defineSymbol('GiftBox', 'Food & Objects', '<rect x="29" y="84" width="162" height="124" fill="#e84a8a"/><rect x="17" y="63" width="186" height="42" fill="#ff6eaa"/><path d="M110 63v145" stroke="#ffd166" stroke-width="15"/><path d="M110 62Q65 62 67 24q36-3 43 38M110 62q45 0 43-38-36-3-43 38" fill="#ffd166"/>'),
  defineSymbol('Lantern', 'Food & Objects', '<path d="M69 46h82l17 42-12 99H64L52 88z" fill="#ffc857"/><path d="M73 46q5-37 37-37t37 37M64 187h92M52 88h116M82 88v75M138 88v75"/>', 'every 1.3s flicker {id} min=.72 max=1'),
  defineSymbol('Torch', 'Food & Objects', '<path d="M87 91h46l-11 117H98z" fill="#7b5134"/><path d="M110 94Q46 54 96 7q-3 37 20 29 31-20 17-36 51 58-23 94z" fill="#ff6b35"/>', 'every .7s scale {id} from=.92 to=1.08'),
  defineSymbol('Bell', 'Food & Objects', '<path d="M41 169h138q-26-29-26-88 0-43-43-52-43 9-43 52 0 59-26 88z" fill="#e8b936"/><path d="M91 30q0-20 19-20t19 20M89 169q3 33 21 33t21-33"/>'),
  defineSymbol('Crown', 'Food & Objects', '<path d="M25 65l42 46 43-80 43 80 42-46-18 119H43z" fill="#ffd43b"/><path d="M43 184h134M56 144h108"/><g fill="#ff4f81" stroke="none"><circle cx="67" cy="139" r="8"/><circle cx="110" cy="139" r="8"/><circle cx="153" cy="139" r="8"/></g>'),
  defineSymbol('Sword', 'Food & Objects', '<path d="M110 12l22 23-9 111-13 25-13-25-9-111z" fill="#dce5ed"/><path d="M55 145h110M110 145v63M90 208h40" stroke-width="14"/>'),
  defineSymbol('Shield', 'Food & Objects', '<path d="M110 13l80 30v58q0 71-80 105-80-34-80-105V43z" fill="#4d7ea8"/><path d="M110 42v132M55 83h110"/>'),
  defineSymbol('Axe', 'Food & Objects', '<path d="M112 48l29-31q51 12 60 58l-38 41-51-20z" fill="#cbd5df"/><path d="M128 88L49 208" stroke="#7b5134" stroke-width="20"/>'),
  defineSymbol('PotionBottle', 'Food & Objects', '<path d="M82 18h56v48l38 44v98H44v-98l38-44z" fill="#7d3ccf"/><path d="M82 18h56M59 123h102"/><circle cx="84" cy="154" r="10" fill="#ff6edb"/><circle cx="126" cy="173" r="13" fill="#48f7ff"/>', 'every 1.5s flicker {id} min=.7 max=1'),
  defineSymbol('Scroll', 'Food & Objects', '<path d="M58 35h111q25 0 25 24t-25 24H58v102h105q25 0 25-24t-25-24" fill="#e8d6a8"/><path d="M58 35q-30 0-30 24t30 24v102q-26 0-26 22h131"/><path d="M78 106h78M78 130h62" stroke="#8b6a3d"/>'),

  // Weather & Effects
  defineSymbol('Explosion', 'Weather & Effects', '<path d="M110 8l21 60 56-31-23 61 50 14-55 28 35 51-62-19-22 41-21-49-61 28 25-56-48-26 57-19-25-58 56 31z" fill="#ff6b35"/>', 'every .8s scale {id} from=.8 to=1.15'),
  defineSymbol('SmokePuff', 'Weather & Effects', '<path d="M36 171c-33-22-12-70 26-62-14-38 32-67 62-39 23-42 87-13 76 35 33 16 19 67-20 67z" fill="#8c94a3"/>', 'every 4s move {id} fromY=300 toY=190 duration=4'),
  defineSymbol('Sparkle', 'Weather & Effects', '<path d="M110 12l16 73 72 25-72 22-16 76-17-76-71-22 71-25z" fill="#fff2a6"/>', 'every 1s scale {id} from=.55 to=1.1'),
  defineSymbol('StarBurst', 'Weather & Effects', '<path d="M110 8l12 64 43-49-19 62 61-22-50 43 61 13-64 8 48 46-58-27 15 63-39-52-10 65-10-65-39 52 15-63-58 27 48-46-64-8 61-13-50-43 61 22-19-62 43 49z" fill="#ffe063"/>', 'every 1.2s rotate {id} from=0 to=360'),
  defineSymbol('Ripple', 'Weather & Effects', '<ellipse cx="110" cy="110" rx="29" ry="13"/><ellipse cx="110" cy="110" rx="61" ry="28"/><ellipse cx="110" cy="110" rx="96" ry="45"/>', 'every 2s scale {id} from=.6 to=1.2'),
  defineSymbol('Splash', 'Weather & Effects', '<path d="M110 197q-68-7-62-55 6-38 48-31L72 25l43 66 25-79 17 91q43-13 50 32 9 55-97 62z" fill="#4fc3f7"/>', 'every 1.4s scale {id} from=.82 to=1.08'),
  defineSymbol('WindGust', 'Weather & Effects', '<path d="M12 67h123q35 0 35-25t-29-19M12 111h178q26 0 26 24t-30 24M12 157h103q34 0 34 25t-25 25"/>', 'every 3s move {id} fromX=430 toX=680 duration=3'),
  defineSymbol('Tornado', 'Weather & Effects', '<path d="M18 31h184M40 68h140M58 105h104M75 142h70M93 179h34M105 207h10" stroke-width="15"/>', 'every 1.6s rotate {id} from=0 to=360'),
  defineSymbol('Blizzard', 'Weather & Effects', '<path d="M10 55h200M25 108h170M5 161h210" stroke="#d9f6ff" stroke-width="10"/><g fill="#fff" stroke="none"><circle cx="42" cy="31" r="7"/><circle cx="110" cy="83" r="8"/><circle cx="176" cy="136" r="7"/><circle cx="70" cy="190" r="9"/></g>', 'every 2s move {id} fromX=430 toX=680 duration=2'),
  defineSymbol('HeatShimmer', 'Weather & Effects', '<path d="M45 206q-35-31 0-66t0-66 0-66M110 206q-35-31 0-66t0-66 0-66M175 206q-35-31 0-66t0-66 0-66" opacity=".65"/>', 'every 2s fade {id} from=.25 to=.8'),

  // Symbols & Abstract
  defineSymbol('ArrowUp', 'Symbols & Abstract', '<path d="M110 205V25M42 94l68-69 68 69" stroke-width="18"/>'),
  defineSymbol('ArrowDown', 'Symbols & Abstract', '<path d="M110 15v180M42 126l68 69 68-69" stroke-width="18"/>'),
  defineSymbol('ArrowLeft', 'Symbols & Abstract', '<path d="M205 110H25M94 42l-69 68 69 68" stroke-width="18"/>'),
  defineSymbol('ArrowRight', 'Symbols & Abstract', '<path d="M15 110h180M126 42l69 68-69 68" stroke-width="18"/>'),
  defineSymbol('Heart', 'Symbols & Abstract', '<path d="M110 202L28 121Q-7 76 25 39q37-41 85 11 48-52 85-11 32 37-3 82z" fill="#ff4f7d"/>', 'every 1.2s scale {id} from=.92 to=1.08'),
  defineSymbol('Diamond', 'Symbols & Abstract', '<path d="M110 11l96 99-96 99-96-99z" fill="#3ddcff" opacity=".55"/><path d="M14 110h192M110 11v198"/>'),
  defineSymbol('Triangle', 'Symbols & Abstract', '<path d="M110 15l100 190H10z" fill="#8b5cf6" opacity=".55"/>'),
  defineSymbol('Hexagon', 'Symbols & Abstract', '<path d="M58 20h104l52 90-52 90H58L6 110z" fill="#40e0d0" opacity=".45"/>'),
  defineSymbol('Spiral', 'Symbols & Abstract', '<path d="M109 111q3-29 30-26 39 5 31 47-12 61-84 50-87-14-71-108Q34-29 148 9q106 36 61 151" stroke-width="12"/>', 'every 4s rotate {id} from=0 to=360'),
  defineSymbol('Infinity', 'Symbols & Abstract', '<path d="M110 110Q54 28 18 89q-30 54 28 82 39 19 64-61 25 80 64 61 58-28 28-82-36-61-92 21z" stroke-width="15"/>'),
  defineSymbol('Skull', 'Symbols & Abstract', '<path d="M43 93q0-73 67-73t67 73q0 43-31 58v50H74v-50Q43 136 43 93z" fill="#e6e1d4"/><circle cx="81" cy="98" r="18" fill="#222"/><circle cx="139" cy="98" r="18" fill="#222"/><path d="M96 135l14-21 14 21M88 177v24M110 177v24M132 177v24"/>'),
  defineSymbol('Anchor', 'Symbols & Abstract', '<circle cx="110" cy="37" r="26"/><path d="M110 63v136M58 91h104M21 126q13 74 89 74t89-74M21 126l34 17M199 126l-34 17" stroke-width="13"/>'),
  defineSymbol('Compass', 'Symbols & Abstract', '<circle cx="110" cy="110" r="96"/><path d="M132 88l43-43-23 67-42 63-42-63 20-67 22 43z" fill="#ff5a6f"/><path d="M110 16v19M110 185v19M16 110h19M185 110h19"/>'),
  defineSymbol('Hourglass', 'Symbols & Abstract', '<path d="M48 18h124M48 202h124M61 19q0 57 49 91-49 34-49 91M159 19q0 57-49 91 49 34 49 91"/><path d="M78 63h64q-8 31-32 47-24-16-32-47M76 183q8-44 34-73 26 29 34 73z" fill="#e8c66a"/>', 'every 4s rotate {id} from=0 to=180'),
  defineSymbol('YinYang', 'Symbols & Abstract', '<circle cx="110" cy="110" r="96" fill="#f6f6f6"/><path d="M110 14a48 48 0 010 96 48 48 0 000 96 96 96 0 000-192z" fill="#181a20"/><circle cx="110" cy="62" r="13" fill="#181a20"/><circle cx="110" cy="158" r="13" fill="#f6f6f6"/>'),
  defineSymbol('PeaceSign', 'Symbols & Abstract', '<circle cx="110" cy="110" r="94"/><path d="M110 16v188M110 110l-67 67M110 110l67 67" stroke-width="12"/>'),
  defineSymbol('WarningTriangle', 'Symbols & Abstract', '<path d="M110 14l101 190H9z" fill="#ffd43b"/><path d="M110 70v70" stroke="#20242b" stroke-width="18"/><circle cx="110" cy="171" r="10" fill="#20242b"/>'),
  defineSymbol('Checkmark', 'Symbols & Abstract', '<path d="M20 113l57 62L202 38" stroke="#4ade80" stroke-width="25"/>'),
  defineSymbol('Cross', 'Symbols & Abstract', '<path d="M34 34l152 152M186 34L34 186" stroke="#ff5a6f" stroke-width="24"/>'),

  // Prehistoric & Sci-Fi — geometric line-art additions
  defineSymbol('TRex', 'Animals', '<path d="M150 96 Q192 86 216 60 Q210 84 178 106 Q164 118 150 110 Z" fill="#1f8a4d" stroke="#0b3d24" stroke-width="3"/><path d="M58 96 Q62 60 106 66 Q152 68 160 106 Q162 136 128 142 Q84 146 68 122 Q52 112 58 96 Z" fill="#1f8a4d" stroke="#0b3d24" stroke-width="3"/><path d="M96 132 L120 132 L124 172 L138 192 L110 192 L104 152 Z" fill="#166b3b" stroke="#0b3d24" stroke-width="3"/><path d="M72 134 L94 134 L94 172 L106 192 L78 192 L70 156 Z" fill="#1f8a4d" stroke="#0b3d24" stroke-width="3"/><path d="M74 116 Q100 136 138 124" fill="none" stroke="#35c07a" stroke-width="3" opacity=".6"/><path d="M60 92 Q46 88 40 74 Q34 58 52 58 Q72 58 72 84 Q72 96 60 96 Z" fill="#1f8a4d" stroke="#0b3d24" stroke-width="3"/><path d="M14 84 L52 82 L50 94 Q30 98 16 92 Z" fill="#3a0d14"/><path d="M14 82 L52 80 L52 86 L16 88 Z" fill="#1f8a4d" stroke="#0b3d24" stroke-width="2"/><path d="M16 92 L48 90 L46 100 Q30 102 18 98 Z" fill="#166b3b" stroke="#0b3d24" stroke-width="2"/><path d="M20 86 l3 5 l3 -5 z M28 86 l3 5 l3 -5 z M36 86 l3 5 l3 -5 z" fill="#f6f6f0"/><path d="M74 108 q10 6 6 16" fill="none" stroke="#166b3b" stroke-width="6" stroke-linecap="round"/><circle cx="48" cy="72" r="5" fill="#ffdf3b"/><circle cx="48" cy="72" r="2" fill="#0a0a0a"/>', 'every 2.6s move {id} fromY=297 toY=303 duration=2.6 alternate=true'),
  defineSymbol('Pterodactyl', 'Animals', '<path d="M110 96 Q66 44 20 60 Q40 74 70 84 Q96 92 108 108 Z" fill="#b07a48" stroke="#5f3d1f" stroke-width="3"/><path d="M112 96 Q156 44 202 60 Q182 74 152 84 Q126 92 114 108 Z" fill="#b07a48" stroke="#5f3d1f" stroke-width="3"/><path d="M108 104 Q70 70 30 64 M112 104 Q150 70 192 64" fill="none" stroke="#6f4a28" stroke-width="2" opacity=".7"/><path d="M100 92 L118 92 L114 128 L106 128 Z" fill="#8a5a34" stroke="#5f3d1f" stroke-width="3"/><path d="M104 92 L52 82 L104 102 Z" fill="#8a5a34" stroke="#5f3d1f" stroke-width="2"/><path d="M112 90 Q130 78 142 86 L116 98 Z" fill="#a86f42" stroke="#5f3d1f" stroke-width="2"/><path d="M106 126 l-6 20 M114 126 l6 20" fill="none" stroke="#5f3d1f" stroke-width="4" stroke-linecap="round"/><circle cx="94" cy="90" r="3" fill="#101010"/>', 'every 5s move {id} fromX=505 fromY=292 toX=535 toY=308 duration=5 alternate=true'),
  defineSymbol('Mammoth', 'Animals', '<path d="M52 96 Q60 60 122 64 Q184 68 186 118 Q186 150 140 152 L66 152 Q46 128 52 96 Z" fill="#6f4a2e" stroke="#3c2717" stroke-width="3"/><path d="M52 140 L70 140 L70 194 L52 194 Z" fill="#5c3c25" stroke="#3c2717" stroke-width="2"/><path d="M156 140 L174 140 L174 194 L156 194 Z" fill="#5c3c25" stroke="#3c2717" stroke-width="2"/><path d="M104 148 L122 148 L122 194 L104 194 Z" fill="#6f4a2e" stroke="#3c2717" stroke-width="2"/><path d="M50 100 Q34 78 54 74 Q76 74 78 104 L64 122 Q48 120 50 100 Z" fill="#6f4a2e" stroke="#3c2717" stroke-width="3"/><path d="M52 112 Q34 136 44 160 Q50 168 56 160 Q48 138 62 118 Z" fill="#6f4a2e" stroke="#3c2717" stroke-width="3"/><path d="M46 118 Q14 132 26 160" fill="none" stroke="#efe6d0" stroke-width="7" stroke-linecap="round"/><path d="M56 122 Q28 136 38 160" fill="none" stroke="#efe6d0" stroke-width="6" stroke-linecap="round"/><path d="M92 66 Q120 52 150 66" fill="none" stroke="#5c3c25" stroke-width="4" opacity=".5"/><circle cx="60" cy="94" r="4" fill="#141414"/>', 'every 3s move {id} fromX=516 toX=524 duration=3 alternate=true'),
  defineSymbol('Volcano', 'Nature & Outdoors', '<path d="M18 200 L80 82 L140 82 L202 200 Z" fill="#2c2733" stroke="#120f18" stroke-width="3"/><path d="M80 82 L60 200 M140 82 L164 200" stroke="#211c29" stroke-width="3" opacity=".7" fill="none"/><ellipse cx="110" cy="82" rx="32" ry="9" fill="#ff7a1a"/><g fill="#ffce6a"><path d="M92 82 Q102 50 110 82 Q106 62 98 82 Z"/><animate attributeName="opacity" values=".55;1;.55" dur="1.8s" repeatCount="indefinite"/></g><path d="M104 84 L96 138 L104 176" fill="none" stroke="#ff5a1e" stroke-width="6" stroke-linecap="round"/><path d="M122 84 L134 128 L128 176" fill="none" stroke="#ff7a2e" stroke-width="5" stroke-linecap="round"/><g fill="#c9bcae"><circle cx="102" cy="70" r="4"><animate attributeName="cy" values="70;20" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="3s" repeatCount="indefinite"/></circle><circle cx="116" cy="66" r="3"><animate attributeName="cy" values="66;10" dur="3.6s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="3.6s" repeatCount="indefinite"/></circle><circle cx="110" cy="74" r="3.5"><animate attributeName="cy" values="74;16" dur="4.2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".85;0" dur="4.2s" repeatCount="indefinite"/></circle></g>', 'every 3.2s scale {id} from=1 to=1.05'),
  defineSymbol('UFO', 'Cyberpunk / Sci-Fi', '<path d="M60 168 L86 112 L134 112 L160 168 Z" fill="#48f7ff" opacity=".12"/><ellipse cx="110" cy="98" rx="88" ry="26" fill="#8b95a8" stroke="#3a4152" stroke-width="3"/><ellipse cx="110" cy="90" rx="58" ry="14" fill="#aab4c6"/><path d="M78 80 Q110 46 142 80 Z" fill="#7fe8ff" opacity=".55" stroke="#48f7ff" stroke-width="2"/><ellipse cx="110" cy="80" rx="30" ry="8" fill="#d7fbff" opacity=".5"/><g><circle cx="70" cy="112" r="5" fill="#c6ff00"><animate attributeName="opacity" values="1;.2;1" dur="1.2s" repeatCount="indefinite"/></circle><circle cx="92" cy="118" r="5" fill="#ff2bd6"><animate attributeName="opacity" values=".3;1;.3" dur="1.2s" repeatCount="indefinite"/></circle><circle cx="110" cy="120" r="5" fill="#48f7ff"><animate attributeName="opacity" values="1;.3;1" dur="1s" repeatCount="indefinite"/></circle><circle cx="128" cy="118" r="5" fill="#ff2bd6"><animate attributeName="opacity" values=".3;1;.3" dur="1.2s" repeatCount="indefinite"/></circle><circle cx="150" cy="112" r="5" fill="#c6ff00"><animate attributeName="opacity" values="1;.2;1" dur="1.4s" repeatCount="indefinite"/></circle></g>', 'every 4s move {id} fromX=500 toX=540 duration=4 alternate=true'),
] as const satisfies readonly SymbolDefinition[];

export type SymbolKind = (typeof SYMBOL_CATALOG)[number]['name'];
export const SYMBOL_NAMES = SYMBOL_CATALOG.map((symbol) => symbol.name) as SymbolKind[];

export interface Stage { width: number; height: number; background: string; }
export interface Primitive { kind: PrimitiveKind; id: string; values: Record<string, string | number>; }
export interface NeoSymbol { id: string; symbol: string; x: number; y: number; scale: number; values: Record<string, string | number>; }
export type TimelineAction = 'move' | 'fade' | 'flicker' | 'scale' | 'rotate' | 'toggle' | 'emotion';
export interface TimelineEntry { interval: number; action: TimelineAction; target: string; values: Record<string, string | number | boolean>; }
export type SceneEvent =
  | { event: 'click'; target: string; action: 'toggle' | 'emotion'; value?: string }
  | { event: 'drag'; target: string; action: 'move-with-cursor' }
  | { event: 'hover'; target: string; action: 'scale' | 'opacity'; value?: string };
export interface NeoScene { stage: Stage; primitives: Primitive[]; symbols: NeoSymbol[]; timeline: TimelineEntry[]; events: SceneEvent[]; }

const DEFAULT_STAGE: Stage = { width: 1280, height: 720, background: '#050711' };
const STATIC_SYMBOLS = new Set<string>(SYMBOL_NAMES);
const ACTIONS = new Set<TimelineAction>(['move', 'fade', 'flicker', 'scale', 'rotate', 'toggle', 'emotion']);

function isKnownSymbol(name: string): boolean {
  return STATIC_SYMBOLS.has(name) || dynamicSymbols.has(name);
}

// Natural-language aliases (Italian + English + variants) resolved to canonical symbol names.
const SYMBOL_ALIASES: Record<string, string> = {
  dinosaur: 'TRex', dinosauro: 'TRex', trex: 'TRex', 't-rex': 'TRex', tirannosauro: 'TRex', tyrannosaurus: 'TRex', dino: 'TRex',
  pterodactyl: 'Pterodactyl', pterodattilo: 'Pterodactyl', pterodactylus: 'Pterodactyl', pterosaur: 'Pterodactyl',
  mammoth: 'Mammoth', mammut: 'Mammoth',
  volcano: 'Volcano', vulcano: 'Volcano', 'volcán': 'Volcano', volcan: 'Volcano',
  palmtree: 'Palm', palm: 'Palm', palma: 'Palm', palmera: 'Palm',
  cactus: 'Cactus', cacti: 'Cactus',
  wave: 'Wave', onda: 'Wave', onde: 'Wave', waves: 'Wave',
  mountain: 'Mountain', montagna: 'Mountain', 'montaña': 'Mountain', montana: 'Mountain', monte: 'Mountain',
  robot: 'Robot', robots: 'Robot',
  rocket: 'Rocket', razzo: 'Rocket', missile: 'Rocket', cohete: 'Rocket',
  ufo: 'UFO', saucer: 'UFO', flyingsaucer: 'UFO', ovni: 'UFO', 'disco-volante': 'UFO',
  explosion: 'Explosion', esplosione: 'Explosion', 'explosión': 'Explosion',
};

function resolveSymbolName(name: string | undefined): string {
  if (!name) return '';
  if (isKnownSymbol(name)) return name;
  return SYMBOL_ALIASES[name.toLowerCase()] ?? name;
}

function tokens(line: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token !== undefined) out.push(token);
  }
  return out;
}

function number(value: string | undefined, label: string): number {
  const parsed = Number.parseFloat(String(value ?? '').replace(/s$/, ''));
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number`);
  return parsed;
}

function keyValues(parts: string[], start = 0): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (let i = start; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === undefined) continue;
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator);
    const raw = part.slice(separator + 1).replace(/^['"]|['"]$/g, '');
    const numeric = Number.parseFloat(raw);
    values[key] = raw !== '' && Number.isFinite(numeric) && String(numeric) === raw ? numeric : raw;
  }
  return values;
}

export function parseNeoFlash(source: string): NeoScene {
  const scene: NeoScene = { stage: { ...DEFAULT_STAGE }, primitives: [], symbols: [], timeline: [], events: [] };
  const ids = new Set<string>();
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const parts = tokens(line);
    const command = parts[0]?.toLowerCase();
    const lineNumber = index + 1;
    try {
      if (command === 'stage') {
        scene.stage = { width: number(parts[1], 'stage width'), height: number(parts[2], 'stage height'), background: parts[3] || DEFAULT_STAGE.background };
        return;
      }
      if (command === 'circle') {
        const [, id, x, y, radius, fill = '#c6ff00'] = parts;
        if (!id) throw new Error('circle requires an id');
        scene.primitives.push({ kind: 'circle', id, values: { x: number(x, 'x'), y: number(y, 'y'), radius: number(radius, 'radius'), fill } }); ids.add(id); return;
      }
      if (command === 'rect') {
        const [, id, x, y, width, height, fill = '#ff2bd6'] = parts;
        if (!id) throw new Error('rect requires an id');
        scene.primitives.push({ kind: 'rect', id, values: { x: number(x, 'x'), y: number(y, 'y'), width: number(width, 'width'), height: number(height, 'height'), fill, ...keyValues(parts, 7) } }); ids.add(id); return;
      }
      if (command === 'line') {
        const [, id, x1, y1, x2, y2, stroke = '#48f7ff', width = '3'] = parts;
        if (!id) throw new Error('line requires an id');
        scene.primitives.push({ kind: 'line', id, values: { x1: number(x1, 'x1'), y1: number(y1, 'y1'), x2: number(x2, 'x2'), y2: number(y2, 'y2'), stroke, width: number(width, 'width'), ...keyValues(parts, 8) } }); ids.add(id); return;
      }
      if (command === 'polygon') {
        const [, id, points, fill = '#7c3aed'] = parts;
        if (!id || !points) throw new Error('polygon requires id and quoted points');
        scene.primitives.push({ kind: 'polygon', id, values: { points, fill } }); ids.add(id); return;
      }
      if (command === 'text') {
        const [, id, x, y, text = '', fill = '#f8f5fe', size = '32'] = parts;
        if (!id) throw new Error('text requires an id');
        scene.primitives.push({ kind: 'text', id, values: { x: number(x, 'x'), y: number(y, 'y'), text, fill, size: number(size, 'size') } }); ids.add(id); return;
      }
      if (command === 'symbol') {
        const [, id, rawSymbolName, x, y] = parts;
        const symbolName = resolveSymbolName(rawSymbolName);
        if (!id || !symbolName || !isKnownSymbol(symbolName)) throw new Error(`unknown symbol “${rawSymbolName || ''}”`);
        const values = keyValues(parts, 5);
        scene.symbols.push({ id, symbol: symbolName, x: number(x, 'x'), y: number(y, 'y'), scale: Number(values.scale ?? 1), values }); ids.add(id); return;
      }
      if (command === 'every') {
        const interval = number(parts[1], 'timeline interval'); const action = parts[2] as TimelineAction; const target = parts[3];
        if (!ACTIONS.has(action) || !target) throw new Error('invalid timeline action');
        scene.timeline.push({ interval, action, target, values: keyValues(parts, 4) }); return;
      }
      if (command === 'on') {
        const eventName = parts[1];
        const target = parts[2];
        const action = parts[3];
        if (!target) throw new Error('event syntax is: on EVENT id action');
        if (eventName === 'click') {
          if (action !== 'toggle' && action !== 'emotion') throw new Error('click action must be toggle or emotion');
          scene.events.push({ event: 'click', target, action, value: parts[4] }); return;
        }
        if (eventName === 'drag') {
          if (action !== 'move-with-cursor') throw new Error('drag action must be move-with-cursor');
          scene.events.push({ event: 'drag', target, action }); return;
        }
        if (eventName === 'hover') {
          if (action !== 'scale' && action !== 'opacity') throw new Error('hover action must be scale or opacity');
          scene.events.push({ event: 'hover', target, action, value: parts[4] }); return;
        }
        throw new Error('event must be click, drag, or hover');
      }
      throw new Error(`unknown command “${parts[0]}”`);
    } catch (error) {
      throw new Error(`Line ${lineNumber}: ${error instanceof Error ? error.message : 'invalid syntax'}`);
    }
  });
  if (scene.primitives.length + scene.symbols.length === 0) throw new Error('The scene has no drawable objects');
  for (const entry of scene.timeline) if (!ids.has(entry.target)) throw new Error(`Timeline target “${entry.target}” does not exist`);
  for (const event of scene.events) if (!ids.has(event.target)) throw new Error(`Event target “${event.target}” does not exist`);
  return scene;
}

export const HIGHWAY_BAR = `# Highway Bar — canonical NeoFlash scene
stage 1280 720 #050711
symbol skyCloud Cloud 1020 88 scale=1.2
symbol highway Highway 0 490 scale=1
symbol bar Bar 125 175 scale=1
symbol neon NeonSign 250 218 scale=1 text=NEOFLASH
symbol lamp StreetLamp 825 250 scale=1
symbol computer IBM1989 515 330 scale=.8 text=READY_
symbol car Car90 -220 506 scale=1
line rain1 80 30 45 150 #48f7ff 3
line rain2 320 10 285 135 #48f7ff 2
line rain3 700 35 665 160 #48f7ff 3
line rain4 1080 15 1040 150 #48f7ff 2
text caption 54 70 "HIGHWAY BAR // 02:13" #c6ff00 24
every 4s move car fromX=-220 toX=1450 duration=3.6
every .7s flicker neon min=.45 max=1
every 1.3s fade rain1 from=.25 to=.9
every 1.1s fade rain3 from=.2 to=.75
on click lamp toggle`;

export const FLASH_IS_NOT_DEAD = `# Flash Is Not Dead — dedicated neon manifesto
stage 1280 720 #030009
rect skyline 0 0 1280 520 #08051a
symbol backGrid Grid 0 355 scale=1 color=#8b00ff
symbol magentaGlow Glow 350 105 scale=.55 color=#ff00ff
symbol cyanGlow Glow 700 115 scale=.5 color=#00ffff
symbol cyberBar Bar 55 285 scale=.72
symbol barSign NeonSign 108 235 scale=.62 text=OPEN_ALL_NIGHT color=#00ffff
symbol leftLamp StreetLamp 245 330 scale=.78 color=#ff2bd6
symbol rightLamp StreetLamp 960 330 scale=.78 color=#48f7ff
symbol terminal IBM1989 930 390 scale=.58 text=NF_ALIVE
symbol dragStar Sparkle 570 390 scale=.38 color=#ffff00
text interactionHint 455 475 "DRAG THE STAR // CLICK THE LAMPS" #ffff00 18
line magentaBeam 0 382 1280 382 #ff2bd6 3
line cyanBeam 0 392 1280 392 #48f7ff 2
symbol manifesto NeonText 640 178 text=FLASH_IS_NOT_DEAD size=2xl color=#ff2bd6 tracking=-2 weight=900 glow=true
symbol subline NeonText 640 316 text=THE_WEB_IS_ALIVE_AGAIN size=sm color=#48f7ff tracking=4 weight=900 glow=true
symbol highway Highway 0 510 scale=1
symbol car Car90 -220 535 scale=.9 color=#c6ff00
symbol scanlines Scanline 0 0 scale=1 color=#48f7ff
every .72s flicker manifesto min=.38 max=1
every 3.8s scale manifesto from=.98 to=1.025
every 2.6s flicker subline min=.62 max=1
every 4.2s scale magentaGlow from=.9 to=1.08
every 3.6s scale cyanGlow from=.92 to=1.06
every 1.1s fade magentaBeam from=.18 to=.85
every 1.4s fade cyanBeam from=.2 to=.72
every .85s flicker barSign min=.35 max=1
every 1.1s scale dragStar from=.92 to=1.08
every 3.4s move car fromX=-220 toX=1450 duration=3.4
on click leftLamp toggle
on click rightLamp toggle
on drag dragStar move-with-cursor
on hover dragStar scale 1.22
on hover manifesto opacity .72`;

export const AUDOS_SUMMER_CAMP = `# Audos Summer Camp — California neon sunset
stage 720 400 #123b70
rect sunsetGlow 0 120 720 280 #f08a7e
rect sunsetBand 0 245 720 155 #f6bd60
circle sunset 360 265 74 #ffdf8a
symbol palmLeft Palm -15 92 scale=.68 color=#173f47
symbol palmRight Palm 555 98 scale=.72 color=#173f47
symbol palmFar Palm 610 155 scale=.48 color=#23555a
symbol campTitle NeonText 360 176 text=AUDOS_SUMMER_CAMP size=xl color=#ffd166 tracking=1 weight=900 glow=true
symbol campSubtitle NeonText 360 226 text=CALIFORNIA_//_SUMMER_199X size=xs color=#fff3d6 tracking=2 weight=700 glow=false
every 4s move campTitle fromX=360 fromY=176 toX=360 toY=166 duration=4 alternate=true
every 2.8s flicker campTitle min=.82 max=1
every 5s fade campSubtitle from=.58 to=1`;

export const AUDOS_DOT_COM = `# audos.com — living neon city signal
stage 1280 720 #02030d
rect deepSky 0 0 1280 470 #070625
rect horizonGlow 0 300 1280 220 #160a32
symbol stars Star 0 0 scale=1 color=#dffcff count=22
symbol cloudFar Cloud -260 82 scale=.42 color=#181739
symbol cloudNear Cloud -360 176 scale=.68 color=#2b1650
symbol pinkAura Glow 355 105 scale=.32 color=#ff2bd6
symbol cyanAura Glow 765 120 scale=.34 color=#48f7ff
symbol towerLeft Building 55 190 scale=.72 color=#111532
symbol towerMid Building 245 118 scale=.88 color=#16103b
symbol towerRight Building 950 158 scale=.78 color=#0d1d35
symbol skyline Rooftop 0 330 scale=1
symbol perspective Grid 0 365 scale=1 color=#8b00ff
line horizonPink 0 474 1280 474 #ff2bd6 4
line horizonCyan 0 484 1280 484 #48f7ff 3
symbol domain NeonText 640 190 text=audos.com size=2xl color=#ff2bd6 tracking=-2 weight=900 glow=true
symbol signal NeonText 640 292 text=CREATE._MOVE._SHIP. size=sm color=#48f7ff tracking=5 weight=900 glow=true
symbol liveSign NeonSign 86 338 scale=.64 text=LIVE_NOW color=#39ff14
symbol road Highway 0 490 scale=1
symbol farBus Bus -430 486 scale=.55 color=#8b00ff text=AUDOS
symbol heroCar Car90 -340 548 scale=1 color=#48f7ff
symbol lamp StreetLamp 1040 300 scale=.88 color=#c6ff00
symbol drift Particle 70 80 scale=1 color=#ff73df count=20
symbol rain Rain 0 -80 scale=1 color=#48f7ff
symbol scan Scanline 0 0 scale=1 color=#39ff14
text interaction 835 690 "CLICK THE LAMP // LIGHT THE NIGHT" #c6ff00 18
every 14s move cloudFar fromX=-260 fromY=82 toX=1460 toY=92 duration=14
every 9s move cloudNear fromX=-360 fromY=176 toX=1450 toY=158 duration=9
every 4.8s scale pinkAura from=.9 to=1.08
every 4.1s scale cyanAura from=.92 to=1.06
every .78s flicker domain min=.48 max=1
every 3.2s scale domain from=.98 to=1.025
every 2.2s flicker signal min=.66 max=1
every .9s flicker liveSign min=.38 max=1
every 7.4s move farBus fromX=-430 toX=1450 duration=7.4
every 3.2s move heroCar fromX=-340 toX=1480 duration=3.2
every 3.8s move drift fromY=80 toY=20 duration=3.8 alternate=true
every 1.2s fade horizonPink from=.2 to=.9
every 1.6s fade horizonCyan from=.18 to=.75
on click lamp toggle
on hover domain opacity .68`;

export const DEMOS: Record<string, string> = {
  'Highway Bar': HIGHWAY_BAR,
  'Flash Is Not Dead': FLASH_IS_NOT_DEAD,
  'Dinosaur World': `# Dinosaur World — prehistoric neon sunset
stage 1280 720 #1a0a00
rect skyGlow 0 0 1280 470 #3d1500
rect skyDeep 0 0 1280 190 #1a0a00
circle bloodSun 620 160 84 #ff4d1a
rect ground 0 560 1280 160 #241108
line horizon 0 560 1280 560 #47210c 4
symbol volcano Volcano 170 300 scale=1.5
symbol palm Palm 60 300 scale=1.2 color=#1c5a38
symbol ptero Pterodactyl 500 80 scale=.75
symbol trex TRex 830 300 scale=1.6
circle ember1 300 120 3 #ff8a3c
circle ember2 470 200 2 #ffae5c
circle ember3 780 90 3 #ff7a2e
circle ember4 980 150 2 #ffae5c
circle ember5 1120 120 3 #ff8a3c
every 2.6s move trex fromY=300 toY=306 duration=2.6 alternate=true
every 3.2s scale volcano from=1 to=1.05
every 6s move ptero fromX=500 toX=540 fromY=80 toY=96 duration=6 alternate=true
every 3s move ember1 fromY=120 toY=520 duration=3
every 3.6s move ember2 fromY=200 toY=560 duration=3.6
every 2.8s move ember3 fromY=90 toY=540 duration=2.8
every 4s move ember4 fromY=150 toY=560 duration=4
every 3.4s move ember5 fromY=120 toY=540 duration=3.4
every 2.2s fade ember1 from=.3 to=.9
every 2.6s fade ember3 from=.2 to=.8`,
  'City Rain': `# City Rain
stage 1280 720 #050711
symbol wall Wall 0 0
symbol tower1 Building 50 170 scale=1.1 color=#101632
symbol tower2 Building 360 90 scale=1.3 color=#15103b
symbol tower3 Building 760 190 scale=1 color=#0d1d35
symbol highway Highway 0 490
symbol cloud1 Cloud 160 80 scale=1.1
symbol cloud2 Cloud 780 125 scale=.8
symbol lamp1 StreetLamp 220 270 scale=.9
symbol lamp2 StreetLamp 920 270 scale=.9
symbol rain Rain 0 0 scale=1 color=#69cfff
text city 62 72 "CITY RAIN // LIVE" #ff2bd6 28`, 
  'Person Emotions': `# Person Emotions
stage 1280 720 #080612
symbol aura Glow 470 185 scale=.6 color=#8b00ff
symbol person Person 555 205 scale=1.3 emotion=happy
symbol neon NeonSign 505 82 text=FEEL_IT scale=1
symbol shadow Shadow 475 620 scale=1.1
text title 470 690 "CLICK THE PERSON TO CHANGE EXPRESSION" #48f7ff 22
every 1.8s scale aura from=.88 to=1.08
every .8s flicker neon min=.6 max=1
on click person emotion surprised`,
  Pong: `# Pong — move your mouse or finger vertically to control the right paddle
stage 1280 720 #03050d
symbol grid Grid 0 360 color=#301080
line topWall 24 24 1256 24 #302a50 5
line bottomWall 24 696 1256 696 #302a50 5
rect leftPaddle 80 285 24 150 #48f7ff rx=8
rect rightPaddle 1176 285 24 150 #ff2bd6 rx=8
circle ball 640 360 22 #c6ff00
line middle 640 40 640 680 #302a50 6
text score 560 92 "0  :  0" #f8f5fe 42`, 
  'Office Night': `# Office Night
stage 1280 720 #070711
symbol room Room 0 0 color=#141126
symbol window Window 820 70 scale=1.25
symbol desk Desk 330 410 scale=1.35
symbol monitor Monitor 460 260 scale=1.1 text=NF_ONLINE
symbol keyboard Keyboard 485 438 scale=.9
symbol chair Chair 760 415 scale=1
symbol lamp BulbLamp 1030 285 scale=.85 color=#ffe66d
symbol coffee CoffeeCup 665 390 scale=.55
symbol particles Particle 80 80 count=16 color=#48f7ff
line rainA 860 95 825 210 #48f7ff 3
line rainB 1010 80 975 205 #48f7ff 2
text title 52 64 "OFFICE NIGHT // 03:17" #00ff41 24
every .8s flicker monitor min=.7 max=1
every 1.1s fade rainA from=.2 to=.9
on click lamp toggle`,
  'Tokyo Street': `# Tokyo Street
stage 1280 720 #05040d
symbol towerA Building 20 100 scale=1.25 color=#17102e
symbol towerB Building 360 40 scale=1.5 color=#101b38
symbol towerC Building 870 120 scale=1.2 color=#24102e
symbol road Highway 0 490
symbol signA NeonSign 110 170 scale=.85 text=東京 color=#ff00ff
symbol signB NeonSign 780 220 scale=.75 text=夜_CITY color=#00ffff
symbol signal TrafficLight 1050 300 scale=.8
symbol walker Person 380 350 scale=.65 color=#00ffff
symbol moto Motorcycle -260 510 scale=.85 color=#ff00ff
line rainA 80 30 20 210 #48f7ff 3
line rainB 480 5 420 220 #48f7ff 2
line rainC 840 25 780 230 #48f7ff 3
line rainD 1180 0 1120 210 #48f7ff 2
every 3.2s move moto fromX=-260 toX=1450 duration=3.2
every 2.4s move walker fromX=380 toX=650 duration=2.4 alternate=true
every .65s flicker signA min=.35 max=1`,
  'Space Station': `# Space Station
stage 1280 720 #010107
symbol stars Star 0 0 scale=1 count=24 color=#dff8ff
symbol moon Moon 930 70 scale=.75 color=#b8d5ff
symbol grid Grid 0 380 scale=1 color=#8b00ff
symbol pulse Pulse 520 270 scale=1.5 color=#00ffff
symbol astronaut Astronaut 540 205 scale=1 color=#f5f7ff
symbol antenna Antenna 1080 360 scale=.9
symbol glow Glow 500 210 scale=.6 color=#8b00ff
text title 48 65 "ORBITAL DECK // ZERO-G" #00ffff 25
every 3s move astronaut fromY=205 toY=245 duration=3 alternate=true
every 2s rotate astronaut from=-4 to=4
every 1.4s scale pulse from=.8 to=1.25
every .7s flicker antenna min=.3 max=1`,
  'Arcade Room': `# Arcade Room
stage 1280 720 #09040f
symbol floor Floor 0 470 color=#230d36
symbol grid Grid 0 360 color=#ff00ff
rect tileA 0 500 160 110 #240b35
rect tileB 320 500 160 110 #240b35
rect tileC 640 500 160 110 #240b35
rect tileD 960 500 160 110 #240b35
rect tileE 160 610 160 110 #160b2b
rect tileF 480 610 160 110 #160b2b
rect tileG 800 610 160 110 #160b2b
rect tileH 1120 610 160 110 #160b2b
symbol arcadeA ArcadeCabinet 170 230 scale=1 text=NEON color=#ff00ff
symbol arcadeB ArcadeCabinet 470 210 scale=1.1 text=RUSH color=#00ffff
symbol arcadeC ArcadeCabinet 820 240 scale=.95 text=199X color=#8b00ff
symbol person Person 1060 330 scale=.65 emotion=happy color=#c6ff00
symbol sign NeonSign 470 70 scale=1.2 text=ARCADE_199X color=#ff00ff
symbol scan Scanline 0 0
text score 70 100 "HI-SCORE 009982" #c6ff00 20
every .7s flicker arcadeA min=.45 max=1
every .9s flicker arcadeB min=.5 max=1
every 1.5s scale person from=.96 to=1.04`,
  'Cozy Room': `# Cozy Room
stage 1280 720 #100a16
symbol room Room 0 0 color=#20142b
symbol window Window 120 100 scale=.85
symbol sofa Sofa 340 410 scale=1.15 color=#70315f
symbol lamp FloorLamp 1060 260 scale=.85 color=#ffb347
symbol tv TV 805 260 scale=.92
symbol cat Cat 555 500 scale=.7 color=#ff9f43
symbol coffee CoffeeCup 410 500 scale=.48
symbol particles Particle 120 100 count=12 color=#ffe8ae
text title 54 65 "COZY SIGNAL // RAIN MODE" #ff73df 22
every .5s flicker tv min=.5 max=1
every 2.6s scale cat from=.96 to=1.03
on click lamp toggle`,
  'Neon Club': `# Neon Club
stage 1280 720 #040108
symbol grid Grid 0 350 color=#ff00ff
rect tileA 0 500 160 110 #21082f
rect tileB 320 500 160 110 #21082f
rect tileC 640 500 160 110 #21082f
rect tileD 960 500 160 110 #21082f
rect tileE 160 610 160 110 #0c1f35
rect tileF 480 610 160 110 #0c1f35
rect tileG 800 610 160 110 #0c1f35
rect tileH 1120 610 160 110 #0c1f35
symbol glow Glow 170 150 scale=.6 color=#8b00ff
symbol glow2 Glow 790 120 scale=.6 color=#00ffff
symbol pulse Pulse 520 180 scale=1.6 color=#ff00ff
symbol dancerA Person 260 300 scale=.8 color=#ff00ff
symbol dancerB Person 520 270 scale=.9 color=#00ffff
symbol dancerC Person 820 310 scale=.75 color=#c6ff00
symbol shadowA Shadow 190 585 scale=.8
symbol shadowB Shadow 460 590 scale=.9
symbol shadowC Shadow 760 585 scale=.8
symbol sign NeonSign 500 55 scale=1.1 text=NEON_CLUB color=#ff00ff
every 1s scale pulse from=.65 to=1.3
every .6s flicker sign min=.4 max=1
every 1.2s scale dancerA from=.95 to=1.05
every .9s scale dancerB from=.94 to=1.08`,
  'Cyberpunk Alley': `# Cyberpunk Alley
stage 1280 720 #03040b
symbol wall Wall 0 0 color=#14101f
symbol towerA Building 0 20 scale=1.7 color=#0d1229
symbol towerB Building 850 0 scale=1.65 color=#21102b
symbol road Highway 0 490
symbol signA NeonSign 110 150 scale=.8 text=RAMEN_24H color=#ff00ff
symbol signB NeonSign 860 250 scale=.7 text=地下_NET color=#00ffff
symbol smoke Smoke 870 120 scale=1.2
symbol person Person 680 370 scale=.55 color=#8b00ff
symbol moto Motorcycle -240 515 scale=.9 color=#00ffff
line rain1 100 0 25 260 #48f7ff 4
line rain2 320 0 245 260 #48f7ff 3
line rain3 560 0 485 260 #48f7ff 4
line rain4 800 0 725 260 #48f7ff 3
line rain5 1040 0 965 260 #48f7ff 4
every 2.8s move moto fromX=-240 toX=1450 duration=2.8
every .55s flicker signA min=.25 max=1
every 1s fade rain1 from=.2 to=1`,
  'Beach Night': `# Beach Night — stable ocean bands and a layered campfire
stage 1280 720 #03071b
symbol stars Star 0 0 count=18 color=#ffffff
symbol moon Moon 880 70 scale=1.2 color=#d8e7ff
symbol palmA Palm 90 210 scale=1.1 color=#00ffcc
symbol palmB Palm 980 250 scale=.9 color=#ff00ff
symbol seaBack Wave 0 455 scale=1 color=#065f8f
symbol seaFront Wave 0 500 scale=.82 color=#00ccff
symbol fireGlow Glow 520 405 scale=.48 color=#FF6B00
symbol fire Fire 580 460 scale=1 color=#FF6B00
symbol smoke Smoke 610 300 scale=.72 color=#958ca8
text title 48 72 "MIDNIGHT BEACH // MIAMI 1993" #ff73df 24`, 
  'Dog in Meadow': `# Dog in Meadow
stage 1280 720 #E0F4FF
symbol sky Sky 0 0
symbol sun Sun 1000 78 scale=1 color=#FFD700
symbol cloudA Cloud -180 105 scale=1.15 color=#ffffff
symbol cloudB Cloud 520 165 scale=.75 color=#f5f7fa
symbol bird Bird -120 155 scale=.65 color=#334155
symbol meadow Grass 0 500 scale=1 color=#4a7c59
symbol dog Dog -180 465 scale=.82 color=#8B5E3C
text title 48 68 "RUN FREE // MEADOW" #2d5a3d 25
every 12s move cloudA fromX=-180 toX=1450 duration=12
every 8s move bird fromX=-120 toX=1400 duration=8
every 6s move dog fromX=-180 toX=1450 duration=6
on click dog toggle`,
  Library: `# Library
stage 1280 720 #0a0810
symbol room Room 0 0 color=#19121f
symbol shelfA Bookshelf 80 120 scale=1.2
symbol shelfB Bookshelf 850 120 scale=1.2
symbol table Table 390 460 scale=1.2 color=#4a253e
symbol lamp BulbLamp 690 340 scale=.85 color=#ffd166
symbol reader Person 525 330 scale=.7 emotion=happy color=#b388ff
symbol particles Particle 80 70 count=22 color=#ffe9a8
symbol coffee CoffeeCup 610 430 scale=.55
text title 54 65 "THE LAST LIBRARY // 00:42" #c6ff00 22
every 3.5s move particles fromY=70 toY=15 duration=3.5
every 1.2s flicker lamp min=.75 max=1
on click lamp toggle`,
  'Rooftop City': `# Rooftop City
stage 1280 720 #02040d
symbol stars Star 0 0 count=20 color=#dff8ff
symbol moon Moon 930 65 scale=1.25 color=#e2e8ff
symbol towerA Building 80 210 scale=.8 color=#10152c
symbol towerB Building 390 160 scale=1 color=#17102e
symbol towerC Building 760 220 scale=.85 color=#0d1d35
symbol roofs Rooftop 0 390 scale=1
symbol antennaA Antenna 180 250 scale=1 color=#00ffff
symbol antennaB Antenna 780 290 scale=.8 color=#ff00ff
symbol person Person 560 350 scale=.55 color=#8b00ff
symbol cloud Cloud -180 110 scale=.8
text title 45 66 "ROOFTOP FREQUENCY // 99.7" #48f7ff 24
every 8s move cloud fromX=-180 toX=1400 duration=8
every .8s flicker antennaA min=.3 max=1
every 2.4s scale moon from=.98 to=1.03`,
  'Summer Camp': AUDOS_SUMMER_CAMP,
  'audos.com': AUDOS_DOT_COM,
  ...DEMO_DOCUMENTS,
};

export const ANIMATION_DEMO_NAMES = ['Highway Bar', 'Flash Is Not Dead', 'Dinosaur World', 'City Rain', 'Person Emotions', 'Pong', 'Summer Camp', 'audos.com', 'Neon Snake — Snake Game', 'Tetris'] as const;
export const LAYOUT_DEMO_NAMES = ['Cyber Layout', 'Minimal Layout', 'Retro 8-bit Layout', 'Space Layout'] as const;

export const LAYOUT_DEMOS: Record<(typeof LAYOUT_DEMO_NAMES)[number], string> = {
  'Cyber Layout': `# Cyber Layout — neon 90s product page
stage 1280 900 #05050c
symbol cyberGrid NeonGrid 0 0 width=1280 height=900 color=#39ff14 opacity=.06 mobileStageWidth=720 mobileStageHeight=1180 mobileWidth=720 mobileHeight=1180
symbol cyberLogo NeoFlashLogo 38 18 scale=.62 primary=#ff2bd6 secondary=#48f7ff theme=cyberpunk mobileX=24 mobileY=20 mobileScale=.5
symbol cyberTitle NeonText 640 220 text=THE_WEB_GETS|WEIRD_AGAIN size=2xl color=#fff7ff tracking=-3 weight=900 glow=true mobileX=360 mobileY=210 mobileScale=.66
symbol cyberCursor NeonText 1080 220 text=▌ size=xl color=#39ff14 weight=900 glow=true raf=cursor mobileX=645 mobileY=210 mobileScale=.66
symbol cyberOne NeonCard 70 390 width=350 height=250 borderColor=#ff2bd6 title=DESCRIBE subtitle=01_//_PROMPT body=Turn_a_sentence_into_live_vector_motion. icon=spark mobileX=100 mobileY=390 mobileWidth=520 mobileHeight=210
symbol cyberTwo NeonCard 465 390 width=350 height=250 borderColor=#48f7ff title=REMIX subtitle=02_//_CODE body=Open_every_line_and_shape_the_timeline. icon=code mobileX=100 mobileY=630 mobileWidth=520 mobileHeight=210
symbol cyberThree NeonCard 860 390 width=350 height=250 borderColor=#39ff14 title=SHIP subtitle=03_//_WEB body=Export_the_scene_without_a_plugin. icon=export mobileX=100 mobileY=870 mobileWidth=520 mobileHeight=210
symbol cyberButton NeonButton 470 705 width=340 height=72 label=ENTER_NEOFLASH color=#ff2bd6 variant=primary mobileX=190 mobileY=1090
symbol cyberScan NeonScanlines 0 0 width=1280 height=900 opacity=.1 mobileWidth=720 mobileHeight=1180
`,
  'Minimal Layout': `# Minimal Layout — clean geometric product page
stage 1280 900 #F8F9FA
symbol minimalLogo NeoFlashLogo 48 24 scale=.58 primary=#111318 secondary=#4A9EFF theme=minimal mobileStageWidth=720 mobileStageHeight=1120 mobileX=28 mobileY=22 mobileScale=.48
symbol minimalRing GeometricCircle 900 115 scale=2.25 color=#4A9EFF fillColor=transparent mobileX=420 mobileY=145 mobileScale=1.45
symbol minimalAxis GeometricLine 710 420 color=#111318 width=420 mobileX=190 mobileY=400 mobileScale=.8
symbol minimalTitle NeonText 420 245 text=DESIGN_IN_MOTION. size=2xl color=#111318 tracking=-4 weight=900 glow=false mobileX=360 mobileY=250 mobileScale=.62
symbol minimalSubtitle NeonText 420 385 text=Precise._Editable._Browser-native. size=sm color=#68707C tracking=1 weight=700 mobileX=360 mobileY=370
symbol minimalOne NeonCard 80 520 width=520 height=230 borderColor=#111318 bgColor=#FFFFFF title=STRUCTURE body=Geometric_layout_with_a_clear_visual_rhythm. icon=grid glow=false mobileX=100 mobileY=485 mobileWidth=520 mobileHeight=220
symbol minimalTwo NeonCard 680 520 width=520 height=230 borderColor=#4A9EFF bgColor=#FFFFFF title=CONTROL body=Readable_NeoFlash_code,_ready_to_remix. icon=code glow=false mobileX=100 mobileY=735 mobileWidth=520 mobileHeight=220
symbol minimalButton NeonButton 470 790 width=340 height=68 label=START_CREATING color=#111318 textColor=#FFFFFF variant=primary glow=false mobileX=190 mobileY=995
`,
  'Retro 8-bit Layout': `# Retro 8-bit Layout — CGA arcade landing page
stage 1280 900 #000000
symbol retroGrid NeonGrid 0 0 width=1280 height=900 color=#00FFFF opacity=.08 mobileStageWidth=720 mobileStageHeight=1160 mobileWidth=720 mobileHeight=1160
symbol retroLogo NeoFlashLogo 40 20 scale=.62 primary=#FF00FF secondary=#00FFFF theme=retro mobileX=24 mobileY=20 mobileScale=.5
symbol retroHero PixelChar 930 225 scale=1.45 color=#00FFFF altColor=#FFFFFF mobileX=470 mobileY=260 mobileScale=1.05
symbol retroRival PixelChar 1080 260 scale=1.05 color=#FF00FF altColor=#FFFFFF mobileX=585 mobileY=290 mobileScale=.75
symbol retroTitle NeonText 430 250 text=PRESS_START|TO_CREATE size=2xl color=#FFFFFF tracking=-2 weight=900 glow=false mobileX=360 mobileY=210 mobileScale=.6
symbol retroScore NeonText 430 440 text=PLAYER_1_//_READY size=sm color=#00FFFF tracking=5 weight=900 glow=false mobileX=360 mobileY=390
symbol retroOne NeonCard 90 535 width=510 height=220 borderColor=#00FFFF bgColor=#080018 title=PIXEL_POWER body=CGA_color,_hard_edges,_instant_feedback. icon=grid mobileX=100 mobileY=500 mobileWidth=520 mobileHeight=220
symbol retroTwo NeonCard 680 535 width=510 height=220 borderColor=#FF00FF bgColor=#080018 title=REMIX_MODE body=Edit_the_level_like_readable_source_code. icon=code mobileX=100 mobileY=750 mobileWidth=520 mobileHeight=220
symbol retroButton NeonButton 470 795 width=340 height=70 label=INSERT_COIN color=#00FFFF textColor=#000000 variant=primary mobileX=190 mobileY=1010
symbol retroScan NeonScanlines 0 0 width=1280 height=900 opacity=.18 mobileWidth=720 mobileHeight=1160
`,
  'Space Layout': `# Space Layout — holographic cosmic product page
stage 1280 900 #050A1A
symbol spaceStars Star 0 0 count=22 color=#FFFFFF mobileStageWidth=720 mobileStageHeight=1180
symbol spaceLogo NeoFlashLogo 44 20 scale=.62 primary=#B388FF secondary=#8EDBFF theme=space mobileX=26 mobileY=20 mobileScale=.5
symbol spacePlanet Planet 870 120 scale=1.65 color=#4A9EFF ringColor=#B388FF mobileX=430 mobileY=170 mobileScale=1.15
symbol spaceOrbit GeometricCircle 790 80 scale=2.6 color=#8EDBFF mobileX=370 mobileY=135 mobileScale=1.75
symbol spaceTitle NeonText 420 260 text=CREATE_BEYOND|THE_ATMOSPHERE size=2xl color=#F6FAFF tracking=-2 weight=900 glow=true mobileX=360 mobileY=255 mobileScale=.58
symbol spaceSubtitle NeonText 420 445 text=Ideas_become_holographic_motion. size=sm color=#A9B9D8 tracking=2 weight=700 mobileX=360 mobileY=420
symbol spaceOne NeonCard 80 550 width=520 height=230 borderColor=#8EDBFF bgColor=#081027 title=ORBITAL_CANVAS body=Compose_planets,_signals,_and_live_systems. icon=spark mobileX=100 mobileY=520 mobileWidth=520 mobileHeight=220
symbol spaceTwo NeonCard 680 550 width=520 height=230 borderColor=#B388FF bgColor=#081027 title=HOLOGRAPHIC_CODE body=Every_layer_stays_editable_and_exportable. icon=code mobileX=100 mobileY=770 mobileWidth=520 mobileHeight=220
symbol spaceButton NeonButton 470 815 width=340 height=70 label=LAUNCH_SCENE color=#8EDBFF textColor=#050A1A variant=primary mobileX=190 mobileY=1030
`,
};

export const DEMO_TYPES: Record<string, 'animation' | 'web-component' | 'game'> = {
  ...Object.fromEntries(Object.keys(DEMOS).map((name) => [name, 'animation' as const])),
  ...Object.fromEntries(Object.keys(LAYOUT_DEMOS).map((name) => [name, 'animation' as const])),
  ...DEMO_DOCUMENT_TYPES,
};

export const CITY_RAIN = DEMOS['City Rain'];
export const PERSON_EMOTIONS = DEMOS['Person Emotions'];
export const PONG = DEMOS.Pong;

export const NEOFLASH_LOGO_SCENE = `# Animated NeoFlash logo
stage 480 128 transparent
symbol neoflashLogo NeoFlashLogo 8 4 scale=1 primary=#ff2bd6 secondary=#48f7ff theme=cyberpunk`;

export const LANDING_HERO_SCENE = `# NeoFlash landing hero UI
stage 1280 720 transparent
symbol heroGrid NeonGrid 0 0 width=1280 height=720 color=#48f7ff opacity=.08
symbol heroScanlines NeonScanlines 0 0 width=1280 height=720 opacity=.1
symbol heroBadge NeonBadge 442 112 label=[_NF_]_//_BROWSER_MOTION_SYSTEM color=#ff2bd6
symbol heroTitle NeonText 640 245 text=DESCRIBE_IT.|ANIMATE_IT. size=2xl color=#fff7ff tracking=-3 weight=900 glow=true
symbol heroSubtitle NeonText 640 425 text=NeoFlash_—_the_new_language_for_web_animation size=sm color=#d8d4e4 tracking=1 weight=700 glow=false
symbol heroCta NeonButton 450 480 width=380 height=74 label=OPEN_THE_PLAYGROUND color=#ff2bd6 textColor=#080810
symbol heroMeta NeonText 640 600 text=Browser-native_·_SVG_vector_·_No_plugins size=xs color=#9a94aa tracking=3 weight=700 glow=false`;

export const LANDING_NAV_SCENE = `# Landing navigation rendered by NeoFlash
stage 1280 88 #0a0a0f
symbol landingNav NeonNav 0 0 width=1280 height=88 logo=NF items=Playground|Demos|Export color=#39ff14 mobileStageWidth=720 mobileStageHeight=88 mobileWidth=720`;

export const LANDING_FEATURES_SCENE = `# Landing feature cards rendered by NeoFlash
stage 1280 520 #080810
symbol featureGrid NeonGrid 0 0 width=1280 height=520 color=#48f7ff opacity=.05 mobileStageWidth=720 mobileStageHeight=1040 mobileWidth=720 mobileHeight=1040
symbol featureHeading NeonText 640 82 text=FROM_THOUGHT_TO_MOTION. size=lg color=#fff7ff tracking=-1 weight=900 glow=true mobileX=360 mobileY=75 mobileScale=.72
symbol easyCard NeonCard 70 145 width=350 height=300 borderColor=#ff00ff title=EASY_MODE subtitle=01_//_PROMPT body=Describe_a_scene_in_plain_language._AI_generates_NeoFlash_code_instantly. icon=spark mobileX=100 mobileY=135 mobileWidth=520 mobileHeight=250
symbol advancedCard NeonCard 465 145 width=350 height=300 borderColor=#00ffff title=ADVANCED_MODE subtitle=02_//_CODE body=Write_NeoFlash_directly._Full_syntax,_autocomplete,_live_preview. icon=code mobileX=100 mobileY=415 mobileWidth=520 mobileHeight=250
symbol exportCard NeonCard 860 145 width=350 height=300 borderColor=#39ff14 title=EXPORT_&_EMBED subtitle=03_//_SHIP body=Copy_3_lines_of_HTML._Your_animation_runs_anywhere_on_the_web. icon=export mobileX=100 mobileY=695 mobileWidth=520 mobileHeight=250`;

export const LANDING_CTA_SCENE = `# Landing call to action rendered by NeoFlash
stage 1280 300 #0d0d19
symbol ctaGrid NeonGrid 0 0 width=1280 height=300 color=#ff00ff opacity=.05 mobileStageWidth=720 mobileStageHeight=300 mobileWidth=720
symbol ctaTitle NeonText 640 92 text=READY_TO_ANIMATE? size=lg color=#fff7ff tracking=-1 weight=900 glow=true mobileX=360
symbol landingCta NeonButton 450 158 width=380 height=76 label=START_ANIMATING_FREE_→ color=#ff00ff variant=primary mobileX=170`;

export const LANDING_FOOTER_SCENE = `# Landing footer rendered by NeoFlash
stage 1280 110 #050711
symbol landingFooter NeonFooter 0 0 width=1280 height=110 text=NeoFlash_©_2024_—_Describe_it._Animate_it._Instantly. color=#ff00ff mobileStageWidth=720 mobileStageHeight=110 mobileWidth=720`;

export const DEMO_DESCRIPTIONS: Record<string, string> = {
  'Highway Bar': 'A cyberpunk bar in the rain, with neon signs, an interactive street lamp, and a 1990s car crossing the highway.',
  'Flash Is Not Dead': 'A neon manifesto showcase: FLASH IS NOT DEAD flickers above a cyberpunk highway, clickable street lamps, a speeding 1990s car, and a yellow star you can hover and drag anywhere.',
  'Dinosaur World': 'A prehistoric neon sunset: a massive roaring T-Rex on the right, a volcano erupting with ash and lava on the left, a pterodactyl gliding overhead, a palm in the foreground, and embers drifting down from a blood-red sky.',
  'City Rain': 'A night city in the rain, with dark skyscrapers, neon street lamps, and clouds hanging above the highway.',
  'Person Emotions': 'A person at the center of a neon scene changes expression when clicked while an aura pulses and a sign flickers.',
  Pong: 'An interactive retro neon Pong match: move the mouse or drag a finger vertically to control the right paddle while the left paddle follows the ball.',
  'Summer Camp': 'A warm California sunset with native vector palms and a softly animated AUDOS SUMMER CAMP neon title.',
  'audos.com': 'A living neon audos.com city signal with drifting clouds, rain, animated windows and particles, parallax traffic, pulsing fuchsia/cyan identity type, and a street lamp you can click to light the night.',
  'Office Night': 'A dark room with a desk, a green CRT monitor, rain beyond the window, and a desk lamp that changes the light when clicked.',
  'Tokyo Street': 'A Tokyo street in the rain, with neon kanji, nighttime pedestrians, and a motorcycle cutting across wet asphalt.',
  'Space Station': 'An orbital station in the void, with stars, a Tron grid, a floating astronaut, and intermittent radio signals.',
  'Arcade Room': 'A 199X arcade with a perspective floor, animated cabinets, and a pixel character immersed in neon.',
  'Cozy Room': 'A cozy room with a sofa, a static-filled TV, a sleeping cat, and a clickable floor lamp.',
  'Neon Club': 'A cyberpunk club with a grid dance floor, pulsing light columns, and silhouettes dancing beneath a fuchsia sign.',
  'Cyberpunk Alley': 'A narrow rainy alley between towering buildings, with neon signs, smoke, and a speeding motorcycle.',
  'Beach Night': 'A Miami Vice beach at night, with a full moon, neon palms, animated waves, and a fire on the sand.',
  'Dog in Meadow': 'A happy dog runs through a green meadow under a blue sky, among slow clouds, warm sun, and flying birds; click the dog to make it sit or run.',
  Library: 'A nighttime library with colorful bookshelves, a person reading, warm lamplight, and suspended dust.',
  'Rooftop City': 'A rooftop above the city, with blinking antennas, a full moon, and clouds drifting between the buildings.',
  'Green Plant Header': 'A polished green navigation header with a glowing plant logo and a Products dropdown for Grapes, Apples, Bananas, and Dried Fruit.',
  'Verdant Farm Website': 'A complete natural agriculture website with a bold harvest hero, story, product cards, and a working contact form.',
  'Neon Circuit Website': 'A complete dark cyberpunk technology website with neon motion, a pulsing energy core, and interactive system diagnostics.',
  'Creative Portfolio': 'A clean creative portfolio with an editorial hero, responsive project grid, tactile hover motion, and closable case-study dialogs.',
  'Highway Hauler — Truck Game': 'A fully playable three-lane truck game with keyboard and touch controls, traffic spawning, collision detection, score, pause, game over, and restart.',
  'Neon Snake — Snake Game': 'A polished neon Snake game with keyboard and button controls, growing body, food, score, pause, game over, and restart.',
  Tetris: 'A fully playable neon Tetris game with all seven tetrominoes, SVG blocks, keyboard and touch controls, line clearing, levels, score, game over, and restart.',
  'Cyber Layout': 'A complete cyberpunk NeoFlash page with animated logo, neon cards, scanlines, and a glowing call to action.',
  'Minimal Layout': 'A clean geometric NeoFlash page with restrained motion, crisp typography, and zero-glow editorial structure.',
  'Retro 8-bit Layout': 'A CGA-inspired pixel layout with scanlines, arcade characters, hard-edged cards, and an insert-coin call to action.',
  'Space Layout': 'A deep-space NeoFlash page with drifting stars, holographic geometry, an orbiting planet, and glassy content cards.',
};

const SYMBOL_CATEGORIES: SymbolCategory[] = ['Nature & Outdoors', 'Animals', 'Urban & Architecture', 'Vehicles', 'Interior & Furniture', 'Tech & Electronics', 'Cyberpunk / Sci-Fi', 'Food & Objects', 'Weather & Effects', 'Symbols & Abstract', 'UI', 'People'];
const SYMBOL_REFERENCE = SYMBOL_CATEGORIES.map((category) => {
  const symbols = SYMBOL_CATALOG.filter((symbol) => symbol.category === category);
  return `${category}:\n${symbols.map((symbol) => `- ${symbol.name}; props: ${symbol.props}; code: ${symbol.example.split('\n')[0]}`).join('\n')}`;
}).join('\n\n');
const STATIC_SYMBOL_NAME_LIST = SYMBOL_CATALOG.map((symbol) => symbol.name).join(', ');

export const LANGUAGE_SPEC = `NeoFlash language specification:
- Start with: stage WIDTH HEIGHT BACKGROUND. Defaults are 1280 720 #050711.
- Primitives: circle ID X Y RADIUS FILL; rect ID X Y WIDTH HEIGHT FILL [rx=N]; line ID X1 Y1 X2 Y2 STROKE WIDTH; polygon ID "X1,Y1 X2,Y2 X3,Y3" FILL; text ID X Y "TEXT" FILL SIZE.
- Symbols use: symbol ID NAME X Y [scale=N] [color=#HEX] plus the props listed below.
${SYMBOL_REFERENCE}
- Timeline: every Xs move ID fromX=N fromY=N toX=N toY=N duration=N [alternate=true]; fade from=N to=N; flicker min=N max=N; scale from=N to=N; rotate from=N to=N; toggle; emotion value=happy|sad|surprised.
- Events: on click ID toggle; on click ID emotion happy|sad|surprised; on drag ID move-with-cursor; on hover ID scale N; on hover ID opacity N.
Rules: IDs contain no spaces. Quote primitive text and polygon points. Symbol text uses underscores for spaces. Use only these commands. Coordinates use the SVG stage viewBox.`;

export const NEOFLASH_AMPLIFIER_PROMPT = `You are the NeoFlash scene interpreter. The user describes something they want to create, in ANY language and at ANY level of detail (from a single word to a paragraph). Do the following:
1. Detect the input language and translate the intent to English internally. The user may write in Italian, English, Spanish, or anything else.
2. Classify the request as exactly one of: "animation", "web-component", or "game".
   - animation: an animated visual scene or illustration (this is the DEFAULT — prefer it whenever the request describes a picture, place, creature, or mood).
   - web-component: website UI such as a header, navigation, menu, cards, form, or dashboard.
   - game: a playable experience with controls, objectives, scoring, or collisions.
3. AMPLIFY the idea into ONE vivid English sentence describing a beautiful, cinematic scene. Even from a bare prompt (e.g. "dinosauro", "vulcano", "mare"), autonomously enrich it with:
   - specific composition and placement (e.g. a massive T-Rex on the right, a volcano erupting in the background on the left)
   - atmosphere and lighting (e.g. a dramatic sunset, a blood-red sky)
   - coherent complementary elements (e.g. a volcano implies falling ash and glowing embers)
   - scale and depth (larger elements in the foreground, smaller ones in the background)
   - a sense of motion for every element
   The user must NOT have to specify any of this — you add it so the resulting scene is visually stunning.
   For a web-component or game, instead restate the request as one clear, complete English sentence (no scene atmosphere needed).

OUTPUT: return ONLY valid JSON, with no markdown fences and no commentary, in exactly this shape:
{"type":"animation","interpretation":"A massive T-Rex roaring on the right, a volcano erupting in the distance on the left, prehistoric palms in the foreground, and ember particles drifting down from a blood-red sky."}`;

export const NEOFLASH_SYSTEM_PROMPT = `You are NeoFlash scene composer. Your job: take ANY input (any language, any level of detail) and generate a VISUALLY STUNNING, valid, animated NeoFlash scene. The input you receive has usually already been amplified into a rich English description — honor every element in it and elevate it further. Always respond in English; any text rendered inside the scene must be English unless the user supplied a proper name.

VISUAL QUALITY IS THE ABSOLUTE PRIORITY.

STEP 1 — Think cinematically before writing code. The description names the elements; you decide the staging:
- COMPOSITION: rule of thirds. Spread elements across x:10%-90% and y:10%-90% of the stage; NEVER stack everything in the center.
- DEPTH: layer foreground (larger, nearer the bottom), midground, and background (smaller, higher). Source order = paint order: background first, foreground last.
- ATMOSPHERE: always add ambient life — particles, embers, light, or weather (built from primitives or effect symbols).
- COLOR: high-contrast cinematic / cyberpunk palette — neon accents on dark or dramatic backgrounds.

STEP 2 — GENERATE valid NeoFlash code:
- ANIMATION: every element must move — oscillate, drift, pulse, rotate, or bounce. Motion must be visible in the first second.
- INTERACTION: use click toggles/emotions, \`on drag ID move-with-cursor\`, and \`on hover ID scale N\` or \`on hover ID opacity N\` whenever the user requests interaction or it makes the scene more playful.
- NEVER generate a flat or empty scene. Minimum 3 elements, all animated.

VALID SYMBOL NAMES — complete and exact:
${STATIC_SYMBOL_NAME_LIST}

HARD RULE: ONLY use those exact symbol names. NEVER invent, guess, pluralize, translate, alias, or approximate a symbol name in NeoFlash code. If a concept has no matching symbol, build it with primitive rect, circle, line, polygon, or text commands and the closest valid symbols instead. Invalid symbol names render as black blobs in older scenes or fail parsing — verify every symbol type against this exact list before responding.

CONCEPT → VALID SYMBOL MAPPINGS:
- ocean waves → Wave, plus rect/circle primitives for water depth and foam; Fog or Rain may add atmosphere.
- robot → Robot when a literal robot is needed; for a robot-city silhouette, combine Building, NeonSign, Monitor, Antenna, and geometric primitives.
- email / letter → NeonSign with text=MAIL or text=NEW_MESSAGE plus rect/line primitives; never use Envelope, Email, Letter, or Mail as symbol types.
- volcano at sunset → Volcano, Sun, Mountain, Smoke, Fire, and primitives; never add unrelated mail or UI symbols.
- neon robot city at night → Building, Robot, NeonSign, Rain, StreetLamp, Antenna, and Highway; do not add Shield or EnergyShield unless the user explicitly requests one.
- dinosaur → TRex, with Pterodactyl, Volcano, and Palm for depth.
- ocean with waves and a palm tree → Wave, Palm, Sun or Moon, Cloud, and Bird.

CURATED EASY-PROMPT RULES:
For “a dinosaur”, prominently use TRex and only complementary symbols from the exact list.
For “a volcano at sunset”, prominently use Volcano and Sun; never use Envelope, Email, Letter, or Mail.
For “an ocean with waves and a palm tree”, use Wave and Palm; never use Ocean as a symbol type.
For “a neon robot city at night”, use Robot with Building and NeonSign; never use Shield or EnergyShield unless explicitly requested.

GLOW SCALE SAFETY:
Glow is an ambient aura, not a hero object. Always use scale=.35 to .6 for Glow, including broad environmental ambience. Never exceed scale=.6, never omit the scale property, and never use Glow as a standalone hero object.

${LANGUAGE_SPEC}

OUTPUT CONTRACT:
Return ONLY valid JSON, with no explanation, commentary, or markdown fences, in exactly this shape:
{
  "scene": "stage 1280 720 #050711\nsymbol cat Cat 200 300 scale=1\n...",
  "newSymbols": []
}
Always include a stage line in scene. Keep scenes performant with 10-32 layered objects. Every referenced timeline/event target must exist. Always return newSymbols: []. Easy mode is restricted to the authoritative static vocabulary above: never create or redefine a symbol, even when the requested concept has no direct match. Build missing concepts from primitives and valid symbol compositions instead.

CAT + YARN TEST CASE:
For “a cat playing with a ball of yarn”, use the existing Cat and YarnBall symbols and return a scene equivalent in quality to this composition: a visible Cat around x=330 y=390, a visible YarnBall around x=760 y=500, atmospheric floor/background layers, and at least two obvious animations—move the cat toward the ball with alternate=true and make the yarn ball rotate or bounce. Keep newSymbols empty because Cat and YarnBall already exist.

ART DIRECTION:
Build a complete composition even when the request is simple. A request such as “a computer on a desk with a light that blinks when clicked” must become a full scene: atmospheric background and architecture, precise midground furniture/electronics, foreground silhouettes/reflections/particles, the requested hero objects, lighting, motion, and interaction. Use exact x/y positions, intentional scale, colors suited to the requested environment, multiple complementary animations, and clickable interactions where useful. Layer symbols in source order: background first, midground second, foreground last. Prefer named symbols, overlap effects when appropriate, and make motion visible during the first second.

NATURE / OUTDOOR DIRECTION:
- For outdoor/nature scenes, use Sky or Grass as background layers.
- For animal scenes, use an existing matching animal symbol. If none exists, approximate the concept with primitives and the closest valid symbols; never invent a symbol type or return a custom SVG.
- Layer background first (Sky), then midground (Grass, Trees), then foreground (characters/animals).
- Keep natural scenes bright, organic, and readable; do not force cyberpunk architecture, dark roads, or neon into a daytime nature request.
- Use \`every ...\` timeline rules to animate movement, \`color=#HEX\` to style symbols, and \`on click ...\` to add interactions. Use \`on drag ID move-with-cursor\` for draggable objects and \`on hover ID scale 1.08\` or \`on hover ID opacity .7\` for hover feedback. A request to “animate” or “move” an object must produce a visible timeline rule. Lamps, doors, and Dog support \`on click ID toggle\`; clicking Dog switches between running and sitting.

HIGH-QUALITY EXAMPLE — dog running through a meadow:
stage 1280 720 #E0F4FF
symbol sky Sky 0 0
symbol sun Sun 1000 78 scale=1 color=#FFD700
symbol cloud Cloud -180 105 scale=1.15 color=#ffffff
symbol bird Bird -120 155 scale=.65 color=#334155
symbol meadow Grass 0 500 scale=1 color=#4a7c59
symbol dog Dog -180 465 scale=.82 color=#8B5E3C
every 12s move cloud fromX=-180 toX=1450 duration=12
every 8s move bird fromX=-120 toX=1400 duration=8
every 6s move dog fromX=-180 toX=1450 duration=6
on click dog toggle

HIGH-QUALITY EXAMPLE — layered interactive office:
stage 1280 720 #070711
symbol room Room 0 0 color=#141126
symbol window Window 830 70 scale=1.2
symbol particles Particle 70 60 count=18 color=#00ffff
symbol desk Desk 340 420 scale=1.3
symbol monitor Monitor 470 270 scale=1.1 text=NF_ONLINE
symbol keyboard Keyboard 490 440 scale=.9
symbol lamp BulbLamp 750 310 color=#ffe66d
symbol chair Chair 790 420
symbol coffee CoffeeCup 650 405 scale=.6
symbol shadow Shadow 400 600 scale=1.4
text title 48 64 "OFFICE NIGHT // 03:17" #00ff41 22
every .8s flicker monitor min=.65 max=1
every 3s move particles fromY=60 toY=10 duration=3
on click lamp toggle

HIGH-QUALITY EXAMPLE — cinematic city motion:
stage 1280 720 #03040b
symbol towerA Building 20 70 scale=1.4 color=#15103b
symbol towerB Building 890 30 scale=1.6 color=#0d1d35
symbol road Highway 0 500
symbol sign NeonSign 120 170 text=夜_CITY color=#ff00ff
symbol signal TrafficLight 1040 300 scale=.8
symbol walker Person 500 365 scale=.6 color=#00ffff
symbol moto Motorcycle -260 515 color=#ff00ff
symbol scan Scanline 0 0
line rain 600 0 530 250 #48f7ff 3
every 3s move moto fromX=-260 toX=1450 duration=3
every .7s flicker sign min=.35 max=1
every 2.4s move walker fromX=500 toX=720 duration=2.4 alternate=true

HIGH-QUALITY EXAMPLE — Dinosaur World (prehistoric neon sunset, multi-symbol depth):
stage 1280 720 #1a0a00
rect skyGlow 0 0 1280 460 #3d1500
circle bloodSun 640 150 82 #ff4d1a
rect ground 0 560 1280 160 #241108
symbol volcano Volcano 180 300 scale=1.5
symbol palm Palm 70 300 scale=1.15 color=#1c5a38
symbol ptero Pterodactyl 520 90 scale=.8
symbol trex TRex 830 300 scale=1.6
circle ember1 300 120 3 #ff8a3c
circle ember2 780 90 3 #ff7a2e
every 2.6s move trex fromY=300 toY=306 duration=2.6 alternate=true
every 3.2s scale volcano from=1 to=1.05
every 6s move ptero fromX=520 toX=560 fromY=90 toY=104 duration=6 alternate=true
every 3s move ember1 fromY=120 toY=520 duration=3
every 2.8s move ember2 fromY=90 toY=540 duration=2.8

Be inventive: combine symbols in surprising, non-obvious ways while preserving a readable focal point and strong depth.`;

export const SCENE_SUGGESTER_PROMPT = `Always respond in English. Generate 3 creative scene descriptions using the available NeoFlash symbols. Each idea must be one or two evocative, cinematic sentences, description only—not code. Make every idea visually spectacular, surprising, and unlike obvious demo combinations. Include visible movement plus useful click, drag, or hover interaction in each idea. Use this complete symbol library, organized by category:\n\n${SYMBOL_REFERENCE}\n\nReturn exactly three English lines, each beginning with “1.”, “2.”, or “3.”.`;
