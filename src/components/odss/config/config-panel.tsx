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
    fetch('/api/odss/config')
      .then((r) => r.json())
      .then(setConfig);
  }, []);

  if (!config) {
    return (
      <div className="py-8 text-center font-mono text-sm text-muted-foreground">
        Loading config…
      </div>
    );
  }

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
        toast({
          title: 'Configuration saved',
          description: 'Engine weights and thresholds updated.',
        });
      } else {
        toast({ title: 'Save failed', description: data.error, variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    fetch('/api/odss/config')
      .then((r) => r.json())
      .then(setConfig);
  };

  return (
    <div className="space-y-3">
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
              <Settings className="h-4 w-4 text-info" />
              <span className="text-foreground">ENGINE WEIGHTS</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Sum normalizes to 100%
            </span>
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
              <div className="mb-1 flex justify-between font-mono text-xs">
                <Label className="text-foreground/80">{label}</Label>
                <span className="tnum text-info">
                  {((config as any)[key] * 100).toFixed(0)}%
                </span>
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

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-sm tracking-wide text-foreground">
            RISK SETTINGS
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <ConfigField
            label="Capital (₹)"
            value={config.capital}
            onChange={(v) => update({ capital: v })}
          />
          <ConfigField
            label="Risk per trade (%)"
            value={config.riskPerTradePct}
            step="0.1"
            onChange={(v) => update({ riskPerTradePct: v })}
          />
          <ConfigField
            label="Min RR"
            value={config.minRR}
            step="0.1"
            onChange={(v) => update({ minRR: v })}
          />
          <ConfigField
            label="Lot size"
            value={config.lotSize}
            onChange={(v) => update({ lotSize: v })}
          />
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-sm tracking-wide text-foreground">
            THRESHOLDS
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <ConfigField
            label="Min confidence to ENTER"
            value={config.minConfidenceEnter}
            onChange={(v) => update({ minConfidenceEnter: v })}
          />
          <ConfigField
            label="Min confidence to WAIT"
            value={config.minConfidenceWait}
            onChange={(v) => update({ minConfidenceWait: v })}
          />
          <ConfigField
            label="VIX High threshold"
            value={config.vixHigh}
            step="0.1"
            onChange={(v) => update({ vixHigh: v })}
          />
          <ConfigField
            label="VIX Extreme threshold"
            value={config.vixExtreme}
            step="0.1"
            onChange={(v) => update({ vixExtreme: v })}
          />
          <ConfigField
            label="PCR Bullish"
            value={config.pcrBullish}
            step="0.1"
            onChange={(v) => update({ pcrBullish: v })}
          />
          <ConfigField
            label="PCR Bearish"
            value={config.pcrBearish}
            step="0.1"
            onChange={(v) => update({ pcrBearish: v })}
          />
          <ConfigField
            label="Trail ATR multiple"
            value={config.trailATRMultiple}
            step="0.1"
            onChange={(v) => update({ trailATRMultiple: v })}
          />
          <ConfigField
            label="Scan interval (ms)"
            value={config.scanIntervalMs}
            onChange={(v) => update({ scanIntervalMs: v })}
          />
        </CardContent>
      </Card>

      <Card className="border-ai/30 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-sm tracking-wide text-foreground">AI COACH</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-foreground/80">Enable AI Explanations</Label>
              <p className="font-mono text-[10px] text-muted-foreground">
                Uses LLM to explain engine decisions (Phase 16).
              </p>
            </div>
            <Switch
              checked={config.enableAIExplanation}
              onCheckedChange={(v) => update({ enableAIExplanation: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-warn/30 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-sm tracking-wide text-foreground">
            GUARDRAILS · DISCIPLINE ENFORCEMENT
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <ConfigField
            label="Max trades per day"
            value={config.maxTradesPerDay}
            onChange={(v) => update({ maxTradesPerDay: v })}
          />
          <ConfigField
            label="Max daily loss (%)"
            value={config.maxDailyLossPct}
            step="0.1"
            onChange={(v) => update({ maxDailyLossPct: v })}
          />
          <ConfigField
            label="Profit cap (%)"
            value={config.profitCapPct}
            step="0.1"
            onChange={(v) => update({ profitCapPct: v })}
          />
          <ConfigField
            label="No entry X min before close"
            value={config.noEntryAfterMinutes}
            onChange={(v) => update({ noEntryAfterMinutes: v })}
          />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          onClick={save}
          disabled={saving}
          className="border-bull/40 bg-bull/20 font-mono text-[11px] tracking-widest text-bull hover:bg-bull/30 hover:text-bull"
          variant="outline"
        >
          <Save className="mr-2 h-4 w-4" /> {saving ? 'SAVING…' : 'SAVE CONFIGURATION'}
        </Button>
        <Button
          variant="outline"
          onClick={reset}
          className="border-border/60 bg-card/40 font-mono text-[11px] tracking-widest text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="mr-2 h-4 w-4" /> RESET
        </Button>
      </div>
    </div>
  );
}

function ConfigField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="mt-1 border-border/60 bg-muted/30 font-mono text-sm tnum text-foreground focus-visible:border-bull/50 focus-visible:ring-bull/20"
      />
    </div>
  );
}
