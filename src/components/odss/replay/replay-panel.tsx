'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useODSS } from '@/hooks/use-odss';
import { useToast } from '@/hooks/use-toast';
import { Play, Square, FlaskConical, History, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ReplayValidationPanel() {
  const { recording, startRecording, stopRecording, listSessions, validateSession } = useODSS();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);
  const [report, setReport] = useState<any | null>(null);
  const [recordTimer, setRecordTimer] = useState(0);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Timer for recording duration
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
      toast({ title: 'Recording started', description: 'Every tick and scan is being captured for replay.' });
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
        toast({ title: 'Validation report generated', description: `${res.report.enterOutcomes.winRate} ENTER win rate` });
      } else {
        toast({ title: 'Validation failed', description: res.error, variant: 'destructive' });
      }
    } finally {
      setValidating(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Recording control */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-violet-500" /> Replay & Validation</span>
            {recording && (
              <Badge variant="default" className="gap-1 bg-rose-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> REC {formatTime(recordTimer)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border bg-slate-50/50 p-3 text-xs text-slate-600">
            <strong className="text-slate-800">Milestone 2 — Validation.</strong> Record a market session, then generate a validation report to measure decision quality. The report shows ENTER win rate, decision stability, and per-engine contribution — telling you which rules actually work.
          </div>

          <div className="flex gap-2">
            {!recording ? (
              <Button onClick={handleStart} className="flex-1">
                <Play className="mr-2 h-4 w-4" /> Start Recording
              </Button>
            ) : (
              <Button onClick={handleStop} variant="destructive" className="flex-1">
                <Square className="mr-2 h-4 w-4" /> Stop Recording
              </Button>
            )}
            <Button variant="outline" onClick={loadSessions} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sessions list */}
      {sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recorded Sessions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-[10px] uppercase text-slate-400">
                    <th className="px-2 py-1.5">Session</th>
                    <th className="px-2 py-1.5">Ticks</th>
                    <th className="px-2 py-1.5">Scans</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-slate-700 truncate max-w-[160px]">{s.name}</div>
                        <div className="text-[9px] text-slate-400">{new Date(s.startTime).toLocaleString('en-IN')}</div>
                      </td>
                      <td className="px-2 py-1.5 font-mono">{s.tickCount}</td>
                      <td className="px-2 py-1.5 font-mono">{s.scanCount}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant={s.status === 'COMPLETE' ? 'default' : 'secondary'} className="text-[9px]">
                          {s.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px]"
                          onClick={() => handleValidate(s.id)}
                          disabled={validating === s.id || s.status !== 'COMPLETE'}
                        >
                          {validating === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Validate'}
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

      {/* Validation Report */}
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
    <Card className="border-2 border-violet-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-violet-500" /> Validation Report
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
          <div className="mb-1 text-[10px] font-medium uppercase text-slate-400">Decision Distribution</div>
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="ENTER" value={decisions.ENTER || 0} color="text-emerald-600" />
            <StatCard label="WAIT" value={decisions.WAIT || 0} color="text-amber-600" />
            <StatCard label="WATCH" value={decisions.WATCH || 0} color="text-sky-600" />
            <StatCard label="AVOID" value={decisions.AVOID || 0} color="text-rose-600" />
          </div>
        </div>

        {/* ENTER outcomes */}
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase text-slate-400">ENTER Decision Outcomes</div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Win Rate" value={enterOutcomes.winRate || '0%'} color="text-emerald-600" icon={CheckCircle2} />
            <StatCard label="Loss Rate" value={enterOutcomes.lossRate || '0%'} color="text-rose-600" icon={XCircle} />
            <StatCard label="Avg R" value={enterOutcomes.avgRMultiple || '0R'} color="text-violet-600" />
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            {enterOutcomes.wins || 0} wins / {enterOutcomes.losses || 0} losses / {enterOutcomes.total || 0} total ENTER decisions
          </div>
        </div>

        {/* Decision stability */}
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase text-slate-400">Decision Stability</div>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Avg Stability" value={stability.avgStability || '100%'} color="text-slate-700" />
            <StatCard label="Flip Count" value={stability.flipCount || 0} color="text-amber-600" />
          </div>
        </div>

        {/* Engine contribution */}
        {Object.keys(engineContrib).length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase text-slate-400">Engine Contribution (ENTER win rate by engine)</div>
            <div className="space-y-1">
              {Object.entries(engineContrib)
                .sort(([, a]: any, [, b]: any) => b.winRate - a.winRate)
                .map(([engine, stat]: any) => (
                  <div key={engine} className="flex items-center gap-2">
                    <span className="w-28 text-xs text-slate-600">{engine}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={stat.winRate > 50 ? 'h-full bg-emerald-500' : 'h-full bg-rose-500'}
                        style={{ width: `${stat.winRate}%` }}
                      />
                    </div>
                    <span className="w-20 text-right font-mono text-xs">
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
            <div className="mb-1 text-[10px] font-medium uppercase text-slate-400">Market Regimes During Session</div>
            <div className="flex flex-wrap gap-1">
              {regimeHistory.map((r: any, i: number) => (
                <Badge key={i} variant="outline" className="text-[9px]">
                  {r.regime} ({r.startTick}-{r.endTick})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="rounded-lg border bg-violet-50/30 p-2 text-xs">
          <div className="text-[10px] font-medium uppercase text-violet-600">Summary</div>
          <div className="mt-1 text-slate-700">
            <strong>Best opportunity:</strong> {report.bestOpportunity || 'N/A'}
          </div>
          <div className="text-slate-700">
            <strong>Worst decisions:</strong> {report.worstDecision || 'N/A'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border p-2 text-center">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function StatCard({ label, value, color, icon: Icon }: { label: string; value: any; color: string; icon?: any }) {
  return (
    <div className="rounded border p-2 text-center">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className={`font-mono text-sm font-bold ${color}`}>
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
