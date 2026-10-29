import { useState } from 'react';

export default function SetupCompletionForm({ branchName, saving, onSubmit, onClose }: {
  branchName: string;
  saving: boolean;
  onSubmit: (evidence: Record<string, unknown>, reason: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ branchConfigured: false, merchantWalkthrough: false, paired: false, printed: false, provisioning: 'supplied', identifier: '', handoverCondition: '', receivedBy: '', acknowledgement: '', reason: '' });
  const ready = draft.branchConfigured && draft.merchantWalkthrough && draft.paired && draft.printed && [draft.identifier, draft.handoverCondition, draft.receivedBy, draft.acknowledgement].every((value) => value.trim().length >= 2) && draft.reason.trim().length >= 6;
  async function submit() {
    if (!ready || saving) return;
    const evidence = {
      schemaVersion: 1,
      checklist: { branchConfigured: draft.branchConfigured, merchantWalkthrough: draft.merchantWalkthrough },
      equipment: [{ kind: 'bluetooth_printer', provisioning: draft.provisioning, identifier: draft.identifier.trim(), pairingTestResult: 'passed', testReceiptPrinted: draft.printed, handoverCondition: draft.handoverCondition.trim() }],
      receivedBy: draft.receivedBy.trim(), acknowledgement: draft.acknowledgement.trim(),
    };
    if (await onSubmit(evidence, draft.reason.trim())) onClose();
  }
  return <section className="workspace-panel setup-completion-form" aria-label={`Complete setup for ${branchName}`}>
    <h3>Complete setup — {branchName}</h3>
    <p>Record the equipment and merchant handover. Every required check must pass before this Branch is ready.</p>
    <fieldset className="workspace-form-stack" disabled={saving} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <div className="workspace-filter-row">
        {([['branchConfigured', 'Branch configured'], ['merchantWalkthrough', 'Merchant walkthrough completed'], ['paired', 'Printer paired successfully'], ['printed', 'Test receipt printed']] as const).map(([field, label]) => <label className="workspace-check-pill" key={field}><input type="checkbox" checked={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.checked })} />{label}</label>)}
      </div>
      <div className="workspace-field-grid two">
        <label>Bluetooth printer<select value={draft.provisioning} onChange={(event) => setDraft({ ...draft, provisioning: event.target.value })}><option value="supplied">Supplied</option><option value="configured">Configured</option></select></label>
        {([['identifier', 'Printer serial / device identifier', 500], ['handoverCondition', 'Equipment handover condition', 500], ['receivedBy', 'Receiving merchant representative', 2000], ['acknowledgement', 'Acknowledgement / evidence reference', 2000], ['reason', 'Completion notes / reason', 1000]] as const).map(([field, label, maxLength]) => <label key={field}>{label}<input value={draft[field]} maxLength={maxLength} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
      </div>
      <p>The assigned installer, ProcessEdge actor and completion time are recorded by SellerTray.</p>
      <div className="workspace-filter-row"><button className="workspace-button primary" disabled={!ready} onClick={() => void submit()}>Save completion evidence</button><button className="workspace-button subtle" onClick={onClose}>Close</button></div>
    </fieldset>
  </section>;
}
