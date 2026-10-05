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
