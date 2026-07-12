'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Save, Trash2, Key, Shield, CheckCircle2, AlertCircle, Loader2, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface CredentialField {
  key: string;
  label: string;
  required: boolean;
  type: 'text' | 'password';
  isSet: boolean;
  maskedValue: string;
}

interface ProviderConfig {
  provider: string;
  fields: CredentialField[];
}

const PROVIDER_LABELS: Record<string, { name: string; icon: any; color: string; desc: string }> = {
  angelone: {
    name: 'Angel One SmartAPI',
    icon: Key,
    color: 'text-bull',
    desc: 'Real-time NSE data + option chains + WebSocket. Recommended primary provider.',
  },
  upstox: {
    name: 'Upstox API v2',
    icon: Key,
    color: 'text-info',
    desc: 'Fallback provider with good historical data access.',
  },
  server: {
    name: 'Server Configuration',
    icon: Server,
    color: 'text-warn',
    desc: 'Server IP must match the IP whitelisted in your Angel One app.',
  },
};

export function CredentialsPanel() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/odss/credentials');
      const data = await res.json();
      setProviders(data.providers ?? []);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const credentials: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (value.trim()) credentials[key] = value.trim();
      }
      const res = await fetch('/api/odss/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({
          title: 'Credentials saved',
          description: 'Restart the market service to apply changes.',
        });
        setValues({});
        loadCredentials();
      } else {
        toast({ title: 'Save failed', description: data.error, variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (provider: string) => {
    if (!confirm(`Clear all ${PROVIDER_LABELS[provider]?.name ?? provider} credentials?`)) return;
    try {
      await fetch(`/api/odss/credentials?provider=${provider}`, { method: 'DELETE' });
      toast({ title: 'Credentials cleared', description: `${provider} credentials removed.` });
      loadCredentials();
    } catch {}
  };

  const toggleVisible = (key: string) => {
    setVisible((v) => ({ ...v, [key]: !v[key] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Security notice */}
      <Card className="accent-bull border-bull/30 bg-bull/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Shield className="h-5 w-5 shrink-0 text-bull" />
          <div className="text-xs">
            <div className="font-semibold text-foreground">Secure Local Storage</div>
            <p className="mt-0.5 text-muted-foreground">
              Credentials are stored in the local <code className="rounded bg-muted px-1 text-foreground">.env</code> file on this server only.
              They are never logged, never sent to any third party, and never leave this machine.
              The NSE provider works with <strong>no credentials</strong> — add Angel One credentials
              only when ready for real-time data.
            </p>
          </div>
        </CardContent>
      </Card>

      {providers.map((provider) => {
        const meta = PROVIDER_LABELS[provider.provider] ?? {
          name: provider.provider,
          icon: Key,
          color: 'text-muted-foreground',
          desc: '',
        };
        const allSet = provider.fields.filter((f) => f.required).every((f) => f.isSet);
        const Icon = meta.icon;

        return (
          <Card key={provider.provider} className={cn('border-border/50 bg-card/50 backdrop-blur-sm', allSet && provider.provider !== 'server' && 'accent-bull')}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Icon className={cn('h-4 w-4', meta.color)} />
                  <span className="font-mono font-bold tracking-wide text-foreground">{meta.name}</span>
                  {allSet ? (
                    <Badge className="gap-1 bg-bull/15 text-bull hover:bg-bull/20">
                      <CheckCircle2 className="h-3 w-3" /> CONFIGURED
                    </Badge>
                  ) : provider.provider === 'server' ? (
                    <Badge variant="secondary" className="text-muted-foreground">INFO</Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1 bg-warn/15 text-warn hover:bg-warn/20">
                      <AlertCircle className="h-3 w-3" /> NOT SET
                    </Badge>
                  )}
                </span>
                {provider.provider !== 'server' && provider.fields.some((f) => f.isSet) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] text-bear hover:bg-bear/10 hover:text-bear"
                    onClick={() => handleClear(provider.provider)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Clear
                  </Button>
                )}
              </CardTitle>
              {meta.desc && <p className="text-xs text-muted-foreground">{meta.desc}</p>}
            </CardHeader>
            <CardContent className="space-y-3">
              {provider.fields.map((field) => (
                <div key={field.key}>
                  <Label className="mb-1 flex items-center justify-between text-xs">
                    <span>
                      {field.label}
                      {field.required && <span className="ml-1 text-bear">*</span>}
                    </span>
                    {field.isSet && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {field.maskedValue}
                      </span>
                    )}
                  </Label>
                  <div className="relative">
                    <Input
                      type={field.type === 'password' && !visible[field.key] ? 'password' : 'text'}
                      placeholder={field.isSet ? '•••••••• (saved)' : `Enter ${field.label}`}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      className="bg-background/60 font-mono text-xs"
                    />
                    {field.type === 'password' && (
                      <button
                        type="button"
                        onClick={() => toggleVisible(field.key)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {visible[field.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* Save button */}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || Object.keys(values).length === 0} className="flex-1">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Credentials'}
        </Button>
      </div>

      {/* Provider status */}
      <ProviderStatusPanel />
    </div>
  );
}

function ProviderStatusPanel() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStatus = () => fetch('/api/odss/providers').then((r) => r.json()).then(setStatus).catch(() => {});
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const statusColor: Record<string, string> = {
    ACTIVE: 'text-bull bg-bull/15 border-bull/40',
    RATE_LIMITED: 'text-warn bg-warn/15 border-warn/40',
    ERROR: 'text-bear bg-bear/15 border-bear/40',
    NOT_CONFIGURED: 'text-muted-foreground bg-muted/40 border-border',
    DISABLED: 'text-muted-foreground bg-muted/40 border-border',
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Server className="h-4 w-4 text-info" />
          <span className="text-gradient-ai font-bold">PROVIDER STATUS</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {(status.providers ?? []).map((p: any) => (
            <div key={p.name} className="flex items-center justify-between rounded border border-border/40 bg-muted/20 p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-foreground">{p.name}</span>
                {p.name === status.preferredProvider && (
                  <Badge className="bg-bull/15 text-bull hover:bg-bull/20">★ ACTIVE</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-muted-foreground">Calls: {p.callCount}</span>
                <span className="text-muted-foreground">Errors: {p.errorCount}</span>
                <span className={cn('rounded border px-2 py-0.5 font-bold', statusColor[p.status] ?? statusColor.DISABLED)}>
                  {p.status}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          The router automatically prefers configured providers and falls back to NSE (free, no credentials) if rate-limited.
        </p>
      </CardContent>
    </Card>
  );
}
