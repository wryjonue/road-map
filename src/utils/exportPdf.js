import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * Generate a PDF report from the dashboard container.
 * @param {HTMLElement} element - The dashboard DOM node to capture.
 * @param {object} meta - Metadata for the report header.
 * @param {string} meta.monthLabel - e.g. "October 2026"
 * @param {string} meta.municipality - e.g. "All Municipalities" or "Cebu City"
 * @param {string} meta.generatedAt - Localized timestamp string.
 */
export async function generateDashboardPdf(element, { monthLabel, municipality, generatedAt }) {
	// Temporarily hide interactive elements that shouldn't appear in print.
	const noPrintEls = element.querySelectorAll('[data-pdf-exclude]');
	noPrintEls.forEach((el) => { el.style.display = 'none'; });

	try {
		const canvas = await html2canvas(element, {
			scale: 2,
			useCORS: true,
			backgroundColor: '#ffffff',
			logging: false,
		});

		const imgData = canvas.toDataURL('image/png');
		const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
		const pageWidth = pdf.internal.pageSize.getWidth();
		const pageHeight = pdf.internal.pageSize.getHeight();
		const margin = 10;
		const contentWidth = pageWidth - margin * 2;

		// Header
		pdf.setFontSize(18);
		pdf.setTextColor(15, 23, 42);
		pdf.text(`RoadMap Monthly Report: ${monthLabel}`, margin, margin + 8);
		pdf.setFontSize(10);
		pdf.setTextColor(100, 116, 139);
		pdf.text(`Municipality: ${municipality}  |  Generated: ${generatedAt}`, margin, margin + 14);

		// Dashboard image scaled to fit width
		const imgProps = pdf.getImageProperties(imgData);
		const aspectRatio = imgProps.height / imgProps.width;
		const imgHeight = contentWidth * aspectRatio;
		const startY = margin + 20;

		if (imgHeight <= pageHeight - startY - margin) {
			pdf.addImage(imgData, 'PNG', margin, startY, contentWidth, imgHeight);
		} else {
			// Multi-page handling: split the captured image across pages
			let remainingHeight = imgHeight;
			let currentY = 0;
			let pageNum = 0;
			while (remainingHeight > 0) {
				const availableHeight = pageHeight - startY - margin;
				const sliceHeight = Math.min(remainingHeight, availableHeight);
				const sourceY = (currentY / imgHeight) * imgProps.height;
				const sourceH = (sliceHeight / imgHeight) * imgProps.height;

				// Create a temporary canvas for this slice
				const sliceCanvas = document.createElement('canvas');
				sliceCanvas.width = imgProps.width;
				sliceCanvas.height = sourceH;
				const ctx = sliceCanvas.getContext('2d');
				ctx.drawImage(canvas, 0, sourceY, imgProps.width, sourceH, 0, 0, imgProps.width, sourceH);
				const sliceData = sliceCanvas.toDataURL('image/png');

				if (pageNum > 0) pdf.addPage();
				pdf.addImage(sliceData, 'PNG', margin, startY, contentWidth, sliceHeight);

				currentY += sliceHeight;
				remainingHeight -= sliceHeight;
				pageNum++;
			}
		}

		pdf.save(`roadmap-report-${monthLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`);
	} finally {
		// Restore hidden elements regardless of success/failure.
		noPrintEls.forEach((el) => { el.style.display = ''; });
	}
}
