import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Play,
  Square,
  Save,
  FolderOpen,
  Code2,
  Terminal,
  X,
  Check,
  AlertTriangle,
  ChevronDown,
  Plus,
  RotateCcw,
  Loader2,
  Boxes,
  Search,
  Download,
} from 'lucide-react';
import NeoFlashCanvas, { NeoFlashSymbolPreview } from './NeoFlashCanvas';
import {
  ANIMATION_DEMO_NAMES,
  DEMO_DESCRIPTIONS,
  DEMOS,
  DEMO_TYPES,
  HIGHWAY_BAR,
  LAYOUT_DEMOS,
  LAYOUT_DEMO_NAMES,
  LANGUAGE_SPEC,
  NEOFLASH_AMPLIFIER_PROMPT,
  NEOFLASH_SYSTEM_PROMPT,
  SYMBOL_CATALOG,
  loadDynamicSymbols,
  parseNeoFlash,
  type NeoScene,
  type SymbolCategory,
} from './neoflashEngine';

type EditorMode = 'easy' | 'advanced';
type WorkspaceMode = EditorMode | 'demos';
type MobileTab = WorkspaceMode | 'preview';
type DemoCategory = 'animations' | 'layouts';
type GeneratedContentType = 'animation' | 'web-component' | 'game';

interface SceneRecord {
  id: string;
  name: string;
  code: string;
  mode: EditorMode;
  created_at?: string;
  updated_at?: string;
}

interface GeneratedSymbolPayload {
  name: string;
  width: number;
  height: number;
  svg: string;
  description?: string;
}

interface GeneratedScenePayload {
  type: GeneratedContentType;
  scene: string;
  newSymbols: GeneratedSymbolPayload[];
}

declare global {
  interface Window {
    useWorkspaceDB: <T = unknown>(
      table: string,
      options?: {
        shared?: boolean;
        limit?: number;
        offset?: number;
        orderBy?: { column: string; direction: 'asc' | 'desc' };
        filters?: Array<{ column: string; operator: string; value: unknown }>;
      },
    ) => { data: T[]; loading: boolean; error: Error | null; total: number; refresh: () => void };
    __workspaceDb: {
      token?: string;
      from: (table: string) => {
        insert: (row: Record<string, unknown>) => Promise<void>;
        update: (id: string | number, row: Record<string, unknown>) => Promise<void>;
        delete: (id: string | number) => Promise<void>;
      };
    };
  }
}

const FRIENDLY_GENERATION_ERROR = 'NeoFlash could not generate this creation. Try again or rephrase your description.';
const SESSION_GENERATION_ERROR = 'Your session is unavailable. Reload NeoFlash and try again.';
const UNIVERSAL_GENERATION_ROUTER_PROMPT = `First, classify the user's request. Your response MUST start on the very first line with exactly one of:
TYPE: animation
TYPE: web-component
TYPE: game

Choose animation for animated visual scenes or illustrations that should use the NeoFlash language. Choose web-component for website UI such as headers, navigation, menus, cards, forms, dashboards, and interface controls. Choose game for any playable experience with controls, objectives, scoring, collisions, or game-over behavior.

For animation, after the TYPE line follow the NeoFlash generation instructions below exactly. Preserve their required JSON shape when applicable.
For web-component or game, ignore any later instruction that requires NeoFlash syntax or a JSON wrapper. After the TYPE line output only one complete, self-contained HTML document beginning with <!DOCTYPE html>. Include all CSS in an inline <style> and all JavaScript in an inline <script>. Do not use Markdown fences, external libraries, external assets, network requests, or parent-window access. The document must fill its viewport, be responsive, and work in a sandboxed iframe.

Respect every aesthetic and interaction detail in the user's description. Web components must use polished modern CSS and functional interactions, including working hover/focus menus and dropdowns. Draw requested logos and icons as original inline SVG rather than emoji or external assets. Games must use a dark canvas-based game UI, be immediately playable, include clear controls, and implement the requested scoring, collision, and game-over rules. For lane-driving games, place the player vehicle near the bottom, spawn hazards from the top, keep movement snapped to explicit lanes, support both keyboard and visible touch/click controls, increase score over time, stop on collision, and offer a restart.`;
const SCENE_DEMO_NAMES = [
  ...ANIMATION_DEMO_NAMES,
  ...Object.keys(DEMOS).filter((name) => !ANIMATION_DEMO_NAMES.some((demo) => demo === name)),
  ...LAYOUT_DEMO_NAMES,
];

const PALETTE = [
  ['Circle', 'circle orb 640 360 48 #c6ff00'],
  ['Rectangle', 'rect panel 420 250 440 220 #15103b rx=18'],
  ['Text', 'text title 420 120 "NEOFLASH" #ff2bd6 44'],
  ['Car90', 'symbol car Car90 -220 506 scale=1'],
  ['NeonSign', 'symbol neon NeonSign 510 120 text=NEOFLASH scale=1'],
  ['Move', 'every 3s move car fromX=-220 toX=1450 duration=3'],
  ['Flicker', 'every 0.8s flicker neon min=0.45 max=1'],
  ['Click', 'on click neon toggle'],
  ['Drag', 'on drag neon move-with-cursor'],
  ['Hover', 'on hover neon scale 1.08'],
] as const;

const LAYOUT_CTA_IDS = new Set(['cyberButton', 'minimalButton', 'retroButton', 'spaceButton']);
const STATIC_SYMBOL_NAMES = new Set<string>(SYMBOL_CATALOG.map((symbol) => symbol.name));
const BLANK_ADVANCED_TEMPLATE = '// Start writing your NeoFlash scene here';
const EMPTY_NEO_SCENE: NeoScene = {
  stage: { width: 1280, height: 720, background: '#000000' },
  primitives: [],
  symbols: [],
  timeline: [],
  events: [],
};
const NEOFLASH_COMMANDS = new Set(['stage', 'circle', 'rect', 'line', 'polygon', 'text', 'symbol', 'every', 'on']);
const NEOFLASH_KEYWORDS = new Set([
  ...NEOFLASH_COMMANDS,
  'move', 'fade', 'flicker', 'scale', 'rotate', 'toggle', 'emotion',
  'click', 'drag', 'hover', 'move-with-cursor', 'happy', 'sad', 'surprised',
  'true', 'false',
]);
const NEOFLASH_PROPERTIES = new Set([
  ...SYMBOL_CATALOG.flatMap((symbol) => symbol.props.split(',').map((property) => property.trim()).filter(Boolean)),
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'from', 'to', 'fromX', 'fromY', 'toX', 'toY',
  'width', 'height', 'radius', 'fill', 'stroke', 'size', 'rx', 'duration', 'alternate',
  'opacity', 'speed', 'mobileX', 'mobileY', 'mobileScale', 'mobileWidth', 'mobileHeight',
  'mobileStageWidth', 'mobileStageHeight', 'raf',
]);
const NEOFLASH_COMPLETIONS = Array.from(new Set([
  ...SYMBOL_CATALOG.map((symbol) => symbol.name),
  ...NEOFLASH_KEYWORDS,
  ...NEOFLASH_PROPERTIES,
]));

interface EditorCompletion {
  start: number;
  end: number;
  items: string[];
  selected: number;
}

function splitNeoFlashComment(line: string): [string, string] {
  const firstContent = line.search(/\S/);
  if (firstContent >= 0 && line[firstContent] === '#') return [line.slice(0, firstContent), line.slice(firstContent)];
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '/' && line[index + 1] === '/') return [line.slice(0, index), line.slice(index)];
  }
  return [line, ''];
}

function highlightNeoFlash(source: string) {
  const tokenPattern = /(\s+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9A-Fa-f]{3,8}\b|-?(?:\d+(?:\.\d+)?|\.\d+)(?:s)?\b|[A-Za-z_][A-Za-z0-9_-]*|=|[^\s])/g;
  return source.split('\n').map((line, lineIndex, lines) => {
    const [codePart, commentPart] = splitNeoFlashComment(line);
    const tokens = codePart.match(tokenPattern) || [];
    const semanticTokens = tokens.filter((token) => !/^\s+$/.test(token));
    const command = semanticTokens[0]?.toLowerCase() || '';
    let semanticIndex = -1;
    return <span key={`highlight-line-${lineIndex}`}>
      {tokens.map((token, tokenIndex) => {
        if (/^\s+$/.test(token)) return token;
        semanticIndex += 1;
        const lower = token.toLowerCase();
        const next = semanticTokens[semanticIndex + 1];
        let style: { color?: string; textDecoration?: string; textDecorationColor?: string; textUnderlineOffset?: string } = { color: '#dcd7e8' };
        if (/^["']/.test(token) || /^#[0-9a-f]{3,8}$/i.test(token)) style = { color: '#8df7a5' };
        else if (/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:s)?$/i.test(token)) style = { color: '#eef2ff' };
        else if (command === 'symbol' && semanticIndex === 2) {
          style = STATIC_SYMBOL_NAMES.has(token)
            ? { color: '#ff4fd8' }
            : { color: '#ff4b64', textDecoration: 'underline wavy', textDecorationColor: '#ff334f', textUnderlineOffset: '3px' };
        } else if (next === '=') {
          style = NEOFLASH_PROPERTIES.has(token)
            ? { color: '#ffd166' }
            : { color: '#ff4b64', textDecoration: 'underline wavy', textDecorationColor: '#ff334f', textUnderlineOffset: '3px' };
        } else if (NEOFLASH_KEYWORDS.has(lower)) style = { color: lower === 'true' || lower === 'false' ? '#c6ff00' : '#48f7ff' };
        else if (semanticIndex === 0 && !NEOFLASH_COMMANDS.has(lower)) style = { color: '#ff4b64', textDecoration: 'underline wavy', textDecorationColor: '#ff334f', textUnderlineOffset: '3px' };
        return <span key={`token-${lineIndex}-${tokenIndex}`} style={style}>{token}</span>;
      })}
      {commentPart && <span style={{ color: '#555062' }}>{commentPart}</span>}
      {lineIndex < lines.length - 1 ? '\n' : null}
    </span>;
  });
}

function completionKind(value: string): string {
  if (STATIC_SYMBOL_NAMES.has(value)) return 'SYMBOL';
  if (NEOFLASH_PROPERTIES.has(value)) return 'PROPERTY';
  return 'KEYWORD';
}

function findInvalidGeneratedSymbols(source: string): string[] {
  const invalid = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(/^symbol\s+\S+\s+(\S+)/i);
    if (match?.[1] && !STATIC_SYMBOL_NAMES.has(match[1])) invalid.add(match[1]);
  }
  return [...invalid];
}

function constrainGeneratedGlowScales(source: string): string {
  return source.split(/\r?\n/).map((line) => {
    if (!/^\s*symbol\s+\S+\s+Glow(?:\s|$)/.test(line)) return line;
    const scale = line.match(/\bscale=(-?(?:\d+\.?\d*|\.\d+))/i);
    if (!scale) return `${line} scale=.6`;
    return Number(scale[1]) > .6 ? line.replace(scale[0], 'scale=.6') : line;
  }).join('\n');
}

function cleanGeneratedCode(raw: string): string {
  return raw.trim().replace(/^```(?:html|json|neoflash|nf)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parseGeneratedResponse(raw: string): GeneratedScenePayload {
  const typedResponse = raw.trim().match(/^TYPE:\s*(animation|web-component|game)\s*(?:\r?\n|$)/i);
  const type = (typedResponse?.[1]?.toLowerCase() || 'animation') as GeneratedContentType;
  const cleaned = cleanGeneratedCode(typedResponse ? raw.trim().slice(typedResponse[0].length) : raw);

  if (type !== 'animation') return { type, scene: cleaned, newSymbols: [] };

  try {
    const parsed = JSON.parse(cleaned) as { scene?: unknown; newSymbols?: unknown };
    if (typeof parsed.scene === 'string') {
      const newSymbols = Array.isArray(parsed.newSymbols)
        ? parsed.newSymbols.filter((symbol): symbol is GeneratedSymbolPayload => !!symbol && typeof symbol === 'object' && typeof symbol.name === 'string' && typeof symbol.svg === 'string' && typeof symbol.width === 'number' && typeof symbol.height === 'number')
        : [];
      return { type, scene: cleanGeneratedCode(parsed.scene), newSymbols };
    }
  } catch {
    // Backward compatibility: older model responses are plain NeoFlash source.
  }
  return { type, scene: cleaned, newSymbols: [] };
}

interface InterpretationResult {
  type: GeneratedContentType;
  interpretation: string;
}

function parseInterpretation(raw: string): InterpretationResult {
  const cleaned = cleanGeneratedCode(raw);
  try {
    const parsed = JSON.parse(cleaned) as { type?: unknown; interpretation?: unknown };
    const type = (parsed.type === 'web-component' || parsed.type === 'game') ? parsed.type : 'animation';
    const interpretation = typeof parsed.interpretation === 'string' ? parsed.interpretation.trim() : '';
    return { type, interpretation };
  } catch {
    return { type: 'animation', interpretation: cleaned.replace(/^TYPE:.*$/im, '').trim() };
  }
}

function displayDate(value?: string) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function NeoFlashPlayground() {
  const { data: savedScenes, loading: scenesLoading, error: scenesError, refresh: refreshScenes } = window.useWorkspaceDB<SceneRecord>('scenes', {
    orderBy: { column: 'updated_at', direction: 'desc' },
    limit: 100,
  });
  const initialScene = useMemo(() => parseNeoFlash(HIGHWAY_BAR), []);
  const [mode, setMode] = useState<WorkspaceMode>('demos');
  const [demoCategory, setDemoCategory] = useState<DemoCategory>('animations');
  const [activeDemoName, setActiveDemoName] = useState('Highway Bar');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState(HIGHWAY_BAR);
  const [activeScene, setActiveScene] = useState<NeoScene>(initialScene);
  const [activeCode, setActiveCode] = useState(HIGHWAY_BAR);
  const [activeHtml, setActiveHtml] = useState('');
  const [activeContentType, setActiveContentType] = useState<GeneratedContentType>('animation');
  const [sceneName, setSceneName] = useState('Highway Bar');
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [runKey, setRunKey] = useState(1);
  const [fps, setFps] = useState(60);
  const [generating, setGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<'idle' | 'interpreting' | 'generating'>('idle');
  const [interpretation, setInterpretation] = useState('');
  const [saving, setSaving] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview');
  const [consoleLines, setConsoleLines] = useState<string[]>(['✓ Highway Bar parsed · runtime ready']);
  const [feedback, setFeedback] = useState('');
  const [autoRun, setAutoRun] = useState(true);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [copiedExportSection, setCopiedExportSection] = useState<'source' | 'embed' | null>(null);
  const [completion, setCompletion] = useState<EditorCompletion | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);

  const log = useCallback((message: string) => {
    setConsoleLines((current) => [...current.slice(-4), message]);
  }, []);

  const updateCompletion = (value: string, caret: number | null) => {
    if (activeContentType !== 'animation' || caret === null) { setCompletion(null); return; }
    const prefixMatch = value.slice(0, caret).match(/[A-Za-z_][A-Za-z0-9_-]*$/);
    const prefix = prefixMatch?.[0] || '';
    if (prefix.length < 2) { setCompletion(null); return; }
    const items = NEOFLASH_COMPLETIONS
      .filter((candidate) => candidate.toLowerCase().startsWith(prefix.toLowerCase()) && candidate.toLowerCase() !== prefix.toLowerCase())
      .slice(0, 5);
    setCompletion(items.length ? { start: caret - prefix.length, end: caret, items, selected: 0 } : null);
  };

  const applyCompletion = (value: string) => {
    if (!completion) return;
    const nextCode = `${code.slice(0, completion.start)}${value}${code.slice(completion.end)}`;
    const nextCaret = completion.start + value.length;
    setCode(nextCode);
    setCompletion(null);
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleAdvancedKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!completion) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setCompletion((current) => current ? { ...current, selected: (current.selected + direction + current.items.length) % current.items.length } : null);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const selectedItem = completion.items[completion.selected];
      if (!selectedItem) return;
      event.preventDefault();
      applyCompletion(selectedItem);
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); setCompletion(null); }
  };

  const handleNewScene = useCallback(() => {
    const hasModifiedContent = description.trim().length > 0 || code !== activeCode;
    if (hasModifiedContent && !window.confirm('Start a new scene? Your current unsaved edits will be cleared.')) return;
    const targetMode: EditorMode = mode === 'advanced' ? 'advanced' : 'easy';
    const starter = targetMode === 'advanced' ? BLANK_ADVANCED_TEMPLATE : '';
    setDescription('');
    setInterpretation('');
    setCode(starter);
    setActiveCode(starter);
    setActiveScene(EMPTY_NEO_SCENE);
    setActiveHtml('');
    setActiveContentType('animation');
    setSceneName('New Scene');
    setSceneId(null);
    setRunning(false);
    setRunKey((value) => value + 1);
    setFeedback('');
    setCompletion(null);
    setMode(targetMode);
    setMobileTab(targetMode);
    log(`↳ New blank ${targetMode} scene`);
  }, [activeCode, code, description, log, mode]);

  useEffect(() => {
    const loaded = loadDynamicSymbols();
    if (loaded) log(`↳ Restored ${loaded} custom symbol${loaded === 1 ? '' : 's'}`);
  }, [log]);

  const runSource = useCallback((source: string, name?: string, typeHint?: GeneratedContentType) => {
    const isHtml = /^\s*<!doctype html>/i.test(source);
    if (isHtml) {
      const htmlType = typeHint === 'game' ? 'game' : 'web-component';
      setActiveHtml(source);
      setActiveContentType((current) => typeHint === 'game' || typeHint === 'web-component' ? typeHint : (current === 'game' ? 'game' : htmlType));
      setActiveCode(source);
      setRunning(true);
      setRunKey((value) => value + 1);
      setFeedback('');
      log(`✓ ${name || (htmlType === 'game' ? 'Game' : 'Web component')} loaded in sandbox`);
      return true;
    }

    try {
      const parsed = parseNeoFlash(source);
      setActiveScene(parsed);
      setActiveHtml('');
      setActiveContentType('animation');
      setActiveCode(source);
      setRunning(true);
      setRunKey((value) => value + 1);
      setFeedback('');
      log(`✓ ${name || 'Scene'} parsed · ${parsed.primitives.length + parsed.symbols.length} objects`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      setFeedback(`${message}. Keep the previous creation visible and check the source.`);
      log(`! Parse error: ${message}`);
      return false;
    }
  }, [log]);

  const generateScene = useCallback(async (prompt: string, requestedName?: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || generating) return false;

    const token = window.__workspaceDb?.token;
    if (!token) {
      setFeedback(SESSION_GENERATION_ERROR);
      log(`! ${SESSION_GENERATION_ERROR}`);
      return false;
    }

    setGenerating(true);
    setGenerationPhase('interpreting');
    setInterpretation('');
    setFeedback('');
    log('Interpreting your idea…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);

    try {
      // STEP A + B — detect language, translate, and amplify the prompt into a rich English scene description.
      const interpretResponse = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-DB-Token': token,
        },
        body: JSON.stringify({
          model: 'gpt-5.6-terra',
          reasoning_effort: 'none',
          max_completion_tokens: 900,
          stream: false,
          messages: [
            { role: 'system', content: NEOFLASH_AMPLIFIER_PROMPT },
            { role: 'user', content: trimmed },
          ],
        }),
      });
      const interpretPayload = await interpretResponse.json().catch(() => null);
      if (!interpretResponse.ok) {
        throw new Error(interpretPayload?.error?.message || interpretPayload?.error || `OpenAI request failed (${interpretResponse.status})`);
      }
      const interpreted = parseInterpretation(interpretPayload?.choices?.[0]?.message?.content || '');
      const amplifiedPrompt = interpreted.interpretation || trimmed;
      // STEP C — reveal the amplified interpretation to the user before the animation begins.
      setInterpretation(amplifiedPrompt);
      log(`↳ Interpreted as: ${amplifiedPrompt}`);

      // STEP D — generate the creation from the amplified description.
      setGenerationPhase('generating');
      log('Generating your scene…');
      const generationSystemPrompt = interpreted.type === 'animation'
        ? NEOFLASH_SYSTEM_PROMPT
        : `${UNIVERSAL_GENERATION_ROUTER_PROMPT}\n\n${NEOFLASH_SYSTEM_PROMPT}`;
      const response = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-DB-Token': token,
        },
        body: JSON.stringify({
          model: 'gpt-5.6-terra',
          reasoning_effort: 'none',
          max_completion_tokens: 5200,
          stream: false,
          messages: [
            { role: 'system', content: generationSystemPrompt },
            { role: 'user', content: amplifiedPrompt },
          ],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.error || `OpenAI request failed (${response.status})`);
      }

      const generatedResponse = parseGeneratedResponse(payload?.choices?.[0]?.message?.content || '');
      let generated = generatedResponse.scene;
      if (!generated) throw new Error('The model returned empty source');
      if (generatedResponse.type === 'animation') generated = constrainGeneratedGlowScales(generated);
      if (generatedResponse.type !== 'animation' && !/^\s*<!doctype html>/i.test(generated)) {
        throw new Error('The model did not return a complete HTML document');
      }

      if (generatedResponse.type === 'animation') {
        const invalidSymbols = findInvalidGeneratedSymbols(generated);
        if (generatedResponse.newSymbols.length || invalidSymbols.length) {
          const names = invalidSymbols.length ? invalidSymbols.join(', ') : generatedResponse.newSymbols.map((symbol) => symbol.name).join(', ');
          throw new Error(`The model used symbols outside the NeoFlash vocabulary: ${names}`);
        }
      }

      const nextName = requestedName || trimmed.slice(0, 42) || 'Generated Creation';
      if (!runSource(generated, nextName, generatedResponse.type)) throw new Error('Generated source could not run');
      setCode(generated);
      setSceneName(nextName);
      setSceneId(null);
      setMobileTab('preview');
      if (generatedResponse.type === 'animation') {
        const parsed = parseNeoFlash(generated);
        log(`✓ Generated ${parsed.primitives.length + parsed.symbols.length} SVG objects · vocabulary verified`);
      } else {
        log(`✓ Generated complete ${generatedResponse.type === 'game' ? 'playable game' : 'web component'} · HTML/CSS/JS`);
      }
      return true;
    } catch (error) {
      console.error('[NeoFlash] Scene generation failed:', error);
      setFeedback(FRIENDLY_GENERATION_ERROR);
      log(`! ${FRIENDLY_GENERATION_ERROR}`);
      return false;
    } finally {
      window.clearTimeout(timeout);
      setGenerating(false);
      setGenerationPhase('idle');
    }
  }, [generating, log, runSource]);

  const saveScene = useCallback(async (forcedName?: string) => {
    if (saving) return;
    const fallback = `My Scene ${(savedScenes?.length || 0) + 1}`;
    const name = (forcedName ?? window.prompt('Name this scene', sceneName || fallback) ?? '').trim() || fallback;
    if (!runSource(code, name)) return;
    setSaving(true);
    try {
      const payload = { name, code, mode: mode === 'advanced' ? 'advanced' as const : 'easy' as const };
      if (sceneId) await window.__workspaceDb.from('scenes').update(sceneId, payload);
      else await window.__workspaceDb.from('scenes').insert(payload);
      setSceneName(name);
      refreshScenes();
      log(`✓ “${name}” saved`);
    } catch (error) {
      console.error('[NeoFlash] Save failed:', error);
      setFeedback('Could not save this scene. Check your session and try again.');
      log('! Scene save failed');
    } finally {
      setSaving(false);
    }
  }, [code, log, mode, refreshScenes, runSource, savedScenes?.length, saving, sceneId, sceneName]);

  const loadScene = useCallback((scene: SceneRecord) => {
    if (!runSource(scene.code, scene.name)) return;
    setCode(scene.code);
    setDescription('');
    setInterpretation('');
    setMode(scene.mode === 'easy' ? 'easy' : 'advanced');
    setSceneName(scene.name);
    setSceneId(scene.id);
    setShowLoad(false);
    setMobileTab('preview');
    log(`↳ Loaded “${scene.name}”`);
  }, [log, runSource]);

  const loadDemo = (name: string) => {
    const isLayout = Object.prototype.hasOwnProperty.call(LAYOUT_DEMOS, name);
    const source = isLayout ? LAYOUT_DEMOS[name as keyof typeof LAYOUT_DEMOS] : DEMOS[name];
    if (!source) return;

    setSceneName(name);
    setSceneId(null);
    setActiveDemoName(name);
    setDemoCategory(isLayout ? 'layouts' : 'animations');
    setDescription('');
    setInterpretation('');
    setMode('demos');
    setCode(source);
    runSource(source, name, DEMO_TYPES[name]);
    setMobileTab('preview');
  };

  const handleLayoutCta = useCallback((symbolId: string) => {
    if (!LAYOUT_CTA_IDS.has(symbolId)) return;
    setDescription('');
    setMode('easy');
    setMobileTab('easy');
    log('↳ Creator opened from layout preview');
  }, [log]);

  const visibleDemoNames = demoCategory === 'animations' ? ANIMATION_DEMO_NAMES : LAYOUT_DEMO_NAMES;

  const insertSnippet = (snippet: string) => {
    setCode((current) => `${current.trimEnd()}\n${snippet}\n`);
    setMode('advanced');
    setMobileTab('advanced');
  };

  const insertCatalogObject = (snippet: string) => {
    if (mode === 'easy') {
      setDescription((current) => `${current.trim()}${current.trim() ? '\n\n' : ''}Include this object: ${snippet}`);
      setMobileTab('easy');
    } else {
      insertSnippet(snippet);
    }
    setShowCatalog(false);
  };

  const visibleCatalog = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return query ? SYMBOL_CATALOG.filter((item) => `${item.name} ${item.category} ${item.props}`.toLowerCase().includes(query)) : [...SYMBOL_CATALOG];
  }, [catalogSearch]);

  const catalogGroups = useMemo(() => {
    const categories: SymbolCategory[] = ['Nature & Outdoors', 'Animals', 'Urban & Architecture', 'Vehicles', 'Interior & Furniture', 'Tech & Electronics', 'Cyberpunk / Sci-Fi', 'Food & Objects', 'Weather & Effects', 'Symbols & Abstract', 'UI', 'People'];
    return categories.map((category) => ({ category, items: visibleCatalog.filter((item) => item.category === category) })).filter((group) => group.items.length);
  }, [visibleCatalog]);

  useEffect(() => {
    if (mode !== 'advanced' || !autoRun || code === activeCode) return;
    const timer = window.setTimeout(() => runSource(code, sceneName), 1400);
    return () => window.clearTimeout(timer);
  }, [activeCode, autoRun, code, mode, runSource, sceneName]);

  useEffect(() => {
    if (!showExport) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowExport(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showExport]);

  const copyExportText = useCallback(async (text: string, section: 'source' | 'embed') => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.appendChild(fallback);
      fallback.select();
      const copied = document.execCommand('copy');
      fallback.remove();
      if (!copied) {
        setFeedback('Could not copy automatically. Select the text and copy it manually.');
        return;
      }
    }
    setCopiedExportSection(section);
    window.setTimeout(() => setCopiedExportSection((current) => current === section ? null : current), 2000);
  }, []);

  const downloadScene = (format: 'source' | 'svg' = 'source') => {
    const safeName = sceneName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-creation';
    let contents = code;
    let type = activeContentType === 'animation' ? 'text/plain;charset=utf-8' : 'text/html;charset=utf-8';
    let extension = activeContentType === 'animation' ? 'neoflash' : 'html';

    if (format === 'svg') {
      if (activeContentType !== 'animation') {
        setFeedback('SVG export is available for NeoFlash animations. Download this game or component as HTML instead.');
        return;
      }
      const renderedSvg = document.querySelector<SVGSVGElement>('[data-neoflash-preview="true"] svg');
      if (!renderedSvg) {
        setFeedback('Run the animation before exporting its SVG.');
        return;
      }
      const clone = renderedSvg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(activeScene.stage.width));
      clone.setAttribute('height', String(activeScene.stage.height));
      contents = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
      type = 'image/svg+xml;charset=utf-8';
      extension = 'svg';
    }

    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const stopScene = () => {
    setRunning(false);
    setRunKey((value) => value + 1);
    log('■ Runtime stopped · listeners removed');
  };

  const objectCount = activeScene.primitives.length + activeScene.symbols.length;
  const isBlankCanvas = activeContentType === 'animation' && objectCount === 0;
  const lineCount = code.split(/\r?\n/).length;
  const embedSnippet = activeContentType === 'animation' ? `<!-- NeoFlash embed -->
<script src="https://cdn.jsdelivr.net/npm/neoflash-runtime@0.1/dist/neoflash.min.js"></script>
<neo-flash>
${code}
</neo-flash>` : code;

  return (
    <div className="nf-app fixed left-0 top-0 flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#070811] text-[#eef2ff] font-mono" style={{ width: '100vw', height: '100dvh', overflow: 'hidden', position: 'fixed', top: 0, left: 0 }}>
      <style>{`
        .nf-grid { background-image: linear-gradient(rgba(72,247,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(72,247,255,.06) 1px, transparent 1px); background-size: 24px 24px; }
        .nf-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .nf-scroll::-webkit-scrollbar-thumb { background: #30274a; border-radius: 999px; }
        .nf-code-input { color: transparent; caret-color: #f8f5fe; -webkit-text-fill-color: transparent; }
        .nf-code-input::selection { background: rgba(255,43,214,.35); }
        @media (max-width: 767px) {
          .nf-app button, .nf-app select { min-height: 44px; }
          .nf-app input, .nf-app textarea, .nf-app select { font-size: 16px !important; }
          .nf-touch { min-height: 44px; min-width: 44px; font-size: 12px !important; }
          .nf-mobile-input { font-size: 16px !important; }
        }
      `}</style>

      <div className="grid grid-cols-5 gap-1 border-b border-[#30274a] bg-[#090a13] p-1 md:hidden" role="tablist" aria-label="NeoFlash workspace">
        <button type="button" role="tab" aria-selected={mobileTab === 'demos'} onClick={() => { loadDemo(activeDemoName); setMobileTab('demos'); }} className={`nf-touch rounded px-1 text-[9px] font-black ${mobileTab === 'demos' ? 'bg-[#ff2bd6] text-[#080812]' : 'text-[#aaa4bd]'}`}>DEMOS</button>
        <button type="button" role="tab" aria-selected={mobileTab === 'easy'} onClick={() => { if (mode === 'demos') setDescription(''); setMode('easy'); setMobileTab('easy'); }} className={`nf-touch rounded px-1 text-[9px] font-black ${mobileTab === 'easy' ? 'bg-[#c6ff00] text-[#080812]' : 'text-[#aaa4bd]'}`}>EASY</button>
        <button type="button" role="tab" aria-selected={mobileTab === 'advanced'} onClick={() => { setMode('advanced'); setMobileTab('advanced'); }} className={`nf-touch rounded px-1 text-[9px] font-black ${mobileTab === 'advanced' ? 'bg-[#48f7ff] text-[#080812]' : 'text-[#aaa4bd]'}`}>ADV.</button>
        <button type="button" onClick={handleNewScene} className="nf-touch rounded border border-[#ff2bd6] bg-[#ff2bd6]/10 px-1 text-[9px] font-black text-[#ff73df] shadow-[0_0_12px_rgba(255,43,214,.12)]">NEW ✦</button>
        <button type="button" role="tab" aria-selected={mobileTab === 'preview'} onClick={() => setMobileTab('preview')} className={`nf-touch rounded px-1 text-[9px] font-black ${mobileTab === 'preview' ? 'bg-[#211c31] text-[#c6ff00]' : 'text-[#aaa4bd]'}`}>PREVIEW</button>
      </div>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className={`${mobileTab !== 'preview' ? 'flex' : 'hidden'} min-h-0 w-full flex-col border-r border-[#30274a] bg-[#0a0a14] md:flex md:w-[42%] xl:w-[38%]`}>
          <div className="nf-scroll flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[#30274a] bg-[#0d0d19] p-2 md:flex-wrap md:gap-1.5 md:overflow-visible">
            <div className="hidden rounded-md border border-[#30274a] bg-[#080812] p-0.5 md:flex">
              <button onClick={() => loadDemo(activeDemoName)} className={`flex items-center rounded px-2 py-1.5 text-[10px] font-bold ${mode === 'demos' ? 'bg-[#ff2bd6] text-[#080812]' : 'text-[#aaa4bd] hover:text-white'}`}>Demo Scenes</button>
              <button onClick={() => { if (mode === 'demos') setDescription(''); setMode('easy'); }} className={`flex items-center rounded px-2 py-1.5 text-[10px] font-bold ${mode === 'easy' ? 'bg-[#c6ff00] text-[#080812]' : 'text-[#aaa4bd] hover:text-white'}`}>Easy</button>
              <button onClick={() => setMode('advanced')} className={`flex items-center gap-1 rounded px-2 py-1.5 text-[10px] font-bold ${mode === 'advanced' ? 'bg-[#48f7ff] text-[#080812]' : 'text-[#aaa4bd] hover:text-white'}`}><Code2 className="h-3 w-3" />Advanced</button>
            </div>
            <button onClick={handleNewScene} className="nf-touch flex shrink-0 items-center gap-1 rounded-md border border-[#ff2bd6] bg-[#ff2bd6]/10 px-2.5 py-1.5 text-[10px] font-black text-[#ff73df] shadow-[0_0_14px_rgba(255,43,214,.12)] hover:bg-[#ff2bd6]/20"><Plus className="h-3 w-3" />New ✦</button>
            <div className="relative">
              <select onChange={(event) => event.target.value && loadDemo(event.target.value)} value="" className="nf-touch nf-mobile-input appearance-none rounded-md border border-[#30274a] bg-[#11111f] py-1.5 pl-2 pr-7 text-[10px] text-[#d9d5e5] outline-none hover:border-[#48f7ff]" aria-label={`Load a demo scene in ${mode} mode`}>
                <option value="" disabled>Demo scenes</option>
                {SCENE_DEMO_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2 h-3 w-3 text-[#817a95]" />
            </div>
            <button onClick={() => setShowCatalog(true)} className="nf-touch flex shrink-0 items-center gap-1 rounded-md border border-[#8b00ff] bg-[#8b00ff]/10 px-3 py-1.5 text-[10px] font-bold text-[#d7b8ff] hover:bg-[#8b00ff]/20"><Boxes className="h-3 w-3" />Symbols</button>
            <button onClick={() => runSource(code, sceneName)} className="nf-touch flex shrink-0 items-center gap-1 rounded-md bg-[#c6ff00] px-3 py-1.5 text-[10px] font-black text-[#090b0d] hover:brightness-110 md:ml-auto"><Play className="h-3 w-3 fill-current" />Run</button>
            <button onClick={stopScene} className="nf-touch flex shrink-0 items-center gap-1 rounded-md border border-[#4a405f] bg-[#171522] px-3 py-1.5 text-[10px] font-bold text-[#ddd8ea] hover:border-[#ff2bd6]"><Square className="h-3 w-3" />Stop</button>
            <button onClick={() => { setCopiedExportSection(null); setShowExport(true); }} className="nf-touch flex shrink-0 items-center gap-1 rounded-md border border-[#39ff14] bg-[#39ff14]/10 px-3 py-1.5 text-[10px] font-black text-[#8dff7a] shadow-[0_0_14px_rgba(57,255,20,.08)] hover:bg-[#39ff14]/20"><Download className="h-3 w-3" />Export</button>
            <button onClick={() => void saveScene()} disabled={saving} className="nf-touch flex shrink-0 items-center gap-1 rounded-md border border-[#4a405f] bg-[#171522] px-3 py-1.5 text-[10px] font-bold text-[#ddd8ea] hover:border-[#48f7ff] disabled:opacity-50">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save</button>
            <button onClick={() => setShowLoad(true)} className="nf-touch flex shrink-0 items-center gap-1 rounded-md border border-[#4a405f] bg-[#171522] px-3 py-1.5 text-[10px] font-bold text-[#ddd8ea] hover:border-[#48f7ff]"><FolderOpen className="h-3 w-3" />Load</button>
          </div>
          <div className="hidden border-b border-[#30274a] bg-[#090a13] px-2 py-2 md:block">
            <div className="mb-2 flex gap-1" role="tablist" aria-label="Demo category">
              {(['animations', 'layouts'] as const).map((category) => <button key={category} type="button" role="tab" aria-selected={demoCategory === category} onClick={() => setDemoCategory(category)} className={`rounded border px-3 py-1 text-[9px] font-black uppercase tracking-[.16em] transition ${demoCategory === category ? category === 'animations' ? 'border-[#48f7ff] bg-[#48f7ff]/10 text-[#8dfaff] shadow-[0_0_14px_rgba(72,247,255,.12)]' : 'border-[#ff2bd6] bg-[#ff2bd6]/10 text-[#ff73df] shadow-[0_0_14px_rgba(255,43,214,.12)]' : 'border-[#30274a] text-[#777186] hover:text-white'}`}>{category === 'animations' ? 'Animations' : 'Layouts'}</button>)}
            </div>
            <div className="nf-scroll flex gap-1.5 overflow-x-auto pb-0.5">
              {visibleDemoNames.map((name) => <button key={name} type="button" onClick={() => loadDemo(name)} aria-pressed={mode === 'demos' && activeDemoName === name} className={`shrink-0 rounded border px-2.5 py-1.5 text-[9px] font-bold transition ${mode === 'demos' && activeDemoName === name ? 'border-[#c6ff00] bg-[#c6ff00]/10 text-[#dfff7a] shadow-[0_0_12px_rgba(198,255,0,.12)]' : 'border-[#30274a] bg-[#11111f] text-[#918aa5] hover:border-[#48f7ff] hover:text-white'}`}>{name}</button>)}
            </div>
          </div>
          {mode === 'demos' ? (
            <div className="nf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
              <p className="text-[10px] font-black tracking-[.24em] text-[#ff73df]">DEMO SCENES // LIVE</p>
              <h2 className="mt-3 text-2xl font-black text-white">{activeDemoName}</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#aaa4bd]">{DEMO_DESCRIPTIONS[activeDemoName] || 'A ready-to-run NeoFlash creation. Choose another demo above or remix this one.'}</p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => { setDescription(''); setMode('easy'); setMobileTab('easy'); }} className="nf-touch rounded-lg bg-[#c6ff00] px-4 py-3 text-xs font-black text-[#080812]">CREATE IN EASY MODE</button>
                <button type="button" onClick={() => { setMode('advanced'); setMobileTab('advanced'); }} className="nf-touch rounded-lg border border-[#48f7ff] bg-[#48f7ff]/10 px-4 py-3 text-xs font-black text-[#8dfaff]">REMIX SOURCE</button>
              </div>
              <div className="mt-6 rounded-lg border border-[#30274a] bg-[#0d0d18] p-4 text-[10px] leading-5 text-[#777186]">
                Demo mode runs the selected scene directly. Easy mode starts with a blank description so demo copy is never mistaken for AI-generated content.
              </div>
            </div>
          ) : mode === 'easy' ? (
            <div className="nf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-3 md:p-5">
              <div className="mb-3 rounded-lg border border-[#48f7ff]/50 bg-[#0c1720] p-3 md:hidden">
                <label className="block text-[10px] font-black tracking-[.16em] text-[#8dfaff]" htmlFor="mobile-easy-demo">START WITH A DEMO</label>
                <select id="mobile-easy-demo" value="" onChange={(event) => loadDemo(event.target.value)} className="nf-touch nf-mobile-input mt-2 w-full rounded-md border border-[#48f7ff] bg-[#090b16] px-3 text-white outline-none" aria-label="Choose an Easy mode demo scene">
                  <option value="" disabled>Choose a scene…</option>
                  {SCENE_DEMO_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <p className="mt-2 text-[10px] leading-4 text-[#918aa5]">Pick a scene to open it in Demo mode. Return to Easy mode for a blank AI prompt.</p>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2 md:hidden">
                <button type="button" onClick={() => runSource(code, sceneName)} className="nf-touch flex items-center justify-center gap-1 rounded-md bg-[#c6ff00] px-2 font-black text-[#080812]"><Play className="h-4 w-4 fill-current" />RUN</button>
                <button type="button" onClick={stopScene} className="nf-touch flex items-center justify-center gap-1 rounded-md border border-[#ff2bd6] bg-[#171522] px-2 font-black text-white"><Square className="h-4 w-4" />STOP</button>
                <button type="button" onClick={() => { setCopiedExportSection(null); setShowExport(true); }} className="nf-touch flex items-center justify-center gap-1 rounded-md border border-[#39ff14] bg-[#39ff14]/10 px-2 font-black text-[#8dff7a]"><Download className="h-4 w-4" />EXPORT</button>
              </div>
              <div className="mb-4">
                <p className="text-[10px] font-bold tracking-[0.25em] text-[#c6ff00]">EASY MODE // AI POWERED</p>
                <h2 className="mt-2 text-xl font-black text-white">Describe anything, in any language.</h2>
                <p className="mt-1 text-xs leading-5 text-[#918aa5]">Write in any language, at any level of detail. NeoFlash interprets and amplifies your idea into a cinematic scene—then builds it.</p>
              </div>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void generateScene(description); } }} className="nf-scroll nf-mobile-input min-h-[140px] flex-none resize-none rounded-lg border border-[#39314d] bg-[#11111d] p-4 text-base leading-6 text-[#f0edf7] outline-none placeholder:text-[#5f596d] focus:border-[#c6ff00] focus:shadow-[0_0_0_2px_rgba(198,255,0,.08)] md:min-h-[180px] md:flex-1 md:text-sm" placeholder="Describe your scene..." aria-label="Creation description" />
              <p className="mt-3 text-[10px] font-bold tracking-[0.12em] text-[#8df7a5]">AI PIPELINE // INTERPRET · AMPLIFY · GENERATE</p>
              <button onClick={() => void generateScene(description)} disabled={generating || !description.trim()} className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#c6ff00] px-4 py-3 text-sm font-black text-[#080a0c] shadow-[0_0_22px_rgba(198,255,0,.16)] hover:brightness-110 disabled:opacity-40">{generating && <Loader2 className="h-4 w-4 animate-spin" />}{generationPhase === 'interpreting' ? 'INTERPRETING…' : generationPhase === 'generating' ? 'GENERATING…' : 'GENERATE + RUN'}<span className="hidden text-[9px] opacity-60 xl:inline">⌘↵</span></button>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {['a dinosaur', 'a volcano at sunset', 'an ocean with waves and a palm tree', 'a neon robot city at night'].map((prompt) => <button key={prompt} onClick={() => setDescription(prompt)} className="nf-touch rounded-md border border-[#2d283b] bg-[#11111c] p-2 text-left text-[10px] leading-4 text-[#9891a9] hover:border-[#ff2bd6] hover:text-white">{prompt}</button>)}
              </div>
              {interpretation && (
                <div className="mt-4 rounded-lg border border-[#48f7ff]/50 bg-[#0b1622] p-3 shadow-[0_0_18px_rgba(72,247,255,.1)]">
                  <p className="text-[9px] font-black uppercase tracking-[.22em] text-[#8dfaff]">Interpreted as</p>
                  <p className="mt-1 text-xs italic leading-5 text-[#c9f4ff]">{interpretation}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-[#292438] px-3 py-2 text-[10px] tracking-wider text-[#777186]"><Terminal className="h-3.5 w-3.5 text-[#48f7ff]" /><span>{sceneName || 'UNTITLED'}.{activeContentType === 'animation' ? 'NF' : 'HTML'}</span><span className="ml-auto">{lineCount} LINES</span></div>
              <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0d0d18]">
                <pre ref={lineNumbersRef} aria-hidden className="nf-scroll w-11 shrink-0 overflow-hidden border-r border-[#211d2e] bg-[#080812] py-3 pr-2 text-right text-xs leading-6 text-[#464052]">{Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')}</pre>
                <div className="relative min-w-0 flex-1 overflow-hidden">
                  <pre ref={highlightRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre p-3 text-base leading-6 md:text-xs" style={{ tabSize: 2 }}>{activeContentType === 'animation' ? highlightNeoFlash(code) : code}</pre>
                  <textarea
                    ref={editorRef}
                    value={code}
                    onChange={(event) => { setCode(event.target.value); updateCompletion(event.target.value, event.target.selectionStart); }}
                    onSelect={(event) => updateCompletion(event.currentTarget.value, event.currentTarget.selectionStart)}
                    onKeyDown={handleAdvancedKeyDown}
                    onBlur={() => window.setTimeout(() => setCompletion(null), 120)}
                    onScroll={(event) => {
                      if (highlightRef.current) { highlightRef.current.scrollTop = event.currentTarget.scrollTop; highlightRef.current.scrollLeft = event.currentTarget.scrollLeft; }
                      if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
                    }}
                    wrap="off"
                    spellCheck={false}
                    className="nf-scroll nf-mobile-input nf-code-input absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-3 text-base leading-6 outline-none md:text-xs"
                    style={{ tabSize: 2 }}
                    aria-label={activeContentType === 'animation' ? 'NeoFlash code editor with syntax highlighting and autocomplete' : 'HTML code editor'}
                    aria-autocomplete={activeContentType === 'animation' ? 'list' : 'none'}
                    aria-expanded={!!completion}
                  />
                  {completion && (
                    <div role="listbox" aria-label="Code suggestions" className="absolute bottom-3 right-3 z-20 w-56 overflow-hidden rounded-md border border-[#48f7ff] bg-[#080812]/95 shadow-[0_0_24px_rgba(72,247,255,.2)] backdrop-blur">
                      <div className="border-b border-[#30274a] px-2 py-1 text-[8px] font-black tracking-[.18em] text-[#48f7ff]">AUTOCOMPLETE</div>
                      {completion.items.map((item, index) => (
                        <button key={item} type="button" role="option" aria-selected={completion.selected === index} onMouseDown={(event) => { event.preventDefault(); applyCompletion(item); }} className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[10px] ${completion.selected === index ? 'bg-[#48f7ff]/15 text-white' : 'text-[#aaa4bd] hover:bg-[#ff2bd6]/10 hover:text-white'}`}>
                          <span className={completionKind(item) === 'SYMBOL' ? 'text-[#ff4fd8]' : completionKind(item) === 'PROPERTY' ? 'text-[#ffd166]' : 'text-[#48f7ff]'}>{item}</span>
                          <span className="ml-auto text-[7px] tracking-wider text-[#5f596d]">{completionKind(item)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-[#292438] bg-[#0b0b15] p-2">
                {activeContentType === 'animation' ? <div className="flex flex-wrap gap-1.5">{PALETTE.map(([label, snippet]) => <button key={label} onClick={() => insertSnippet(snippet)} className="rounded border border-[#312b41] bg-[#141320] px-2 py-1 text-[9px] font-bold text-[#948da5] hover:border-[#48f7ff] hover:text-[#48f7ff]"><Plus className="mr-1 inline h-2.5 w-2.5" />{label}</button>)}</div> : <p className="text-[9px] font-bold tracking-wider text-[#ff73df]">SELF-CONTAINED HTML // SANDBOXED PREVIEW</p>}
                <div className="mt-2 flex items-center justify-between"><label className="flex items-center gap-2 text-[10px] text-[#777186]"><input type="checkbox" checked={autoRun} onChange={(event) => setAutoRun(event.target.checked)} className="accent-[#c6ff00]" />AUTO-RUN 1400MS</label>{activeContentType === 'animation' && <button onClick={() => setShowCheatsheet((value) => !value)} className="text-[10px] font-bold text-[#48f7ff]">{showCheatsheet ? 'HIDE' : 'CHEATSHEET'}</button>}</div>
                {activeContentType === 'animation' && showCheatsheet && <pre className="nf-scroll mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-[#070710] p-2 text-[9px] leading-4 text-[#8f89a0]">{LANGUAGE_SPEC}</pre>}
              </div>
            </div>
          )}
        </section>

        <section className={`${mobileTab === 'preview' ? 'flex' : 'hidden'} relative min-h-0 flex-1 flex-col bg-[#050711] md:flex`}>
          <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-[#30274a] bg-[#0a0a13] p-2 md:hidden">
            <button type="button" onClick={() => runSource(code, sceneName)} className="nf-touch flex items-center justify-center gap-1 rounded-md bg-[#c6ff00] px-2 font-black text-[#080812]"><Play className="h-4 w-4 fill-current" />RUN</button>
            <button type="button" onClick={stopScene} className="nf-touch flex items-center justify-center gap-1 rounded-md border border-[#ff2bd6] bg-[#171522] px-2 font-black text-white"><Square className="h-4 w-4" />STOP</button>
            <button type="button" onClick={() => { setCopiedExportSection(null); setShowExport(true); }} className="nf-touch flex items-center justify-center gap-1 rounded-md border border-[#39ff14] bg-[#39ff14]/10 px-2 font-black text-[#8dff7a]"><Download className="h-4 w-4" />EXPORT</button>
          </div>
          {interpretation && (
            <div className="shrink-0 border-b border-[#48f7ff]/30 bg-[#07101a] px-3 py-2">
              <span className="text-[9px] font-black uppercase tracking-[.22em] text-[#8dfaff]">Interpreted as </span>
              <span className="text-[11px] italic text-[#bfeeff]">{interpretation}</span>
            </div>
          )}
          <div data-neoflash-preview="true" className={`${isBlankCanvas ? 'bg-black' : 'nf-grid'} relative min-h-0 flex-1 overflow-hidden`}>
            {activeContentType === 'animation'
              ? <NeoFlashCanvas scene={activeScene} running={running} runKey={runKey} onFps={setFps} onSymbolClick={handleLayoutCta} clickableSymbolIds={LAYOUT_CTA_IDS} />
              : <iframe key={runKey} srcDoc={running ? activeHtml : ''} sandbox="allow-scripts" title={activeContentType === 'game' ? 'Game preview' : 'Web component preview'} className="h-full w-full border-0" style={{ width: '100%', height: '100%', border: 'none' }} />}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-[#30274a] bg-[#070811] px-3 py-1.5 text-[9px] font-bold tracking-wider">
            <span className="text-[#48f7ff]">{running ? (activeContentType === 'animation' ? `${fps} FPS` : 'RUNNING') : 'STOPPED'}</span>
            {activeContentType === 'animation' ? <><span className="text-[#c6ff00]">{objectCount} OBJECTS</span><span className="text-[#ff73df]">SVG</span></> : <span className="text-[#ff73df]">{activeContentType === 'game' ? 'GAME' : 'WEB COMPONENT'} · HTML</span>}
            <span className="ml-auto text-[#777c91]">{activeContentType === 'animation' ? '1280 × 720 // BROWSER NATIVE' : 'SANDBOXED // RESPONSIVE'}</span>
          </div>
          <div className="hidden border-t border-[#30274a] bg-[#0a0a13] px-3 py-2 md:block">
            <div className="flex items-center gap-2 text-[10px]"><Terminal className="h-3.5 w-3.5 text-[#48f7ff]" /><span className="font-bold text-[#b8b2c6]">CONSOLE</span>{feedback && <span className="ml-auto flex items-center gap-1 text-[#ff8a78]"><AlertTriangle className="h-3 w-3" />{feedback}</span>}</div>
            <div className="nf-scroll mt-1 max-h-12 overflow-auto text-[10px] leading-4 text-[#777186]">{consoleLines.map((line, index) => <p key={`${line}-${index}`} className={line.startsWith('!') ? 'text-[#ff8a78]' : line.startsWith('✓') ? 'text-[#8df7a5]' : ''}>{line}</p>)}</div>
          </div>
        </section>
      </main>

      {showExport && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 p-2 backdrop-blur-sm sm:p-4" onMouseDown={() => setShowExport(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="neoflash-export-title" className="nf-scroll flex max-h-[96vh] w-full max-w-3xl flex-col overflow-y-auto rounded-lg border border-[#39ff14] bg-[#0a0a0a] shadow-[0_0_42px_rgba(57,255,20,.2),0_0_80px_rgba(255,0,255,.08)] sm:max-h-[92vh]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center border-b border-[#39ff14]/40 bg-[#0a0a0a]/95 px-4 py-3 backdrop-blur sm:px-5">
              <Code2 className="mr-2 h-4 w-4 text-[#39ff14]" />
              <div>
                <h2 id="neoflash-export-title" className="text-sm font-black tracking-[.16em] text-white">EXPORT // EMBED</h2>
                <p className="mt-0.5 text-[9px] tracking-wider text-[#ff73df]">TAKE YOUR SCENE TO THE WEB</p>
              </div>
              <button onClick={() => setShowExport(false)} className="ml-auto rounded border border-[#3d3347] p-1.5 text-[#91899d] hover:border-[#ff00ff] hover:text-white" aria-label="Close export modal"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-5 p-4 sm:p-5">
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-black tracking-[.18em] text-[#39ff14]">A // YOUR {activeContentType === 'animation' ? 'NEOFLASH' : 'HTML'} CODE</p><p className="mt-1 text-[10px] text-[#756e81]">The current source from your editor.</p></div>
                  <button onClick={() => void copyExportText(code, 'source')} className="min-w-[72px] rounded border border-[#39ff14]/60 bg-[#39ff14]/10 px-3 py-1.5 text-[10px] font-black text-[#8dff7a] hover:bg-[#39ff14]/20">{copiedExportSection === 'source' ? '✓ COPIED' : 'COPY'}</button>
                </div>
                <textarea readOnly value={code} spellCheck={false} aria-label="Current creation source code" className="nf-scroll nf-mobile-input h-36 w-full resize-none rounded-md border border-[#30283a] bg-[#050505] p-3 font-mono text-base leading-5 text-[#d8ffd1] outline-none focus:border-[#39ff14] sm:h-44 md:text-[11px]" />
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-black tracking-[.18em] text-[#ff00ff]">B // EMBED ON YOUR SITE</p><p className="mt-1 text-[10px] text-[#756e81]">Paste this HTML wherever you want the scene to appear.</p></div>
                  <button onClick={() => void copyExportText(embedSnippet, 'embed')} className="min-w-[72px] rounded border border-[#ff00ff]/60 bg-[#ff00ff]/10 px-3 py-1.5 text-[10px] font-black text-[#ff73df] hover:bg-[#ff00ff]/20">{copiedExportSection === 'embed' ? '✓ COPIED' : 'COPY'}</button>
                </div>
                <textarea readOnly value={embedSnippet} spellCheck={false} aria-label="NeoFlash HTML embed snippet" className="nf-scroll nf-mobile-input h-44 w-full resize-none rounded-md border border-[#3b223c] bg-[#050505] p-3 font-mono text-base leading-5 text-[#ffd5fb] outline-none focus:border-[#ff00ff] sm:h-52 md:text-[11px]" />
                <p className="mt-2 text-[10px] italic leading-4 text-[#91899d]">The runtime is ~30KB, no dependencies, no plugin required. Drop it anywhere.</p>
              </section>

              <section className="border-t border-[#30283a] pt-4">
                <p className="mb-2 text-[10px] font-black tracking-[.18em] text-[#48f7ff]">C // DOWNLOAD</p>
                <div className="grid gap-2 sm:flex">
                  {activeContentType === 'animation' && <button onClick={() => downloadScene('svg')} className="nf-touch w-full rounded-md border border-[#ff2bd6] bg-[#ff2bd6]/10 px-4 py-3 text-xs font-black tracking-wider text-[#ff8ae5] hover:bg-[#ff2bd6]/20 sm:w-auto">DOWNLOAD .SVG</button>}
                  <button onClick={() => downloadScene('source')} className="nf-touch w-full rounded-md border border-[#48f7ff] bg-[#48f7ff]/10 px-4 py-3 text-xs font-black tracking-wider text-[#8dfaff] shadow-[0_0_18px_rgba(72,247,255,.08)] hover:bg-[#48f7ff]/20 sm:w-auto">DOWNLOAD .{activeContentType === 'animation' ? 'NEOFLASH' : 'HTML'}</button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {showCatalog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#03040a]/85 p-4 backdrop-blur-sm">
          <div className="flex h-[88%] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#8b00ff] bg-[#0b0913] shadow-[0_0_50px_rgba(139,0,255,.25)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[#342052] px-4 py-3">
              <Boxes className="h-5 w-5 text-[#a56bff]" /><div><h2 className="text-sm font-black tracking-[.16em] text-white">SYMBOL LIBRARY</h2><p className="text-[10px] text-[#8f80a6]">{SYMBOL_CATALOG.length} objects available · click to insert</p></div>
              <label className="ml-auto flex min-w-[220px] items-center gap-2 rounded-md border border-[#39314d] bg-[#11111d] px-3 py-2 focus-within:border-[#48f7ff]"><Search className="h-3.5 w-3.5 text-[#6f6680]" /><input autoFocus value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search symbols..." className="nf-mobile-input w-full bg-transparent text-base text-white outline-none placeholder:text-[#5f596d] md:text-xs" /></label>
              <button onClick={() => setShowCatalog(false)} className="rounded p-1.5 text-[#817a95] hover:bg-[#211c31] hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="nf-scroll min-h-0 flex-1 overflow-y-auto p-4">
              {catalogGroups.length ? catalogGroups.map(({ category, items }) => <section key={category} className="mb-6"><div className="mb-2 flex items-center gap-2"><h3 className="text-[10px] font-black uppercase tracking-[.24em] text-[#48f7ff]">{category}</h3><span className="h-px flex-1 bg-gradient-to-r from-[#48f7ff]/30 to-transparent" /><span className="text-[9px] text-[#62586f]">{items.length}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{items.map((item) => <button key={item.name} onClick={() => insertCatalogObject(item.example)} className="group overflow-hidden rounded-lg border border-[#2e2740] bg-[#11101c] text-left transition hover:-translate-y-0.5 hover:border-[#ff2bd6] hover:shadow-[0_0_18px_rgba(255,0,255,.16)]"><div className="h-[84px] overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,0,255,.15),transparent_70%)] p-2"><NeoFlashSymbolPreview name={item.name} /></div><div className="border-t border-[#292238] p-2"><p className="text-xs font-black text-white group-hover:text-[#ff73df]">{item.name}</p><code className="mt-1 block truncate text-[8px] text-[#7f7690]">{item.example}</code></div></button>)}</div></section>) : <div className="py-20 text-center"><Search className="mx-auto h-8 w-8 text-[#4b4059]" /><p className="mt-3 text-sm font-bold text-[#817a95]">No symbols found</p></div>}
            </div>
          </div>
        </div>
      )}

      {showLoad && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#03040a]/80 p-4 backdrop-blur-sm">
          <div className="flex max-h-[78%] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#4a405f] bg-[#10101b] shadow-2xl">
            <div className="flex items-center border-b border-[#30274a] px-4 py-3"><FolderOpen className="mr-2 h-4 w-4 text-[#48f7ff]" /><h2 className="text-sm font-black tracking-wider">LOAD SCENE</h2><button onClick={() => setShowLoad(false)} className="ml-auto rounded p-1 text-[#817a95] hover:bg-[#211c31] hover:text-white"><X className="h-4 w-4" /></button></div>
            <div className="nf-scroll min-h-0 overflow-y-auto p-3">
              {scenesLoading ? <div className="flex items-center justify-center gap-2 py-12 text-xs text-[#817a95]"><Loader2 className="h-4 w-4 animate-spin" />Loading scenes…</div> : scenesError ? <p className="py-10 text-center text-xs text-[#ff8a78]">Could not load scenes: {scenesError.message}</p> : !savedScenes?.length ? <div className="py-12 text-center"><p className="text-sm font-bold">NO SAVED SCENES YET</p><p className="mt-2 text-xs text-[#817a95]">Run something electric, then hit Save.</p></div> : <div className="space-y-2">{savedScenes.map((scene) => <button key={scene.id} onClick={() => loadScene(scene)} className="group flex w-full items-center gap-3 rounded-lg border border-[#2d283b] bg-[#141320] p-3 text-left hover:border-[#48f7ff]"><span className="flex h-9 w-9 items-center justify-center rounded bg-[#48f7ff]/10 text-[#48f7ff]"><Play className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{scene.name}</span><span className="mt-1 block text-[9px] text-[#777186]">{scene.mode.toUpperCase()} · {displayDate(scene.updated_at || scene.created_at)}</span></span><Check className="h-4 w-4 text-[#302a40] group-hover:text-[#c6ff00]" /></button>)}</div>}
            </div>
          </div>
        </div>
      )}

      <button onClick={() => { setDescription(''); setInterpretation(''); setCode(HIGHWAY_BAR); setSceneName('Highway Bar'); setSceneId(null); setMode('demos'); setDemoCategory('animations'); setActiveDemoName('Highway Bar'); setMobileTab('preview'); runSource(HIGHWAY_BAR, 'Highway Bar'); }} className="absolute bottom-20 left-3 hidden items-center gap-1 rounded border border-[#30274a] bg-[#0b0b15]/90 px-2 py-1 text-[9px] text-[#777186] hover:text-white lg:flex" title="Reset to Highway Bar"><RotateCcw className="h-3 w-3" />RESET</button>
    </div>
  );
}
