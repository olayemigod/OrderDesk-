import { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Props = {
  bytes: Uint8Array;
  fileName: string;
  title: string;
  onFirstPageRendered?: () => void;
  onRenderError?: (message: string) => void;
};

export default function VerifiedPdfPreview({ bytes, fileName, title, onFirstPageRendered, onRenderError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<ReturnType<typeof getDocument> | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const firstPageReportedRef = useRef(false);
  const [documentRevision, setDocumentRevision] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [documentBusy, setDocumentBusy] = useState(true);
  const [pageBusy, setPageBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setContainerWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    firstPageReportedRef.current = false;
    setDocumentBusy(true);
    setRenderError(null);
    setPageNumber(1);
    setPageCount(0);
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    pdfRef.current = null;

    const loadingTask = getDocument({ data: bytes.slice() });
    loadingTaskRef.current = loadingTask;
    void loadingTask.promise.then((pdf) => {
      if (disposed) {
        void pdf.destroy();
        return;
      }
      pdfRef.current = pdf;
      setPageCount(pdf.numPages);
      setDocumentRevision((value) => value + 1);
      setDocumentBusy(false);
    }).catch((cause: unknown) => {
      if (disposed) return;
      const message = pdfErrorMessage(cause, 'Unable to parse this governed PDF.');
      setRenderError(message);
      setDocumentBusy(false);
      onRenderError?.(message);
    });

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      const current = loadingTaskRef.current;
      loadingTaskRef.current = null;
      pdfRef.current = null;
      if (current) void current.destroy();
    };
  }, [bytes, onRenderError]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !containerWidth || pageNumber < 1 || pageNumber > pdf.numPages) return;

    let disposed = false;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    setPageBusy(true);
    setRenderError(null);

    void pdf.getPage(pageNumber).then(async (page) => {
      if (disposed) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(260, Math.min(containerWidth - 32, 980));
      const scale = availableWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Your browser cannot create the PDF preview canvas.');

      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      page.cleanup();

      if (disposed) return;
      setPageBusy(false);
      if (pageNumber === 1 && !firstPageReportedRef.current) {
        firstPageReportedRef.current = true;
        onFirstPageRendered?.();
      }
    }).catch((cause: unknown) => {
      if (disposed || isCancelledRender(cause)) return;
      const message = pdfErrorMessage(cause, 'Unable to render this governed PDF.');
      setRenderError(message);
      setPageBusy(false);
      onRenderError?.(message);
    });

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [containerWidth, documentRevision, onFirstPageRendered, onRenderError, pageNumber]);

  function downloadPdf() {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'SellerTray-Agreement.pdf';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="verified-pdf-viewer" aria-label={`${title} PDF preview`}>
    <div className="verified-pdf-toolbar">
      <div className="verified-pdf-page-controls">
        <button type="button" className="secondary-button" disabled={documentBusy || pageBusy || pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}>Previous</button>
        <span>{pageCount ? `Page ${pageNumber} of ${pageCount}` : 'Loading pages…'}</span>
        <button type="button" className="secondary-button" disabled={documentBusy || pageBusy || !pageCount || pageNumber >= pageCount} onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))}>Next</button>
      </div>
      <button type="button" className="secondary-button" onClick={downloadPdf}>Download PDF</button>
    </div>
    <div className="verified-pdf-viewport" ref={viewportRef}>
      {documentBusy ? <div className="verified-pdf-state"><strong>Loading verified PDF…</strong><span>SellerTray is parsing the exact governed document.</span></div> : null}
      {renderError ? <div className="verified-pdf-state error"><strong>PDF preview unavailable</strong><span>{renderError}</span></div> : null}
      <canvas ref={canvasRef} className={documentBusy || renderError ? 'verified-pdf-canvas hidden' : 'verified-pdf-canvas'} aria-label={`${title}, page ${pageNumber}`} />
      {!documentBusy && !renderError && pageBusy ? <div className="verified-pdf-rendering">Rendering page {pageNumber}…</div> : null}
    </div>
  </div>;
}

function pdfErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isCancelledRender(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}
