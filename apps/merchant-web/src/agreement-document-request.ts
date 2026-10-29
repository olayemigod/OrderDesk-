export type AgreementDocumentRequest = { generation: number; tenantId: string; orderFormId: string | null };

export class AgreementDocumentRequestGate {
  #generation = 0;
  #context: { tenantId: string; orderFormId: string | null } = { tenantId: '', orderFormId: null };

  /** Invalidates every request created for an earlier tenant or Order Form. */
  invalidate(tenantId: string, orderFormId: string | null): AgreementDocumentRequest {
    this.#generation += 1;
    this.#context = { tenantId, orderFormId };
    return this.snapshot();
  }

  /** Starts a new request generation for the exact tenant and Order Form. */
  begin(tenantId: string, orderFormId: string): AgreementDocumentRequest {
    return this.invalidate(tenantId, orderFormId);
  }

  isCurrent(request: AgreementDocumentRequest): boolean {
    return request.generation === this.#generation
      && request.tenantId === this.#context.tenantId
      && request.orderFormId === this.#context.orderFormId;
  }

  snapshot(): AgreementDocumentRequest {
    return { generation: this.#generation, ...this.#context };
  }
}
