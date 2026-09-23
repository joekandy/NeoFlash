import { useState } from 'react';
import {
  CITY_RAIN,
  HIGHWAY_BAR,
  PERSON_EMOTIONS,
  PONG,
} from '../apps/SceneLog/neoflashEngine';

export type ThemeKey = 'cyberpunk' | 'minimal' | 'retro' | 'space';

export interface ThemeDemo {
  label: string;
  scene: string;
}

export interface NeoFlashTheme {
  label: string;
  glyph: string;
  heroScene: string;
  demoScenes: readonly ThemeDemo[];
  cssVars: Record<`--nf-${string}`, string>;
  accentColor: string;
  bgColor: string;
  textColor: string;
  cardStyle: 'neon' | 'editorial' | 'pixel' | 'glass';
}

const MINIMAL_HERO = `# Minimal geometric hero
stage 1280 720 #F8F9FA
symbol ringLarge GeometricCircle 790 145 scale=2.2 color=#4A9EFF fillColor=transparent
symbol ringSmall GeometricCircle 1040 395 scale=.8 color=#111111 fillColor=transparent
symbol axisA GeometricLine 700 550 scale=1 color=#111111 width=360
symbol axisB GeometricLine 900 95 scale=.7 color=#4A9EFF width=260
circle pointA 1130 170 12 #4A9EFF
circle pointB 730 510 7 #111111
every 3s scale ringLarge from=.96 to=1.04
every 2.4s fade pointA from=.25 to=1
on click ringLarge toggle
on click ringSmall toggle`;

const MINIMAL_ORBITS = `# Minimal orbital study
stage 1280 720 #f0f0f0
symbol ringA GeometricCircle 280 170 scale=2.5 color=#111318
symbol ringB GeometricCircle 720 255 scale=1.35 color=#0057b8
symbol lineA GeometricLine 180 570 color=#0057b8 width=820
circle nodeA 455 435 18 #111318
circle nodeB 920 200 10 #0057b8
every 3.6s scale ringA from=.95 to=1.03
every 2s fade nodeB from=.35 to=1
on click ringA toggle
on click ringB toggle`;

const MINIMAL_GRID = `# Minimal moving grid
stage 1280 720 #f0f0f0
line gridA 120 170 1160 170 #C3CAD4 3
line gridB 120 360 1160 360 #C3CAD4 3
line gridC 120 550 1160 550 #C3CAD4 3
symbol markerA GeometricCircle 210 225 scale=.8 color=#0057b8
symbol markerB GeometricCircle 785 395 scale=1.15 color=#111318
symbol measure GeometricLine 430 280 color=#111318 width=350
every 4s move markerA fromX=210 toX=790 duration=4 alternate=true
on click markerA toggle
on click markerB toggle`;

const MINIMAL_SIGNAL = `# Minimal signal
stage 1280 720 #f0f0f0
symbol signalA GeometricLine 210 260 color=#111318 width=760
symbol signalB GeometricLine 310 390 color=#0057b8 width=560
symbol pulseA GeometricCircle 925 190 scale=1.4 color=#0057b8
circle dotA 210 260 12 #111318
circle dotB 870 390 12 #0057b8
every 2.8s scale pulseA from=.85 to=1.1
every 3.5s move dotA fromX=210 toX=970 duration=3.5 alternate=true
on click pulseA toggle
on click signalB toggle`;

const RETRO_HERO = `# Retro 8-bit hero
stage 1280 720 #000000
rect tile01 0 590 160 130 #00FFFF
rect tile02 160 590 160 130 #111144
rect tile03 320 590 160 130 #FF00FF
rect tile04 480 590 160 130 #111144
rect tile05 640 590 160 130 #00FFFF
rect tile06 800 590 160 130 #111144
rect tile07 960 590 160 130 #FF00FF
rect tile08 1120 590 160 130 #111144
symbol player PixelChar 770 375 scale=1.2 color=#00FFFF altColor=#FFFFFF
symbol rival PixelChar 1030 395 scale=1 color=#FF00FF altColor=#FFFFFF
text score 790 120 "PLAYER_1 // READY" #FFFFFF 30
circle coinA 930 310 12 #FFFFFF
circle coinB 1070 265 12 #00FFFF
every 1s flicker score min=.4 max=1
every 1.6s move coinA fromY=310 toY=270 duration=1.6 alternate=true`;

const RETRO_LEVEL = `# Retro level one
stage 1280 720 #000000
rect groundA 0 590 1280 130 #00FFFF
rect platformA 180 420 250 36 #FF00FF
rect platformB 750 330 290 36 #00FFFF
symbol hero PixelChar 300 270 scale=.9 color=#FFFFFF altColor=#00FFFF
symbol enemy PixelChar 860 180 scale=.9 color=#FF00FF altColor=#FFFFFF
text level 70 90 "LEVEL 01" #FFFFFF 36
every 3s move hero fromX=300 toX=700 duration=3 alternate=true
every .8s flicker enemy min=.35 max=1`;

const RETRO_DUEL = `# Retro player select
stage 1280 720 #080018
rect frame 110 110 1060 500 #111144
symbol playerA PixelChar 330 250 scale=1.4 color=#00FFFF altColor=#FFFFFF
symbol playerB PixelChar 815 250 scale=1.4 color=#FF00FF altColor=#FFFFFF
text versus 565 350 "VS" #FFFFFF 64
text select 405 100 "SELECT PLAYER" #00FFFF 34
every 1.3s scale playerA from=.94 to=1.04
every 1.3s scale playerB from=1.04 to=.94`;

const RETRO_BONUS = `# Retro bonus room
stage 1280 720 #000000
rect floor 0 610 1280 110 #FF00FF
symbol runner PixelChar 140 390 scale=1 color=#00FFFF altColor=#FFFFFF
circle bonusA 520 300 18 #FFFFFF
circle bonusB 760 240 18 #00FFFF
circle bonusC 1010 330 18 #FF00FF
text bonus 430 110 "BONUS STAGE" #FFFFFF 40
every 4s move runner fromX=140 toX=1080 duration=4
every .7s flicker bonusA min=.4 max=1`;

const SPACE_HERO = `# Holographic space hero
stage 1280 720 #050A1A
symbol starsA Star 0 0 scale=1 count=22 color=#FFFFFF
symbol starsB Star 120 35 scale=.7 count=14 color=#8EDBFF
symbol planet Planet 790 165 scale=1.75 color=#4A9EFF ringColor=#B388FF
symbol orbitA GeometricCircle 730 105 scale=2.8 color=#7C5CFF fillColor=transparent
symbol satellite Astronaut 1080 390 scale=.45 color=#FFFFFF
symbol signal Pulse 915 330 scale=.85 color=#8EDBFF
every 4s scale planet from=.97 to=1.03
every 3s move satellite fromY=390 toY=340 duration=3 alternate=true
every 1.8s scale signal from=.7 to=1.2
on click planet toggle
on click satellite toggle
on click signal toggle`;

const SPACE_ORBIT = `# Orbital map
stage 1280 720 #050A1A
symbol stars Star 0 0 count=22 color=#FFFFFF
symbol planetA Planet 260 220 scale=1.4 color=#4A9EFF ringColor=#B388FF
symbol planetB Planet 850 180 scale=.75 color=#B388FF ringColor=#8EDBFF
symbol orbit GeometricCircle 500 170 scale=2.2 color=#8EDBFF
symbol ship Spaceship 540 440 scale=.65 color=#FFFFFF
every 5s move ship fromX=540 toX=900 duration=5 alternate=true
every 3s scale orbit from=.94 to=1.04
on click planetA toggle
on click planetB toggle
on click ship toggle`;

const SPACE_SIGNAL = `# Deep-space signal
stage 1280 720 #030713
symbol stars Star 0 0 count=22 color=#FFFFFF
symbol station SpaceStationPanel 490 235 scale=1.3 color=#8EDBFF
symbol ring Pulse 525 265 scale=1.2 color=#B388FF
symbol antenna Antenna 930 280 scale=.8 color=#8EDBFF
symbol planet Planet 90 400 scale=.65 color=#7C5CFF ringColor=#8EDBFF
every 1.2s flicker station min=.55 max=1
every 1.8s scale ring from=.7 to=1.25
every .8s flicker antenna min=.35 max=1
on click station toggle
on click ring toggle
on click antenna toggle`;

const SPACE_WALK = `# Moon walk
stage 1280 720 #050A1A
symbol stars Star 0 0 count=22 color=#FFFFFF
symbol moon Moon 920 90 scale=1.25 color=#DDEBFF
symbol astronaut Astronaut 500 250 scale=1 color=#FFFFFF
symbol planet Planet 80 100 scale=.7 color=#4A9EFF ringColor=#B388FF
symbol dust Particle 80 440 count=18 color=#8EDBFF
every 3.5s move astronaut fromY=250 toY=210 duration=3.5 alternate=true
every 2.2s rotate astronaut from=-3 to=3
every 4s move dust fromY=440 toY=380 duration=4
on click astronaut toggle
on click moon toggle
on click planet toggle`;

export const THEMES: Record<ThemeKey, NeoFlashTheme> = {
  cyberpunk: {
    label: 'CYBER',
    glyph: '◉',
    heroScene: HIGHWAY_BAR,
    demoScenes: [
      { label: 'Highway Bar', scene: HIGHWAY_BAR },
      { label: 'City Rain', scene: CITY_RAIN },
      { label: 'Person Emotions', scene: PERSON_EMOTIONS },
      { label: 'Pong', scene: PONG },
    ],
    cssVars: {
      '--nf-bg': '#080810',
      '--nf-section-bg': '#070811',
      '--nf-panel': '#0b0b16',
      '--nf-card-bg': '#10101c',
      '--nf-text': '#f5f2ff',
      '--nf-muted': '#aaa4bd',
      '--nf-accent': '#ff2bd6',
      '--nf-accent-2': '#48f7ff',
      '--nf-border': 'rgba(72,247,255,.34)',
      '--nf-font': "'Courier New', 'Lucida Console', monospace",
      '--nf-heading-font': "'Courier New', 'Lucida Console', monospace",
      '--nf-radius': '2px',
      '--nf-shadow': '0 0 34px rgba(255,43,214,.2)',
      '--nf-overlay': 'rgba(8,8,16,.64)',
      '--nf-switcher-bg': 'rgba(5,7,17,.92)',
    },
    accentColor: '#ff2bd6',
    bgColor: '#080810',
    textColor: '#f5f2ff',
    cardStyle: 'neon',
  },
  minimal: {
    label: 'MINIMAL',
    glyph: '◎',
    heroScene: MINIMAL_HERO,
    demoScenes: [
      { label: 'Orbit Study', scene: MINIMAL_ORBITS },
      { label: 'Grid System', scene: MINIMAL_GRID },
      { label: 'Signal Lines', scene: MINIMAL_SIGNAL },
      { label: 'Pure Geometry', scene: MINIMAL_HERO },
    ],
    cssVars: {
      '--nf-bg': '#F8F9FA',
      '--nf-section-bg': '#FFFFFF',
      '--nf-panel': '#FFFFFF',
      '--nf-card-bg': '#FFFFFF',
      '--nf-text': '#111318',
      '--nf-muted': '#68707C',
      '--nf-accent': '#4A9EFF',
      '--nf-accent-2': '#111318',
      '--nf-border': '#DDE2E9',
      '--nf-font': 'Inter, ui-sans-serif, system-ui, sans-serif',
      '--nf-heading-font': 'Inter, ui-sans-serif, system-ui, sans-serif',
      '--nf-radius': '0px',
      '--nf-shadow': '0 18px 50px rgba(17,19,24,.08)',
      '--nf-overlay': 'rgba(248,249,250,.14)',
      '--nf-switcher-bg': 'rgba(255,255,255,.95)',
    },
    accentColor: '#4A9EFF',
    bgColor: '#F8F9FA',
    textColor: '#111318',
    cardStyle: 'editorial',
  },
  retro: {
    label: 'RETRO 8-BIT',
    glyph: '▣',
    heroScene: RETRO_HERO,
    demoScenes: [
      { label: 'Level 01', scene: RETRO_LEVEL },
      { label: 'Player Select', scene: RETRO_DUEL },
      { label: 'Bonus Stage', scene: RETRO_BONUS },
      { label: 'Arcade Hero', scene: RETRO_HERO },
    ],
    cssVars: {
      '--nf-bg': '#000000',
      '--nf-section-bg': '#080018',
      '--nf-panel': '#0A0A20',
      '--nf-card-bg': '#101038',
      '--nf-text': '#FFFFFF',
      '--nf-muted': '#B8B8D8',
      '--nf-accent': '#00FFFF',
      '--nf-accent-2': '#FF00FF',
      '--nf-border': '#00FFFF',
      '--nf-font': "'Courier New', monospace",
      '--nf-heading-font': "'Courier New', monospace",
      '--nf-radius': '0px',
      '--nf-shadow': '8px 8px 0 #FF00FF',
      '--nf-overlay': 'rgba(0,0,0,.32)',
      '--nf-switcher-bg': '#000000',
    },
    accentColor: '#00FFFF',
    bgColor: '#000000',
    textColor: '#FFFFFF',
    cardStyle: 'pixel',
  },
  space: {
    label: 'SPACE',
    glyph: '✦',
    heroScene: SPACE_HERO,
    demoScenes: [
      { label: 'Orbital Map', scene: SPACE_ORBIT },
      { label: 'Deep Signal', scene: SPACE_SIGNAL },
      { label: 'Moon Walk', scene: SPACE_WALK },
      { label: 'Planetfall', scene: SPACE_HERO },
    ],
    cssVars: {
      '--nf-bg': '#050A1A',
      '--nf-section-bg': '#081027',
      '--nf-panel': 'rgba(16,28,62,.58)',
      '--nf-card-bg': 'rgba(18,32,70,.52)',
      '--nf-text': '#F6FAFF',
      '--nf-muted': '#A9B9D8',
      '--nf-accent': '#8EDBFF',
      '--nf-accent-2': '#B388FF',
      '--nf-border': 'rgba(142,219,255,.35)',
      '--nf-font': 'Inter, ui-sans-serif, system-ui, sans-serif',
      '--nf-heading-font': 'Inter, ui-sans-serif, system-ui, sans-serif',
      '--nf-radius': '24px',
      '--nf-shadow': '0 24px 70px rgba(83,91,255,.22)',
      '--nf-overlay': 'rgba(5,10,26,.44)',
      '--nf-switcher-bg': 'rgba(8,16,39,.78)',
    },
    accentColor: '#8EDBFF',
    bgColor: '#050A1A',
    textColor: '#F6FAFF',
    cardStyle: 'glass',
  },
};

export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];
export const THEME_STORAGE_KEY = 'neoflash_theme';

interface ThemeSwitcherProps {
  activeTheme: ThemeKey;
  disabled?: boolean;
  onSelect: (theme: ThemeKey) => void;
}

export default function ThemeSwitcher({ activeTheme, disabled = false, onSelect }: ThemeSwitcherProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={`nf-theme-switcher ${mobileOpen ? 'is-open' : ''}`} aria-label="Choose landing page theme">
      <style>{`
        .nf-theme-switcher { position: fixed; z-index: 90; top: 12px; right: 12px; display: flex; gap: 6px; padding: 6px; border: 1px solid var(--nf-border); border-radius: 999px; background: var(--nf-switcher-bg); box-shadow: var(--nf-shadow); backdrop-filter: blur(18px); }
        .nf-theme-option { min-height: 34px; padding: 0 12px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--nf-muted); font-family: var(--nf-font); font-size: 10px; font-weight: 900; letter-spacing: .08em; white-space: nowrap; transition: color .2s ease, background .2s ease, border-color .2s ease, transform .2s ease; }
        .nf-theme-option:hover { color: var(--nf-text); transform: translateY(-1px); }
        .nf-theme-option[aria-pressed="true"] { color: var(--nf-bg); background: var(--nf-accent); border-color: var(--nf-accent); }
        .nf-theme-gear { display: none; width: 42px; height: 42px; border: 1px solid var(--nf-border); border-radius: 50%; background: var(--nf-switcher-bg); color: var(--nf-accent); font-size: 19px; }
        @media (max-width: 639px) {
          .nf-theme-switcher { top: 8px; right: 8px; display: block; padding: 0; border: 0; background: transparent; box-shadow: none; backdrop-filter: none; }
          .nf-theme-gear { display: grid; width: 44px; height: 44px; place-items: center; margin-left: auto; background: var(--nf-switcher-bg); box-shadow: var(--nf-shadow); backdrop-filter: blur(18px); }
          .nf-theme-options { position: absolute; right: 0; top: 50px; display: none; width: 172px; gap: 6px; padding: 8px; border: 1px solid var(--nf-border); border-radius: max(12px, var(--nf-radius)); background: var(--nf-switcher-bg); box-shadow: var(--nf-shadow); backdrop-filter: blur(18px); }
          .nf-theme-switcher.is-open .nf-theme-options { display: grid; }
          .nf-theme-option { width: 100%; min-height: 40px; border-radius: max(8px, var(--nf-radius)); text-align: left; }
        }
        @media (min-width: 640px) { .nf-theme-options { display: contents; } }
      `}</style>
      <button type="button" className="nf-theme-gear" aria-label="Open theme switcher" aria-expanded={mobileOpen} onClick={() => setMobileOpen((open) => !open)}>⚙</button>
      <div className="nf-theme-options">
        {THEME_KEYS.map((key) => {
          const theme = THEMES[key];
          return (
            <button
              key={key}
              type="button"
              className="nf-theme-option"
              aria-pressed={activeTheme === key}
              disabled={disabled}
              onClick={() => {
                onSelect(key);
                setMobileOpen(false);
              }}
            >
              {theme.glyph} {theme.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
