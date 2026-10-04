import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_THEMES,
  classicTheme,
  getTheme,
  horizonTheme,
  mainTheme,
  registerTheme,
  themeNames,
  unregisterTheme,
} from '../src/themes/index.js';
import { mountGrid } from './helpers.js';

describe('the theme registry', () => {
  it('ships main, horizon and classic', () => {
    expect(BUILT_IN_THEMES.map((theme) => theme.name)).toEqual(['main', 'horizon', 'classic']);
    for (const definition of BUILT_IN_THEMES) {
      expect(themeNames()).toContain(definition.name);
      // Both schemes, always: a theme with only a light mode is a theme that
      // breaks the moment someone's system is set to dark.
      expect(Object.keys(definition.light).length).toBeGreaterThan(0);
      expect(Object.keys(definition.dark).length).toBeGreaterThan(0);
    }
  });

  it('returns the same registration rather than a second one', () => {
    expect(registerTheme(mainTheme)).toBe(getTheme('main'));
  });

  it('chains its setters', () => {
    const theme = registerTheme({ name: 'chained', light: { 'accent-color': 'red' }, dark: {} })
      .setColorScheme('dark')
      .setDensityType('compact');
    expect(theme.colorScheme).toBe('dark');
    expect(theme.density).toBe('compact');
    unregisterTheme('chained');
  });

  it('names its classes the way the stylesheet does', () => {
    const theme = registerTheme({ name: 'named', light: {}, dark: {} });
    expect(theme.setColorScheme('light').classNames()).toContain('ht-theme-named');
    expect(theme.setColorScheme('dark').classNames()).toContain('ht-theme-named-dark');
    expect(theme.setColorScheme('auto').classNames()).toContain('ht-theme-named-dark-auto');
    expect(theme.setDensityType('comfortable').classNames()).toContain('cm-density-comfortable');
    unregisterTheme('named');
  });

  it('resolves the properties for a scheme', () => {
    const light = horizonTheme.light['background-color'];
    const dark = horizonTheme.dark['background-color'];
    const theme = getTheme('horizon')!;
    expect(theme.properties('light')['background-color']).toBe(light);
    expect(theme.properties('dark')['background-color']).toBe(dark);
    // The shared values come through in both.
    expect(theme.properties('dark')['cell-vertical-border-color']).toBe('transparent');
  });
});

describe('a themed grid', () => {
  it('puts the theme classes on the root', async () => {
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, themeName: 'horizon' });
    expect(grid.view?.root.classList.contains('ht-theme-horizon')).toBe(true);
    expect(grid.getTheme()?.name).toBe('horizon');
  });

  it('takes a registered theme object as well as a name', async () => {
    const theme = registerTheme(classicTheme).setColorScheme('dark');
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, theme });
    expect(grid.view?.root.classList.contains('ht-theme-classic-dark')).toBe(true);
    expect(grid.view?.root.style.getPropertyValue('--ht-background-color')).toBe(
      classicTheme.dark['background-color'],
    );
    theme.setColorScheme('auto');
  });

  it('writes no properties for `auto`, so the stylesheet decides', async () => {
    const theme = registerTheme(mainTheme).setColorScheme('auto');
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, theme });
    // Inline values would beat the media query they exist to defer to.
    expect(grid.view?.root.style.getPropertyValue('--ht-background-color')).toBe('');
    expect(grid.view?.root.classList.contains('ht-theme-main-dark-auto')).toBe(true);
  });

  it('takes the last theme off before putting the next one on', async () => {
    const peculiar = registerTheme({
      name: 'peculiar',
      light: { 'peculiar-token': 'hotpink' },
      dark: {},
    }).setColorScheme('light');
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, theme: peculiar });
    expect(grid.view?.root.style.getPropertyValue('--ht-peculiar-token')).toBe('hotpink');

    grid.updateSettings({ theme: registerTheme(mainTheme).setColorScheme('light') });
    expect(grid.view?.root.classList.contains('ht-theme-peculiar')).toBe(false);
    // `main` says nothing about it, so the old value must not linger.
    expect(grid.view?.root.style.getPropertyValue('--ht-peculiar-token')).toBe('');
    expect(grid.view?.root.style.getPropertyValue('--ht-background-color')).toBe('#ffffff');
    unregisterTheme('peculiar');
  });

  it('accepts a name nothing was registered under', async () => {
    // A page shipping its own stylesheet under that name is doing something
    // reasonable; the class still goes on.
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, themeName: 'ours' });
    expect(grid.view?.root.classList.contains('ht-theme-ours')).toBe(true);
    unregisterTheme('ours');
  });
});

describe('density', () => {
  it('scales the row height rather than replacing it', async () => {
    const plain = await mountGrid({ startRows: 3, startCols: 3, rowHeights: 40 });
    const compact = await mountGrid({
      startRows: 3,
      startCols: 3,
      rowHeights: 40,
      theme: registerTheme({ name: 'dense', light: {}, dark: {} }).setDensityType('compact'),
    });
    // The caller asked for 40; density scales their choice, it does not
    // discard it.
    expect(plain.grid.getRowHeight(0)).toBe(40);
    expect(compact.grid.getRowHeight(0)).toBe(32);
    unregisterTheme('dense');
  });

  it('makes the header follow too', async () => {
    const theme = registerTheme({ name: 'roomy', light: {}, dark: {} }).setDensityType(
      'comfortable',
    );
    const { grid } = await mountGrid({ startRows: 3, startCols: 3, theme });
    expect(grid.getColHeaderHeight()).toBe(Math.round(23 * 1.25));
    unregisterTheme('roomy');
  });
});
