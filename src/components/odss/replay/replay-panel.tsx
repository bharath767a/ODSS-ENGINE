'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useODSS } from '@/hooks/use-odss';
import { useToast } from '@/hooks/use-toast';
import { Play, Square, FlaskConical, History, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function ReplayValidationPanel() {
  const { recording, startRecording, stopRecording, listSessions, validateSession } = useODSS();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [report, setReport] = useState<any | null>(null);
  const [recordTimer, setRecordTimer] = useState(0);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (recording) {
      const interval = setInterval(() => setRecordTimer((t) => t + 1), 1000);
      return () => clearInterval(interval);
    } else {
      setRecordTimer(0);
    }
  }, [recording]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = await listSessions();
      if (res.ok) setSessions(res.sessions ?? []);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    const res = await startRecording(`Validation Session ${new Date().toLocaleString('en-IN')}`);
    if (res.ok) {
      toast({
        title: 'Recording started',
        description: 'Every tick and scan is being captured for replay.',
      });
    } else {
      toast({ title: 'Failed to start', description: res.error, variant: 'destructive' });
    }
  };

  const handleStop = async () => {
    const res = await stopRecording();
    if (res.ok) {
      toast({
        title: 'Recording stopped',
        description: `Captured ${res.tickCount} ticks and ${res.scanCount} scans.`,
      });
      loadSessions();
    } else {
      toast({ title: 'Failed to stop', description: res.error, variant: 'destructive' });
    }
  };

  const handleValidate = async (sessionId: string) => {
    setValidating(sessionId);
    setReport(null);
    try {
      const res = await validateSession(sessionId);
      if (res.ok && res.report) {
        setReport(res.report);
        toast({
          title: 'Validation report generated',
          description: `${res.report.enterOutcomes.winRate} ENTER win rate`,
        });
      } else {
        toast({ title: 'Validation failed', description: res.error, variant: 'destructive' });
      }
    } finally {
      setValidating(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Recording control */}
      <Card className="border-ai/30 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-mono tracking-wide text-muted-foreground">
              <FlaskConical className="h-4 w-4 text-ai" />
              <span className="text-foreground">REPLAY &amp; VALIDATION</span>
            </span>
            {recording && (
              <Badge
                variant="default"
                className="gap-1 border-bear/40 bg-bear/20 font-mono text-[10px] tracking-widest text-bear glow-bear"
              >
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-bear" /> REC{' '}
                {formatTime(recordTimer)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Milestone 2 — Validation.</strong> Record a market
            session, then generate a validation report to measure decision quality. The report shows
            ENTER win rate, decision stability, and per-engine contribution — telling you which
            rules actually work.
          </div>

          <div className="flex gap-2">
            {!recording ? (
              <Button
                onClick={handleStart}
                className="flex-1 border-bull/40 bg-bull/20 font-mono text-[11px] tracking-widest text-bull hover:bg-bull/30 hover:text-bull"
                variant="outline"
              >
                <Play className="mr-2 h-3.5 w-3.5" /> START RECORDING
              </Button>
            ) : (
              <Button
                onClick={handleStop}
                variant="destructive"
                className="flex-1 border-bear/40 bg-bear/30 font-mono text-[11px] tracking-widest text-bear hover:bg-bear/40 hover:text-bear"
              >
                <Square className="mr-2 h-3.5 w-3.5" /> STOP RECORDING
              </Button>
            )}
            <Button
              variant="outline"
              onClick={loadSessions}
              disabled={loading}
              className="border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <History className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sessions list */}
      {sessions.length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm tracking-wide text-foreground">
              RECORDED SESSIONS
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                  <tr className="border-b border-border/60 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="px-2 py-1.5">Session</th>
                    <th className="px-2 py-1.5 text-right">Ticks</th>
                    <th className="px-2 py-1.5 text-right">Scans</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="font-mono tnum">
                  {sessions.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-border/30 transition-colors hover:bg-bull/5"
                    >
                      <td className="px-2 py-1.5">
                        <div className="max-w-[160px] truncate font-sans text-foreground">
                          {s.name}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {new Date(s.startTime).toLocaleString('en-IN')}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right text-foreground/80">{s.tickCount}</td>
                      <td className="px-2 py-1.5 text-right text-foreground/80">{s.scanCount}</td>
                      <td className="px-2 py-1.5">
                        <Badge
                          variant={s.status === 'COMPLETE' ? 'default' : 'secondary'}
                          className={cn(
                            'font-mono text-[9px] tracking-widest',
                            s.status === 'COMPLETE'
                              ? 'border-bull/40 bg-bull/15 text-bull'
                              : 'border-border bg-muted/40 text-muted-foreground'
                          )}
                        >
                          {s.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 border-ai/40 bg-ai/10 font-mono text-[10px] tracking-widest text-ai hover:bg-ai/20 hover:text-ai"
                          onClick={() => handleValidate(s.id)}
                          disabled={validating === s.id || s.status !== 'COMPLETE'}
                        >
                          {validating === s.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'VALIDATE'
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {report && <ValidationReportCard report={report} />}
    </div>
  );
}

function ValidationReportCard({ report }: { report: any }) {
  const decisions = report.decisions || {};
  const engineContrib = report.engineContribution || {};
  const enterOutcomes = report.enterOutcomes || {};
  const stability = report.stability || {};
  const regimeHistory = report.regimeHistory || [];

  return (
    <Card className="border-ai/40 bg-card/50 backdrop-blur-sm glow-ai">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 font-mono text-sm tracking-wide text-foreground">
          <FlaskConical className="h-4 w-4 text-ai" /> VALIDATION REPORT
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Session info */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Metric label="Ticks" value={report.tickCount} />
          <Metric label="Scans" value={report.scanCount} />
          <Metric label="Duration" value={formatDuration(report.duration)} />
        </div>

        {/* Decision distribution */}
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Decision Distribution
          </div>
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="ENTER" value={decisions.ENTER || 0} color="text-bull" />
            <StatCard label="WAIT" value={decisions.WAIT || 0} color="text-warn" />
            <StatCard label="WATCH" value={decisions.WATCH || 0} color="text-info" />
            <StatCard label="AVOID" value={decisions.AVOID || 0} color="text-bear" />
          </div>
        </div>

        {/* ENTER outcomes */}
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            ENTER Decision Outcomes
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="Win Rate"
              value={enterOutcomes.winRate || '0%'}
              color="text-bull"
              icon={CheckCircle2}
            />
            <StatCard
              label="Loss Rate"
              value={enterOutcomes.lossRate || '0%'}
              color="text-bear"
              icon={XCircle}
            />
            <StatCard
              label="Avg R"
              value={enterOutcomes.avgRMultiple || '0R'}
              color="text-ai"
            />
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            {enterOutcomes.wins || 0} wins / {enterOutcomes.losses || 0} losses /{' '}
            {enterOutcomes.total || 0} total ENTER decisions
          </div>
        </div>

        {/* Decision stability */}
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Decision Stability
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Avg Stability"
              value={stability.avgStability || '100%'}
              color="text-foreground"
            />
            <StatCard
              label="Flip Count"
              value={stability.flipCount || 0}
              color="text-warn"
            />
          </div>
        </div>

        {/* Engine contribution */}
        {Object.keys(engineContrib).length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Engine Contribution (ENTER win rate by engine)
            </div>
            <div className="space-y-1">
              {Object.entries(engineContrib)
                .sort(([, a]: any, [, b]: any) => b.winRate - a.winRate)
                .map(([engine, stat]: any) => (
                  <div key={engine} className="flex items-center gap-2">
                    <span className="w-28 font-mono text-[11px] text-foreground/80">{engine}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full transition-all duration-500',
                          stat.winRate > 50
                            ? 'bg-bull shadow-[0_0_6px_rgba(52,211,153,0.55)]'
                            : 'bg-bear shadow-[0_0_6px_rgba(251,113,133,0.55)]'
                        )}
                        style={{ width: `${stat.winRate}%` }}
                      />
                    </div>
                    <span className="w-20 text-right font-mono text-[11px] tnum text-muted-foreground">
                      {stat.winRate.toFixed(0)}% ({stat.totalEnters})
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Regime history */}
        {regimeHistory.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Market Regimes During Session
            </div>
            <div className="flex flex-wrap gap-1">
              {regimeHistory.map((r: any, i: number) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="border-border/60 bg-muted/40 font-mono text-[9px] tracking-widest text-muted-foreground"
                >
                  {r.regime} ({r.startTick}-{r.endTick})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="rounded-lg border border-ai/40 bg-ai/10 p-2 text-xs backdrop-blur-sm">
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-ai">
            ▸ Summary
          </div>
          <div className="mt-1 text-foreground/80">
            <strong>Best opportunity:</strong> {report.bestOpportunity || 'N/A'}
          </div>
          <div className="text-foreground/80">
            <strong>Worst decisions:</strong> {report.worstDecision || 'N/A'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border border-border/60 bg-muted/30 p-2 text-center">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm font-semibold tnum text-foreground">{value}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: any;
  color: string;
  icon?: any;
}) {
  return (
    <div className="rounded border border-border/60 bg-muted/30 p-2 text-center">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={cn('font-mono text-sm font-bold tnum', color)}>
        {Icon && <Icon className="mr-0.5 inline h-3 w-3" />}
        {value}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (!ms) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
