import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCheckBuilderConnection, useHealthCheck, useStartAndroidBuild, getCheckBuilderConnectionQueryKey, getHealthCheckQueryKey } from '@workspace/api-client-react';
import { Activity, AlertTriangle, ArrowDownToLine, Check, ChevronDown, CircleHelp, Clock3, Code2, ExternalLink, FileArchive, FolderOpen, HardDriveDownload, HeartPulse, Loader2, LockKeyhole, Play, PlugZap, RotateCw, ShieldCheck, Smartphone, Terminal, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient();
const PATH_PATTERN = /^\/(?:storage\/emulated\/0|sdcard)\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9 _.,()@+\-/]+\.zip$/;

const defaultTimeline = [
  { state: 'CONNECTING_TO_TERMUX', label: 'Connect to Termux bridge', status: 'pending' },
  { state: 'ANALYZING', label: 'Inspect ZIP on phone', status: 'pending' },
  { state: 'BUILDING', label: 'Run Android build', status: 'pending' },
  { state: 'VALIDATING_APK', label: 'Validate generated APK', status: 'pending' },
];

function formatBytes(bytes?: number | null) {
  if (bytes == null) return 'Size reported by phone';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value?: string) {
  if (!value) return 'Not checked yet';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function errorDetails(error: unknown) {
  if (!error) return null;
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { error?: string; code?: string; state?: string; diagnostics?: string[]; message?: string };
    return {
      message: candidate.error || candidate.message || 'The builder could not complete this request.',
      code: candidate.code,
      state: candidate.state,
      diagnostics: candidate.diagnostics || [],
    };
  }
  return { message: String(error), diagnostics: [] as string[] };
}

function AppHeader() {
  return (
    <header className="border-b border-border/80 bg-card/75 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-sidebar text-primary shadow-sm">
            <Terminal size={20} strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">ZIP → APK</p>
            <p className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">phone-side controller</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 sm:flex">
          <span className="size-1.5 rounded-full bg-primary pulse-dot" />
          <span className="mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">secure handoff</span>
        </div>
      </div>
    </header>
  );
}

function Workspace() {
  const [zipName, setZipName] = useState('');
  const [androidPath, setAndroidPath] = useState('');
  const [developerMode, setDeveloperMode] = useState(false);
  const [hasCheckedConnection, setHasCheckedConnection] = useState(false);
  const [buildResult, setBuildResult] = useState<Awaited<ReturnType<typeof useStartAndroidBuild>>['data']>(undefined);
  const [buildError, setBuildError] = useState<unknown>(null);

  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 30_000 } });
  const connectionQuery = useCheckBuilderConnection({
    query: { enabled: false, queryKey: getCheckBuilderConnectionQueryKey(), retry: false },
  });
  const buildMutation = useStartAndroidBuild();

  const pathIsValid = PATH_PATTERN.test(androidPath);
  const pathTouched = androidPath.length > 0;
  const connection = connectionQuery.data;
  const connectionError = errorDetails(connectionQuery.error);
  const buildFailure = errorDetails(buildError);
  const timeline = buildResult?.timeline?.length ? buildResult.timeline : defaultTimeline;
  const logs = buildResult?.logs || [];
  const isBuilding = buildMutation.isPending;

  const connectionLabel = useMemo(() => {
    if (connectionQuery.isFetching) return 'Checking bridge';
    if (connection?.connected) return 'Bridge connected';
    if (connectionQuery.isError) return 'Connection unavailable';
    return 'Not checked';
  }, [connection?.connected, connectionQuery.isError, connectionQuery.isFetching]);

  const checkConnection = () => {
    setHasCheckedConnection(true);
    connectionQuery.refetch();
  };

  const startBuild = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pathIsValid || !connection?.connected || isBuilding) return;
    setBuildError(null);
    setBuildResult(undefined);
    buildMutation.mutate(
      { data: { androidZipPath: androidPath, developerMode } },
      {
        onSuccess: (result) => setBuildResult(result),
        onError: (error) => setBuildError(error),
      },
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AppHeader />
      <main className="instrument-grid mx-auto max-w-[1440px] px-4 pb-12 pt-6 sm:px-8 sm:pt-10">
        <section className="rise-in mb-7 grid gap-6 lg:grid-cols-[1.25fr_.75fr] lg:items-end">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <span className="mono text-[10px] font-medium uppercase tracking-[0.2em] text-primary">build workspace / 01</span>
              <span className="h-px w-8 bg-primary/35" />
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl">
              A direct line from your browser to your phone.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Point the controller at a ZIP that already exists on Android. The browser only provides context; the authenticated Termux builder does the real work on your phone.
            </p>
          </div>
          <div className="scanline rounded-2xl border border-border bg-card p-5 shadow-[0_18px_50px_hsl(var(--foreground)/.06)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">controller health</p>
                <p className="mt-2 flex items-center gap-2 text-sm font-medium">
                  <HeartPulse size={16} className={health.isError ? 'text-destructive' : 'text-primary'} />
                  {health.isLoading ? 'Checking API process…' : health.data?.status === 'ok' ? 'API process is ready' : 'API process needs attention'}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 mono text-[10px] uppercase tracking-wider ${health.data?.status === 'ok' ? 'bg-primary/12 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>
                {health.isLoading ? 'polling' : health.data?.status || 'unknown'}
              </span>
            </div>
            <p className="mt-4 border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
              Replit does not upload a file to Android. Select a local ZIP for orientation, then enter its actual phone path below.
            </p>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
          <section className="rise-in-delay space-y-5">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-primary">
                    <PlugZap size={18} />
                    <span className="mono text-[10px] uppercase tracking-[0.16em]">01 / establish trust</span>
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight">Builder connection</h2>
                  <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">Initialize the authenticated MCP bridge and verify the tools available on your Android session.</p>
                </div>
                <div className={`hidden size-11 items-center justify-center rounded-xl sm:flex ${connection?.connected ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {connection?.connected ? <ShieldCheck size={21} /> : <LockKeyhole size={20} />}
                </div>
              </div>
              <div className={`flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${connection?.connected ? 'border-primary/35 bg-primary/[.06]' : connectionQuery.isError ? 'border-destructive/30 bg-destructive/[.04]' : 'border-border bg-background/60'}`}>
                <div className="flex items-center gap-3">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${connection?.connected ? 'bg-primary text-primary-foreground' : connectionQuery.isError ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {connectionQuery.isFetching ? <Loader2 size={16} className="animate-spin" /> : connection?.connected ? <Check size={17} /> : connectionQuery.isError ? <X size={16} /> : <Activity size={16} />}
                  </span>
                  <div>
                    <p data-testid="status-builder-connection" className="text-sm font-semibold">{connectionLabel}</p>
                    <p className="mono mt-0.5 text-[10px] text-muted-foreground">
                      {connection?.checkedAt ? `last checked ${formatDate(connection.checkedAt)}` : 'no authenticated session confirmed'}
                    </p>
                  </div>
                </div>
                <button data-testid="button-check-connection" type="button" onClick={checkConnection} disabled={connectionQuery.isFetching} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-sidebar px-4 py-2 text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar/90 disabled:cursor-wait disabled:opacity-70">
                  {connectionQuery.isFetching ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}
                  {connectionQuery.isFetching ? 'Checking…' : hasCheckedConnection ? 'Check again' : 'Check connection'}
                </button>
              </div>
              {connection?.connected && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-background/60 p-3">
                    <p className="mono text-[10px] uppercase tracking-wider text-muted-foreground">allowed tools</p>
                    <p data-testid="text-connection-tools" className="mt-2 text-sm font-medium">{connection.tools?.length || 0} verified for this session</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background/60 p-3">
                    <p className="mono text-[10px] uppercase tracking-wider text-muted-foreground">environment</p>
                    <p data-testid="text-connection-environment" className="mt-2 truncate text-sm font-medium">{connection.environment ? Object.keys(connection.environment).join(', ') || 'reported by phone' : 'reported by phone'}</p>
                  </div>
                </div>
              )}
              {connectionError && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/[.05] p-3.5 text-sm">
                  <div className="flex gap-2.5">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0 text-destructive" />
                    <div>
                      <p data-testid="text-connection-error" className="font-medium">{connectionError.message}</p>
                      {(connectionError.code || connectionError.state) && <p className="mono mt-1 text-[10px] text-muted-foreground">{connectionError.code || 'bridge_error'} {connectionError.state ? `· ${connectionError.state}` : ''}</p>}
                      {connectionError.diagnostics.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Show diagnostics</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background p-2 mono text-[10px]">{connectionError.diagnostics.join('\n')}</pre></details>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={startBuild} className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
              <div className="mb-6 flex items-start gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent/15 text-accent-foreground"><FileArchive size={18} /></div>
                <div>
                  <div className="mb-1 mono text-[10px] uppercase tracking-[0.16em] text-accent-foreground">02 / define source</div>
                  <h2 className="text-xl font-semibold tracking-tight">Phone-side ZIP</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">The path below is the source of truth. Nothing selected in the browser is uploaded.</p>
                </div>
              </div>
              <div className="space-y-5">
                <div>
                  <label htmlFor="zip-context" className="mb-2 flex items-center justify-between text-sm font-medium">
                    <span>Local ZIP context <span className="font-normal text-muted-foreground">(optional)</span></span>
                    {zipName && <span className="mono text-[10px] text-primary">filename captured</span>}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex min-w-0 flex-1 items-center">
                      <FolderOpen size={16} className="pointer-events-none absolute left-3 text-muted-foreground" />
                      <input data-testid="input-zip-context" id="zip-context" type="file" accept=".zip,application/zip" onChange={(event) => setZipName(event.target.files?.[0]?.name || '')} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pl-9 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-foreground" />
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">Used as a filename cue only. It never leaves this browser.</p>
                </div>
                <div>
                  <label htmlFor="android-path" className="mb-2 flex items-center justify-between text-sm font-medium">
                    <span>Absolute Android ZIP path <span className="text-destructive">*</span></span>
                    {pathTouched && <span className={`mono text-[10px] ${pathIsValid ? 'text-primary' : 'text-destructive'}`}>{pathIsValid ? 'path accepted' : 'path not accepted'}</span>}
                  </label>
                  <div className="relative">
                    <HardDriveDownload size={16} className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" />
                    <input data-testid="input-android-zip-path" id="android-path" value={androidPath} onChange={(event) => setAndroidPath(event.target.value)} placeholder="/storage/emulated/0/Download/project.zip" spellCheck={false} className={`mono w-full rounded-lg border bg-background px-3 py-3 pl-9 text-sm transition ${pathTouched && !pathIsValid ? 'border-destructive/70 ring-2 ring-destructive/10' : pathTouched && pathIsValid ? 'border-primary/60 ring-2 ring-primary/10' : 'border-border'}`} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">Accepted roots: <span className="mono text-foreground/80">/storage/emulated/0</span> or <span className="mono text-foreground/80">/sdcard</span>. Parent traversal is blocked.</p>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/60 p-3.5 transition hover:border-primary/40">
                  <input data-testid="input-developer-mode" type="checkbox" checked={developerMode} onChange={(event) => setDeveloperMode(event.target.checked)} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium"><Code2 size={15} className="text-primary" />Developer diagnostics</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">Request additional phone-side diagnostics in the returned build log.</span>
                  </span>
                </label>
              </div>
              <div className="mt-7 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><CircleHelp size={14} /> A real connected phone and an existing ZIP are required.</p>
                <button data-testid="button-start-build" type="submit" disabled={!pathIsValid || !connection?.connected || isBuilding} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0">
                  {isBuilding ? <Loader2 size={17} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                  {isBuilding ? 'Build running…' : 'Start phone build'}
                </button>
              </div>
              {buildFailure && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/[.05] p-3.5">
                  <div className="flex gap-2.5">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0 text-destructive" />
                    <div className="min-w-0">
                      <p data-testid="text-build-error" className="text-sm font-medium">{buildFailure.message}</p>
                      {(buildFailure.code || buildFailure.state) && <p className="mono mt-1 text-[10px] text-muted-foreground">{buildFailure.code || 'build_error'} {buildFailure.state ? `· ${buildFailure.state}` : ''}</p>}
                      {buildFailure.diagnostics.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Show developer diagnostics</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 mono text-[10px]">{buildFailure.diagnostics.join('\n')}</pre></details>}
                    </div>
                  </div>
                </div>
              )}
            </form>
          </section>

          <aside className="rise-in-delay space-y-5">
            <div className="rounded-2xl border border-border bg-sidebar p-5 text-sidebar-foreground shadow-sm sm:p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sidebar-primary">
                    <Activity size={17} />
                    <span className="mono text-[10px] uppercase tracking-[0.16em]">03 / observe</span>
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight">Build timeline</h2>
                </div>
                {isBuilding && <span className="size-2 rounded-full bg-sidebar-primary pulse-dot" />}
              </div>
              <div className="mt-7">
                {timeline.map((item, index) => {
                  const isComplete = item.status === 'complete' || item.status === 'success';
                  const isActive = item.status === 'active';
                  const isFailed = item.status === 'failed';
                  return (
                    <div key={`${item.state}-${index}`} data-testid={`timeline-step-${index}`} className="relative flex gap-3.5 pb-7 last:pb-0">
                      {index < timeline.length - 1 && <span className={`absolute left-[11px] top-6 h-[calc(100%-7px)] w-px ${isComplete ? 'bg-sidebar-primary/70' : 'bg-sidebar-border'}`} />}
                      <span className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border ${isComplete ? 'border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground' : isActive ? 'border-sidebar-primary bg-sidebar-primary/20 text-sidebar-primary' : isFailed ? 'border-destructive bg-destructive/15 text-destructive' : 'border-sidebar-border bg-sidebar text-sidebar-foreground/40'}`}>
                        {isComplete ? <Check size={13} /> : isActive ? <Loader2 size={13} className="animate-spin" /> : isFailed ? <X size={13} /> : <span className="size-1.5 rounded-full bg-current" />}
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className={`text-sm ${isComplete || isActive ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/55'}`}>{item.label}</p>
                        <p className="mono mt-1 text-[9px] uppercase tracking-wider text-sidebar-foreground/40">{item.state.replaceAll('_', ' ')}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {buildResult && <p data-testid="text-build-message" className={`mt-6 border-t border-sidebar-border pt-4 text-sm leading-6 ${buildResult.state === 'SUCCESS' ? 'text-sidebar-primary' : 'text-sidebar-foreground/75'}`}>{buildResult.message}</p>}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Terminal size={17} className="text-primary" />
                  <h2 className="text-lg font-semibold tracking-tight">Developer log</h2>
                </div>
                <span className="mono text-[10px] uppercase tracking-wider text-muted-foreground">{logs.length} lines</span>
              </div>
              <div data-testid="region-developer-log" className="mt-4 min-h-36 rounded-xl border border-border bg-[#142327] p-4 text-[#b8d4c8]">
                {logs.length > 0 ? (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words mono text-[10px] leading-5">{logs.join('\n')}</pre>
                ) : (
                  <div className="flex min-h-28 flex-col items-center justify-center text-center">
                    <Clock3 size={18} className="mb-2 text-[#6f9184]" />
                    <p className="mono text-[10px] uppercase tracking-wider text-[#6f9184]">waiting for build output</p>
                    <p className="mt-1 max-w-[220px] text-xs leading-5 text-[#6f9184]">Phone-side diagnostics will appear here after a real build starts.</p>
                  </div>
                )}
              </div>
            </div>

            <div className={`rounded-2xl border p-5 shadow-sm sm:p-6 ${buildResult?.state === 'SUCCESS' ? 'border-primary/45 bg-primary/[.07]' : 'border-border bg-card'}`}>
              <div className="flex items-center gap-2">
                <Smartphone size={17} className={buildResult?.state === 'SUCCESS' ? 'text-primary' : 'text-muted-foreground'} />
                <h2 className="text-lg font-semibold tracking-tight">Artifact result</h2>
              </div>
              {buildResult?.state === 'SUCCESS' && buildResult.artifact ? (
                <div className="mt-4">
                  <p data-testid="text-artifact-filename" className="break-all mono text-sm font-medium text-primary">{buildResult.artifact.filename}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">size</p><p data-testid="text-artifact-size" className="mt-1 text-sm">{formatBytes(buildResult.artifact.sizeBytes)}</p></div>
                    <div><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">status</p><p data-testid="text-artifact-status" className="mt-1 text-sm">{buildResult.artifact.status}</p></div>
                  </div>
                  {buildResult.artifact.phonePath && <p className="mt-4 break-all border-t border-border/70 pt-3 mono text-[10px] leading-5 text-muted-foreground">{buildResult.artifact.phonePath}</p>}
                  {buildResult.artifact.sha256 && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Show SHA-256</summary><p data-testid="text-artifact-sha256" className="mt-2 break-all rounded bg-background p-2 mono text-[10px] text-foreground">{buildResult.artifact.sha256}</p></details>}
                  {buildResult.artifact.downloadUrl && <a data-testid="link-download-artifact" href={buildResult.artifact.downloadUrl} className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90" target="_blank" rel="noreferrer"><ArrowDownToLine size={16} /> Download APK <ExternalLink size={13} /></a>}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-border bg-background/50 p-4">
                  <p data-testid="text-artifact-empty" className="text-sm font-medium">{isBuilding ? 'Waiting for the phone to return an APK.' : 'No APK ready yet.'}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{isBuilding ? 'Keep this workspace open while the authenticated builder runs.' : 'A verified artifact appears here only after the phone-side build succeeds.'}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
        <footer className="mt-8 flex flex-col gap-2 border-t border-border/70 pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2"><LockKeyhole size={13} /> No browser file bytes are sent by this controller.</p>
          <p className="mono text-[10px] uppercase tracking-wider">termux / authenticated / explicit paths</p>
        </footer>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Workspace} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;