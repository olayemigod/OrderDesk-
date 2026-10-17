import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessage, supabase } from './supabase';

type Branch = { id: string; name: string; isDefault: boolean };
type Method = { id: string; methodType: string; displayName: string; isEnabled: boolean; sortOrder: number };
type Assignment = { payment_method_id: string; branch_id: string; is_enabled: boolean };

export default function PaymentBranchManagement({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>({});
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [terminalName, setTerminalName] = useState('');
  const [terminalInstructions, setTerminalInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedMethod = useMemo(
    () => methods.find((method) => method.id === selectedMethodId) ?? null,
    [methods, selectedMethodId],
  );
  const selectedBranches = assignments[selectedMethodId] ?? new Set<string>();

  useEffect(() => { void load(); }, [tenantId]);

  async function load(preferredMethodId?: string) {
    setLoading(true);
    setError(null);
    try {
      const [branchResult, methodResult, assignmentResult] = await Promise.all([
        supabase.rpc('get_sellertray_accessible_branches', { p_tenant_id: tenantId }),
        supabase.from('merchant_payment_methods').select('id,method_type,display_name,is_enabled,sort_order').eq('tenant_id', tenantId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('sellertray_branch_payment_methods').select('payment_method_id,branch_id,is_enabled').eq('tenant_id', tenantId),
      ]);
      if (branchResult.error) throw branchResult.error;
      if (methodResult.error) throw methodResult.error;
      if (assignmentResult.error) throw assignmentResult.error;

      const nextBranches = ((branchResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? 'Branch'),
        isDefault: row.is_default === true,
      })).filter((row) => row.id);
      const nextMethods = ((methodResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        methodType: String(row.method_type ?? ''),
        displayName: String(row.display_name ?? 'Payment method'),
        isEnabled: row.is_enabled === true,
        sortOrder: Number(row.sort_order ?? 100),
      })).filter((row) => row.id);
      const map: Record<string, Set<string>> = {};
      for (const method of nextMethods) map[method.id] = new Set<string>();
      for (const row of (assignmentResult.data ?? []) as Assignment[]) {
        if (row.is_enabled && map[row.payment_method_id]) map[row.payment_method_id].add(row.branch_id);
      }
      setBranches(nextBranches);
      setMethods(nextMethods);
      setAssignments(map);
      const wanted = preferredMethodId && nextMethods.some((row) => row.id === preferredMethodId)
        ? preferredMethodId
        : selectedMethodId && nextMethods.some((row) => row.id === selectedMethodId)
          ? selectedMethodId
          : nextMethods[0]?.id ?? '';
      setSelectedMethodId(wanted);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to load Branch payment availability.'));
    } finally {
      setLoading(false);
    }
  }

  function toggleBranch(branchId: string) {
    if (!selectedMethodId) return;
    setAssignments((current) => {
      const next = { ...current };
      const values = new Set(current[selectedMethodId] ?? []);
      if (values.has(branchId)) values.delete(branchId); else values.add(branchId);
      next[selectedMethodId] = values;
      return next;
    });
  }

  async function saveAssignments() {
    if (!selectedMethodId) return;
    setBusy(true);
    clearNotice();
    try {
      const { error: functionError } = await supabase.functions.invoke('payment-settings', {
        body: {
          action: 'assign_branches',
          tenantId,
          methodId: selectedMethodId,
          branchIds: Array.from(selectedBranches),
        },
      });
      if (functionError) throw functionError;
      setMessage(`${selectedMethod?.displayName ?? 'Payment method'} Branch availability saved.`);
      await load(selectedMethodId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to save Branch payment availability.'));
    } finally {
      setBusy(false);
    }
  }

  async function createTerminal(event: FormEvent) {
    event.preventDefault();
    const displayName = terminalName.trim();
    if (!displayName) return setError('Enter the terminal name shown to staff.');
    setBusy(true);
    clearNotice();
    try {
      const { data, error: functionError } = await supabase.functions.invoke('payment-settings', {
        body: {
          action: 'save_method',
          tenantId,
          methodId: null,
          methodType: 'card_terminal',
          displayName,
          isEnabled: true,
          isDefault: false,
          sortOrder: 40,
          mode: 'live',
          bankName: null,
          bankAccountName: null,
          bankAccountNumber: null,
          bankCode: null,
          instructions: terminalInstructions.trim() || null,
        },
      });
      if (functionError) throw functionError;
      const method = data && typeof data === 'object' && 'method' in data && data.method && typeof data.method === 'object'
        ? data.method as Record<string, unknown>
        : null;
      const methodId = method && typeof method.id === 'string' ? method.id : '';
      if (!methodId) throw new Error('SellerTray did not return the terminal payment method.');
      const defaultBranches = branches.map((branch) => branch.id);
      const { error: assignmentError } = await supabase.functions.invoke('payment-settings', {
        body: { action: 'assign_branches', tenantId, methodId, branchIds: defaultBranches },
      });
      if (assignmentError) throw assignmentError;
      setTerminalName('');
      setTerminalInstructions('');
      setMessage('Card terminal added and made available at the current active Branches. Review the Branch selection below.');
      await load(methodId);
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to add this card terminal.'));
    } finally {
      setBusy(false);
    }
  }

  function clearNotice() {
    setError(null);
    setMessage(null);
  }

  if (loading) return <article className="panel"><p className="muted">Loading Branch payment availability…</p></article>;

  return <div className="page-stack">
    <article className="panel settings-form">
      <div className="panel-head"><div><p className="eyebrow">Branch payment availability</p><h3>Where each payment method can be used</h3></div></div>
      <p className="muted">Cash is available as drawer cash for every operating Branch. Assign bank accounts, terminals and other configured methods only to the Branches where staff can actually accept them.</p>
      {error ? <div className="error-banner compact">{error}</div> : null}
      {message ? <div className="success-banner compact">{message}</div> : null}
      {!methods.length ? <div className="empty-state"><strong>No merchant payment method yet</strong><p>Add bank or online methods in Payment settings, or add a card terminal below.</p></div> : <>
        <label className="select-field"><span>Payment method</span><select value={selectedMethodId} onChange={(event) => setSelectedMethodId(event.target.value)}>{methods.map((method) => <option key={method.id} value={method.id}>{method.displayName}{method.isEnabled ? '' : ' · Disabled'}</option>)}</select></label>
        {selectedMethod ? <div className="settings-check-grid">
          {branches.map((branch) => <label key={branch.id} className="check-row"><input type="checkbox" checked={selectedBranches.has(branch.id)} disabled={busy || !selectedMethod.isEnabled} onChange={() => toggleBranch(branch.id)} /><span><strong>{branch.name}</strong><small>{branch.isDefault ? 'Default Branch' : 'Branch'}{selectedMethod.isEnabled ? '' : ' · Enable this payment method first'}</small></span></label>)}
        </div> : null}
        <div className="settings-actions"><button type="button" className="primary-button" disabled={busy || !selectedMethod} onClick={() => void saveAssignments()}>{busy ? 'Saving' : 'Save Branch availability'}</button></div>
      </>}
    </article>

    <form className="panel settings-form" onSubmit={createTerminal}>
      <div className="panel-head"><div><p className="eyebrow">In-person payments</p><h3>Add card terminal</h3></div></div>
      <p className="muted">Use this for a physical POS terminal such as Moniepoint, OPay or a bank terminal. SellerTray records the confirmed terminal sale separately from drawer cash.</p>
      <div className="settings-grid two">
        <label className="field"><span>Terminal name</span><input value={terminalName} onChange={(event) => setTerminalName(event.target.value)} placeholder="e.g. Moniepoint POS" maxLength={80} /></label>
        <label className="field"><span>Staff instruction</span><input value={terminalInstructions} onChange={(event) => setTerminalInstructions(event.target.value)} placeholder="Confirm approval before completing sale" maxLength={500} /></label>
      </div>
      <div className="settings-actions"><button className="secondary-button" disabled={busy || !terminalName.trim()}>{busy ? 'Saving' : 'Add card terminal'}</button></div>
    </form>
  </div>;
}
