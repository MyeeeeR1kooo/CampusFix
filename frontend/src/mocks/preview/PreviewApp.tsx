import { useMemo, useState } from "react";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "../../features/auth/AuthContext";
import { ToastProvider, useToast } from "../../hooks/useToast";
import { createAppQueryClient } from "../../lib/queryClient";
import { MOCK_ACCOUNTS, MOCK_PASSWORD } from "../fixtures";
import { QueuePreviewPage } from "./QueuePreviewPage";
import { DetailPreviewPage } from "./DetailPreviewPage";

function Session() {
  const auth = useAuth();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function login(email: string) {
    setBusy(true); setError(undefined);
    await client.cancelQueries(); client.clear();
    try { await auth.login(email, MOCK_PASSWORD); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Login failed."); }
    finally { setBusy(false); }
  }
  return <main className="preview-main">
    <header className="card"><h2>CampusFix · #48 development preview</h2>
      <p>Two example pages share the component library. Data resets when this page reloads.</p>
      <p>CampusFix handles facilities only. Use existing school emergency channels for urgent safety or medical incidents.</p>
      {auth.initialising ? <p role="status">Checking session…</p> : auth.user ? <div>
        <p>Signed in: {auth.user.name} · {auth.user.role}</p>
        <button type="button" disabled={busy} onClick={() => { void client.cancelQueries().then(() => { client.clear(); return auth.logout(); }); }}>Log out</button>
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
