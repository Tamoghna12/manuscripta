import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { getDocument, renderTextLayer } from 'pdfjs-dist';

export default function PdfPreview({
  pdfUrl,
  scale,
  fitWidth,
  spread,
  onFitScale,
  onTextClick,
  onOutline,
  annotations,
  annotateMode,
  onAddAnnotation,
  onSynctexClick,
  synctexHighlight,
  containerRef: externalRef,
}: {
  pdfUrl: string;
  scale: number;
  fitWidth: boolean;
  spread: boolean;
  onFitScale?: (value: number | null) => void;
  onTextClick: (text: string) => void;
  onOutline?: (items: { title: string; page?: number; level: number }[]) => void;
  annotations: { id: string; page: number; x: number; y: number; text: string }[];
  annotateMode: boolean;
  onAddAnnotation?: (page: number, x: number, y: number) => void;
  onSynctexClick?: (page: number, x: number, y: number) => void;
  synctexHighlight?: { page: number; x: number; y: number; w: number; h: number } | null;
  containerRef?: RefObject<HTMLDivElement>;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const containerRef = externalRef || localRef;
  const renderScaleRef = useRef(scale);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfUrl) return;
    let cancelled = false;
    container.innerHTML = '';

    const render = async () => {
      try {
        const loadingTask = getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        const containerWidth = container.clientWidth - 24;
        const pageTargetWidth = spread ? Math.max(200, (containerWidth - 16) / 2) : containerWidth;

        let baseScale = scale;
        let firstPage: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
        if (fitWidth && containerWidth > 0) {
          firstPage = await pdf.getPage(1);
          const originalViewport = firstPage.getViewport({ scale: 1.0 });
          baseScale = pageTargetWidth / originalViewport.width;
          if (onFitScale) {
            onFitScale(baseScale);
          }
        } else if (onFitScale) {
          onFitScale(null);
        }
        renderScaleRef.current = baseScale;

        const renderPage = async (page: Awaited<ReturnType<typeof pdf.getPage>>) => {
          const cssViewport = page.getViewport({ scale: baseScale });
          const qualityBoost = Math.min(2.4, (window.devicePixelRatio || 1) * 1.25);
          const renderViewport = page.getViewport({ scale: baseScale * qualityBoost });

          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'pdf-page';
          pageWrapper.style.width = `${cssViewport.width}px`;
          pageWrapper.style.height = `${cssViewport.height}px`;
          pageWrapper.dataset.pageNumber = String(page.pageNumber);

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = renderViewport.width;
          canvas.height = renderViewport.height;
          canvas.style.width = `${cssViewport.width}px`;
          canvas.style.height = `${cssViewport.height}px`;
          pageWrapper.appendChild(canvas);

          const textLayer = document.createElement('div');
          textLayer.className = 'textLayer';
          textLayer.style.width = `${cssViewport.width}px`;
          textLayer.style.height = `${cssViewport.height}px`;
          pageWrapper.appendChild(textLayer);

          if (ctx) {
            await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
          }
          const textContent = await page.getTextContent();
          renderTextLayer({
            textContentSource: textContent,
            container: textLayer,
            viewport: cssViewport,
          });
          return pageWrapper;
        };

        const wrappers: HTMLElement[] = [];
        if (firstPage) {
          if (cancelled) return;
          const firstWrapper = await renderPage(firstPage);
          wrappers.push(firstWrapper);
        }

        for (let pageNum = firstPage ? 2 : 1; pageNum <= pdf.numPages; pageNum += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const wrapper = await renderPage(page);
          wrappers.push(wrapper);
        }

        if (spread) {
          for (let idx = 0; idx < wrappers.length; idx += 2) {
            const row = document.createElement('div');
            row.className = 'pdf-spread';
            row.appendChild(wrappers[idx]);
            if (wrappers[idx + 1]) {
              row.appendChild(wrappers[idx + 1]);
            }
            container.appendChild(row);
          }
        } else {
          wrappers.forEach((wrapper) => container.appendChild(wrapper));
        }

        if (onOutline) {
          try {
            const outline = await pdf.getOutline();
            const items: { title: string; page?: number; level: number }[] = [];
            const walk = async (entries: any[], level: number) => {
              if (!entries) return;
              for (const entry of entries) {
                let pageNumber: number | undefined;
                try {
                  const dest =
                    typeof entry.dest === 'string'
                      ? await pdf.getDestination(entry.dest)
                      : entry.dest;
                  if (Array.isArray(dest) && dest.length > 0) {
                    const pageIndex = await pdf.getPageIndex(dest[0]);
                    pageNumber = pageIndex + 1;
                  }
                } catch {
                  pageNumber = undefined;
                }
                items.push({ title: entry.title || '(untitled)', page: pageNumber, level });
                if (entry.items?.length) {
                  await walk(entry.items, level + 1);
                }
              }
            };
            await walk(outline || [], 1);
            onOutline(items);
          } catch {
            onOutline([]);
          }
        }
      } catch (err) {
        console.error('PDF render error:', err);
        container.innerHTML = `<div class="muted">${'PDF render failed'}</div>`;
      }
    };

    render().catch(() => {
      container.innerHTML = `<div class="muted">${'PDF render failed'}</div>`;
    });

    return () => {
      cancelled = true;
      container.innerHTML = '';
    };
  }, [pdfUrl, fitWidth, onFitScale, scale, spread, onOutline]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('.pdf-annotation').forEach((node) => node.remove());
    annotations.forEach((note) => {
      const pageEl = container.querySelector(
        `.pdf-page[data-page-number="${note.page}"]`,
      ) as HTMLElement | null;
      if (!pageEl) return;
      const marker = document.createElement('div');
      marker.className = 'pdf-annotation';
      marker.style.left = `${note.x * 100}%`;
      marker.style.top = `${note.y * 100}%`;
      marker.title = note.text;
      marker.dataset.annotationId = note.id;
      pageEl.appendChild(marker);
    });
  }, [annotations, pdfUrl, spread]);

  // SyncTeX forward search: highlight a position on a PDF page
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !synctexHighlight) return;
    // Remove old highlights
    container.querySelectorAll('.synctex-highlight').forEach(el => el.remove());
    const { page, x, y } = synctexHighlight;
    const pageEl = container.querySelector(`[data-page-number="${page}"]`) as HTMLElement | null;
    if (!pageEl) return;
    const s = renderScaleRef.current;
    const marker = document.createElement('div');
    marker.className = 'synctex-highlight';
    marker.style.position = 'absolute';
    marker.style.left = `${x * s}px`;
    marker.style.top = `${y * s}px`;
    marker.style.width = `${Math.max((synctexHighlight.w || 200) * s, 40)}px`;
    marker.style.height = `${Math.max((synctexHighlight.h || 12) * s, 4)}px`;
    marker.style.background = 'rgba(180, 74, 47, 0.25)';
    marker.style.border = '2px solid rgba(180, 74, 47, 0.6)';
    marker.style.borderRadius = '3px';
    marker.style.pointerEvents = 'none';
    marker.style.zIndex = '10';
    marker.style.transition = 'opacity 0.3s ease';
    pageEl.style.position = 'relative';
    pageEl.appendChild(marker);
    // Scroll to highlighted page
    pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Fade out after 2s
    const timer = setTimeout(() => { marker.style.opacity = '0'; }, 2000);
    const removeTimer = setTimeout(() => marker.remove(), 2500);
    return () => { clearTimeout(timer); clearTimeout(removeTimer); marker.remove(); };
  }, [synctexHighlight]);

  return (
    <div
      className={`pdf-preview ${annotateMode ? 'annotate' : ''}`}
      ref={containerRef}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (annotateMode && onAddAnnotation) {
          const pageEl = target.closest('.pdf-page') as HTMLElement | null;
          if (pageEl) {
            const rect = pageEl.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width;
            const y = (event.clientY - rect.top) / rect.height;
            const page = Number(pageEl.dataset.pageNumber || 1);
            onAddAnnotation(page, x, y);
            return;
          }
        }
        // SyncTeX inverse search: Ctrl+Click or Cmd+Click on PDF
        if ((event.ctrlKey || event.metaKey) && onSynctexClick) {
          const pageEl = (target.closest('.pdf-page') || target) as HTMLElement;
          if (pageEl?.dataset?.pageNumber) {
            const rect = pageEl.getBoundingClientRect();
            const s = renderScaleRef.current;
            // Convert screen pixels to PDF points (scale=1 coordinates)
            const pdfX = (event.clientX - rect.left) / s;
            const pdfY = (event.clientY - rect.top) / s;
            const page = Number(pageEl.dataset.pageNumber);
            onSynctexClick(page, pdfX, pdfY);
            return;
          }
        }
        if (target.tagName !== 'SPAN') return;
        const text = (target.textContent || '').trim();
        if (text.length < 3) return;
        onTextClick(text);
      }}
    />
  );
}
