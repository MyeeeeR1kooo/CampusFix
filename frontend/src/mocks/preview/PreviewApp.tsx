import { useMemo, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "../../features/auth/AuthContext";
import { ToastProvider, useToast } from "../../hooks/useToast";
import { createAppQueryClient } from "../../lib/queryClient";
import { MOCK_ACCOUNTS, MOCK_PASSWORD } from "../fixtures";
import { QueuePreviewPage } from "./QueuePreviewPage";
import { DetailPreviewPage } from "./DetailPreviewPage";

function Session() {
  const auth = useAuth();
  // Cache resets at the session boundary live in AuthContext, exactly as in the real
  // app — this preview must not carry a second copy of that behaviour.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function login(email: string) {
    setBusy(true); setError(undefined);
    try { await auth.login(email, MOCK_PASSWORD); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Login failed."); }
    finally { setBusy(false); }
  }
  return <main className="preview-main">
    <header className="card"><h2>CampusFix · #48 development preview</h2>
      <p>Two example pages share the component library. Data resets when this page reloads.</p>
      <p>Safety incidents, medical events and police reports must use the university's
        existing emergency channels. CampusFix does not handle them.</p>
      {auth.initialising ? <p role="status">Checking session…</p> : auth.user ? <div>
        <p>Signed in: {auth.user.name} · {auth.user.role}</p>
        <button type="button" disabled={busy} onClick={() => { void auth.logout(); }}>Log out</button>
      </div> : <div className="action-buttons">{MOCK_ACCOUNTS.filter((account) => account.active).map((account) => <button type="button" key={account.id} disabled={busy} onClick={() => { void login(account.email); }}>Use {account.name}</button>)}</div>}
      {error && <p role="alert">{error}</p>}
    </header>
    {auth.user && !busy && <Routes>
      <Route path="/queue" element={<QueuePreviewPage />} />
      <Route path="/detail/:id" element={<DetailPreviewPage />} />
      <Route path="*" element={<Navigate to="/queue" replace />} />
    </Routes>}
  </main>;
}

function Providers() {
  const { notify } = useToast();
  const client = useMemo(() => createAppQueryClient({ notify }), [notify]);
  return <QueryClientProvider client={client}><AuthProvider><HashRouter><Session /></HashRouter></AuthProvider></QueryClientProvider>;
}

export function PreviewApp() { return <ToastProvider><Providers /></ToastProvider>; }
