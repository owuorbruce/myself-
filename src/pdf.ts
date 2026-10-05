import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;
export async function extractPdf(file: File) {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    if (doc.numPages > 300)
      throw new Error(
        "PDF has more than 300 pages. Attached without text indexing.",
      );
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text +=
        `\n[Page ${i}]\n` +
        content.items
          .map((item) =>
            "str" in item
              ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ")
              : "",
          )
          .join("");
      page.cleanup();
      if (text.length > 1000000) break;
    }
    return text.slice(0, 1000000);
  } finally {
    await task.destroy();
  }
}
/** Renders PDF pages to canvases, one at a time (used for OCR of scans). */
export async function renderPages(
  file: Blob,
  each: (canvas: HTMLCanvasElement, page: number, pages: number) => Promise<void>,
  limit = 40,
) {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, limit);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
      }).promise;
      await each(canvas, i, pages);
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
  } finally {
    await task.destroy();
  }
}
/** True when a PDF's text layer is (nearly) empty, as in a scan. */
export function looksScanned(text: string) {
  const pages = (text.match(/\[Page \d+\]/g) || []).length || 1;
  return text.replace(/\[Page \d+\]/g, "").replace(/\s/g, "").length / pages < 40;
}
