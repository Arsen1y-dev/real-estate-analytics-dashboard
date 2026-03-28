import type { Theme } from '@/theme';

function canvasBackground(theme: Theme): string {
    return theme === 'dark' ? '#09090b' : '#ffffff';
}

function shouldIgnoreForExport(el: Element): boolean {
    return Boolean(el.closest('.no-export'));
}

async function captureElement(el: HTMLElement, theme: Theme): Promise<HTMLCanvasElement> {
    const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
    return html2canvas(el, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: canvasBackground(theme),
        ignoreElements: shouldIgnoreForExport,
    });
}

export async function exportElementToPng(el: HTMLElement, filename: string, theme: Theme): Promise<void> {
    const canvas = await captureElement(el, theme);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
    link.click();
}

export async function exportElementToPdf(el: HTMLElement, filename: string, theme: Theme): Promise<void> {
    const [{ jsPDF }] = await Promise.all([import('jspdf')]);
    const canvas = await captureElement(el, theme);
    const imgData = canvas.toDataURL('image/png');
    const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    const x = (pageW - w) / 2;
    const y = margin + (maxH - h) / 2;
    pdf.addImage(imgData, 'PNG', x, y, w, h);
    const name = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
    pdf.save(name);
}

export function slugifyFilenamePart(s: string): string {
    const t = s.replace(/[^\p{L}\p{N}\-_]+/gu, '_').replace(/^_+|_+$/g, '');
    return t.slice(0, 72) || 'chart';
}
