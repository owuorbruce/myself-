/**
 * Offline text recognition for images and scanned PDFs.
 * The OCR engine and English language data ship with Slate under ocr/
 * and are cached on first use, so this works without a connection after
 * the first time.
 */
type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let worker: Promise<Worker> | null = null;

function base() {
  return new URL("ocr/", new URL(import.meta.env.BASE_URL, location.href)).href;
}

async function getWorker(progress?: (p: number) => void) {
  if (!worker)
    worker = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      return createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: base() + "worker.min.js",
        corePath: base(),
        langPath: base(),
        gzip: true,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") progress?.(m.progress);
        },
      });
    })().catch((e) => {
      worker = null;
      throw e;
    });
  return worker;
}

export async function recognize(
  image: Blob | HTMLCanvasElement,
  progress?: (p: number) => void,
) {
  const w = await getWorker(progress);
  const { data } = await w.recognize(image);
  return data.text.replace(/[ \t]+\n/g, "\n").trim();
}

/** OCR each page of a scanned PDF (up to `limit` pages). */
export async function recognizePdf(
  file: Blob,
  progress?: (page: number, pages: number) => void,
  limit = 40,
) {
  const { renderPages } = await import("./pdf");
  const out: string[] = [];
  await renderPages(
    file,
    async (canvas, page, pages) => {
      progress?.(page, pages);
      out.push(`[Page ${page}]\n` + (await recognize(canvas)));
    },
    limit,
  );
  return out.join("\n\n");
}

export async function stopOcr() {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate();
}
