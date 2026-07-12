'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Settings, Save, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { ODSSConfig } from '@/lib/odss/config';

export function ConfigPanel() {
  const [config, setConfig] = useState<ODSSConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch('/api/odss/config').then((r) => r.json()).then(setConfig);
  }, []);

  if (!config) return <div className="py-8 text-center text-sm text-slate-400">Loading config…</div>;

  const update = (patch: Partial<ODSSConfig>) => setConfig({ ...config, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/odss/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.ok) {
        setConfig(data.config);
        toast({ title: 'Configuration saved', description: 'Engine weights and thresholds updated.' });
      } else {
        toast({ title: 'Save failed', description: data.error, variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    fetch('/api/odss/config').then((r) => r.json()).then(setConfig);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Settings className="h-4 w-4 text-slate-500" /> Engine Weights</span>
            <span className="text-xs text-slate-400">Sum normalizes to 100%</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: 'weightMarket', label: 'Market' },
            { key: 'weightSector', label: 'Sector' },
            { key: 'weightRS', label: 'Relative Strength' },
            { key: 'weightTechnical', label: 'Technical' },
            { key: 'weightOptionChain', label: 'Option Chain' },
            { key: 'weightRisk', label: 'Risk' },
          ].map(({ key, label }) => (
            <div key={key}>
              <div className="mb-1 flex justify-between text-xs">
                <Label>{label}</Label>
                <span className="font-mono text-slate-500">{((config as any)[key] * 100).toFixed(0)}%</span>
              </div>
              <Slider
                value={[(config as any)[key] * 100]}
                min={0}
                max={50}
                step={1}
                onValueChange={(v) => update({ [key]: v[0] / 100 } as any)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Risk Settings</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Capital (₹)</Label>
            <Input type="number" value={config.capital} onChange={(e) => update({ capital: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Risk per trade (%)</Label>
            <Input type="number" step="0.1" value={config.riskPerTradePct} onChange={(e) => update({ riskPerTradePct: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Min RR</Label>
            <Input type="number" step="0.1" value={config.minRR} onChange={(e) => update({ minRR: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Lot size</Label>
            <Input type="number" value={config.lotSize} onChange={(e) => update({ lotSize: +e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Thresholds</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Min confidence to ENTER</Label>
            <Input type="number" value={config.minConfidenceEnter} onChange={(e) => update({ minConfidenceEnter: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Min confidence to WAIT</Label>
            <Input type="number" value={config.minConfidenceWait} onChange={(e) => update({ minConfidenceWait: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">VIX High threshold</Label>
            <Input type="number" step="0.1" value={config.vixHigh} onChange={(e) => update({ vixHigh: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">VIX Extreme threshold</Label>
            <Input type="number" step="0.1" value={config.vixExtreme} onChange={(e) => update({ vixExtreme: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">PCR Bullish</Label>
            <Input type="number" step="0.1" value={config.pcrBullish} onChange={(e) => update({ pcrBullish: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">PCR Bearish</Label>
            <Input type="number" step="0.1" value={config.pcrBearish} onChange={(e) => update({ pcrBearish: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Trail ATR multiple</Label>
            <Input type="number" step="0.1" value={config.trailATRMultiple} onChange={(e) => update({ trailATRMultiple: +e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Scan interval (ms)</Label>
            <Input type="number" value={config.scanIntervalMs} onChange={(e) => update({ scanIntervalMs: +e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">AI Coach</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable AI Explanations</Label>
              <p className="text-xs text-slate-400">Uses LLM to explain engine decisions (Phase 16).</p>
            </div>
            <Switch checked={config.enableAIExplanation} onCheckedChange={(v) => update({ enableAIExplanation: v })} />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-2 h-4 w-4" /> {saving ? 'Saving…' : 'Save Configuration'}
        </Button>
        <Button variant="outline" onClick={reset}>
          <RotateCcw className="mr-2 h-4 w-4" /> Reset
        </Button>
      </div>
    </div>
  );
}
