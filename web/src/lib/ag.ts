import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AllCommunityModule as AllChartsModule, ModuleRegistry as ChartsRegistry } from 'ag-charts-community';
import { useEffect, useState } from 'react';

// AG Grid Community (MIT) and AG Charts Community (MIT), bundled locally: no CDN, works offline.
ModuleRegistry.registerModules([AllCommunityModule]);
ChartsRegistry.registerModules([AllChartsModule]);

// Grid theme driven by our CSS variables, so it follows light/dark automatically.
export const gridTheme = themeQuartz.withParams({
  fontFamily: 'inherit', backgroundColor: 'var(--card)', foregroundColor: 'var(--ink)', headerBackgroundColor: 'var(--bg)',
  borderColor: 'var(--line)', accentColor: '#2563eb', rowHoverColor: 'var(--brand-soft)',
});

// Charts take a named theme, so track the <html class="dark"> toggle.
export function useChartTheme(): 'ag-default' | 'ag-default-dark' {
  const read = (): 'ag-default' | 'ag-default-dark' => (document.documentElement.classList.contains('dark') ? 'ag-default-dark' : 'ag-default');
  const [t, setT] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setT(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return t;
}
